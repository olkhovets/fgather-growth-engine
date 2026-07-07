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

export type DeepResearch = {
  hook: string;        // the real, recent signal about them
  connection: string;  // WHY Gather is relevant to that signal (their situation ↔ what Gather does)
  source: string;
  confidence: number;
};

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
  gatherContext?: string | null,
): Promise<DeepResearch | null> {
  const company = lead.company?.trim();
  // Need at least a company (or a name) to research — otherwise there's nothing to search for.
  if (!company && !lead.name?.trim()) return null;

  const who = `${lead.name?.trim() || "the contact"}${lead.jobTitle ? `, ${lead.jobTitle}` : ""} at ${company || "their company"}`;
  const gather = gatherContext?.trim() || "Gather runs real AI-moderated consumer/buyer research in days (not a six-week study) and turns it into on-brand content, so marketing teams know what their customers actually want BEFORE they spend, validate campaigns and creative pre-launch, and stop guessing.";
  const system = `You are a sharp B2B researcher. Your job: search WIDELY for everything recent and public about a prospect's company, then pick the ONE signal that most directly connects to what WE do — and articulate that connection.

WHAT WE (Gather) DO — match signals against this:
${gather}

PROCESS:
1. Search broadly (their site, recent news, press, campaigns, product/line launches, funding, expansions, marketing/brand hires, rebrands, the phase their brand/marketing is in). Cast a wide net.
2. Of everything you find, choose the SINGLE signal where our capability is most obviously relevant — the one that makes a "we work on exactly this" connection land. A new product line, a launch, a rebrand, entering a new market, or a "scaling / repositioning / guessing at creative" moment are gold because they're all moments a brand needs to know what buyers want before spending.
3. State the connection plainly: their situation ↔ what we help with.

HARD RULES:
- Report ONLY what you actually find. Never guess, never invent, never state anything you can't source. Specific and true beats impressive.
- BUSINESS/PUBLIC signals only. NEVER personal/private life (family, health, hobbies, personal posts, opinions, where they live). It must pass the "not weird" test: if referencing it would make them think "how do you know that about me," use a company-level marketing signal instead.
- If nothing specific, real, and relevant to what we do is found, say so honestly (empty hook) rather than reaching.`;

  const user = `Research ${who}${lead.website ? ` (${lead.website})` : ""}${lead.industry ? `, industry: ${lead.industry}` : ""}. Search widely, then pick the ONE recent, real, business-appropriate signal that best connects to what we do, and explain the connection.${siteText ? `\n\nTheir site (context, not a substitute for search): ${siteText.slice(0, 700)}` : ""}

Return STRICT JSON only, nothing else:
{"hook":"<the one specific, real, recent signal about their company/work>","connection":"<one plain sentence: their situation ↔ what we help with, e.g. 'they just launched a new line, which is exactly when knowing what buyers want before spending pays off'>","source":"<where you saw it>","confidence":<0-100, how sure you are it's real, specific, relevant, and not weird>}
If nothing real and relevant was found: {"hook":"","connection":"","source":"","confidence":0}`;

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
      const j = JSON.parse(text.slice(start, end + 1)) as { hook?: string; connection?: string; source?: string; confidence?: number };
      const hook = typeof j.hook === "string" ? j.hook.trim() : "";
      const confidence = Math.max(0, Math.min(100, Number(j.confidence) || 0));
      if (!hook || confidence < MIN_CONFIDENCE) return null;
      return {
        hook,
        connection: typeof j.connection === "string" ? j.connection.trim() : "",
        source: typeof j.source === "string" ? j.source.trim() : "",
        confidence,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Prompt block injecting the researched hook + Gather-relevance connection as the opener. Empty when no hook. */
export function deepResearchBlock(r: DeepResearch | null): string {
  if (!r) return "";
  return `\n\n*** REAL RESEARCHED HOOK + WHY WE'RE RELEVANT (verified via live web research — THIS is your sentence-1 opener, override any other opener instruction) ***
The real, recent signal about them: ${r.hook}${r.source ? ` (source: ${r.source})` : ""}.
Why we connect to it: ${r.connection || "it's a moment where knowing what their buyers want before spending pays off"}.
HOW to use it so it lands (not weird, genuinely relatable):
- Open sentence 1 on the signal like one marketer casually noticing another's work — "saw [Company] just launched X" / "looks like you're mid-[phase]" — NOT a dossier. One short clause.
- Then in the SAME breath, make the connection: this is exactly the kind of thing we help with (tie their signal to our value, the "we work on exactly this" moment). That connection is why the email is worth their reply.
- Do NOT restate the fact word-for-word, do NOT gush, do NOT list multiple facts. One natural nod, then the relevance, then the ask.
- Never contradict, exaggerate, or invent beyond this fact. If it would feel intrusive to mention, drop it and open on their category instead.`;
}
