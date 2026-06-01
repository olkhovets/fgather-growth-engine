import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForUserId } from "@/lib/instantly";

export const dynamic = "force-dynamic";

/** POST: Pause a sent campaign in Instantly. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Campaign id required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const sent = await prisma.sentCampaign.findFirst({
      where: { id, workspaceId: workspace.id },
      select: { id: true, name: true, instantlyCampaignId: true },
    });
    if (!sent) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured" },
        { status: 400 }
      );
    }

    await ctx.client.pauseCampaign(sent.instantlyCampaignId);
    return NextResponse.json({
      ok: true,
      message: `Campaign "${sent.name}" paused.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to pause campaign";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
