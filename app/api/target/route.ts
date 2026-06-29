import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeReplyTarget } from "@/lib/reply-target";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The reply-rate war room: current rate, gap to 2%, the binding constraint, and the ordered levers.
 * Dual auth (session or CRON_SECRET) so `engine.sh target` can read it. Read-only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  // Read-only war room: accept CRON_SECRET (bearer) OR the SNAPSHOT_KEY (?key=) so it works with the
  // same key as `status`, OR an operator session.
  const snapKey = process.env.SNAPSHOT_KEY;
  const providedKey = bearer || url.searchParams.get("key") || "";
  const viaCron = (!!secret && providedKey === secret) || (!!snapKey && providedKey === snapKey);

  let workspaceId: string | null = null;
  if (viaCron) {
    const wsId = url.searchParams.get("workspaceId");
    const ws = wsId ? await prisma.workspace.findUnique({ where: { id: wsId }, select: { id: true } }) : await prisma.workspace.findFirst({ select: { id: true } });
    workspaceId = ws?.id ?? null;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    workspaceId = ws?.id ?? null;
  }
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  return NextResponse.json(await computeReplyTarget(workspaceId));
}
