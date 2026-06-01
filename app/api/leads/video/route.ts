import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { startLumaVideo, startRunwayVideo, getLumaStatus, getRunwayStatus } from "@/lib/video-generate";

export const dynamic = "force-dynamic";

/**
 * POST: Start video generation for a lead.
 * Body: { leadId: string, provider: "luma" | "runway" }
 * Returns: { taskId }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { leadId, provider } = body as { leadId?: string; provider?: "luma" | "runway" };

    if (!leadId || !provider || !["luma", "runway"].includes(provider)) {
      return NextResponse.json({ error: "leadId and provider (luma|runway) required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, lumaApiKey: true, runwayApiKey: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const key = provider === "luma" ? workspace.lumaApiKey : workspace.runwayApiKey;
    if (!key) {
      return NextResponse.json(
        { error: `Add your ${provider === "luma" ? "Luma" : "Runway"} API key in Settings first` },
        { status: 400 }
      );
    }

    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        leadBatch: { workspaceId: workspace.id },
      },
      select: { id: true, name: true, company: true },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const prompt = `Professional 5-second personalized video greeting for ${lead.name ?? "a prospect"} at ${lead.company ?? "their company"}. Friendly, warm, modern business style. Clean background.`;

    const apiKey = decrypt(key);
    const { taskId } =
      provider === "luma"
        ? await startLumaVideo(apiKey, prompt)
        : await startRunwayVideo(apiKey, prompt);

    await prisma.lead.update({
      where: { id: leadId },
      data: { videoTaskId: taskId, videoTaskProvider: provider },
    });

    return NextResponse.json({ taskId });
  } catch (err) {
    console.error("Video start error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video generation failed" },
      { status: 500 }
    );
  }
}

/**
 * GET: Poll video status for a lead.
 * Query: leadId=...
 * Returns: { status, videoUrl?, error? }
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get("leadId");

    if (!leadId) {
      return NextResponse.json({ error: "leadId required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, lumaApiKey: true, runwayApiKey: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        leadBatch: { workspaceId: workspace.id },
      },
      select: { id: true, videoUrl: true, videoTaskId: true, videoTaskProvider: true },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (lead.videoUrl) {
      return NextResponse.json({ status: "completed", videoUrl: lead.videoUrl });
    }

    if (!lead.videoTaskId || !lead.videoTaskProvider) {
      return NextResponse.json({ status: "not_started" });
    }

    const key =
      lead.videoTaskProvider === "luma" ? workspace.lumaApiKey : workspace.runwayApiKey;
    if (!key) {
      return NextResponse.json({ status: "error", error: "API key missing" });
    }

    const apiKey = decrypt(key);
    const { status, videoUrl } =
      lead.videoTaskProvider === "luma"
        ? await getLumaStatus(apiKey, lead.videoTaskId)
        : await getRunwayStatus(apiKey, lead.videoTaskId);

    if (videoUrl) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { videoUrl, videoTaskId: null, videoTaskProvider: null },
      });
      return NextResponse.json({ status: "completed", videoUrl });
    }

    const isFailed =
      status === "failed" ||
      status === "FAILED" ||
      status === "error" ||
      status === "canceled";
    if (isFailed) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { videoTaskId: null, videoTaskProvider: null },
      });
      return NextResponse.json({ status: "failed" });
    }

    return NextResponse.json({ status: "pending" });
  } catch (err) {
    console.error("Video status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Status check failed" },
      { status: 500 }
    );
  }
}
