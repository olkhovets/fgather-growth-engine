import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Pause/resume the automated senders so manual batches (send-batch) aren't fighting the autopilot.
 * Body: { on: boolean, which?: "incentives" | "standard" | "both" }. Session or CRON_SECRET auth.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const cron = process.env.CRON_SECRET;
  const viaCron = !!cron && request.headers.get("x-cron-secret") === cron && typeof body.workspaceId === "string";

  let ws: { id: string } | null = null;
  if (viaCron) ws = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true } });
  else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  }
  if (!ws) return NextResponse.json({ error: "No workspace." }, { status: 400 });

  const on = body.on === true;
  const which = body.which === "incentives" || body.which === "standard" ? body.which : "both";
  const data: { incentivesAutopilot?: boolean; autopilot?: boolean } = {};
  if (which === "incentives" || which === "both") data.incentivesAutopilot = on;
  if (which === "standard" || which === "both") data.autopilot = on;

  const updated = await prisma.workspace.update({ where: { id: ws.id }, data, select: { incentivesAutopilot: true, autopilot: true } });
  await logActivity(ws.id, "info", `Autopilot ${on ? "resumed" : "paused"} (${which}) via toggle.`, updated);
  return NextResponse.json({ ok: true, ...updated });
}
