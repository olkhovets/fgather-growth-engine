import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { getAggregatedMemory } from "@/lib/performance-memory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { icp: true, proofPointsJson: true, playbookJson: true, playbookApproved: true },
    });

    if (!workspace) {
      return NextResponse.json({ icp: null, proofPoints: [], playbook: null, playbookApproved: false }, { status: 200 });
    }

    let playbook = null;
    if (workspace.playbookJson) {
      try {
        playbook = JSON.parse(workspace.playbookJson);
      } catch {
        playbook = null;
      }
    }

    let proofPoints: Array<{ title?: string; text: string }> = [];
    if (workspace.proofPointsJson) {
      try {
        const parsed = JSON.parse(workspace.proofPointsJson);
        if (Array.isArray(parsed)) proofPoints = parsed.filter((p: unknown) => p && typeof (p as any).text === "string");
      } catch {
        proofPoints = [];
      }
    }

    return NextResponse.json({
      icp: workspace.icp,
      proofPoints,
      playbook,
      playbookApproved: workspace.playbookApproved ?? false,
    });
  } catch (error) {
    console.error("Playbook GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Approve playbook
    if (body.approve === true) {
      await prisma.workspace.update({
        where: { userId: session.user.id },
        data: { playbookApproved: true },
      });
      return NextResponse.json({ message: "Playbook approved", playbookApproved: true });
    }

    // Save proof points only
    if (body.proofPoints && Array.isArray(body.proofPoints)) {
      const valid = body.proofPoints.every(
        (p: unknown) => p && typeof (p as { text?: string }).text === "string"
      );
      if (!valid) {
        return NextResponse.json({ error: "Each proof point must have a text field." }, { status: 400 });
      }
      const toStore = body.proofPoints.map((p: { title?: string; text: string }) => ({
        title: typeof p.title === "string" ? p.title : undefined,
        text: String(p.text),
      }));
      await prisma.workspace.update({
        where: { userId: session.user.id },
        data: { proofPointsJson: JSON.stringify(toStore), playbookApproved: false },
      });
      return NextResponse.json({ message: "Proof points saved", proofPoints: toStore });
    }

    // Save playbook: guidelines (new) or steps (legacy)
    if (body.playbook && typeof body.playbook === "object") {
      const pb = body.playbook as { guidelines?: { context?: string; tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] }; steps?: Array<{ stepNumber: number; subject: string; body: string; delayDays: number }> };

      if (pb.guidelines) {
        const g = pb.guidelines;
        const numSteps = Math.min(10, Math.max(1, g.numSteps ?? 3));
        const stepDelays = Array.isArray(g.stepDelays) && g.stepDelays.length >= numSteps
          ? g.stepDelays.slice(0, numSteps)
          : [1, 3, 5, 7, 10].slice(0, numSteps);
        const toStore = {
          guidelines: {
            context: typeof g.context === "string" ? g.context : undefined,
            tone: typeof g.tone === "string" ? g.tone : undefined,
            structure: typeof g.structure === "string" ? g.structure : undefined,
            numSteps,
            stepDelays,
          },
        };
        await prisma.workspace.update({
          where: { userId: session.user.id },
          data: { playbookJson: JSON.stringify(toStore), playbookApproved: false },
        });
        return NextResponse.json({ message: "Playbook updated", playbook: toStore });
      }

      if (Array.isArray(pb.steps)) {
        const steps = pb.steps as Array<{ stepNumber: number; subject: string; body: string; delayDays: number }>;
        const valid = steps.every(
          (s) => typeof s.stepNumber === "number" && typeof s.subject === "string" && typeof s.body === "string" && typeof s.delayDays === "number"
        );
        if (!valid) {
          return NextResponse.json({ error: "Invalid playbook steps format." }, { status: 400 });
        }
        await prisma.workspace.update({
          where: { userId: session.user.id },
          data: { playbookJson: JSON.stringify({ steps }), playbookApproved: false },
        });
        return NextResponse.json({ message: "Playbook updated", playbook: { steps } });
      }
    }

    // Generate playbook from ICP
    const { icp, numSteps: requestedSteps, proofPoints: bodyProofPoints } = body;
    if (!icp || typeof icp !== "string") {
      return NextResponse.json(
        { error: "ICP (Ideal Customer Profile) is required to generate playbook." },
        { status: 400 }
      );
    }
    const numSteps = [3, 4, 5].includes(Number(requestedSteps)) ? Number(requestedSteps) : 3;

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    if (!workspace?.productSummary) {
      return NextResponse.json(
        { error: "Product summary required. Please crawl your website first." },
        { status: 400 }
      );
    }

    if (!workspace.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    // Resolve proof points: from body or existing workspace
    let proofPointsForPrompt: Array<{ title?: string; text: string }> = [];
    if (Array.isArray(bodyProofPoints) && bodyProofPoints.length > 0) {
      proofPointsForPrompt = bodyProofPoints
        .filter((p: unknown) => p && typeof (p as { text?: string }).text === "string")
        .map((p: { title?: string; text: string }) => ({ title: typeof p.title === "string" ? p.title : undefined, text: String(p.text) }));
    } else if (workspace.proofPointsJson) {
      try {
        const parsed = JSON.parse(workspace.proofPointsJson);
        if (Array.isArray(parsed)) proofPointsForPrompt = parsed.filter((p: unknown) => p && typeof (p as { text?: string }).text === "string");
      } catch {
        proofPointsForPrompt = [];
      }
    }

    const anthropicKey = decrypt(workspace.anthropicKey);

    const delayDaysExamples: Record<number, number[]> = {
      3: [1, 3, 5],
      4: [1, 3, 5, 7],
      5: [1, 3, 5, 7, 10],
    };
    const delays = delayDaysExamples[numSteps];

    const proofBlock =
      proofPointsForPrompt.length > 0
        ? `\nProof points (use where relevant):\n${proofPointsForPrompt.map((p) => (p.title ? `- ${p.title}: ${p.text}` : `- ${p.text}`)).join("\n")}\n`
        : "";

    let strategyBlock = "";
    try {
      const memory = await getAggregatedMemory(workspace.id);
      const personaParts = Object.entries(memory.byPersona).map(([k, v]) => `${k}: open ${v.open_rate_pct_avg ?? "?"}%, positive ${v.positive_reply_count ?? 0}`).join("; ");
      const verticalParts = Object.entries(memory.byVertical).map(([k, v]) => `${k}: open ${v.open_rate_pct_avg ?? "?"}%, positive ${v.positive_reply_count ?? 0}`).join("; ");
      if (personaParts || verticalParts) {
        strategyBlock = "\n\nPerformance so far (prefer tone and structure that have worked): By persona: " + (personaParts || "none") + ". By vertical: " + (verticalParts || "none") + ".";
      }
    } catch {
      strategyBlock = "";
    }

    const prompt = `You are an expert outbound sales copywriter. Create a PLAYBOOK (guidelines) for cold outreach — NOT pre-written email templates. The playbook will be used to generate hyper-personalized emails for EACH lead based on who they are.

Product summary:
${workspace.productSummary}

Ideal Customer Profile (ICP):
${icp}
${proofBlock}${strategyBlock}

Respond with ONLY a valid JSON object:
{
  "guidelines": {
    "tone": "e.g. direct, consultative, friendly",
    "structure": "Describe each step's purpose. Example: 'Step 1: Hook with sharp question about their pain. Step 2: Elaborate on value and proof. Step 3: Soft CTA. Step 4: Break pattern / add urgency. Step 5: Last touch.'",
    "numSteps": ${numSteps},
    "stepDelays": [${delays.join(", ")}]
  }
}

Rules: tone = how to sound. structure = what each step should accomplish (NOT the actual email text). numSteps = ${numSteps}. stepDelays = days between emails: ${delays.join(", ")}.`;

    const { text: rawText } = await callAnthropic(anthropicKey, prompt, { maxTokens: 1000 });

    let jsonStr = rawText.trim();
    const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    let playbookObj: { guidelines?: { tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] } };
    try {
      playbookObj = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse generated playbook. Please try again." },
        { status: 500 }
      );
    }

    if (!playbookObj?.guidelines) {
      return NextResponse.json(
        { error: "Invalid playbook format from agent." },
        { status: 500 }
      );
    }

    const g = playbookObj.guidelines;
    const stepDelays = Array.isArray(g.stepDelays) && g.stepDelays.length >= numSteps ? g.stepDelays.slice(0, numSteps) : delays;
    const toStore = {
      guidelines: {
        tone: g.tone ?? "direct, consultative",
        structure: g.structure ?? "",
        numSteps,
        stepDelays,
      },
    };

    await prisma.workspace.update({
      where: { userId: session.user.id },
      data: {
        icp,
        ...(Array.isArray(bodyProofPoints) && bodyProofPoints.length > 0
          ? { proofPointsJson: JSON.stringify(proofPointsForPrompt) }
          : {}),
        playbookJson: JSON.stringify(toStore),
        playbookApproved: false,
      },
    });

    return NextResponse.json({
      message: "Playbook generated",
      playbook: toStore,
    });
  } catch (error: any) {
    console.error("Playbook POST error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
