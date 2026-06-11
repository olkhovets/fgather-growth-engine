/**
 * Email quality validator — enforces hard bans on AI-sounding language,
 * em dashes, filler openers, and banned words per CLAUDE.md rules.
 * Returns a list of violations. Empty array = clean.
 */

const BANNED_WORDS = [
  "leverage", "delve", "streamline", "synergy", "unlock", "empower",
  "revolutionize", "game-changer", "cutting-edge", "innovative", "seamlessly",
  "robust", "scalable", "holistic", "transformative", "utilize", "facilitate",
  "spearhead", "elevate", "supercharge", "reimagine", "best-in-class",
  "world-class", "dynamic", "impactful",
];

const FILLER_OPENERS = [
  "i hope this finds you well",
  "i wanted to reach out",
  "i'm reaching out because",
  "i am reaching out because",
];

export type EmailViolation = {
  type: "em_dash" | "banned_word" | "filler_opener" | "oxford_comma_abuse" | "bullet_points";
  detail: string;
};

export function validateEmailContent(text: string): EmailViolation[] {
  const violations: EmailViolation[] = [];
  const lower = text.toLowerCase();

  if (text.includes("—") || text.includes("–")) {
    violations.push({ type: "em_dash", detail: "Contains em dash or en dash — never allowed in emails" });
  }

  for (const word of BANNED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(text)) {
      violations.push({ type: "banned_word", detail: `Banned AI word: "${word}"` });
    }
  }

  for (const opener of FILLER_OPENERS) {
    if (lower.includes(opener)) {
      violations.push({ type: "filler_opener", detail: `Filler opener detected: "${opener}"` });
    }
  }

  if (/^\s*[-•*]\s/m.test(text)) {
    violations.push({ type: "bullet_points", detail: "Bullet points found — prose only in emails" });
  }

  return violations;
}

export function autoFixEmailContent(text: string): string {
  return text
    .replace(/—/g, "-")
    .replace(/–/g, "-");
}

export function validateEmailSteps(steps: Array<{ subject: string; body: string }>): {
  violations: Array<{ step: number; field: "subject" | "body"; issues: EmailViolation[] }>;
  hasViolations: boolean;
} {
  const violations: Array<{ step: number; field: "subject" | "body"; issues: EmailViolation[] }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const subjectIssues = validateEmailContent(step.subject);
    const bodyIssues = validateEmailContent(step.body);

    if (subjectIssues.length > 0) {
      violations.push({ step: i + 1, field: "subject", issues: subjectIssues });
    }
    if (bodyIssues.length > 0) {
      violations.push({ step: i + 1, field: "body", issues: bodyIssues });
    }
  }

  return { violations, hasViolations: violations.length > 0 };
}
