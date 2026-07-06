import { prisma } from "@/lib/prisma";
import { wilsonLower } from "@/lib/stats";

/**
 * The eight radical SUBJECT-LINE MECHANISMS we're A/B-testing on the quirky styles. Each is a distinct
 * psychological lever, not just a different line — so we learn which MECHANISM cuts through, then flood it.
 * The body stays quirky (ultra-short + money); only the subject mechanism rotates. Each lead is tagged
 * with its mechanism (Lead.incentiveSubjectStyle = "subj:<key>") so we can rate reply rate per mechanism.
 */
export type SubjectMechanism = { key: string; label: string; guide: string; examples: string[] };

export const SUBJECT_MECHANISMS: SubjectMechanism[] = [
  { key: "money-hook", label: "Money hook", guide: "Lead with the incentive itself — the bribe IS the hook. Make the gift the reason to open.", examples: ["$100 for 15 minutes", "we'll pay you to hear us out", "bribe incoming 💸", "$100 says you'll like this"] },
  { key: "anti-sales", label: "Anti-sales honesty", guide: "Disarming, self-aware, admits it's a cold email — feels human, not a pitch.", examples: ["cold email, but a good one", "yes, this is a sales email 🙃", "ignore if you're slammed", "weird ask"] },
  { key: "reverse-psych", label: "Reverse psychology", guide: "Low-status / permission-to-say-no framing that provokes curiosity.", examples: ["probably not for you", "you won't reply to this", "bet you're too busy for this"] },
  { key: "texting", label: "Texting a colleague", guide: "Lowercase fragment, looks like an internal note from a coworker, not marketing.", examples: ["hey — quick one", "before your 2pm", "this'll take 20 seconds", "re: your customers"] },
  { key: "status-fear", label: "Status / fear", guide: "Career stakes — must be honest and grounded in the body, never a scare lie.", examples: ["your competitor already knows this", "the CMO's gonna ask about this", "impress your boss"] },
  { key: "numbers", label: "Specific numbers", guide: "A concrete number that's credible and curiosity-provoking.", examples: ["9 days vs 6 weeks", "60M people, one question", "$1.2M in creative you can't validate"] },
  { key: "emoji-only", label: "Emoji-only", guide: "1-3 fitting emojis, near-empty — maximum pattern interrupt.", examples: ["🍿👀", "💰⏰", "🏆?", "🎯"] },
  { key: "open-loop", label: "Open-loop insight", guide: "A curiosity gap the tiny body then closes — never clickbait it can't pay off.", examples: ["the thing your buyers won't tell you", "what [company] gets wrong about its customers", "3 things your dashboard can't see"] },
];

export const MECHANISM_KEYS = SUBJECT_MECHANISMS.map((m) => m.key);
export const MECHANISM_TAG_PREFIX = "subj:";

export function mechanismForIndex(i: number): SubjectMechanism {
  return SUBJECT_MECHANISMS[((i % SUBJECT_MECHANISMS.length) + SUBJECT_MECHANISMS.length) % SUBJECT_MECHANISMS.length];
}

/** Prompt block that tells the writer to use this mechanism for the subject. */
export function subjectMechanismBlock(m: SubjectMechanism): string {
  return `\n\nSUBJECT MECHANISM for THIS email (use it, tailored to the company): ${m.label} — ${m.guide} Examples of the vibe: ${m.examples.map((e) => `"${e}"`).join(" · ")}. Keep the subject captivating and honest (the body must back it up).`;
}

export type MechanismStat = { key: string; label: string; sent: number; positives: number; ratePct: number; wilsonLowerPct: number };

/** Reply rate per subject mechanism (from the Lead.incentiveSubjectStyle tag), best-first by confidence. */
export async function rateSubjectMechanisms(workspaceId: string): Promise<{ mechanisms: MechanismStat[]; leader: string | null }> {
  const tags = MECHANISM_KEYS.map((k) => `${MECHANISM_TAG_PREFIX}${k}`);
  const [sent, positive] = await Promise.all([
    prisma.lead.groupBy({ by: ["incentiveSubjectStyle"], where: { leadBatch: { workspaceId }, sentAt: { not: null }, incentiveSubjectStyle: { in: tags } }, _count: true }),
    prisma.lead.groupBy({ by: ["incentiveSubjectStyle"], where: { leadBatch: { workspaceId }, sentAt: { not: null }, replyStatus: "positive", incentiveSubjectStyle: { in: tags } }, _count: true }),
  ]);
  const sentMap = new Map(sent.map((r) => [r.incentiveSubjectStyle, r._count]));
  const posMap = new Map(positive.map((r) => [r.incentiveSubjectStyle, r._count]));
  const mechanisms = SUBJECT_MECHANISMS.map((m) => {
    const tag = `${MECHANISM_TAG_PREFIX}${m.key}`;
    const s = sentMap.get(tag) ?? 0;
    const p = posMap.get(tag) ?? 0;
    return { key: m.key, label: m.label, sent: s, positives: p, ratePct: s > 0 ? Math.round((p / s) * 10000) / 100 : 0, wilsonLowerPct: Math.round(wilsonLower(p, s) * 10000) / 100 };
  }).sort((a, b) => b.wilsonLowerPct - a.wilsonLowerPct || b.sent - a.sent);
  // Confident leader: top mechanism with real positives whose lower bound beats the field.
  const withData = mechanisms.filter((m) => m.sent >= 100);
  const leader = withData.length > 0 && withData[0].positives >= 2 ? withData[0].key : null;
  return { mechanisms, leader };
}
