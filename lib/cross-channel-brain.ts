import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { PERSONAS } from "@/lib/apollo-personas";
import { getLinkedInSignal } from "@/lib/cross-channel";

/**
 * THE GROWTH BRAIN — the self-improving layer over the cross-channel loop.
 *
 * The loop already produces a fused signal; a human still has to read it and act.
 * This grades every persona across BOTH channels into a scoreboard, then turns
 * the scoreboard into a ranked, concrete ACTION PLAN ("pull more Consumer Insights
 * leads", "generate ads for Growth", "refresh the audience"). It is deterministic
 * (no LLM call, no spend) so it is safe to run on a cron, and it runs in
 * recommend-only mode: it logs + returns the plan but does NOT execute. Flip
 * `execute: true` (and wire the action handlers) once you trust the calls — the
 * plan items already name the exact endpoint each one would hit.
 *
 * IMPORTANT honesty note on measurement: LinkedIn only reports AGGREGATE
 * demographics, never which individual contact saw an ad. So we cannot compute a
 * true account-level "overlap lift". What we CAN measure honestly is PERSONA-level
 * correlation: does a persona with high ad CTR also show a rising email positive
 * rate? The scoreboard exposes both numbers per persona so that trend becomes
 * visible run over run; it does not claim per-account attribution it can't prove.
 */

const personaLabel = (key: string): string => PERSONAS.find((p) => p.key === key)?.label ?? key;

export type ScoreRow = {
  persona: string;
  label: string;
  emailSends: number;
  emailPositives: number;
  emailPosRatePct: number;
  liImpressions: number;
  liClicks: number;
  liCtrPct: number;
  verdict: "scale" | "untapped" | "no_ads" | "cooling" | "watch";
  verdictLabel: string;
};

export type BrainAction = {
  priority: number;        // 1 = do first
  type: "apollo_pull" | "push_ads" | "refresh_audience" | "rework_offer";
  persona: string | null;
  label: string;
  why: string;
  endpoint: string | null; // the exact call this maps to when execute is enabled
};

export type GrowthBrainResult = {
  scoreboard: ScoreRow[];
  actions: BrainAction[];
  executed: boolean;
  generatedFrom: { email: boolean; linkedin: boolean };
};

const VERDICT_LABEL: Record<ScoreRow["verdict"], string> = {
  scale: "Scale — converting on both channels",
  untapped: "Untapped — ad demand, thin email coverage",
  no_ads: "No ad presence — has email wins",
  cooling: "Cooling — replying but pushing back",
  watch: "Watch — not enough signal yet",
};

export async function buildScoreboard(workspaceId: string): Promise<ScoreRow[]> {
  const [sentByPersona, posByPersona, objByPersona, li] = await Promise.all([
    prisma.lead.groupBy({ by: ["persona"], where: { leadBatch: { workspaceId }, sentAt: { not: null } }, _count: true }),
    prisma.lead.groupBy({ by: ["persona"], where: { leadBatch: { workspaceId }, sentAt: { not: null }, replyStatus: "positive" }, _count: true }),
    prisma.lead.groupBy({ by: ["persona"], where: { leadBatch: { workspaceId }, sentAt: { not: null }, replyStatus: "objection" }, _count: true }),
    getLinkedInSignal(workspaceId),
  ]);

  const sent = new Map<string, number>();
  const pos = new Map<string, number>();
  const obj = new Map<string, number>();
  for (const r of sentByPersona) if (r.persona) sent.set(r.persona, r._count);
  for (const r of posByPersona) if (r.persona) pos.set(r.persona, r._count);
  for (const r of objByPersona) if (r.persona) obj.set(r.persona, r._count);

  const keys = Array.from(new Set<string>([...Array.from(sent.keys()), ...Object.keys(li.byPersona)]));

  const rows: ScoreRow[] = keys.map((persona) => {
    const emailSends = sent.get(persona) ?? 0;
    const emailPositives = pos.get(persona) ?? 0;
    const emailObjections = obj.get(persona) ?? 0;
    const emailPosRatePct = emailSends > 0 ? Math.round((emailPositives / emailSends) * 1000) / 10 : 0;
    const liStat = li.byPersona[persona] ?? { impressions: 0, clicks: 0, ctr: 0 };

    let verdict: ScoreRow["verdict"] = "watch";
    if (emailPositives > 0 && liStat.clicks > 0) verdict = "scale";
    else if (liStat.clicks > 0 && (emailSends < 50 || emailPosRatePct === 0)) verdict = "untapped";
    else if (emailPositives > 0 && liStat.impressions === 0) verdict = "no_ads";
    else if (emailObjections >= 3 && emailPositives === 0) verdict = "cooling";

    return {
      persona, label: personaLabel(persona),
      emailSends, emailPositives, emailPosRatePct,
      liImpressions: liStat.impressions, liClicks: liStat.clicks, liCtrPct: liStat.ctr,
      verdict, verdictLabel: VERDICT_LABEL[verdict],
    };
  });

  // Rank: scale first, then untapped, then no_ads, then cooling, then watch.
  const order: Record<ScoreRow["verdict"], number> = { scale: 0, untapped: 1, no_ads: 2, cooling: 3, watch: 4 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || b.emailPositives - a.emailPositives || b.liClicks - a.liClicks);
  return rows;
}

/** Turn the scoreboard into a concrete, ranked action plan. */
export function recommendActions(scoreboard: ScoreRow[]): BrainAction[] {
  const actions: BrainAction[] = [];
  let p = 1;
  for (const row of scoreboard) {
    if (row.verdict === "scale") {
      actions.push({ priority: p++, type: "push_ads", persona: row.persona, label: `Double down on ${row.label}`, why: `Converting on both channels (${row.emailPositives} positive replies, ${row.liClicks} ad clicks at ${row.liCtrPct}% CTR). Generate fresh ads + keep them top of the email queue.`, endpoint: "POST /api/linkedin/push-ads" });
    } else if (row.verdict === "untapped") {
      actions.push({ priority: p++, type: "apollo_pull", persona: row.persona, label: `Pull more ${row.label} from Apollo`, why: `${row.liClicks} ad clicks (${row.liCtrPct}% CTR) but only ${row.emailSends} emailed — there's warm demand the email list hasn't reached. Rotate the Apollo title search toward ${row.label} and cold-email them.`, endpoint: "POST /api/apollo/ingest" });
    } else if (row.verdict === "no_ads") {
      actions.push({ priority: p++, type: "push_ads", persona: row.persona, label: `Put ${row.label} on LinkedIn`, why: `${row.emailPositives} positive email replies but zero ad presence. Mirror the winning email angle into ad creative aimed at ${row.label}.`, endpoint: "POST /api/linkedin/push-ads" });
    } else if (row.verdict === "cooling") {
      actions.push({ priority: p++, type: "rework_offer", persona: row.persona, label: `Rework the offer for ${row.label}`, why: `Replying but pushing back (objections, no positives). The hook lands, the ask doesn't — change the incentive or reason-to-reply, don't just rewrite the subject.`, endpoint: null });
    }
  }
  // Always-on hygiene action: refresh the surround-sound audience.
  actions.push({ priority: p++, type: "refresh_audience", persona: null, label: "Refresh the LinkedIn matched audience", why: "Re-export the active-accounts audience so newly emailed accounts also get surrounded on the feed.", endpoint: "GET /api/linkedin/matched-audience?status=active" });
  return actions;
}

/**
 * Run the brain for a workspace. Recommend-only by default (execute=false): it
 * logs the plan and returns it. When execute is wired on, each action maps to the
 * endpoint named on it.
 */
export async function runGrowthBrain(workspaceId: string, opts: { execute?: boolean } = {}): Promise<GrowthBrainResult> {
  const scoreboard = await buildScoreboard(workspaceId);
  const actions = recommendActions(scoreboard);
  const executed = false; // execution intentionally not wired yet — safe by design

  const top = actions.slice(0, 3).map((a) => `#${a.priority} ${a.label}`).join("; ");
  await logActivity(
    workspaceId,
    "info",
    `Growth brain: ${scoreboard.length} persona(s) graded, ${actions.length} action(s) recommended.${top ? ` Top: ${top}.` : ""}`,
    { kind: "growth_brain", scoreboard, actions, executed }
  );

  return {
    scoreboard,
    actions,
    executed,
    generatedFrom: { email: scoreboard.some((r) => r.emailSends > 0), linkedin: scoreboard.some((r) => r.liImpressions > 0) },
  };
}
