import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_INCENTIVE_CONFIG, normalizeIncentiveConfig, type IncentiveConfig } from "@/lib/incentives";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({
    where: { userId: session.user.id },
    select: { incentiveConfigJson: true },
  });
  let config: IncentiveConfig = DEFAULT_INCENTIVE_CONFIG;
  if (ws?.incentiveConfigJson) {
    try { config = normalizeIncentiveConfig(JSON.parse(ws.incentiveConfigJson)); } catch { /* keep default */ }
  }
  return NextResponse.json({ config });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const config = normalizeIncentiveConfig(body.config ?? body);
  await prisma.workspace.update({ where: { id: ws.id }, data: { incentiveConfigJson: JSON.stringify(config) } });
  return NextResponse.json({ config });
}
