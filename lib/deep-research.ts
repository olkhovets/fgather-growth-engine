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
  const system = `You are a sharp B2B researcher finding ONE professionally-appropriate way to open a cold email so it feels researched, not blasted. Use web search to find something REAL and RECENT (ideally the last ~6 months) about their COMPANY or their PROFESSIONAL WORK — a marketing/brand move: a campaign or product they just launched, a rebrand or repositioning, a funding round, an expansion or new market, a marketing/brand leadership hire, an award, a notable new customer, or the clear PHASE their brand/marketing is in right now (scaling, repositioning, launching a line, moving off an agency).

HARD RULES:
- Report ONLY what you actually find in search results. Never guess, never invent, never state anything you can't source. Specific and true beats impressive.
- BUSINESS/PUBLIC signals only. NEVER anything personal or private (family, health, hobbies, personal social posts, opinions, appearance, where they live). It must be something one professional could naturally mention to another in a first email without it feeling like they've been watched.
- The "not weird" test: if referencing it would make the recipient think "how/why do you know that about me," it fails — use a company-level marketing signal instead.
- If you can't find a specific, real, business-appropriate signal, say so honestly (empty hook) rather than reaching.`;

  const user = `Find the single best, most specific, RECENT, business-appropriate hook to open a cold email to ${who}${lead.website ? ` (${lead.website})` : ""}${lead.industry ? `, industry: ${lead.industry}` : ""}. Prefer a marketing/brand/company signal over anything about them as an individual.${siteText ? `\n\nTheir site (context, not a substitute for search): ${siteText.slice(0, 700)}` : ""}

Return STRICT JSON only, nothing else:
{"hook":"<one specific, real, recent, business-appropriate thing about their company/work to reference>","source":"<where you saw it>","confidence":<0-100, how sure you are it's real, specific, and not weird to mention>}
If nothing specific, real, and appropriate was found: {"hook":"","source":"","confidence":0}`;

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
  return `\n\n*** REAL RESEARCHED HOOK (verified via live web research — THIS is your sentence-1 opener, override any other opener instruction) ***
Open by referencing this real, recent thing about their company/work: ${r.hook}${r.source ? ` (source: ${r.source})` : ""}.
HOW to reference it so it lands (not weird):
- Sound like one marketing person casually noticing another's work — "saw [Company] just launched X" / "looks like you're mid-[phase]" — NOT like a dossier. One short clause, then move on.
- Reference it because it's RELEVANT to why you're writing (it connects to the problem/proof), not just to prove you did homework. If it doesn't connect, mention it lightly and pivot fast.
- Do NOT restate it word-for-word, do NOT gush, do NOT list multiple facts. One natural nod in sentence 1, then the bridge to why it matters, then proof + ask.
- Never contradict, exaggerate, or invent beyond this fact. If it would feel intrusive to mention, drop it and open on their category instead.`;
}
