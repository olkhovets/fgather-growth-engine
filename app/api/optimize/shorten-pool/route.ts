import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { autoFixEmailContent } from "@/lib/email-validator";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Pool shortener — rewrites the EXISTING long drafts into short, punchy versions so they pass the
 * punchy quality bar and ship fast (instead of generating everything fresh, which is slow). Operates
 * on the lead's stepsJson in place (each step's body cut to ~55 words), keeping the company specifics,
 * the gift amount, and the CTA. Idempotent-ish: only touches steps whose body is over the limit.
 *
 * Capped per call (each rewrite is a Claude call); the caller loops until done. Session or CRON auth.
 */
const OVER_WORDS = 70;       // a step longer than this gets shortened
const TARGET_WORDS = 55;     // cut down to roughly this
const PER_CALL = 25;         // leads rewritten per call (fits the function window)

function wc(s: string): number { return (s || "").trim().split(/\s+/).filter(Boolean).length; }

async function run(workspaceId: string, anthropicKey: string, model: string) {
  // Find leads whose step1 body is long (proxy for a long sequence). Only good, sendable, not-yet-short.
  const candidates = await prisma.lead.findMany({
    where: {
      leadBatch: { workspaceId },
      stepsJson: { not: null },
      emailStyle: { notIn: ["specialist-proof"] },
    },
    select: { id: true, company: true, stepsJson: true, step1Subject: true },
    take: 400,
  });

  let rewritten = 0, scanned = 0;
  for (const lead of candidates) {
    if (rewritten >= PER_CALL) break;
    scanned += 1;
    let steps: Array<{ subject?: string; body?: string }>;
    try { steps = JSON.parse(lead.stepsJson || "[]"); } catch { continue; }
    if (!Array.isArray(steps) || steps.length === 0) continue;
    if (!steps.some((s) => wc(s.body ?? "") > OVER_WORDS)) continue; // already punchy

    let changed = false;
    for (const step of steps) {
      if (wc(step.body ?? "") <= OVER_WORDS) continue;
      try {
        const { text } = await callAnthropic(
          anthropicKey,
          `Cut this cold email to UNDER ${TARGET_WORDS} words. Short and punchy. Keep ONLY: the one-line hook about ${lead.company ?? "the company"}, the single proof/offer, and the one ask. Keep the greeting and any gift amount ($X) exactly. Delete every extra clause and explanation. Return only the rewritten body, no commentary:\n\n${step.body}`,
          { maxTokens: 200, model }
        );
        const cut = autoFixEmailContent((text || "").trim());
        if (cut && wc(cut) < wc(step.body ?? "")) { step.body = cut; changed = true; }
      } catch { /* keep original on failure */ }
    }
    if (changed) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { stepsJson: JSON.stringify(steps), step1Body: steps[0]?.body ?? lead.step1Subject ?? null },
      });
      rewritten += 1;
    }
  }

  // Estimate how many long drafts remain (cheap heuristic on step1Body length via a sampled count).
  const remaining = await prisma.lead.count({
    where: { leadBatch: { workspaceId }, stepsJson: { not: null }, emailStyle: { notIn: ["specialist-proof"] }, step1Body: { not: null } },
  });
  if (rewritten > 0) await logActivity(workspaceId, "info", `Shortened ${rewritten} long drafts to punchy.`, { rewritten, scanned });
  return { rewritten, scanned, remainingDraftsTotal: remaining };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const cron = process.env.CRON_SECRET;
  const viaCron = !!cron && request.headers.get("x-cron-secret") === cron && typeof body.workspaceId === "string";
  let ws: { id: string; anthropicKey: string | null; anthropicModel: string | null } | null = null;
  if (viaCron) ws = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true, anthropicKey: true, anthropicModel: true } });
  else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true, anthropicKey: true, anthropicModel: true } });
  }
  if (!ws?.anthropicKey) return NextResponse.json({ error: "No workspace / Anthropic key." }, { status: 400 });
  const result = await run(ws.id, decrypt(ws.anthropicKey), ws.anthropicModel ?? "claude-haiku-4-5");
  return NextResponse.json(result);
}
