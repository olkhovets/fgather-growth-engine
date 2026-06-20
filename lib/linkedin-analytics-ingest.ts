import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { personaForTitle } from "@/lib/apollo-personas";

/**
 * FEEDBACK PIPE (LinkedIn ad drafter → email engine).
 *
 * The ad-drafter dashboard scrapes per-ad-set analytics and professional-
 * demographic breakdowns (job title, seniority, industry...) from LinkedIn
 * Campaign Manager. Its "Export to engine" button POSTs that here. We:
 *   1. record channel-level totals (spend/impressions/clicks/leads/CTR), and
 *   2. map the job-title demographics onto the SAME persona taxonomy the email
 *      engine uses (personaForTitle), so "who engaged the ads" becomes a per-
 *      persona signal that reweights who we cold-email next.
 *
 * Storage is migration-free: everything lands in PerformanceObservation with
 * sourceType "linkedin" (idempotent — each ingest replaces the prior snapshot),
 * plus a full snapshot in the activity log for the cross-channel dashboard.
 */

export type LinkedInAdSet = {
  name?: string; type?: string;
  spend?: number; impressions?: number; clicks?: number; ctr?: number;
  cpm?: number; cpc?: number; leads?: number; cpl?: number; conversions?: number;
  sends?: number; opens?: number; openRate?: number; daysLive?: number; peerCtr?: number;
};
export type LinkedInDemoDimension = {
  dimension?: string; label?: string;
  topRows?: Array<{ name?: string; impressions?: number; clicks?: number; ctr?: number; cpc?: number; spend?: number }>;
};
export type LinkedInAnalyticsPayload = {
  dateRange?: { from?: string; to?: string };
  account?: string;
  adSets?: LinkedInAdSet[];
  demographics?: LinkedInDemoDimension[];
  summary?: { totalSpend?: number; totalImpressions?: number; totalClicks?: number; totalLeads?: number; totalConversions?: number };
  trend?: unknown;
};

const n = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);

type Obs = { workspaceId: string; dimensionType: string; dimensionValue: string; metric: string; value: number; sourceType: string; sourceId: string };

export async function ingestLinkedInAnalytics(
  workspaceId: string,
  payload: LinkedInAnalyticsPayload
): Promise<{ adSets: number; personas: Record<string, { impressions: number; clicks: number; ctr: number }>; totals: Record<string, number> }> {
  const adSets = Array.isArray(payload.adSets) ? payload.adSets : [];

  // --- Channel totals (recompute from ad sets so we never trust a stale summary) ---
  const totals = {
    spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0,
  };
  for (const a of adSets) {
    totals.spend += n(a.spend);
    totals.impressions += n(a.impressions);
    totals.clicks += n(a.clicks);
    totals.leads += n(a.leads);
    totals.conversions += n(a.conversions);
  }
  const overallCtr = totals.impressions > 0 ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : 0; // %

  // --- Map job-title demographics onto the engine's persona taxonomy ---
  const titleDim = (payload.demographics || []).find(
    (d) => (d.dimension || "").toUpperCase().includes("JOB_TITLE")
  );
  const personas: Record<string, { impressions: number; clicks: number }> = {};
  for (const row of titleDim?.topRows || []) {
    const persona = personaForTitle(row.name);
    (personas[persona] ||= { impressions: 0, clicks: 0 }).impressions += n(row.impressions);
    personas[persona].clicks += n(row.clicks);
  }
  const personasOut: Record<string, { impressions: number; clicks: number; ctr: number }> = {};
  for (const [k, v] of Object.entries(personas)) {
    personasOut[k] = { ...v, ctr: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0 };
  }

  // --- Idempotent write: clear prior LinkedIn snapshot, then re-record ---
  const obs: Obs[] = [];
  obs.push(
    { workspaceId, dimensionType: "channel", dimensionValue: "linkedin", metric: "li_spend", value: Math.round(totals.spend * 100) / 100, sourceType: "linkedin", sourceId: "linkedin-summary" },
    { workspaceId, dimensionType: "channel", dimensionValue: "linkedin", metric: "li_impressions", value: totals.impressions, sourceType: "linkedin", sourceId: "linkedin-summary" },
    { workspaceId, dimensionType: "channel", dimensionValue: "linkedin", metric: "li_clicks", value: totals.clicks, sourceType: "linkedin", sourceId: "linkedin-summary" },
    { workspaceId, dimensionType: "channel", dimensionValue: "linkedin", metric: "li_leads", value: totals.leads, sourceType: "linkedin", sourceId: "linkedin-summary" },
    { workspaceId, dimensionType: "channel", dimensionValue: "linkedin", metric: "li_conversions", value: totals.conversions, sourceType: "linkedin", sourceId: "linkedin-summary" },
    { workspaceId, dimensionType: "channel", dimensionValue: "linkedin", metric: "li_ctr_pct", value: overallCtr, sourceType: "linkedin", sourceId: "linkedin-summary" },
  );
  for (const [persona, v] of Object.entries(personasOut)) {
    obs.push(
      { workspaceId, dimensionType: "persona", dimensionValue: persona, metric: "li_impressions", value: v.impressions, sourceType: "linkedin", sourceId: "linkedin-demo" },
      { workspaceId, dimensionType: "persona", dimensionValue: persona, metric: "li_clicks", value: v.clicks, sourceType: "linkedin", sourceId: "linkedin-demo" },
    );
  }

  await prisma.$transaction([
    prisma.performanceObservation.deleteMany({ where: { workspaceId, sourceType: "linkedin" } }),
    prisma.performanceObservation.createMany({ data: obs }),
  ]);

  // Full snapshot for the cross-channel dashboard (latest wins; read by getLinkedInSignal).
  await logActivity(
    workspaceId,
    "info",
    `LinkedIn analytics ingested: ${adSets.length} ad set(s), ${totals.impressions} impressions, ${totals.clicks} clicks, ${totals.leads} leads, $${Math.round(totals.spend)} spend.`,
    {
      kind: "linkedin_snapshot",
      dateRange: payload.dateRange ?? null,
      account: payload.account ?? null,
      totals: { ...totals, ctrPct: overallCtr },
      adSets: adSets.slice(0, 50),
      personas: personasOut,
      demographics: payload.demographics ?? [],
    }
  );

  return { adSets: adSets.length, personas: personasOut, totals: { ...totals, ctrPct: overallCtr } };
}
