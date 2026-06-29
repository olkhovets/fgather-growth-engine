import { callAnthropic } from "@/lib/anthropic";
import { RUBRIC, SPAM_WORDS, FILLER_OPENERS, AI_TELL_WORDS } from "@/lib/cold-email-research";

/**
 * Email-quality grader — "are the emails good?" answered against the data-backed rubric in
 * lib/cold-email-research.ts. Two layers:
 *
 *   1. gradeEmail()  — DETERMINISTIC, free, instant. Scores the things you can measure exactly:
 *      length, subject, opener, CTA/links/questions, reading grade, you:me ratio, spam words,
 *      AI-tells. Runs on every generated email as a pre-send gate.
 *   2. gradeEmailWithJudge() — adds an LLM pass for the subjective, highest-leverage dimensions
 *      a regex can't see: personalization QUALITY (real trigger + relevance bridge vs generic) and
 *      problem-first framing. Use sparingly (one extra Claude call).
 *
 * Score is 0–100, weighted by the research's relative-lift evidence (personalization and
 * problem-first carry the most weight because they move replies the most).
 */

export type DimensionScore = {
  key: string;
  label: string;
  score: number;   // 0-100 for this dimension
  weight: number;  // relative importance
  note: string;    // what was found
  fix?: string;    // concrete instruction to improve it (only when score is low)
};

export type EmailGrade = {
  score: number;                 // 0-100 weighted overall
  pass: boolean;                 // score >= PASS_THRESHOLD and no hard fail
  dimensions: DimensionScore[];
  issues: string[];              // human-readable problems, worst first
  fixes: string[];               // concrete regeneration directives
  hardFail: boolean;             // a non-negotiable violation (e.g. a link in step 1, banned filler opener)
};

export const PASS_THRESHOLD = 70;

// --- small text utilities -------------------------------------------------

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
function wordCount(text: string): number {
  return words(text).length;
}
function sentences(text: string): string[] {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}
/** Flesch–Kincaid grade level (approximate; good enough to flag grade-9+ corporate prose). */
function fkGrade(text: string): number {
  const ws = words(text);
  const ss = sentences(text);
  if (ws.length === 0 || ss.length === 0) return 0;
  const syll = ws.reduce((n, w) => n + countSyllables(w), 0);
  return 0.39 * (ws.length / ss.length) + 11.8 * (syll / ws.length) - 15.59;
}
function youMeRatio(text: string): number {
  const lower = ` ${text.toLowerCase()} `;
  const you = (lower.match(/\b(you|your|you're|yours)\b/g) || []).length;
  const me = (lower.match(/\b(i|i'm|i've|my|we|our|we're|us)\b/g) || []).length;
  if (me === 0) return you > 0 ? 99 : 1;
  return you / me;
}
function countOccurrences(text: string, terms: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => {
    // word-boundary match for single words; substring for phrases
    if (/\s/.test(t) || t.includes("$")) return lower.includes(t);
    return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower);
  });
}

// Linear score: full marks at/below `good`, zero at/above `bad`.
function rampDown(value: number, good: number, bad: number): number {
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return Math.round(100 * (1 - (value - good) / (bad - good)));
}

// --- the deterministic grader --------------------------------------------

export function gradeEmail(
  email: { subject: string; body: string },
  context?: { company?: string | null }
): EmailGrade {
  const subject = (email.subject || "").trim();
  const body = (email.body || "").trim();
  const dims: DimensionScore[] = [];
  let hardFail = false;

  // 1. Length (weight 3) — the single biggest measurable lever.
  const bw = wordCount(body);
  const lenScore = bw === 0 ? 0 : rampDown(bw, RUBRIC.body.idealMaxWords, RUBRIC.body.flagWords);
  dims.push({
    key: "length", label: "Length", weight: 3, score: lenScore,
    note: `${bw} words`,
    fix: lenScore < 60 ? `Cut the body to under ${RUBRIC.body.idealMaxWords} words (it's ${bw}). Fewer, shorter sentences.` : undefined,
  });

  // 2. Subject (weight 2).
  const sw = wordCount(subject);
  const subjLower = subject.toLowerCase();
  const subjSalesy = /\b(boost|grow|revenue|save|increase|demo|solution|offer|sale)\b/i.test(subject) || /!/.test(subject);
  const subjAllCaps = subject.length > 3 && subject === subject.toUpperCase();
  let subjScore = rampDown(sw, RUBRIC.subject.idealMaxWords, RUBRIC.subject.hardMaxWords + 6);
  if (subjSalesy) subjScore = Math.min(subjScore, 50);
  if (subjAllCaps) { subjScore = Math.min(subjScore, 30); }
  // lowercase bonus (mirrors internal email), proper nouns excepted — reward absence of Title Case
  const titleCase = subject.split(/\s+/).filter((w) => /^[A-Z][a-z]+$/.test(w)).length >= 3;
  if (titleCase) subjScore = Math.min(subjScore, 70);
  dims.push({
    key: "subject", label: "Subject line", weight: 2, score: subjScore,
    note: `${sw} words${subjSalesy ? ", salesy" : ""}${subjAllCaps ? ", ALL CAPS" : ""}${titleCase ? ", Title Case" : ""}`,
    fix: subjScore < 60 ? `Rewrite the subject to <=${RUBRIC.subject.idealMaxWords} lowercase words anchored to their world, no sell, no exclamation.` : undefined,
  });

  // 3. Opener (weight 2) — first sentence about them, no filler/self-intro (HARD fail).
  const firstSentence = (sentences(body)[0] || "").toLowerCase();
  const fillerHit = FILLER_OPENERS.find((f) => firstSentence.includes(f) || body.toLowerCase().startsWith(f));
  const startsWithSelf = /^(i|i'm|i am|my|we|we're|hi[,.\s]+i)\b/.test(firstSentence);
  let openScore = 100;
  if (fillerHit) { openScore = 0; hardFail = true; }
  else if (startsWithSelf) openScore = 40;
  dims.push({
    key: "opener", label: "Opening line", weight: 2, score: openScore,
    note: fillerHit ? `filler opener: "${fillerHit}"` : startsWithSelf ? "opens about you, not them" : "opens about them",
    fix: openScore < 60 ? "Rewrite sentence 1 to be about THEM (their company/role/trigger). No 'I hope…', 'My name is', 'I'm reaching out'." : undefined,
  });

  // 4. CTA / links / questions (weight 2) — one low-friction reply-first ask; links in step 1 HARD fail.
  const linkCount = (body.match(/https?:\/\/|calendly|cal\.com|\bbook a\b|meetings\./gi) || []).length;
  const questionCount = (body.match(/\?/g) || []).length;
  let ctaScore = 100;
  const ctaNotes: string[] = [];
  if (linkCount > RUBRIC.links.idealMax) { ctaScore = Math.min(ctaScore, 20); if (linkCount >= RUBRIC.links.hardMax) hardFail = true; ctaNotes.push(`${linkCount} links`); }
  if (questionCount > RUBRIC.questions.idealMax) { ctaScore = Math.min(ctaScore, 55); ctaNotes.push(`${questionCount} questions`); }
  if (questionCount === 0) { ctaScore = Math.min(ctaScore, 70); ctaNotes.push("no clear ask"); }
  dims.push({
    key: "cta", label: "CTA", weight: 2, score: ctaScore,
    note: ctaNotes.length ? ctaNotes.join(", ") : "single reply-first ask",
    fix: ctaScore < 60 ? "End with exactly ONE low-friction reply-first ask (no link in step 1), at most one question." : undefined,
  });

  // 5. Readability (weight 2) — grade level + longest sentence.
  const grade = fkGrade(body);
  const longest = Math.max(0, ...sentences(body).map(wordCount));
  let readScore = rampDown(grade, RUBRIC.readability.targetGrade + 1, RUBRIC.readability.hardGrade + 3);
  if (longest > RUBRIC.readability.longSentenceWords) readScore = Math.min(readScore, 60);
  dims.push({
    key: "readability", label: "Readability", weight: 2, score: readScore,
    note: `grade ${grade.toFixed(1)}, longest sentence ${longest}w`,
    fix: readScore < 60 ? `Lower the reading level toward grade ${RUBRIC.readability.targetGrade}: shorter sentences (<20 words), simpler words, contractions.` : undefined,
  });

  // 6. You:me ratio (weight 1) — make it about them.
  const ratio = youMeRatio(body);
  const ratioScore = ratio >= RUBRIC.youMeRatio.min ? 100 : Math.round(60 * ratio);
  dims.push({
    key: "youMe", label: "You:me balance", weight: 1, score: ratioScore,
    note: `you:me ≈ ${ratio === 99 ? "all-you" : ratio.toFixed(2)}`,
    fix: ratioScore < 60 ? "Shift the language toward 'you/your' — it reads self-centered with this many I/we references." : undefined,
  });

  // 7. Deliverability hygiene (weight 1) — spam words / caps / exclamation.
  const spamHits = countOccurrences(body, SPAM_WORDS);
  const bangs = (body.match(/!/g) || []).length;
  const caps = (body.match(/\b[A-Z]{4,}\b/g) || []).length;
  let deliverScore = 100 - spamHits.length * 25 - bangs * 15 - caps * 10;
  deliverScore = Math.max(0, deliverScore);
  dims.push({
    key: "deliverability", label: "Deliverability", weight: 1, score: deliverScore,
    note: [spamHits.length ? `spam words: ${spamHits.join(", ")}` : "", bangs ? `${bangs} '!'` : "", caps ? `${caps} ALL-CAPS` : ""].filter(Boolean).join("; ") || "clean",
    fix: deliverScore < 60 ? `Remove spam/hype words (${spamHits.join(", ") || "none"}), exclamation marks, and ALL-CAPS.` : undefined,
  });

  // 8. AI-tells (weight 2) — cluster-scored.
  const tellHits = countOccurrences(body + " " + subject, AI_TELL_WORDS);
  const emDashes = (body.match(/—|–/g) || []).length;
  const notJustBut = /\bnot just\b[^.?!]*\bbut\b/i.test(body) || /\bit'?s not (just )?about\b/i.test(body);
  const hasContractions = /\b\w+'(s|re|ve|ll|t|d|m)\b/i.test(body);
  let aiScore = 100 - tellHits.length * 20 - emDashes * 15 - (notJustBut ? 20 : 0) - (!hasContractions && wordCount(body) > 25 ? 15 : 0);
  aiScore = Math.max(0, aiScore);
  dims.push({
    key: "aiTells", label: "Human (not AI)", weight: 2, score: aiScore,
    note: [tellHits.length ? `buzzwords: ${tellHits.join(", ")}` : "", emDashes ? `${emDashes} em dash` : "", notJustBut ? "'not just X but Y'" : "", !hasContractions ? "no contractions" : ""].filter(Boolean).join("; ") || "reads human",
    fix: aiScore < 60 ? `Strip AI-tells: ${[tellHits.join(", "), emDashes ? "em dashes" : "", notJustBut ? "'not just X but Y'" : ""].filter(Boolean).join(", ")}. Use contractions and concrete, slightly imperfect language.` : undefined,
  });

  // 9. Hyper-personalization (weight 3, only when we know the company) — the opener must reference
  // THIS company specifically. A generic opener with no company anchor is the #1 reply-rate killer.
  const company = (context?.company || "").trim();
  if (company) {
    const opener = (sentences(body).slice(0, 2).join(". ")).toLowerCase();
    // distinctive token of the company name (drop common suffixes), e.g. "Brightland" from "Brightland Inc"
    const token = company.toLowerCase().replace(/\b(inc|llc|corp|co|company|ltd|group|the)\b/g, "").trim().split(/\s+/).filter((w) => w.length >= 3)[0];
    const mentionsCompany = token ? opener.includes(token) || body.toLowerCase().slice(0, 200).includes(token) : false;
    const persScore = mentionsCompany ? 100 : 25;
    dims.push({
      key: "personalization", label: "Personalization", weight: 3, score: persScore,
      note: mentionsCompany ? `opener names "${company}"` : `opener never names "${company}" — reads generic`,
      fix: mentionsCompany ? undefined : `Open by naming ${company} and a real, specific trigger about them (launch/hire/their actual motion). No generic praise.`,
    });
  }

  return finalize(dims, hardFail);
}

function finalize(dims: DimensionScore[], hardFail: boolean): EmailGrade {
  const totalWeight = dims.reduce((n, d) => n + d.weight, 0);
  const weighted = dims.reduce((n, d) => n + d.score * d.weight, 0) / (totalWeight || 1);
  let score = Math.round(weighted);
  if (hardFail) score = Math.min(score, 45); // a hard violation caps the score regardless of the rest
  const sorted = [...dims].sort((a, b) => a.score * a.weight - b.score * b.weight);
  const issues = sorted.filter((d) => d.score < 70).map((d) => `${d.label} (${d.score}): ${d.note}`);
  const fixes = sorted.filter((d) => d.fix).map((d) => d.fix!) as string[];
  return { score, pass: score >= PASS_THRESHOLD && !hardFail, dimensions: dims, issues, fixes, hardFail };
}

// --- LLM judge for the subjective, highest-weight dimensions --------------

export type JudgeResult = {
  personalizationScore: number; // 0-100
  problemFirstScore: number;    // 0-100
  notes: string;
  fixes: string[];
};

/**
 * LLM pass for what a regex can't see: is the personalization a REAL company/activity trigger with a
 * relevance bridge (not generic merge-token filler), and does it lead with the prospect's problem
 * before the pitch? Returns scores + concrete fixes. Best-effort — returns null on any failure.
 */
export async function judgeEmailContent(
  anthropicKey: string,
  email: { subject: string; body: string },
  context: { company?: string | null; persona?: string | null; product?: string | null },
  model: string
): Promise<JudgeResult | null> {
  const system = `You are a cold-email reply-rate judge. Score two things on 0-100 and give concrete fixes. Be strict and specific.
- personalizationScore: is the opener a REAL, specific read on THIS company/role (their actual motion, a trigger like a launch/hire/funding) with a "so this likely means…" bridge — vs generic ("love what you're doing"), person-trivia, or mail-merge filler? Generic = low.
- problemFirstScore: does it lead with a problem the prospect already cares about BEFORE pitching the product, with specific/named proof after — vs opening with the solution/feature dump? Solution-first = low.
Return STRICT JSON only: {"personalizationScore":N,"problemFirstScore":N,"notes":"...","fixes":["...","..."]}`;
  const user = `Company: ${context.company ?? "unknown"} | Role/persona: ${context.persona ?? "unknown"}${context.product ? ` | Our product: ${context.product}` : ""}

SUBJECT: ${email.subject}
BODY:
${email.body}

Score it. STRICT JSON only.`;
  try {
    const { text } = await callAnthropic(anthropicKey, user, { maxTokens: 500, model, systemPrompt: system });
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return {
      personalizationScore: Math.max(0, Math.min(100, Number(json.personalizationScore) || 0)),
      problemFirstScore: Math.max(0, Math.min(100, Number(json.problemFirstScore) || 0)),
      notes: typeof json.notes === "string" ? json.notes : "",
      fixes: Array.isArray(json.fixes) ? json.fixes.filter((x: unknown): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

/** Full grade = deterministic dimensions + the LLM-judged personalization & problem-first dimensions. */
export async function gradeEmailFull(
  anthropicKey: string,
  email: { subject: string; body: string },
  context: { company?: string | null; persona?: string | null; product?: string | null },
  model: string
): Promise<EmailGrade> {
  const base = gradeEmail(email);
  const judge = await judgeEmailContent(anthropicKey, email, context, model);
  if (!judge) return base;
  const extra: DimensionScore[] = [
    {
      key: "personalization", label: "Personalization", weight: 3, score: judge.personalizationScore,
      note: judge.notes.slice(0, 120),
      fix: judge.personalizationScore < 60 ? (judge.fixes[0] ?? "Open with a real company/activity trigger + a relevance bridge, not generic praise.") : undefined,
    },
    {
      key: "problemFirst", label: "Problem-first", weight: 3, score: judge.problemFirstScore,
      note: judge.notes.slice(0, 120),
      fix: judge.problemFirstScore < 60 ? (judge.fixes[1] ?? judge.fixes[0] ?? "Lead with a problem they already care about before pitching; put named proof after.") : undefined,
    },
  ];
  return finalize([...base.dimensions, ...extra], base.hardFail);
}
