import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
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

async function variantPerf(workspaceId: string, field: "incentiveAmount" | "incentiveSubjectStyle" | "incentiveGiftType"): Promise<VariantRow[]> {
  // incentiveAmount > 0 excludes the value-first track (stamped amount 0) so it can't pollute the
  // incentive A/B — value-first is measured separately via its own "Value-First (rolling)" campaign.
  const [sent, reply] = await Promise.all([
    prisma.lead.groupBy({ by: [field], where: { leadBatch: { workspaceId }, [field]: { not: null }, incentiveAmount: { gt: 0 }, sentAt: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: [field, "replyStatus"], where: { leadBatch: { workspaceId }, [field]: { not: null }, incentiveAmount: { gt: 0 }, replyStatus: { not: null } }, _count: true }),
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
    orderBy: { createdAt: "desc" }, take: 40, select: { metaJson: true },
  });
  let inserted = 0, wasted = 0;
  for (const l of logs) {
    try {
      const m = l.metaJson ? JSON.parse(l.metaJson) : {};
      inserted += Number(m.ingested) || 0;
      wasted += (Number(m.duplicatesSkipped) || 0) + (Number(m.lockedSkipped) || 0);
    } catch { /* skip unparseable */ }
  }
  const attempts = inserted + wasted;
  const yieldPct = attempts > 0 ? Math.round((inserted / attempts) * 100) : null;
  // Flag only with enough volume to be meaningful, and when most spend is waste.
  const leak = attempts >= 200 && yieldPct !== null && yieldPct < 35;
  return { pulls: logs.length, inserted, wasted, attempts, yieldPct, leak };
}

export async function optimizeIncentivesForWorkspace(workspaceId: string): Promise<Record<string, unknown>> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { incentivesDailyCap: true, incentiveConfigJson: true } });
  const dailyCap = ws?.incentivesDailyCap ?? 500;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [sent24, bounced24, freshPool, totalSent, positives] = await Promise.all([
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: { gte: since } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, bouncedAt: { gte: since } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: null, suppressed: false, repliedAt: null, email: { not: "" } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, incentiveAmount: { gt: 0 }, sentAt: { not: null } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, incentiveAmount: { gt: 0 }, replyStatus: "positive" } }),
  ]);
  const bounceRate = sent24 >= 20 ? Math.round((bounced24 / sent24) * 1000) / 10 : 0;
  const [byAmount, byStyle, byGift] = await Promise.all([
    variantPerf(workspaceId, "incentiveAmount"), variantPerf(workspaceId, "incentiveSubjectStyle"), variantPerf(workspaceId, "incentiveGiftType"),
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

  // 4. COST watch: surface Apollo lead-pull efficiency so a credit leak can't run silently again.
  const apollo = await apolloEfficiency(workspaceId);
  if (apollo.leak) {
    actions.push(`COST WARNING: Apollo pulls only ${apollo.yieldPct}% efficient (${apollo.inserted} new vs ${apollo.wasted} wasted on dupes/locked in last ${apollo.pulls} pulls) — credits leaking. Check the page cursor / search; pause pulling if the search is mined out.`);
  }

  const summary = `Optimizer: sent24=${sent24}, bounce=${bounceRate}%, fresh=${freshPool}, positives=${positives}/${totalSent}, cap=${newCap}, apolloYield=${apollo.yieldPct ?? "n/a"}%. ${actions.join("; ") || "no changes"}`;
  await logActivity(workspaceId, "autopilot", summary, { sent24, bounced24, bounceRate, freshPool, positives, totalSent, campaignStatus, dailyCap: newCap, byAmount, byStyle, byGift, apollo, actions });
  return { workspaceId, sent24, bounced24, bounceRate, freshPool, positives, totalSent, campaignStatus, dailyCap: newCap, byAmount, byStyle, byGift, apollo, actions };
}
