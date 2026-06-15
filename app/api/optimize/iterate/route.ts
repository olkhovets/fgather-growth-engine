import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { optimizeIncentivesForWorkspace } from "@/lib/incentives-optimizer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The always-on incentives iterator.
 * - GET, cron-authed (Bearer CRON_SECRET): run for every workspace with incentives autopilot on.
 *   This is what the twice-daily creative agent calls to read the report + apply safe optimizations.
 * - GET/POST, session: run + return the report for the logged-in user's workspace.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) {
    const workspaces = await prisma.workspace.findMany({ where: { incentivesAutopilot: true }, select: { id: true } });
    const reports = [];
    for (const ws of workspaces) reports.push(await optimizeIncentivesForWorkspace(ws.id));
    return NextResponse.json({ ok: true, workspaces: workspaces.length, reports });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const report = await optimizeIncentivesForWorkspace(ws.id);
  return NextResponse.json({ ok: true, report });
}
