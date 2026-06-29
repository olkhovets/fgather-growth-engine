import { callAnthropic } from "@/lib/anthropic";

/**
 * Subject-line engine. The subject is the OPEN-GATE: a great body can't earn a reply if the email is
 * never opened, and opens are NOT merit-based — they're won in the inbox preview by a subject that
 * looks personal, relevant, and human (like a coworker wrote it), not like a sales blast. This
 * generates several personalized candidates per lead and scores them so we ship the strongest one.
 *
 * Research floor (Gong/30MPC/Belkins/Lavender/Josh Braun): 1-4 words · all lowercase · reference THEIR
 * world (company / a real trigger), not us · no sell, no clickbait, no spam words · personalized
 * subjects open ~46% vs ~35% generic · under-4-word subjects reply ~4.2x higher than long ones.
 */

// Salesy words: Gong (85M) — these cut opens ~17.9%.
const SALESY = ["boost", "grow", "growth", "revenue", "save", "increase", "demo", "solution", "offer", "sale", "discount", "deal", "webinar", "partnership", "introduction", "introducing", "opportunity", "platform", "roi"];
// Spam-trigger words: 2+ → ~73% lower inbox placement (Woodpecker 2025). Hard penalty / auto-fail.
const SPAM = ["free", "limited time", "act now", "exclusive", "guarantee", "guaranteed", "no obligation", "risk-free", "urgent", "winner", "cash", "prize", "earn money", "asap", "no cost", "100%"];
// Buzzwords senior marketers are immune to (they use them on their own customers).
const BUZZWORDS = ["omnichannel", "journey", "leverage", "engagement", "synergy", "holistic", "ecosystem"];

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/** distinctive token of a company name (drops common suffixes), e.g. "brightland" from "Brightland Inc." */
function companyToken(company?: string | null): string | null {
  if (!company) return null;
  const t = company.toLowerCase().replace(/\b(inc|llc|corp|co|company|ltd|group|the|&)\b/g, "").trim().split(/\s+/).filter((w) => w.length >= 3)[0];
  return t || null;
}

export type SubjectScore = { subject: string; score: number; notes: string[]; autoFail: boolean };

/**
 * Deterministic subject scorer (0-100). Encodes the data: short + lowercase + SIGNAL-based
 * personalization (company / trigger / competitor / metric — NOT a bare first name, which mail-merges
 * and hurts replies −12%) + no sell/spam. Auto-fails on spam-trigger clusters or empty subjects.
 */
export function scoreSubject(subject: string, context: { company?: string | null; firstName?: string | null }): SubjectScore {
  const s = (subject || "").trim();
  const lower = s.toLowerCase();
  const w = words(s);
  const notes: string[] = [];
  let score = 100;

  if (w.length === 0) return { subject: s, score: 0, notes: ["empty subject (replies −12%)"], autoFail: true };

  // Length — 2-4 words is the peak (Belkins/Gong). 1 word slightly under; ≥7 hard penalty.
  if (w.length === 1) { score -= 6; notes.push("1 word (2-4 is peak)"); }
  else if (w.length > 4) { score -= Math.min(50, (w.length - 4) * 10); notes.push(`${w.length} words (aim 2-4)`); }
  if (s.length > 45) { score -= 8; notes.push(`${s.length} chars (preview truncates ~40)`); }

  // Personalization — reward a SIGNAL (company name or a specific proper-noun detail). A bare first
  // name with no other signal is a mail-merge tell → small penalty, not a reward.
  const tok = companyToken(context.company);
  const namesCompany = tok ? lower.includes(tok) : false;
  const namesPerson = context.firstName ? new RegExp(`\\b${context.firstName.toLowerCase()}\\b`).test(lower) : false;
  const hasSpecific = w.slice(1).some((x) => /^[A-Z][a-z]+/.test(x)) || /\d/.test(s);
  if (namesCompany) { notes.push("names company (signal)"); }
  else if (hasSpecific) { score -= 8; notes.push("specific detail but not the company"); }
  else if (namesPerson) { score -= 18; notes.push("first-name-only — reads as mail-merge (replies −12%)"); }
  else { score -= 32; notes.push("generic — no company/trigger/specific signal"); }

  // Casing — all-lowercase mirrors an internal note (largest dataset); Title-every-word / CAPS read marketing.
  const titleCase = w.filter((x) => /^[A-Z][a-z]+$/.test(x)).length >= 3;
  const allCaps = s.length > 3 && s === s.toUpperCase();
  if (allCaps) { score -= 35; notes.push("ALL CAPS"); }
  else if (titleCase) { score -= 12; notes.push("Title Case (prefer lowercase)"); }

  // Spam triggers — 2+ ≈ 73% worse placement → auto-fail.
  const spam = SPAM.filter((x) => lower.includes(x));
  if (spam.length >= 2) { notes.push(`spam-trigger cluster: ${spam.join(", ")} (auto-fail)`); return { subject: s, score: 0, notes, autoFail: true }; }
  if (spam.length === 1) { score -= 40; notes.push(`spam word: ${spam[0]}`); }

  // Salesy + buzzwords.
  const sell = SALESY.filter((x) => new RegExp(`\\b${x}\\b`, "i").test(s));
  if (sell.length) { score -= sell.length * 20; notes.push(`salesy: ${sell.join(", ")}`); }
  const buzz = BUZZWORDS.filter((x) => new RegExp(`\\b${x}\\b`, "i").test(s));
  if (buzz.length) { score -= buzz.length * 10; notes.push(`buzzword: ${buzz.join(", ")}`); }

  // Punctuation — at most one "?"; no "!"; no double punctuation.
  if (/!/.test(s)) { score -= 20; notes.push("exclamation"); }
  if ((s.match(/[?]/g) || []).length > 1 || /[.]{2,}|[,;:]/.test(s)) { score -= 12; notes.push("heavy punctuation"); }
  if (w.length <= 2 && /^quick (question|one|note)$/i.test(s)) { score -= 12; notes.push("overused 'quick question'"); }

  return { subject: s, score: Math.max(0, Math.min(100, score)), notes, autoFail: false };
}

/**
 * Generate N personalized subject-line candidates for a lead, score them, and return best-first.
 * One Claude call. Use for the hardest-hitting sends where the open is the whole game.
 */
export async function generateSubjectCandidates(
  anthropicKey: string,
  model: string,
  lead: { name?: string | null; company?: string | null; jobTitle?: string | null; industry?: string | null },
  context: { product?: string; styleHint?: string; bodyHint?: string },
  n = 6
): Promise<SubjectScore[]> {
  const firstName = (lead.name ?? "").split(/\s+/)[0] || null;
  const system = `You write cold-email SUBJECT LINES that get opened by busy, inundated senior marketers (they're ~30% LESS likely to reply than anyone, and decide in under 3 seconds). Opens are won in the inbox preview, not by merit — the subject must look like a coworker wrote it about THEIR world, never like marketing.

Hard rules (from 85M+ cold emails — Gong/30MPC/Belkins/Lavender/Josh Braun):
- 2 to 4 words, under 40 characters. Shorter wins.
- ALL lowercase (except the company's own proper name).
- Personalize on a SIGNAL — their brand, a product/campaign, a launch, a competitor, or a real metric. NEVER on a bare first name or a {{merge token}} (that reads as automation and HURTS replies).
- Tone = internal/peer note, neutral. ZERO selling words (no demo/offer/grow/revenue/free/save/platform/ROI), no spam words, no exclamation, no ALL CAPS, no buzzwords (omnichannel/journey/leverage/engagement).
- Curiosity only when grounded in a concrete referent the body pays off. Specific beats clever.

Proven patterns (pick varied ones, fill slots from THIS lead's brand/category):
- company + topic:  "${(lead.company ?? "brand").toLowerCase()} + retention"
- competitor framing:  "{competitor}?"
- problem-question:  "rising cac?"  (short only)
- their-product idea:  "idea to lift ${(lead.company ?? "their")}'s repeat rate"
- trigger/event:  "your spring drop"  /  "congrats on the target deal"  (top opener, ~+45% opens)

Return STRICT JSON only: {"subjects":["...","..."]} with ${n} distinct options, strongest first.`;
  const user = `LEAD: ${lead.name ?? "?"}, ${lead.jobTitle ?? "?"} at ${lead.company ?? "?"} (${lead.industry ?? "?"}).
${context.product ? `OUR PRODUCT: ${context.product}\n` : ""}${context.styleHint ? `EMAIL STYLE: ${context.styleHint}\n` : ""}${context.bodyHint ? `THE EMAIL OPENS WITH (pair the subject to it): ${context.bodyHint.slice(0, 200)}\n` : ""}
Write ${n} subject lines for THIS person. Most should name "${lead.company ?? "their company"}" or a specific signal about them. STRICT JSON only.`;

  try {
    const { text } = await callAnthropic(anthropicKey, user, { maxTokens: 400, model, systemPrompt: system });
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const subs: string[] = Array.isArray(j.subjects) ? j.subjects.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0) : [];
    const scored = subs.map((s) => scoreSubject(s.trim(), { company: lead.company, firstName }));
    // Drop auto-fails; best score first.
    return scored.filter((c) => !c.autoFail).sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}
