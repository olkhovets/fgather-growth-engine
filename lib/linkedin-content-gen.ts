import { callAnthropic } from "@/lib/anthropic";
import { gatherWinningSignals } from "@/lib/linkedin-ads-gen";

/**
 * LinkedIn ORGANIC content (channel #2). ColdIQ / Ivan Falco rate LinkedIn content
 * as the single most powerful distribution channel — it warms the same accounts the
 * ads + email hit (the flywheel). This turns the engine's proven winning signals
 * (hooks/personas/learnings that earned positive replies) into organic post drafts
 * Peter can publish. Generation only — never auto-posts.
 */

export type LinkedInPost = { hook: string; body: string; cta: string; persona: string; angle: string };

const SYSTEM = `You write LinkedIn ORGANIC posts (not ads) for the founder/team of Gather (gatherhq.com) — AI consumer research for B2C marketing leaders (CMOs, VP/Dir Marketing, Brand, Head of Growth at DTC/consumer brands).

You're given hooks/personas/angles that PROVABLY earned positive replies over cold email. Turn each into a scroll-stopping organic post that warms the audience (ICP-first: lead with a real buyer truth, not a product pitch).

Rules:
- First line is a hook that stops the scroll on its own (it's all most people see). Concrete, a little contrarian, specific to the persona's real problem.
- Body: 3-6 short lines / small paragraphs. A real insight or story from consumer research, not a feature list. White space, not a wall.
- No em dashes. No AI-slop (leverage, delve, unlock, supercharge, seamless, robust, elevate, game-changer, etc.). No "in today's fast-paced world". Sounds like a sharp operator wrote it.
- Soft CTA only — a question, or "DM me / comment X", never "book a demo". Organic earns attention, it doesn't hard-sell.
- No hashtag spam (0-2 max, only if natural).

Return ONLY a JSON array, no prose, no code fence. Each element:
{ "hook": string, "body": string, "cta": string, "persona": string, "angle": string }`;

function stripFence(t: string): string {
  return t.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
}

export async function generateLinkedInPosts(
  workspaceId: string,
  apiKey: string,
  model: string,
  count = 4
): Promise<{ posts: LinkedInPost[] }> {
  const n = Math.min(Math.max(count, 1), 8);
  const s = await gatherWinningSignals(workspaceId);
  const prompt = [
    `Write ${n} LinkedIn organic posts for Gather.`,
    s.icp ? `\nICP: ${s.icp}` : "",
    s.bestPersonas.length ? `\nBest-converting personas (write for these): ${s.bestPersonas.join(", ")}` : "",
    s.winningAngles.length ? `\nProven angles (adapt, don't copy):\n${s.winningAngles.map((a) => `- ${a}`).join("\n")}` : "",
    s.learnings.length ? `\nProven patterns:\n${s.learnings.map((l) => `- ${l}`).join("\n")}` : "",
    s.strategyNote ? `\nCurrent steer: ${s.strategyNote}` : "",
    (!s.winningAngles.length && !s.learnings.length) ? "\nLittle reply data yet — write strong posts on real consumer-research truths for the ICP above." : "",
  ].filter(Boolean).join("\n");

  const { text } = await callAnthropic(apiKey, prompt, { model: model || "claude-haiku-4-5", maxTokens: 3000, systemPrompt: SYSTEM });
  let parsed: unknown;
  try { parsed = JSON.parse(stripFence(text)); } catch { throw new Error("Post generation returned unparseable JSON"); }
  if (!Array.isArray(parsed)) throw new Error("Post generation did not return an array");

  const posts: LinkedInPost[] = [];
  for (const raw of parsed) {
    const r = raw as Record<string, unknown>;
    const hook = String(r.hook ?? "").trim();
    const body = String(r.body ?? "").trim();
    if (!hook || !body) continue;
    posts.push({
      hook,
      body,
      cta: String(r.cta ?? "").trim(),
      persona: String(r.persona ?? s.bestPersonas[0] ?? "general").trim(),
      angle: String(r.angle ?? "").trim(),
    });
  }
  if (posts.length === 0) throw new Error("Post generation produced no valid posts");
  return { posts };
}
