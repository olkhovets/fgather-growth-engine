import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Autopilot orchestrator. For each workspace with autopilot ON, runs the full
 * hands-off pipeline once:
 *   1. Pick the most recent campaign (for guidelines) + most recent live
 *      Instantly campaign (to append into).
 *   2. Generate sequences for up to `autopilotDailyLimit` fresh leads.
 *   3. Send (append) those generated leads into the existing Instantly campaign.
 *
 * Generation + sending reuse the real endpoints via internal calls authed with
 * CRON_SECRET, so autopilot does exactly what the manual flow does.
 *
 * Called by the daily analytics cron. Protected by CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured — autopilot disabled." }, { status: 400 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXTJS_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const workspaces = await prisma.workspace.findMany({
    where: { autopilot: true },
    select: { id: true, autopilotDailyLimit: true },
  });

  const results: Array<Record<string, unknown>> = [];

  for (const ws of workspaces) {
    const dailyLimit = ws.autopilotDailyLimit ?? 200;
    try {
      // Find a batch with leads that still need generating, and a destination campaign
      const batch = await prisma.lead.findFirst({
        where: {
          leadBatch: { workspaceId: ws.id },
          sentAt: null, suppressed: false, repliedAt: null,
          OR: [{ stepsJson: null }, { stepsJson: "" }, { stepsJson: "[]" }],
        },
        select: { leadBatchId: true },
        orderBy: { id: "asc" },
      });

      const campaign = await prisma.campaign.findFirst({
        where: { workspaceId: ws.id, playbookJson: { not: null } },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
      });
      const liveInstantly = await prisma.sentCampaign.findFirst({
        where: { workspaceId: ws.id },
        select: { instantlyCampaignId: true },
        orderBy: { createdAt: "desc" },
      });

      if (!batch?.leadBatchId) {
        results.push({ workspaceId: ws.id, skipped: "no leads need generating" });
        continue;
      }

      const cronHeaders = { "Content-Type": "application/json", "x-cron-secret": secret };

      // 1. Generate up to dailyLimit (10 per call)
      let generated = 0;
      while (generated < dailyLimit) {
        const res = await fetch(`${baseUrl}/api/leads/generate`, {
          method: "POST", headers: cronHeaders,
          body: JSON.stringify({
            batchId: batch.leadBatchId, useFastModel: true, workspaceId: ws.id,
            ...(campaign?.id ? { campaignId: campaign.id } : {}),
          }),
        });
        const d = await res.json().catch(() => ({}));
        const done = d.done ?? 0;
        generated += done;
        if (done === 0 || !res.ok) break;
      }

      // 2. Send (append into the live Instantly campaign, or create one)
      let sendResult: Record<string, unknown> = {};
      if (generated > 0) {
        const sendRes = await fetch(`${baseUrl}/api/instantly/send`, {
          method: "POST", headers: cronHeaders,
          body: JSON.stringify({
            batchId: batch.leadBatchId, workspaceId: ws.id, skipFailingLeads: true,
            sendLimit: dailyLimit,
            ...(campaign?.id ? { campaignId: campaign.id } : {}),
            ...(liveInstantly?.instantlyCampaignId
              ? { addToInstantlyCampaignId: liveInstantly.instantlyCampaignId }
              : { campaignName: `Autopilot ${new Date().toISOString().slice(0, 10)}` }),
          }),
        });
        sendResult = await sendRes.json().catch(() => ({}));
      }

      const sent = (sendResult.leads_uploaded as number) ?? 0;
      await logActivity(ws.id, "autopilot",
        `Autopilot run: generated ${generated}, sent ${sent}`,
        { generated, sent, appended: Boolean(liveInstantly?.instantlyCampaignId) });

      results.push({ workspaceId: ws.id, generated, sent });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "autopilot failed";
      await logActivity(ws.id, "autopilot", `Autopilot run failed: ${msg}`).catch(() => {});
      results.push({ workspaceId: ws.id, error: msg });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}
