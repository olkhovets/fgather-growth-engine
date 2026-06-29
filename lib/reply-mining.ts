import { prisma } from "@/lib/prisma";
import { callAnthropic } from "@/lib/anthropic";
import { loadLearnings } from "@/lib/experiments";

/**
 * Reply-content mining. The richest signal the engine has is what real humans WROTE back —
 * what the positives said yes to, and exactly where the objectors pushed back. That text is
 * captured in CampaignReply.bodySnippet but, until now, used once for classification and then
 * thrown away. This reads it back, has Claude distill concrete, reusable copy lessons, and folds
 * them into Workspace.learningsJson so every future generation is written from real reply data —
 * not guesses. At a 0.05% positive rate the six positives are too few to A/B, but they are gold
 * as qualitative direction. Objections are equally valuable: they name the exact friction to remove.
 *
 * Safe by construction: read-only except for the learnings array; never sends or spends.
 */

const MAX_REPLIES_PER_CLASS = 40;   // cap the prompt size / token cost
const MIN_SNIPPET_LEN = 12;         // ignore empty/auto-ack one-liners
const LEARNINGS_CAP = 60;           // keep the most recent N learnings

type MinedReply = { fromEmail: string; subject: string; body: string; persona?: string | null; company?: string | null };

/** Pull recent classified replies of a given class, newest first, with the lead's persona/company. */
async function recentReplies(workspaceId: string, classification: string, limit: number): Promise<MinedReply[]> {
  const rows = await prisma.campaignReply.findMany({
    where: { sentCampaign: { workspaceId }, classification, bodySnippet: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit * 2, // over-pull, we filter empties below
    select: { fromEmail: true, subject: true, bodySnippet: true },
  });

  const out: MinedReply[] = [];
  for (const r of rows) {
    const body = (r.bodySnippet ?? "").trim();
    if (body.length < MIN_SNIPPET_LEN) continue;
    // Best-effort attribution to the lead for persona/company context.
    const lead = await prisma.lead.findFirst({
      where: { leadBatch: { workspaceId }, email: { equals: r.fromEmail.trim(), mode: "insensitive" } },
      select: { persona: true, company: true },
    });
    out.push({ fromEmail: r.fromEmail, subject: r.subject ?? "", body, persona: lead?.persona, company: lead?.company });
    if (out.length >= limit) break;
  }
  return out;
}

function renderReplies(label: string, replies: MinedReply[]): string {
  if (replies.length === 0) return "";
  const lines = replies.map((r, i) => {
    const ctx = [r.persona, r.company].filter(Boolean).join(", ");
    return `${i + 1}. ${ctx ? `[${ctx}] ` : ""}re "${r.subject}": ${r.body}`;
  });
  return `\n\n${label} (${replies.length}):\n${lines.join("\n")}`;
}

export type ReplyMiningResult = {
  positives: number;
  objections: number;
  notInterested: number;
  learningsAdded: string[];
  totalLearnings: number;
  skipped?: string;
};

/**
 * Mine the workspace's recent replies into concrete learnings. Requires an Anthropic key.
 * Returns the new learnings added (may be empty if there is nothing new to learn).
 */
export async function mineRepliesForWorkspace(
  workspaceId: string,
  anthropicKey: string,
  model: string
): Promise<ReplyMiningResult> {
  const [positives, objections, notInterested] = await Promise.all([
    recentReplies(workspaceId, "positive", MAX_REPLIES_PER_CLASS),
    recentReplies(workspaceId, "objection", MAX_REPLIES_PER_CLASS),
    recentReplies(workspaceId, "not_interested", MAX_REPLIES_PER_CLASS),
  ]);

  const total = positives.length + objections.length + notInterested.length;
  if (total === 0) {
    return { positives: 0, objections: 0, notInterested: 0, learningsAdded: [], totalLearnings: (await loadLearnings(workspaceId)).length, skipped: "no classified replies with content yet" };
  }

  const existing = await loadLearnings(workspaceId);

  const systemPrompt = `You are a cold-email copy analyst. You read what real recipients wrote back to cold outbound and extract CONCRETE, reusable copy directives — what to do MORE of (from positive replies) and what friction to REMOVE (from objections and rejections).

Rules for the directives you output:
- Each directive is one imperative sentence a copywriter can apply to the NEXT email (e.g. "Lead with the specific metric the buyer cares about (cost-per-insight), not a generic value claim").
- Ground every directive in the actual replies — quote or paraphrase the signal. Do NOT invent patterns the replies don't support.
- Positives tell you what landed (angle, proof, offer, timing). Objections/rejections tell you the exact reason-to-reply gap or friction to kill.
- No fluff, no banned AI words (no "leverage/streamline/unlock/elevate/seamless/robust"), no em dashes.
- If the evidence is too thin to support a directive, say so rather than padding.
- Return STRICT JSON only: {"learnings": string[], "summary": string}. 3-8 learnings max, highest-signal first.`;

  const userMessage = `Here are recent real replies to our cold outbound. Extract the copy lessons.${renderReplies("POSITIVE REPLIES (what landed — wants a call / interested / asked a buying question)", positives)}${renderReplies("OBJECTIONS (engaged but pushed back — the friction to remove)", objections)}${renderReplies("NOT INTERESTED (explicit no — what repelled them)", notInterested)}

${existing.length > 0 ? `We ALREADY apply these learnings, so only return NEW or sharper ones (don't repeat):\n${existing.map((l) => `- ${l}`).join("\n")}\n\n` : ""}Return STRICT JSON: {"learnings": string[], "summary": string}.`;

  let parsed: { learnings?: unknown; summary?: unknown } = {};
  try {
    const { text } = await callAnthropic(anthropicKey, userMessage, { maxTokens: 1200, model, systemPrompt });
    const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    parsed = JSON.parse(jsonStr);
  } catch {
    return { positives: positives.length, objections: objections.length, notInterested: notInterested.length, learningsAdded: [], totalLearnings: existing.length, skipped: "model returned no usable JSON" };
  }

  const fresh = Array.isArray(parsed.learnings)
    ? parsed.learnings.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];

  // Dedup against existing learnings by a loose prefix match so we don't accumulate near-duplicates.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 50);
  const seen = new Set(existing.map(norm));
  const added: string[] = [];
  for (const l of fresh) {
    if (seen.has(norm(l))) continue;
    seen.add(norm(l));
    added.push(`${l} (from replies)`);
  }

  if (added.length === 0) {
    return { positives: positives.length, objections: objections.length, notInterested: notInterested.length, learningsAdded: [], totalLearnings: existing.length, skipped: "no new lessons beyond what we already apply" };
  }

  const merged = [...existing, ...added].slice(-LEARNINGS_CAP);
  await prisma.workspace.update({ where: { id: workspaceId }, data: { learningsJson: JSON.stringify(merged) } });

  return {
    positives: positives.length,
    objections: objections.length,
    notInterested: notInterested.length,
    learningsAdded: added,
    totalLearnings: merged.length,
  };
}
