import { prisma } from "@/lib/prisma";
import type { InstantlyClient } from "@/lib/instantly";
import crypto from "crypto";

/**
 * Reply/bounce/OOO webhooks, SCOPED to a single campaign. On a shared Instantly account an
 * account-level webhook would fire for everyone's campaigns, so every campaign we create
 * registers its own scoped webhooks pointing at our ?secret= handler. Shared by the Incentives
 * Lab and the main send pipeline so there's one code path.
 */
const EVENT_TYPES = ["reply_received", "email_bounced", "lead_out_of_office"] as const;

/** Ensure the workspace has a webhook secret and return the full scoped-webhook target URL. */
export async function getWorkspaceWebhookUrl(workspaceId: string, knownSecret?: string | null): Promise<string> {
  let secret = knownSecret ?? null;
  if (!secret) {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookSecret: true } });
    secret = ws?.webhookSecret ?? null;
  }
  if (!secret) {
    secret = crypto.randomBytes(24).toString("hex");
    await prisma.workspace.update({ where: { id: workspaceId }, data: { webhookSecret: secret } });
  }
  const baseUrl = (process.env.NEXTJS_URL || process.env.NEXTAUTH_URL || "https://peter-engine-working-copy.vercel.app").replace(/\/$/, "");
  return `${baseUrl}/api/webhooks/instantly?secret=${secret}`;
}

/**
 * Register reply + bounce + OOO webhooks scoped to one campaign. Idempotent (Instantly upserts on
 * campaign+event+url, verified live), best-effort (a failure never blocks the send). Returns how
 * many of the events registered successfully.
 */
export async function registerCampaignWebhooks(
  client: InstantlyClient,
  campaignId: string,
  webhookUrl: string,
  campaignName?: string
): Promise<number> {
  const results = await Promise.allSettled(
    EVENT_TYPES.map((ev) =>
      client.createWebhook({ targetUrl: webhookUrl, eventType: ev, campaignId, name: `Gather ${ev}${campaignName ? ` — ${campaignName}` : ""}` })
    )
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

/** Number of webhook events registered per campaign (for "registered N of expected" checks). */
export const WEBHOOK_EVENTS_PER_CAMPAIGN = EVENT_TYPES.length;
