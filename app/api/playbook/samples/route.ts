import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { parsePlaybook } from "@/lib/playbook";

export const dynamic = "force-dynamic";

export const maxDuration = 60;

/**
 * POST /api/playbook/samples
 * Body: { campaignId?: string, guidelines?: { tone, structure, numSteps, stepDelays } }
 * Generates sample email sequences for 2–3 different ICP personas.
 * Uses guidelines from body, or from campaign/workspace playbook.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { campaignId, guidelines: bodyGuidelines, customLead } = body as {
      campaignId?: string;
      guidelines?: { context?: string; tone?: string; structure?: string; numSteps?: number; stepDelays?: number[] };
      customLead?: { jobTitle?: string; companyUrl?: string };
    };

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        anthropicKey: true,
        anthropicModel: true,
        productSummary: true,
        icp: true,
        proofPointsJson: true,
        socialProofJson: true,
        playbookJson: true,
      },
    });

    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    let parsed: ReturnType<typeof parsePlaybook>;
    const bodyContext = bodyGuidelines?.context?.trim() || bodyGuidelines?.structure?.trim();
    if (bodyContext) {
      const numSteps = Math.min(10, Math.max(1, bodyGuidelines!.numSteps ?? 3));
      const stepDelays = Array.isArray(bodyGuidelines!.stepDelays) && bodyGuidelines!.stepDelays.length >= numSteps
        ? bodyGuidelines!.stepDelays.slice(0, numSteps)
        : [1, 3, 5, 7, 10].slice(0, numSteps);
      parsed = {
        numSteps,
        stepDelays,
        guidelines: {
          context: bodyGuidelines!.context ?? bodyGuidelines!.structure ?? "",
          tone: bodyGuidelines!.tone ?? "",
          structure: bodyGuidelines!.structure ?? "",
          numSteps,
          stepDelays,
        },
      };
    } else {
      let playbookSource = workspace.playbookJson;
      if (campaignId) {
        const campaign = await prisma.campaign.findFirst({
          where: { id: campaignId, workspaceId: workspace.id },
          select: { playbookJson: true, icp: true },
        });
        if (campaign?.playbookJson) playbookSource = campaign.playbookJson;
      }
      parsed = parsePlaybook(playbookSource);
    }
    if (!parsed) {
      const hasCustom = customLead && (customLead.jobTitle?.trim() || customLead.companyUrl?.trim());
      if (hasCustom) {
        parsed = { numSteps: 3, stepDelays: [1, 3, 5], guidelines: { tone: "direct, consultative", structure: "Step 1: Hook. Step 2: Value. Step 3: CTA.", numSteps: 3, stepDelays: [1, 3, 5] } };
      } else {
        return NextResponse.json(
          { error: "No playbook found. Define guidelines first, or add a job title and company to generate a sample." },
          { status: 400 }
        );
      }
    }

    const { numSteps, guidelines, legacySteps } = parsed;
    const productSummary = workspace.productSummary ?? "";
    const icp = workspace.icp ?? "";

    let proofPointsText = "";
    if (workspace.proofPointsJson) {
      try {
        const arr = JSON.parse(workspace.proofPointsJson) as Array<{ title?: string; text: string }>;
        if (Array.isArray(arr) && arr.length > 0) {
          proofPointsText = "\nProof points: " + arr.map((p) => (p.title ? `${p.title}: ${p.text}` : p.text)).join("; ");
        }
      } catch {
        //
      }
    }
    let socialProofText = "";
    if (workspace.socialProofJson) {
      try {
        const sp = JSON.parse(workspace.socialProofJson) as { similarCompanies?: string; referralPhrase?: string };
        const parts: string[] = [];
        if (sp.similarCompanies?.trim()) parts.push(`Similar companies: ${sp.similarCompanies.trim()}`);
        if (sp.referralPhrase?.trim()) parts.push(`Referral phrase: "${sp.referralPhrase.trim()}"`);
        if (parts.length > 0) socialProofText = "\nSocial proof (weave in): " + parts.join(". ");
      } catch {
        //
      }
    }

    const structureBlock = guidelines?.context
      ? `\nCampaign context & guidelines:\n${guidelines.context}`
      : guidelines?.structure
        ? `\nStructure: ${guidelines.structure}\nTone: ${guidelines.tone}`
        : legacySteps?.length
          ? `\nRough structure (adapt freely): ${legacySteps.map((s, i) => `Step ${i + 1}: ${(s.subject || "").slice(0, 60)}`).join(" | ")}`
          : "";

    const hasCustomLead = customLead && (customLead.jobTitle?.trim() || customLead.companyUrl?.trim());

    const prompt = hasCustomLead
      ? `You are an expert outbound sales copywriter. Generate ONE SAMPLE email sequence for a specific lead the user wants to preview.

Product summary:
${productSummary}

Overall ICP:
${icp}
${proofPointsText}${socialProofText}
${structureBlock}

THE USER WANTS TO SEE A SAMPLE FOR THIS LEAD:
- Job title: ${customLead.jobTitle?.trim() ?? "(infer from ICP)"}
- Company: ${customLead.companyUrl?.trim() ?? "(infer from ICP)"}

Infer a plausible name and any other details from the company/URL (e.g. from "acme.com" use "Acme" or "Acme Inc"). Write a COMPLETE, ready-to-send ${numSteps}-email sequence — not templates or placeholders. Make it feel hand-crafted for this specific person and company.

Respond with ONLY a valid JSON object:
{
  "samples": [
    {
      "persona": "${customLead.jobTitle?.trim() || "Custom lead"} at ${customLead.companyUrl?.trim() || "target company"}",
      "exampleLead": { "name": "...", "company": "...", "jobTitle": "${customLead.jobTitle?.trim() ?? ""}", "industry": "..." },
      "steps": [ { "subject": "...", "body": "..." }, ... ]
    }
  ]
}

The steps array must have exactly ${numSteps} items.`
      : `You are an expert outbound sales copywriter. Generate SAMPLE email sequences for 3 different ICP personas. These are examples of what hyper-personalized sequences would look like for different types of leads.

Product summary:
${productSummary}

Overall ICP:
${icp}
${proofPointsText}${socialProofText}
${structureBlock}

Create 3 sample sequences. Each sequence has ${numSteps} emails. For each persona, write COMPLETE, ready-to-send emails (subject + body) — not templates or placeholders. Use real names, companies, and specifics as if writing to a real person in that role.

Personas to use:
1. VP Sales at a mid-market SaaS company (e.g. Sarah Chen, Acme Analytics)
2. CTO at an enterprise (e.g. James Mitchell, GlobalCorp)
3. Head of Marketing at a B2B startup (e.g. Maya Patel, GrowthLabs)

Respond with ONLY a valid JSON object:
{
  "samples": [
    {
      "persona": "VP Sales at mid-market SaaS",
      "exampleLead": { "name": "Sarah Chen", "company": "Acme Analytics", "jobTitle": "VP Sales", "industry": "SaaS" },
      "steps": [ { "subject": "...", "body": "..." }, ... ]
    },
    {
      "persona": "CTO at enterprise",
      "exampleLead": { "name": "James Mitchell", "company": "GlobalCorp", "jobTitle": "CTO", "industry": "Enterprise" },
      "steps": [ { "subject": "...", "body": "..." }, ... ]
    },
    {
      "persona": "Head of Marketing at B2B startup",
      "exampleLead": { "name": "Maya Patel", "company": "GrowthLabs", "jobTitle": "Head of Marketing", "industry": "B2B" },
      "steps": [ { "subject": "...", "body": "..." }, ... ]
    }
  ]
}

Each steps array must have exactly ${numSteps} items. Write real, personalized content for each persona.`;

    const anthropicKey = decrypt(workspace.anthropicKey);
    const model = workspace.anthropicModel ?? undefined;
    const { text: raw } = await callAnthropic(anthropicKey, prompt, { maxTokens: 4000, model });

    let jsonStr = raw.trim();
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    const parsedResponse = JSON.parse(jsonStr) as {
      samples?: Array<{
        persona: string;
        exampleLead?: { name: string; company: string; jobTitle: string; industry?: string };
        steps: Array<{ subject: string; body: string }>;
      }>;
    };

    const samples = parsedResponse.samples ?? [];
    if (samples.length === 0) {
      return NextResponse.json({ error: "Failed to generate samples." }, { status: 500 });
    }

    return NextResponse.json({ samples });
  } catch (err) {
    console.error("Playbook samples error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate samples" },
      { status: 500 }
    );
  }
}
