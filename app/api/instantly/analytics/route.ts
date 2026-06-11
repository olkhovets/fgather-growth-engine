import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";

export const dynamic = "force-dynamic";

/**
 * GET /api/instantly/analytics
 * Returns live campaign analytics from Instantly for all sent campaigns in this workspace.
 * Merges with DB records so we have both local metadata and live Instantly numbers.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, instantlyKey: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const ctx = await getInstantlyClientForWorkspaceId(workspace.id);
    if (!ctx) {
      return NextResponse.json({ campaigns: [], message: "No Instantly API key configured." });
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sentCampaigns = await prisma.sentCampaign.findMany({
      where: { workspaceId: workspace.id, createdAt: { gte: since } },
      select: {
        id: true,
        name: true,
        instantlyCampaignId: true,
        createdAt: true,
        variant: true,
        abGroupId: true,
        replies: { select: { classification: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const results = await Promise.allSettled(
      sentCampaigns.map(async (sc) => {
        const analytics = await ctx.client.getCampaignAnalytics(sc.instantlyCampaignId);

        const sent = analytics?.emails_sent_count ?? analytics?.contacted_count ?? 0;
        const opened = analytics?.open_count_unique ?? analytics?.open_count ?? 0;
        const clicked = analytics?.link_click_count_unique ?? analytics?.link_click_count ?? 0;
        const replies = analytics?.reply_count ?? 0;
        const bounced = analytics?.bounced_count ?? 0;
        const unsubscribed = analytics?.unsubscribed_count ?? 0;

        const positiveReplies = sc.replies.filter((r) => r.classification === "positive").length;
        const totalReplies = sc.replies.length;

        return {
          id: sc.id,
          name: sc.name,
          instantlyCampaignId: sc.instantlyCampaignId,
          createdAt: sc.createdAt,
          variant: sc.variant,
          abGroupId: sc.abGroupId,
          metrics: {
            sent,
            opened,
            open_rate_pct: sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
            clicked,
            click_rate_pct: sent > 0 ? Math.round((clicked / sent) * 1000) / 10 : 0,
            replies,
            reply_rate_pct: sent > 0 ? Math.round((replies / sent) * 1000) / 10 : 0,
            bounced,
            bounce_rate_pct: sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0,
            unsubscribed,
            positive_replies: positiveReplies,
            classified_replies: totalReplies,
          },
        };
      })
    );

    const campaigns = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<unknown>).value);

    return NextResponse.json({ campaigns });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
