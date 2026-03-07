/**
 * Lead research: synthesizes scraped + structured data into specific insights.
 * Called before landing page content generation so the page (and email) feel
 * like genuine homework was done on the prospect.
 */

import { callAnthropic } from "@/lib/anthropic";

export interface LeadResearch {
  companyContext: string;           // 1–2 sentence summary of what the company does
  observations: string[];           // 3–5 specific observations about their situation
  likelyUseCase: string;            // the single most relevant use case for this person
  relevanceReason: string;          // why THIS product matters for THIS person specifically
  assetAngle: string;               // what kind of synthetic asset would resonate (e.g. "brand health brief", "competitive landscape snapshot", "customer segmentation analysis")
}

interface ResearchInput {
  name: string | null;
  jobTitle: string | null;
  company: string | null;
  industry: string | null;
  website: string | null;
  websiteText: string | null;       // from scrapeForContext
  productSummary: string;
  icp: string;
}

export async function generateLeadResearch(
  input: ResearchInput,
  anthropicKey: string,
  model: string
): Promise<LeadResearch> {
  const { name, jobTitle, company, industry, website, websiteText, productSummary, icp } = input;

  const prompt = `You are a senior account researcher preparing intel before an outbound email.

PRODUCT BEING SOLD:
${productSummary}

TARGET CUSTOMER PROFILE:
${icp}

PROSPECT:
- Name: ${name ?? "unknown"}
- Title: ${jobTitle ?? "unknown"}
- Company: ${company ?? "unknown"}
- Industry: ${industry ?? "unknown"}
- Website: ${website ?? "none"}
${websiteText ? `\nCOMPANY WEBSITE CONTENT:\n${websiteText}` : ""}

Based on this, produce a JSON object with EXACTLY these keys:
{
  "companyContext": "1–2 sentences summarizing what this company does and their likely scale/stage",
  "observations": [
    "Specific observation 1 about their situation, challenges, or context that would make them care about the product",
    "Specific observation 2",
    "Specific observation 3"
  ],
  "likelyUseCase": "The single most compelling use case for this person given their role and company (e.g. 'tracking brand sentiment after their Series B', 'monitoring competitor positioning in their vertical')",
  "relevanceReason": "1 sentence: WHY this product is uniquely relevant to this specific person — connect their role to a concrete outcome",
  "assetAngle": "The type of synthetic research asset that would resonate most with this person's role. Be specific and varied — examples: 'brand health benchmark for SaaS companies at their stage', 'win/loss analysis template for mid-market sales teams', 'AI research ROI calculator for enterprise CMOs', 'customer churn sentiment brief for QSR brands'. Match the asset to their role, industry, and the product being sold."
}

RULES:
- Be specific. Use the company name, their industry, their role. No generic statements.
- observations should feel like you actually looked into their company, not boilerplate.
- If website content is available, extract specific details (products, recent news, language they use).
- If little info is available, make educated inferences based on title + industry.
- Return ONLY valid JSON, no markdown, no preamble.`;

  try {
    const { text } = await callAnthropic(anthropicKey, prompt, {
      model,
      maxTokens: 800,
    });
    const clean = text.replace(/```json|```/g, "").trim();
    // Extract the outermost {...} block — handles preamble/postamble Claude sometimes adds
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) throw new Error("No JSON object found in response");
    const parsed = JSON.parse(clean.slice(start, end + 1)) as LeadResearch;
    // Validate and normalise
    return {
      companyContext: parsed.companyContext ?? "",
      observations: Array.isArray(parsed.observations) ? parsed.observations.slice(0, 5) : [],
      likelyUseCase: parsed.likelyUseCase ?? "",
      relevanceReason: parsed.relevanceReason ?? "",
      assetAngle: parsed.assetAngle ?? "research brief",
    };
  } catch {
    // Graceful fallback so generation still proceeds
    return {
      companyContext: company ? `${company} is a ${industry ?? "company"}.` : "",
      observations: [
        jobTitle ? `${name ?? "They"} is a ${jobTitle} and likely owns research or insights workflows` : "They may benefit from faster research",
      ],
      likelyUseCase: "AI-powered research",
      relevanceReason: "This product could save them significant time on research.",
      assetAngle: "research brief",
    };
  }
}
