import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STRICT_GATEWAYS = new Set(["Microsoft", "Proofpoint", "Mimecast", "Barracuda"]);

/**
 * Volume preview for the Incentives Lab: how many fresh, unsent leads in a batch would survive
 * each recipient-provider filter. Pure DB groupBy on the already-classified emailProvider — no MX
 * lookups, so it's instant. Lets the operator see the deliverability/volume tradeoff before launching.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const batchId = new URL(request.url).searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

  const batch = await prisma.leadBatch.findFirst({ where: { id: batchId, workspaceId: ws.id }, select: { id: true } });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const rows = await prisma.lead.groupBy({
    by: ["emailProvider"],
    where: { leadBatchId: batchId, sentAt: null, suppressed: false, repliedAt: null, email: { not: "" } },
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

  return NextResponse.json({ total, google, noGateways, unclassified });
}
