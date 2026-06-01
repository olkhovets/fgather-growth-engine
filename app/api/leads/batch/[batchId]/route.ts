import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET: List leads in a batch (for video generation etc).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = await params;
    if (!batchId) {
      return NextResponse.json({ error: "Batch id required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      include: { leads: { select: { id: true, videoUrl: true }, orderBy: { id: "asc" } } },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    return NextResponse.json({ leads: batch.leads });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch batch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE: Remove a batch and all its leads (e.g. mistaken import).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = await params;
    if (!batchId) {
      return NextResponse.json({ error: "Batch id required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    await prisma.leadBatch.delete({
      where: { id: batchId },
    });

    return NextResponse.json({
      message: "Batch and all its leads have been deleted.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete batch";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
