import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET: Single campaign with lead batch and sent campaigns. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: workspace.id },
      include: {
        leadBatch: {
          include: {
            leads: {
              select: {
                id: true,
                email: true,
                name: true,
                company: true,
                jobTitle: true,
                persona: true,
                vertical: true,
                step1Subject: true,
                step1Body: true,
                stepsJson: true,
              },
            },
          },
        },
        sentCampaigns: true,
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Campaign get error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH: Update campaign (name, playbook, icp, proofPoints, leadBatchId, status). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const existing = await prisma.campaign.findFirst({
      where: { id, workspaceId: workspace.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.status === "string" && ["draft", "sequences_ready", "launched"].includes(body.status)) updates.status = body.status;
    if (body.playbookJson !== undefined) updates.playbookJson = body.playbookJson;
    if (body.icp !== undefined) updates.icp = body.icp;
    if (body.proofPointsJson !== undefined) updates.proofPointsJson = body.proofPointsJson;
    if (body.leadBatchId !== undefined) updates.leadBatchId = body.leadBatchId || null;
    if (body.ctaUrl !== undefined) updates.ctaUrl = body.ctaUrl || null;
    if (body.builderPrefsJson !== undefined) updates.builderPrefsJson = body.builderPrefsJson || null;

    const campaign = await prisma.campaign.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({ campaign });
  } catch (error) {
    console.error("Campaign update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE: Remove campaign from DB and delete any linked Instantly campaigns (best-effort). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, instantlyKey: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: workspace.id },
      include: { sentCampaigns: { select: { id: true, instantlyCampaignId: true } } },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Best-effort: delete from Instantly for any sent campaigns
    if (workspace.instantlyKey && campaign.sentCampaigns.length > 0) {
      const { decrypt } = await import("@/lib/encryption");
      const { getInstantlyClient } = await import("@/lib/instantly");
      try {
        const client = getInstantlyClient(decrypt(workspace.instantlyKey));
        await Promise.allSettled(
          campaign.sentCampaigns.map((sc: { id: string; instantlyCampaignId: string }) => client.deleteCampaign(sc.instantlyCampaignId))
        );
      } catch {
        // Instantly deletion is best-effort — still delete from DB
      }
    }

    // Delete campaign from DB (cascades to SentCampaign via SetNull on campaignId,
    // and SentCampaign has onDelete: Cascade for replies)
    await prisma.campaign.delete({ where: { id } });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Campaign delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
