import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Per-domain deliverability diagnostic. Pulls every sending inbox (warmup status, daily limit,
 * setup state) and its warmup health score (inbox-vs-spam placement), then groups by sending
 * domain so we can see WHICH domains are dragging deliverability down. This is the answer to
 * "14k sent, 0 replies" — a domain full of banned / spam-foldering inboxes never reaches a human.
 */

// warmup_status: 1=Active, 0=Paused, -1=Banned, -2=Spam Unknown, -3=Permanent Suspension
const STATUS_LABEL: Record<number, string> = {
  1: "active", 0: "paused", [-1]: "banned", [-2]: "spam-flagged", [-3]: "suspended",
};
const HEALTH_FLOOR = 80; // Instantly's guidance: below ~80% inbox placement, pause cold sends

type InboxHealth = {
  email: string;
  statusLabel: string;
  warmupStatus: number;
  dailyLimit: number | null;
  setupPending: boolean;
  healthScore: number | null;
  landedInbox: number | null;
  landedSpam: number | null;
};

type DomainHealth = {
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

function domainOf(email: string): string {
  return (email.split("@")[1] || "unknown").toLowerCase().trim();
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) return NextResponse.json({ error: "Add your Instantly API key in Settings first." }, { status: 400 });
    const { client } = ctx;

    const accounts = await client.listAccounts();
    if (accounts.length === 0) {
      return NextResponse.json({ summary: { domains: 0, inboxes: 0, healthy: 0, unhealthy: 0, critical: 0 }, domains: [] });
    }

    // Warmup health scores (best-effort — degrades to status-only if the endpoint is unavailable).
    const warmup = await client.getWarmupAnalytics(accounts.map((a) => a.email));

    // Group inboxes by sending domain.
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

      // Verdict: critical if any inbox is dead or placement is collapsing; unhealthy if below the
      // health floor or has dead inboxes; watch for soft signals; else healthy.
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

    // Worst domains first so the operator sees what to fix immediately.
    const rank: Record<DomainHealth["verdict"], number> = { critical: 0, unhealthy: 1, watch: 2, healthy: 3 };
    domains.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (a.avgHealth ?? 101) - (b.avgHealth ?? 101));

    const summary = {
      domains: domains.length,
      inboxes: accounts.length,
      healthy: domains.filter((d) => d.verdict === "healthy").length,
      watch: domains.filter((d) => d.verdict === "watch").length,
      unhealthy: domains.filter((d) => d.verdict === "unhealthy").length,
      critical: domains.filter((d) => d.verdict === "critical").length,
      hasHealthData: Object.keys(warmup).length > 0,
    };

    return NextResponse.json({ summary, domains });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read domain health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
