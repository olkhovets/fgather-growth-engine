import { prisma } from "@/lib/prisma";
import { wilsonLower, confidentLeader } from "@/lib/stats";

/**
 * Rate email STYLES by the real outcome — positive-reply rate — not just by the grader's quality
 * score. The grader says "is this email well-written"; this says "which style actually books
 * meetings." Peter's signal: the per-company `specialist-proof` style booked a meeting with no
 * incentive, so styles clearly differ in outcome and the engine should know which one is winning.
 *
 * Confidence-aware (Wilson lower bound) so a single lucky reply can't crown a style. Read-only.
 */

export type StyleStat = {
  style: string;
  sent: number;
  positives: number;
  replies: number;
  rate: number;        // positives / sent (fraction 0-1)
  wilsonLower: number; // 95% lower bound on the positive-reply rate (fraction)
};

export type StylePerformance = {
  styles: StyleStat[];           // sorted best-first by Wilson lower bound
  leader: string | null;         // confident leader vs the rest, or null if too close
  enoughData: boolean;           // at least MIN_SENDS_PER_STYLE on the top two styles
  note: string;                  // one-line, loop-readable
};

const MIN_SENDS_PER_STYLE = 150; // below this a style's rate is noise

export async function rateStylesByReply(workspaceId: string): Promise<StylePerformance> {
  // Sent leads grouped by style, and positive replies grouped by style — two cheap groupBys.
  const [sentRows, replyRows] = await Promise.all([
    prisma.lead.groupBy({
      by: ["emailStyle"],
      where: { leadBatch: { workspaceId }, sentAt: { not: null }, emailStyle: { not: null } },
      _count: true,
    }),
    prisma.lead.groupBy({
      by: ["emailStyle", "replyStatus"],
      where: { leadBatch: { workspaceId }, sentAt: { not: null }, emailStyle: { not: null }, replyStatus: { not: null } },
      _count: true,
    }),
  ]);

  const map = new Map<string, StyleStat>();
  for (const r of sentRows) {
    const style = r.emailStyle as string;
    map.set(style, { style, sent: r._count, positives: 0, replies: 0, rate: 0, wilsonLower: 0 });
  }
  for (const r of replyRows) {
    const style = r.emailStyle as string;
    const s = map.get(style) ?? { style, sent: 0, positives: 0, replies: 0, rate: 0, wilsonLower: 0 };
    s.replies += r._count;
    if (r.replyStatus === "positive") s.positives += r._count;
    map.set(style, s);
  }

  const styles = Array.from(map.values()).map((s) => ({
    ...s,
    rate: s.sent > 0 ? s.positives / s.sent : 0,
    wilsonLower: wilsonLower(s.positives, s.sent),
  })).sort((a, b) => b.wilsonLower - a.wilsonLower || b.rate - a.rate);

  const [best, next] = styles;
  const enoughData = !!best && best.sent >= MIN_SENDS_PER_STYLE && (!next || next.sent >= MIN_SENDS_PER_STYLE);

  let leader: string | null = null;
  if (best && next) {
    const cl = confidentLeader({ successes: best.positives, n: best.sent }, { successes: next.positives, n: next.sent });
    leader = cl === "a" ? best.style : null; // only crown the top style if it confidently beats #2
  } else if (best && !next) {
    leader = best.sent >= MIN_SENDS_PER_STYLE ? best.style : null;
  }

  const pct = (r: number) => (r * 100).toFixed(3) + "%";
  let note: string;
  if (styles.length === 0) note = "No styled sends yet — nothing to rate.";
  else if (leader) note = `Winning style: "${leader}" (${pct(map.get(leader)!.rate)} positive, ${map.get(leader)!.positives}/${map.get(leader)!.sent}). Favor it.`;
  else if (!enoughData) note = `Style rating gathering — need ${MIN_SENDS_PER_STYLE}+ sends/style before a confident call (top: "${best?.style}" ${best ? `${best.positives}/${best.sent}` : ""}).`;
  else note = `Top styles too close to call confidently: ${styles.slice(0, 3).map((s) => `${s.style} ${s.positives}/${s.sent}`).join(", ")}.`;

  return { styles, leader, enoughData, note };
}
