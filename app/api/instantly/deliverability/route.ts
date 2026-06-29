import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";
import { computeDeliverability } from "@/lib/deliverability";
import { checkDomainsAuth } from "@/lib/domain-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * CONFIRM DELIVERABILITY — the linchpin behind a ~0.05% reply rate. Combines the two confirmable
 * signals into one verdict the CLI can read:
 *   1. Inbox PLACEMENT — Instantly warmup health_score (inbox vs spam) per sending inbox/domain.
 *   2. AUTHENTICATION — SPF / DKIM / DMARC DNS records per sending domain.
 * If placement is low or domains aren't authenticated, mail is foldering into spam and that — not the
 * copy — is why nobody replies. Dual auth (session / CRON_SECRET / SNAPSHOT_KEY) so `engine deliverability`
 * works with the same key as `status`. Read-only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const cron = process.env.CRON_SECRET;
  const snap = process.env.SNAPSHOT_KEY;
  const provided = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("key") || "";
  const viaKey = (!!cron && provided === cron) || (!!snap && provided === snap);

  let workspaceId: string | null = null;
  if (viaKey) {
    const wsId = url.searchParams.get("workspaceId");
    const ws = wsId ? await prisma.workspace.findUnique({ where: { id: wsId }, select: { id: true } }) : await prisma.workspace.findFirst({ select: { id: true } });
    workspaceId = ws?.id ?? null;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    workspaceId = ws?.id ?? null;
  }
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const ctx = await getInstantlyClientForWorkspaceId(workspaceId);
  if (!ctx) return NextResponse.json({ error: "Add your Instantly API key first.", canConfirm: false }, { status: 400 });

  const placement = await computeDeliverability(ctx.client);
  const auth = await checkDomainsAuth(placement.domains.map((d) => d.domain));
  const authByDomain = new Map(auth.map((a) => [a.domain, a]));

  // Merge placement + auth per domain.
  const domains = placement.domains.map((d) => ({
    domain: d.domain,
    placement: { verdict: d.verdict, avgHealth: d.avgHealth, worstHealth: d.worstHealth, active: d.active, problematic: d.problematic, reasons: d.reasons },
    auth: authByDomain.get(d.domain) ?? null,
  }));

  // One overall confirmation verdict.
  const placementBad = placement.summary.verdict === "unhealthy" || placement.summary.verdict === "critical";
  const placementUnknown = !placement.summary.hasHealthData || placement.summary.verdict === "unknown";
  const authBad = auth.some((a) => a.verdict === "unauthenticated") || auth.filter((a) => a.verdict === "weak").length > auth.length / 2;

  let confirmVerdict: "healthy" | "at-risk" | "broken" | "insufficient-data";
  const reasons: string[] = [];
  if (placement.summary.inboxes === 0) { confirmVerdict = "insufficient-data"; reasons.push("No sending inboxes found in Instantly."); }
  else if (placementBad || auth.some((a) => a.verdict === "unauthenticated")) {
    confirmVerdict = "broken";
    if (placementBad) reasons.push(`Inbox placement ${placement.summary.verdict} (avg health ${placement.summary.avgHealth ?? "?"}%) — likely spam-foldering.`);
    auth.filter((a) => a.verdict === "unauthenticated").forEach((a) => reasons.push(`${a.domain}: not authenticated (no SPF/DMARC).`));
  } else if (authBad || placementUnknown) {
    confirmVerdict = "at-risk";
    if (placementUnknown) reasons.push("No warmup placement data yet — can't fully confirm inbox vs spam.");
    auth.filter((a) => a.verdict !== "authenticated").forEach((a) => reasons.push(`${a.domain}: ${a.issues[0] ?? a.verdict}`));
  } else {
    confirmVerdict = "healthy";
    reasons.push(`${placement.summary.inboxes} inboxes, avg placement ${placement.summary.avgHealth ?? "?"}%, domains authenticated.`);
  }

  return NextResponse.json({
    confirmVerdict,
    reasons,
    placement: placement.summary,
    authSummary: {
      domains: auth.length,
      authenticated: auth.filter((a) => a.verdict === "authenticated").length,
      weak: auth.filter((a) => a.verdict === "weak").length,
      unauthenticated: auth.filter((a) => a.verdict === "unauthenticated").length,
    },
    domains,
    howToConfirmFurther: "For a gold-standard inbox-placement test, send to a GlockApps/Mailreach seed list. This endpoint confirms authentication (SPF/DKIM/DMARC) and warmup placement, which catch the large majority of spam-foldering causes.",
  });
}
