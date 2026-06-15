import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runAutopilotForWorkspace } from "@/lib/autopilot";
import { runIncentivesAutopilotForWorkspace } from "@/lib/incentives-autopilot";
import { optimizeIncentivesForWorkspace } from "@/lib/incentives-optimizer";
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
// 300s so the occasional Incentives-autopilot Apollo pull (only when the fresh pool is low) fits;
// the work runs in waitUntil so the cron caller still gets an instant 200.
export const maxDuration = 300;

/**
 * Cron entrypoint: run autopilot for every workspace with it enabled.
 * Protected by CRON_SECRET. Called by the daily analytics cron.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured — autopilot disabled." }, { status: 400 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional ?max=N caps how many leads each run GENERATES (Claude is the slow part),
  // so frequent external-cron pings stay inside the function timeout. Sending of the
  // already-generated backlog still runs up to the full daily limit.
  const maxParam = new URL(request.url).searchParams.get("max");
  const maxGenerate = maxParam ? Math.max(1, parseInt(maxParam, 10) || 0) || undefined : undefined;

  const [workspaces, incentiveWorkspaces] = await Promise.all([
    prisma.workspace.findMany({ where: { autopilot: true }, select: { id: true, autopilotDailyLimit: true } }),
    prisma.workspace.findMany({ where: { incentivesAutopilot: true }, select: { id: true } }),
  ]);

  // Run the work in the background and respond IMMEDIATELY. Generation takes ~30s,
  // which exceeds external cron services' HTTP timeout (~30s) — they'd report "failed"
  // and may disable the job even though the work completes. waitUntil keeps the function
  // alive for the work (up to maxDuration) after the fast response.
  waitUntil((async () => {
    for (const ws of workspaces) {
      await runAutopilotForWorkspace(ws, secret, maxGenerate);
    }
    for (const ws of incentiveWorkspaces) {
      await runIncentivesAutopilotForWorkspace(ws, secret);
    }
    // Always-on iterator: run the optimizer at most ~every 6h per workspace (gated by its last log),
    // so health/scaling/promotion happens even without the twice-daily creative agent.
    for (const ws of incentiveWorkspaces) {
      const last = await prisma.activityLog.findFirst({ where: { workspaceId: ws.id, type: "autopilot", message: { startsWith: "Optimizer:" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      if (!last || Date.now() - last.createdAt.getTime() > 6 * 60 * 60 * 1000) {
        await optimizeIncentivesForWorkspace(ws.id);
      }
    }
  })());

  return NextResponse.json({ ok: true, started: true, workspaces: workspaces.length, incentiveWorkspaces: incentiveWorkspaces.length });
}

/**
 * Manual "run autopilot now" for the logged-in user's workspace. Bounded to a
 * smaller chunk so it returns within the function timeout; click again for more.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured — autopilot can't run." }, { status: 400 });
  }
  const ws = await prisma.workspace.findUnique({
    where: { userId: session.user.id },
    select: { id: true, autopilotDailyLimit: true },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  // Cap a manual run to ~30 leads so it finishes inside the 60s budget.
  const result = await runAutopilotForWorkspace(ws, secret, 30);
  return NextResponse.json(result);
}
