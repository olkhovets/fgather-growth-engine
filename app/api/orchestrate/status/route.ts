import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type BatchStatus = {
  id: string;
  name: string | null;
  createdAt: string;
  total: number;
  withSequences: number;
  sent: number;
  contactable: number;       // not sent, not suppressed, not replied
  needsGeneration: number;   // contactable leads with no sequence yet
  samples: Array<{ name: string | null; company: string | null; step1Subject: string | null; step1Body: string | null }>;
};

/**
 * GET: launch-control view. Lists each lead batch with how many leads are
 * generated / sent / still contactable, plus a few sample generated emails
 * for review. Also returns whether autopilot is enabled.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, autopilot: true, playbookApproved: true, playbookJson: true, productSummary: true, icp: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const hasPlaybook = Boolean(workspace.playbookJson && workspace.playbookJson !== "{}" && workspace.playbookJson !== "null");
    const hasProductContext = Boolean(workspace.productSummary?.trim() && workspace.icp?.trim());

    const batches = await prisma.leadBatch.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const out: BatchStatus[] = [];
    for (const b of batches) {
      const [total, withSequences, sent, contactable, needsGeneration, samples] = await Promise.all([
        prisma.lead.count({ where: { leadBatchId: b.id } }),
        prisma.lead.count({ where: { leadBatchId: b.id, stepsJson: { not: null } } }),
        prisma.lead.count({ where: { leadBatchId: b.id, sentAt: { not: null } } }),
        prisma.lead.count({ where: { leadBatchId: b.id, sentAt: null, suppressed: false, repliedAt: null } }),
        prisma.lead.count({
          where: {
            leadBatchId: b.id, sentAt: null, suppressed: false, repliedAt: null,
            OR: [{ stepsJson: null }, { stepsJson: "" }, { stepsJson: "[]" }],
          },
        }),
        prisma.lead.findMany({
          where: { leadBatchId: b.id, stepsJson: { not: null } },
          select: { name: true, company: true, step1Subject: true, step1Body: true },
          take: 3,
          orderBy: { id: "asc" },
        }),
      ]);
      // Skip fully-empty batches with nothing meaningful
      if (total === 0) continue;
      out.push({
        id: b.id,
        name: b.name,
        createdAt: b.createdAt.toISOString(),
        total,
        withSequences,
        sent,
        contactable,
        needsGeneration,
        samples,
      });
    }

    return NextResponse.json({
      autopilot: workspace.autopilot,
      playbookApproved: workspace.playbookApproved,
      hasPlaybook,
      hasProductContext,
      batches: out,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load launch status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
