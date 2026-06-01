import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { classifyLeads } from "@/lib/classify";

export const dynamic = "force-dynamic";

const CLASSIFY_CHUNK_SIZE = 30;

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { batchId, offset: offsetParam, limit: limitParam } = body as { batchId?: string; offset?: number; limit?: number };

    if (!batchId || typeof batchId !== "string") {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }
    const offset = Math.max(0, Number(offsetParam) || 0);
    const limit = Math.min(300, Math.max(CLASSIFY_CHUNK_SIZE, Number(limitParam) || 300));

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, anthropicKey: true, anthropicModel: true, icp: true },
    });

    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    const icp = workspace.icp ?? "";
    if (!icp.trim()) {
      return NextResponse.json({ error: "ICP not set. Set your Ideal Customer Profile in the playbook first." }, { status: 400 });
    }

    const anthropicKey = decrypt(workspace.anthropicKey);

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const result = await classifyLeads({
      workspaceId: workspace.id,
      batchId,
      icp,
      anthropicKey,
      model: workspace.anthropicModel ?? undefined,
      offset,
      limit,
    });

    return NextResponse.json({
      done: result.classified,
      total: result.total,
      classified: result.classified,
      usage: result.usage.input_tokens > 0 || result.usage.output_tokens > 0 ? result.usage : undefined,
      message: result.total === 0 ? "All leads already classified." : `Classified ${result.classified} leads with persona and vertical.`,
    });
  } catch (error) {
    console.error("Leads classify error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
