import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";
import { logActivity } from "@/lib/activity";
import { normalizeIncentiveConfig, renderIncentive, subjectStyleLabel, INCENTIVE_FOLLOWUPS, GIFT_TYPES, renderGift, BODY_PRESETS, VALUE_FIRST_SUBJECTS, VALUE_FIRST_BODIES, VALUE_FIRST_FOLLOWUPS, SHORT_BODIES, SOFT_CTA_BODIES, SHORT_SUBJECTS } from "@/lib/incentives";
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

    const ws = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true, webhookSecret: true, incentiveConfigJson: true, recycleCooldownDays: true } });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    // RECYCLE mode: re-contact already-sent, never-replied leads with the current (better) emails,
    // once they're past the cooldown. This re-uses the whole send pipeline but on a different pool.
    const recycle = body.recycle === true;
    // OOO REQUEUE mode: re-contact leads who sent an out-of-office auto-reply and whose stated
    // return date has now passed — so we land when they're actually back. Shares the recycle
    // machinery (re-contacts already-sent leads, stamps recycledAt/recycleCount to cap re-touches).
    const oooRequeue = body.oooRequeue === true;
    const reEngage = recycle || oooRequeue; // both re-contact already-sent leads, not fresh ones
    // VALUE-FIRST mode: the no-money A/B track. Leads with a brand-specific consumer read instead of
    // a gift card; reply-first, credentialed. Sends into a separate "Value-First (rolling)" campaign
    // so positives are cleanly comparable to the incentive track. Runs on FRESH leads, like incentives.
    const valueFirst = body.valueFirst === true;
    const cooldownDays = ws.recycleCooldownDays ?? 21;

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
    const now = new Date();
    const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
    // FRESH base = never sent. RECYCLE base = sent long ago, never replied/bounced, not recycled
    // recently, capped at 2 re-contacts. OOO base = sent an out-of-office reply whose return date
    // has passed; same cap + not-recently-recontacted guard so we don't loop on the same person.
    const base = oooRequeue
      ? { replyStatus: "ooo", requeueAt: { lte: now }, suppressed: false, bouncedAt: null, email: { not: "" }, recycleCount: { lt: 2 }, OR: [{ recycledAt: null }, { recycledAt: { lt: cutoff } }], ...providerWhere }
      : recycle
      ? { sentAt: { lt: cutoff }, suppressed: false, repliedAt: null, bouncedAt: null, email: { not: "" }, recycleCount: { lt: 2 }, OR: [{ recycledAt: null }, { recycledAt: { lt: cutoff } }], ...providerWhere }
      : { sentAt: null, suppressed: false, repliedAt: null, email: { not: "" }, ...providerWhere };
    const leadWhere = batchId ? { leadBatchId: batchId, ...base } : { leadBatch: { workspaceId: ws.id }, ...base };
    // When filtering by provider, load a generous pool (≥1500, not just sendLimit×6) so a small
    // per-run send still has enough candidates to find eligible leads — otherwise a handful of
    // strict-gateway leads at the front of the queue can starve the filter (autopilot appends 0).
    const pool = providerFilter === "all" ? sendLimit : Math.min(6000, Math.max(sendLimit * 6, 1500));
    const candidates = await prisma.lead.findMany({
      where: leadWhere,
      select: { id: true, email: true, name: true, company: true, emailProvider: true },
      // OOO requeue: soonest-returned first. Recycle: oldest-contacted first. Fresh: by id.
      orderBy: oooRequeue ? { requeueAt: "asc" } : recycle ? { sentAt: "asc" } : { id: "asc" },
      take: pool,
    });
    if (candidates.length === 0) {
      const emptyMsg = oooRequeue
        ? "No out-of-office leads are back yet (none past their stated return date)."
        : recycle
        ? `No leads eligible to recycle yet (need to be ${cooldownDays}+ days since last contact, no reply).`
        : "No fresh unsent leads. Pull more from Lead source.";
      return NextResponse.json({ error: emptyMsg }, { status: 400 });
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

    // Content set depends on the track. Value-first uses its own subjects/bodies/follow-ups and NO
    // money (amount 0 sentinel — its templates carry no {{amount}}/{{gift}} tokens, so the fillers
    // are no-ops). Incentive track uses the configured subjects/amounts + rotating credentialed bodies.
    const followups = valueFirst ? VALUE_FIRST_FOLLOWUPS : INCENTIVE_FOLLOWUPS;
    // Build the A/B matrix: every (subject style × amount) combo, diagonal order for balanced
    // assignment when leads < combos. No 8-cap needed now — it's all one campaign.
    const subjects = valueFirst ? VALUE_FIRST_SUBJECTS.map((s) => s.template) : config.subjectTemplates;
    const amts = valueFirst ? [0] : config.amounts;
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
    const fill = (tpl: string, amount: number, firstName: string, companyName: string, gift: string) =>
      renderGift(renderIncentive(tpl, amount).replace(/\{\{\s*firstName\s*\}\}/g, firstName).replace(/\{\{\s*companyName\s*\}\}/g, companyName), gift);
    const fillBody = (tpl: string, amount: number, firstName: string, companyName: string, gift: string) =>
      fill(tpl, amount, firstName, companyName, gift).replace(/\n/g, "<br>");

    type LeadPayload = { email: string; first_name?: string; company_name?: string; custom_variables: Record<string, string> };
    const payloads: LeadPayload[] = [];
    const stampByCombo: Record<string, { amount: number; style: string; gift: string; ids: string[] }> = {};
    // Rotate the step-1 body so a few thousand sends aren't all the same opener (better
    // deliverability + a real body A/B). Priority: operator-pinned bodyTemplates → all stock
    // credentialed presets (when the stored body is just a stock preset, i.e. not customized) →
    // the single stored body (respects a hand-written custom body).
    const bodySet = valueFirst
      ? VALUE_FIRST_BODIES.map((b) => b.template)
      : (config.bodyTemplates && config.bodyTemplates.length)
      ? config.bodyTemplates
      : BODY_PRESETS.some((p) => p.template === config.bodyTemplate)
        ? BODY_PRESETS.map((p) => p.template)
        : [config.bodyTemplate];

    // CONTROLLABLE ColdIQ experiments (incentive track only — value-first keeps its own copy). A
    // configurable SHARE of leads get an experiment body (short / soft-CTA) and, if enabled, a short
    // lowercase subject, instead of the proven credentialed copy. experimentShare 0 = fully off, so
    // the main approach is untouched until dialed up. Deterministic by index so the split is stable.
    const exp = valueFirst ? [] : (config.experiments ?? []);
    const expShare = valueFirst ? 0 : (config.experimentShare ?? 0);
    const expBodies = [
      ...(exp.includes("short") ? SHORT_BODIES.map((b) => b.template) : []),
      ...(exp.includes("soft-cta") ? SOFT_CTA_BODIES.map((b) => b.template) : []),
    ];
    const expSubjects = exp.includes("short-subjects") ? SHORT_SUBJECTS.map((s) => s.template) : [];
    const expCut = Math.round(expShare * 100);

    leads.forEach((l, i) => {
      const inExperiment = expShare > 0 && expBodies.length > 0 && (i % 100) < expCut;
      const { amount } = combos[i % combos.length];
      // Subject: experiment leads use a short lowercase subject when that family is on; else the combo subject.
      const subjectTemplate = inExperiment && expSubjects.length ? expSubjects[i % expSubjects.length] : combos[i % combos.length].subjectTemplate;
      const style = subjectStyleLabel(subjectTemplate);
      const gift = GIFT_TYPES[i % GIFT_TYPES.length]; // rotate gift type independently (3rd A/B dimension)
      // Body: experiment leads pull from the enabled experiment pool; everyone else gets credentialed.
      const bodyTpl = inExperiment ? expBodies[i % expBodies.length] : bodySet[i % bodySet.length];
      const firstName = (l.name ?? "").trim().split(/\s+/)[0] || "there";
      const companyName = (l.company ?? "").trim() || "your team";
      const cv: Record<string, string> = {
        inc_subject: fill(subjectTemplate, amount, firstName, companyName, gift),
        inc_body1: fillBody(bodyTpl, amount, firstName, companyName, gift),
      };
      followups.forEach((f, k) => { cv[`inc_body${k + 2}`] = fillBody(f.body, amount, firstName, companyName, gift); });
      payloads.push({ email: l.email, first_name: firstName, company_name: l.company ?? undefined, custom_variables: cv });
      const key = `${amount}|${style}|${gift}`;
      (stampByCombo[key] ||= { amount, style, gift, ids: [] }).ids.push(l.id);
    });

    // Find the existing rolling campaign to append into (unless the operator forces a fresh one).
    const ROLLING_NAME = valueFirst
      ? (recycle ? "Value-First (recycle)" : oooRequeue ? "Value-First (OOO)" : "Value-First (rolling)")
      : oooRequeue ? "Incentives Lab (OOO)" : recycle ? "Incentives Lab (recycle)" : "Incentives Lab (rolling)";
    const existing = freshCampaign
      ? null
      : await prisma.sentCampaign.findFirst({ where: { workspaceId: ws.id, name: ROLLING_NAME }, orderBy: { createdAt: "desc" }, select: { instantlyCampaignId: true } });

    // Merge-var sequence: subject/bodies are variables; each lead carries its own rendered values.
    // IMPORTANT: Instantly treats a step's `delay` as days to wait AFTER that step before the NEXT
    // one — so the gap before follow-up k must live on the PRECEDING step. We therefore put
    // FOLLOWUPS[i].delayDays on step i (last step gets 0). Putting delay=0 on step 1 made step 2
    // fire minutes after step 1.
    const varNames = ["inc_subject", "inc_body1", ...followups.map((_, k) => `inc_body${k + 2}`)];
    const stepBodies = ["{{inc_body1}}", ...followups.map((_, k) => `{{inc_body${k + 2}}}`)];
    const mergeSteps = stepBodies.map((body, i) => ({
      subject: i === 0 ? "{{inc_subject}}" : "",
      body,
      delayDays: followups[i]?.delayDays ?? 0,
    }));

    let campaignId: string;
    let mode: "created" | "appended";
    let webhooksRegistered = 0;
    if (existing?.instantlyCampaignId) {
      campaignId = existing.instantlyCampaignId;
      mode = "appended";
    } else {
      const created = await client.createCampaign(ROLLING_NAME, { sequenceSteps: mergeSteps, dailyLimit: 5000, ...(emailList && { email_list: emailList }) });
      campaignId = created.id;
      await client.addCampaignVariables(campaignId, varNames).catch(() => {});
      await prisma.sentCampaign.create({ data: { workspaceId: ws.id, leadBatchId: batchId ?? null, instantlyCampaignId: campaignId, name: ROLLING_NAME } });
      webhooksRegistered = await registerCampaignWebhooks(client, campaignId, webhookUrl, ROLLING_NAME);
      mode = "created";
    }

    // verify_leads_on_import: Instantly validates each email at import and won't send to the
    // invalid ones — this is the bounce protection. Without it, dead Apollo addresses bounce and
    // Instantly auto-pauses the campaign to protect the sending domains.
    const add = await client.bulkAddLeadsToCampaign(campaignId, payloads, { verify_leads_on_import: true });
    await client.activateCampaign(campaignId).catch(() => {}); // idempotent — ensure it's running

    // Stamp leads with their combo (per-amount/per-style analytics come from these stamps, NOT from
    // separate Instantly campaigns — so one campaign gives identical A/B results).
    await Promise.all(
      Object.values(stampByCombo).map((c) =>
        prisma.lead.updateMany({ where: { id: { in: c.ids } }, data: reEngage
          ? { recycledAt: new Date(), recycleCount: { increment: 1 }, requeueAt: null, incentiveAmount: c.amount, incentiveSubjectStyle: c.style, incentiveGiftType: c.gift }
          : { sentAt: new Date(), incentiveAmount: c.amount, incentiveSubjectStyle: c.style, incentiveGiftType: c.gift } })
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
