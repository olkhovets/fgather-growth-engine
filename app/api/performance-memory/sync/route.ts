import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForUserId } from "@/lib/instantly";
import { recordCampaignObservations } from "@/lib/performance-memory";

export const dynamic = "force-dynamic";

/**
 * POST: Sync analytics from Instantly for all sent campaigns.
 * Fetches opens/clicks/replies and records into performance memory.
 * Call on dashboard load so we learn from data without requiring users to click into each campaign.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json({ synced: 0, message: "Instantly API key not configured" }, { status: 200 });
    }

    const sentCampaigns = await prisma.sentCampaign.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, leadBatchId: true, instantlyCampaignId: true },
    });

    let synced = 0;
    for (const sent of sentCampaigns) {
      if (!sent.instantlyCampaignId) continue;
      try {
        const analytics = await ctx.client.getCampaignAnalytics(sent.instantlyCampaignId);
        if (!analytics) continue;
        const sentCount = analytics.emails_sent_count ?? 0;
        const opens = analytics.open_count_unique ?? analytics.open_count ?? 0;
        const clicks = analytics.link_click_count_unique ?? analytics.link_click_count ?? 0;
        const openRate = sentCount > 0 ? Math.round((opens / sentCount) * 100) : 0;
        const clickRate = sentCount > 0 ? Math.round((clicks / sentCount) * 100) : 0;
        const replyCount = analytics.reply_count ?? 0;
        await recordCampaignObservations(workspace.id, sent.id, sent.leadBatchId, {
          open_rate_pct: openRate,
          click_rate_pct: clickRate,
          reply_count: replyCount,
        });
        synced++;
      } catch {
        // skip failed campaigns
      }
    }

    return NextResponse.json({ synced, total: sentCampaigns.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
