import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";
import { recordCampaignObservations } from "@/lib/performance-memory";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Cron: pull Instantly analytics for all recent campaigns and write PerformanceObservations.
 * Scheduled once daily (13:00 UTC ≈ 8am ET) via vercel.json cron. Vercel's Hobby
 * plan caps crons at once per day; move to a tighter cadence on the Pro plan.
 * Protected by CRON_SECRET header (Vercel auto-sends it as the Authorization bearer
 * for scheduled invocations once CRON_SECRET is set as a project env var). The same
 * secret is forwarded to the optimizer fan-out below — without it those routes 401.
 * After pulling analytics, automatically triggers the A/B decision agent.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

  const sentCampaigns = await prisma.sentCampaign.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true,
      workspaceId: true,
      instantlyCampaignId: true,
      leadBatchId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (sentCampaigns.length === 0) {
    return NextResponse.json({ updated: 0, message: "No recent campaigns to update." });
  }

  // Group by workspace to reuse the same Instantly client per workspace
  const byWorkspace = new Map<string, typeof sentCampaigns>();
  for (const sc of sentCampaigns) {
    const list = byWorkspace.get(sc.workspaceId) ?? [];
    list.push(sc);
    byWorkspace.set(sc.workspaceId, list);
  }

  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const [workspaceId, campaigns] of Array.from(byWorkspace.entries())) {
    const ctx = await getInstantlyClientForWorkspaceId(workspaceId);
    if (!ctx) continue;
    const { client } = ctx;

    for (const sc of campaigns) {
      try {
        const analytics = await client.getCampaignAnalytics(sc.instantlyCampaignId);
        if (!analytics) continue;

        const sent = analytics.emails_sent_count ?? analytics.contacted_count ?? 0;
        const opened = analytics.open_count_unique ?? analytics.open_count ?? 0;
        const clicked = analytics.link_click_count_unique ?? analytics.link_click_count ?? 0;
        const replies = analytics.reply_count ?? 0;
        const bounced = analytics.bounced_count ?? 0;
        const unsubscribed = analytics.unsubscribed_count ?? 0;

        const open_rate_pct = sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0;
        const click_rate_pct = sent > 0 ? Math.round((clicked / sent) * 1000) / 10 : 0;
        const bounce_rate_pct = sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0;
        const unsubscribe_rate_pct = sent > 0 ? Math.round((unsubscribed / sent) * 1000) / 10 : 0;

        await recordCampaignObservations(workspaceId, sc.id, sc.leadBatchId ?? null, {
          open_rate_pct,
          click_rate_pct,
          reply_count: replies,
          bounce_rate_pct,
          unsubscribe_rate_pct,
        });

        // Log to activity so operator can see analytics pull in the activity feed
        if (sent > 0) {
          await logActivity(workspaceId, "info",
            `Analytics refreshed: "${analytics.campaign_name}" — ${sent} sent, ${open_rate_pct}% open, ${replies} replies${bounced > 0 ? `, ${bounced} bounced` : ""}`,
            { sent, opened, open_rate_pct, click_rate_pct, replies, bounced, bounce_rate_pct, unsubscribed, instantlyCampaignId: sc.instantlyCampaignId }
          );
        }

        updated++;
      } catch (err) {
        failed++;
        errors.push(`${sc.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Classify inbox provider (MX) for any sent leads not yet classified — bounded per run
  // so it never risks the function timeout; backfills steadily over a few runs.
  try {
    const { classifyEmailProviders } = await import("@/lib/email-provider");
    const toClassify = await prisma.lead.findMany({
      where: { sentAt: { not: null }, emailProvider: null },
      select: { id: true, email: true },
      take: 1500,
    });
    if (toClassify.length > 0) {
      const providers = await classifyEmailProviders(toClassify.map((l) => l.email));
      // Group by provider and update in bulk.
      const byProvider = new Map<string, string[]>();
      for (const l of toClassify) {
        const p = providers[l.email] ?? "Unknown";
        (byProvider.get(p) ?? byProvider.set(p, []).get(p)!).push(l.id);
      }
      for (const [provider, ids] of Array.from(byProvider.entries())) {
        await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { emailProvider: provider } });
      }
    }
  } catch {
    // best-effort
  }

  // After pulling analytics, run the optimization agents on all active workspaces:
  //  1. A/B decision agent (route remaining leads to winners)
  //  2. Variant evaluator (promote/kill message experiments, fold winners into learnings, refill)
  //  3. Variant generator (top up active experiments so there's always something being tested)
  // Use the open production alias, never VERCEL_URL (the immutable per-deploy URL is
  // guarded by Deployment Protection and 401s these internal calls).
  const baseUrlEnv = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
  const baseUrl = baseUrlEnv && baseUrlEnv.startsWith("http")
    ? baseUrlEnv.replace(/\/$/, "")
    : "https://peter-engine-working-copy.vercel.app";
  const authHeaders: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};
  // Daily pipeline: Apollo ingest → server-side iterator (bounce>5% throttle / scale-when-clean
  // / resume-paused guardrail, run BEFORE sending so a high-bounce campaign is throttled before
  // more volume goes out) → autopilot (generate+send for autopilot workspaces) → optimization
  // agents (A/B routing, experiment evaluate/generate). Including /optimize/iterate here keeps the
  // deliverability guardrail running autonomously even when the external operator routine can't
  // reach the host (e.g. network egress restrictions on the scheduled runner).
  for (const path of ["/api/apollo/ingest", "/api/optimize/iterate", "/api/orchestrate/run", "/api/optimize/step", "/api/optimize/variants/evaluate", "/api/optimize/variants/generate"]) {
    try {
      await fetch(`${baseUrl}${path}`, { headers: authHeaders });
    } catch {
      // non-fatal — analytics are recorded even if an optimizer step fails
    }
  }

  return NextResponse.json({
    updated,
    failed,
    total: sentCampaigns.length,
    ...(errors.length > 0 ? { errors: errors.slice(0, 10) } : {}),
    message: `Analytics refreshed for ${updated} campaigns.`,
  });
}
