import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Per-wildcard-approach performance: how many were sent on each radical approach and how
 * they replied. This is the "did any wild swing break through" readout — the thing you
 * watch when the standard approach is at zero.
 */
export async function GET() {
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
    const wsId = workspace.id;

    const [sentRows, replyRows] = await Promise.all([
      prisma.lead.groupBy({
        by: ["wildcardApproach"],
        where: { leadBatch: { workspaceId: wsId }, wildcardApproach: { not: null }, sentAt: { not: null } },
        _count: true,
      }),
      prisma.lead.groupBy({
        by: ["wildcardApproach", "replyStatus"],
        where: { leadBatch: { workspaceId: wsId }, wildcardApproach: { not: null }, replyStatus: { not: null } },
        _count: true,
      }),
    ]);

    const map: Record<string, { approach: string; sent: number; replies: number; positive: number; ooo: number }> = {};
    for (const r of sentRows) {
      const a = r.wildcardApproach as string;
      map[a] = { approach: a, sent: r._count, replies: 0, positive: 0, ooo: 0 };
    }
    for (const r of replyRows) {
      const a = r.wildcardApproach as string;
      if (!map[a]) map[a] = { approach: a, sent: 0, replies: 0, positive: 0, ooo: 0 };
      map[a].replies += r._count;
      if (r.replyStatus === "positive") map[a].positive += r._count;
      if (r.replyStatus === "ooo") map[a].ooo += r._count;
    }

    const approaches = Object.values(map)
      .map((m) => ({
        ...m,
        // OOO is an auto-reply, not real interest — exclude it from the "real reply" rate.
        realReplies: m.replies - m.ooo,
        replyRatePct: m.sent > 0 ? Math.round(((m.replies - m.ooo) / m.sent) * 1000) / 10 : 0,
        positiveRatePct: m.sent > 0 ? Math.round((m.positive / m.sent) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.positive - a.positive || b.realReplies - a.realReplies || b.sent - a.sent);

    return NextResponse.json({ approaches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load wildcard stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
