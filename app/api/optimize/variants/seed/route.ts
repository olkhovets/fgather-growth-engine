import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_EXPERIMENT_VARIANTS } from "@/lib/experiment-defaults";

export const dynamic = "force-dynamic";

/**
 * Seed the curated default experiment variants (no Claude call) so the Experiments
 * page has something to test immediately. Idempotent: does nothing if the workspace
 * already has any experiments.
 */
export async function POST() {
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

    const existing = await prisma.promptExperiment.count({ where: { workspaceId: workspace.id } });
    if (existing > 0) {
      return NextResponse.json({ seeded: 0, message: "Experiments already exist." });
    }

    await prisma.promptExperiment.createMany({
      data: DEFAULT_EXPERIMENT_VARIANTS.map((v) => ({
        workspaceId: workspace.id,
        dimension: v.dimension,
        label: v.label,
        instruction: v.instruction,
        hypothesis: v.hypothesis,
        status: "testing",
        generation: 1,
      })),
    });

    return NextResponse.json({ seeded: DEFAULT_EXPERIMENT_VARIANTS.length });
  } catch (error) {
    console.error("Seed experiments error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
