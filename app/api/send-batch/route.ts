import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeEmail, judgeEmailContent } from "@/lib/email-grader";
import { perPersonaStyleStats, styleScore, isIncentiveStyle } from "@/lib/persona-style";
import { GOOD_STYLES, FRESH_STYLES, isSendableLength } from "@/lib/send-styles";
import { decrypt } from "@/lib/encryption";
import { scoreLeadFit } from "@/lib/lead-fit";
import { hasBannedDash } from "@/lib/email-validator";

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

// GOOD_STYLES (eligible-to-send filter) and FRESH_STYLES (written fresh each round) now live in
// lib/send-styles.ts — the single source of truth shared with the send-preview. Both are personable-
// first with the quirky/gimmick family retired (it booked ~0). Change the mix there, not here.
const ROUND_CAP = 12; // leads chosen+sent per loop round (paced by how fast we can write fresh founder)
// Recipient gateways that quarantine cold mail (mirrors the send route). Pre-filtered out for "no-gateways".
const STRICT_GATEWAYS = ["Microsoft", "Proofpoint", "Mimecast", "Barracuda"];
const ICP_PERSONAS = ["consumer-insights", "brand-social", "product-marketing", "growth-general"];
// Quality floor. Raised to 85: the grade measures CRAFT (length, personalization, human tone, no spam
// triggers), not conversion — even a 99 can flop on market fit — so we only let the best-crafted out
// and rely on the offer/targeting/timing levers to actually convert. Tunable via body.minGrade.
const DEFAULT_GRADE_FLOOR = 85;
const COOLDOWN_DAYS = 10;
// Quality JUDGE floors (LLM pass, the "is it actually good / not boring" gate the deterministic grader
// can't see). An email must clear BOTH before it ships: real personalization (a specific trigger, not
// just naming the company) and problem-first framing. Judged only on the final chosen set (cheap).
const JUDGE_HUMAN_FLOOR = 60;           // below this = reads AI/template, not a real person → do not send (top metric)
const JUDGE_PERSONALIZATION_FLOOR = 60; // below this = generic/shallow → do not send
const JUDGE_PROBLEM_FLOOR = 40;         // below this = solution-dump / no hook → do not send
const JUDGE_SUBJECT_FLOOR = 55;         // below this = boring/templated subject nobody opens → do not send
const JUDGE_CONCURRENCY = 6;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cron = process.env.CRON_SECRET;
    if (!cron) return NextResponse.json({ error: "Server not configured (CRON_SECRET unset)." }, { status: 500 });

    // Auth: operator session (website button) OR CRON_SECRET + workspaceId (CLI).
    const viaCron = request.headers.get("x-cron-secret") === cron && typeof body.workspaceId === "string";
    const wsSelect = { id: true, anthropicKey: true, anthropicModel: true, productSummary: true } as const;
    let ws: { id: string; anthropicKey: string | null; anthropicModel: string | null; productSummary: string | null } | null = null;
    if (viaCron) {
      ws = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: wsSelect });
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) return NextResponse.json({ error: "Please log in." }, { status: 401 });
      ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: wsSelect });
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
    // Source: "recycle" (re-touch already-sent leads, default) or "new" (pull fresh leads from Apollo
    // first, then send). New-leads needs Apollo credits; if none come in, we fall back to recycle.
    const source: "recycle" | "new" = body.source === "new" ? "new" : "recycle";
    // Deep per-lead web research on the freshly-written emails (slower + costlier, higher-signal). Off by default.
    const deepResearch = body.deepResearch === true;
    let newLeadsPulled = 0;
    // Blend shares: ~40% fresh FOUNDER-INCENTIVE combo (founder credential + money offer, written fresh
    // per company), ~40% existing INCENTIVE (direct-incentive/holiday), ~20% other good styles.
    const founderShare = Math.min(1, Math.max(0, typeof body.founderShare === "number" ? body.founderShare : 0.4));

    const baseEnv = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
    const base = baseEnv && baseEnv.startsWith("http") ? baseEnv.replace(/\/$/, "") : "https://peter-engine-working-copy.vercel.app";

    // "New leads" source: pull from Apollo first (best-effort). Needs credits; if none come in we still
    // proceed on the recycle pool so the run isn't wasted.
    if (source === "new") {
      try {
        const ing = await fetch(`${base}/api/apollo/ingest`, { method: "GET", headers: { Authorization: `Bearer ${cron}` } });
        const ij = await ing.json().catch(() => ({}));
        newLeadsPulled = Number(ij.inserted ?? ij.ingested ?? 0) || 0;
      } catch { /* best effort */ }
    }

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
        const freshStyle = FRESH_STYLES[genCall % FRESH_STYLES.length]; // rotate the personable, brand-matched styles
        genCall += 1;
        try {
          const g = await fetch(`${base}/api/leads/generate`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": cron },
            // useWebScraping: fetch each lead's site (best-effort, 4s cap) so step 1 opens on a REAL read of
            // THEIR company, not just persona/industry. Signal-based personalization is the top reply-rate
            // lever in the 2026 data; it fails gracefully to the persona pain when a site can't be read.
            // judgeQuality:false — the send gate below runs the SAME judge on the chosen set, so skip it here to avoid double-judging.
            // deepResearch — live web research per lead for a real personal hook (slower/costlier); forwarded from the caller's toggle.
            body: JSON.stringify({ workspaceId: ws.id, recycle: true, oldestFirst: true, style: freshStyle, cooldownDays: COOLDOWN_DAYS, providerFilter: provider, useFastModel: true, useWebScraping: true, judgeQuality: false, deepResearch, limit: Math.min(6, wantFounder - generated), ...(icpOnly ? { personas: ICP_PERSONAS } : {}) }),
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
      select: { id: true, company: true, persona: true, emailStyle: true, step1Subject: true, step1Body: true, jobTitle: true, industry: true, vertical: true },
      orderBy: { createdAt: "asc" }, // oldest-waiting first
      take: roundTarget * 12, // enough across all style buckets to fill the blend after grading
    });

    // 2) length + grade filter: drop indigestible-length drafts outright (a few tight lines only), then
    //    keep the best-crafted (default >=85). The length cap guarantees only short bodies ever send,
    //    regardless of grade — old long drafts in the pool are filtered until they're shortened.
    const graded = candidates
      .filter((l) => isSendableLength(l.step1Body))
      // HARD DISQUALIFIER: any em/en/other dash (AI-authorship tell) never sends — independent of grade.
      .filter((l) => !hasBannedDash(l.step1Subject) && !hasBannedDash(l.step1Body))
      .map((l) => ({ l, score: gradeEmail({ subject: l.step1Subject ?? "", body: l.step1Body ?? "" }, { company: l.company }).score, fit: scoreLeadFit(l) }))
      .filter((x) => x.score >= minGrade);

    // 2b) FIT gate — the best email still gets no reply from a wrong-fit lead. Gather's ICP is B2C
    //     marketing leaders at consumer brands; drop clear off-ICP leads (B2B/tech company or a
    //     non-marketing title). Missing data stays "maybe" (not dropped). body.fitGate=false disables.
    const fitGate = body.fitGate !== false;
    const fitEligible = fitGate ? graded.filter((x) => x.fit.tier !== "off") : graded;
    const offIcp = graded.length - fitEligible.length;

    // 3) rank by FIT tier first (core ICP ahead of maybe), then per-persona reply performance, then build the blend.
    const stats = await perPersonaStyleStats(ws.id);
    const fitRank = (t: string) => (t === "core" ? 2 : t === "maybe" ? 1 : 0);
    const ranked = fitEligible.sort((a, b) =>
      (fitRank(b.fit.tier) - fitRank(a.fit.tier)) ||
      (styleScore(b.l.persona, b.l.emailStyle, stats) - styleScore(a.l.persona, a.l.emailStyle, stats)));
    const founderB = ranked.filter((x) => FRESH_STYLES.includes(x.l.emailStyle ?? ""));                                       // fresh outcome-hook / founder combo
    const incentiveB = ranked.filter((x) => isIncentiveStyle(x.l.emailStyle) && !FRESH_STYLES.includes(x.l.emailStyle ?? "")); // existing direct-incentive/holiday
    const restB = ranked.filter((x) => !FRESH_STYLES.includes(x.l.emailStyle ?? "") && !isIncentiveStyle(x.l.emailStyle));     // other good styles
    let chosen = [
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

    // QUALITY JUDGE gate — the LLM "is it actually good, not a boring paragraph" pass the deterministic
    // grader can't see. An email ships only if it clears REAL personalization (a specific trigger, not
    // just naming the company) AND problem-first framing. Judged on the small chosen set only (cheap).
    // Fail-open if the judge is unavailable (length + deterministic 85 gates still applied). body.judgeQuality=false disables.
    let qualityRejected = 0;
    const rejectedIds: string[] = [];
    const judgeOn = body.judgeQuality !== false && Boolean(ws.anthropicKey) && chosen.length > 0;
    if (judgeOn) {
      const key = decrypt(ws.anthropicKey!);
      const jmodel = ws.anthropicModel ?? "claude-haiku-4-5";
      const product = ws.productSummary ?? null;
      const passed: typeof chosen = [];
      for (let i = 0; i < chosen.length; i += JUDGE_CONCURRENCY) {
        const slice = chosen.slice(i, i + JUDGE_CONCURRENCY);
        const verdicts = await Promise.all(slice.map((x) =>
          judgeEmailContent(key, { subject: x.l.step1Subject ?? "", body: x.l.step1Body ?? "" },
            { company: x.l.company, persona: x.l.persona, product }, jmodel).catch(() => null)
        ));
        slice.forEach((x, j) => {
          const v = verdicts[j];
          // fail-open on null (judge unreachable); fail-closed on a real low human/personalization/problem/subject score.
          const ok = !v || (v.humanScore >= JUDGE_HUMAN_FLOOR && v.personalizationScore >= JUDGE_PERSONALIZATION_FLOOR && v.problemFirstScore >= JUDGE_PROBLEM_FLOOR && v.subjectHookScore >= JUDGE_SUBJECT_FLOOR);
          if (ok) passed.push(x); else { qualityRejected += 1; rejectedIds.push(x.l.id); }
        });
      }
      chosen = passed;
    }

    const ids = chosen.map((x) => x.l.id);
    const styleMix: Record<string, number> = {};
    for (const x of chosen) styleMix[x.l.emailStyle ?? "?"] = (styleMix[x.l.emailStyle ?? "?"] ?? 0) + 1;

    if (ids.length === 0) {
      // If everything got judge-rejected, still exclude those ids next round so the loop advances and
      // generates fresh replacements instead of re-judging the same boring drafts.
      return NextResponse.json({ ok: true, candidates: candidates.length, gradedGood: graded.length, chosen: 0, sent: 0, generated, qualityRejected, attemptedIds: rejectedIds, message: qualityRejected > 0 ? `${qualityRejected} draft(s) failed the quality judge (too generic / not problem-first) — none good enough to send this round.` : "No more eligible leads this round (pool drained or all in cooldown)." });
    }

    // 3) send exactly those ids.
    let sent = 0, prepared = 0, eligible = 0, sendErr = "";
    try {
      const snd = await fetch(`${base}/api/incentives/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": cron },
        // Per-day campaign so re-contacting an already-sent lead isn't deduped away by the rolling one.
        body: JSON.stringify({ workspaceId: ws.id, recycle: true, useGeneratedSteps: true, leadIds: ids, cooldownDays: COOLDOWN_DAYS, sendLimit: roundTarget, providerFilter: provider, campaignName: `Quirky Test ${new Date().toISOString().slice(0, 10)}` }),
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
      requested: count, candidates: candidates.length, gradedGood: graded.length, chosen: ids.length, minGrade, generated, qualityRejected, offIcp,
      sent, sendSideSkipped, belowGrade, eligible, prepared, provider, styleMix, incentiveCount: incCount,
      source, newLeadsPulled,
      attemptedIds: [...ids, ...rejectedIds], // exclude sent AND judge-rejected next round so the loop advances
      poolMaybeMore: candidates.length >= count * 5, // candidate query hit its cap → likely more leads available
      message: `${source === "new" ? `Apollo: +${newLeadsPulled} new leads. ` : ""}Sent ${sent}/${ids.length} chosen${sendSideSkipped > 0 ? ` (${sendSideSkipped} not on a warmed inbox / already in a campaign)` : ""}.${belowGrade > 0 ? ` ${belowGrade} below craft ${minGrade}.` : ""}${offIcp > 0 ? ` ${offIcp} off-ICP (wrong-fit) skipped.` : ""}${qualityRejected > 0 ? ` ${qualityRejected} cut by the quality judge (too generic).` : ""}${sendErr ? ` Note: ${sendErr}` : ""}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 500 });
  }
}
