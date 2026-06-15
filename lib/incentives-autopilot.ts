import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { decrypt } from "@/lib/encryption";
import { ingestForWorkspace, loadSearch } from "@/lib/apollo-ingest";

// Internal calls must hit the open production alias, NOT VERCEL_URL (deployment-protected → 401).
const baseUrl = () => {
  const u = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
  if (u && u.startsWith("http")) return u.replace(/\/$/, "");
  return "https://peter-engine-working-copy.vercel.app";
};

const FRESH_THRESHOLD = 200;   // pull more leads when the fresh pool drops below this
const INGEST_THROTTLE_MIN = 20; // re-pull Apollo at most every 20 min (keeps supply ahead of a ~600/hr send pace)
const INGEST_LIMIT = 200;       // per-pull size; no-gateways-filtered pulls scan more pages, so keep
                                // it modest to stay within the function budget (~200/20min ≈ 600/hr)

/**
 * Hands-off Incentives Lab pipeline for one workspace, PACED by the workspace's settings
 * (incentivesPerRun / incentivesIntervalMin / incentivesDailyCap):
 *   0. Respect the min interval between runs and the daily cap.
 *   1. If the fresh-lead pool is low (and Apollo is configured + not pulled recently), pull more.
 *   2. Append up to `perRun` fresh unsent leads into the rolling Incentives Lab campaign.
 * Self-replenishing and append-only — never re-contacts already-sent leads.
 */
export async function runIncentivesAutopilotForWorkspace(
  ws: { id: string },
  secret: string
): Promise<Record<string, unknown>> {
  try {
    const cfg = await prisma.workspace.findUnique({
      where: { id: ws.id },
      select: { apolloApiKey: true, incentivesPerRun: true, incentivesIntervalMin: true, incentivesDailyCap: true, incentivesLastRunAt: true },
    });
    const perRun = cfg?.incentivesPerRun ?? 50;
    const intervalMin = cfg?.incentivesIntervalMin ?? 30;
    const dailyCap = cfg?.incentivesDailyCap ?? 500;

    // 0a. Pace: skip if we ran too recently.
    if (cfg?.incentivesLastRunAt && Date.now() - cfg.incentivesLastRunAt.getTime() < intervalMin * 60 * 1000) {
      const waitMin = Math.ceil((intervalMin * 60 * 1000 - (Date.now() - cfg.incentivesLastRunAt.getTime())) / 60000);
      return { workspaceId: ws.id, skipped: `interval (next run in ~${waitMin} min)` };
    }
    // 0b. Daily cap: count what's already gone out today, leave the rest for tomorrow.
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const sentToday = await prisma.lead.count({
      where: { leadBatch: { workspaceId: ws.id }, incentiveAmount: { not: null }, sentAt: { gte: startOfDay } },
    });
    const remainingToday = dailyCap - sentToday;
    if (remainingToday <= 0) return { workspaceId: ws.id, skipped: `daily cap reached (${sentToday}/${dailyCap})` };
    const thisRunLimit = Math.min(perRun, remainingToday);

    // Stamp the run NOW (before the slow ingest/append) so overlapping cron ticks serialize on the
    // interval check above, instead of both pulling Apollo or both appending.
    await prisma.workspace.update({ where: { id: ws.id }, data: { incentivesLastRunAt: new Date() } });

    // 1. Replenish leads when running low. ALL-PROVIDERS mode (operator chose volume over the
    //    deliverability filter), so every fresh lead is sendable — count them all.
    const PROVIDER = "all" as const;
    const freshCount = await prisma.lead.count({
      where: { leadBatch: { workspaceId: ws.id }, sentAt: null, suppressed: false, repliedAt: null, email: { not: "" } },
    });

    let ingested = 0;
    if (freshCount < FRESH_THRESHOLD) {
      const lastApollo = await prisma.leadBatch.findFirst({
        where: { workspaceId: ws.id, name: { startsWith: "Apollo" } },
        orderBy: { createdAt: "desc" }, select: { createdAt: true },
      });
      const longEnough = !lastApollo || Date.now() - lastApollo.createdAt.getTime() > INGEST_THROTTLE_MIN * 60 * 1000;
      const search = await loadSearch(ws.id);
      // All-providers pull: more new people per pull (no provider drop), and they're all sendable.
      // Pull the FULL variety of titles in the saved search (don't narrow to one persona) — Peter
      // wants great B2C people across all the titles. Each lead is tagged by its ACTUAL title into a
      // persona bucket inside ingestForWorkspace, so we keep variety AND get per-persona tagging.
      if (search) search.providerFilter = PROVIDER;
      if (cfg?.apolloApiKey && search && longEnough) {
        const r = await ingestForWorkspace(ws.id, decrypt(cfg.apolloApiKey), search, INGEST_LIMIT, process.env.ZEROBOUNCE_API_KEY ?? null);
        ingested = r.inserted;
      }
    }

    // 2. Append up to thisRunLimit fresh leads into the rolling campaign (workspace-wide, saved config).
    const res = await fetch(`${baseUrl()}/api/incentives/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": secret },
      body: JSON.stringify({ workspaceId: ws.id, sendLimit: thisRunLimit, providerFilter: PROVIDER, warmedInboxesOnly: true }),
    });
    const launch = await res.json().catch(() => ({} as Record<string, unknown>));
    const appended = (launch.totalUploaded as number) ?? 0;
    const launchError = typeof launch.error === "string" ? launch.error : null;
    const distribution = Array.isArray(launch.distribution) ? launch.distribution : [];

    // RECYCLE FALLBACK: if there were no fresh leads to append, re-contact the oldest non-repliers
    // (past the cooldown) with the current credentialed emails, into a separate recycle campaign.
    let recycled = 0;
    if (appended === 0) {
      const rres = await fetch(`${baseUrl()}/api/incentives/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": secret },
        body: JSON.stringify({ workspaceId: ws.id, sendLimit: thisRunLimit, providerFilter: PROVIDER, warmedInboxesOnly: true, recycle: true }),
      });
      const rl = await rres.json().catch(() => ({} as Record<string, unknown>));
      recycled = (rl.totalUploaded as number) ?? 0;
    }

    await logActivity(ws.id, "autopilot",
      `Incentives autopilot: pulled ${ingested}, appended ${appended}${recycled ? `, recycled ${recycled}` : ""}/${thisRunLimit} (${sentToday + appended}/${dailyCap} today)${launchError && !recycled ? ` (issue: ${launchError})` : ""}`,
      { incentives: true, ingested, appended, recycled, thisRunLimit, sentToday: sentToday + appended, dailyCap, mode: launch.mode, distribution, launchError, freshBefore: freshCount });
    return { workspaceId: ws.id, ingested, appended, recycled, sentToday: sentToday + appended, dailyCap, mode: launch.mode, distribution, launchError };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "incentives autopilot failed";
    await logActivity(ws.id, "autopilot", `Incentives autopilot failed: ${msg}`).catch(() => {});
    return { workspaceId: ws.id, error: msg };
  }
}
