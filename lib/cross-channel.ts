import { prisma } from "@/lib/prisma";
import { getAggregatedMemory } from "@/lib/performance-memory";
import { PERSONAS } from "@/lib/apollo-personas";

/**
 * The cross-channel brain. Reads BOTH channels and fuses them:
 *   - email: positive replies per persona (the engine's existing win signal)
 *   - linkedin: ad clicks/impressions per persona (the feedback pipe)
 * and produces a ranked list of PRIORITY PERSONAS — who is hot on either channel
 * right now — plus a one-line steer. This is what closes the loop: ad engagement
 * reweights who we cold-email, and reply wins steer ad creative/targeting.
 */

const personaLabel = (key: string): string => PERSONAS.find((p) => p.key === key)?.label ?? key;

export type LinkedInSignal = {
  hasData: boolean;
  totals: { spend: number; impressions: number; clicks: number; leads: number; conversions: number; ctrPct: number };
  byPersona: Record<string, { impressions: number; clicks: number; ctr: number }>;
  snapshot: {
    at: string | null;
    dateRange: { from?: string; to?: string } | null;
    account: string | null;
    adSets: unknown[];
    demographics: unknown[];
  };
};

/** Read the latest LinkedIn snapshot recorded by the feedback pipe. */
export async function getLinkedInSignal(workspaceId: string): Promise<LinkedInSignal> {
  const [obs, log] = await Promise.all([
    prisma.performanceObservation.findMany({
      where: { workspaceId, sourceType: "linkedin" },
      select: { dimensionType: true, dimensionValue: true, metric: true, value: true },
    }),
    prisma.activityLog.findFirst({
      where: { workspaceId, type: "info", message: { startsWith: "LinkedIn analytics ingested" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, metaJson: true },
    }),
  ]);

  const totals = { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0, ctrPct: 0 };
  const byPersona: Record<string, { impressions: number; clicks: number; ctr: number }> = {};
  for (const o of obs) {
    if (o.dimensionType === "channel") {
      if (o.metric === "li_spend") totals.spend = o.value;
      else if (o.metric === "li_impressions") totals.impressions = o.value;
      else if (o.metric === "li_clicks") totals.clicks = o.value;
      else if (o.metric === "li_leads") totals.leads = o.value;
      else if (o.metric === "li_conversions") totals.conversions = o.value;
      else if (o.metric === "li_ctr_pct") totals.ctrPct = o.value;
    } else if (o.dimensionType === "persona") {
      const p = (byPersona[o.dimensionValue] ||= { impressions: 0, clicks: 0, ctr: 0 });
      if (o.metric === "li_impressions") p.impressions = o.value;
      else if (o.metric === "li_clicks") p.clicks = o.value;
    }
  }
  for (const p of Object.values(byPersona)) p.ctr = p.impressions > 0 ? Math.round((p.clicks / p.impressions) * 10000) / 100 : 0;

  let snapshot: LinkedInSignal["snapshot"] = { at: null, dateRange: null, account: null, adSets: [], demographics: [] };
  if (log?.metaJson) {
    try {
      const m = JSON.parse(log.metaJson);
      snapshot = {
        at: log.createdAt.toISOString(),
        dateRange: m.dateRange ?? null,
        account: m.account ?? null,
        adSets: Array.isArray(m.adSets) ? m.adSets : [],
        demographics: Array.isArray(m.demographics) ? m.demographics : [],
      };
    } catch { /* ignore */ }
  }

  return { hasData: obs.length > 0, totals, byPersona, snapshot };
}

export type PriorityPersona = {
  key: string;
  label: string;
  emailPositives: number;
  liClicks: number;
  liCtr: number;
  score: number;
  reason: string;
};

export type CrossChannelSignals = {
  priorityPersonas: PriorityPersona[];
  suggestion: string | null;
  channels: { email: boolean; linkedin: boolean };
};

/**
 * Fuse email + LinkedIn into ranked priority personas. Score is intentionally
 * simple and explainable: positive replies are worth far more than an ad click
 * (a reply is a human saying yes), but ad clicks surface demand the email list
 * hasn't reached yet. Operators (and, later, the Apollo title-rotation + ad
 * generator) target the top of this list first.
 */
export async function getCrossChannelSignals(workspaceId: string): Promise<CrossChannelSignals> {
  const [memory, li] = await Promise.all([getAggregatedMemory(workspaceId), getLinkedInSignal(workspaceId)]);

  const keySet = new Set<string>([...Object.keys(memory.byPersona), ...Object.keys(li.byPersona)]);
  keySet.delete("unknown");
  const keys = Array.from(keySet);

  const POSITIVE_WEIGHT = 10; // one positive reply ≈ ten ad clicks of intent
  const rows: PriorityPersona[] = [];
  for (const key of keys) {
    const emailPositives = memory.byPersona[key]?.positive_reply_count ?? 0;
    const liClicks = li.byPersona[key]?.clicks ?? 0;
    const liCtr = li.byPersona[key]?.ctr ?? 0;
    const score = emailPositives * POSITIVE_WEIGHT + liClicks;
    if (score === 0) continue;
    const bits: string[] = [];
    if (emailPositives > 0) bits.push(`${emailPositives} positive email repl${emailPositives === 1 ? "y" : "ies"}`);
    if (liClicks > 0) bits.push(`${liClicks} LinkedIn ad click${liClicks === 1 ? "" : "s"} (${liCtr}% CTR)`);
    rows.push({ key, label: personaLabel(key), emailPositives, liClicks, liCtr, score, reason: bits.join(" + ") });
  }
  rows.sort((a, b) => b.score - a.score);

  let suggestion: string | null = null;
  if (rows.length > 0) {
    const top = rows[0];
    const bothChannels = rows.find((r) => r.emailPositives > 0 && r.liClicks > 0);
    if (bothChannels) {
      suggestion = `"${bothChannels.label}" is converting on BOTH channels (${bothChannels.reason}). Pour budget here: push more ad creative to them and prioritize ${bothChannels.label} leads in the next email batch.`;
    } else if (top.liClicks > 0 && top.emailPositives === 0) {
      suggestion = `"${top.label}" is clicking your LinkedIn ads (${top.liClicks} clicks) but isn't in your positive-reply data yet. Pull more ${top.label} leads from Apollo and cold-email them while the ad demand is warm.`;
    } else {
      suggestion = `"${top.label}" leads on positive replies (${top.emailPositives}). Mirror that winning angle into LinkedIn ad creative aimed at ${top.label}.`;
    }
  }

  return {
    priorityPersonas: rows,
    suggestion,
    channels: { email: Object.keys(memory.byPersona).length > 0, linkedin: li.hasData },
  };
}
