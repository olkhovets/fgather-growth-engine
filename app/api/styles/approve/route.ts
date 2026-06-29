import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setStyleStatus } from "@/lib/style-proposer";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Approve or reject a proposed email style. Approved styles enter the generation rotation; rejected
 * ones are killed. Dual auth (session or CRON_SECRET) so Peter can approve from the CLI.
 * Body: { id: string, action: "approve" | "reject" }.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const viaCron = !!secret && bearer === secret;

  let body: { id?: string; action?: string; workspaceId?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const { id, action } = body;
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: 'Body must be { id, action: "approve" | "reject" }' }, { status: 400 });
  }

  let workspaceId: string | null = null;
  if (viaCron) {
    const ws = body.workspaceId ? await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true } }) : await prisma.workspace.findFirst({ select: { id: true } });
    workspaceId = ws?.id ?? null;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    workspaceId = ws?.id ?? null;
  }
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const ok = await setStyleStatus(workspaceId, id, action === "approve" ? "approved" : "killed");
  if (!ok) return NextResponse.json({ error: "Style not found" }, { status: 404 });

  await logActivity(workspaceId, "experiment",
    `Email style ${action === "approve" ? "APPROVED (now in rotation)" : "rejected"}: ${id}`, { id, action });
  return NextResponse.json({ ok: true, id, status: action === "approve" ? "approved" : "killed" });
}
