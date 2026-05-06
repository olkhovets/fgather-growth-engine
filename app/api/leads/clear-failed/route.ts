import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
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
    });
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

    // Clear stepsJson for leads with empty step1Subject so Generate will reprocess them
    const result = await prisma.lead.updateMany({
      where: {
        leadBatchId: batchId,
        OR: [{ step1Subject: null }, { step1Subject: "" }],
      },
      data: { stepsJson: null, step1Subject: null, step1Body: null },
    });

    return NextResponse.json({ cleared: result.count });
  } catch (error) {
    console.error("Clear failed leads error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
