import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";

/**
 * POST { batchId }
 *
 * Reads all distinct persona values from classified leads in the batch.
 * Creates one Campaign per persona with an AI-suggested playbook tailored
 * to that persona. Returns the created campaign IDs.
 *
 * Use these campaign IDs when calling /api/leads/generate (pass campaignId)
 * so each persona gets its own messaging guidelines.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = (await request.json()) as { batchId?: string };
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        anthropicKey: true,
        anthropicModel: true,
        productSummary: true,
        icp: true,
        proofPointsJson: true,
        playbookJson: true,
        senderName: true,
      },
    });
    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Find distinct personas in the batch
    const leads = await prisma.lead.findMany({
      where: { leadBatchId: batchId, persona: { not: null } },
      select: { persona: true, vertical: true },
    });

    const personaGroups: Map<string, Set<string>> = new Map();
    for (const l of leads) {
      if (!l.persona) continue;
      if (!personaGroups.has(l.persona)) personaGroups.set(l.persona, new Set());
      if (l.vertical) personaGroups.get(l.persona)!.add(l.vertical);
    }

    if (personaGroups.size === 0) {
      return NextResponse.json(
        { error: "No classified leads found. Run classification first." },
        { status: 400 }
      );
    }

    const anthropicKey = decrypt(workspace.anthropicKey);
    const model = workspace.anthropicModel ?? "claude-haiku-4-5";
    const productSummary = workspace.productSummary ?? "";
    const icp = workspace.icp ?? "";

    const created: Array<{ campaignId: string; persona: string; leadCount: number }> = [];

    for (const [persona, verticals] of personaGroups) {
      const verticalList = Array.from(verticals).join(", ") || "various";
      const leadCount = leads.filter((l) => l.persona === persona).length;

      // Generate a persona-specific playbook via one Claude call
      const playbookPrompt = `You are an expert B2B sales strategist. Write a concise email campaign guideline for outreach targeting a specific persona.

PRODUCT:
${productSummary}

ICP:
${icp}

TARGET PERSONA: ${persona}
COMMON VERTICALS: ${verticalList}
LEAD COUNT IN BATCH: ${leadCount}

Write campaign guidelines that will help Claude write hyper-personalized cold emails for this specific persona. Include:
1. The primary pain point this persona cares about most
2. The value angle that resonates best with their role and goals
3. The tone that works (e.g. peer-to-peer, consultative, data-driven, casual)
4. 1-2 specific proof points or angles to emphasize for this persona
5. What to avoid (e.g. jargon, overly salesy language, generic claims)

Keep it under 200 words. This will be injected as context into every email written for ${persona} leads.
Return ONLY the guideline text — no JSON, no headers.`;

      let guidelinesContext = "";
      try {
        const { text } = await callAnthropic(anthropicKey, playbookPrompt, {
          maxTokens: 400,
          model,
        });
        guidelinesContext = text.trim();
      } catch {
        guidelinesContext = `Write personalized emails for ${persona} personas in the ${verticalList} space. Focus on their specific pain points and how the product solves them.`;
      }

      const playbookJson = JSON.stringify({
        guidelines: {
          context: guidelinesContext,
          numSteps: 3,
          stepDelays: [0, 3, 7],
        },
      });

      const campaign = await prisma.campaign.create({
        data: {
          workspaceId: workspace.id,
          name: `${persona} — Auto Segment`,
          status: "draft",
          playbookJson,
          icp: `${icp}\n\nFocus persona: ${persona}`,
          proofPointsJson: workspace.proofPointsJson ?? null,
          leadBatchId: batchId,
        },
      });

      created.push({ campaignId: campaign.id, persona, leadCount });
    }

    return NextResponse.json({
      created,
      total: created.length,
      message: `Created ${created.length} persona-specific campaigns. Pass each campaignId to /api/leads/generate to generate targeted sequences.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
