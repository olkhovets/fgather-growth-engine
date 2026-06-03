import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeVariantStats, loadLearnings } from "@/lib/experiments";

export const dynamic = "force-dynamic";

/**
 * GET: dashboard data for the self-improving engine.
 * Returns active (testing) variants with live stats, the proven learnings,
 * recent winners/killed variants, and the workspace baseline reply rate.
 */
export async function GET() {
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

    const [testing, winners, killed, learnings] = await Promise.all([
      computeVariantStats(workspace.id, "testing"),
      computeVariantStats(workspace.id, "winner"),
      prisma.promptExperiment.findMany({
        where: { workspaceId: workspace.id, status: "killed" },
        select: { id: true, dimension: true, label: true, instruction: true, generation: true },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
      loadLearnings(workspace.id),
    ]);

    // Group testing variants by dimension for display
    const byDimension: Record<string, typeof testing.variants> = {};
    for (const v of testing.variants) {
      (byDimension[v.dimension] ??= []).push(v);
    }
    for (const dim of Object.keys(byDimension)) {
      byDimension[dim].sort((a, b) => b.positiveRate - a.positiveRate || b.sends - a.sends);
    }

    return NextResponse.json({
      baselinePositiveRate: testing.baselinePositiveRate,
      testingByDimension: byDimension,
      testingCount: testing.variants.length,
      winners: winners.variants.sort((a, b) => b.positiveRate - a.positiveRate),
      killed,
      learnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load experiments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
