import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STRICT_GATEWAYS = new Set(["Microsoft", "Proofpoint", "Mimecast", "Barracuda"]);

/**
 * Volume preview for the Incentives Lab: how many leads in a batch would survive each recipient-provider
 * filter. Pure DB groupBy on the already-classified emailProvider — no MX lookups, so it's instant. Lets
 * the operator see the deliverability/volume tradeoff before launching.
 *
 * Two pools, selected by ?recycle=:
 *  - default (fresh): never-sent, contactable leads — the standard send pool. Requires ?batchId=.
 *  - ?recycle=true: already-sent, never-replied, never-bounced leads past the workspace cooldown and
 *    under the re-touch cap — IDENTICAL filter to the recycle branch in /api/incentives/launch, so the
 *    count the operator sees is exactly what a recycle would target. batchId optional (omit = whole
 *    workspace, e.g. drain every prior lead; provide = scope to one prior campaign/batch).
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true, recycleCooldownDays: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const batchId = params.get("batchId");
  const recycle = params.get("recycle") === "true";
  // Fresh pool is always batch-scoped (matches the manual Send-with-offer flow). Recycle pool may span
  // the whole workspace, so batchId is optional there.
  if (!recycle && !batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

  if (batchId) {
    const batch = await prisma.leadBatch.findFirst({ where: { id: batchId, workspaceId: ws.id }, select: { id: true } });
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const cooldownDays = ws.recycleCooldownDays ?? 21;
  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
  const scope = batchId ? { leadBatchId: batchId } : { leadBatch: { workspaceId: ws.id } };
  const where = recycle
    ? { ...scope, sentAt: { lt: cutoff }, suppressed: false, repliedAt: null, bouncedAt: null, email: { not: "" }, recycleCount: { lt: 2 }, OR: [{ recycledAt: null }, { recycledAt: { lt: cutoff } }] }
    : { ...scope, sentAt: null, suppressed: false, repliedAt: null, email: { not: "" } };

  const rows = await prisma.lead.groupBy({
    by: ["emailProvider"],
    where,
    _count: true,
  });

  let total = 0, google = 0, noGateways = 0, unclassified = 0;
  for (const r of rows) {
    const n = r._count as number;
    total += n;
    const p = r.emailProvider;
    if (!p) { unclassified += n; continue; }
    if (p === "Google") google += n;
    if (!STRICT_GATEWAYS.has(p)) noGateways += n; // includes Google + Yahoo + others, excludes strict gateways
  }

  return NextResponse.json({ total, google, noGateways, unclassified, recycle, cooldownDays });
}
