import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's workspace
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    if (!workspace || !workspace.domain) {
      return NextResponse.json(
        { error: "No domain configured. Please complete onboarding first." },
        { status: 400 }
      );
    }

    if (!workspace.anthropicKey) {
      return NextResponse.json(
        { error: "Anthropic API key not configured." },
        { status: 400 }
      );
    }

    // Decrypt Anthropic key
    const anthropicKey = decrypt(workspace.anthropicKey);

    // Fetch home page
    const domain = workspace.domain.startsWith("http") 
      ? workspace.domain 
      : `https://${workspace.domain}`;
    
    let html: string;
    try {
      const response = await fetch(domain, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GatherGrowthEngine/1.0)",
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      html = await response.text();
    } catch (fetchError: any) {
      return NextResponse.json(
        { error: `Failed to fetch ${domain}: ${fetchError.message}` },
        { status: 400 }
      );
    }

    // Extract text content (simple - remove script/style tags and get text)
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 10000); // Limit to 10k chars for API

    // Call Anthropic to summarize
    // Try multiple model names in case one is unavailable
    const modelNames = [
      "claude-opus-4-6", // Latest from docs
      "claude-3-5-sonnet-20241022",
      "claude-3-5-sonnet-20240620",
      "claude-3-sonnet-20240229",
    ];

    let productSummary: string | undefined;
    let lastError: any = null;

    for (const model of modelNames) {
      try {
        const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1000,
            messages: [
              {
                role: "user",
                content: `Analyze this website's home page content and write a 2-3 sentence summary of what this product/service does and who it's for. Be specific and concise.\n\nWebsite content:\n${textContent}`,
              },
            ],
          }),
        });

        if (!anthropicResponse.ok) {
          const errorData = await anthropicResponse.json().catch(() => ({}));
          lastError = new Error(`Anthropic API error (${model}): ${anthropicResponse.status} - ${JSON.stringify(errorData)}`);
          continue; // Try next model
        }

        const anthropicData = await anthropicResponse.json();
        productSummary = anthropicData.content[0]?.text || "Could not generate summary.";
        break; // Success, exit loop
      } catch (err: any) {
        lastError = err;
        continue; // Try next model
      }
    }

    if (!productSummary) {
      return NextResponse.json(
        { error: `Failed to generate summary with any model. Last error: ${lastError?.message || "Unknown error"}` },
        { status: 500 }
      );
    }

    // Save product summary to workspace
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { productSummary },
    });

    return NextResponse.json(
      { 
        message: "Product summary generated successfully",
        productSummary 
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Crawl error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
