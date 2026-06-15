import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twice-daily creative iterator: reads incentives performance, applies safe
 * server-side optimizations (resume paused campaigns, throttle on high bounce,
 * scale when clean), and returns a structured JSON report.
 *
 * Protected by CRON_SECRET bearer token.
 * GET /api/optimize/iterate
 */

const BOUNCE_PAUSE_THRESHOLD = 5;   // pause if 24h bounce rate exceeds 5%
const BOUNCE_RESUME_THRESHOLD = 2;  // safe to resume below 2%
const FRESH_LOW_WATERMARK = 50;      // pool is "low" below this
const ROLLING_NAME = "Incentives Lab (rolling)";

type AmountRow = { amount: number; sent: number; replies: number; positive: number; positiveRatePct: number };
type StyleRow  = { style: string;  sent: number; replies: number; positive: number; positiveRatePct: number };

interface WorkspaceReport {
  workspaceId: string;
  sent24: number;
  bounceRate: number | null;
  freshPool: number;
  positives7d: number;
  byAmount: AmountRow[];
  byStyle: StyleRow[];
  actions: string[];
  warnings: string[];
}

async function iterateWorkspace(workspaceId: string): Promise<WorkspaceReport> {
  const actions: string[] = [];
  const warnings: string[] = [];

  // ── 1. Sent in last 24h ────────────────────────────────────────────────────
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sent24 = await prisma.lead.count({
    where: { leadBatch: { workspaceId }, incentiveAmount: { not: null }, sentAt: { gte: since24h } },
  });

  // ── 2. Fresh pool ──────────────────────────────────────────────────────────
  const freshPool = await prisma.lead.count({
    where: { leadBatch: { workspaceId }, sentAt: null, suppressed: false, repliedAt: null, email: { not: "" } },
  });

  // ── 3. Positives in last 7d ────────────────────────────────────────────────
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const positives7d = await prisma.lead.count({
    where: { leadBatch: { workspaceId }, replyStatus: "positive", repliedAt: { gte: since7d } },
  });

  // ── 4. Per-amount breakdown ────────────────────────────────────────────────
  const [amtSent, amtReply] = await Promise.all([
    prisma.lead.groupBy({
      by: ["incentiveAmount"],
      where: { leadBatch: { workspaceId }, incentiveAmount: { not: null }, sentAt: { not: null } },
      _count: true,
    }),
    prisma.lead.groupBy({
      by: ["incentiveAmount", "replyStatus"],
      where: { leadBatch: { workspaceId }, incentiveAmount: { not: null }, replyStatus: { not: null } },
      _count: true,
    }),
  ]);
  const amtMap: Record<number, AmountRow> = {};
  for (const r of amtSent) {
    const a = r.incentiveAmount as number;
    amtMap[a] = { amount: a, sent: r._count, replies: 0, positive: 0, positiveRatePct: 0 };
  }
  for (const r of amtReply) {
    const a = r.incentiveAmount as number;
    if (!amtMap[a]) amtMap[a] = { amount: a, sent: 0, replies: 0, positive: 0, positiveRatePct: 0 };
    amtMap[a].replies += r._count;
    if (r.replyStatus === "positive") amtMap[a].positive += r._count;
  }
  const byAmount = Object.values(amtMap).map((m) => ({
    ...m,
    positiveRatePct: m.sent > 0 ? Math.round((m.positive / m.sent) * 1000) / 10 : 0,
  })).sort((a, b) => a.amount - b.amount);

  // ── 5. Per-style breakdown ─────────────────────────────────────────────────
  const [sstSent, sstReply] = await Promise.all([
    prisma.lead.groupBy({
      by: ["incentiveSubjectStyle"],
      where: { leadBatch: { workspaceId }, incentiveSubjectStyle: { not: null }, sentAt: { not: null } },
      _count: true,
    }),
    prisma.lead.groupBy({
      by: ["incentiveSubjectStyle", "replyStatus"],
      where: { leadBatch: { workspaceId }, incentiveSubjectStyle: { not: null }, replyStatus: { not: null } },
      _count: true,
    }),
  ]);
  const styleMap: Record<string, StyleRow> = {};
  for (const r of sstSent) {
    const s = r.incentiveSubjectStyle as string;
    styleMap[s] = { style: s, sent: r._count, replies: 0, positive: 0, positiveRatePct: 0 };
  }
  for (const r of sstReply) {
    const s = r.incentiveSubjectStyle as string;
    if (!styleMap[s]) styleMap[s] = { style: s, sent: 0, replies: 0, positive: 0, positiveRatePct: 0 };
    styleMap[s].replies += r._count;
    if (r.replyStatus === "positive") styleMap[s].positive += r._count;
  }
  const byStyle = Object.values(styleMap).map((m) => ({
    ...m,
    positiveRatePct: m.sent > 0 ? Math.round((m.positive / m.sent) * 1000) / 10 : 0,
  })).sort((a, b) => b.positive - a.positive);

  // ── 6. Instantly analytics + safe auto-actions ─────────────────────────────
  let bounceRate: number | null = null;
  const ctx = await getInstantlyClientForWorkspaceId(workspaceId);
  if (ctx) {
    const rolling = await prisma.sentCampaign.findFirst({
      where: { workspaceId, name: ROLLING_NAME },
      orderBy: { createdAt: "desc" },
      select: { instantlyCampaignId: true },
    });

    if (rolling?.instantlyCampaignId) {
      const analytics = await ctx.client.getCampaignAnalytics(rolling.instantlyCampaignId).catch(() => null);
      if (analytics) {
        const sent = analytics.emails_sent_count ?? analytics.contacted_count ?? 0;
        const bounced = analytics.bounced_count ?? 0;
        bounceRate = sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0;

        // Auto-throttle on high bounce
        if (bounceRate > BOUNCE_PAUSE_THRESHOLD) {
          try {
            await ctx.client.pauseCampaign(rolling.instantlyCampaignId);
            const msg = `Auto-paused "${ROLLING_NAME}" — bounce rate ${bounceRate}% exceeds ${BOUNCE_PAUSE_THRESHOLD}% threshold`;
            actions.push(msg);
            await logActivity(workspaceId, "warning", msg, { bounceRate, campaignId: rolling.instantlyCampaignId });
          } catch {
            warnings.push("Failed to pause campaign via Instantly API");
          }
        }

        // Auto-resume when clean
        if (bounceRate < BOUNCE_RESUME_THRESHOLD && analytics.campaign_status === 0 /* paused */) {
          try {
            await ctx.client.activateCampaign(rolling.instantlyCampaignId);
            const msg = `Auto-resumed "${ROLLING_NAME}" — bounce rate ${bounceRate}% is clean (below ${BOUNCE_RESUME_THRESHOLD}%)`;
            actions.push(msg);
            await logActivity(workspaceId, "info", msg, { bounceRate, campaignId: rolling.instantlyCampaignId });
          } catch {
            warnings.push("Failed to resume campaign via Instantly API");
          }
        }
      }
    }
  }

  // ── 7. Fresh pool warning ──────────────────────────────────────────────────
  if (freshPool < FRESH_LOW_WATERMARK) {
    warnings.push(`Fresh lead pool low (${freshPool} leads) — Apollo pull recommended`);
  }

  // ── 8. Surface winning variant ─────────────────────────────────────────────
  const winnerAmount = byAmount.length > 0
    ? byAmount.reduce((a, b) => (b.positiveRatePct > a.positiveRatePct ? b : a))
    : null;
  const winnerStyle = byStyle.length > 0 ? byStyle[0] : null;
  if (winnerAmount && winnerAmount.positive > 0) {
    actions.push(`Leading amount: $${winnerAmount.amount} (${winnerAmount.positiveRatePct}% positive rate, ${winnerAmount.positive} positives)`);
  }
  if (winnerStyle && winnerStyle.positive > 0) {
    actions.push(`Leading style: "${winnerStyle.style}" (${winnerStyle.positiveRatePct}% positive rate, ${winnerStyle.positive} positives)`);
  }

  return { workspaceId, sent24, bounceRate, freshPool, positives7d, byAmount, byStyle, actions, warnings };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 400 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { incentivesAutopilot: true },
    select: { id: true },
  });

  const results = await Promise.all(workspaces.map((ws) => iterateWorkspace(ws.id)));

  // Top-level aggregates across all workspaces
  const totalSent24 = results.reduce((s, r) => s + r.sent24, 0);
  const totalPositives7d = results.reduce((s, r) => s + r.positives7d, 0);
  const totalFreshPool = results.reduce((s, r) => s + r.freshPool, 0);
  const allActions = results.flatMap((r) => r.actions);
  const allWarnings = results.flatMap((r) => r.warnings);

  return NextResponse.json({
    ok: true,
    workspaces: results.length,
    totalSent24,
    totalPositives7d,
    totalFreshPool,
    actions: allActions,
    warnings: allWarnings,
    byWorkspace: results,
  });
}
