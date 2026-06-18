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
  // CONTROLLABLE ColdIQ experiments. `experiments` = which families are live ("short" / "soft-cta"
  // / "short-subjects"); `experimentShare` = fraction of leads (0-1) that get an experiment variant
  // instead of the proven credentialed copy. Default OFF / 0 so the main approach is untouched until
  // deliberately dialed up. Lets useful ColdIQ ideas through in a measured way without scrapping core.
  experiments?: string[];
  experimentShare?: number;
};

export const KNOWN_EXPERIMENTS = ["short", "soft-cta", "short-subjects"] as const;

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
// Each follow-up adds a DISTINCT new angle (ColdIQ: follow up with value, not a nag), while the
// standing ${{amount}} {{gift}} offer carries through. FU1 = speed/cost; FU2 = founder pedigree + scope.
export const INCENTIVE_FOLLOWUPS: Array<{ body: string; delayDays: number }> = [
  { delayDays: 3, body: "Following up, {{firstName}}. Traditional consumer research runs six to eight weeks and up to $100k. Gather does it in days at a tenth of that, which is why Belk and Staples use us. The ${{amount}} {{gift}} for 20 minutes still stands. Worth a reply?" },
  { delayDays: 3, body: "Last note from me. With Gather one consumer study becomes a dozen ship-ready assets, and it's from the team that built Gartner Peer Insights, backed by Menlo. Confident it helps {{companyName}}. The ${{amount}} {{gift}} is still yours. Want me to set it up?" },
];

export const ALLOWED_AMOUNTS = [50, 100, 150, 200, 250, 500];

/**
 * Gift TYPES to A/B (the third experiment dimension alongside amount + subject style). The body's
 * {{gift}} token renders to one of these; we rotate per lead and track which converts. Framed as
 * the company backing its pitch ("a $200 Uber Eats card"), not a giveaway.
 */
export const GIFT_TYPES = ["Uber Eats card", "Amazon gift card", "Visa gift card", "DoorDash card"];

/**
 * VALUE-FIRST track — the A/B counterweight to incentives. No money, no links: lead with the VALUE
 * (a brand-specific consumer read, the speed/cost story, the founder pedigree) and a reply-first
 * CTA. Same credentialed proof, same hard rules (no em dashes, no AI words). We run this in parallel
 * with the incentive track and compare which books more demos (incentives sell, but value-first may
 * reach people a gift-card offer reads as spammy to). {{firstName}}/{{companyName}} are merge vars.
 */
export const VALUE_FIRST_SUBJECTS: Array<{ label: string; template: string }> = [
  { label: "vf-what-customers-want", template: "what your customers actually want, {{firstName}}" },
  { label: "vf-quick-read", template: "a quick consumer read for {{companyName}}" },
  { label: "vf-research-behind", template: "the research behind Belk and Bagel Brands" },
  { label: "vf-worth-20", template: "{{firstName}}, worth 20 minutes?" },
];

export const VALUE_FIRST_BODIES: Array<{ label: string; template: string }> = [
  { label: "Brand read teaser", template: "We run AI consumer research for brands like Belk, Staples, and Bagel Brands, real answers in days, not six weeks. Before any call I can pull a short read on what your category's buyers actually want right now. Want me to put one together for {{companyName}}?\nReply and it's yours." },
  { label: "The gap", template: "Most teams market on what they think customers want, not what they actually need. Gather closes that gap with real consumer research in days, the kind you'd brief to an agency. Belk, Empire Today, and Bagel Brands run it, and we're backed by Menlo. Worth 20 minutes to show you on {{companyName}}?" },
  { label: "Founder pedigree", template: "Gather is from the team that built Gartner Peer Insights. We run AI consumer research for Belk, Staples, and Bagel Brands, answers in days not months, backed by Menlo and Anthropic. Happy to show you what it would look like for {{companyName}}.\nWorth a quick chat?" },
  { label: "Surveys miss the why", template: "Surveys tell you what, not why. Gather runs AI-moderated interviews against a 60M-person panel and turns them into content in days. Staples, Belk, and Bagel Brands use it. Want me to walk {{companyName}} through it in 20 minutes?" },
  { label: "One study, twelve outputs", template: "With Gather, one consumer study becomes a dozen ship-ready assets, the report, the landing page, the ad copy. Brands like Staples, Belk, and Bagel Brands run it, and we're Menlo-backed. Worth showing you on {{companyName}}?\nReply if you're open to it." },
  { label: "Speed and cost", template: "Traditional consumer research runs six to eight weeks and up to $100k. Gather does it in days at a tenth of that, which is why Staples, Belk, and Bagel Brands use us. Twenty minutes to show you what that means for {{companyName}}?" },
  { label: "Quick teardown", template: "I can put together a quick read on how {{companyName}}'s buyers actually decide, the kind of thing we run for Belk and Bagel Brands in days. We're Menlo-backed, built on Anthropic. Want me to bring it to a 20-minute call?" },
  { label: "AI marketing hire", template: "Think of Gather as an AI marketing hire: it runs real consumer research and turns it into on-brand content, in days. Belk, Empire Today, and Bagel Brands already use it, and we're Menlo-backed. Worth 20 minutes to see it on {{companyName}}?" },
];

export const VALUE_FIRST_FOLLOWUPS: Array<{ body: string; delayDays: number }> = [
  { delayDays: 3, body: "Quick follow up, {{firstName}}. Belk, Staples, and Bagel Brands use Gather to learn what their customers actually want, in days, not weeks. Happy to show you what that looks like for {{companyName}}. Worth a reply?" },
  { delayDays: 3, body: "Last note from me. Gather is from the team behind Gartner Peer Insights, backed by Menlo and Anthropic. I think it would help {{companyName}}, and I can show you in 20 minutes. Want me to set it up?" },
];

/**
 * COLDIQ-INSPIRED EXPERIMENT POOLS (opt-in via incentiveConfig.experiments + experimentShare).
 * These test ColdIQ's published best practices AGAINST our proven credentialed copy without
 * replacing it — they only enter the rotation for the configured experiment share. Still
 * credentialed + incentive-backed (we don't scrap the main approach), just shaped per ColdIQ:
 * short (20-39 words), soft reply-first CTA (no "20-min demo" ask), lowercase 3-5 word subjects.
 */
// SHORT bodies — ColdIQ data: 20-39 words gets the highest reply rate. Tight, still credentialed + gift.
export const SHORT_BODIES: Array<{ label: string; template: string }> = [
  { label: "short-speed", template: "Quick one, {{firstName}}. Gather runs real consumer research for Belk and Bagel Brands in days, not weeks, backed by Menlo. I'll put a ${{amount}} {{gift}} behind 20 minutes on {{companyName}}. Worth a reply?" },
  { label: "short-gap", template: "Most teams guess what customers want. Gather gives {{companyName}} the real answer in days, the way Staples and Belk do it. Confident enough to back it with a ${{amount}} {{gift}}. Worth a look?" },
  { label: "short-cost", template: "{{firstName}}, we run AI consumer research for Belk and Bagel Brands, answers in days at a tenth of agency cost. A ${{amount}} {{gift}} for 20 minutes on {{companyName}}. In?" },
];
// SOFT-CTA bodies — ColdIQ: don't ask for the demo; offer to show a peer result. Reply-first.
export const SOFT_CTA_BODIES: Array<{ label: string; template: string }> = [
  { label: "soft-peer", template: "{{firstName}}, we just ran consumer research for a brand a lot like {{companyName}}, in days, not the usual six weeks. Want me to walk you through what we found? Backed by Menlo, and there's a ${{amount}} {{gift}} for your time." },
  { label: "soft-gap", template: "Most teams market on what they think customers want, not what they actually need. Gather closes that gap in days for Belk and Bagel Brands. Want to see what that looks like for {{companyName}}? Happy to send a ${{amount}} {{gift}} for 20 minutes." },
  { label: "soft-pedigree", template: "Gather is from the team behind Gartner Peer Insights. We find what consumers actually want before brands like Belk spend on a campaign. Want to see what we'd find for {{companyName}}? A ${{amount}} {{gift}} for the time." },
];
// SHORT lowercase subjects — ColdIQ: 3-5 words, lowercase, about the recipient's world.
export const SHORT_SUBJECTS: Array<{ label: string; template: string }> = [
  { label: "s-quick-one", template: "quick one, {{firstName}}" },
  { label: "s-worth-look", template: "{{firstName}}, worth a look?" },
  { label: "s-consumer-research", template: "{{companyName}} consumer research" },
  { label: "s-idea", template: "a quick idea for {{companyName}}" },
];

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
  const preset = SUBJECT_PRESETS.find((s) => s.template === template) || VALUE_FIRST_SUBJECTS.find((s) => s.template === template) || SHORT_SUBJECTS.find((s) => s.template === template);
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

  // Experiment controls: only keep known families; clamp share to [0,1] (default 0 = off).
  const experiments = Array.isArray(input?.experiments)
    ? input!.experiments.filter((e): e is string => typeof e === "string" && (KNOWN_EXPERIMENTS as readonly string[]).includes(e))
    : [];
  let experimentShare = typeof input?.experimentShare === "number" && Number.isFinite(input.experimentShare) ? input.experimentShare : 0;
  experimentShare = Math.max(0, Math.min(1, experimentShare));

  return { subjectTemplates, bodyTemplate, ...(bodyTemplates.length ? { bodyTemplates } : {}), amounts,
    ...(experiments.length ? { experiments } : {}), ...(experimentShare > 0 ? { experimentShare } : {}) };
}
