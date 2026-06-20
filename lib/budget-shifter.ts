import { getLinkedInSignal } from "@/lib/cross-channel";

/**
 * BUDGET SHIFTER. Total LinkedIn ad budget = (# of running ads) × $50. Rank the
 * ads by performance, recommend pausing the losers, and reallocate their budget
 * to the winners. RECOMMEND-ONLY: LinkedIn has no API to pause ads or set budgets,
 * so the actual pause/reallocation is a click the operator makes in Campaign
 * Manager. This produces the exact plan to execute.
 *
 * CTR tiers mirror the ad-drafter dashboard's own thresholds (LinkedIn reports CTR
 * as a 0-1 decimal): good ≥0.65%, ok 0.40-0.65%, bad <0.40% (LinkedIn suppresses
 * delivery below ~0.40%, so those ads are money down the drain).
 */

const PER_AD = 50;
const CTR_GOOD = 0.0065;
const CTR_OK = 0.004;

type AdSet = { name?: string; type?: string; impressions?: number; clicks?: number; ctr?: number; spend?: number; leads?: number; cpl?: number; conversions?: number };

export type AdAllocation = {
  name: string;
  type: string;
  impressions: number;
  ctrPct: number;
  leads: number;
  cpl: number;
  verdict: "scale" | "keep" | "pause";
  recommendedBudget: number;
};

export type BudgetPlan = {
  runningAds: number;
  totalBudget: number;
  freedFromPauses: number;
  allocations: AdAllocation[];
  moves: string[];
  hasData: boolean;
};

export async function buildBudgetPlan(workspaceId: string): Promise<BudgetPlan> {
  const li = await getLinkedInSignal(workspaceId);
  const adSets = (li.snapshot.adSets as AdSet[]).filter((a) => (a?.impressions ?? 0) > 0); // only ads actually running

  if (adSets.length === 0) {
    return { runningAds: 0, totalBudget: 0, freedFromPauses: 0, allocations: [], moves: [], hasData: false };
  }

  const totalBudget = adSets.length * PER_AD;

  // Tier each ad — CONVERSION-AWARE, not just CTR. A great CTR with zero downstream
  // conversion is money drawing clicks that don't become demos, not a winner. Judge
  // each ad by its real goal: lead-gen by leads, website-visit by conversions, with
  // CTR only as the throttle floor (LinkedIn suppresses delivery below 0.40%).
  const tiered = adSets.map((a) => {
    const ctr = a.ctr ?? 0;
    const type = a.type || "ad";
    const leads = a.leads ?? 0;
    const conv = a.conversions ?? 0;
    const clicks = a.clicks ?? Math.round((a.impressions ?? 0) * ctr);
    let verdict: AdAllocation["verdict"];
    if (ctr < CTR_OK) {
      verdict = "pause"; // LinkedIn is throttling it regardless of type
    } else if (type === "lead_gen") {
      verdict = leads > 0 ? "scale" : clicks >= 150 ? "pause" : "keep"; // clicks but no form fills = waste
    } else if (type === "website_visit") {
      verdict = conv > 0 && ctr >= CTR_GOOD ? "scale" : "keep"; // scale only with downstream proof; don't pour budget into clicks that don't convert
    } else {
      verdict = ctr >= CTR_GOOD ? "scale" : "keep";
    }
    return {
      name: a.name || "(unnamed)",
      type,
      impressions: a.impressions ?? 0,
      ctrPct: Math.round(ctr * 10000) / 100,
      leads,
      cpl: a.cpl ?? 0,
      ctr,
      verdict,
    };
  });

  const survivors = tiered.filter((t) => t.verdict !== "pause");
  const paused = tiered.filter((t) => t.verdict === "pause");
  const freedFromPauses = paused.length * PER_AD;

  // Reallocate the whole budget across survivors, weighting "scale" 1.5x over "keep".
  // If every ad is a loser, keep them all on a floor so we don't zero out spend blindly.
  const weight = (v: AdAllocation["verdict"]) => (v === "scale" ? 1.5 : v === "keep" ? 1 : 0);
  const weightSum = survivors.reduce((s, t) => s + weight(t.verdict), 0);

  const allocations: AdAllocation[] = tiered.map((t) => {
    let recommendedBudget = 0;
    if (t.verdict !== "pause" && weightSum > 0) {
      recommendedBudget = Math.round((totalBudget * weight(t.verdict)) / weightSum);
    }
    return { name: t.name, type: t.type, impressions: t.impressions, ctrPct: t.ctrPct, leads: t.leads, cpl: t.cpl, verdict: t.verdict, recommendedBudget };
  });

  const moves: string[] = [];

  // Channel-level conversion-leak alarm: strong clicks, weak leads/conversions = the
  // problem is post-click (landing/offer/capture), not the ad. Surface it first.
  const t = li.totals;
  const downstream = (t.leads ?? 0) + (t.conversions ?? 0);
  if (t.spend > 500 && downstream < t.spend / 200) {
    const cpl = downstream > 0 ? `~$${Math.round(t.spend / downstream)}/conversion` : "near-zero conversion";
    moves.push(`⚠ Conversion leak: $${Math.round(t.spend)} spent, ${t.clicks} clicks (${t.ctrPct}% CTR — strong) but only ${t.leads} leads / ${t.conversions} conversions (${cpl}). Clicks aren't the problem — fix the post-click path (landing page, offer, or add a lead form to website-visit ads) BEFORE adding spend.`);
  }

  for (const p of paused) {
    const reason = p.ctr < CTR_OK
      ? `${p.ctrPct}% CTR — below 0.40%, LinkedIn is throttling it`
      : `drew clicks but 0 leads — the form isn't converting`;
    moves.push(`Pause "${p.name}" (${reason}) → frees $${PER_AD}/day.`);
  }
  const topScale = allocations.filter((a) => a.verdict === "scale").sort((a, b) => b.ctrPct - a.ctrPct)[0];
  if (topScale && paused.length > 0) {
    moves.push(`Move the freed $${freedFromPauses}/day toward proven converters like "${topScale.name}" (${topScale.ctrPct}% CTR) — new target $${topScale.recommendedBudget}/day.`);
  }
  if (paused.length === 0 && survivors.length > 0) moves.push("No ad is below the kill line — hold budgets, keep watching conversion (not just CTR).");

  return { runningAds: adSets.length, totalBudget, freedFromPauses, allocations, moves, hasData: true };
}
