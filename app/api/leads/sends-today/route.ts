import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Daily send counter for the dashboard. Counts BOTH arms of activity in the last 24h:
 *  - fresh: first-time sends (sentAt in the window)
 *  - recycled: re-contacts (recycledAt in the window) — these never touch sentAt, so the old
 *    autopilot "sent today" stat missed them entirely. This endpoint surfaces them.
 * Pure counts, instant. Session-scoped to the caller's workspace.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const scope = { leadBatch: { workspaceId: ws.id } };
  const [fresh, recycled] = await Promise.all([
    prisma.lead.count({ where: { ...scope, sentAt: { gte: since } } }),
    prisma.lead.count({ where: { ...scope, recycledAt: { gte: since } } }),
  ]);

  return NextResponse.json({ since: since.toISOString(), fresh, recycled, total: fresh + recycled });
}
