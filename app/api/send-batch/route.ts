import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeEmail } from "@/lib/email-grader";
import { perPersonaStyleStats, styleScore, isIncentiveStyle } from "@/lib/persona-style";

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

// Various good styles (exclude specialist-proof — it converted ~0 across ~3k sends). Includes the
// founder-incentive combo (founder credential + money offer), which is what the fresh portion writes.
const GOOD_STYLES = ["outcome-hook", "curiosity-gap", "founder-incentive", "founder", "direct-incentive", "holiday-incentive", "lean-personal", "social-proof", "insight-hook", "pain-led", "direct-ask"];
// The styles we write FRESH per company, alternated so we A/B the captivating angles head-to-head:
// outcome-emoji (+gift), curiosity-gap (no gift, pure attention), and the founder-incentive combo.
const FRESH_STYLES = ["outcome-hook", "curiosity-gap", "founder-incentive"];
const ROUND_CAP = 12; // leads chosen+sent per loop round (paced by how fast we can write fresh founder)
// Recipient gateways that quarantine cold mail (mirrors the send route). Pre-filtered out for "no-gateways".
const STRICT_GATEWAYS = ["Microsoft", "Proofpoint", "Mimecast", "Barracuda"];
const ICP_PERSONAS = ["consumer-insights", "brand-social", "product-marketing", "growth-general"];
// Quality floor. Raised to 85: the grade measures CRAFT (length, personalization, human tone, no spam
// triggers), not conversion — even a 99 can flop on market fit — so we only let the best-crafted out
// and rely on the offer/targeting/timing levers to actually convert. Tunable via body.minGrade.
const DEFAULT_GRADE_FLOOR = 85;
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
    // Minimum share of the batch that must be INCENTIVE (money/gift) styles — the proven converter,
    // "sprinkled in" regardless of what else ranks. Default 50%.
    const incentiveShare = Math.min(1, Math.max(0, typeof body.incentiveShare === "number" ? body.incentiveShare : 0.5));
    const minGrade = Math.min(100, Math.max(0, typeof body.minGrade === "number" ? body.minGrade : DEFAULT_GRADE_FLOOR));
    // Ids the caller already tried this session — excluded so each loop round picks NEW leads.
    const excludeIds: string[] = Array.isArray(body.excludeIds) ? body.excludeIds.filter((s: unknown): s is string => typeof s === "string") : [];
    // Blend shares: ~40% fresh FOUNDER-INCENTIVE combo (founder credential + money offer, written fresh
    // per company), ~40% existing INCENTIVE (direct-incentive/holiday), ~20% other good styles.
    const founderShare = Math.min(1, Math.max(0, typeof body.founderShare === "number" ? body.founderShare : 0.4));

    const baseEnv = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
    const base = baseEnv && baseEnv.startsWith("http") ? baseEnv.replace(/\/$/, "") : "https://peter-engine-working-copy.vercel.app";

    // This round sends at most ROUND_CAP (or whatever's left). Founder generation paces the round.
    const roundTarget = Math.min(count, ROUND_CAP);
    const wantFounder = Math.round(roundTarget * founderShare);
    const wantIncentive = Math.round(roundTarget * incentiveShare);

    // 0) Write the founder portion FRESH (company-specific) for sendable eligible leads, this round.
    let generated = 0;
    if (wantFounder > 0) {
      const genStart = Date.now();
      let genCall = 0;
      while (generated < wantFounder && Date.now() - genStart < 70_000) {
        const freshStyle = FRESH_STYLES[genCall % FRESH_STYLES.length]; // alternate outcome-hook / founder-incentive
        genCall += 1;
        try {
          const g = await fetch(`${base}/api/leads/generate`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": cron },
            body: JSON.stringify({ workspaceId: ws.id, recycle: true, oldestFirst: true, style: freshStyle, cooldownDays: COOLDOWN_DAYS, providerFilter: provider, useFastModel: true, limit: Math.min(6, wantFounder - generated), ...(icpOnly ? { personas: ICP_PERSONAS } : {}) }),
          });
          const gd = await g.json().catch(() => ({}));
          const did = Number(gd.done) || 0;
          generated += did;
          if (did === 0) break; // no more leads to write founder for
        } catch { break; }
      }
    }

    // PRE-FILTER selection by the SAME provider rule the send uses, so we don't choose 200 then watch
    // 158 get filtered out at send time. no-gateways keeps Gmail + null/unknown + non-gateway providers.
    const providerWhere =
      provider === "google" ? { OR: [{ emailProvider: "Google" }, { emailProvider: null }] }
      : provider === "no-gateways" ? { NOT: { emailProvider: { in: STRICT_GATEWAYS } } }
      : {};

    // 1) candidate pool: eligible, target-style drafted, sendable provider, (ICP). Over-pull for grading slack.
    const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await prisma.lead.findMany({
      where: {
        leadBatch: { workspaceId: ws.id },
        sentAt: { lt: cutoff }, suppressed: false, repliedAt: null, bouncedAt: null,
        recycleCount: { lt: 2 }, OR: [{ recycledAt: null }, { recycledAt: { lt: cutoff } }],
        stepsJson: { not: null }, emailStyle: { in: GOOD_STYLES },
        ...(icpOnly ? { persona: { in: ICP_PERSONAS } } : {}),
        ...providerWhere,
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      select: { id: true, company: true, persona: true, emailStyle: true, step1Subject: true, step1Body: true },
      orderBy: { createdAt: "asc" }, // oldest-waiting first
      take: roundTarget * 12, // enough across all style buckets to fill the blend after grading
    });

    // 2) grade-filter: keep only the best-crafted (default >=85).
    const graded = candidates
      .map((l) => ({ l, score: gradeEmail({ subject: l.step1Subject ?? "", body: l.step1Body ?? "" }, { company: l.company }).score }))
      .filter((x) => x.score >= minGrade);

    // 3) rank by PER-PERSONA performance, then build the blend: founder + incentive + rest, to roundTarget.
    const stats = await perPersonaStyleStats(ws.id);
    const ranked = graded.sort((a, b) => styleScore(b.l.persona, b.l.emailStyle, stats) - styleScore(a.l.persona, a.l.emailStyle, stats));
    const founderB = ranked.filter((x) => FRESH_STYLES.includes(x.l.emailStyle ?? ""));                                       // fresh outcome-hook / founder combo
    const incentiveB = ranked.filter((x) => isIncentiveStyle(x.l.emailStyle) && !FRESH_STYLES.includes(x.l.emailStyle ?? "")); // existing direct-incentive/holiday
    const restB = ranked.filter((x) => !FRESH_STYLES.includes(x.l.emailStyle ?? "") && !isIncentiveStyle(x.l.emailStyle));     // other good styles
    const chosen = [
      ...founderB.slice(0, wantFounder),
      ...incentiveB.slice(0, wantIncentive),
      ...restB.slice(0, Math.max(0, roundTarget - wantFounder - wantIncentive)),
    ];
    // top up to roundTarget from any remaining ranked lead (any bucket) if a share ran short
    if (chosen.length < roundTarget) {
      const have = new Set(chosen.map((x) => x.l.id));
      for (const x of ranked) { if (chosen.length >= roundTarget) break; if (!have.has(x.l.id)) chosen.push(x); }
    }
    chosen.splice(roundTarget);

    const ids = chosen.map((x) => x.l.id);
    const styleMix: Record<string, number> = {};
    for (const x of chosen) styleMix[x.l.emailStyle ?? "?"] = (styleMix[x.l.emailStyle ?? "?"] ?? 0) + 1;

    if (ids.length === 0) {
      return NextResponse.json({ ok: true, candidates: candidates.length, gradedGood: 0, chosen: 0, sent: 0, generated, attemptedIds: [], message: "No more eligible leads this round (pool drained or all in cooldown)." });
    }

    // 3) send exactly those ids.
    let sent = 0, prepared = 0, eligible = 0, sendErr = "";
    try {
      const snd = await fetch(`${base}/api/incentives/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": cron },
        body: JSON.stringify({ workspaceId: ws.id, recycle: true, useGeneratedSteps: true, leadIds: ids, cooldownDays: COOLDOWN_DAYS, sendLimit: roundTarget, providerFilter: provider }),
      });
      const s = await snd.json().catch(() => ({}));
      sent = Number(s.totalUploaded ?? s.leads_uploaded ?? 0) || 0;
      prepared = Number(s.preparedLeads ?? 0) || 0;
      eligible = Number(s.eligibleLeads ?? 0) || 0;
      sendErr = s.error || "";
    } catch (e) { sendErr = e instanceof Error ? e.message : "send failed"; }

    const sendSideSkipped = ids.length - sent; // chosen but not shipped (unwarmed inbox / dupe / verify-fail)
    const belowGrade = candidates.length - graded.length;
    const incCount = chosen.filter((x) => isIncentiveStyle(x.l.emailStyle)).length;
    return NextResponse.json({
      ok: true,
      requested: count, candidates: candidates.length, gradedGood: graded.length, chosen: ids.length, minGrade, generated,
      sent, sendSideSkipped, belowGrade, eligible, prepared, provider, styleMix, incentiveCount: incCount,
      attemptedIds: ids, // so the loop excludes these next round
      poolMaybeMore: candidates.length >= count * 5, // candidate query hit its cap → likely more leads available
      message: `Sent ${sent}/${ids.length} chosen${sendSideSkipped > 0 ? ` (${sendSideSkipped} not on a warmed inbox / already in a campaign)` : ""}.${belowGrade > 0 ? ` ${belowGrade} skipped below quality ${minGrade}.` : ""}${sendErr ? ` Note: ${sendErr}` : ""}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 500 });
  }
}
