import { prisma } from "@/lib/prisma";
import { callAnthropic } from "@/lib/anthropic";
import { EXPERIMENT_DIMENSIONS, type ExperimentDimension, loadLearnings } from "@/lib/experiments";

// Keep at least this many active variants per dimension so there's always something to test.
export const TARGET_ACTIVE_PER_DIMENSION = 3;

const DIMENSION_BRIEF: Record<ExperimentDimension, string> = {
  subject: "subject line approaches (the 6-10 word line that decides whether the email is opened)",
  hook: "opening-line hooks (the first sentence that decides whether they keep reading)",
  cta: "calls-to-action / closings (how the email asks for the demo without being pushy)",
  incentive: "incentives or reasons-to-reply (what makes responding worth their time — a teardown, a benchmark, a sample, an insight)",
};

type ProposedVariant = { label: string; instruction: string; hypothesis: string };

async function proposeVariantsForDimension(
  anthropicKey: string,
  model: string,
  dimension: ExperimentDimension,
  count: number,
  context: { product: string; icp: string; proofPoints: string; learnings: string[]; existing: string[] }
): Promise<ProposedVariant[]> {
  const existingBlock = context.existing.length
    ? `\n\nAlready tried (do NOT repeat these — propose genuinely different angles):\n${context.existing.map((e) => `- ${e}`).join("\n")}`
    : "";
  const learningsBlock = context.learnings.length
    ? `\n\nProven to work before (build on these, don't contradict them):\n${context.learnings.map((l) => `- ${l}`).join("\n")}`
    : "";

  const prompt = `You are an expert cold-email strategist running a continuous A/B testing program. Propose ${count} NEW, distinct ${DIMENSION_BRIEF[dimension]} to test for this product.

PRODUCT:
${context.product}

IDEAL CUSTOMER:
${context.icp}

PROOF POINTS:
${context.proofPoints || "(none provided)"}${learningsBlock}${existingBlock}

Each proposal is a DIRECTIVE that will be injected into the email-writing prompt — written as an instruction to the email writer, not as a finished email. It must be specific and actionable.

Rules for the directives you write:
- No links in step 1
- No em dashes, no AI-tell words (delve, leverage, streamline, etc.)
- The end goal of every email is to book a demo
- Each variant must be meaningfully different from the others and from what's been tried

Respond with ONLY a JSON array, no markdown:
[ { "label": "3-5 word name", "instruction": "the directive to inject", "hypothesis": "why this might outperform, 1 sentence" } ]`;

  try {
    const { text } = await callAnthropic(anthropicKey, prompt, { maxTokens: 900, model });
    const jsonStr = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const arr = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((v): v is ProposedVariant =>
        typeof v === "object" && v !== null &&
        typeof (v as ProposedVariant).label === "string" &&
        typeof (v as ProposedVariant).instruction === "string"
      )
      .slice(0, count)
      .map((v) => ({
        label: v.label.trim().slice(0, 60),
        instruction: v.instruction.trim(),
        hypothesis: (v.hypothesis ?? "").toString().trim().slice(0, 300),
      }));
  } catch {
    return [];
  }
}

/**
 * Generate new experiment variants for a workspace. Tops up each targeted dimension
 * to TARGET_ACTIVE_PER_DIMENSION active variants (or generates `perDimension` if forced).
 */
export async function runGenerator(
  workspaceId: string,
  anthropicKey: string,
  model: string,
  opts: { dimensions?: ExperimentDimension[]; perDimension?: number } = {}
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

  const learnings = await loadLearnings(workspaceId);

  const allExperiments = await prisma.promptExperiment.findMany({
    where: { workspaceId },
    select: { dimension: true, status: true, label: true, instruction: true, generation: true },
  });
  const maxGen = allExperiments.reduce((m, e) => Math.max(m, e.generation), 0);
  const nextGen = maxGen + 1;

  const targetDims = opts.dimensions ?? [...EXPERIMENT_DIMENSIONS];
  const created: Array<{ dimension: string; label: string }> = [];

  for (const dim of targetDims) {
    const activeCount = allExperiments.filter((e) => e.dimension === dim && e.status === "testing").length;
    const need = opts.perDimension ?? Math.max(0, TARGET_ACTIVE_PER_DIMENSION - activeCount);
    if (need <= 0) continue;

    const existing = allExperiments.filter((e) => e.dimension === dim).map((e) => `${e.label}: ${e.instruction}`);
    const proposals = await proposeVariantsForDimension(anthropicKey, model, dim, need, {
      product, icp, proofPoints, learnings, existing,
    });

    for (const p of proposals) {
      await prisma.promptExperiment.create({
        data: {
          workspaceId,
          dimension: dim,
          label: p.label,
          instruction: p.instruction,
          hypothesis: p.hypothesis || null,
          status: "testing",
          generation: nextGen,
        },
      });
      created.push({ dimension: dim, label: p.label });
    }
  }

  return { created, total: created.length, generation: nextGen };
}
