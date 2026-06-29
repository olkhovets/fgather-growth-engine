import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { computeVariantStats, loadLearnings, EXPERIMENT_DIMENSIONS, type ExperimentDimension, type VariantStats } from "@/lib/experiments";
import { runGenerator, TARGET_ACTIVE_PER_DIMENSION } from "@/lib/experiment-agents";
import { logActivity } from "@/lib/activity";
import { wilsonLower, wilsonUpper } from "@/lib/stats";

export const dynamic = "force-dynamic";

// Minimum attributed sends before a positive-reply verdict is even attempted. Raised from 40:
// at sub-1% positive rates, 40 sends carries essentially no information, so the old threshold let
// the loop "judge" pure noise. Below this we explicitly report "needs more data" instead.
const MIN_SENDS_FOR_VERDICT = 120;
// A variant that has had this many sends and has not provoked a SINGLE human reply of any kind
// (not even an objection) is failing on the subject/targeting dimension engagement measures — that
// signal is denser than positives, so it lets us prune duds earlier without waiting for a positive
// that may never come. Kept conservative so we never kill a variant that is merely unlucky on positives.
const ENGAGEMENT_KILL_SENDS = 400;

type Verdict = "winner" | "killed" | "keep";

/**
 * Confidence-aware verdict. positiveRate/baseline are PERCENTS (0-100) as computed by
 * computeVariantStats; we convert to fractions for the Wilson bounds.
 *  - WINNER: the variant's 95% lower bound on positive-reply rate clears the baseline, with >=2 real
 *    positives (so a single lucky reply can't promote it).
 *  - KILLED: its 95% upper bound is below the baseline (significantly worse), OR it has burned through
 *    ENGAGEMENT_KILL_SENDS with zero replies of any kind (dead on arrival).
 *  - KEEP: everything else, including "not enough data yet" — the honest default at low base rates.
 */
function judge(v: VariantStats, baselinePct: number): Verdict {
  const baseline = baselinePct / 100;
  // Engagement-based prune: denser signal than positives, available earlier.
  if (v.sends >= ENGAGEMENT_KILL_SENDS && v.anyReplies === 0) return "killed";
  if (v.sends < MIN_SENDS_FOR_VERDICT) return "keep";
  const posLB = wilsonLower(v.positives, v.sends);
  const posUB = wilsonUpper(v.positives, v.sends);
  if (v.positives >= 2 && posLB > baseline) return "winner";
  if (baseline > 0 && posUB < baseline) return "killed";
  return "keep";
}

async function runEvaluator(workspaceId: string, anthropicKey: string, model: string) {
  const { variants, baselinePositiveRate } = await computeVariantStats(workspaceId, "testing");

  const promoted: string[] = [];
  const killed: string[] = [];
  let needData = 0;
  const dimsTouched = new Set<ExperimentDimension>();

  // Load existing learnings to append winners
  const learnings = await loadLearnings(workspaceId);

  for (const v of variants) {
    const verdict = judge(v, baselinePositiveRate);
    if (verdict === "keep") {
      if (v.sends < MIN_SENDS_FOR_VERDICT) needData += 1;
      continue;
    }

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

  if (promoted.length > 0 || killed.length > 0) {
    await logActivity(workspaceId, "experiment",
      `Optimized experiments: promoted ${promoted.length}, killed ${killed.length}, refilled ${refill?.total ?? 0}`,
      { promoted, killed, refilled: refill?.total ?? 0, baselinePositiveRate });
  }

  return {
    baselinePositiveRate,
    evaluated: variants.length,
    promoted,
    killed,
    needData,
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
