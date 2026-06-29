import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listStyles } from "@/lib/style-proposer";

export const dynamic = "force-dynamic";

/**
 * List the workspace's proposed + approved email styles, each with its self-test grade and live
 * positive-reply outcome. Dual auth (session or CRON_SECRET) so the CLI can read it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const viaCron = !!secret && bearer === secret;

  let workspaceId: string | null = null;
  if (viaCron) {
    const wsId = new URL(request.url).searchParams.get("workspaceId");
    const ws = wsId ? await prisma.workspace.findUnique({ where: { id: wsId }, select: { id: true } }) : await prisma.workspace.findFirst({ select: { id: true } });
    workspaceId = ws?.id ?? null;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    workspaceId = ws?.id ?? null;
  }
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const styles = await listStyles(workspaceId);
  return NextResponse.json({
    proposed: styles.filter((s) => s.status === "proposed"),
    approved: styles.filter((s) => s.status === "approved"),
  });
}
