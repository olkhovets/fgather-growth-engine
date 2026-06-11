import { prisma } from "@/lib/prisma";

/**
 * Record campaign-level metrics as observations per persona/vertical (from the campaign's leads).
 * Replaces any existing observations for this campaign so re-fetching doesn't duplicate.
 *
 * ATTRIBUTION CAVEAT: Instantly only exposes analytics at the campaign level, so the
 * SAME open/click/reply rate is written for EVERY persona and vertical present in the
 * batch. For a mixed-persona campaign this means the open/reply RATES cannot distinguish
 * one persona from another — they're identical by construction. Per-persona comparison is
 * only meaningful when a campaign targets a single persona/vertical. The trustworthy
 * per-persona signal is positive_reply_count, set per-lead by recordReplyObservation
 * (the reply webhook), not here. getStrategySuggestion ranks on that for this reason.
 */
export async function recordCampaignObservations(
  workspaceId: string,
  sentCampaignId: string,
  leadBatchId: string | null,
  metrics: { open_rate_pct: number; click_rate_pct: number; reply_count: number; bounce_rate_pct?: number; unsubscribe_rate_pct?: number }
): Promise<void> {
  await prisma.performanceObservation.deleteMany({
    where: { workspaceId, sourceType: "campaign", sourceId: sentCampaignId },
  });

  if (!leadBatchId) return;

  const leads = await prisma.lead.findMany({
    where: { leadBatchId },
    select: { persona: true, vertical: true },
  });

  const personas = Array.from(new Set(leads.map((l) => l.persona).filter((x): x is string => Boolean(x))));
  const verticals = Array.from(new Set(leads.map((l) => l.vertical).filter((x): x is string => Boolean(x))));

  if (personas.length === 0 && verticals.length === 0) return;

  const toCreate: Array<{
    workspaceId: string;
    dimensionType: string;
    dimensionValue: string;
    metric: string;
    value: number;
    sourceType: string;
    sourceId: string;
  }> = [];

  for (const p of personas) {
    toCreate.push({ workspaceId, dimensionType: "persona", dimensionValue: p, metric: "open_rate_pct", value: metrics.open_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
    toCreate.push({ workspaceId, dimensionType: "persona", dimensionValue: p, metric: "click_rate_pct", value: metrics.click_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
    toCreate.push({ workspaceId, dimensionType: "persona", dimensionValue: p, metric: "reply_count", value: metrics.reply_count, sourceType: "campaign", sourceId: sentCampaignId });
    if (metrics.bounce_rate_pct !== undefined) toCreate.push({ workspaceId, dimensionType: "persona", dimensionValue: p, metric: "bounce_rate_pct", value: metrics.bounce_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
    if (metrics.unsubscribe_rate_pct !== undefined) toCreate.push({ workspaceId, dimensionType: "persona", dimensionValue: p, metric: "unsubscribe_rate_pct", value: metrics.unsubscribe_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
  }
  for (const v of verticals) {
    toCreate.push({ workspaceId, dimensionType: "vertical", dimensionValue: v, metric: "open_rate_pct", value: metrics.open_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
    toCreate.push({ workspaceId, dimensionType: "vertical", dimensionValue: v, metric: "click_rate_pct", value: metrics.click_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
    toCreate.push({ workspaceId, dimensionType: "vertical", dimensionValue: v, metric: "reply_count", value: metrics.reply_count, sourceType: "campaign", sourceId: sentCampaignId });
    if (metrics.bounce_rate_pct !== undefined) toCreate.push({ workspaceId, dimensionType: "vertical", dimensionValue: v, metric: "bounce_rate_pct", value: metrics.bounce_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
    if (metrics.unsubscribe_rate_pct !== undefined) toCreate.push({ workspaceId, dimensionType: "vertical", dimensionValue: v, metric: "unsubscribe_rate_pct", value: metrics.unsubscribe_rate_pct, sourceType: "campaign", sourceId: sentCampaignId });
  }

  if (toCreate.length > 0) {
    await prisma.performanceObservation.createMany({ data: toCreate });
  }
}

/**
 * Record a reply classification as observations (persona/vertical from matching lead by email).
 */
export async function recordReplyObservation(
  workspaceId: string,
  campaignReplyId: string,
  fromEmail: string,
  classification: string | null
): Promise<void> {
  if (!classification) return;

  const lead = await prisma.lead.findFirst({
    where: {
      leadBatch: { workspaceId },
      email: fromEmail.trim(),
    },
    select: { persona: true, vertical: true },
  });

  const metric =
    classification === "positive" ? "positive_reply_count"
    : classification === "objection" ? "objection_count"
    : classification === "ooo" ? "ooo_count"
    : classification === "not_interested" ? "not_interested_count"
    : "other_reply_count";

  const toCreate: Array<{
    workspaceId: string;
    dimensionType: string;
    dimensionValue: string;
    metric: string;
    value: number;
    sourceType: string;
    sourceId: string;
  }> = [];

  if (lead?.persona) {
    toCreate.push({ workspaceId, dimensionType: "persona", dimensionValue: lead.persona, metric, value: 1, sourceType: "reply", sourceId: campaignReplyId });
  }
  if (lead?.vertical) {
    toCreate.push({ workspaceId, dimensionType: "vertical", dimensionValue: lead.vertical, metric, value: 1, sourceType: "reply", sourceId: campaignReplyId });
  }
  if (toCreate.length === 0) {
    toCreate.push({ workspaceId, dimensionType: "persona", dimensionValue: "unknown", metric, value: 1, sourceType: "reply", sourceId: campaignReplyId });
  }

  await prisma.performanceObservation.createMany({ data: toCreate });
}

/**
 * Get aggregated performance memory for the workspace (averages for rates, sums for counts).
 */
export async function getAggregatedMemory(workspaceId: string): Promise<{
  byPersona: Record<string, { open_rate_pct_avg?: number; click_rate_pct_avg?: number; reply_count_total?: number; positive_reply_count?: number; objection_count?: number; ooo_count?: number; not_interested_count?: number }>;
  byVertical: Record<string, { open_rate_pct_avg?: number; click_rate_pct_avg?: number; reply_count_total?: number; positive_reply_count?: number; objection_count?: number; ooo_count?: number; not_interested_count?: number }>;
}> {
  const observations = await prisma.performanceObservation.findMany({
    where: { workspaceId },
    select: { dimensionType: true, dimensionValue: true, metric: true, value: true },
  });

  const rateMetrics = ["open_rate_pct", "click_rate_pct"];
  const countMetrics = ["reply_count", "positive_reply_count", "objection_count", "ooo_count", "not_interested_count", "other_reply_count"];

  const byPersona: Record<string, Record<string, number[]>> = {};
  const byVertical: Record<string, Record<string, number[]>> = {};

  for (const o of observations) {
    const bucket = o.dimensionType === "persona" ? byPersona : byVertical;
    const key = o.dimensionValue || "unknown";
    if (!bucket[key]) bucket[key] = {};
    if (!bucket[key][o.metric]) bucket[key][o.metric] = [];
    bucket[key][o.metric].push(o.value);
  }

  const aggregate = (m: Record<string, number[]>) => {
    const out: Record<string, number> = {};
    for (const [metric, values] of Object.entries(m)) {
      if (rateMetrics.includes(metric)) {
        out[metric.replace("_pct", "_pct_avg")] = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;
      } else if (countMetrics.includes(metric)) {
        const sum = values.reduce((a, b) => a + b, 0);
        out[metric === "reply_count" ? "reply_count_total" : metric] = sum;
      }
    }
    return out;
  };

  const byPersonaOut: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(byPersona)) byPersonaOut[k] = aggregate(v);
  const byVerticalOut: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(byVertical)) byVerticalOut[k] = aggregate(v);

  return { byPersona: byPersonaOut as any, byVertical: byVerticalOut as any };
}

type Memory = Awaited<ReturnType<typeof getAggregatedMemory>>;

/**
 * Generate one short actionable suggestion from performance memory for the strategy engine.
 *
 * Signal priority: this is a reply-first system with NO links in any email, so
 * click rate is structurally ~0 and open rate is an unreliable proxy (Apple Mail
 * Privacy Protection auto-fires the tracking pixel, inflating opens). The real
 * north star is POSITIVE REPLIES — which are also the only metric attributed
 * accurately per persona/vertical (set per-lead by the reply webhook in
 * recordReplyObservation). Open rate is used only as a weak fallback when there
 * is not yet any positive-reply signal, and is always flagged as weak.
 */
export function getStrategySuggestion(memory: Memory): string | null {
  const personas = Object.entries(memory.byPersona);
  const verticals = Object.entries(memory.byVertical);

  // 1. Best persona by positive replies (strong, per-persona-accurate signal).
  const personasWithPositives = personas
    .filter(([, m]) => (m.positive_reply_count ?? 0) > 0)
    .sort((a, b) => (b[1].positive_reply_count ?? 0) - (a[1].positive_reply_count ?? 0));
  if (personasWithPositives.length > 0) {
    const [best, next] = personasWithPositives;
    const bestPos = best[1].positive_reply_count ?? 0;
    if (next) {
      return `"${best[0]}" is replying positively most (${bestPos} positive repl${bestPos === 1 ? "y" : "ies"}) — more than "${next[0]}". Double down on the angles that landed with ${best[0]}, and rework messaging for the weaker personas.`;
    }
    return `"${best[0]}" is your best-converting persona (${bestPos} positive repl${bestPos === 1 ? "y" : "ies"}). Generate more leads matching ${best[0]} and reuse the angles that worked.`;
  }

  // 2. Best vertical by positive replies.
  const verticalsWithPositives = verticals
    .filter(([, m]) => (m.positive_reply_count ?? 0) > 0)
    .sort((a, b) => (b[1].positive_reply_count ?? 0) - (a[1].positive_reply_count ?? 0));
  if (verticalsWithPositives.length > 0) {
    const [best] = verticalsWithPositives;
    const bestPos = best[1].positive_reply_count ?? 0;
    return `Vertical "${best[0]}" has the most positive replies (${bestPos}). Lean into messaging that resonates with ${best[0]} and test similar angles elsewhere.`;
  }

  // 3. Objections piling up with zero positives — the offer/angle needs work, not the subject line.
  const heavyObjections = personas
    .filter(([, m]) => (m.objection_count ?? 0) >= 3 && (m.positive_reply_count ?? 0) === 0)
    .sort((a, b) => (b[1].objection_count ?? 0) - (a[1].objection_count ?? 0));
  if (heavyObjections.length > 0) {
    const [worst] = heavyObjections;
    return `"${worst[0]}" is replying but pushing back (${worst[1].objection_count} objections, 0 positives). Change the offer or the reason-to-reply for this persona — the hook is landing but the ask isn't.`;
  }

  // 4. No reply signal yet — fall back to open rate, but explicitly mark it weak.
  const personasWithOpens = personas
    .filter(([, m]) => (m.open_rate_pct_avg ?? 0) > 0)
    .sort((a, b) => (b[1].open_rate_pct_avg ?? 0) - (a[1].open_rate_pct_avg ?? 0));
  if (personasWithOpens.length >= 2) {
    const [best, next] = personasWithOpens;
    const bestRate = best[1].open_rate_pct_avg ?? 0;
    const nextRate = next[1].open_rate_pct_avg ?? 0;
    if (bestRate - nextRate >= 5) {
      return `No positive replies logged yet, so this is a weak signal: "${best[0]}" opens more (${bestRate}%) than "${next[0]}" (${nextRate}%). Watch for positive replies before reading too much into opens — get the reply webhook live so replies are tracked.`;
    }
  }

  if (personas.length > 0 || verticals.length > 0) {
    return "Replies aren't being classified yet. Make sure the Instantly reply webhook is configured so positive replies get tracked — that's what the engine learns from.";
  }

  return null;
}
