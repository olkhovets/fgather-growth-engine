import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runIncentivesAutopilotForWorkspace } from "@/lib/incentives-autopilot";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a manual run may trigger an Apollo pull when the pool is low

/**
 * GET:
 *  - cron-authed (Bearer CRON_SECRET): run the incentives autopilot for every enabled workspace.
 *  - session: return whether incentives autopilot is enabled for the user's workspace.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) {
    const workspaces = await prisma.workspace.findMany({ where: { incentivesAutopilot: true }, select: { id: true } });
    waitUntil((async () => { for (const ws of workspaces) await runIncentivesAutopilotForWorkspace(ws, secret); })());
    return NextResponse.json({ ok: true, started: true, workspaces: workspaces.length });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({
    where: { userId: session.user.id },
    select: { id: true, incentivesAutopilot: true, incentivesPerRun: true, incentivesIntervalMin: true, incentivesDailyCap: true },
  });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  // Recent autopilot runs (parse the structured metadata we logged per run).
  const logs = await prisma.activityLog.findMany({
    where: { workspaceId: ws.id, type: "autopilot", message: { startsWith: "Incentives autopilot" } },
    orderBy: { createdAt: "desc" }, take: 8, select: { createdAt: true, metaJson: true },
  });
  const recentRuns = logs.map((l) => {
    let m: Record<string, unknown> = {};
    try { m = l.metaJson ? JSON.parse(l.metaJson) : {}; } catch { /* ignore */ }
    return {
      at: l.createdAt,
      ingested: (m.ingested as number) ?? 0,
      appended: (m.appended as number) ?? 0,
      sentToday: (m.sentToday as number) ?? null,
      dailyCap: (m.dailyCap as number) ?? null,
      distribution: Array.isArray(m.distribution) ? (m.distribution as Array<{ amount: number; style: string; leads: number }>) : [],
      error: (m.launchError as string) ?? null,
    };
  });

  return NextResponse.json({
    enabled: ws.incentivesAutopilot ?? false,
    perRun: ws.incentivesPerRun ?? 50,
    intervalMin: ws.incentivesIntervalMin ?? 30,
    dailyCap: ws.incentivesDailyCap ?? 500,
    recentRuns,
  });
}

/**
 * POST (session): toggle the autopilot and/or run it now for the user's workspace.
 * Body: { enabled?: boolean, run?: boolean }
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured — autopilot can't run." }, { status: 400 });

  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true, incentivesAutopilot: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const data: { incentivesAutopilot?: boolean; incentivesPerRun?: number; incentivesIntervalMin?: number; incentivesDailyCap?: number } = {};
  if (typeof body.enabled === "boolean") data.incentivesAutopilot = body.enabled;
  if (Number.isFinite(body.perRun)) data.incentivesPerRun = Math.min(1000, Math.max(1, Math.round(body.perRun)));
  if (Number.isFinite(body.intervalMin)) data.incentivesIntervalMin = Math.min(1440, Math.max(1, Math.round(body.intervalMin)));
  if (Number.isFinite(body.dailyCap)) data.incentivesDailyCap = Math.min(13500, Math.max(1, Math.round(body.dailyCap)));
  if (Object.keys(data).length > 0) await prisma.workspace.update({ where: { id: ws.id }, data });

  let runResult: Record<string, unknown> | null = null;
  if (body.run === true) {
    runResult = await runIncentivesAutopilotForWorkspace({ id: ws.id }, secret);
  }

  const fresh = await prisma.workspace.findUnique({ where: { id: ws.id }, select: { incentivesAutopilot: true, incentivesPerRun: true, incentivesIntervalMin: true, incentivesDailyCap: true } });
  return NextResponse.json({ ok: true, enabled: fresh?.incentivesAutopilot ?? false, perRun: fresh?.incentivesPerRun, intervalMin: fresh?.incentivesIntervalMin, dailyCap: fresh?.incentivesDailyCap, runResult });
}
