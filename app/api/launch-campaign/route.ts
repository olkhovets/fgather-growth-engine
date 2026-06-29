import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One-press holiday campaign launcher for the /launch page. Operator logs in, sets how many to draft
 * and send, presses the button, and this DRAFTS right-fit ICP leads in the holiday-incentive style
 * (money-forward, holiday-aware, optimized subjects) and SHIPS them. Uses the operator SESSION for
 * auth so no CRON_SECRET in anyone's .env.
 *
 * Drafting is capped at CHUNK_SIZE (10) per generate call, so we loop until the requested count is
 * drafted or a time budget is hit (then report what's left). Returns rich counts so the page can show
 * exactly what happened and why (e.g. provider filter limiting sends).
 */
const ICP_PERSONAS = ["consumer-insights", "brand-social", "product-marketing", "growth-general"];
const STYLE = "holiday-incentive";
const COOLDOWN_DAYS = 10;
const DRAFT_DEADLINE_MS = 85_000; // leave headroom under the 120s function limit

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Please log in." }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!ws) return NextResponse.json({ error: "No workspace." }, { status: 400 });

    const cron = process.env.CRON_SECRET;
    if (!cron) return NextResponse.json({ error: "Server not configured for launches (CRON_SECRET unset)." }, { status: 500 });

    const body = await request.json().catch(() => ({}));
    const wantDraft = Math.min(500, Math.max(0, Number(body.generate) ?? 20));
    const wantSend = Math.min(2000, Math.max(0, Number(body.send) ?? 200));
    // Default "no-gateways": ship to everyone except strict gateways (Proofpoint/Mimecast). Far broader
    // than the old "google"-only default that let just 1 of 10 through. Operator can pick "all".
    const providerFilter: "all" | "google" | "no-gateways" =
      body.providerFilter === "all" || body.providerFilter === "google" ? body.providerFilter : "no-gateways";

    const baseEnv = process.env.NEXTJS_URL || process.env.NEXTAUTH_URL;
    const base = baseEnv && baseEnv.startsWith("http") ? baseEnv.replace(/\/$/, "") : "https://peter-engine-working-copy.vercel.app";
    const headers = { "Content-Type": "application/json", "x-cron-secret": cron };

    // 1) DRAFT a loop of right-fit ICP leads in the holiday style with optimized subjects.
    const start = Date.now();
    let drafted = 0, draftRemaining = 0, draftCalls = 0;
    while (drafted < wantDraft && Date.now() - start < DRAFT_DEADLINE_MS) {
      try {
        const gen = await fetch(`${base}/api/leads/generate`, {
          method: "POST", headers,
          body: JSON.stringify({
            workspaceId: ws.id, recycle: true, oldestFirst: true, optimizeSubject: true,
            cooldownDays: COOLDOWN_DAYS, style: STYLE, personas: ICP_PERSONAS,
            useFastModel: true, limit: Math.min(10, wantDraft - drafted),
          }),
        });
        const g = await gen.json().catch(() => ({}));
        const did = Number(g.done) || 0;
        draftRemaining = Math.max(0, (Number(g.total) || 0) - did);
        drafted += did; draftCalls += 1;
        if (did === 0) break; // pool exhausted for this style/cooldown
      } catch { break; }
    }

    // 2) SEND the ready holiday-incentive drafts.
    let sent = 0, eligible = 0, prepared = 0, sendErr = "";
    if (wantSend > 0) {
      try {
        const snd = await fetch(`${base}/api/incentives/launch`, {
          method: "POST", headers,
          body: JSON.stringify({
            workspaceId: ws.id, recycle: true, useGeneratedSteps: true,
            recycleStyle: STYLE, cooldownDays: COOLDOWN_DAYS, sendLimit: wantSend,
            providerFilter,
          }),
        });
        const s = await snd.json().catch(() => ({}));
        sent = Number(s.totalUploaded ?? s.leads_uploaded ?? 0) || 0;
        eligible = Number(s.eligibleLeads ?? 0) || 0;
        prepared = Number(s.preparedLeads ?? 0) || 0;
        sendErr = s.error || "";
      } catch (e) { sendErr = e instanceof Error ? e.message : "send failed"; }
    }

    const parts = [`Drafted ${drafted} new`, `sent ${sent}`];
    if (draftRemaining > 0) parts.push(`${draftRemaining} more left to draft`);
    if (sendErr) parts.push(`note: ${sendErr}`);
    return NextResponse.json({
      ok: true, drafted, draftRemaining, draftCalls, sent, eligible, prepared, providerFilter,
      message: parts.join(" · "),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Launch failed" }, { status: 500 });
  }
}
