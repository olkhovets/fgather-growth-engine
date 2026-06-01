import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { getAggregatedMemory } from "@/lib/performance-memory";
import { getTemplateById, PLAYBOOK_TEMPLATES } from "@/lib/playbook-templates";

export const dynamic = "force-dynamic";

/**
 * GET: Return list of pre-built templates.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ templates: PLAYBOOK_TEMPLATES });
  } catch (error) {
    console.error("Playbook default GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST: Generate or return default playbook.
 * Body: { campaignId?: string, templateId?: string }
 * - If templateId: return that template's guidelines (one-click).
 * - Else: try to generate from productSummary + ICP via AI.
 * - Fallback: return "SaaS cold outreach" template.
 * If campaignId provided, save playbook to campaign.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { campaignId, templateId } = body as { campaignId?: string; templateId?: string };

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        anthropicKey: true,
        anthropicModel: true,
        productSummary: true,
        icp: true,
        proofPointsJson: true,
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // 1. Template selected — return immediately
    if (templateId && typeof templateId === "string") {
      const template = getTemplateById(templateId);
      if (template) {
        const playbook = { guidelines: template.guidelines };
        if (campaignId && workspace.id) {
          await prisma.campaign.updateMany({
            where: { id: campaignId, workspaceId: workspace.id },
            data: { playbookJson: JSON.stringify(playbook) },
          });
        }
        return NextResponse.json({ playbook, source: "template" });
      }
    }

    // 2. Try AI generation from productSummary + ICP
    if (workspace.productSummary?.trim() && workspace.icp?.trim() && workspace.anthropicKey) {
      try {
        const anthropicKey = decrypt(workspace.anthropicKey);
        const model = workspace.anthropicModel ?? undefined;
        const numSteps = 5;
        const delays = [1, 3, 5, 7, 10];

        let proofBlock = "";
        if (workspace.proofPointsJson) {
          try {
            const arr = JSON.parse(workspace.proofPointsJson) as Array<{ title?: string; text: string }>;
            if (Array.isArray(arr) && arr.length > 0) {
              proofBlock = "\nProof points:\n" + arr.map((p) => (p.title ? `- ${p.title}: ${p.text}` : `- ${p.text}`)).join("\n");
            }
          } catch {
            //
          }
        }

        let strategyBlock = "";
        try {
          const memory = await getAggregatedMemory(workspace.id);
          const personaParts = Object.entries(memory.byPersona)
            .map(([k, v]) => `${k}: open ${v.open_rate_pct_avg ?? "?"}%, positive ${v.positive_reply_count ?? 0}`)
            .join("; ");
          const verticalParts = Object.entries(memory.byVertical)
            .map(([k, v]) => `${k}: open ${v.open_rate_pct_avg ?? "?"}%, positive ${v.positive_reply_count ?? 0}`)
            .join("; ");
          if (personaParts || verticalParts) {
            strategyBlock = "\n\nPerformance: " + (personaParts || "none") + ". Verticals: " + (verticalParts || "none");
          }
        } catch {
          //
        }

        const prompt = `You are an expert outbound sales copywriter. Create a PLAYBOOK (guidelines) for cold outreach — NOT pre-written email templates.

Product summary:
${workspace.productSummary}

Ideal Customer Profile (ICP):
${workspace.icp}
${proofBlock}${strategyBlock}

Respond with ONLY a valid JSON object:
{
  "guidelines": {
    "tone": "e.g. direct, consultative, friendly",
    "structure": "Describe each step's purpose. Step 1: Hook. Step 2: Value. Step 3: CTA. Step 4: Break pattern. Step 5: Last touch.",
    "numSteps": ${numSteps},
    "stepDelays": [${delays.join(", ")}]
  }
}`;

        const { text: rawText } = await callAnthropic(anthropicKey, prompt, { maxTokens: 1000, model });
        let jsonStr = rawText.trim();
        const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) jsonStr = codeBlock[1].trim();

        const playbookObj = JSON.parse(jsonStr) as { guidelines?: { tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] } };
        if (playbookObj?.guidelines) {
          const g = playbookObj.guidelines;
          const stepDelays = Array.isArray(g.stepDelays) && g.stepDelays.length >= numSteps ? g.stepDelays.slice(0, numSteps) : delays;
          const playbook = {
            guidelines: {
              tone: g.tone ?? "direct, consultative",
              structure: g.structure ?? "",
              numSteps,
              stepDelays,
            },
          };
          if (campaignId) {
            await prisma.campaign.updateMany({
              where: { id: campaignId, workspaceId: workspace.id },
              data: { playbookJson: JSON.stringify(playbook), icp: workspace.icp },
            });
          }
          return NextResponse.json({ playbook, source: "generated" });
        }
      } catch (err) {
        console.warn("Default playbook AI generation failed, using template:", err);
      }
    }

    // 3. Fallback: SaaS cold outreach template
    const template = getTemplateById("saas-cold") ?? PLAYBOOK_TEMPLATES[0];
    const playbook = { guidelines: template.guidelines };
    if (campaignId) {
      await prisma.campaign.updateMany({
        where: { id: campaignId, workspaceId: workspace.id },
        data: { playbookJson: JSON.stringify(playbook) },
      });
    }
    return NextResponse.json({ playbook, source: "template" });
  } catch (error: unknown) {
    console.error("Playbook default POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
