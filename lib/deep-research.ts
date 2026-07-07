/**
 * Deep per-lead research via web search — the real "connect on a personal level" step.
 *
 * The homepage scrape (lib/scrape.ts) only reads their marketing site, so it can't see the things
 * that actually earn a reply: a recent post, a campaign they just launched, a funding round, a new
 * hire, a rebrand, or the PHASE their brand/marketing is in. This runs an actual web search per lead
 * and synthesizes ONE specific, real, recent hook to open the email with a genuine connection.
 *
 * Expensive + slow on purpose (a live web search + synthesis per lead). Best-effort: returns null if
 * nothing specific/real is found or the call fails, so generation falls back to the scrape/persona.
 * NEVER invents — the prompt forbids it and low-confidence results are dropped.
 */

export type DeepResearch = { hook: string; source: string; confidence: number };

// Basic web-search tool variant — broadly supported (incl. Haiku 4.5). The _20260209 dynamic-filtering
// variant is Opus 4.8/4.7/4.6 + Sonnet 4.6 only, so keep the basic one for the engine's default model.
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 3 };
const MIN_CONFIDENCE = 55; // below this the "hook" is too speculative to use — drop it

type Block = { type: string; text?: string };

export async function deepResearchLead(
  apiKey: string,
  lead: { name?: string | null; jobTitle?: string | null; company?: string | null; website?: string | null; industry?: string | null },
  model: string,
  siteText?: string | null,
): Promise<DeepResearch | null> {
  const company = lead.company?.trim();
  // Need at least a company (or a name) to research — otherwise there's nothing to search for.
  if (!company && !lead.name?.trim()) return null;

  const who = `${lead.name?.trim() || "the contact"}${lead.jobTitle ? `, ${lead.jobTitle}` : ""} at ${company || "their company"}`;
  const system = `You are a sharp B2B researcher finding ONE genuine, personal way to open a cold email. Use web search to find something REAL and RECENT (ideally the last ~6 months) about the prospect or their company: a post or interview they gave, a campaign or product they just launched, a funding round, a leadership hire, a rebrand, an award, an expansion, a notable customer, or the clear PHASE their brand/marketing is in right now (scaling, repositioning, launching a new line, moving off an agency, etc.).
Rules: report ONLY what you actually find in the search results — never guess, never invent a detail, never state something you can't source. Specific and true beats impressive. If you can't find anything specific and real, say so honestly.`;

  const user = `Find the single best, most specific, RECENT hook to personally connect with ${who}${lead.website ? ` (${lead.website})` : ""}${lead.industry ? `, industry: ${lead.industry}` : ""}.${siteText ? `\n\nTheir site (for context, not a substitute for search): ${siteText.slice(0, 700)}` : ""}

Return STRICT JSON only, nothing else:
{"hook":"<one specific, real, recent sentence about THEM a cold email could reference>","source":"<where you saw it>","confidence":<0-100, how sure you are it's real and specific>}
If nothing specific and real was found: {"hook":"","source":"","confidence":0}`;

  const messages: Array<{ role: string; content: unknown }> = [{ role: "user", content: user }];

  try {
    // Server-tool loop: the API may return stop_reason "pause_turn" while it searches — re-send to resume.
    for (let i = 0; i < 4; i++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 800, system, tools: [WEB_SEARCH_TOOL], messages }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { content?: Block[]; stop_reason?: string };
      messages.push({ role: "assistant", content: data.content ?? [] });
      if (data.stop_reason === "pause_turn") continue; // resume the search

      const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end < 0) return null;
      const j = JSON.parse(text.slice(start, end + 1)) as { hook?: string; source?: string; confidence?: number };
      const hook = typeof j.hook === "string" ? j.hook.trim() : "";
      const confidence = Math.max(0, Math.min(100, Number(j.confidence) || 0));
      if (!hook || confidence < MIN_CONFIDENCE) return null;
      return { hook, source: typeof j.source === "string" ? j.source.trim() : "", confidence };
    }
    return null;
  } catch {
    return null;
  }
}

/** Prompt block injecting the researched hook as the email's opener. Empty when no hook was found. */
export function deepResearchBlock(r: DeepResearch | null): string {
  if (!r) return "";
  return `\n\n*** REAL PERSONAL CONNECTION (verified via live web research — open on THIS, it is your single best hook) ***
Open the email by referencing this real, recent thing about them: ${r.hook}${r.source ? ` (source: ${r.source})` : ""}.
Make the connection genuine and human — like you actually noticed, not like you scraped it. Do NOT restate it word-for-word; weave it in naturally in sentence 1. Everything else (proof, ask) follows. Never contradict or embellish this fact.`;
}
