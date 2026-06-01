import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";
import { recordCampaignObservations } from "@/lib/performance-memory";

/**
 * Cron: pull Instantly analytics for all recent campaigns and write PerformanceObservations.
 * Scheduled every 6 hours via vercel.json cron.
 * Protected by CRON_SECRET header.
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

  for (const [workspaceId, campaigns] of byWorkspace) {
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

        const open_rate_pct = sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0;
        const click_rate_pct = sent > 0 ? Math.round((clicked / sent) * 1000) / 10 : 0;

        await recordCampaignObservations(workspaceId, sc.id, sc.leadBatchId ?? null, {
          open_rate_pct,
          click_rate_pct,
          reply_count: replies,
        });

        updated++;
      } catch (err) {
        failed++;
        errors.push(`${sc.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // After pulling analytics, run the A/B decision agent on all active groups
  try {
    const baseUrl = process.env.NEXTJS_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    await fetch(`${baseUrl}/api/optimize/step`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
  } catch {
    // non-fatal — analytics are recorded even if optimizer fails
  }

  return NextResponse.json({
    updated,
    failed,
    total: sentCampaigns.length,
    ...(errors.length > 0 ? { errors: errors.slice(0, 10) } : {}),
    message: `Analytics refreshed for ${updated} campaigns.`,
  });
}
