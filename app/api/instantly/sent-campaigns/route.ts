import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET: List sent campaigns for the current workspace */
export async function GET() {
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
      return NextResponse.json({ campaigns: [] });
    }

    const campaigns = await prisma.sentCampaign.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        instantlyCampaignId: c.instantlyCampaignId,
        name: c.name,
        leadBatchId: c.leadBatchId,
        abGroupId: c.abGroupId,
        variant: c.variant,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to list campaigns" }, { status: 500 });
  }
}
