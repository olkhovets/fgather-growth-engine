import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET: Single sent campaign with lead batch and leads (for detail page: emails sent, etc.). */
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
    if (!id) {
      return NextResponse.json({ error: "Campaign id required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, playbookJson: true, icp: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const sent = await prisma.sentCampaign.findFirst({
      where: { id, workspaceId: workspace.id },
      include: {
        campaign: { select: { id: true, name: true, playbookJson: true, icp: true } },
        leadBatch: {
          include: {
            _count: { select: { leads: true } },
            leads: {
              select: {
                id: true,
                email: true,
                name: true,
                company: true,
                jobTitle: true,
                step1Subject: true,
                step1Body: true,
                stepsJson: true,
              },
              orderBy: { createdAt: "asc" },
              take: 50,
            },
          },
        },
      },
    });

    if (!sent) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json({
      sentCampaign: {
        id: sent.id,
        name: sent.name,
        instantlyCampaignId: sent.instantlyCampaignId,
        campaignId: sent.campaignId,
        leadBatchId: sent.leadBatchId,
        variant: sent.variant,
        createdAt: sent.createdAt,
        campaign: sent.campaign,
        leadBatch: sent.leadBatch
          ? {
              id: sent.leadBatch.id,
              name: sent.leadBatch.name,
              leadCount: sent.leadBatch._count.leads,
              leads: sent.leadBatch.leads,
            }
          : null,
      },
      workspacePlaybook: workspace.playbookJson,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load campaign";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
