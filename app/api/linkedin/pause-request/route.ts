import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Operator clicks "Pause" on the Results budget table → this queues the request.
 * The server can't pause LinkedIn ads itself (no LinkedIn session), so the queued
 * request is picked up and executed by the extension (which has the session) next
 * time its dashboard is open on a Campaign Manager tab. Migration-free: the queue
 * lives in ActivityLog, keyed by a "LINKEDIN_PAUSE_REQUEST: <name>" message prefix.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Missing ad name" }, { status: 400 });

    await logActivity(ws.id, "info", `LINKEDIN_PAUSE_REQUEST: ${name}`, { kind: "linkedin_pause_request", name });
    return NextResponse.json({ ok: true, queued: name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
