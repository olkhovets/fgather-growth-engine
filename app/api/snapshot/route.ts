import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAggregatedMemory } from "@/lib/performance-memory";
import { getLinkedInSignal, getCrossChannelSignals } from "@/lib/cross-channel";
import { buildBudgetPlan } from "@/lib/budget-shifter";
import { getDeliverabilityForWorkspace } from "@/lib/deliverability";
import { rateStylesByReply } from "@/lib/style-performance";

export const dynamic = "force-dynamic";

/**
 * Read-only monitoring snapshot for the autonomous loop. Guarded by SNAPSHOT_KEY
 * (Bearer or ?key=) so loop-me can see KPIs + the budget plan + the cross-channel
 * brain WITHOUT an operator session. Side-effect-free: it never sends, never logs,
 * never spends. If SNAPSHOT_KEY is unset the endpoint is closed (no public data).
 */
export async function GET(request: Request) {
  const key = process.env.SNAPSHOT_KEY;
  const url = new URL(request.url);
  const provided = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("key") || "";
  if (!key || provided !== key) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const workspaces = await prisma.workspace.findMany({ select: {
    id: true, user: { select: { email: true } },
    autopilot: true, autopilotDailyLimit: true,
    incentivesAutopilot: true, incentivesDailyCap: true, incentivesLastRunAt: true,
  } });

  const out = [];
  for (const ws of workspaces) {
    try {
      const [memory, li, cross, budget, sent24, recycled24, specialistRecycled24, positives24, deliverability, stylePerf] = await Promise.all([
        getAggregatedMemory(ws.id),
        getLinkedInSignal(ws.id),
        getCrossChannelSignals(ws.id),
        buildBudgetPlan(ws.id),
        prisma.lead.count({ where: { leadBatch: { workspaceId: ws.id }, sentAt: { gte: since } } }),
        prisma.lead.count({ where: { leadBatch: { workspaceId: ws.id }, recycledAt: { gte: since } } }),
        prisma.lead.count({ where: { leadBatch: { workspaceId: ws.id }, recycledAt: { gte: since }, incentiveSubjectStyle: "specialist-proof" } }),
        prisma.lead.count({ where: { leadBatch: { workspaceId: ws.id }, repliedAt: { gte: since }, replyStatus: "positive" } }),
        getDeliverabilityForWorkspace(ws.id),
        rateStylesByReply(ws.id),
      ]);

      const emailPositives = Object.values(memory.byPersona).reduce((a, m) => a + (m.positive_reply_count ?? 0), 0);

      out.push({
        workspace: ws.user?.email ?? ws.id,
        health: {
          emailSentLast24h: sent24,
          emailRecycledLast24h: recycled24,
          emailSpecialistProofRecycledLast24h: specialistRecycled24,
          emailTotalLast24h: sent24 + recycled24,
          emailPositivesLast24h: positives24,
          emailWorking: sent24 + recycled24 > 0,
          linkedinConnected: li.hasData,
          linkedinLastSync: li.snapshot.at,
          // Inbox placement — the first thing to check when sends are high but positives are ~0.
          // If verdict is unhealthy/critical, the email is foldering into spam and no copy change helps.
          deliverability: deliverability
            ? { verdict: deliverability.verdict, avgHealth: deliverability.avgHealth, blockedInboxPct: deliverability.blockedInboxPct, inboxes: deliverability.inboxes, critical: deliverability.critical, unhealthy: deliverability.unhealthy, hasHealthData: deliverability.hasHealthData }
            : null,
        },
        autopilot: {
          standardOn: ws.autopilot,
          standardDailyLimit: ws.autopilotDailyLimit,
          offerOn: ws.incentivesAutopilot,
          offerDailyCap: ws.incentivesDailyCap,
          offerLastRunAt: ws.incentivesLastRunAt,
        },
        email: {
          totalPositives: emailPositives,
          byPersonaTop: cross.priorityPersonas.slice(0, 5),
          // Which email style is actually booking replies (confidence-rated), at a glance.
          winningStyle: stylePerf.leader,
          stylesRated: stylePerf.styles.slice(0, 5).map((s) => ({ style: s.style, sent: s.sent, positives: s.positives, rate: Math.round(s.rate * 10000) / 100 })),
        },
        linkedin: li.totals,
        crossChannel: { suggestion: cross.suggestion, priorityPersonas: cross.priorityPersonas.slice(0, 5) },
        budgetPlan: budget,
      });
    } catch (err) {
      out.push({ workspace: ws.user?.email ?? ws.id, error: err instanceof Error ? err.message : "snapshot failed" });
    }
  }

  return NextResponse.json({ at: new Date().toISOString(), workspaces: out });
}
