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
  readyToSend: number;       // contactable leads that already have a sequence
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
      select: { id: true, autopilot: true, autopilotDailyLimit: true, inboxDailyLimit: true, playbookApproved: true, playbookJson: true, productSummary: true, icp: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const hasPlaybook = Boolean(workspace.playbookJson && workspace.playbookJson !== "{}" && workspace.playbookJson !== "null");
    const hasProductContext = Boolean(workspace.productSummary?.trim() && workspace.icp?.trim());

    // Existing campaigns that already carry a playbook — new leads can run under these
    // with the same guidelines, no new setup required.
    const campaignRows = await prisma.campaign.findMany({
      where: { workspaceId: workspace.id, playbookJson: { not: null } },
      select: { id: true, name: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    const campaigns = campaignRows.map((c) => ({ id: c.id, name: c.name, status: c.status }));

    // Live Instantly campaigns already created — new leads can be appended into one.
    const sentRows = await prisma.sentCampaign.findMany({
      where: { workspaceId: workspace.id },
      select: { instantlyCampaignId: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    // Dedupe by instantlyCampaignId (multi-style sends share names)
    const seenInstantly = new Set<string>();
    const instantlyCampaigns = sentRows.filter((s) => {
      if (seenInstantly.has(s.instantlyCampaignId)) return false;
      seenInstantly.add(s.instantlyCampaignId);
      return true;
    }).map((s) => ({ instantlyCampaignId: s.instantlyCampaignId, name: s.name }));

    const batches = await prisma.leadBatch.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const out: BatchStatus[] = [];
    for (const b of batches) {
      const [total, withSequences, sent, contactable, needsGeneration, readyToSend, samples] = await Promise.all([
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
        prisma.lead.count({
          where: {
            leadBatchId: b.id, sentAt: null, suppressed: false, repliedAt: null,
            stepsJson: { not: null }, NOT: { stepsJson: { in: ["", "[]"] } },
          },
        }),
        prisma.lead.findMany({
          where: { leadBatchId: b.id, stepsJson: { not: null }, sentAt: null },
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
        readyToSend,
        samples,
      });
    }

    // Most recent autopilot run (for the "last run" indicator on the launch page)
    const lastRunLog = await prisma.activityLog.findFirst({
      where: { workspaceId: workspace.id, type: "autopilot" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, metaJson: true },
    });
    let lastAutopilotRun: { at: string; generated: number; sent: number } | null = null;
    if (lastRunLog) {
      let generated = 0, sent = 0;
      try {
        const m = lastRunLog.metaJson ? JSON.parse(lastRunLog.metaJson) : {};
        generated = Number(m.generated) || 0;
        sent = Number(m.sent) || 0;
      } catch {
        //
      }
      lastAutopilotRun = { at: lastRunLog.createdAt.toISOString(), generated, sent };
    }

    // Leads added to Instantly today (UTC) — a quick "are we actually sending?" number.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await prisma.lead.count({
      where: { leadBatch: { workspaceId: workspace.id }, sentAt: { gte: startOfDay } },
    });

    return NextResponse.json({
      autopilot: workspace.autopilot,
      autopilotDailyLimit: workspace.autopilotDailyLimit ?? 200,
      inboxDailyLimit: workspace.inboxDailyLimit ?? 30,
      sentToday,
      lastAutopilotRun,
      playbookApproved: workspace.playbookApproved,
      hasPlaybook,
      hasProductContext,
      campaigns,
      instantlyCampaigns,
      batches: out,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load launch status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
