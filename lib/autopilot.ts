import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

// Internal server-to-server calls MUST hit the public production alias, which is open.
// NOT process.env.VERCEL_URL — that's the immutable per-deploy URL, which Vercel
// Deployment Protection guards with a 401 "Authentication Required" page, silently
// breaking the whole generate→send pipeline. Prefer explicit env, else the known alias.
const baseUrl = () => {
  const u = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
  if (u && u.startsWith("http")) return u.replace(/\/$/, "");
  return "https://peter-engine-working-copy.vercel.app";
};

/**
 * Run the hands-off pipeline once for a single workspace:
 *   1. Find a batch with leads still needing sequences + a destination campaign.
 *   2. Generate sequences for up to `maxGenerate` fresh leads (10 per call).
 *   3. Send (append) them into the latest live Instantly campaign, or create one.
 * Reuses the real generate/send endpoints, authed internally with CRON_SECRET.
 */
export async function runAutopilotForWorkspace(
  ws: { id: string; autopilotDailyLimit: number | null },
  secret: string,
  maxGenerate?: number
): Promise<Record<string, unknown>> {
  const dailyLimit = ws.autopilotDailyLimit ?? 200;
  const genCap = Math.min(dailyLimit, maxGenerate ?? dailyLimit);
  try {
    const batch = await prisma.lead.findFirst({
      where: {
        leadBatch: { workspaceId: ws.id },
        sentAt: null, suppressed: false, repliedAt: null,
        OR: [{ stepsJson: null }, { stepsJson: "" }, { stepsJson: "[]" }],
      },
      select: { leadBatchId: true },
      orderBy: { id: "asc" },
    });
    const campaign = await prisma.campaign.findFirst({
      where: { workspaceId: ws.id, playbookJson: { not: null } },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });
    const liveInstantly = await prisma.sentCampaign.findFirst({
      where: { workspaceId: ws.id },
      select: { instantlyCampaignId: true },
      orderBy: { createdAt: "desc" },
    });

    const cronHeaders = { "Content-Type": "application/json", "x-cron-secret": secret };
    const url = baseUrl();

    // 1. Generate sequences for leads that still need them (if any).
    // Generation is ~25-30s per 10-lead chunk (5 Claude calls each). The serverless
    // function caps at 60s, so we time-budget generation to ~25s (≈1 chunk) and leave
    // headroom for the send call. Volume comes from frequent runs (external cron), not
    // from cramming many chunks into one run — that just times out and commits nothing.
    const GEN_BUDGET_MS = 25_000;
    const genStart = Date.now();
    let generated = 0;
    let genDiag: { status: number; error: string | null } | null = null;
    if (batch?.leadBatchId) {
      while (generated < genCap && Date.now() - genStart < GEN_BUDGET_MS) {
        const res = await fetch(`${url}/api/leads/generate`, {
          method: "POST", headers: cronHeaders,
          body: JSON.stringify({
            batchId: batch.leadBatchId, useFastModel: true, workspaceId: ws.id,
            ...(campaign?.id ? { campaignId: campaign.id } : {}),
          }),
        });
        // Read as text first so a non-JSON platform error (500/504 HTML) is still captured.
        const text = await res.text();
        let d: { done?: number; error?: string } = {};
        try { d = JSON.parse(text); } catch { /* non-JSON */ }
        const done = d.done ?? 0;
        if ((done === 0 || !res.ok) && !genDiag) {
          const detail = typeof d.error === "string" ? d.error : text.slice(0, 160).replace(/\s+/g, " ").trim();
          genDiag = { status: res.status, error: detail || `HTTP ${res.status}` };
        }
        generated += done;
        if (done === 0 || !res.ok) break;
      }
    }

    // 2. Send the ready (generated, unsent) backlog — independent of whether anything
    //    was generated THIS run. Previously sending only happened when generated>0, so a
    //    fully-generated backlog never got posted. Find any batch with ready leads.
    const readyLead = await prisma.lead.findFirst({
      where: {
        leadBatch: { workspaceId: ws.id }, sentAt: null, suppressed: false, repliedAt: null,
        AND: [{ stepsJson: { not: null } }, { stepsJson: { not: "" } }, { stepsJson: { not: "[]" } }],
      },
      select: { leadBatchId: true },
      orderBy: { id: "asc" },
    });

    // DELIVERABILITY GUARDRAIL: pause sending if the recent bounce rate is dangerously
    // high. High bounces on a 300-inbox setup get domains blocklisted and kill all replies.
    // Generation keeps going (harmless, builds backlog); sends resume once bounces drop.
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [sentRecent, bouncedRecent] = await Promise.all([
      prisma.lead.count({ where: { leadBatch: { workspaceId: ws.id }, sentAt: { gte: since24 } } }),
      prisma.lead.count({ where: { leadBatch: { workspaceId: ws.id }, bouncedAt: { gte: since24 } } }),
    ]);
    const BOUNCE_THRESHOLD = 5; // %
    const bounceRate = sentRecent >= 20 ? Math.round((bouncedRecent / sentRecent) * 1000) / 10 : 0;
    const throttled = bounceRate > BOUNCE_THRESHOLD;

    let sendResult: Record<string, unknown> = {};
    if (throttled) {
      await logActivity(ws.id, "info",
        `⚠ Sending paused: bounce rate ${bounceRate}% (${bouncedRecent}/${sentRecent} in 24h) exceeds ${BOUNCE_THRESHOLD}%. Protecting deliverability — sends resume automatically once bounces drop. Check inbox warmup.`,
        { bounceRate, bouncedRecent, sentRecent, threshold: BOUNCE_THRESHOLD });
    } else if (readyLead?.leadBatchId) {
      const sendRes = await fetch(`${url}/api/instantly/send`, {
        method: "POST", headers: cronHeaders,
        body: JSON.stringify({
          batchId: readyLead.leadBatchId, workspaceId: ws.id, skipFailingLeads: true, skipRamp: true,
          sendLimit: dailyLimit,
          ...(campaign?.id ? { campaignId: campaign.id } : {}),
          ...(liveInstantly?.instantlyCampaignId
            ? { addToInstantlyCampaignId: liveInstantly.instantlyCampaignId }
            : { campaignName: `Autopilot ${new Date().toISOString().slice(0, 10)}` }),
        }),
      });
      sendResult = await sendRes.json().catch(() => ({}));
    }

    if (!batch?.leadBatchId && !readyLead?.leadBatchId && !throttled) {
      return { workspaceId: ws.id, skipped: "no leads need generating or sending" };
    }

    const sent = (sendResult.leads_uploaded as number) ?? 0;
    const sendError = typeof sendResult.error === "string" ? sendResult.error : (throttled ? `throttled: bounce rate ${bounceRate}%` : null);
    await logActivity(ws.id, "autopilot",
      `Autopilot run: generated ${generated}, sent ${sent}${genDiag?.error ? ` (gen issue: ${genDiag.error})` : ""}${sendError ? ` (send issue: ${sendError})` : ""}`,
      { generated, sent, genDiag, sendError, appended: Boolean(liveInstantly?.instantlyCampaignId) });
    return { workspaceId: ws.id, generated, sent, genDiag, sendError, throttled, bounceRate };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "autopilot failed";
    await logActivity(ws.id, "autopilot", `Autopilot run failed: ${msg}`).catch(() => {});
    return { workspaceId: ws.id, error: msg };
  }
}
