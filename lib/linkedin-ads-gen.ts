import { prisma } from "@/lib/prisma";
import { callAnthropic } from "@/lib/anthropic";
import { loadLearnings, computeVariantStats } from "@/lib/experiments";
import { getAggregatedMemory, getStrategySuggestion } from "@/lib/performance-memory";

/**
 * FORWARD PIPE (email engine → LinkedIn ad drafter).
 *
 * The email engine is the brain: it already scores which hooks, personas and
 * incentives earn positive replies. This module turns that intelligence into
 * LinkedIn ad rows in the exact column contract the ad-drafter extension reads
 * from its Google Sheet (see linkedin-ad-drafter/extension/lib/mapping.js).
 *
 * IMPORTANT translation note: the engine's winning EMAIL copy is reply-first and
 * link-free by hard rule (Calendly is blocklisted by email gateways). LinkedIn
 * ads are a different medium — they take a headline, a destination link and a
 * CTA button. So we do NOT copy email bodies verbatim. We carry over the proven
 * ANGLES (which hook/persona/incentive landed) and rewrite them as ad creative.
 *
 * Nothing here sends or spends on its own — generation is invoked explicitly by
 * the /api/linkedin/push-ads route, and the actual append to the sheet only
 * happens when the Apps Script URL is configured.
 */

// --- Sheet column contract (mirrors extension/lib/mapping.js COLUMNS) ---------
// Canonical keys the sheet-append Apps Script maps onto the sheet's headers.
export type LinkedInAdRow = {
  ad_name: string;
  // ad type marker — sheet-append writes this so detectAdType() classifies correctly
  ad_type: "website_visit" | "lead_gen";
  headline: string;
  intro_text: string;
  description?: string;
  destination_url?: string;
  cta: string;
  // lead-gen only
  form_headline?: string;
  form_body?: string;
  thank_you_headline?: string;
  thank_you_body?: string;
  thank_you_cta?: string;
  // provenance — lets the feedback pipe (phase 2) attribute results back
  source_persona?: string;
  source_note?: string;
};

// Mirror of the extension's LinkedIn CTA whitelist + form-CTA whitelist so we
// only ever emit values the drafter can select. Keep in sync with mapping.js.
const LINKEDIN_CTAS = [
  "Apply", "Download", "View Quote", "Learn more", "Sign Up", "Subscribe",
  "Register", "Join", "Attend", "Request Demo", "Buy Now", "Shop Now",
];
const FORM_CTAS = ["Visit company website", "Learn more", "View now", "Download now", "Try now"];

// LinkedIn builder limits (mirror of mapping.js LIMITS).
const LIMITS = { introText: 600, headline: 200, description: 300, adName: 255, formHeadline: 60, formBody: 160, confirmation: 300 };
// We cap intro_text well under LinkedIn's 3000 hard max — LinkedIn truncates the
// feed preview around ~150 chars, so tight ad copy outperforms a wall of text.

function clamp(s: string | undefined, max: number): string {
  const v = (s ?? "").trim();
  return v.length > max ? v.slice(0, max).trim() : v;
}

function normalizeCta(raw: string | undefined, allowed: string[], fallback: string): string {
  const key = (raw ?? "").trim().toLowerCase();
  const hit = allowed.find((c) => c.toLowerCase() === key);
  if (hit) return hit;
  // common phrasings → whitelist
  if (/demo/.test(key)) return "Request Demo";
  if (/sign ?up|get started|join/.test(key)) return "Sign Up";
  if (/download|guide|report|study/.test(key)) return "Download";
  if (/subscribe/.test(key)) return "Subscribe";
  if (/register/.test(key)) return "Register";
  return fallback;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "general";
}

// --- Read the engine's winning intelligence -----------------------------------

export type WinningSignals = {
  learnings: string[];               // promoted, proven copy patterns
  winningAngles: string[];           // top experiment variants by positive-reply rate
  bestPersonas: string[];            // personas ranked by positive replies
  bestVerticals: string[];           // verticals ranked by positive replies
  incentive: { gift: string | null; amount: string | null };
  strategyNote: string | null;       // one-line human-readable steer
  icp: string | null;
  customInstructions: string | null;
};

/** Read positive-reply-ranked incentive winners directly (read-only). */
async function incentiveWinners(workspaceId: string): Promise<{ gift: string | null; amount: string | null }> {
  const rank = async (field: "incentiveGiftType" | "incentiveAmount") => {
    const [sent, reply] = await Promise.all([
      prisma.lead.groupBy({ by: [field], where: { leadBatch: { workspaceId }, [field]: { not: null }, incentiveAmount: { gt: 0 }, sentAt: { not: null } }, _count: true }),
      prisma.lead.groupBy({ by: [field, "replyStatus"], where: { leadBatch: { workspaceId }, [field]: { not: null }, incentiveAmount: { gt: 0 }, replyStatus: "positive" }, _count: true }),
    ]);
    const m: Record<string, { sent: number; pos: number }> = {};
    for (const r of sent) { const k = String((r as Record<string, unknown>)[field]); m[k] = { sent: r._count, pos: 0 }; }
    for (const r of reply) { const k = String((r as Record<string, unknown>)[field]); (m[k] ||= { sent: 0, pos: 0 }).pos += r._count; }
    const ranked = Object.entries(m)
      .map(([k, v]) => ({ k, rate: v.sent > 0 ? v.pos / v.sent : 0, pos: v.pos }))
      .sort((a, b) => b.rate - a.rate || b.pos - a.pos);
    return ranked[0]?.pos ? ranked[0].k : null; // only return a winner with at least one positive
  };
  const [gift, amount] = await Promise.all([rank("incentiveGiftType"), rank("incentiveAmount")]);
  return { gift, amount };
}

export async function gatherWinningSignals(workspaceId: string): Promise<WinningSignals> {
  const [ws, learnings, variantStats, memory, incentive] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { icp: true, customInstructions: true } }),
    loadLearnings(workspaceId),
    computeVariantStats(workspaceId, "winner"),
    getAggregatedMemory(workspaceId),
    incentiveWinners(workspaceId),
  ]);

  // Top proven angles: winning experiment variants that actually beat their sends,
  // sorted by positive-reply rate. Fall back to those still testing if no winners yet.
  let variants = variantStats.variants.filter((v) => v.sends > 0).sort((a, b) => b.positiveRate - a.positiveRate);
  if (variants.length === 0) {
    const testing = await computeVariantStats(workspaceId, "testing");
    variants = testing.variants.filter((v) => v.positives > 0).sort((a, b) => b.positiveRate - a.positiveRate);
  }
  const winningAngles = variants.slice(0, 6).map((v) => `[${v.dimension}] ${v.label}: ${v.instruction} (${v.positiveRate}% positive over ${v.sends} sends)`);

  const rankByPositives = (bucket: Record<string, { positive_reply_count?: number }>) =>
    Object.entries(bucket)
      .filter(([k, m]) => k !== "unknown" && (m.positive_reply_count ?? 0) > 0)
      .sort((a, b) => (b[1].positive_reply_count ?? 0) - (a[1].positive_reply_count ?? 0))
      .map(([k]) => k);

  return {
    learnings,
    winningAngles,
    bestPersonas: rankByPositives(memory.byPersona),
    bestVerticals: rankByPositives(memory.byVertical),
    incentive,
    strategyNote: getStrategySuggestion(memory),
    icp: ws?.icp ?? null,
    customInstructions: ws?.customInstructions ?? null,
  };
}

// --- Generate ad rows from the signals ----------------------------------------

function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
}

const AD_SYSTEM_PROMPT = `You are the creative lead translating a cold-email engine's PROVEN winning signals into LinkedIn paid ad copy for Gather (gatherhq.com) — AI consumer research for B2C marketing leaders (CMOs, VP/Dir Marketing, Brand, Head of Growth at DTC/consumer brands).

You are given which hooks, personas and incentives earned positive replies over cold email. Carry the ANGLE across to LinkedIn ads — do NOT copy email phrasing verbatim. LinkedIn is a paid feed unit, not a 1:1 email.

CONVERSION PRIORITY (this is the #1 lever): the current account gets STRONG CTR on website-visit ads but the clicks barely convert (thousands of clicks, ~10 leads) — the click leaks because there's no on-platform capture. So PREFER lead_gen ads: they capture the email/lead directly on LinkedIn instead of dumping the click onto a landing page. Give every lead_gen ad a concrete, compelling form offer (the research teardown, the gift card for a booked call, a specific deliverable) so the click becomes a captured lead. Use website_visit only for pure top-of-funnel awareness, not as the main conversion path.

Hard rules (same human voice as the email engine):
- No em dashes. No AI-slop words (leverage, delve, streamline, unlock, empower, revolutionize, supercharge, seamless, robust, holistic, elevate, world-class, cutting-edge, game-changer, etc.).
- No "I hope this finds you well" / "I wanted to reach out" openers.
- Sharp, specific, a little cocky. Reads like a sharp human wrote it in 5 minutes. Speaks to the named persona's actual problem.
- Headline is a punchy hook, not a feature list. Intro text earns the click in the first ~150 characters.
- The CTA button label MUST be one of: ${LINKEDIN_CTAS.join(", ")}.
- For lead-gen ads, the confirmation/thank-you CTA MUST be one of: ${FORM_CTAS.join(", ")}.
- If a winning incentive (e.g. a gift card for a booked call) is provided, you MAY work it into a lead-gen offer, but keep it tasteful and compliant (LinkedIn rejects spammy "free gift" creative).

Return ONLY a JSON array, no prose, no code fence. Each element:
{
  "ad_type": "website_visit" | "lead_gen",
  "headline": string,        // <=200 chars, punchy
  "intro_text": string,      // <=600 chars, hook in first 150
  "description": string,     // optional, <=300 chars
  "cta": string,             // from the allowed CTA list
  "form_headline": string,   // lead_gen only, <=60 chars
  "form_body": string,       // lead_gen only, <=160 chars
  "thank_you_headline": string, // lead_gen only
  "thank_you_body": string,  // lead_gen only, <=300 chars
  "thank_you_cta": string,   // lead_gen only, from the allowed form-CTA list
  "source_persona": string,  // which winning persona this ad targets (or "general")
  "source_note": string      // one short phrase: which winning angle/signal this came from
}`;

export type GenerateOptions = {
  count?: number;             // how many ad rows to generate (default 4)
  destinationUrl?: string;    // landing URL for website_visit ads + thank-you CTA
  includeLeadGen?: boolean;   // also produce lead-gen variants (default true)
};

/**
 * Generate validated LinkedIn ad rows from the workspace's winning signals.
 * Pure read + one Anthropic call; does not write to the sheet. Returns the rows
 * (already clamped to LinkedIn limits and normalized to whitelisted CTAs) plus
 * the signals used, so the caller can log provenance.
 */
export async function generateLinkedInAdRows(
  workspaceId: string,
  apiKey: string,
  model: string,
  opts: GenerateOptions = {}
): Promise<{ rows: LinkedInAdRow[]; signals: WinningSignals }> {
  const count = Math.min(Math.max(opts.count ?? 4, 1), 12);
  const destinationUrl = opts.destinationUrl ?? process.env.LINKEDIN_AD_DESTINATION_URL ?? "";
  const includeLeadGen = opts.includeLeadGen ?? true;

  const signals = await gatherWinningSignals(workspaceId);

  const haveData = signals.winningAngles.length > 0 || signals.learnings.length > 0 || signals.bestPersonas.length > 0;
  const userPrompt = [
    `Generate ${count} LinkedIn ad rows for Gather.`,
    includeLeadGen ? "Make ~70% lead_gen ads (they capture the lead on-platform — the conversion priority above) and ~30% website_visit for awareness." : "Use only website_visit ad type.",
    signals.icp ? `\nICP: ${signals.icp}` : "",
    signals.bestPersonas.length ? `\nBEST-CONVERTING PERSONAS (most positive cold-email replies, target these first): ${signals.bestPersonas.join(", ")}` : "",
    signals.bestVerticals.length ? `\nBEST-CONVERTING VERTICALS: ${signals.bestVerticals.join(", ")}` : "",
    signals.winningAngles.length ? `\nWINNING ANGLES (proven over email — adapt, don't copy):\n${signals.winningAngles.map((a) => `- ${a}`).join("\n")}` : "",
    signals.learnings.length ? `\nPROVEN PATTERNS:\n${signals.learnings.map((l) => `- ${l}`).join("\n")}` : "",
    signals.incentive.gift ? `\nWINNING INCENTIVE: ${signals.incentive.gift}${signals.incentive.amount ? ` ($${signals.incentive.amount})` : ""} — usable in a lead-gen offer for a booked call.` : "",
    signals.strategyNote ? `\nCURRENT STEER: ${signals.strategyNote}` : "",
    signals.customInstructions ? `\nOPERATOR INSTRUCTIONS: ${signals.customInstructions}` : "",
    !haveData ? "\nNOTE: little reply data yet — write strong general ads aimed at the ICP above, ready to be refined once signal accrues." : "",
  ].filter(Boolean).join("\n");

  const { text } = await callAnthropic(apiKey, userPrompt, {
    model: model || "claude-haiku-4-5",
    maxTokens: 3000,
    systemPrompt: AD_SYSTEM_PROMPT,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    throw new Error("LinkedIn ad generation returned unparseable JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("LinkedIn ad generation did not return an array");

  const rows: LinkedInAdRow[] = [];
  let i = 0;
  for (const raw of parsed) {
    const r = raw as Record<string, unknown>;
    const type = r.ad_type === "lead_gen" ? "lead_gen" : "website_visit";
    const persona = typeof r.source_persona === "string" && r.source_persona.trim() ? r.source_persona.trim() : (signals.bestPersonas[0] ?? "general");
    const headline = clamp(String(r.headline ?? ""), LIMITS.headline);
    const intro = clamp(String(r.intro_text ?? ""), LIMITS.introText);
    if (!headline || !intro) continue; // skip malformed rows rather than ship empty ads

    i += 1;
    const row: LinkedInAdRow = {
      ad_name: `eng-${slug(persona)}-${type === "lead_gen" ? "lg" : "web"}-${String(i).padStart(2, "0")}`.slice(0, LIMITS.adName),
      ad_type: type,
      headline,
      intro_text: intro,
      description: clamp(r.description ? String(r.description) : undefined, LIMITS.description) || undefined,
      cta: normalizeCta(r.cta ? String(r.cta) : undefined, LINKEDIN_CTAS, type === "lead_gen" ? "Sign Up" : "Learn more"),
      source_persona: persona,
      source_note: r.source_note ? clamp(String(r.source_note), 120) : undefined,
    };
    if (type === "website_visit") {
      if (destinationUrl) row.destination_url = destinationUrl;
    } else {
      row.form_headline = clamp(r.form_headline ? String(r.form_headline) : headline, LIMITS.formHeadline);
      row.form_body = clamp(r.form_body ? String(r.form_body) : intro, LIMITS.formBody) || undefined;
      row.thank_you_headline = clamp(r.thank_you_headline ? String(r.thank_you_headline) : "You're in.", 60);
      row.thank_you_body = clamp(r.thank_you_body ? String(r.thank_you_body) : "We'll be in touch shortly.", LIMITS.confirmation);
      row.thank_you_cta = normalizeCta(r.thank_you_cta ? String(r.thank_you_cta) : undefined, FORM_CTAS, "Learn more");
      if (destinationUrl) row.destination_url = destinationUrl;
    }
    rows.push(row);
  }

  if (rows.length === 0) throw new Error("LinkedIn ad generation produced no valid rows");
  return { rows, signals };
}

// --- Push rows to the drafter's Google Sheet (via the append Apps Script) ------

export type PushResult = { appended: number; dryRun: boolean; endpoint?: string; response?: unknown };

/**
 * Append generated ad rows to the ad-drafter's Google Sheet via the sheet-append
 * Apps Script web app (mirrors the existing sheet-strikethrough.gs pattern).
 *
 * Config via env (no DB migration needed):
 *   LINKEDIN_SHEET_APPEND_URL   — the deployed Apps Script /exec URL
 *   LINKEDIN_SHEET_APPEND_TOKEN — optional shared secret (matches SECRET in the .gs)
 *   LINKEDIN_SHEET_TAB          — target tab name (default "Engine")
 *
 * If LINKEDIN_SHEET_APPEND_URL is unset this is a DRY RUN: it returns the rows it
 * would have written and appends nothing. That makes the route safe to call while
 * the sheet side isn't wired yet.
 */
export async function pushRowsToSheet(rows: LinkedInAdRow[]): Promise<PushResult> {
  const endpoint = process.env.LINKEDIN_SHEET_APPEND_URL;
  const tab = process.env.LINKEDIN_SHEET_TAB || "Engine";
  if (!endpoint) return { appended: 0, dryRun: true };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: process.env.LINKEDIN_SHEET_APPEND_TOKEN || "", tab, rows }),
  });
  const response = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sheet-append failed: ${res.status} ${JSON.stringify(response)}`);
  return { appended: rows.length, dryRun: false, endpoint, response };
}
