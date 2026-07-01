import { prisma } from "@/lib/prisma";

/**
 * Per-persona, performance-based style ranking. For each (persona, style) pair we count sends and
 * positive replies, so the sender can prefer the style that's actually working FOR THAT PERSONA — not
 * one flat winner across everyone. Reply data is sparse (a handful of positives), so a real positive
 * dominates the score, with a standing prior that INCENTIVE (money/gift) styles convert (every positive
 * Gather has booked came from a money-forward email) plus a small confidence nudge for more sends.
 */

export const INCENTIVE_STYLES = ["direct-incentive", "holiday-incentive", "founder-incentive", "outcome-hook"];

export type StyleStat = { sends: number; positives: number };

/** Map keyed by `${persona}|${style}` → {sends, positives} across all sent leads. */
export async function perPersonaStyleStats(workspaceId: string): Promise<Map<string, StyleStat>> {
  const [sent, positive] = await Promise.all([
    prisma.lead.groupBy({ by: ["persona", "emailStyle"], where: { leadBatch: { workspaceId }, sentAt: { not: null }, emailStyle: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: ["persona", "emailStyle"], where: { leadBatch: { workspaceId }, sentAt: { not: null }, emailStyle: { not: null }, replyStatus: "positive" }, _count: true }),
  ]);
  const m = new Map<string, StyleStat>();
  for (const r of sent) m.set(`${r.persona}|${r.emailStyle}`, { sends: r._count, positives: 0 });
  for (const r of positive) {
    const k = `${r.persona}|${r.emailStyle}`;
    const s = m.get(k) ?? { sends: 0, positives: 0 };
    s.positives += r._count; m.set(k, s);
  }
  return m;
}

/**
 * Score a (persona, style) draft for selection. Higher = send sooner.
 * - a real positive reply for this persona+style dominates (the only hard signal we have),
 * - INCENTIVE styles carry a standing prior (proven converter),
 * - more sends gives a small confidence nudge.
 */
export function styleScore(persona: string | null, style: string | null, stats: Map<string, StyleStat>): number {
  const s = stats.get(`${persona}|${style}`) ?? { sends: 0, positives: 0 };
  let score = s.positives * 1000;
  if (style && INCENTIVE_STYLES.includes(style)) score += 50;
  score += Math.min(s.sends, 200) * 0.1;
  return score;
}

export function isIncentiveStyle(style: string | null | undefined): boolean {
  return !!style && INCENTIVE_STYLES.includes(style);
}
