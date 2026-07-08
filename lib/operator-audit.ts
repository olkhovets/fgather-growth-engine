/**
 * Operator-config audit — checks & balances so no single input silently flips the whole tide.
 *
 * The Extra instructions and playbook guidelines shape EVERY email. If one of them fights the core
 * goal (quirky, short, human, no credential-dump, no AI tells), it can flatten the entire send even
 * when the reply formula is perfect. The generation prompt now makes the core supreme so those inputs
 * can't override it — but the operator should still be TOLD when a config input is pulling against the
 * goal, so they can fix it at the source. This scans the two operator inputs and returns plain warnings.
 */

import { AI_TELL_WORDS, CRINGE_PHRASES } from "@/lib/cold-email-research";
import { hasBannedDash } from "@/lib/email-validator";

export type OperatorWarning = { source: "Extra instructions" | "Guidelines"; issue: string };

// Signals that a config input is pushing toward standard/vendor copy instead of the quirky/human goal.
const CREDENTIAL_FIRST = [
  "credential first", "credentials first", "lead with credential", "establish credibility",
  "backed by", "vc backing", "venture", "logo", "used by", "trusted by", "our customers include",
];
const FORMAL_TONE = ["specificity over hype", "professional tone", "formal", "consultative", "not a vendor but"];
const METRIC_CLAIM = /\b\d{1,3}%|\bmore inbound than\b|\bx (roi|return|revenue)\b|\b\$\d+[mMkK]\b|\bARR\b/;

function hits(text: string, terms: string[]): string[] {
  const l = text.toLowerCase();
  return terms.filter((t) => l.includes(t));
}

function auditOne(source: OperatorWarning["source"], text: string | null | undefined): OperatorWarning[] {
  const t = (text || "").trim();
  if (!t) return [];
  const out: OperatorWarning[] = [];
  const cred = hits(t, CREDENTIAL_FIRST);
  if (cred.length) out.push({ source, issue: `pushes credentials/logos to the front ("${cred[0]}") — fights leading with the reader. The core now overrides it, but it's cleaner to remove.` });
  const formal = hits(t, FORMAL_TONE);
  if (formal.length) out.push({ source, issue: `steers toward a formal/consultative tone ("${formal[0]}") — pulls against quirky/human.` });
  if (hasBannedDash(t)) out.push({ source, issue: `contains em/en dashes — the model can mirror them. They're stripped before use, but worth removing here too.` });
  const ai = hits(t, AI_TELL_WORDS);
  if (ai.length) out.push({ source, issue: `uses AI-tell words (${ai.slice(0, 3).join(", ")}) the model may echo.` });
  const cringe = hits(t, CRINGE_PHRASES);
  if (cringe.length) out.push({ source, issue: `contains cringe phrasing (${cringe.slice(0, 2).join(", ")}).` });
  if (METRIC_CLAIM.test(t)) out.push({ source, issue: `states a specific metric/result — if it's not provable, the model may repeat an unbacked claim.` });
  return out;
}

/** Audit the two operator inputs; returns warnings (empty = clean). */
export function auditOperatorInputs(input: { customInstructions?: string | null; guidelines?: string | null }): OperatorWarning[] {
  return [
    ...auditOne("Extra instructions", input.customInstructions),
    ...auditOne("Guidelines", input.guidelines),
  ];
}
