import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";
import { logActivity } from "@/lib/activity";
import { normalizeIncentiveConfig, renderIncentive, subjectStyleLabel, INCENTIVE_FOLLOWUPS } from "@/lib/incentives";
import { classifyEmailProviders } from "@/lib/email-provider";
import { getWorkspaceWebhookUrl, registerCampaignWebhooks, WEBHOOK_EVENTS_PER_CAMPAIGN } from "@/lib/campaign-webhooks";

/** Recipient mailbox providers that quarantine cold mail (the deliverability bottleneck). */
const STRICT_GATEWAYS = new Set(["Microsoft", "Proofpoint", "Mimecast", "Barracuda"]);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Launch the Incentives Lab into ONE rolling Instantly campaign (append-friendly): the 3-step
 * sequence uses merge variables for subject + bodies, and each lead carries its own rendered
 * (subject style × amount) values, so every combo lives in a single campaign instead of flooding
 * the shared account. Each lead is still tagged with incentiveAmount + incentiveSubjectStyle, so
 * the by-amount / by-style A/B results (which come from lead stamps + the reply webhook, NOT from
 * per-campaign Instantly analytics) are identical. Appends to the existing rolling campaign unless
 * freshCampaign=true.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceIdParam: string | undefined = body.workspaceId;

    // Auth: session for users, or CRON_SECRET + workspaceId for the incentives autopilot.
    const cronSecret = process.env.CRON_SECRET;
    const isCron = Boolean(cronSecret && request.headers.get("x-cron-secret") === cronSecret && workspaceIdParam);
    if (!isCron) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const sws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
      if (!sws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      body.workspaceId = sws.id; // normalize so the lookup below is uniform
    }

    const ws = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true, webhookSecret: true, incentiveConfigJson: true } });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    // batchId optional: a specific batch (manual launch) or workspace-wide fresh leads (autopilot).
    const batchId: string | undefined = body.batchId;
    const sendLimit = Math.min(2000, Math.max(1, Number(body.sendLimit) || 300));
    // Use the request config when provided, else the workspace's saved config (autopilot path).
    const config = normalizeIncentiveConfig(body.config ?? (ws.incentiveConfigJson ? JSON.parse(ws.incentiveConfigJson) : undefined));
    // Deliverability levers (the #1 reason cold incentive mail fails): only send to leads on
    // forgiving recipient providers, and only send FROM warmed inboxes.
    const providerFilter: "all" | "google" | "no-gateways" =
      body.providerFilter === "all" || body.providerFilter === "no-gateways" ? body.providerFilter : "google";
    const warmedInboxesOnly = body.warmedInboxesOnly !== false; // default on

    // Verify the batch belongs to the workspace (only when a specific batch was requested).
    if (batchId) {
      const batch = await prisma.leadBatch.findFirst({ where: { id: batchId, workspaceId: ws.id }, select: { id: true } });
      if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }

    // Fresh, contactable, UNSENT leads only — never re-contact people the main pipeline already emailed.
    // Scope to one batch (manual) or the whole workspace (autopilot). EXCLUDE known-ineligible
    // providers at the query level so the candidate pool is full of sendable leads — otherwise a
    // pile of already-classified strict-gateway leads at the front of the queue starves the filter.
    // (null-provider leads are kept; they get classified below.)
    const providerWhere =
      providerFilter === "google" ? { OR: [{ emailProvider: "Google" }, { emailProvider: null }] }
      : providerFilter === "no-gateways" ? { NOT: { emailProvider: { in: Array.from(STRICT_GATEWAYS) } } }
      : {};
    const base = { sentAt: null, suppressed: false, repliedAt: null, email: { not: "" }, ...providerWhere };
    const leadWhere = batchId ? { leadBatchId: batchId, ...base } : { leadBatch: { workspaceId: ws.id }, ...base };
    // When filtering by provider, load a generous pool (≥1500, not just sendLimit×6) so a small
    // per-run send still has enough candidates to find eligible leads — otherwise a handful of
    // strict-gateway leads at the front of the queue can starve the filter (autopilot appends 0).
    const pool = providerFilter === "all" ? sendLimit : Math.min(6000, Math.max(sendLimit * 6, 1500));
    const candidates = await prisma.lead.findMany({
      where: leadWhere,
      select: { id: true, email: true, name: true, company: true, emailProvider: true },
      orderBy: { id: "asc" },
      take: pool,
    });
    if (candidates.length === 0) {
      return NextResponse.json({ error: "No fresh unsent leads. Pull more from Lead source." }, { status: 400 });
    }

    // Provider filtering — only send the incentive into mailboxes that actually accept cold mail.
    let leads = candidates;
    if (providerFilter !== "all") {
      // Classify any leads we haven't seen yet (MX lookup) and persist it (also improves analytics).
      // Bound the live work to protect the 60s budget; anything left null is simply treated as ineligible.
      const unclassified = candidates.filter((c) => !c.emailProvider).slice(0, 1500);
      if (unclassified.length > 0) {
        const map = await classifyEmailProviders(unclassified.map((c) => c.email));
        const byProvider: Record<string, string[]> = {};
        for (const c of unclassified) {
          const p = map[c.email] ?? "Unknown";
          c.emailProvider = p;
          (byProvider[p] ||= []).push(c.id);
        }
        await Promise.all(
          Object.entries(byProvider).map(([p, ids]) => prisma.lead.updateMany({ where: { id: { in: ids } }, data: { emailProvider: p } }))
        );
      }
      leads = candidates.filter((c) =>
        providerFilter === "google" ? c.emailProvider === "Google" : !!c.emailProvider && !STRICT_GATEWAYS.has(c.emailProvider)
      );
      if (leads.length === 0) {
        const label = providerFilter === "google" ? "on Google" : "off strict gateways";
        return NextResponse.json(
          { error: `None of the ${candidates.length} fresh leads checked are ${label}. Loosen the provider filter or pull Google-provider leads in Lead source.` },
          { status: 400 }
        );
      }
    }
    leads = leads.slice(0, sendLimit);

    const ctx = await getInstantlyClientForWorkspaceId(ws.id);
    if (!ctx) return NextResponse.json({ error: "Add your Instantly API key in Settings first." }, { status: 400 });
    const { client } = ctx;

    // Sender-side lever: send only from warmed inboxes (warmup_status === 1). Falls back to all
    // workspace inboxes if none are warmed, so a launch never silently sends from zero accounts.
    let emailList: string[] | undefined;
    let warmedCount = 0;
    if (warmedInboxesOnly) {
      try {
        const accounts = await client.listAccounts();
        const warmed = accounts.filter((a) => a.warmup_status === 1).map((a) => a.email);
        warmedCount = warmed.length;
        if (warmed.length > 0) emailList = warmed;
      } catch { /* fall back to all inboxes */ }
    }

    // Campaign-scoped reply/bounce/OOO webhooks: on a SHARED Instantly account we can't use an
    // account-level webhook (it would fire for everyone's campaigns). Each campaign we create
    // registers its own scoped webhooks pointing at our ?secret= handler (shared helper).
    const webhookUrl = await getWorkspaceWebhookUrl(ws.id, ws.webhookSecret);

    // ONE rolling campaign holds every (subject style × amount) combo via per-lead merge variables,
    // so we don't flood the shared Instantly account and can append more leads to it over time.
    const freshCampaign = body.freshCampaign === true;

    // Build the A/B matrix: every (subject style × amount) combo, diagonal order for balanced
    // assignment when leads < combos. No 8-cap needed now — it's all one campaign.
    const subjects = config.subjectTemplates;
    const amts = config.amounts;
    const S = subjects.length, A = amts.length;
    const seen = new Set<string>();
    const combos: Array<{ subjectTemplate: string; amount: number }> = [];
    const push = (si: number, ai: number) => {
      const key = `${si}:${ai}`;
      if (seen.has(key)) return;
      seen.add(key);
      combos.push({ subjectTemplate: subjects[si], amount: amts[ai] });
    };
    for (let i = 0; i < S * A; i++) push(i % S, i % A);
    for (let si = 0; si < S; si++) for (let ai = 0; ai < A; ai++) push(si, ai);

    // Render each lead's own subject + 3 step bodies (firstName/companyName/amount substituted in
    // OUR code — Instantly won't expand {{merge}} tags that live inside a merge-variable value).
    const fill = (tpl: string, amount: number, firstName: string, companyName: string) =>
      renderIncentive(tpl, amount).replace(/\{\{\s*firstName\s*\}\}/g, firstName).replace(/\{\{\s*companyName\s*\}\}/g, companyName);
    const fillBody = (tpl: string, amount: number, firstName: string, companyName: string) =>
      fill(tpl, amount, firstName, companyName).replace(/\n/g, "<br>");

    type LeadPayload = { email: string; first_name?: string; company_name?: string; custom_variables: Record<string, string> };
    const payloads: LeadPayload[] = [];
    const stampByCombo: Record<string, { amount: number; style: string; ids: string[] }> = {};
    leads.forEach((l, i) => {
      const { subjectTemplate, amount } = combos[i % combos.length];
      const style = subjectStyleLabel(subjectTemplate);
      const firstName = (l.name ?? "").trim().split(/\s+/)[0] || "there";
      const companyName = (l.company ?? "").trim() || "your team";
      const cv: Record<string, string> = {
        inc_subject: fill(subjectTemplate, amount, firstName, companyName),
        inc_body1: fillBody(config.bodyTemplate, amount, firstName, companyName),
      };
      INCENTIVE_FOLLOWUPS.forEach((f, k) => { cv[`inc_body${k + 2}`] = fillBody(f.body, amount, firstName, companyName); });
      payloads.push({ email: l.email, first_name: firstName, company_name: l.company ?? undefined, custom_variables: cv });
      const key = `${amount}|${style}`;
      (stampByCombo[key] ||= { amount, style, ids: [] }).ids.push(l.id);
    });

    // Find the existing rolling campaign to append into (unless the operator forces a fresh one).
    const ROLLING_NAME = "Incentives Lab (rolling)";
    const existing = freshCampaign
      ? null
      : await prisma.sentCampaign.findFirst({ where: { workspaceId: ws.id, name: ROLLING_NAME }, orderBy: { createdAt: "desc" }, select: { instantlyCampaignId: true } });

    // Merge-var sequence: subject/bodies are variables; each lead carries its own rendered values.
    // IMPORTANT: Instantly treats a step's `delay` as days to wait AFTER that step before the NEXT
    // one — so the gap before follow-up k must live on the PRECEDING step. We therefore put
    // FOLLOWUPS[i].delayDays on step i (last step gets 0). Putting delay=0 on step 1 made step 2
    // fire minutes after step 1.
    const varNames = ["inc_subject", "inc_body1", ...INCENTIVE_FOLLOWUPS.map((_, k) => `inc_body${k + 2}`)];
    const stepBodies = ["{{inc_body1}}", ...INCENTIVE_FOLLOWUPS.map((_, k) => `{{inc_body${k + 2}}}`)];
    const mergeSteps = stepBodies.map((body, i) => ({
      subject: i === 0 ? "{{inc_subject}}" : "",
      body,
      delayDays: INCENTIVE_FOLLOWUPS[i]?.delayDays ?? 0,
    }));

    let campaignId: string;
    let mode: "created" | "appended";
    let webhooksRegistered = 0;
    if (existing?.instantlyCampaignId) {
      campaignId = existing.instantlyCampaignId;
      mode = "appended";
    } else {
      const created = await client.createCampaign(ROLLING_NAME, { sequenceSteps: mergeSteps, ...(emailList && { email_list: emailList }) });
      campaignId = created.id;
      await client.addCampaignVariables(campaignId, varNames).catch(() => {});
      await prisma.sentCampaign.create({ data: { workspaceId: ws.id, leadBatchId: batchId ?? null, instantlyCampaignId: campaignId, name: ROLLING_NAME } });
      webhooksRegistered = await registerCampaignWebhooks(client, campaignId, webhookUrl, ROLLING_NAME);
      mode = "created";
    }

    const add = await client.bulkAddLeadsToCampaign(campaignId, payloads, { verify_leads_on_import: false });
    await client.activateCampaign(campaignId).catch(() => {}); // idempotent — ensure it's running

    // Stamp leads with their combo (per-amount/per-style analytics come from these stamps, NOT from
    // separate Instantly campaigns — so one campaign gives identical A/B results).
    await Promise.all(
      Object.values(stampByCombo).map((c) =>
        prisma.lead.updateMany({ where: { id: { in: c.ids } }, data: { sentAt: new Date(), incentiveAmount: c.amount, incentiveSubjectStyle: c.style } })
      )
    );

    const totalUploaded = add.leads_uploaded ?? 0;
    const distribution = Object.values(stampByCombo).map((c) => ({ amount: c.amount, style: c.style, leads: c.ids.length })).sort((a, b) => a.amount - b.amount);
    const inboxNote = warmedInboxesOnly ? (emailList ? `${warmedCount} warmed inboxes` : "all inboxes (no warmed found)") : "all inboxes";
    const providerNote = providerFilter === "all" ? "all providers" : providerFilter === "google" ? `Google-only (${leads.length} of ${candidates.length} fresh)` : `no strict gateways (${leads.length} of ${candidates.length} fresh)`;
    await logActivity(ws.id, "send",
      `Incentives Lab ${mode === "created" ? "launched" : "appended"}: ${totalUploaded} leads into "${ROLLING_NAME}" across ${combos.length} combos (${S} subject styles × ${A} amounts) — ${providerNote}, sent from ${inboxNote}${mode === "created" ? `, ${webhooksRegistered} scoped webhooks` : ""}`,
      { mode, campaignId, distribution, providerFilter, warmedInboxesOnly, warmedCount, eligibleLeads: leads.length, candidatePool: candidates.length, webhooksRegistered });

    return NextResponse.json({
      ok: true, mode, campaignId, campaignName: ROLLING_NAME, totalUploaded, combos: combos.length, distribution,
      providerFilter, eligibleLeads: leads.length, candidatePool: candidates.length,
      warmedInboxes: emailList ? warmedCount : null,
      webhooksRegistered: mode === "created" ? webhooksRegistered : null, webhookEventsPerCampaign: WEBHOOK_EVENTS_PER_CAMPAIGN,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Launch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
