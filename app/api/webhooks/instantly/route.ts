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
    // Only act on reply events; ack everything else so Instantly doesn't retry
    if (eventType && !/reply/i.test(eventType)) {
      return NextResponse.json({ ok: true, ignored: eventType });
    }

    const instantlyCampaignId = get("campaign_id", "campaignId", "campaign");
    const fromEmail = get("lead_email", "leadEmail", "email", "from_email", "from");
    const subject = get("reply_subject", "subject", "email_subject");
    const bodyRaw = get("reply_text", "reply_body", "body", "text", "email_body");
    const bodySnippet = bodyRaw.slice(0, 500);

    if (!fromEmail) {
      return NextResponse.json({ error: "No lead email in payload" }, { status: 400 });
    }

    // Resolve the workspace STRICTLY via the campaign mapping. Instantly fires this
    // webhook for every reply on the account, including campaigns created by other
    // tools or teammates. We only ever act on campaigns that were launched through
    // this engine (i.e. exist in our SentCampaign table). Everything else is ignored.
    if (!instantlyCampaignId) {
      return NextResponse.json({ ok: true, ignored: "no campaign id in payload" });
    }

    const sent = await prisma.sentCampaign.findFirst({
      where: { instantlyCampaignId },
      select: { id: true, workspaceId: true, name: true },
    });
    if (!sent) {
      // Not one of our campaigns — another campaign on the same Instantly account.
      return NextResponse.json({ ok: true, ignored: "campaign not managed by this app" });
    }

    const workspaceId = sent.workspaceId;
    const sentCampaignId: string | null = sent.id;
    const campaignName = sent.name;

    // Verify the secret matches the owning workspace (rejects forged posts)
    const wsSecretRow = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { webhookSecret: true },
    });
    if (wsSecretRow?.webhookSecret && wsSecretRow.webhookSecret !== secret) {
      return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { anthropicKey: true, anthropicModel: true, notifyEmail: true, user: { select: { email: true } } },
    });

    const anthropicKey = decryptKey(workspace?.anthropicKey);
    const model = workspace?.anthropicModel ?? "claude-haiku-4-5";

    // Classify (falls back to "other" if no key / error)
    const { classification, requeueDate } = anthropicKey
      ? await classifyReply(anthropicKey, fromEmail, subject, bodySnippet, model)
      : { classification: "other" as const, requeueDate: null };

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
