import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { sendNotificationEmail } from "@/lib/email";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";

/**
 * Server-side auto-iterator for the Incentives Lab. Runs with full secrets (Vercel env), so it can
 * read the DB + Instantly directly. Each run it: reads feedback (sends/bounces/replies, fresh pool,
 * variant performance), keeps the engine HEALTHY (resume paused campaigns, throttle on high bounce,
 * scale volume when deliverability is clean), and PROMOTES winning variants once there's real signal.
 * Conservative by design: with little data it explores; it only narrows toward winners with evidence.
 * Returns a structured report (also consumed by the twice-daily creative agent).
 */
const ROLLING_NAME = "Incentives Lab (rolling)";
const BOUNCE_CEIL = 5;   // % 24h bounce above which we throttle
const BOUNCE_FLOOR = 2;  // % below which (and hitting cap) we scale up
const PROMOTE_MIN_POSITIVES = 3; // need at least this many positive replies before narrowing variants

type VariantRow = { key: string; sent: number; positive: number; replies: number; rate: number };

async function variantPerf(workspaceId: string, field: "incentiveAmount" | "incentiveSubjectStyle" | "incentiveGiftType", valueFirst = false): Promise<VariantRow[]> {
  // incentiveAmount > 0 selects the incentive track; incentiveAmount = 0 selects the value-first track
  // (stamped amount 0 at launch). Splitting on this keeps the two A/Bs from polluting each other.
  const amtFilter = valueFirst ? { incentiveAmount: 0 } : { incentiveAmount: { gt: 0 } };
  const [sent, reply] = await Promise.all([
    prisma.lead.groupBy({ by: [field], where: { leadBatch: { workspaceId }, [field]: { not: null }, ...amtFilter, sentAt: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: [field, "replyStatus"], where: { leadBatch: { workspaceId }, [field]: { not: null }, ...amtFilter, replyStatus: { not: null } }, _count: true }),
  ]);
  const m: Record<string, VariantRow> = {};
  for (const r of sent) { const k = String((r as Record<string, unknown>)[field]); m[k] = { key: k, sent: r._count, positive: 0, replies: 0, rate: 0 }; }
  for (const r of reply) { const k = String((r as Record<string, unknown>)[field]); (m[k] ||= { key: k, sent: 0, positive: 0, replies: 0, rate: 0 }); m[k].replies += r._count; if (r.replyStatus === "positive") m[k].positive += r._count; }
  return Object.values(m).map((v) => ({ ...v, rate: v.sent > 0 ? v.positive / v.sent : 0 })).sort((a, b) => b.rate - a.rate || b.positive - a.positive);
}

/**
 * Apollo COST efficiency over recent pulls. The engine spends a credit per enrichment, so a pull that
 * is mostly duplicates/locked is money burned for nothing. We were blind to this once (re-scanning
 * page 1 every pull cost ~9 credits per net-new lead before anyone noticed). This reads the ingest
 * activity logs and computes yield = new leads / enrichment attempts, so the optimizer can FLAG a
 * cost leak the moment it appears instead of waiting for the bill. Reads the last 24h of pulls.
 */
async function apolloEfficiency(workspaceId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = await prisma.activityLog.findMany({
    where: { workspaceId, type: "ingest", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" }, take: 40, select: { metaJson: true, message: true, createdAt: true },
  });
  let inserted = 0, wasted = 0, zeroPulls = 0, lockedOnly = 0;
  let creditsOut = false;
  // Capture the most-recent pull's reason so a STALLED pipeline (every pull returning 0 leads) is
  // visible in the report itself — the routine agent runs on CRON_SECRET and cannot read the Activity
  // log (session-only), so without this the blocker (out-of-credits vs mined-out vs locked) is silent.
  let latestMessage: string | null = logs[0]?.message ?? null;
  for (const l of logs) {
    try {
      const m = l.metaJson ? JSON.parse(l.metaJson) : {};
      const ins = Number(m.ingested) || 0;
      inserted += ins;
      wasted += (Number(m.duplicatesSkipped) || 0) + (Number(m.lockedSkipped) || 0);
      if (ins === 0) zeroPulls++;
      if (m.creditsOut === true) creditsOut = true;
      if (ins === 0 && (Number(m.lockedSkipped) || 0) > 0) lockedOnly++;
    } catch { /* skip unparseable */ }
  }
  const attempts = inserted + wasted;
  const yieldPct = attempts > 0 ? Math.round((inserted / attempts) * 100) : null;
  // Flag only with enough volume to be meaningful, and when most spend is waste.
  const leak = attempts >= 200 && yieldPct !== null && yieldPct < 35;
  // STALLED: several recent pulls but not a single new lead landed. This starves the whole engine
  // (no fresh pool → sends collapse), so it is a louder, higher-priority signal than the cost leak.
  const stalled = logs.length >= 3 && inserted === 0;
  return { pulls: logs.length, inserted, wasted, attempts, yieldPct, leak, stalled, zeroPulls, lockedOnly, creditsOut, latestMessage };
}

export async function optimizeIncentivesForWorkspace(workspaceId: string): Promise<Record<string, unknown>> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { incentivesDailyCap: true, incentiveConfigJson: true, notifyEmail: true, user: { select: { email: true } } } });
  const dailyCap = ws?.incentivesDailyCap ?? 500;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [sent24, bounced24, freshPool, totalSent, positives] = await Promise.all([
    // sent24 must count re-contacts too (recycle/OOO stamp recycledAt, not sentAt) — otherwise the
    // bounce-rate denominator and the throttle/scale logic are blind to recycle volume (reads 0 sent
    // on a recycle-only day, so the deliverability guardrail can't see recycle bounces).
    prisma.lead.count({ where: { leadBatch: { workspaceId }, OR: [{ sentAt: { gte: since } }, { recycledAt: { gte: since } }] } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, bouncedAt: { gte: since } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: null, suppressed: false, repliedAt: null, email: { not: "" } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, incentiveAmount: { gt: 0 }, sentAt: { not: null } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, incentiveAmount: { gt: 0 }, replyStatus: "positive" } }),
  ]);
  const bounceRate = sent24 >= 20 ? Math.round((bounced24 / sent24) * 1000) / 10 : 0;
  const [byAmount, byStyle, byGift] = await Promise.all([
    variantPerf(workspaceId, "incentiveAmount"), variantPerf(workspaceId, "incentiveSubjectStyle"), variantPerf(workspaceId, "incentiveGiftType"),
  ]);

  // VALUE-FIRST track (no money, incentiveAmount = 0) runs at ~20% of every autopilot send but was
  // invisible here — the routine agent could not tell whether the no-money hook beats incentives, so
  // the most important strategic call (scale value-first vs incentives) was being made blind. Surface
  // both tracks' positive-reply rate head-to-head, plus value-first's own per-subject breakdown.
  const [vfSent, vfPositive, vfReplies, vfByStyle] = await Promise.all([
    prisma.lead.count({ where: { leadBatch: { workspaceId }, incentiveAmount: 0, sentAt: { not: null } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, incentiveAmount: 0, replyStatus: "positive" } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, incentiveAmount: 0, replyStatus: { not: null } } }),
    variantPerf(workspaceId, "incentiveSubjectStyle", true),
  ]);

  const actions: string[] = [];

  // 1. Health: resume a paused rolling campaign.
  const rolling = await prisma.sentCampaign.findFirst({ where: { workspaceId, name: ROLLING_NAME }, orderBy: { createdAt: "desc" }, select: { instantlyCampaignId: true } });
  const ctx = await getInstantlyClientForWorkspaceId(workspaceId);
  let campaignStatus: number | null = null;
  if (ctx && rolling?.instantlyCampaignId) {
    try {
      const a = await ctx.client.getCampaignAnalytics(rolling.instantlyCampaignId);
      campaignStatus = a?.campaign_status ?? null;
      if (campaignStatus === 2) { await ctx.client.activateCampaign(rolling.instantlyCampaignId).catch(() => {}); actions.push("resumed paused rolling campaign"); }
    } catch { /* best effort */ }
  }

  // 2. Deliverability-aware volume: throttle on high bounce, scale when clean and hitting the cap.
  let newCap = dailyCap;
  if (bounceRate > BOUNCE_CEIL) { newCap = Math.max(200, Math.floor(dailyCap / 2)); actions.push(`bounce ${bounceRate}% over ${BOUNCE_CEIL}% — throttled cap ${dailyCap}→${newCap}`); }
  else if (bounceRate < BOUNCE_FLOOR && freshPool > 100 && sent24 >= dailyCap * 0.8) { newCap = Math.min(6000, dailyCap + 500); actions.push(`clean (bounce ${bounceRate}%) and hitting cap — scaled cap ${dailyCap}→${newCap}`); }
  if (newCap !== dailyCap) await prisma.workspace.update({ where: { id: workspaceId }, data: { incentivesDailyCap: newCap } });

  // 3. Promote winners — only with real signal, and never collapse to a single variant (keep exploring).
  if (positives >= PROMOTE_MIN_POSITIVES) {
    const winningGift = byGift[0]?.key;
    const winningAmount = byAmount[0]?.key;
    actions.push(`promoting winners: gift=${winningGift} amount=$${winningAmount} (top by positive-reply rate); kept runner-up for continued testing`);
    // (Config narrowing applied conservatively by the creative agent / next iteration once trends hold.)
  } else {
    actions.push(`exploring — ${positives} positive replies so far, below ${PROMOTE_MIN_POSITIVES} needed to promote`);
  }

  // 3b. INCENTIVE vs VALUE-FIRST head-to-head — the lever for the next big swing. Only call a leader
  // once both arms have enough volume to mean something; otherwise report it as still-gathering.
  const incRate = totalSent > 0 ? positives / totalSent : 0;
  const vfRate = vfSent > 0 ? vfPositive / vfSent : 0;
  const MIN_ARM = 200; // sends per arm before a leader call is trustworthy
  const enough = totalSent >= MIN_ARM && vfSent >= MIN_ARM;
  const leader = !enough ? "insufficient-data" : vfRate > incRate ? "value-first" : incRate > vfRate ? "incentive" : "tie";
  const valueFirst = { sent: vfSent, positive: vfPositive, replies: vfReplies, rate: vfRate, byStyle: vfByStyle };
  const headToHead = { incentive: { sent: totalSent, positive: positives, rate: incRate }, valueFirst: { sent: vfSent, positive: vfPositive, rate: vfRate }, leader, minArm: MIN_ARM };
  const pct = (r: number) => (r * 100).toFixed(3) + "%";
  if (enough) {
    actions.push(`A/B incentive vs value-first: incentive ${pct(incRate)} (${positives}/${totalSent}) vs value-first ${pct(vfRate)} (${vfPositive}/${vfSent}) positive-reply rate — leader: ${leader}.`);
  } else {
    actions.push(`A/B incentive vs value-first: gathering — incentive ${positives}/${totalSent}, value-first ${vfPositive}/${vfSent} (need ${MIN_ARM}/arm to call a winner).`);
  }

  // 4. COST watch: surface Apollo lead-pull efficiency so a credit leak can't run silently again.
  const apollo = await apolloEfficiency(workspaceId);
  // 4a. PIPELINE STALL (existential): every recent pull returned 0 new leads, so the fresh pool is
  // starving and sends are collapsing. Name the actual cause from the latest ingest log so the routine
  // can act (out-of-credits = Peter must top up; mined-out = rotate the search; locked = plan/credits).
  if (apollo.stalled) {
    const cause = apollo.creditsOut
      ? "Apollo enrichment is OUT OF CREDITS — only a top-up/upgrade (Peter) unblocks new pulls"
      : apollo.lockedOnly > 0
        ? "Apollo is returning people but their emails are LOCKED — check Apollo plan/email-access credits"
        : `no new leads landing — likely search mined out or 0 matches (rotate the Apollo search). Latest: ${apollo.latestMessage ?? "n/a"}`;
    actions.push(`PIPELINE STALL: ${apollo.pulls} Apollo pulls in 24h, 0 new leads — fresh pool starving, sends collapsing. ${cause}.`);

    // EMERGENCY OPERATOR ALERT (separate from the per-action notify toggle): a fully dark engine
    // (no fresh leads AND nothing sent/recycled in 24h) means zero progress toward demos until a
    // human acts. The only signal today is the twice-daily routine — so an outage can sit unseen for
    // hours. Email the operator directly the moment the engine goes dark, DEDUPED to ~once/20h via a
    // marker activity row so a recurring 6h optimizer run can't spam. Fires regardless of
    // notifyOnActivity because this is an outage, not a routine action.
    const engineDark = sent24 === 0 && freshPool === 0;
    if (engineDark) {
      const to = ws?.notifyEmail ?? ws?.user?.email ?? null;
      const recentAlert = await prisma.activityLog.findFirst({
        where: { workspaceId, type: "autopilot", message: { startsWith: "CRITICAL ALERT:" }, createdAt: { gte: new Date(Date.now() - 20 * 60 * 60 * 1000) } },
        select: { id: true },
      });
      if (to && !recentAlert) {
        const fix = apollo.creditsOut
          ? "Top up / upgrade the Apollo plan to resume new-lead pulls."
          : apollo.lockedOnly > 0
            ? "Apollo emails are locked — check the Apollo plan / email-access credits."
            : "Rotate the Apollo search (likely mined out or 0 matches).";
        await sendNotificationEmail(
          to,
          "[Engine] STALLED — 0 emails sent in 24h, pipeline dark",
          `<p><strong>The outbound engine has gone dark.</strong> 0 emails sent or recycled in the last 24h and the fresh-lead pool is empty, so no new outreach is going out and there is zero progress toward booked demos.</p>` +
          `<p><strong>Cause:</strong> ${cause}.</p>` +
          `<p><strong>Fix:</strong> ${fix}</p>` +
          `<p style="color:#666;font-size:13px">Apollo: ${apollo.pulls} pulls / ${apollo.inserted} new in 24h &middot; freshPool ${freshPool} &middot; sent24 ${sent24} &middot; positives ${positives}/${totalSent}. New pulls resume automatically once the blocker is cleared.</p>`
        ).catch(() => {});
        await logActivity(workspaceId, "autopilot", `CRITICAL ALERT: engine dark (sent24=0, fresh=0) — emailed operator. ${cause}.`);
      }
    }
  }
  if (apollo.leak) {
    actions.push(`COST WARNING: Apollo pulls only ${apollo.yieldPct}% efficient (${apollo.inserted} new vs ${apollo.wasted} wasted on dupes/locked in last ${apollo.pulls} pulls) — credits leaking. Check the page cursor / search; pause pulling if the search is mined out.`);
  }

  const summary = `Optimizer: sent24=${sent24}, bounce=${bounceRate}%, fresh=${freshPool}, positives=${positives}/${totalSent}, cap=${newCap}, apolloYield=${apollo.yieldPct ?? "n/a"}%. ${actions.join("; ") || "no changes"}`;
  await logActivity(workspaceId, "autopilot", summary, { sent24, bounced24, bounceRate, freshPool, positives, totalSent, campaignStatus, dailyCap: newCap, byAmount, byStyle, byGift, valueFirst, headToHead, apollo, actions });
  return { workspaceId, sent24, bounced24, bounceRate, freshPool, positives, totalSent, campaignStatus, dailyCap: newCap, byAmount, byStyle, byGift, valueFirst, headToHead, apollo, actions };
}
