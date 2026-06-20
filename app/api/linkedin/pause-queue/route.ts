import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const REQ = "LINKEDIN_PAUSE_REQUEST: ";
const DONE = "LINKEDIN_PAUSE_DONE: ";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function workspaceFromSecret(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const secret = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("secret") || "";
  if (!secret) return null;
  const ws = await prisma.workspace.findFirst({ where: { webhookSecret: secret }, select: { id: true } });
  return ws?.id ?? null;
}

/** Extension polls this (with the workspace secret) for ad names the operator queued to pause. */
export async function GET(request: Request) {
  const workspaceId = await workspaceFromSecret(request);
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [reqs, dones] = await Promise.all([
    prisma.activityLog.findMany({ where: { workspaceId, type: "info", message: { startsWith: REQ }, createdAt: { gte: since } }, select: { message: true } }),
    prisma.activityLog.findMany({ where: { workspaceId, type: "info", message: { startsWith: DONE }, createdAt: { gte: since } }, select: { message: true } }),
  ]);
  const doneNames = new Set(dones.map((d) => d.message.slice(DONE.length)));
  const pending = Array.from(new Set(reqs.map((r) => r.message.slice(REQ.length)).filter((n) => !doneNames.has(n))));
  return NextResponse.json({ pending }, { headers: CORS });
}

/** Extension POSTs back the names it actually paused, to clear them from the queue. */
export async function POST(request: Request) {
  const workspaceId = await workspaceFromSecret(request);
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });

  const body = (await request.json().catch(() => ({}))) as { done?: string[] };
  const done = Array.isArray(body.done) ? body.done.filter((n) => typeof n === "string" && n.trim()) : [];
  for (const name of done) {
    await logActivity(workspaceId, "info", `LINKEDIN_PAUSE_DONE: ${name}`, { kind: "linkedin_pause_done", name });
  }
  return NextResponse.json({ ok: true, cleared: done.length }, { headers: CORS });
}
