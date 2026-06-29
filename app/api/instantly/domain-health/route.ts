import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";
import { computeDeliverability } from "@/lib/deliverability";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Per-domain deliverability diagnostic. Pulls every sending inbox (warmup status, daily limit,
 * setup state) and its warmup health score (inbox-vs-spam placement), then groups by sending
 * domain so we can see WHICH domains are dragging deliverability down. This is the answer to
 * "14k sent, 0 replies" — a domain full of banned / spam-foldering inboxes never reaches a human.
 *
 * The actual computation lives in lib/deliverability.ts so the autonomous loop (snapshot +
 * incentives optimizer) reads the exact same placement truth this operator view shows.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) return NextResponse.json({ error: "Add your Instantly API key in Settings first." }, { status: 400 });

    const { summary, domains } = await computeDeliverability(ctx.client);
    return NextResponse.json({ summary, domains });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read domain health";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
