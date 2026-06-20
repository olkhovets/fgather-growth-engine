import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLinkedInSignal, getCrossChannelSignals } from "@/lib/cross-channel";
import { buildBudgetPlan } from "@/lib/budget-shifter";

export const dynamic = "force-dynamic";

/** GET: the cross-channel view — latest LinkedIn snapshot + fused priority personas. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const [linkedin, crossChannel, budgetPlan] = await Promise.all([
      getLinkedInSignal(workspace.id),
      getCrossChannelSignals(workspace.id),
      buildBudgetPlan(workspace.id),
    ]);
    return NextResponse.json({ linkedin, crossChannel, budgetPlan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load cross-channel signal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
