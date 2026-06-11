import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Reply/bounce performance by inbox provider (Google / Microsoft / Yahoo / Other). The
 * Jungler CAC article found provider was a major hidden variable — and for our deliverability
 * concerns, this reveals if (e.g.) Microsoft/365 inboxes are silently eating our sends.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const wsId = ws.id;

  const [sentRows, replyRows, bounceRows, unclassified] = await Promise.all([
    prisma.lead.groupBy({ by: ["emailProvider"], where: { leadBatch: { workspaceId: wsId }, sentAt: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: ["emailProvider", "replyStatus"], where: { leadBatch: { workspaceId: wsId }, sentAt: { not: null }, replyStatus: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: ["emailProvider"], where: { leadBatch: { workspaceId: wsId }, bouncedAt: { not: null } }, _count: true }),
    prisma.lead.count({ where: { leadBatch: { workspaceId: wsId }, sentAt: { not: null }, emailProvider: null } }),
  ]);

  const map: Record<string, { provider: string; sent: number; replies: number; positive: number; ooo: number; bounced: number }> = {};
  const get = (k: string | null) => { const key = k ?? "Unclassified"; return (map[key] ||= { provider: key, sent: 0, replies: 0, positive: 0, ooo: 0, bounced: 0 }); };
  for (const r of sentRows) get(r.emailProvider).sent = r._count;
  for (const r of bounceRows) get(r.emailProvider).bounced = r._count;
  for (const r of replyRows) {
    const m = get(r.emailProvider);
    m.replies += r._count;
    if (r.replyStatus === "positive") m.positive += r._count;
    if (r.replyStatus === "ooo") m.ooo += r._count;
  }

  const providers = Object.values(map)
    .map((m) => ({
      ...m,
      realReplies: m.replies - m.ooo,
      replyRatePct: m.sent > 0 ? Math.round(((m.replies - m.ooo) / m.sent) * 1000) / 10 : 0,
      positiveRatePct: m.sent > 0 ? Math.round((m.positive / m.sent) * 1000) / 10 : 0,
      bounceRatePct: m.sent > 0 ? Math.round((m.bounced / m.sent) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.sent - a.sent);

  return NextResponse.json({ providers, unclassified });
}
