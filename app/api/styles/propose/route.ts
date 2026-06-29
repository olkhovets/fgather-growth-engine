import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { proposeStyles } from "@/lib/style-proposer";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Propose new candidate email styles (self-graded on sample emails). They land as status="proposed"
 * and are NEVER used to send until Peter approves them. Operator-triggered (POST) and loop-capable
 * (GET, CRON_SECRET) — the loop only tops up proposals when there are none pending, so it never piles
 * up un-reviewed candidates. Approval stays manual.
 */
const MAX_PENDING = 3; // don't generate more candidates while this many already await review

async function run(workspaceId: string, anthropicKey: string, model: string, force: boolean) {
  if (!force) {
    const pending = await prisma.promptExperiment.count({ where: { workspaceId, dimension: "style", status: "proposed" } });
    if (pending >= MAX_PENDING) return { proposed: [], total: 0, skipped: `${pending} proposals already awaiting review` };
  }
  const result = await proposeStyles(workspaceId, anthropicKey, model, 2);
  if (result.total > 0) {
    await logActivity(workspaceId, "experiment",
      `Proposed ${result.total} new email style(s) for review: ${result.proposed.map((p) => `${p.name} (grade ${p.sampleGrade ?? "?"})`).join(", ")}. Approve with: engine.sh styles approve <id>`,
      { proposed: result.proposed });
  }
  return result;
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true, anthropicKey: true, anthropicModel: true } });
    if (!ws?.anthropicKey) return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    const result = await run(ws.id, decrypt(ws.anthropicKey), ws.anthropicModel ?? "claude-haiku-4-5", true); // operator: always generate
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspaces = await prisma.workspace.findMany({ where: { anthropicKey: { not: null } }, select: { id: true, anthropicKey: true, anthropicModel: true } });
  const results = [];
  for (const ws of workspaces) {
    if (!ws.anthropicKey) continue;
    try {
      results.push({ workspaceId: ws.id, ...(await run(ws.id, decrypt(ws.anthropicKey), ws.anthropicModel ?? "claude-haiku-4-5", false)) });
    } catch (err) {
      results.push({ workspaceId: ws.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ results, total: results.length });
}
