/**
 * "Wildcard" email approaches — deliberately radical, very different from the standard
 * playbook. A small slice of every batch (~10%, spread across these) gets one of these,
 * so we can discover whether any unconventional angle breaks through when the normal
 * approach is getting near-zero replies. Each lead's approach is recorded on
 * Lead.wildcardApproach so we can measure reply rate per approach.
 *
 * Hard rules still apply to all of them: no links in step 1, no em dashes, no AI-sounding
 * words, prose only, human voice. Each MUST still produce a real subject (>=10 chars) and
 * a body of at least ~2 short sentences (>=50 chars) so it passes the send quality gate.
 */
export const WILDCARD_APPROACHES: Array<{ label: string; instruction: string }> = [
  {
    label: "one-punch",
    instruction: "Radically short. Two sentences max: one sharp observation about their world, then one blunt question. No pleasantries, no setup, no signature fluff. It should feel like a text, not an email.",
  },
  {
    label: "brutally-honest",
    instruction: "Be disarmingly self-aware that this is a cold email. Open by admitting it (e.g. 'This is a cold email, but stay with me for 10 seconds'). Honesty as the pattern interrupt. Then one specific, real reason it's worth their reply.",
  },
  {
    label: "contrarian-take",
    instruction: "Open with a provocative, slightly controversial claim about how their industry does marketing or research (something they might disagree with). Make them want to argue back. The reply IS the goal.",
  },
  {
    label: "specific-compliment",
    instruction: "Lead with a genuinely specific, researched compliment about their recent campaign, product, or brand voice (not generic flattery). Then one curious question that builds on it.",
  },
  {
    label: "gift-card-first",
    instruction: "Lead boldly with the incentive in the very first line (e.g. 'I'll send you a $100 Uber Eats card for 20 minutes of your time, no strings'). Be upfront and a little cheeky about bribing them, then say why it'd actually be worth it.",
  },
  {
    label: "tiny-story",
    instruction: "Open with a 2-sentence mini-story about another consumer brand that learned something the hard way (or got a surprising result), then connect it to them in one line and ask a question.",
  },
  {
    label: "all-questions",
    instruction: "The entire email is 2-3 sharp, specific questions about their brand or their customers, and nothing else. No pitch, no proof, no ask for a meeting. Just questions that are interesting enough to answer.",
  },
  {
    label: "peer-fomo",
    instruction: "Name a recognizable peer or competitor brand and imply they're already doing something this person isn't (gently, not insultingly). Create a little fear of being behind. End with a low-key question.",
  },
  {
    label: "casual-text",
    instruction: "Write it like a casual message from a peer who genuinely respects them. Lowercase is fine, very conversational, zero corporate tone. Short. Like you'd actually text a friend who runs marketing.",
  },
  {
    label: "wrong-person",
    instruction: "Open by asking if they're even the right person for this (e.g. 'Are you the one who owns consumer research at [Company], or should I be bugging someone else?'). The 'point me to the right person' framing tends to earn replies.",
  },
  {
    label: "stat-shock",
    instruction: "Open with a surprising or counterintuitive statistic about their category or about how slow/expensive traditional research is. Make them go 'wait, really?' Then one line of relevance and a question.",
  },
  {
    label: "absurd-interrupt",
    instruction: "Use an unexpected, slightly absurd or playful opener that has nothing to do with a sales pitch, then pivot fast to a genuine, specific reason you're reaching out. The weirdness earns the read; the pivot earns the reply.",
  },
  {
    label: "future-headline",
    instruction: "Open by writing a one-line 'imaginary headline' about their brand winning at something six months from now, then say the one thing standing between them and it, and ask if they want to talk about it.",
  },
  {
    label: "radically-specific",
    instruction: "Reference something hyper-specific and current about their company (a recent launch, hire, ad, or post) as if you actually pay attention, then make a small bet about a challenge they're facing and ask if you're right.",
  },
];

/** Deterministic per-email hash so a lead always maps to the same wildcard decision. */
function hashEmail(email: string): number {
  let h = 0;
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Decide whether a lead gets a wildcard approach, and which one. ~1 in WILDCARD_EVERY
 * leads is a wildcard (the rest use the standard, higher-confidence generation). Wildcards
 * cycle deterministically across all approaches so each gets a small, even cohort.
 */
const WILDCARD_EVERY = 10; // ~10% of leads explore a radical approach
export function pickWildcard(email: string): { label: string; instruction: string } | null {
  if (!email) return null;
  const h = hashEmail(email.toLowerCase().trim());
  if (h % WILDCARD_EVERY !== 0) return null;
  return WILDCARD_APPROACHES[Math.floor(h / WILDCARD_EVERY) % WILDCARD_APPROACHES.length];
}
