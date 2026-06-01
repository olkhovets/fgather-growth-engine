import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

type Step = { stepNumber: number; subject: string; body: string; delayDays: number };

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { message, conversationHistory = [], context } = body as {
      message: string;
      conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
      context?: { productSummary?: string; icp?: string; steps?: Step[]; guidelines?: { tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] } };
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    const anthropicKey = decrypt(workspace.anthropicKey);

    const productSummary = context?.productSummary ?? workspace.productSummary ?? "";
    const icp = context?.icp ?? workspace.icp ?? "";
    const steps = context?.steps ?? (workspace.playbookJson ? (JSON.parse(workspace.playbookJson) as { steps: Step[] })?.steps : []);
    const guidelines = context?.guidelines;

    const contextBlock = [
      productSummary && `Product summary:\n${productSummary}`,
      icp && `ICP (Ideal Customer Profile):\n${icp}`,
      guidelines
        ? `Current playbook (guidelines):\nTone: ${guidelines.tone}\nStructure: ${guidelines.structure}\nSteps: ${guidelines.numSteps} (delays: ${guidelines.stepDelays?.join(", ") ?? ""})`
        : steps?.length
          ? `Current playbook (${steps.length} steps):\n${steps.map((s) => `Step ${s.stepNumber} (delay ${s.delayDays}d)\nSubject: ${s.subject}\nBody: ${s.body}`).join("\n\n")}`
          : "No playbook yet.",
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");

    const systemPrompt = guidelines
      ? `You are a helpful assistant inside Outbound Growth Engine. The user is refining their outbound email playbook GUIDELINES (tone, structure, step delays). Not templates — each lead gets hyper-personalized emails written from these guidelines.

When the user asks for changes (e.g. "make step 2 more urgent", "add a break-up email", "shorten the sequence"), you must:
1. Reply in a friendly, concise way (1-3 sentences).
2. If they asked for edits, output the exact updated guidelines in a JSON block.

Output format: First your reply. Then, ONLY if making edits, add:
\`\`\`json
{
  "reply": "Your short reply",
  "edits": {
    "guidelines": {
      "tone": "...",
      "structure": "Step 1: ... Step 2: ... (describe what each step accomplishes)",
      "numSteps": 3,
      "stepDelays": [1, 3, 5]
    }
  }
}
\`\`\`
Include the full guidelines object. Keep "reply" brief.`
      : `You are a helpful assistant inside Outbound Growth Engine. The user is refining their outbound email playbook. You have access to their product summary, ICP, and current playbook steps.

When the user asks for changes (e.g. "make step 2 shorter", "tone down the subject line", "add more urgency", "change ICP to focus on SMB"), you must:
1. Reply in a friendly, concise way (1-3 sentences).
2. If they asked for edits, output the exact updated content in a JSON block so we can apply it.

Output format: First your reply in plain text. Then, ONLY if you are making edits, add a code block with this exact structure (use null for anything you're not changing):

\`\`\`json
{
  "reply": "Your short reply to the user here",
  "edits": {
    "icp": "new ICP text or null",
    "steps": [ { "stepNumber": 1, "subject": "...", "body": "...", "delayDays": 0 }, ... ] or null
  }
}
\`\`\`

If you're not making any edits, just reply in plain text with no JSON block. If you ARE making edits, include the full "steps" array with all steps (you can leave unchanged steps as-is). Keep "reply" brief.`;

    const conversationText = [
      ...conversationHistory.slice(-10).map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`),
      `User: ${message}`,
    ].join("\n\n");

    const userPrompt = `${systemPrompt}\n\n---\n\nCurrent context:\n\n${contextBlock}\n\n---\n\nConversation:\n\n${conversationText}\n\nAssistant:`;

    const { text: raw } = await callAnthropic(anthropicKey, userPrompt, { maxTokens: 2000 });

    let reply = raw.replace(/```(?:json)?\s*[\s\S]*?```/g, "").trim();
    let edits: { icp?: string | null; steps?: Step[] | null; guidelines?: { tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] } | null } | null = null;

    const jsonBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlock) {
      try {
        const parsed = JSON.parse(jsonBlock[1].trim()) as { reply?: string; edits?: { icp?: string | null; steps?: Step[] | null; guidelines?: { tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] } | null } };
        if (parsed.reply) reply = parsed.reply.trim();
        edits = parsed.edits ?? null;
      } catch {
        // keep reply as stripped text, no edits
      }
    }

    return NextResponse.json({ reply, edits });
  } catch (error: any) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
