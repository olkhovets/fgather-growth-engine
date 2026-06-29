import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { runResearchExperimentGenerator } from "@/lib/research-experiments";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Seed A/B experiments from proven external cold-email research (lib/cold-email-research.ts),
 * personalized to this workspace's product/ICP. Runs in the daily loop (GET, CRON_SECRET) and on
 * operator demand (POST). The variants then flow through the existing evaluate/promote machinery.
 */
async function run(workspaceId: string, anthropicKey: string, model: string) {
  const result = await runResearchExperimentGenerator(workspaceId, anthropicKey, model);
  if (result.created.length > 0) {
    await logActivity(workspaceId, "experiment",
      `Seeded ${result.created.length} research-backed experiment(s) from external best practices: ${result.created.map((c) => `${c.dimension}/${c.label}`).join(", ")}`,
      { created: result.created, generation: result.generation });
  }
  return result;
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, anthropicKey: true, anthropicModel: true },
    });
    if (!workspace?.anthropicKey) return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    const result = await run(workspace.id, decrypt(workspace.anthropicKey), workspace.anthropicModel ?? "claude-haiku-4-5");
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal server error" }, { status: 500 });
  }
}

/** Cron entrypoint: seed research experiments for every workspace with an Anthropic key. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspaces = await prisma.workspace.findMany({
    where: { anthropicKey: { not: null } },
    select: { id: true, anthropicKey: true, anthropicModel: true },
  });
  const results = [];
  for (const ws of workspaces) {
    if (!ws.anthropicKey) continue;
    try {
      const r = await run(ws.id, decrypt(ws.anthropicKey), ws.anthropicModel ?? "claude-haiku-4-5");
      results.push({ workspaceId: ws.id, ...r });
    } catch (err) {
      results.push({ workspaceId: ws.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ results, total: results.length });
}
