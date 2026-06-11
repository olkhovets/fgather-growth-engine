import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Last-24h autopilot summary for the dashboard: how many runs fired, and how many
 * leads were generated and sent. Lets the operator confirm the cron is healthy at a
 * glance without opening cron-job.org.
 */
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
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await prisma.activityLog.findMany({
      where: { workspaceId: workspace.id, type: "autopilot", createdAt: { gte: since } },
      select: { metaJson: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    let generated = 0, sent = 0, runsWithWork = 0;
    for (const l of logs) {
      try {
        const m = l.metaJson ? JSON.parse(l.metaJson) : {};
        const g = Number(m.generated) || 0;
        const s = Number(m.sent) || 0;
        generated += g; sent += s;
        if (g > 0 || s > 0) runsWithWork += 1;
      } catch {
        //
      }
    }

    // 24h deliverability health for the guardrail readout.
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const [sentRecent, bouncedRecent, sentToday] = await Promise.all([
      prisma.lead.count({ where: { leadBatch: { workspaceId: workspace.id }, sentAt: { gte: since } } }),
      prisma.lead.count({ where: { leadBatch: { workspaceId: workspace.id }, bouncedAt: { gte: since } } }),
      prisma.lead.count({ where: { leadBatch: { workspaceId: workspace.id }, sentAt: { gte: startOfDay } } }),
    ]);
    const bounceRate = sentRecent >= 20 ? Math.round((bouncedRecent / sentRecent) * 1000) / 10 : 0;

    // All-time reply breakdown (per lead, deduped). Drives the dashboard reply metrics.
    const sentTotal = await prisma.lead.count({ where: { leadBatch: { workspaceId: workspace.id }, sentAt: { not: null } } });
    const grouped = await prisma.lead.groupBy({
      by: ["replyStatus"],
      where: { leadBatch: { workspaceId: workspace.id }, replyStatus: { not: null } },
      _count: true,
    }).catch(() => [] as Array<{ replyStatus: string | null; _count: number }>);
    const byStatus: Record<string, number> = {};
    let totalReplies = 0;
    for (const g of grouped) {
      const k = g.replyStatus ?? "other";
      byStatus[k] = g._count;
      totalReplies += g._count;
    }
    const pct = (n: number) => (sentTotal > 0 ? Math.round((n / sentTotal) * 1000) / 10 : 0);
    const replyStats = {
      sentTotal,
      totalReplies,
      replyRatePct: pct(totalReplies),
      ooo: byStatus["ooo"] ?? 0,
      oooRatePct: pct(byStatus["ooo"] ?? 0),
      positive: byStatus["positive"] ?? 0,
      positiveRatePct: pct(byStatus["positive"] ?? 0),
      objection: byStatus["objection"] ?? 0,
      notInterested: byStatus["not_interested"] ?? 0,
      other: byStatus["other"] ?? 0,
    };

    return NextResponse.json({
      runs: logs.length,
      runsWithWork,
      generated,
      sent,
      lastRunAt: logs[0]?.createdAt?.toISOString() ?? null,
      sentRecent,
      sentToday,
      bouncedRecent,
      bounceRate,
      throttled: bounceRate > 5,
      replyStats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load autopilot activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
