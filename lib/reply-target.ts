import { prisma } from "@/lib/prisma";
import { getDeliverabilityForWorkspace } from "@/lib/deliverability";
import { rateStylesByReply } from "@/lib/style-performance";

/**
 * Reply-rate WAR ROOM. The target is 2% positive-reply rate. We're near 0.05%, a ~40x gap — which is
 * NOT a copy problem at that magnitude. This computes the current rate, the gap, and the ONE binding
 * constraint to attack right now, so every session (and Peter at the CLI) works the real lever instead
 * of polishing copy while the engine isn't even sending or is foldering into spam.
 *
 * Honest multiplier model (stacked): deliverability fix (if in spam) ~5-20x · tight targeting ~3x ·
 * real hyper-personalization ~2-3x · style/offer ~1.5-2x. 2% is reachable ONLY if deliverability is
 * the main culprit and gets fixed; if placement is already clean, 0.05% means targeting/offer/PMF and
 * the honest move is to fix those (or pivot channel), not to write more emails.
 */

export const TARGET_RATE_PCT = 2.0;

export type Lever = { name: string; status: "blocked" | "unknown" | "ok" | "attack-now"; expectedMultiplier: string; action: string };

export type ReplyTarget = {
  targetPct: number;
  currentPct: number;
  totalSent: number;
  totalPositive: number;
  gapMultiple: number | null;       // how many x we need to grow the rate
  sending: { status: "off" | "trickle" | "active"; sent24: number; recycled24: number; freshPool: number; autopilotOn: boolean; offerOn: boolean };
  deliverability: { verdict: string; avgHealth: number | null; blockedInboxPct: number } | null;
  winningStyle: string | null;
  bindingConstraint: string;        // the single most important thing right now
  levers: Lever[];                  // ordered, highest-leverage first
  verdict: string;                  // one-line plain-English call
};

export async function computeReplyTarget(workspaceId: string): Promise<ReplyTarget> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [ws, totalSent, totalPositive, sent24, recycled24, freshPool, deliverability, stylePerf] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { autopilot: true, incentivesAutopilot: true } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: { not: null } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: { not: null }, replyStatus: "positive" } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: { gte: since } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, recycledAt: { gte: since } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: null, suppressed: false, repliedAt: null, email: { not: "" } } }),
    getDeliverabilityForWorkspace(workspaceId),
    rateStylesByReply(workspaceId),
  ]);

  const currentPct = totalSent > 0 ? Math.round((totalPositive / totalSent) * 100000) / 1000 : 0;
  const gapMultiple = currentPct > 0 ? Math.round((TARGET_RATE_PCT / currentPct) * 10) / 10 : null;
  const totalVol24 = sent24 + recycled24;
  const autopilotOn = !!ws?.autopilot;
  const offerOn = !!ws?.incentivesAutopilot;
  const sendStatus: "off" | "trickle" | "active" = totalVol24 >= 100 ? "active" : totalVol24 > 0 ? "trickle" : "off";

  const placementBad = !!deliverability && (deliverability.verdict === "unhealthy" || deliverability.verdict === "critical");
  const placementUnknown = !deliverability || deliverability.verdict === "unknown";

  // --- the binding constraint, in priority order ---
  let bindingConstraint: string;
  let verdict: string;
  if (sendStatus === "off") {
    bindingConstraint = "NOT SENDING — 0 real volume in 24h. Nothing about reply rate matters until email is flowing.";
    verdict = freshPool < 100
      ? "Engine is idle AND the fresh-lead pool is starving. Top up Apollo / recycle the pool, then turn sending on."
      : "Leads are ready but autopilot is off. Turn sending on (paced) — that's the whole gate.";
  } else if (sendStatus === "trickle") {
    bindingConstraint = `TRICKLE — only ${totalVol24} sent in 24h. Too little to learn from or to book meetings.`;
    verdict = freshPool < 100 ? "Refill the lead pool (Apollo/recycle) so volume can ramp." : "Raise the daily cap and let it ramp — you have the pool.";
  } else if (placementBad) {
    bindingConstraint = `DELIVERABILITY — inbox placement ${deliverability!.verdict} (avg ${deliverability!.avgHealth ?? "?"}%). Mail is foldering into spam; that alone explains a ~0.05% rate.`;
    verdict = "Pause/replace the bad inboxes and re-warm before any copy work. This is likely your 5-20x lever.";
  } else if (placementUnknown) {
    bindingConstraint = "DELIVERABILITY UNKNOWN — no inbox-placement data. This is the prime suspect for a sub-0.1% rate and must be ruled out first.";
    verdict = "Get warmup/health data flowing (Instantly key + the domain-health read) so we can confirm or kill the spam hypothesis.";
  } else if (currentPct < 0.5) {
    bindingConstraint = `TARGETING / OFFER — placement is ${deliverability!.verdict} but rate is ${currentPct}%. Below 0.5% with clean inboxes points to list fit or the offer, not the subject line.`;
    verdict = "Tighten to small high-fit lists (data: ~3x vs blasts) and hyper-personalize sentence 1. If a clean 200-lead precision test still flops, it's PMF/channel, not copy.";
  } else {
    bindingConstraint = `COPY / STYLE — fundamentals are clean and rate is ${currentPct}%. Now the lever is creative: style experiments + hyper-personalization.`;
    verdict = "Run the style factory + research experiments hard; favor the winning style; deepen per-lead personalization.";
  }

  const levers: Lever[] = [
    { name: "Sending live + volume", status: sendStatus === "active" ? "ok" : sendStatus === "trickle" ? "attack-now" : "blocked", expectedMultiplier: "gate (0→1)", action: "Autopilot on, paced; keep the fresh pool full (Apollo/recycle)." },
    { name: "Deliverability (inbox placement)", status: placementBad ? "attack-now" : placementUnknown ? "unknown" : "ok", expectedMultiplier: "5-20x if in spam", action: "Keep avg health ≥80%; pause dead inboxes; don't scale into spam." },
    { name: "Targeting tightness", status: "unknown", expectedMultiplier: "~3x", action: "Small high-fit lists over blasts; raise the ICP fit-screen bar." },
    { name: "Hyper-personalization", status: "unknown", expectedMultiplier: "2-3x", action: "Sentence 1 must name a real, specific trigger for THIS company; regenerate generic openers." },
    { name: "Style + offer experiments", status: stylePerf.leader ? "ok" : "unknown", expectedMultiplier: "1.5-2x", action: `Style factory + research experiments; favor the winner${stylePerf.leader ? ` (currently "${stylePerf.leader}")` : ""}.` },
  ];

  return {
    targetPct: TARGET_RATE_PCT,
    currentPct,
    totalSent,
    totalPositive,
    gapMultiple,
    sending: { status: sendStatus, sent24, recycled24, freshPool, autopilotOn, offerOn },
    deliverability: deliverability ? { verdict: deliverability.verdict, avgHealth: deliverability.avgHealth, blockedInboxPct: deliverability.blockedInboxPct } : null,
    winningStyle: stylePerf.leader,
    bindingConstraint,
    levers,
    verdict,
  };
}
