import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET: the values to paste into the ad-drafter extension to connect it to this
 * workspace — the ingest URL and the token (the workspace webhook secret). If no
 * secret exists yet, one is generated so the operator never has to hunt for it.
 * This is the same secret the Instantly reply webhook uses, so reusing it keeps
 * one secret per workspace.
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ws = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, webhookSecret: true },
    });
    if (!ws) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    let token = ws.webhookSecret;
    if (!token) {
      token = randomBytes(24).toString("hex");
      await prisma.workspace.update({ where: { id: ws.id }, data: { webhookSecret: token } });
    }
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      ingestUrl: `${origin}/api/linkedin/ingest-analytics`,
      token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load connection";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
