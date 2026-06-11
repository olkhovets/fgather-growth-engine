/**
 * Curated Gather messaging defaults: product summary, ICP, proof points, social
 * proof, and incentive policy. These are used to (a) seed the operator's workspace
 * and (b) fall back inside the generation pipeline when a Gather workspace hasn't
 * configured proof points, so no email ever ships without concrete customer proof.
 *
 * Customer names (Datadog, Einstein Bros / Bagel Brands) and outcome statements
 * are drawn from gatherhq.com's public customer list and quoted outcomes — kept
 * truthful and not over-attributed to a single named logo.
 */

export const GATHER_PRODUCT_SUMMARY =
  "Gather is an AI research and content platform for marketing teams. It runs real buyer and consumer research in days instead of months (Listen), turns the findings into on-brand, conversion-focused content like reports, landing pages, and campaign briefs (Launch), and keeps a living strategy doc that updates as you learn (Learn). It replaces the slow, expensive agency-and-survey-vendor stack with one place that goes from question to validated insight to ship-ready creative continuously.";

export const GATHER_ICP =
  "B2C marketing leaders at consumer and DTC brands (food, beverage, beauty, fashion, retail, consumer apps): CMOs, VPs of Marketing, Brand Directors, Heads of Growth, and Marketing Managers. They feel the pain of slow research cycles, agency dependence, guessing at creative, and pressure to ship campaigns that actually resonate with real audiences. They care about creative quality, brand voice, and audience resonance more than ROI dashboards.";

/** Proof points injected into every email (weave in where relevant, never as a list). */
export const GATHER_PROOF_POINTS: Array<{ title: string; text: string }> = [
  {
    title: "Einstein Bros Bagels (Bagel Brands)",
    text: "a national consumer food brand uses Gather to test campaigns and creative against real audiences before spending media dollars, so launches are grounded in what customers actually want",
  },
  {
    title: "Datadog",
    text: "runs buyer and messaging research in-house with Gather instead of waiting on outside agencies, turning a study around in days rather than months",
  },
  {
    title: "Speed",
    text: "one marketing leader ran a full messaging study in nine days that the previous vendor quoted at two months",
  },
  {
    title: "Pipeline impact",
    text: "a content team said one Gather industry report drove more inbound in six weeks than their prior three quarterly campaigns combined",
  },
  {
    title: "Depth",
    text: "60M+ verified panelists and 250K+ interviews behind the platform, and a single study produces a dozen-plus ship-ready content assets",
  },
];

export const GATHER_SOCIAL_PROOF = {
  similarCompanies: "Einstein Bros, Datadog, Fortinet, SailPoint, Envoy, Belk, Staples",
  referralPhrase: "figured this was worth putting in front of the [Company] marketing team",
};

/**
 * Incentive policy. Reply-first, NO LINKS in step 1 — the incentive is offered as
 * plain text ("I'll send you a $100 Uber Eats card"), never a link. Be generous:
 * the mission allows up to $1k. Rotate the brand so A/B testing can find what lands.
 */
export const GATHER_INCENTIVE_INSTRUCTION =
  'INCENTIVE (be generous, it works): offer a real gift card just for taking a 20-minute call, framed as "for your time," never as a bribe or gimmick. Default offer: a $100 Uber Eats, DoorDash, or Amazon gift card for hopping on a quick call. Rotate which brand you mention across emails so we can learn what lands. You may go higher (up to a $250 card, or a larger Sendoso gift) for senior titles (CMO, VP) or named target brands. Mention the incentive once, naturally — ideally in a P.S. on step 1 or right after the proof point in step 2. Never include a link with it. Example phrasings: "Worth 20 minutes? I will send a $100 Uber Eats card just for the time." / "Not asking for a commitment, just 20 minutes and a $100 DoorDash card on me."';

/** The "why they should care" value framing, injected into the system prompt. */
export const GATHER_VALUE_FRAMING =
  'WHY THEY SHOULD CARE (lead with this, do not sell features): a consumer-brand marketer drowns in slow research, agency invoices, and creative guesswork. Gather collapses "we should research this" into a validated answer plus ready-to-ship creative in days. The hook should make them feel the pain of their current cycle, then show that the thing they assume takes a quarter and a vendor can happen this week, grounded in real audience data. Make it about their campaigns and their brand, not our product.';
