import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { matchBrandProof } from "@/lib/brand-proof";
import { GOOD_STYLES, FRESH_STYLES, styleLabel, activeFreshStyleLabels, isSendableLength, bodyWordCount, MAX_SENDABLE_BODY_WORDS } from "@/lib/send-styles";
import { getDeliverabilityForWorkspace } from "@/lib/deliverability";

export const dynamic = "force-dynamic";

/**
 * Read-only "what's about to go out" view for the launch page. One digestible payload that answers
 * the four things an operator wants to SEE before sending, without digging through nested menus:
 *   1. which workspace/project they're in (name + sender + product one-liner)
 *   2. the SPREAD of the ready pool — by persona, by style, by gift amount
 *   3. real PREVIEWS of drafted step-1 emails, each with the matched similar-brand proof it will use
 *   4. their leads CLASSIFIED BY PERSONA (the whole pool, not just what's drafted)
 * Side-effect-free: never sends, never generates, never spends.
 */

type Bucket = { key: string; count: number };

function toBuckets(rows: Array<{ _count: number } & Record<string, unknown>>, field: string): Bucket[] {
  return rows
    .map((r) => ({ key: (r[field] as string | null) ?? "unclassified", count: r._count }))
    .sort((a, b) => b.count - a.count);
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, senderName: true, productSummary: true, user: { select: { email: true } } },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const wsId = workspace.id;

    // "Ready" = a contactable lead that already has a drafted sequence in a known-good style.
    // This is the pool that a send would actually draw from — the honest spread of what's about to go out.
    const readyWhere = {
      leadBatch: { workspaceId: wsId },
      suppressed: false,
      repliedAt: null,
      bouncedAt: null,
      email: { not: "" },
      stepsJson: { not: null },
      emailStyle: { in: GOOD_STYLES },
    };

    const [
      totalLeads,
      readyTotal,
      leadsByPersona,       // whole pool, "types of leads"
      readyByPersona,
      readyByStyle,
      readyByGift,
      previewRows,
      deliverability,
    ] = await Promise.all([
      prisma.lead.count({ where: { leadBatch: { workspaceId: wsId } } }),
      prisma.lead.count({ where: readyWhere }),
      prisma.lead.groupBy({ by: ["persona"], where: { leadBatch: { workspaceId: wsId } }, _count: true }),
      prisma.lead.groupBy({ by: ["persona"], where: readyWhere, _count: true }),
      prisma.lead.groupBy({ by: ["emailStyle"], where: readyWhere, _count: true }),
      prisma.lead.groupBy({ by: ["incentiveAmount"], where: readyWhere, _count: true }),
      prisma.lead.findMany({
        where: readyWhere,
        select: {
          name: true, company: true, industry: true, vertical: true, persona: true,
          emailStyle: true, incentiveAmount: true, incentiveGiftType: true,
          step1Subject: true, step1Body: true,
        },
        orderBy: { recycledAt: "asc" }, // the ones that would go out soonest
        take: 120, // sample: we filter to short (sendable-length) below, then show the first few
      }),
      getDeliverabilityForWorkspace(wsId).catch(() => null),
    ]);

    // Only preview drafts that are actually SHORT enough to send (a few tight lines), matching what the
    // send path now enforces — so the preview reflects reality, not the old long blocks in the pool.
    const shortRows = previewRows.filter((l) => isSendableLength(l.step1Body));
    const longInSample = previewRows.length - shortRows.length;

    // Each preview shows WHICH similar-brand proof it will lead with — makes the personalization visible.
    const previews = shortRows.slice(0, 8).map((l) => {
      const m = matchBrandProof({ company: l.company, industry: l.industry, vertical: l.vertical, persona: l.persona });
      return {
        name: l.name,
        company: l.company,
        persona: l.persona ?? "unclassified",
        style: styleLabel(l.emailStyle),
        gift: l.incentiveAmount ? `$${l.incentiveAmount} ${l.incentiveGiftType ?? "gift"}` : null,
        matchedBrand: m.primary.name,
        matchedFamily: m.family,
        words: bodyWordCount(l.step1Body),
        subject: l.step1Subject,
        body: l.step1Body,
      };
    });

    // Gift buckets → readable labels.
    const giftBuckets: Bucket[] = readyByGift
      .map((r) => ({ key: r.incentiveAmount ? `$${r.incentiveAmount}` : "no gift", count: r._count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      workspace: {
        name: workspace.senderName?.trim() || workspace.user?.email || "your workspace",
        email: workspace.user?.email ?? null,
        product: (workspace.productSummary ?? "").split(".")[0]?.trim() || null,
      },
      leads: {
        total: totalLeads,
        byPersona: toBuckets(leadsByPersona, "persona"),
      },
      ready: {
        total: readyTotal,
        byPersona: toBuckets(readyByPersona, "persona"),
        byStyle: toBuckets(readyByStyle, "emailStyle").map((b) => ({ key: styleLabel(b.key), count: b.count })),
        byGift: giftBuckets,
      },
      // What kind of emails the engine writes fresh right now — so the operator is always aware.
      activeStyles: activeFreshStyleLabels(),
      // Length health: how many recent drafts are too long to send (indigestible blocks). Long drafts are
      // filtered out of the send until they're shortened (recycle re-writes them tight, or the shorten tool).
      length: { maxSendableWords: MAX_SENDABLE_BODY_WORDS, longInSample, sampled: previewRows.length },
      // Inbox-placement chip: fold deliverability into the send view instead of a separate menu.
      deliverability: deliverability
        ? { verdict: deliverability.verdict, avgHealth: deliverability.avgHealth, hasHealthData: deliverability.hasHealthData }
        : null,
      previews,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "send-preview failed" }, { status: 500 });
  }
}
