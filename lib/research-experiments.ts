import { prisma } from "@/lib/prisma";
import { callAnthropic } from "@/lib/anthropic";
import { COLD_EMAIL_RESEARCH, type ResearchRule } from "@/lib/cold-email-research";
import type { ExperimentDimension } from "@/lib/experiments";

/**
 * Research-experiment generator. Turns proven, sourced cold-email tactics (lib/cold-email-research.ts —
 * the "pulled from the web" knowledge base) into PromptExperiment variants PERSONALIZED to this
 * workspace's product, ICP and proof — then drops them into the exact same A/B loop the engine
 * already runs. So external best practice becomes a testable directive → gets A/B'd against our own
 * winners → if it beats baseline, the evaluator folds it into permanent learnings. Self-improving
 * from the outside in, not just from our own replies.
 *
 * Tagged with a label prefix so we keep at most ~1 active research variant per dimension (the rest of
 * the slots stay open for the engine's own brainstormed variants) and never duplicate a tactic.
 */

export const RESEARCH_LABEL_PREFIX = "📊 ";
const TARGET_RESEARCH_ACTIVE_PER_DIMENSION = 1;

// Map our A/B dimensions to the research rules that inform them.
const DIMENSION_RULES: Record<ExperimentDimension, string[]> = {
  subject: ["subject"],
  hook: ["opener", "personalization", "problemFirst"],
  cta: ["cta", "oneIdea"],
  incentive: ["cta"], // value-based offer is the research lever for "reason to reply"
};

function rulesFor(dim: ExperimentDimension): ResearchRule[] {
  const keys = DIMENSION_RULES[dim] ?? [];
  return COLD_EMAIL_RESEARCH.filter((r) => keys.includes(r.dimension));
}

type Proposed = { label: string; instruction: string; hypothesis: string };

async function personalizeRule(
  anthropicKey: string,
  model: string,
  dim: ExperimentDimension,
  rules: ResearchRule[],
  context: { product: string; icp: string; proofPoints: string; existingResearchLabels: string[] }
): Promise<Proposed | null> {
  const ruleBlock = rules.map((r) => `- RULE: ${r.rule}\n  EVIDENCE: ${r.evidence}\n  SOURCE: ${r.source}`).join("\n");
  const avoid = context.existingResearchLabels.length
    ? `\n\nAlready running these research tactics for this dimension (pick a DIFFERENT angle from the rules above):\n${context.existingResearchLabels.map((l) => `- ${l}`).join("\n")}`
    : "";

  const prompt = `You convert proven cold-email research into a single A/B test DIRECTIVE, personalized to one product.

DIMENSION TO TEST: ${dim}

RESEARCH (proven externally — turn ONE of these into a concrete directive tailored to the product below):
${ruleBlock}

PRODUCT:
${context.product || "(none provided)"}

IDEAL CUSTOMER:
${context.icp || "(none provided)"}

PROOF POINTS:
${context.proofPoints || "(none provided)"}${avoid}

Write the directive as an instruction to the email writer (NOT a finished email) that applies the research to THIS product/customer specifically. Keep our hard rules: no links in step 1, no em dashes, no AI-tell words, end goal is a booked demo, reply-first.

Respond with ONLY JSON, no markdown:
{ "label": "3-5 word name", "instruction": "the personalized directive", "hypothesis": "the research evidence + why it should lift replies here, 1-2 sentences" }`;

  try {
    const { text } = await callAnthropic(anthropicKey, prompt, { maxTokens: 500, model });
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof json.label !== "string" || typeof json.instruction !== "string") return null;
    return {
      label: RESEARCH_LABEL_PREFIX + json.label.trim().replace(/^📊\s*/, "").slice(0, 56),
      instruction: json.instruction.trim(),
      hypothesis: (json.hypothesis ?? "").toString().trim().slice(0, 400),
    };
  } catch {
    return null;
  }
}

/**
 * Top up each dimension to TARGET_RESEARCH_ACTIVE_PER_DIMENSION active research variants.
 * Conservative by design so research variants coexist with the engine's own brainstormed ones.
 */
export async function runResearchExperimentGenerator(
  workspaceId: string,
  anthropicKey: string,
  model: string,
  opts: { dimensions?: ExperimentDimension[] } = {}
): Promise<{ created: Array<{ dimension: string; label: string }>; total: number; generation: number }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { productSummary: true, icp: true, proofPointsJson: true },
  });
  const product = workspace?.productSummary ?? "";
  const icp = workspace?.icp ?? "";
  let proofPoints = "";
  try {
    if (workspace?.proofPointsJson) {
      const arr = JSON.parse(workspace.proofPointsJson) as Array<{ title?: string; text: string }>;
      proofPoints = arr.map((p) => (p.title ? `${p.title}: ${p.text}` : p.text)).join("; ");
    }
  } catch { /* ignore */ }

  const all = await prisma.promptExperiment.findMany({
    where: { workspaceId },
    select: { dimension: true, status: true, label: true, generation: true },
  });
  const nextGen = all.reduce((m, e) => Math.max(m, e.generation), 0) + 1;

  const targetDims = (opts.dimensions ?? (Object.keys(DIMENSION_RULES) as ExperimentDimension[]));
  const created: Array<{ dimension: string; label: string }> = [];

  for (const dim of targetDims) {
    const rules = rulesFor(dim);
    if (rules.length === 0) continue;
    const activeResearch = all.filter((e) => e.dimension === dim && e.status === "testing" && e.label.startsWith(RESEARCH_LABEL_PREFIX));
    if (activeResearch.length >= TARGET_RESEARCH_ACTIVE_PER_DIMENSION) continue;

    const existingResearchLabels = all
      .filter((e) => e.dimension === dim && e.label.startsWith(RESEARCH_LABEL_PREFIX))
      .map((e) => e.label.replace(RESEARCH_LABEL_PREFIX, ""));

    const proposal = await personalizeRule(anthropicKey, model, dim, rules, { product, icp, proofPoints, existingResearchLabels });
    if (!proposal) continue;

    await prisma.promptExperiment.create({
      data: {
        workspaceId,
        dimension: dim,
        label: proposal.label,
        instruction: proposal.instruction,
        hypothesis: proposal.hypothesis || null,
        status: "testing",
        generation: nextGen,
      },
    });
    created.push({ dimension: dim, label: proposal.label });
  }

  return { created, total: created.length, generation: nextGen };
}
