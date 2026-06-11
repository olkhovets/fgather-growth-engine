/**
 * Incentives Lab — hard-coded, short, incentive-forward emails. The dollar amount is in the
 * subject, the body is 2-3 punchy lines, no links (reply-first). We A/B BOTH the dollar amount
 * AND the subject style. {{firstName}} / {{companyName}} are Instantly merge vars.
 */

export type IncentiveConfig = {
  subjectTemplates: string[]; // subject STYLES to A/B (each contains {{amount}})
  bodyTemplate: string;       // the chosen body preset (or a custom one)
  amounts: number[];          // dollar amounts to A/B
};

/**
 * Subject-line STYLES to A/B. Two families:
 *  - "bold": the dollar amount is IN the subject (max impact, higher spam risk on strict gateways)
 *  - "clean": no money in the subject (curiosity/benefit; the offer lives in the body — far safer
 *    for deliverability). A/B the two families to see which actually lands + converts.
 */
export const SUBJECT_PRESETS: Array<{ label: string; template: string; category: "bold" | "clean" }> = [
  // BOLD — money in subject
  { label: "direct-offer", template: "Get ${{amount}} to view a demo (seriously)", category: "bold" },
  { label: "we-pay-you", template: "We'll pay you ${{amount}} for 20 minutes", category: "bold" },
  { label: "no-catch", template: "${{amount}} for a 20-minute demo, no catch", category: "bold" },
  { label: "heres-money", template: "Here's ${{amount}} to watch a demo", category: "bold" },
  { label: "ill-send", template: "I'll send you ${{amount}} to see this", category: "bold" },
  { label: "gift-card", template: "${{amount}} gift card, 20 minutes, no pitch", category: "bold" },
  { label: "time-trade", template: "Trade you 20 minutes for ${{amount}}", category: "bold" },
  { label: "ready-when", template: "Your ${{amount}} is ready when you are", category: "bold" },
  { label: "on-us", template: "${{amount}} on us to check out Gather", category: "bold" },
  { label: "for-your-time", template: "${{amount}} for 20 minutes of your time", category: "bold" },
  // CLEAN — money in body, deliverability-safe subjects
  { label: "worth-20", template: "Worth 20 minutes?", category: "clean" },
  { label: "quick-q", template: "Quick question about {{companyName}}'s research", category: "clean" },
  { label: "for-insights-team", template: "An offer for the {{companyName}} insights team", category: "clean" },
  { label: "first-name-20", template: "{{firstName}}, worth 20 minutes of your time?", category: "clean" },
  { label: "days-not-months", template: "Research answers in days, not months", category: "clean" },
  { label: "right-person", template: "For whoever owns research at {{companyName}}", category: "clean" },
  { label: "company-faster", template: "{{companyName}} + faster consumer answers", category: "clean" },
  { label: "genuinely-useful", template: "20 minutes for something genuinely useful", category: "clean" },
  { label: "made-offer", template: "{{firstName}}, made you an offer (inside)", category: "clean" },
  { label: "quick-one", template: "{{firstName}} quick one on consumer research", category: "clean" },
];

/** Body PRESETS — sharp 2-3 liners across many angles. */
export const BODY_PRESETS: Array<{ label: string; template: string }> = [
  { label: "Blunt + confident", template: "We do AI consumer research that gets brands real audience answers in days, not months. I'm so sure it'll help {{companyName}} that I'll send you a ${{amount}} gift card just to watch a 20-minute demo.\nReply \"yes\" and it's yours." },
  { label: "We do X, you need it", template: "We run AI consumer research. {{companyName}} needs faster, realer audience answers, and I'll pay you ${{amount}} to prove it in 20 minutes.\nWorth a reply?" },
  { label: "Proof-point led", template: "Brands like Einstein Bros and Datadog use us to get consumer answers in days instead of months. I'll send {{firstName}} a ${{amount}} gift card to show you the same in 20 minutes.\nReply and it's yours." },
  { label: "Pure offer", template: "No pitch: I'll give you a ${{amount}} gift card to sit through a 20-minute Gather demo. We do AI consumer research that's fast enough to be worth your time.\nReply \"in\"?" },
  { label: "Confidence bet", template: "I'll bet you ${{amount}} that our AI research tool earns its spot at {{companyName}} in one 20-minute demo. Win or lose, the gift card is yours.\nReply to claim it." },
  { label: "Ultra-short", template: "${{amount}} gift card for 20 minutes on a Gather demo. We do AI consumer research, fast.\nReply \"yes\"?" },
  { label: "Personal + direct", template: "{{firstName}}, real offer: ${{amount}} to you for a 20-minute look at how Gather gets {{companyName}} consumer answers in days. No strings.\nReply and I'll send it over." },
  { label: "Question hook", template: "What's it worth to get real consumer answers in days instead of months? To us, ${{amount}} — that's what I'll send you for a 20-minute demo.\nGame?" },
  { label: "Reverse psychology", template: "Most research tools waste your time, so I'll put money on it: a ${{amount}} gift card if you give Gather 20 minutes and it isn't faster than your current setup.\nReply and I'll book it." },
  { label: "Stat-led", template: "Most consumer research takes six to eight weeks. We get {{companyName}} validated answers in days. I'll send you a ${{amount}} gift card to spend 20 minutes seeing how.\nWorth a reply?" },
  { label: "Peer / social proof", template: "The insights teams at brands like Einstein Bros stopped waiting weeks for answers. I'll give you a ${{amount}} gift card to see what they use, in 20 minutes.\nInterested?" },
  { label: "Casual text", template: "{{firstName}}, odd ask: can I send you a ${{amount}} gift card to show you something for 20 minutes? We do AI consumer research and it's genuinely fast.\nWorth a yes?" },
  { label: "Problem-first", template: "If validating a campaign with real consumers at {{companyName}} still takes weeks, that's exactly what we fix, in days. I'll send a ${{amount}} gift card for 20 minutes to prove it.\nReply \"show me\"." },
  { label: "Time-respect", template: "I know your inbox is brutal, so here's a real reason to reply: a ${{amount}} gift card for 20 minutes seeing how Gather gets {{companyName}} consumer answers in days.\nYes?" },
  { label: "Curiosity + offer", template: "There's a way to get consumer answers in days instead of months, and I'll send you a ${{amount}} gift card to let me show you in 20 minutes.\nReply and I'll explain." },
  { label: "No-BS short", template: "${{amount}} gift card for 20 minutes. We do fast AI consumer research. That's the whole pitch.\nReply if you're in." },
];

/**
 * Follow-up steps appended after the main offer (step 1). Cold outreach replies jump on the 2nd/3rd
 * touch, so every Incentives Lab campaign now sends a 3-step sequence. Each follow-up is 2-3
 * sentences, re-offers the money, adds one fresh angle (proof point, then speed), and carries NO
 * links. Sent as in-thread replies (blank subject) a few days apart. {{amount}} filled at launch.
 */
export const INCENTIVE_FOLLOWUPS: Array<{ body: string; delayDays: number }> = [
  { delayDays: 3, body: "Quick follow up. Brands like Einstein Bros and Datadog get real consumer answers from us in days, not months, and that ${{amount}} gift card is still yours for 20 minutes. Worth a reply?" },
  { delayDays: 3, body: "Last note from me. Most teams wait weeks on research we turn around in days, and I'll still send you ${{amount}} to see how in 20 minutes. Want me to set it up?" },
];

export const ALLOWED_AMOUNTS = [50, 100, 150, 200, 250, 500];

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

  let amounts = Array.isArray(input?.amounts) ? input!.amounts.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  amounts = Array.from(new Set(amounts)).filter((a) => ALLOWED_AMOUNTS.includes(a)).sort((a, b) => a - b);
  if (amounts.length === 0) amounts = [...DEFAULT_INCENTIVE_CONFIG.amounts];
  amounts = amounts.slice(0, 5);

  return { subjectTemplates, bodyTemplate, amounts };
}
