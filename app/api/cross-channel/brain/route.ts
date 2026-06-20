import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runGrowthBrain } from "@/lib/cross-channel-brain";

export const dynamic = "force-dynamic";

/** POST: run the growth brain for the logged-in operator's workspace (recommend-only). */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const result = await runGrowthBrain(workspace.id, { execute: false });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to run growth brain";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: cron entry — run the brain for every workspace (recommend-only, never executes). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const results = [];
  for (const ws of workspaces) {
    try {
      const r = await runGrowthBrain(ws.id, { execute: false });
      results.push({ workspaceId: ws.id, personas: r.scoreboard.length, actions: r.actions.length });
    } catch (err) {
      results.push({ workspaceId: ws.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
