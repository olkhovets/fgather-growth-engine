import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForUserId } from "@/lib/instantly";
import { recordCampaignObservations } from "@/lib/performance-memory";

export const dynamic = "force-dynamic";

/** GET: Fetch analytics for a sent campaign (by our SentCampaign id). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Campaign id required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const sent = await prisma.sentCampaign.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true, leadBatchId: true, instantlyCampaignId: true },
    });
    if (!sent) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured" },
        { status: 400 }
      );
    }

    const analytics = await ctx.client.getCampaignAnalytics(sent.instantlyCampaignId);
    if (!analytics) {
      return NextResponse.json({
        noData: true,
        campaign_id: sent.instantlyCampaignId,
        emails_sent_count: 0,
        open_count: 0,
        link_click_count: 0,
        open_rate_pct: 0,
        click_rate_pct: 0,
        reply_count: 0,
        bounced_count: 0,
        contacted_count: 0,
        leads_count: 0,
      });
    }

    const sentCount = analytics.emails_sent_count ?? 0;
    const opens = analytics.open_count_unique ?? analytics.open_count ?? 0;
    const clicks = analytics.link_click_count_unique ?? analytics.link_click_count ?? 0;
    const openRate = sentCount > 0 ? Math.round((opens / sentCount) * 100) : 0;
    const clickRate = sentCount > 0 ? Math.round((clicks / sentCount) * 100) : 0;
    const replyCount = analytics.reply_count ?? 0;

    await recordCampaignObservations(workspace.id, sent.id, sent.leadBatchId ?? null, {
      open_rate_pct: openRate,
      click_rate_pct: clickRate,
      reply_count: replyCount,
    }).catch(() => {});

    return NextResponse.json({
      campaign_id: analytics.campaign_id,
      campaign_name: analytics.campaign_name,
      campaign_status: analytics.campaign_status,
      emails_sent_count: sentCount,
      open_count: opens,
      link_click_count: clicks,
      open_rate_pct: openRate,
      click_rate_pct: clickRate,
      reply_count: analytics.reply_count,
      bounced_count: analytics.bounced_count,
      contacted_count: analytics.contacted_count,
      leads_count: analytics.leads_count,
      suggestion: openRate < 15 && sentCount > 20 && opens > 0
        ? "Try testing a different subject line to improve open rate."
        : openRate === 0 && sentCount > 0
          ? "Open rate is 0%. Many tools don't track opens on the first email for deliverability, so this may not mean no one opened."
          : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch analytics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
