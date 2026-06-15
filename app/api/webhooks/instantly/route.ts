import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordReplyObservation } from "@/lib/performance-memory";
import {
  classifyReply,
  applyReplyToLead,
  decryptKey,
} from "@/lib/reply-actions";

export const dynamic = "force-dynamic";

/**
 * Inbound webhook for Instantly reply events (near real-time reply handling).
 *
 * Configure in Instantly: Settings → Webhooks → add a webhook for the
 * "Reply received" event pointing at:
 *   https://<your-app>/api/webhooks/instantly?secret=<workspace.webhookSecret>
 *
 * On each reply we:
 *  1. Match the campaign (by Instantly campaign id) to a workspace
 *  2. Classify the reply with Claude (positive / objection / ooo / not_interested / other)
 *  3. Act on the lead: notify on positive, suppress on not_interested, re-queue on OOO
 *  4. Store the reply + a performance observation
 *
 * Instantly's payload shape varies by event version, so we read fields defensively.
 */
/**
 * GET: friendly confirmation so opening the webhook URL in a browser doesn't look
 * broken (the real work happens on POST). Instantly POSTs reply events here.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "Instantly reply webhook",
    message: "This endpoint is live and working. Paste this full URL (including the ?secret=...) into Instantly → Settings → Webhooks for the 'Reply received' event. Instantly will POST reply events here; nothing is meant to load in a browser.",
  });
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret") ?? request.headers.get("x-webhook-secret");

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Pull the fields we care about, tolerating different Instantly payload shapes
    const get = (...keys: string[]): string => {
      for (const k of keys) {
        const v = payload[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    };

    const eventType = get("event_type", "event", "type");
    const instantlyCampaignId = get("campaign_id", "campaignId", "campaign");
    const fromEmail = get("lead_email", "leadEmail", "email", "from_email", "from");
    const subject = get("reply_subject", "subject", "email_subject");
    const bodyRaw = get("reply_text", "reply_body", "body", "text", "email_body");
    const bodySnippet = bodyRaw.slice(0, 500);

    // DIAGNOSTIC: log every inbound webhook (keyed to the workspace that owns the secret)
    // so we can see exactly what Instantly sends and why a reply might be ignored.
    try {
      const wsBySecret = secret
        ? await prisma.workspace.findFirst({ where: { webhookSecret: secret }, select: { id: true } })
        : null;
      if (wsBySecret) {
        const { logActivity: logAct } = await import("@/lib/activity");
        await logAct(wsBySecret.id, "info",
          `Inbound Instantly webhook: event="${eventType || "?"}" campaign="${instantlyCampaignId || "?"}" from="${fromEmail || "?"}"`,
          { payloadKeys: Object.keys(payload), eventType, instantlyCampaignId, fromEmail, subject: subject.slice(0, 80) });
      }
    } catch { /* diagnostic only */ }

    // Instantly fires events for replies AND for lead status changes (e.g. out-of-office).
    // Accept reply events and OOO status events; ack/ignore everything else.
    const statusField = get("status", "lead_status", "new_status", "reply_type");
    const isOOO = /out.?of.?office|ooo/i.test(eventType) || /out.?of.?office|ooo/i.test(statusField);
    const isBounce = /bounce/i.test(eventType) || /bounce/i.test(statusField);
    if (eventType && !/reply/i.test(eventType) && !isOOO && !isBounce) {
      return NextResponse.json({ ok: true, ignored: eventType });
    }

    // No lead email usually means a validation/test ping Instantly sends when you add
    // the webhook. Ack with 200 so Instantly accepts the URL (a 400 marks it as failing).
    if (!fromEmail) {
      return NextResponse.json({ ok: true, ignored: "no lead email (validation or non-reply ping)" });
    }

    // Resolve the workspace. Prefer the campaign mapping so REPLY events only ever act on
    // campaigns we launched (Instantly fires reply webhooks for every campaign on the
    // account). Fall back to the secret's workspace for events that carry no campaign id —
    // OOO status-change events often don't include one.
    let workspaceId: string | null = null;
    let sentCampaignId: string | null = null;
    let campaignName: string | undefined = undefined;
    if (instantlyCampaignId) {
      const sent = await prisma.sentCampaign.findFirst({
        where: { instantlyCampaignId },
        select: { id: true, workspaceId: true, name: true },
      });
      if (sent) { workspaceId = sent.workspaceId; sentCampaignId = sent.id; campaignName = sent.name; }
    }
    if (!workspaceId && secret) {
      const wsBySecret = await prisma.workspace.findFirst({ where: { webhookSecret: secret }, select: { id: true } });
      if (wsBySecret) workspaceId = wsBySecret.id;
    }
    if (!workspaceId) {
      return NextResponse.json({ ok: true, ignored: "not a campaign we manage and no matching webhook secret" });
    }

    // Verify the secret matches the owning workspace (rejects forged posts)
    const wsSecretRow = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { webhookSecret: true },
    });
    if (wsSecretRow?.webhookSecret && wsSecretRow.webhookSecret !== secret) {
      return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
    }

    // Bounce events: suppress the lead immediately (never email a dead address again) and
    // stamp bouncedAt so the autopilot bounce-rate guardrail can see it. Terminal — return here.
    if (isBounce) {
      const r = await prisma.lead.updateMany({
        // Case-INSENSITIVE match: emails are stored trimmed-but-not-lowercased, so an exact
        // lowercase match silently misses any lead with uppercase letters → it never gets
        // suppressed and keeps getting emailed + skews the bounce guardrail. (Matches the reply path.)
        where: { leadBatch: { workspaceId }, email: { equals: fromEmail.trim(), mode: "insensitive" } },
        data: { suppressed: true, bouncedAt: new Date() },
      });
      const { logActivity: logAct } = await import("@/lib/activity");
      await logAct(workspaceId, "info", `Bounce: suppressed ${fromEmail} (${r.count} lead${r.count === 1 ? "" : "s"})`, { fromEmail, suppressed: r.count });
      return NextResponse.json({ ok: true, classification: "bounced", suppressed: r.count });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { anthropicKey: true, anthropicModel: true, notifyEmail: true, user: { select: { email: true } } },
    });

    const anthropicKey = decryptKey(workspace?.anthropicKey);
    const model = workspace?.anthropicModel ?? "claude-haiku-4-5";

    // OOO status events: mark ooo + parse the auto-reply body for the date they're back, so we
    // re-contact them when they return (not a blind +7 days). applyReplyToLead falls back to +7d
    // when no date is found. Reply events: classify with Claude (falls back to "other" if no key).
    let classification: Awaited<ReturnType<typeof classifyReply>>["classification"];
    let requeueDate: string | null;
    if (isOOO) {
      classification = "ooo";
      requeueDate = anthropicKey && bodySnippet.trim()
        ? (await classifyReply(anthropicKey, fromEmail, subject, bodySnippet, model)).requeueDate
        : null;
    } else if (anthropicKey) {
      ({ classification, requeueDate } = await classifyReply(anthropicKey, fromEmail, subject, bodySnippet, model));
    } else {
      classification = "other";
      requeueDate = null;
    }

    // Store the reply if we know which sent campaign it belongs to
    let replyId: string | null = null;
    if (sentCampaignId) {
      const reply = await prisma.campaignReply.create({
        data: {
          sentCampaignId,
          fromEmail: fromEmail.toLowerCase(),
          subject: subject || null,
          bodySnippet: bodySnippet || null,
          classification,
        },
      });
      replyId = reply.id;
    }

    // Act on the matching lead(s)
    const notifyEmail = workspace?.notifyEmail ?? workspace?.user?.email ?? null;
    const { matchedLeads } = await applyReplyToLead(workspaceId, fromEmail, classification, requeueDate, {
      campaignName,
      subject,
      bodySnippet,
      notifyEmail,
    });

    if (replyId) {
      await recordReplyObservation(workspaceId, replyId, fromEmail.toLowerCase(), classification).catch(() => {});
    }

    const { logActivity } = await import("@/lib/activity");
    await logActivity(workspaceId, "reply",
      `Reply from ${fromEmail} classified as ${classification}${matchedLeads > 0 ? "" : " (no matching lead)"}`,
      { classification, fromEmail, matchedLeads, requeueDate, campaign: campaignName });

    return NextResponse.json({
      ok: true,
      classification,
      requeueDate,
      matchedLeads,
      stored: Boolean(replyId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    console.error("[webhook/instantly]", message);
    // Return 200 so Instantly doesn't hammer retries on a transient bug;
    // log loudly for our own debugging instead.
    return NextResponse.json({ ok: false, error: message });
  }
}
