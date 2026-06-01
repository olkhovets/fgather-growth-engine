import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    if (!workspace) {
      return NextResponse.json({ batches: [], batch: null, leads: [] });
    }

    if (batchId) {
      const batch = await prisma.leadBatch.findFirst({
        where: { id: batchId, workspaceId: workspace.id },
        include: { leads: true },
      });
      if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }
      return NextResponse.json({ batch, leads: batch.leads });
    }

    const batches = await prisma.leadBatch.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });

    return NextResponse.json({
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        createdAt: b.createdAt,
        leadCount: b._count.leads,
      })),
    });
  } catch (error) {
    console.error("Leads GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
