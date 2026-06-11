import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { scrapeForContext } from "@/lib/scrape";
import { callAnthropic } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

/**
 * POST { domain } → scrape the home page and draft a Product Summary + ICP with Claude.
 * Returns both for the client to review/edit before saving via /api/onboarding.
 * Does NOT persist — autofill is a suggestion, the operator decides what to keep.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { anthropicKey: true, domain: true, anthropicModel: true },
    });
    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Add your Anthropic API key first." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const rawDomain = (typeof body.domain === "string" && body.domain.trim()) || workspace.domain || "";
    if (!rawDomain) {
      return NextResponse.json({ error: "Enter your website first." }, { status: 400 });
    }
    const url = rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain.replace(/^www\./, "")}`;

    const scraped = await scrapeForContext(url);
    if (!scraped) {
      return NextResponse.json({ error: `Couldn't read ${rawDomain}. Check the URL or fill the fields in manually.` }, { status: 400 });
    }

    const anthropicKey = decrypt(workspace.anthropicKey);
    const model = workspace.anthropicModel ?? "claude-haiku-4-5";

    const prompt = `Below is the scraped home page of a company. Based ONLY on what it actually says, write two things for their cold-email tool:

1. "productSummary": 2-4 sentences on what the product does, who it's for, and the core value. Specific and concrete, no marketing fluff, no buzzwords.
2. "icp": their ideal customer profile — the roles, company types, industries, and the pain those buyers feel. Be specific; this drives who gets emailed and how.

Return ONLY valid JSON, no markdown, no preamble: {"productSummary": "...", "icp": "..."}

Home page content:
${scraped}`;

    const { text } = await callAnthropic(anthropicKey, prompt, { maxTokens: 700, model });

    let parsed: { productSummary?: string; icp?: string } = {};
    try {
      const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: "Couldn't parse the draft. Try again or fill the fields manually." }, { status: 502 });
    }

    return NextResponse.json({
      productSummary: (parsed.productSummary ?? "").trim(),
      icp: (parsed.icp ?? "").trim(),
    });
  } catch (error) {
    console.error("Autofill error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
