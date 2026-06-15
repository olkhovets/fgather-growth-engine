/**
 * Incentives Lab — hard-coded, short, incentive-forward emails. The dollar amount is in the
 * subject, the body is 2-3 punchy lines, no links (reply-first). We A/B BOTH the dollar amount
 * AND the subject style. {{firstName}} / {{companyName}} are Instantly merge vars.
 */

export type IncentiveConfig = {
  subjectTemplates: string[]; // subject STYLES to A/B (each contains {{amount}})
  bodyTemplate: string;       // the chosen body preset (or a custom one) — legacy single body
  bodyTemplates?: string[];   // multiple body presets to ROTATE per lead (variety across sends)
  amounts: number[];          // dollar amounts to A/B
};

/**
 * Subject-line STYLES to A/B. Two families:
 *  - "bold": the dollar amount is IN the subject (max impact, higher spam risk on strict gateways)
 *  - "clean": no money in the subject (curiosity/benefit; the offer lives in the body — far safer
 *    for deliverability). A/B the two families to see which actually lands + converts.
 */
export const SUBJECT_PRESETS: Array<{ label: string; template: string; category: "credentialed" | "confident" | "clean" }> = [
  // CREDENTIALED — lead with who we are / who we work with (build trust first)
  { label: "belk-bagel-want", template: "how Belk and Bagel Brands learn what customers actually want", category: "credentialed" },
  { label: "behind-staples-belk", template: "the consumer research behind Staples and Belk", category: "credentialed" },
  { label: "gartner-team", template: "{{firstName}}, the team behind Gartner Peer Insights built this", category: "credentialed" },
  { label: "menlo-backed", template: "Menlo-backed consumer research for {{companyName}}", category: "credentialed" },
  { label: "ai-marketing-hire", template: "an AI marketing hire for {{companyName}}", category: "credentialed" },
  { label: "days-not-six-weeks", template: "real consumer answers in days, not six weeks", category: "credentialed" },
  // CONFIDENT — money framed as conviction, never a gimmick
  { label: "behind-our-pitch", template: "{{firstName}}, we'll put ${{amount}} behind our pitch", category: "confident" },
  { label: "confident-enough", template: "confident enough to put ${{amount}} on 20 minutes", category: "confident" },
  { label: "back-it", template: "we'll back it with ${{amount}} for your time, {{firstName}}", category: "confident" },
  { label: "sure-it-helps", template: "${{amount}} for 20 minutes, and here's why we're sure", category: "confident" },
  // CLEAN — no money in subject, deliverability-safe
  { label: "worth-20", template: "{{firstName}}, worth 20 minutes?", category: "clean" },
  { label: "quick-one", template: "quick one on {{companyName}}'s consumer research", category: "clean" },
  { label: "right-person", template: "for whoever owns consumer research at {{companyName}}", category: "clean" },
  { label: "faster-answers", template: "{{companyName}} + faster consumer answers", category: "clean" },
];

/**
 * Body PRESETS — credentialed and confident, never gimmicky. Each leads with real credibility
 * (customers, backers, founder pedigree, hard proof) and frames the money as conviction: a serious
 * company putting cash behind a cold pitch because it's sure it can help. No "gift card, no catch."
 * Verified facts only: backed by Menlo / True / Ridge, AI built on Anthropic; team behind Gartner
 * Peer Insights; used by Datadog, Staples, Belk, Bagel Brands, Patreon; answers in 1-2 weeks vs 6-8
 * at ~1/10th the cost. No em dashes, no links.
 */
export const BODY_PRESETS: Array<{ label: string; template: string }> = [
  { label: "The gap (mission-led)", template: "Most teams market on what they think customers want, not what customers actually need. Gather closes that gap with real consumer research in days, not six weeks. Brands like Belk, Bagel Brands, and Empire Today run it, and we're backed by Menlo. Confident it helps {{companyName}}, so I'll back it with a ${{amount}} {{gift}} for a 20-minute demo.\nWorth it?" },
  { label: "Not generic AI copy", template: "Most teams are drowning in generic AI copy. Gather is the opposite: real consumer research underneath every asset, the kind you'd have briefed to an agency. Used by Staples, Belk, and Bagel Brands, backed by Menlo. I'll send a ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nReply and I'll set it up?" },
  { label: "Six weeks + budget", template: "If a real consumer study at {{companyName}} still means six weeks and next year's research budget, that's exactly what we fix: answers in days at a tenth of the cost. Belk, Empire Today, and Bagel Brands use us; we're Menlo-backed. A ${{amount}} {{gift}} for a 20-minute demo.\nWorth a reply?" },
  { label: "One study, twelve outputs", template: "With Gather, one consumer study fans out into a dozen ship-ready assets, the report, the landing page, the ad copy. Brands like Staples, Belk, and Bagel Brands run it, and we're backed by Menlo. Confident it helps {{companyName}}, so a ${{amount}} {{gift}} for a 20-minute demo.\nIn?" },
  { label: "Founder pedigree", template: "Gather is from the team that built Gartner Peer Insights. We run AI consumer research for Belk, Staples, and Bagel Brands, answers in days not months, backed by Menlo and Anthropic. I'll put a ${{amount}} {{gift}} behind a 20-minute demo for {{companyName}}.\nWorth it?" },
  { label: "AI marketing hire", template: "Think of Gather as an AI marketing hire: it runs real consumer research and turns it into on-brand content, in days. Belk, Empire Today, and Bagel Brands already use it, and we're Menlo-backed. I'll send a ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nReply and I'll set it up?" },
  { label: "Surveys miss the why", template: "Surveys miss the why. Gather runs AI-moderated interviews against a 60M-person panel and turns them into content in days. Used by Staples, Belk, and Bagel Brands, backed by Menlo. A ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nWorth a yes?" },
  { label: "Consumer peers", template: "Consumer brands like Bagel Brands, Naf Naf, and Belk use Gather to find out what their customers actually want before they spend on a campaign, in days, not months. We're Menlo-backed. A ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nReply \"yes\"?" },
  { label: "Cost + confidence", template: "Traditional consumer research runs six to eight weeks and up to $100k. Gather does it in days at a tenth of that, which is why Staples, Belk, and Bagel Brands use us. We're confident enough it helps {{companyName}} to put a ${{amount}} {{gift}} behind a 20-minute demo.\nWorth a reply?" },
];

/**
 * Follow-up steps appended after the main offer (step 1). Cold outreach replies jump on the 2nd/3rd
 * touch, so every Incentives Lab campaign now sends a 3-step sequence. Each follow-up is 2-3
 * sentences, re-offers the money, adds one fresh angle (proof point, then speed), and carries NO
 * links. Sent as in-thread replies (blank subject) a few days apart. {{amount}} filled at launch.
 */
export const INCENTIVE_FOLLOWUPS: Array<{ body: string; delayDays: number }> = [
  { delayDays: 3, body: "Quick follow up, {{firstName}}. Belk, Staples, and Bagel Brands use Gather to learn what their customers actually want, in days. We're Menlo-backed. That ${{amount}} {{gift}} for a 20-minute demo still stands. Worth a reply?" },
  { delayDays: 3, body: "Last note from me. Gather is from the team behind Gartner Peer Insights, backed by Menlo and Anthropic, and I'm confident it helps {{companyName}}. The ${{amount}} {{gift}} for a 20-minute demo is still yours. Want me to set it up?" },
];

export const ALLOWED_AMOUNTS = [50, 100, 150, 200, 250, 500];

/**
 * Gift TYPES to A/B (the third experiment dimension alongside amount + subject style). The body's
 * {{gift}} token renders to one of these; we rotate per lead and track which converts. Framed as
 * the company backing its pitch ("a $200 Uber Eats card"), not a giveaway.
 */
export const GIFT_TYPES = ["Uber Eats card", "Amazon gift card", "Visa gift card", "DoorDash card"];

/** Render the gift phrase into a body (after amount/firstName/companyName are filled). */
export function renderGift(text: string, gift: string): string {
  return text.replace(/\{\{\s*gift\s*\}\}/g, gift);
}

export const DEFAULT_INCENTIVE_CONFIG: IncentiveConfig = {
  subjectTemplates: [SUBJECT_PRESETS[0].template, SUBJECT_PRESETS[1].template],
  bodyTemplate: BODY_PRESETS[0].template,
  amounts: [50, 100, 200],
};

/** Render a template for a specific amount. {{amount}} filled now; {{firstName}}/{{companyName}} stay for Instantly. */
export function renderIncentive(template: string, amount: number): string {
  return template.replace(/\{\{\s*amount\s*\}\}/g, String(amount));
}

/** Short stable label for a subject style (for per-style A/B tracking). */
export function subjectStyleLabel(template: string): string {
  const preset = SUBJECT_PRESETS.find((s) => s.template === template);
  if (preset) return preset.label;
  return template.replace(/\{\{\s*amount\s*\}\}/g, "$").slice(0, 24);
}

export function normalizeIncentiveConfig(input: Partial<IncentiveConfig> & { subjectTemplate?: string } | null | undefined): IncentiveConfig {
  // Backward compat: accept a single subjectTemplate or an array of subjectTemplates.
  let subjectTemplates = Array.isArray(input?.subjectTemplates) ? input!.subjectTemplates : [];
  if (subjectTemplates.length === 0 && typeof input?.subjectTemplate === "string" && input.subjectTemplate.trim()) {
    subjectTemplates = [input.subjectTemplate.trim()];
  }
  subjectTemplates = subjectTemplates.map((s) => String(s).trim()).filter(Boolean);
  if (subjectTemplates.length === 0) subjectTemplates = [...DEFAULT_INCENTIVE_CONFIG.subjectTemplates];
  subjectTemplates = Array.from(new Set(subjectTemplates)).slice(0, 4);

  const bodyTemplate = (input?.bodyTemplate || "").trim() || DEFAULT_INCENTIVE_CONFIG.bodyTemplate;
  // Optional rotation set: dedupe, keep non-empty, cap at the number of presets. Falls back to the
  // single bodyTemplate when absent so old configs keep working.
  let bodyTemplates = Array.isArray(input?.bodyTemplates) ? input!.bodyTemplates.map((b) => String(b).trim()).filter(Boolean) : [];
  bodyTemplates = Array.from(new Set(bodyTemplates)).slice(0, BODY_PRESETS.length);

  let amounts = Array.isArray(input?.amounts) ? input!.amounts.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  amounts = Array.from(new Set(amounts)).filter((a) => ALLOWED_AMOUNTS.includes(a)).sort((a, b) => a - b);
  if (amounts.length === 0) amounts = [...DEFAULT_INCENTIVE_CONFIG.amounts];
  amounts = amounts.slice(0, 5);

  return { subjectTemplates, bodyTemplate, ...(bodyTemplates.length ? { bodyTemplates } : {}), amounts };
}
