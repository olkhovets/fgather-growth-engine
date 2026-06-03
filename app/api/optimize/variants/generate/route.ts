import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { EXPERIMENT_DIMENSIONS, type ExperimentDimension } from "@/lib/experiments";
import { runGenerator } from "@/lib/experiment-agents";

export const dynamic = "force-dynamic";

/** POST: generate new experiment variants for the current workspace. */
export async function POST(request: Request) {
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
    const body = (await request.json().catch(() => ({}))) as { dimensions?: ExperimentDimension[]; perDimension?: number };
    const dims = Array.isArray(body.dimensions)
      ? body.dimensions.filter((d): d is ExperimentDimension => (EXPERIMENT_DIMENSIONS as readonly string[]).includes(d))
      : undefined;

    const result = await runGenerator(
      workspace.id,
      decrypt(workspace.anthropicKey),
      workspace.anthropicModel ?? "claude-haiku-4-5",
      { dimensions: dims, perDimension: body.perDimension }
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Cron entrypoint: top up active variants for every workspace. */
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
      const r = await runGenerator(ws.id, decrypt(ws.anthropicKey), ws.anthropicModel ?? "claude-haiku-4-5");
      results.push({ workspaceId: ws.id, ...r });
    } catch (err) {
      results.push({ workspaceId: ws.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ results, total: results.length });
}
