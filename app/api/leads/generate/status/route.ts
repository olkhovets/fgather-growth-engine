import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      include: { _count: { select: { leads: true } } },
    });
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

    const total = batch._count.leads;

    // Count leads that still need work (no stepsJson or empty)
    const needsWork = await prisma.lead.count({
      where: {
        leadBatchId: batchId,
        OR: [
          { stepsJson: null },
          { stepsJson: "" },
          { stepsJson: "[]" },
        ],
      },
    });

    const generated = total - needsWork;

    return NextResponse.json({ total, generated });
  } catch (error) {
    console.error("Generate status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
