/**
 * Cold-outbound research knowledge base — the evidence-backed rules that make a cold email
 * get a positive reply, distilled from the best current practitioners and data studies
 * (Lavender, Gong + 30MPC's 85M-email report, Josh Braun, Jason Bay / Outbound Squad, Belkins).
 *
 * This is the "pulled from the web" layer baked into the repo so BOTH the grader
 * (lib/email-grader.ts) and the research-experiment generator (lib/research-experiments.ts)
 * draw from one sourced source of truth. Refresh it by re-running the research and editing here.
 *
 * Use RELATIVE LIFTS as weights, not absolute reply rates (those vary by source/definition).
 */

export type ResearchRule = {
  dimension: string;        // matches a grader dimension key
  rule: string;             // the testable directive
  evidence: string;         // the quantified finding (relative lift where possible)
  source: string;           // attribution + URL
};

export const COLD_EMAIL_RESEARCH: ResearchRule[] = [
  {
    dimension: "length",
    rule: "Keep step-1 body under 100 words, ideally 25–75, in 3–4 short sentences. Mobile-readable without scrolling.",
    evidence: "50–100-word emails reply at ~5.1x the rate of 200+-word emails (9.7% vs 1.9%); 150+ words are 42% less likely to get a reply.",
    source: "Gong/30MPC 500-email study; Lavender — lavender.ai/blog/best-length-cold-email",
  },
  {
    dimension: "subject",
    rule: "Subject line 2–4 words (≤40 chars), all lowercase, personalized on a SIGNAL — their brand, a launch/campaign, a competitor, or a real metric — NOT a bare first name or merge token. Reads like an internal note, never marketing. No sell, no spam words, no '!'. Patterns: 'company + topic', 'competitor?', 'rising cac?', 'idea to lift {brand}'s repeat rate', a recent trigger/event.",
    evidence: "2–4-word lowercase no-sell subjects hit 58%+ opens (~2x avg); trigger/event personalization ~+45% opens; personalized 46% open / 7% reply vs generic 35% / 3%; first-name-only mail-merge HURTS replies −12%; salesy words −17.9% opens; 2+ spam words ~73% worse placement.",
    source: "Gong 85M/30MPC; Belkins 5.5M; Smartlead; Lavender; Josh Braun",
  },
  {
    dimension: "personalization",
    rule: "Use a real company/activity trigger (hiring, funding, launch, their actual motion) + a 'so this likely means…' relevance bridge. Not person-trivia ('saw you went to X') or merge tokens.",
    evidence: "Real personalization ~5x's replies; for director+ roles company-priority personalization beats individual references. Generic ~9% vs advanced-context ~18%.",
    source: "Gong/30MPC; Lavender; Josh Braun — joshbraun.com/killer-cold-email-opening-lines",
  },
  {
    dimension: "opener",
    rule: "First sentence is about THEM (their company/role/trigger), not you. Ban 'I hope this finds you well', 'My name is…', 'I'm reaching out', 'I wanted to'.",
    evidence: "The first sentence shows in the preview pane and decides the open; self-intro / pleasantry openers waste it and read as mass mail.",
    source: "Josh Braun — first-line cheat sheet; Lavender cold email 101",
  },
  {
    dimension: "problemFirst",
    rule: "Lead with a problem the prospect already cares about, before any solution/product. Layer specific, named social proof AFTER the problem.",
    evidence: "Leading with the solution/product cuts replies up to 57%; problem-first lifts ~20%; named-customer social proof +41% replies.",
    source: "30MPC 85M study; Lavender benchmarks",
  },
  {
    dimension: "cta",
    rule: "Exactly one low-friction, value-based, reply-first ask (no calendar link in step 1). Offer something worth the meeting (teardown, benchmark, insight). At most one question.",
    evidence: "A compelling value-based offer beats a generic ask +28% replies; multiple/interrogating questions drop reply rate sharply (0 questions ~1.5% vs 1–5 questions 0.2–0.6%).",
    source: "30MPC 85M study; Belkins — belkins.io/blog/cold-email-response-rates",
  },
  {
    dimension: "readability",
    rule: "Write at ~5th-grade reading level: short sentences (mostly <15–20 words), simple words, contractions, slightly casual. More 'you' than 'I/we'.",
    evidence: "Slightly casual tone +23% replies; a single long sentence −17% replies; Lavender's gold standard is grade-5 prose and a 'you'-weighted I/You ratio.",
    source: "Lavender; Will Allred — linkedin.com/in/williamallred",
  },
  {
    dimension: "deliverability",
    rule: "Plain text, 0–1 links, no images/attachments in email 1. No ALL-CAPS, no '!!!', no urgency/hype words ('free', 'guaranteed', 'act now', 'limited time', '$$$').",
    evidence: ">2 links materially raises spam score; images and hype/urgency words trip multi-signal filters — copy that never reaches the inbox can't be replied to.",
    source: "Folderly/Litemail/Mailwarm 2025–26 spam-word guides",
  },
  {
    dimension: "aiTells",
    rule: "Avoid the AI fingerprint cluster: frequent em dashes, 'not just X but Y' balance, buzzwords (leverage/delve/streamline/elevate/unlock/seamless/robust), zero contractions, generic praise.",
    evidence: "No single token is conclusive, but the cluster reads as machine-written and kills the trust a cold email depends on. Score the cluster, not one word.",
    source: "Practitioner consensus; The Conversation — AI-writing tells",
  },
  {
    dimension: "oneIdea",
    rule: "One prospect problem, one proof, one ask. Don't stack multiple value props or CTAs.",
    evidence: "Multiple ideas dilute the single response you're trying to earn; step 1's job is to open the loop and earn a reply, not to sell.",
    source: "Lavender; 30MPC",
  },
];

/** Compact, weighted directive block for injecting the research floor into the generation prompt. */
export function researchPlaybookBlock(): string {
  return (
    "\n\nDATA-BACKED COLD-EMAIL RULES (from Lavender / Gong / 30MPC's 85M-email study / Josh Braun — apply ALL, they measurably drive replies):\n" +
    COLD_EMAIL_RESEARCH.map((r) => `- ${r.rule} [${r.evidence}]`).join("\n")
  );
}

/** The tactics the research-experiment generator may turn into personalized A/B variants. */
export function researchTacticsForExperiments(): ResearchRule[] {
  return COLD_EMAIL_RESEARCH;
}

// --- Numeric thresholds the deterministic grader scores against (single source of truth) ---
export const RUBRIC = {
  body: { idealMaxWords: 45, hardMaxWords: 80, flagWords: 110 },
  subject: { idealMaxWords: 4, hardMaxWords: 7 },
  readability: { targetGrade: 5, hardGrade: 9, longSentenceWords: 25 },
  links: { idealMax: 1, hardMax: 2 },
  questions: { idealMax: 1 },
  // you:me ratio — count of 2nd-person vs 1st-person references; >=1 means at least as much "you" as "I/we".
  youMeRatio: { min: 1.0 },
} as const;

export const SPAM_WORDS = [
  "free", "100% free", "risk-free", "guaranteed", "guarantee", "act now", "limited time",
  "urgent", "winner", "best price", "miracle", "no cost", "cash", "cheap", "buy now",
  "click here", "order now", "amazing", "incredible offer", "$$$",
];

export const FILLER_OPENERS = [
  "i hope this finds you well", "i hope this email finds you well", "i hope you're doing well",
  "my name is", "allow me to introduce", "i wanted to reach out", "i'm reaching out",
  "i am reaching out", "i wanted to connect", "i just wanted to", "hope all is well",
];

// AI-tell vocabulary (cluster-scored, never a single-word fail).
export const AI_TELL_WORDS = [
  "leverage", "delve", "streamline", "synergy", "unlock", "empower", "revolutionize",
  "seamless", "seamlessly", "robust", "scalable", "holistic", "transformative", "utilize",
  "facilitate", "spearhead", "elevate", "supercharge", "reimagine", "best-in-class",
  "world-class", "cutting-edge", "game-changer", "tailored solutions", "drive growth",
  "navigate the landscape", "fast-paced world",
];
