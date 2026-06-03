import { prisma } from "@/lib/prisma";

export const EXPERIMENT_DIMENSIONS = ["subject", "hook", "cta", "incentive"] as const;
export type ExperimentDimension = (typeof EXPERIMENT_DIMENSIONS)[number];

export type ActiveExperiment = {
  id: string;
  dimension: string;
  label: string;
  instruction: string;
};

/** Load all currently-testing experiments for a workspace, grouped by dimension. */
export async function loadActiveExperiments(
  workspaceId: string
): Promise<Record<string, ActiveExperiment[]>> {
  const rows = await prisma.promptExperiment.findMany({
    where: { workspaceId, status: "testing" },
    select: { id: true, dimension: true, label: true, instruction: true },
    orderBy: { createdAt: "asc" },
  });
  const byDim: Record<string, ActiveExperiment[]> = {};
  for (const r of rows) {
    (byDim[r.dimension] ??= []).push(r);
  }
  return byDim;
}

/**
 * Pick one active variant per dimension for a given lead, balanced by round-robin
 * on the lead's position so each variant gets an even share of the batch.
 * Returns the chosen experiment ids and a prompt block describing the directives.
 */
export function assignExperiments(
  activeByDimension: Record<string, ActiveExperiment[]>,
  leadIndex: number
): { ids: string[]; block: string } {
  const ids: string[] = [];
  const lines: string[] = [];
  for (const dim of EXPERIMENT_DIMENSIONS) {
    const variants = activeByDimension[dim];
    if (!variants || variants.length === 0) continue;
    const chosen = variants[leadIndex % variants.length];
    ids.push(chosen.id);
    lines.push(`- ${dim.toUpperCase()} experiment "${chosen.label}": ${chosen.instruction}`);
  }
  if (lines.length === 0) return { ids: [], block: "" };
  return {
    ids,
    block:
      "\n\nACTIVE EXPERIMENTS (apply these directives — they are being tested for performance):\n" +
      lines.join("\n"),
  };
}

/** Load the workspace's proven learnings (promoted experiment winners). */
export async function loadLearnings(workspaceId: string): Promise<string[]> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { learningsJson: true },
  });
  if (!ws?.learningsJson) return [];
  try {
    const arr = JSON.parse(ws.learningsJson) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Build the prompt block that injects proven learnings into generation. */
export function learningsBlock(learnings: string[]): string {
  if (learnings.length === 0) return "";
  return (
    "\n\nPROVEN PATTERNS (these have measurably driven replies before — apply them):\n" +
    learnings.map((l) => `- ${l}`).join("\n")
  );
}

export type VariantStats = {
  id: string;
  dimension: string;
  label: string;
  instruction: string;
  hypothesis: string | null;
  generation: number;
  sends: number;
  positives: number;
  anyReplies: number;
  positiveRate: number; // 0-100, positives / sends
};

/**
 * Compute per-variant performance by attributing each lead's reply outcome to the
 * experiments that wrote it. Uses the per-lead replyStatus set by the reply webhook —
 * this is the real success signal, available per-lead (unlike Instantly's campaign-level opens).
 */
export async function computeVariantStats(
  workspaceId: string,
  status: "testing" | "winner" | "killed" = "testing"
): Promise<{ variants: VariantStats[]; baselinePositiveRate: number }> {
  const experiments = await prisma.promptExperiment.findMany({
    where: { workspaceId, status },
    select: { id: true, dimension: true, label: true, instruction: true, hypothesis: true, generation: true },
  });

  // Pull all sent leads in the workspace that carry an experiment tag
  const leads = await prisma.lead.findMany({
    where: {
      leadBatch: { workspaceId },
      sentAt: { not: null },
      experimentIdsJson: { not: null },
    },
    select: { experimentIdsJson: true, replyStatus: true },
  });

  // Workspace baseline positive-reply rate across all sent leads (with or without tags)
  const [totalSent, totalPositive] = await Promise.all([
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: { not: null } } }),
    prisma.lead.count({ where: { leadBatch: { workspaceId }, sentAt: { not: null }, replyStatus: "positive" } }),
  ]);
  const baselinePositiveRate = totalSent > 0 ? Math.round((totalPositive / totalSent) * 1000) / 10 : 0;

  const acc = new Map<string, { sends: number; positives: number; anyReplies: number }>();
  for (const e of experiments) acc.set(e.id, { sends: 0, positives: 0, anyReplies: 0 });

  for (const lead of leads) {
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(lead.experimentIdsJson!);
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      continue;
    }
    for (const id of ids) {
      const a = acc.get(id);
      if (!a) continue;
      a.sends += 1;
      if (lead.replyStatus) a.anyReplies += 1;
      if (lead.replyStatus === "positive") a.positives += 1;
    }
  }

  const variants: VariantStats[] = experiments.map((e) => {
    const a = acc.get(e.id) ?? { sends: 0, positives: 0, anyReplies: 0 };
    return {
      id: e.id,
      dimension: e.dimension,
      label: e.label,
      instruction: e.instruction,
      hypothesis: e.hypothesis,
      generation: e.generation,
      sends: a.sends,
      positives: a.positives,
      anyReplies: a.anyReplies,
      positiveRate: a.sends > 0 ? Math.round((a.positives / a.sends) * 1000) / 10 : 0,
    };
  });

  return { variants, baselinePositiveRate };
}
