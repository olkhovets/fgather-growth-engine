import { getInstantlyClientForWorkspaceId, type InstantlyClient } from "@/lib/instantly";

/**
 * Deliverability / inbox-placement diagnostic, extracted so BOTH the operator route
 * (app/api/instantly/domain-health) AND the autonomous loop (snapshot + optimizer) read
 * the same truth. This is the answer to "12k sent, 6 positives" — if the sending inboxes
 * are spam-foldering (low warmup health_score) the email never reaches a human, so no
 * amount of copy tuning matters. The loop must SEE this and refuse to scale into spam.
 */

// warmup_status: 1=Active, 0=Paused, -1=Banned, -2=Spam Unknown, -3=Permanent Suspension
const STATUS_LABEL: Record<number, string> = {
  1: "active", 0: "paused", [-1]: "banned", [-2]: "spam-flagged", [-3]: "suspended",
};
// Instantly's guidance: below ~80% inbox placement, pause cold sends from that inbox.
export const HEALTH_FLOOR = 80;

export type InboxHealth = {
  email: string;
  statusLabel: string;
  warmupStatus: number;
  dailyLimit: number | null;
  setupPending: boolean;
  healthScore: number | null;
  landedInbox: number | null;
  landedSpam: number | null;
};

export type DomainHealth = {
  domain: string;
  inboxCount: number;
  active: number;
  problematic: number; // banned + suspended + spam-flagged
  paused: number;
  setupPending: number;
  avgHealth: number | null; // avg health_score across inboxes that have one
  worstHealth: number | null;
  verdict: "healthy" | "watch" | "unhealthy" | "critical";
  reasons: string[];
  inboxes: InboxHealth[];
};

export type DeliverabilitySummary = {
  domains: number;
  inboxes: number;
  healthy: number;
  watch: number;
  unhealthy: number;
  critical: number;
  hasHealthData: boolean;
  /** Mean health_score across every scored inbox (0-100), or null if none scored. */
  avgHealth: number | null;
  /** Fraction of inboxes that are below the floor or dead — the share of capacity that can't reach a human. */
  blockedInboxPct: number;
  /** One-line verdict the loop can act on. */
  verdict: "healthy" | "watch" | "unhealthy" | "critical" | "unknown";
};

export type DeliverabilityReport = {
  summary: DeliverabilitySummary;
  domains: DomainHealth[];
};

function domainOf(email: string): string {
  return (email.split("@")[1] || "unknown").toLowerCase().trim();
}

/** Compute the full deliverability report from a live Instantly client. */
export async function computeDeliverability(client: InstantlyClient): Promise<DeliverabilityReport> {
  const accounts = await client.listAccounts();
  if (accounts.length === 0) {
    return {
      summary: { domains: 0, inboxes: 0, healthy: 0, watch: 0, unhealthy: 0, critical: 0, hasHealthData: false, avgHealth: null, blockedInboxPct: 0, verdict: "unknown" },
      domains: [],
    };
  }

  // Warmup health scores (best-effort — degrades to status-only if the endpoint is unavailable).
  const warmup = await client.getWarmupAnalytics(accounts.map((a) => a.email));

  const byDomain: Record<string, InboxHealth[]> = {};
  for (const a of accounts) {
    const agg = warmup[a.email];
    const inbox: InboxHealth = {
      email: a.email,
      warmupStatus: a.warmup_status,
      statusLabel: STATUS_LABEL[a.warmup_status] ?? `unknown(${a.warmup_status})`,
      dailyLimit: a.daily_limit ?? null,
      setupPending: a.setup_pending ?? false,
      healthScore: typeof agg?.health_score === "number" ? agg.health_score : null,
      landedInbox: typeof agg?.landed_inbox === "number" ? agg.landed_inbox : null,
      landedSpam: typeof agg?.landed_spam === "number" ? agg.landed_spam : null,
    };
    (byDomain[domainOf(a.email)] ||= []).push(inbox);
  }

  const domains: DomainHealth[] = [];
  for (const [domain, inboxes] of Object.entries(byDomain)) {
    const active = inboxes.filter((i) => i.warmupStatus === 1).length;
    const paused = inboxes.filter((i) => i.warmupStatus === 0).length;
    const problematic = inboxes.filter((i) => i.warmupStatus < 0).length;
    const setupPending = inboxes.filter((i) => i.setupPending).length;
    const scored = inboxes.map((i) => i.healthScore).filter((s): s is number => s !== null);
    const avgHealth = scored.length > 0 ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
    const worstHealth = scored.length > 0 ? Math.min(...scored) : null;

    const reasons: string[] = [];
    if (problematic > 0) reasons.push(`${problematic} inbox${problematic === 1 ? "" : "es"} banned/suspended/spam-flagged`);
    if (avgHealth !== null && avgHealth < HEALTH_FLOOR) reasons.push(`avg health ${avgHealth}% (below ${HEALTH_FLOOR}% floor)`);
    else if (worstHealth !== null && worstHealth < HEALTH_FLOOR) reasons.push(`an inbox at ${worstHealth}% health`);
    if (paused > 0) reasons.push(`${paused} paused`);
    if (setupPending > 0) reasons.push(`${setupPending} still setting up`);

    let verdict: DomainHealth["verdict"] = "healthy";
    if (problematic > 0 || (avgHealth !== null && avgHealth < 50)) verdict = "critical";
    else if ((avgHealth !== null && avgHealth < HEALTH_FLOOR) || (worstHealth !== null && worstHealth < 60)) verdict = "unhealthy";
    else if (paused > 0 || setupPending > 0 || (avgHealth !== null && avgHealth < 90)) verdict = "watch";

    domains.push({
      domain, inboxCount: inboxes.length, active, problematic, paused, setupPending,
      avgHealth, worstHealth, verdict, reasons,
      inboxes: inboxes.sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101)),
    });
  }

  const rank: Record<DomainHealth["verdict"], number> = { critical: 0, unhealthy: 1, watch: 2, healthy: 3 };
  domains.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (a.avgHealth ?? 101) - (b.avgHealth ?? 101));

  // Capacity that can't reach a human: dead inboxes + inboxes scored below the floor.
  const blocked = accounts.length === 0 ? 0 : domains.reduce((n, d) => {
    return n + d.inboxes.filter((i) => i.warmupStatus < 0 || (i.healthScore !== null && i.healthScore < HEALTH_FLOOR)).length;
  }, 0);
  const allScored = domains.flatMap((d) => d.inboxes.map((i) => i.healthScore)).filter((s): s is number => s !== null);
  const avgHealth = allScored.length > 0 ? Math.round(allScored.reduce((a, b) => a + b, 0) / allScored.length) : null;

  const critical = domains.filter((d) => d.verdict === "critical").length;
  const unhealthy = domains.filter((d) => d.verdict === "unhealthy").length;
  const watch = domains.filter((d) => d.verdict === "watch").length;
  const healthy = domains.filter((d) => d.verdict === "healthy").length;
  const hasHealthData = Object.keys(warmup).length > 0;

  // Workspace-level verdict the loop acts on: worst-case bias toward caution.
  let verdict: DeliverabilitySummary["verdict"] = "unknown";
  if (hasHealthData || domains.length > 0) {
    if (critical > 0 || (avgHealth !== null && avgHealth < 50)) verdict = "critical";
    else if (unhealthy > 0 || (avgHealth !== null && avgHealth < HEALTH_FLOOR)) verdict = "unhealthy";
    else if (watch > 0 || (avgHealth !== null && avgHealth < 90)) verdict = "watch";
    else verdict = "healthy";
  }

  return {
    summary: {
      domains: domains.length,
      inboxes: accounts.length,
      healthy, watch, unhealthy, critical,
      hasHealthData,
      avgHealth,
      blockedInboxPct: accounts.length > 0 ? Math.round((blocked / accounts.length) * 1000) / 10 : 0,
      verdict,
    },
    domains,
  };
}

/** Loop-friendly wrapper: build the client for a workspace and return a compact summary. */
export async function getDeliverabilityForWorkspace(workspaceId: string): Promise<DeliverabilitySummary | null> {
  const ctx = await getInstantlyClientForWorkspaceId(workspaceId);
  if (!ctx) return null;
  try {
    const { summary } = await computeDeliverability(ctx.client);
    return summary;
  } catch {
    return null;
  }
}
