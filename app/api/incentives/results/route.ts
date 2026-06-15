import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Per-amount results for the Incentives Lab: sent, replies, positive, reply rate. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const [sentRows, replyRows] = await Promise.all([
    prisma.lead.groupBy({
      by: ["incentiveAmount"],
      where: { leadBatch: { workspaceId: ws.id }, incentiveAmount: { not: null }, sentAt: { not: null } },
      _count: true,
    }),
    prisma.lead.groupBy({
      by: ["incentiveAmount", "replyStatus"],
      where: { leadBatch: { workspaceId: ws.id }, incentiveAmount: { not: null }, replyStatus: { not: null } },
      _count: true,
    }),
  ]);

  const map: Record<number, { amount: number; sent: number; replies: number; positive: number; ooo: number }> = {};
  for (const r of sentRows) {
    const amt = r.incentiveAmount as number;
    map[amt] = { amount: amt, sent: r._count, replies: 0, positive: 0, ooo: 0 };
  }
  for (const r of replyRows) {
    const amt = r.incentiveAmount as number;
    if (!map[amt]) map[amt] = { amount: amt, sent: 0, replies: 0, positive: 0, ooo: 0 };
    map[amt].replies += r._count;
    if (r.replyStatus === "positive") map[amt].positive += r._count;
    if (r.replyStatus === "ooo") map[amt].ooo += r._count;
  }

  const amounts = Object.values(map)
    .map((m) => ({
      ...m,
      realReplies: m.replies - m.ooo,
      replyRatePct: m.sent > 0 ? Math.round(((m.replies - m.ooo) / m.sent) * 1000) / 10 : 0,
      positiveRatePct: m.sent > 0 ? Math.round((m.positive / m.sent) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.amount - b.amount);

  // Same breakdown but by subject style.
  const [sStyleSent, sStyleReply] = await Promise.all([
    prisma.lead.groupBy({ by: ["incentiveSubjectStyle"], where: { leadBatch: { workspaceId: ws.id }, incentiveSubjectStyle: { not: null }, sentAt: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: ["incentiveSubjectStyle", "replyStatus"], where: { leadBatch: { workspaceId: ws.id }, incentiveSubjectStyle: { not: null }, replyStatus: { not: null } }, _count: true }),
  ]);
  const smap: Record<string, { style: string; sent: number; replies: number; positive: number; ooo: number }> = {};
  for (const r of sStyleSent) { const k = r.incentiveSubjectStyle as string; smap[k] = { style: k, sent: r._count, replies: 0, positive: 0, ooo: 0 }; }
  for (const r of sStyleReply) { const k = r.incentiveSubjectStyle as string; if (!smap[k]) smap[k] = { style: k, sent: 0, replies: 0, positive: 0, ooo: 0 }; smap[k].replies += r._count; if (r.replyStatus === "positive") smap[k].positive += r._count; if (r.replyStatus === "ooo") smap[k].ooo += r._count; }
  const styles = Object.values(smap).map((m) => ({ ...m, realReplies: m.replies - m.ooo, replyRatePct: m.sent > 0 ? Math.round(((m.replies - m.ooo) / m.sent) * 1000) / 10 : 0 })).sort((a, b) => b.realReplies - a.realReplies);

  // Same breakdown by GIFT TYPE (third A/B dimension).
  const [gSent, gReply] = await Promise.all([
    prisma.lead.groupBy({ by: ["incentiveGiftType"], where: { leadBatch: { workspaceId: ws.id }, incentiveGiftType: { not: null }, sentAt: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: ["incentiveGiftType", "replyStatus"], where: { leadBatch: { workspaceId: ws.id }, incentiveGiftType: { not: null }, replyStatus: { not: null } }, _count: true }),
  ]);
  const gmap: Record<string, { gift: string; sent: number; replies: number; positive: number; ooo: number }> = {};
  for (const r of gSent) { const k = r.incentiveGiftType as string; gmap[k] = { gift: k, sent: r._count, replies: 0, positive: 0, ooo: 0 }; }
  for (const r of gReply) { const k = r.incentiveGiftType as string; if (!gmap[k]) gmap[k] = { gift: k, sent: 0, replies: 0, positive: 0, ooo: 0 }; gmap[k].replies += r._count; if (r.replyStatus === "positive") gmap[k].positive += r._count; if (r.replyStatus === "ooo") gmap[k].ooo += r._count; }
  const gifts = Object.values(gmap).map((m) => ({ ...m, realReplies: m.replies - m.ooo, replyRatePct: m.sent > 0 ? Math.round(((m.replies - m.ooo) / m.sent) * 1000) / 10 : 0 })).sort((a, b) => b.realReplies - a.realReplies);

  return NextResponse.json({ amounts, styles, gifts });
}
