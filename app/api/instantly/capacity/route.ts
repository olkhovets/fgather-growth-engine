import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForUserId } from "@/lib/instantly";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Real sending capacity: how many of the workspace's Instantly inboxes are warmed,
 * and the resulting emails/day ceiling. Grounds the autopilot daily limit in reality —
 * a daily limit above capacity just queues leads Instantly won't send today, and
 * pushing cold inboxes hard wrecks deliverability.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { inboxDailyLimit: true },
    });
    const perInbox = workspace?.inboxDailyLimit ?? 30;

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json({ error: "Add your Instantly API key in Settings first." }, { status: 400 });
    }

    const accounts = await ctx.client.listAccounts();
    const total = accounts.length;
    const warmed = accounts.filter((a) => a.warmup_status === 1).length;
    const unwarmed = total - warmed;
    // Warmed inboxes send up to perInbox/day; still-warming inboxes ramp slowly (~5/day).
    const capacityPerDay = warmed * perInbox + unwarmed * 5;

    return NextResponse.json({ total, warmed, unwarmed, perInbox, capacityPerDay });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read Instantly capacity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
