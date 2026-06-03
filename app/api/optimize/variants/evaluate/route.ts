import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { computeVariantStats, loadLearnings, EXPERIMENT_DIMENSIONS, type ExperimentDimension } from "@/lib/experiments";
import { runGenerator, TARGET_ACTIVE_PER_DIMENSION } from "@/lib/experiment-agents";

export const dynamic = "force-dynamic";

// A variant needs at least this many attributed sends before we judge it.
const MIN_SENDS_FOR_VERDICT = 40;

type Verdict = "winner" | "killed" | "keep";

function judge(positiveRate: number, positives: number, sends: number, baseline: number): Verdict {
  if (sends < MIN_SENDS_FOR_VERDICT) return "keep";
  // Winner: clearly beats baseline and has real positives
  if (positives >= 2 && positiveRate >= Math.max(baseline * 1.5, baseline + 1)) return "winner";
  // Loser: enough sends but no traction, or well below baseline
  if (positives === 0 && baseline >= 1) return "killed";
  if (baseline > 0 && positiveRate <= baseline * 0.4) return "killed";
  return "keep";
}

async function runEvaluator(workspaceId: string, anthropicKey: string, model: string) {
  const { variants, baselinePositiveRate } = await computeVariantStats(workspaceId, "testing");

  const promoted: string[] = [];
  const killed: string[] = [];
  const dimsTouched = new Set<ExperimentDimension>();

  // Load existing learnings to append winners
  const learnings = await loadLearnings(workspaceId);

  for (const v of variants) {
    const verdict = judge(v.positiveRate, v.positives, v.sends, baselinePositiveRate);
    if (verdict === "keep") continue;

    if (verdict === "winner") {
      await prisma.promptExperiment.update({ where: { id: v.id }, data: { status: "winner" } });
      // Fold the winning directive into permanent learnings (dedup)
      const learning = `${v.instruction} (proven: ${v.positiveRate}% positive-reply rate vs ${baselinePositiveRate}% baseline over ${v.sends} sends)`;
      if (!learnings.some((l) => l.startsWith(v.instruction.slice(0, 40)))) {
        learnings.push(learning);
      }
      promoted.push(`${v.dimension}/${v.label}`);
    } else {
      await prisma.promptExperiment.update({ where: { id: v.id }, data: { status: "killed" } });
      killed.push(`${v.dimension}/${v.label}`);
    }
    dimsTouched.add(v.dimension as ExperimentDimension);
  }

  // Persist updated learnings
  if (promoted.length > 0) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { learningsJson: JSON.stringify(learnings.slice(-50)) }, // cap to most recent 50
    });
  }

  // Refill any dimension that dropped below target active count
  let refill: Awaited<ReturnType<typeof runGenerator>> | null = null;
  if (dimsTouched.size > 0) {
    const active = await prisma.promptExperiment.groupBy({
      by: ["dimension"],
      where: { workspaceId, status: "testing" },
      _count: true,
    });
    const activeByDim = new Map<string, number>(active.map((a) => [a.dimension, a._count as number]));
    const needRefill = Array.from(dimsTouched).filter(
      (d) => (activeByDim.get(d) ?? 0) < TARGET_ACTIVE_PER_DIMENSION
    );
    if (needRefill.length > 0) {
      refill = await runGenerator(workspaceId, anthropicKey, model, { dimensions: needRefill });
    }
  }

  return {
    baselinePositiveRate,
    evaluated: variants.length,
    promoted,
    killed,
    refilled: refill?.total ?? 0,
  };
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, anthropicKey: true, anthropicModel: true },
    });
    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }
    const result = await runEvaluator(
      workspace.id,
      decrypt(workspace.anthropicKey),
      workspace.anthropicModel ?? "claude-haiku-4-5"
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Cron entrypoint: evaluate experiments for every workspace. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const workspaces = await prisma.workspace.findMany({
    where: { anthropicKey: { not: null } },
    select: { id: true, anthropicKey: true, anthropicModel: true },
  });
  const results = [];
  for (const ws of workspaces) {
    if (!ws.anthropicKey) continue;
    try {
      const r = await runEvaluator(ws.id, decrypt(ws.anthropicKey), ws.anthropicModel ?? "claude-haiku-4-5");
      results.push({ workspaceId: ws.id, ...r });
    } catch (err) {
      results.push({ workspaceId: ws.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ results, total: results.length });
}
