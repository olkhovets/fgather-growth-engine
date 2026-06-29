import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One-press holiday campaign launcher for the /launch page. Operator logs in, presses the button,
 * and this DRAFTS a batch of right-fit ICP leads in the holiday-incentive style (money-forward,
 * holiday-aware, optimized subjects) and SHIPS the ready ones. Uses the operator SESSION for auth, so
 * no CRON_SECRET in anyone's .env — the button just works once you're logged in.
 *
 * One press = one batch (drafts a chunk that fits the serverless window, sends what's ready). Press
 * again to keep the campaign flowing. Each press is the operator's explicit send trigger.
 */
const DRAFT_PER_PRESS = 40;   // fits the 120s window with the subject engine + grader per lead
const SEND_PER_PRESS = 200;   // ship what's ready, paced across warmed inboxes
const ICP_PERSONAS = ["consumer-insights", "brand-social", "product-marketing", "growth-general"];
const STYLE = "holiday-incentive";
const COOLDOWN_DAYS = 10;     // the pool was sent Jun 16-22; 10d makes the ICP set eligible this week

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Please log in." }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!ws) return NextResponse.json({ error: "No workspace." }, { status: 400 });

    const cron = process.env.CRON_SECRET;
    if (!cron) return NextResponse.json({ error: "Server not configured for launches (CRON_SECRET unset)." }, { status: 500 });

    const baseEnv = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
    const base = baseEnv && baseEnv.startsWith("http") ? baseEnv.replace(/\/$/, "") : "https://peter-engine-working-copy.vercel.app";
    const headers = { "Content-Type": "application/json", "x-cron-secret": cron };

    // 1) DRAFT a chunk of right-fit ICP leads in the holiday style with optimized subjects.
    let drafted = 0, draftRemaining = 0;
    try {
      const gen = await fetch(`${base}/api/leads/generate`, {
        method: "POST", headers,
        body: JSON.stringify({
          workspaceId: ws.id, recycle: true, oldestFirst: true, optimizeSubject: true,
          cooldownDays: COOLDOWN_DAYS, style: STYLE, personas: ICP_PERSONAS,
          useFastModel: true, limit: DRAFT_PER_PRESS,
        }),
      });
      const g = await gen.json().catch(() => ({}));
      drafted = Number(g.done) || 0;
      draftRemaining = Math.max(0, (Number(g.total) || 0) - drafted);
    } catch { /* drafting best-effort; still try to send what's already drafted */ }

    // 2) SEND the ready holiday-incentive drafts.
    let sent = 0, sendMsg = "";
    try {
      const snd = await fetch(`${base}/api/incentives/launch`, {
        method: "POST", headers,
        body: JSON.stringify({
          workspaceId: ws.id, recycle: true, useGeneratedSteps: true,
          recycleStyle: STYLE, cooldownDays: COOLDOWN_DAYS, sendLimit: SEND_PER_PRESS,
        }),
      });
      const s = await snd.json().catch(() => ({}));
      sent = Number(s.totalUploaded ?? s.leads_uploaded ?? 0) || 0;
      sendMsg = s.error || "";
    } catch (e) { sendMsg = e instanceof Error ? e.message : "send failed"; }

    return NextResponse.json({
      ok: true,
      drafted, draftRemaining, sent,
      message: `Drafted ${drafted} new, sent ${sent}.${draftRemaining > 0 ? ` ${draftRemaining} more ready to draft — press again.` : ""}${sendMsg ? ` (${sendMsg})` : ""}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Launch failed" }, { status: 500 });
  }
}
