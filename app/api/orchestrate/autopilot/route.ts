import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST { enabled: boolean } — toggle the workspace autopilot.
 *
 * When ON, the daily cron (/api/orchestrate/run) generates and sends
 * automatically for this workspace, up to autopilotDailyLimit, appending into
 * the most recent live Instantly campaign. Manual sending still works anytime.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const { enabled } = (await request.json()) as { enabled?: boolean };
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { autopilot: enabled === true },
    });
    return NextResponse.json({ autopilot: enabled === true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update autopilot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
