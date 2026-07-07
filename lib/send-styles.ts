/**
 * The one source of truth for WHICH email styles the engine sends (shared by send-batch + send-preview,
 * so the sender and the "what's going out" preview never disagree).
 *
 * STANDING OKR (see memory okr-reply-formula): get people to REPLY. We are desperate and trying
 * EVERYTHING, so the roster is WIDE — quirky/attention styles AND proof-led/research-led styles all
 * stay in. The real lever is not the style list; it's the REPLY FORMULA injected into every generation
 * (attention subject + ultra-punchy body + deep per-lead research + common-ground proof-of-outcome +
 * human, zero AI tells). Quirky is explicitly kept.
 *
 * FRESH_STYLES drives what gets freshly written each round (the bulk of a send at founderShare).
 * GOOD_STYLES is the filter for which already-drafted leads are eligible to send.
 */

/** Freshly-written each round — a wide blend so we test everything: attention-grabbing + proof-led + research-led. */
export const FRESH_STYLES = [
  "quirky-incentive", "direct-incentive", "outcome-hook", "founder-incentive",
  "curiosity-gap", "lean-personal", "specialist-proof",
];

/** Eligible-to-send filter — every style we're willing to ship. Wide on purpose (try everything). */
export const GOOD_STYLES = [
  "quirky-incentive", "outcome-hook", "curiosity-gap", "direct-incentive", "specialist-proof",
  "founder-incentive", "founder", "holiday-incentive", "lean-personal", "social-proof",
  "insight-hook", "pain-led", "direct-ask",
];

/** Short human labels for the "what kind of emails are being sent" line in the UI. */
export const STYLE_LABELS: Record<string, string> = {
  "quirky-incentive": "Quirky + gift",
  "outcome-hook": "Outcome hook",
  "curiosity-gap": "Curiosity gap",
  "direct-incentive": "Direct + gift",
  "specialist-proof": "Specialist proof",
  "founder-incentive": "Founder + gift",
  "founder": "Founder note",
  "holiday-incentive": "Holiday + gift",
  "lean-personal": "Lean personal",
  "social-proof": "Social proof",
  "insight-hook": "Insight hook",
  "pain-led": "Pain-led",
  "direct-ask": "Direct ask",
};

export const styleLabel = (key: string | null | undefined): string =>
  key ? (STYLE_LABELS[key] ?? key) : "—";

/** The set actively being written this round, human-labeled — for the "you are sending X" display. */
export const activeFreshStyleLabels = (): string[] =>
  Array.from(new Set(FRESH_STYLES)).map(styleLabel);
