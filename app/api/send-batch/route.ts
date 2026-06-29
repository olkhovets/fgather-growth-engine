import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeEmail } from "@/lib/email-grader";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * "Send N good emails of various styles" — the clean one-shot. NO separate draft step (drafting 200
 * can't fit a serverless window, and the pool already holds ~10k good drafts). Instead:
 *   1. pick eligible right-fit ICP leads that already have a GOOD-style draft (anything but the
 *      proven-dead specialist-proof), various styles for variety,
 *   2. grade each (deterministic, free) and keep the ones that clear the bar — so they're actually GOOD,
 *   3. send EXACTLY those by id, so sent = a subset of the chosen batch with the skips spelled out.
 * Draft and send are now the SAME set: the counts make sense.
 */

// Various good styles (exclude specialist-proof — it converted ~0 across ~3k sends).
const GOOD_STYLES = ["direct-incentive", "holiday-incentive", "lean-personal", "social-proof", "insight-hook", "pain-led", "direct-ask"];
const ICP_PERSONAS = ["consumer-insights", "brand-social", "product-marketing", "growth-general"];
const GRADE_FLOOR = 65;       // keep only well-written drafts
const COOLDOWN_DAYS = 10;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cron = process.env.CRON_SECRET;
    if (!cron) return NextResponse.json({ error: "Server not configured (CRON_SECRET unset)." }, { status: 500 });

    // Auth: operator session (website button) OR CRON_SECRET + workspaceId (CLI).
    const viaCron = request.headers.get("x-cron-secret") === cron && typeof body.workspaceId === "string";
    let ws: { id: string } | null = null;
    if (viaCron) {
      ws = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true } });
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) return NextResponse.json({ error: "Please log in." }, { status: 401 });
      ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    }
    if (!ws) return NextResponse.json({ error: "No workspace." }, { status: 400 });
    const count = Math.min(1000, Math.max(1, Number(body.count) || 200));
    const provider: "all" | "google" | "no-gateways" =
      body.providerFilter === "all" || body.providerFilter === "google" ? body.providerFilter : "no-gateways";
    const icpOnly = body.icpOnly !== false; // default: right-fit personas only

    // 1) candidate pool: eligible, good-style drafted, (ICP). Over-pull so the grade filter has slack.
    const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await prisma.lead.findMany({
      where: {
        leadBatch: { workspaceId: ws.id },
        sentAt: { lt: cutoff }, suppressed: false, repliedAt: null, bouncedAt: null,
        recycleCount: { lt: 2 }, OR: [{ recycledAt: null }, { recycledAt: { lt: cutoff } }],
        stepsJson: { not: null }, emailStyle: { in: GOOD_STYLES },
        ...(icpOnly ? { persona: { in: ICP_PERSONAS } } : {}),
      },
      select: { id: true, company: true, emailStyle: true, step1Subject: true, step1Body: true },
      orderBy: { createdAt: "asc" }, // oldest-waiting first
      take: count * 3,
    });

    // 2) grade-filter: keep the genuinely good ones, preserve style variety.
    const good = candidates
      .map((l) => ({ l, g: gradeEmail({ subject: l.step1Subject ?? "", body: l.step1Body ?? "" }, { company: l.company }) }))
      .filter((x) => x.g.score >= GRADE_FLOOR)
      .slice(0, count);
    const ids = good.map((x) => x.l.id);
    const styleMix: Record<string, number> = {};
    for (const x of good) styleMix[x.l.emailStyle ?? "?"] = (styleMix[x.l.emailStyle ?? "?"] ?? 0) + 1;

    if (ids.length === 0) {
      return NextResponse.json({ ok: true, candidates: candidates.length, gradedGood: 0, sent: 0, message: "No eligible good-style drafts right now (cooldown or all sent)." });
    }

    // 3) send exactly those ids.
    const baseEnv = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
    const base = baseEnv && baseEnv.startsWith("http") ? baseEnv.replace(/\/$/, "") : "https://peter-engine-working-copy.vercel.app";
    let sent = 0, prepared = 0, eligible = 0, sendErr = "";
    try {
      const snd = await fetch(`${base}/api/incentives/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": cron },
        body: JSON.stringify({ workspaceId: ws.id, recycle: true, useGeneratedSteps: true, leadIds: ids, cooldownDays: COOLDOWN_DAYS, sendLimit: count, providerFilter: provider }),
      });
      const s = await snd.json().catch(() => ({}));
      sent = Number(s.totalUploaded ?? s.leads_uploaded ?? 0) || 0;
      prepared = Number(s.preparedLeads ?? 0) || 0;
      eligible = Number(s.eligibleLeads ?? 0) || 0;
      sendErr = s.error || "";
    } catch (e) { sendErr = e instanceof Error ? e.message : "send failed"; }

    const skipped = ids.length - sent;
    return NextResponse.json({
      ok: true,
      requested: count, candidates: candidates.length, gradedGood: ids.length,
      sent, skipped, eligible, prepared, provider, styleMix,
      message: `Chose ${ids.length} good emails (${Object.entries(styleMix).map(([s, n]) => `${n} ${s}`).join(", ")}). Sent ${sent}${skipped > 0 ? `, skipped ${skipped} (off-provider / not on a warmed inbox)` : ""}.${sendErr ? ` Note: ${sendErr}` : ""}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 500 });
  }
}
