import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ingestLinkedInAnalytics, type LinkedInAnalyticsPayload } from "@/lib/linkedin-analytics-ingest";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-webhook-secret",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * FEEDBACK PIPE endpoint — the ad-drafter dashboard's "Export to engine" button
 * POSTs LinkedIn analytics here.
 *
 * Auth (either):
 *   - an authenticated operator session, OR
 *   - a workspace secret (reuses Workspace.webhookSecret — no new column/migration):
 *     send it as `Authorization: Bearer <secret>`, `x-webhook-secret`, or `?secret=`.
 * The secret both authenticates AND identifies the workspace, so the browser
 * extension can post cross-origin without a login.
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const secret = bearer || request.headers.get("x-webhook-secret") || url.searchParams.get("secret") || "";

    let workspaceId: string | null = null;
    if (secret) {
      const ws = await prisma.workspace.findFirst({ where: { webhookSecret: secret }, select: { id: true } });
      if (ws) workspaceId = ws.id;
    }
    if (!workspaceId) {
      const session = await getServerSession(authOptions);
      if (session?.user?.id) {
        const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
        workspaceId = ws?.id ?? null;
      }
    }
    if (!workspaceId) {
      return NextResponse.json({ error: "Unauthorized — provide a valid workspace secret or sign in." }, { status: 401, headers: CORS });
    }

    const payload = (await request.json().catch(() => ({}))) as LinkedInAnalyticsPayload;
    if (!payload || !Array.isArray(payload.adSets)) {
      return NextResponse.json({ error: "Expected { adSets: [...] }." }, { status: 400, headers: CORS });
    }

    const result = await ingestLinkedInAnalytics(workspaceId, payload);
    return NextResponse.json({ ok: true, ...result }, { headers: CORS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}

/** GET confirms the endpoint is live (for a quick browser/extension health check). */
export async function GET() {
  return NextResponse.json({ ok: true, msg: "LinkedIn analytics ingest is live. POST { adSets, demographics, summary } with a workspace secret." }, { headers: CORS });
}
