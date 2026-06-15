import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId, getInstantlyClientForWorkspaceId } from "@/lib/instantly";
import { prisma } from "@/lib/prisma";
import { parsePlaybook, getSequenceSteps } from "@/lib/playbook";
import { logActivity } from "@/lib/activity";
import { getWorkspaceWebhookUrl, registerCampaignWebhooks } from "@/lib/campaign-webhooks";

export const dynamic = "force-dynamic";

/**
 * Create campaign(s), apply ramp, add leads, activate.
 * Body: { batchId: string, abTest?: boolean, subjectLineA?: string, subjectLineB?: string }
 * When abTest is true, subjectLineA and subjectLineB are required; creates two campaigns (A/B) and assigns leads 50/50.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { batchId, abTest, subjectLineA, subjectLineB, campaignName: campaignNameInput, accountEmails, campaignId: flowCampaignId, skipFailingLeads, styles, sendLimit, addToInstantlyCampaignId, workspaceId: workspaceIdParam, skipRamp } = body as {
      batchId?: string;
      abTest?: boolean;
      subjectLineA?: string;
      subjectLineB?: string;
      campaignName?: string;
      accountEmails?: string[];
      campaignId?: string;
      skipFailingLeads?: boolean;
      styles?: string[]; // e.g. ["pain-led","insight-hook","social-proof","direct-ask"]
      sendLimit?: number; // cap how many leads enter this send; undefined = send all
      addToInstantlyCampaignId?: string; // append leads into this existing Instantly campaign instead of creating a new one
      workspaceId?: string; // autopilot orchestrator (with CRON_SECRET) targets a workspace directly
      skipRamp?: boolean; // skip re-applying per-inbox limits (autopilot runs frequently; ramp is a manual/periodic concern)
    };

    // Auth: session for users, or CRON_SECRET + workspaceId for the autopilot orchestrator
    const cronSecret = process.env.CRON_SECRET;
    const isCron = Boolean(cronSecret && request.headers.get("x-cron-secret") === cronSecret && workspaceIdParam);
    let sessionUserId: string | null = null;
    if (!isCron) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      sessionUserId = session.user.id;
    }
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }
    const campaignNameTrimmed = campaignNameInput?.trim();
    // Campaign name isn't needed when appending to an existing Instantly campaign
    if (!campaignNameTrimmed && !(addToInstantlyCampaignId && addToInstantlyCampaignId.trim())) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }
    if (abTest && (!subjectLineA?.trim() || !subjectLineB?.trim())) {
      return NextResponse.json(
        { error: "A/B test requires subjectLineA and subjectLineB" },
        { status: 400 }
      );
    }
    const selectedEmails = Array.isArray(accountEmails) ? accountEmails.filter((e): e is string => typeof e === "string" && e.trim().length > 0).map((e) => e.trim()) : undefined;

    const workspace = await prisma.workspace.findUnique({
      where: isCron ? { id: workspaceIdParam } : { userId: sessionUserId! },
      select: { id: true, playbookApproved: true, playbookJson: true, inboxDailyLimit: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // When launching from Campaign flow (campaignId set), we use campaign playbook; otherwise require workspace playbook approved
    let flowCampaign: { id: string; playbookJson: string | null } | null = null;
    if (flowCampaignId) {
      flowCampaign = await prisma.campaign.findFirst({
        where: { id: flowCampaignId, workspaceId: workspace.id },
        select: { id: true, playbookJson: true },
      }) as { id: string; playbookJson: string | null } | null;
      if (!flowCampaign) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      }
    } else if (!workspace.playbookApproved) {
      return NextResponse.json({ error: "Approve your playbook before sending." }, { status: 400 });
    }

    // EGRESS GUARDRAIL: the autopilot/skip path runs every minute, so it must NOT load the
    // whole batch (all leads + their full sequences + landing-page JSON) each time — doing
    // so drained the Neon data-transfer quota. On that path, load ONLY contactable, ready
    // leads, capped per run. Manual launches (rare, skipFailingLeads=false) still load the
    // full batch so the "every lead must pass" quality check can report accurately.
    const now = new Date();
    const PER_SEND_CAP = Math.min(sendLimit ?? 1000, 1000);
    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      include: {
        leads: skipFailingLeads
          ? {
              where: {
                sentAt: null, // only UNSENT leads — re-sending already-sent ones just dedupes to 0 uploaded
                suppressed: false,
                repliedAt: null,
                OR: [{ requeueAt: null }, { requeueAt: { lte: now } }],
                AND: [{ stepsJson: { not: null } }, { stepsJson: { not: "" } }, { stepsJson: { not: "[]" } }],
              },
              orderBy: { id: "asc" },
              take: PER_SEND_CAP,
            }
          : true,
      },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    if (batch.leads.length === 0) {
      return NextResponse.json({ error: "No contactable leads ready to send (all sent, suppressed, replied, or not yet generated)." }, { status: 400 });
    }

    // Never re-contact leads who said no / bounced (suppressed) or who already replied.
    // OOO leads with a future requeueAt are also held until that date passes.
    const contactable = batch.leads.filter((l) => {
      const lead = l as typeof l & { suppressed?: boolean; repliedAt?: Date | null; requeueAt?: Date | null };
      if (lead.suppressed) return false;
      if (lead.repliedAt) return false; // already in a conversation
      if (lead.requeueAt && lead.requeueAt > now) return false; // OOO, not back yet
      return true;
    });
    if (contactable.length === 0) {
      return NextResponse.json({ error: "No contactable leads (all suppressed, replied, or held for OOO)." }, { status: 400 });
    }

    // Shuffle so any sendLimit pulls a random cross-section, not the first N by
    // insertion order. The limit itself is applied AFTER the quality gate (below)
    // so it caps leads that actually have sequences — not random ungenerated ones.
    const shuffled = [...contactable].sort(() => Math.random() - 0.5);
    batch.leads = shuffled as typeof batch.leads;

    const ctx = isCron
      ? await getInstantlyClientForWorkspaceId(workspace.id)
      : await getInstantlyClientForUserId(sessionUserId!);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured. Add it in onboarding." },
        { status: 400 }
      );
    }

    const { client } = ctx;

    try {
      if (!skipRamp) await client.applyRampForUnwarmedAccounts({
        unwarmedDailyLimit: 5,
        warmedDailyLimit: workspace.inboxDailyLimit ?? 30,
        ...(selectedEmails != null && selectedEmails.length > 0 && { accountEmails: selectedEmails }),
      });
    } catch (rampErr) {
      // Non-fatal: ramp application failing (e.g. invalid/expired Instantly key for account patch)
      // should not block campaign creation. Log and continue.
      console.warn("[send] applyRampForUnwarmedAccounts failed (non-fatal):", rampErr instanceof Error ? rampErr.message : rampErr);
    }

    // Non-empty in every path except append-mode, which returns before baseName is used.
    const baseName = campaignNameTrimmed ?? "Campaign";

    // Ensure email body line breaks render in Instantly (plain \n -> <br>)
    const bodyWithLineBreaks = (text: string) =>
      (text ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\n/g, "<br>");

    // Helper: mark leads as sent and record variant
    const markAsSent = async (leadIds: string[], variant?: string) => {
      await prisma.lead.updateMany({
        where: { id: { in: leadIds } },
        data: { sentAt: new Date(), ...(variant ? { abVariant: variant } : {}) },
      });
    };

    // Helper: build Instantly lead payload from a lead record (with Re: threading for steps 2+)
    type LeadRecord = typeof batch.leads[0];
    const toLeadPayload = (l: LeadRecord, stepsOverride?: Array<{ subject: string; body: string }>) => {
      const steps = stepsOverride ?? getLeadSteps(l as LeadWithSteps, numStepsFromPlaybook);
      const step1Subject = steps[0]?.subject ?? "";
      const custom_variables: Record<string, string> = {};
      steps.forEach((s, i) => {
        custom_variables[`step${i + 1}_subject`] = i === 0 ? step1Subject : `Re: ${step1Subject}`;
        custom_variables[`step${i + 1}_body`] = bodyWithLineBreaks(s.body ?? "").trim();
      });
      return {
        email: l.email,
        first_name: l.name?.split(/\s+/)[0] ?? null,
        last_name: l.name?.split(/\s+/).slice(1).join(" ") || null,
        company_name: l.company ?? null,
        custom_variables,
      };
    };

    const playbookSource = flowCampaign?.playbookJson ?? workspace.playbookJson;
    const parsed = parsePlaybook(playbookSource);
    const numStepsFromPlaybook = parsed?.numSteps ?? 3;
    const stepDelays = parsed?.stepDelays ?? [1, 3, 5];
    const minGapDays = () => 2 + Math.floor(Math.random() * 2);
    const sequenceSteps = getSequenceSteps(numStepsFromPlaybook, stepDelays).map((s, i) => ({
      ...s,
      // Step 0: min 1 day so Step 1 and Step 2 don't go out together. Other steps: min 2–3 days.
      delayDays: i === 0 ? Math.max(s.delayDays, 1) : Math.max(s.delayDays, minGapDays()),
    }));

    // Get a lead's steps array (from stepsJson or legacy step1/2/3), padded to numSteps
    type LeadWithSteps = typeof batch.leads[0] & { stepsJson?: string | null };
    const getLeadSteps = (lead: LeadWithSteps, numSteps: number): Array<{ subject: string; body: string }> => {
      let arr: Array<{ subject?: string; body?: string }>;
      try {
        if (lead.stepsJson) {
          const parsed = JSON.parse(lead.stepsJson) as unknown;
          arr = Array.isArray(parsed) ? parsed : [];
        } else {
          arr = [];
        }
      } catch {
        arr = [];
      }
      const legacy = [
        { subject: lead.step1Subject ?? "", body: lead.step1Body ?? "" },
        { subject: lead.step2Subject ?? "", body: lead.step2Body ?? "" },
        { subject: lead.step3Subject ?? "", body: lead.step3Body ?? "" },
      ];
      const steps: Array<{ subject: string; body: string }> = [];
      for (let i = 0; i < numSteps; i++) {
        const s = arr[i] ?? legacy[i] ?? { subject: "", body: "" };
        steps.push({ subject: s.subject ?? "", body: s.body ?? "" });
      }
      return steps;
    };

    const numSteps = sequenceSteps.length;
    const MIN_SUBJECT_LENGTH = 10;
    const MIN_BODY_LENGTH = 50;

    // Quality gate: EVERY step of EVERY lead must pass (no blank emails, no stub content)
    type StepFail = { leadEmail: string; stepIndex: number; reason: string };
    const stepFails: StepFail[] = [];
    let leadsPassingAllSteps = batch.leads.filter((l) => {
      const steps = getLeadSteps(l as LeadWithSteps, numSteps);
      for (let i = 0; i < steps.length; i++) {
        const subj = (steps[i]?.subject ?? "").trim();
        const body = (steps[i]?.body ?? "").trim();
        if (subj.length < MIN_SUBJECT_LENGTH) {
          stepFails.push({ leadEmail: l.email, stepIndex: i + 1, reason: `subject too short (${subj.length} chars, min ${MIN_SUBJECT_LENGTH})` });
          return false;
        }
        if (body.length < MIN_BODY_LENGTH) {
          stepFails.push({ leadEmail: l.email, stepIndex: i + 1, reason: `body too short (${body.length} chars, min ${MIN_BODY_LENGTH})` });
          return false;
        }
      }
      return true;
    });

    if (leadsPassingAllSteps.length === 0) {
      const byStep = new Map<number, number>();
      stepFails.forEach((f) => byStep.set(f.stepIndex, (byStep.get(f.stepIndex) ?? 0) + 1));
      return NextResponse.json(
        {
          error:
            "Quality check failed. Every step of every lead must have subject ≥10 characters and body ≥50 characters. No leads passed. Fix or regenerate sequences, then try again.",
          validation: {
            numSteps,
            totalLeads: batch.leads.length,
            leadsPassingAllSteps: 0,
            failsByStep: Object.fromEntries(byStep),
            sampleFails: stepFails.slice(0, 15),
          },
        },
        { status: 400 }
      );
    }

    // Every lead must pass unless skipFailingLeads is true
    if (leadsPassingAllSteps.length < batch.leads.length && !skipFailingLeads) {
      const missing = batch.leads.length - leadsPassingAllSteps.length;
      return NextResponse.json(
        {
          error: `Every lead must have a personalized ${numSteps}-step sequence that passes the quality check (subject ≥10 chars, body ≥50 chars per step). ${missing} of ${batch.leads.length} leads are missing content or fail. Run "Generate sequences" until the quality check shows 100% pass, or use "Skip failing leads & Launch".`,
          validation: {
            numSteps,
            totalLeads: batch.leads.length,
            leadsPassingAllSteps: leadsPassingAllSteps.length,
            sampleFails: stepFails.slice(0, 15),
          },
        },
        { status: 400 }
      );
    }

    // Apply the send limit to leads that actually have sequences (already shuffled),
    // so "limit 200" means 200 real emails, not 200 random possibly-ungenerated leads.
    if (sendLimit && sendLimit > 0 && leadsPassingAllSteps.length > sendLimit) {
      leadsPassingAllSteps = leadsPassingAllSteps.slice(0, sendLimit);
    }

    // ── Append to an existing Instantly campaign ─────────────────────────────
    // Generate-in-small-batches workflow: feed the freshly generated leads into
    // the campaign that's already running, instead of spinning up a new one.
    if (addToInstantlyCampaignId && addToInstantlyCampaignId.trim()) {
      const targetId = addToInstantlyCampaignId.trim();
      // Verify the target Instantly campaign belongs to this workspace
      const target = await prisma.sentCampaign.findFirst({
        where: { workspaceId: workspace.id, instantlyCampaignId: targetId },
        select: { id: true, name: true },
      });
      if (!target) {
        return NextResponse.json({ error: "That Instantly campaign isn't one this workspace manages." }, { status: 404 });
      }

      // Ensure the step variables are registered (idempotent)
      const stepVarNames = Array.from({ length: numSteps }, (_, i) => [`step${i + 1}_subject`, `step${i + 1}_body`]).flat();
      await client.addCampaignVariables(targetId, stepVarNames).catch(() => {});

      const payload = leadsPassingAllSteps.map((l) => toLeadPayload(l as LeadRecord));
      let addResult: { leads_uploaded: number; duplicated_leads: number; in_blocklist: number };
      try {
        addResult = await client.bulkAddLeadsToCampaign(targetId, payload, { verify_leads_on_import: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        return NextResponse.json({ error: `Instantly rejected the leads: ${msg}` }, { status: 400 });
      }

      if (addResult.leads_uploaded > 0) {
        await markAsSent(leadsPassingAllSteps.map((l) => l.id));
      }

      await logActivity(workspace.id, "send",
        `Appended ${addResult.leads_uploaded} leads to existing campaign "${target.name}"`,
        { appended: addResult.leads_uploaded, duplicates: addResult.duplicated_leads, blocklisted: addResult.in_blocklist, instantlyCampaignId: targetId });

      return NextResponse.json({
        success: true,
        appendedTo: targetId,
        campaignName: target.name,
        leads_uploaded: addResult.leads_uploaded,
        duplicated_leads: addResult.duplicated_leads,
        in_blocklist: addResult.in_blocklist,
        message: `Added ${addResult.leads_uploaded} leads to existing campaign "${target.name}". ${addResult.duplicated_leads} were already in Instantly.`,
      });
    }

    const campaignOptionsWithSequence = {
      ...(selectedEmails != null && selectedEmails.length > 0 ? { email_list: selectedEmails } : {}),
      ...(sequenceSteps.length > 0 ? { sequenceSteps } : {}),
      delayUnit: "days" as const,
    };

    // Shared Instantly account → every campaign we create needs its OWN scoped reply/bounce/OOO
    // webhooks (an account-level one would catch other people's campaigns). Compute the target URL
    // once; each creation path below registers after it records the SentCampaign.
    const webhookUrl = await getWorkspaceWebhookUrl(workspace.id);

    // ── Multi-style A/B/C/D ──────────────────────────────────────────────────
    // When styles[] is provided, group leads by emailStyle and create one campaign
    // per style sharing a common abGroupId. The decision agent will pick a winner.
    if (styles && styles.length > 1) {
      const abGroupId = `style-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const styleResults: Array<{ style: string; campaignId: string; leadsCount: number }> = [];

      for (const s of styles) {
        const styleLeads = leadsPassingAllSteps.filter((l) => (l as LeadRecord & { emailStyle?: string | null }).emailStyle === s);
        if (styleLeads.length === 0) continue;

        const styleName = `${baseName} — ${s}`;
        const created = await client.createCampaign(styleName, campaignOptionsWithSequence);
        const styleId = created.id;
        if (!styleId) continue;

        const stepVarNames = Array.from({ length: numSteps }, (_, i) => [`step${i + 1}_subject`, `step${i + 1}_body`]).flat();
        await client.addCampaignVariables(styleId, stepVarNames).catch(() => {});

        const payload = styleLeads.map((l) => toLeadPayload(l as LeadRecord));
        const result = await client.bulkAddLeadsToCampaign(styleId, payload, { verify_leads_on_import: true });
        if (result.leads_uploaded > 0) {
          await client.activateCampaign(styleId);
          await markAsSent(styleLeads.map((l) => l.id), s);
          await prisma.sentCampaign.create({
            data: {
              workspaceId: workspace.id,
              campaignId: flowCampaign?.id ?? null,
              leadBatchId: batch.id,
              instantlyCampaignId: styleId,
              name: styleName,
              abGroupId,
              variant: s,
            },
          });
          await registerCampaignWebhooks(client, styleId, webhookUrl, styleName);
          styleResults.push({ style: s, campaignId: styleId, leadsCount: result.leads_uploaded });
        }
      }

      if (flowCampaign?.id) {
        await prisma.campaign.update({ where: { id: flowCampaign.id }, data: { status: "launched" } });
      }

      return NextResponse.json({
        success: true,
        multiStyle: true,
        abGroupId,
        variants: styleResults,
        message: `${styleResults.length} style campaigns created. Agent will monitor and declare winner automatically.`,
      });
    }

    if (abTest) {
      // A/B: assign leads 50/50, create two campaigns, record with abGroupId
      const abGroupId = `ab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      // Randomly assign to A/B rather than alternating by index, so splits are
      // segment-balanced even if the list happens to be sorted by industry/persona
      const leadsA: typeof leadsPassingAllSteps = [];
      const leadsB: typeof leadsPassingAllSteps = [];
      leadsPassingAllSteps.forEach((l) => {
        if (Math.random() < 0.5) leadsA.push(l);
        else leadsB.push(l);
      });

      await prisma.lead.updateMany({
        where: { id: { in: leadsA.map((l) => l.id) } },
        data: { abVariant: "A" },
      });
      await prisma.lead.updateMany({
        where: { id: { in: leadsB.map((l) => l.id) } },
        data: { abVariant: "B" },
      });

      const toPayload = (
        list: typeof leadsPassingAllSteps,
        subjectLineOverride: string
      ) =>
        list.map((l) => {
          const steps = getLeadSteps(l, numSteps);
          const custom_variables: Record<string, string> = {};
          steps.forEach((s, i) => {
            custom_variables[`step${i + 1}_subject`] = i === 0 ? subjectLineOverride : (s.subject ?? "");
            custom_variables[`step${i + 1}_body`] = bodyWithLineBreaks(s.body ?? "").trim();
          });
          return {
            email: l.email,
            first_name: l.name?.split(/\s+/)[0] ?? null,
            last_name: l.name?.split(/\s+/).slice(1).join(" ") || null,
            company_name: l.company ?? null,
            custom_variables,
          };
        });

      const nameA = `${baseName} (A)`;
      const nameB = `${baseName} (B)`;
      const createdA = await client.createCampaign(nameA, campaignOptionsWithSequence);
      const createdB = await client.createCampaign(nameB, campaignOptionsWithSequence);
      const idA = createdA.id;
      const idB = createdB.id;
      if (!idA || !idB) {
        return NextResponse.json({ error: "Instantly did not return campaign ids" }, { status: 500 });
      }

      const stepVariableNames = Array.from({ length: numSteps }, (_, i) => [
        `step${i + 1}_subject`,
        `step${i + 1}_body`,
      ]).flat();
      await Promise.all([
        client.addCampaignVariables(idA, stepVariableNames),
        client.addCampaignVariables(idB, stepVariableNames),
      ]);

      const [resA, resB] = await Promise.all([
        client.bulkAddLeadsToCampaign(idA, toPayload(leadsA, subjectLineA!.trim()), {
          verify_leads_on_import: true,
        }),
        client.bulkAddLeadsToCampaign(idB, toPayload(leadsB, subjectLineB!.trim()), {
          verify_leads_on_import: true,
        }),
      ]);

      const totalUploaded = resA.leads_uploaded + resB.leads_uploaded;
      if (totalUploaded === 0) {
        return NextResponse.json(
          {
            error: `No leads were uploaded to Instantly — all leads were duplicates or blocklisted. Campaigns were created but not activated. Remove duplicates or use different leads.`,
            validation: {
              numSteps,
              leadsSent: 0,
              duplicated_leads: resA.duplicated_leads + resB.duplicated_leads,
              in_blocklist: resA.in_blocklist + resB.in_blocklist,
            },
          },
          { status: 400 }
        );
      }

      await client.activateCampaign(idA);
      await client.activateCampaign(idB);

      await markAsSent(leadsA.map((l) => l.id), "A");
      await markAsSent(leadsB.map((l) => l.id), "B");

      await prisma.sentCampaign.createMany({
        data: [
          {
            workspaceId: workspace.id,
            campaignId: flowCampaign?.id ?? null,
            leadBatchId: batch.id,
            instantlyCampaignId: idA,
            name: nameA,
            abGroupId,
            variant: "A",
          },
          {
            workspaceId: workspace.id,
            campaignId: flowCampaign?.id ?? null,
            leadBatchId: batch.id,
            instantlyCampaignId: idB,
            name: nameB,
            abGroupId,
            variant: "B",
          },
        ],
      });
      await Promise.all([
        registerCampaignWebhooks(client, idA, webhookUrl, nameA),
        registerCampaignWebhooks(client, idB, webhookUrl, nameB),
      ]);
      if (flowCampaign?.id) {
        await prisma.campaign.update({ where: { id: flowCampaign.id }, data: { status: "launched", name: baseName } });
      }

      return NextResponse.json({
        success: true,
        abTest: true,
        campaignId: idA,
        campaignIdB: idB,
        campaignName: nameA,
        campaignNameB: nameB,
        abGroupId,
        leads_uploaded: totalUploaded,
        duplicated_leads: resA.duplicated_leads + resB.duplicated_leads,
        in_blocklist: resA.in_blocklist + resB.in_blocklist,
        validation: { numSteps, leadsSent: leadsA.length + leadsB.length, allStepsPassed: true },
        message: `A/B campaigns "${nameA}" and "${nameB}" created and activated (${leadsA.length} vs ${leadsB.length} leads). Each step sent as a separate email.`,
      });
    }

    // Single campaign
    const campaignName = baseName;
    let campaignId: string;
    try {
      const created = await client.createCampaign(campaignName, campaignOptionsWithSequence);
      campaignId = created.id;
      if (!campaignId) throw new Error("Instantly did not return campaign id");
      console.log(`[send] created campaign ${campaignId} with ${numSteps} steps`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`[send] createCampaign failed: ${msg}`);
      return NextResponse.json({ error: `Failed to create campaign in Instantly: ${msg}` }, { status: 500 });
    }

    const stepVariableNames = Array.from({ length: numSteps }, (_, i) => [
      `step${i + 1}_subject`,
      `step${i + 1}_body`,
    ]).flat();
    try {
      await client.addCampaignVariables(campaignId, stepVariableNames);
      console.log(`[send] registered variables: ${stepVariableNames.join(", ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.warn(`[send] addCampaignVariables failed (non-fatal): ${msg}`);
      // non-fatal — continue even if variable registration fails
    }

    const leadsPayload = leadsPassingAllSteps.map((l) => {
      const steps = getLeadSteps(l, numSteps);
      const custom_variables: Record<string, string> = {};
      steps.forEach((s, i) => {
        custom_variables[`step${i + 1}_subject`] = s.subject ?? "";
        custom_variables[`step${i + 1}_body`] = bodyWithLineBreaks(s.body ?? "").trim();
      });
      return {
        email: l.email,
        first_name: l.name?.split(/\s+/)[0] ?? null,
        last_name: l.name?.split(/\s+/).slice(1).join(" ") || null,
        company_name: l.company ?? null,
        custom_variables,
      };
    });

    // Filter out any leads with blank email (defensive)
    const validLeadsPayload = leadsPayload.filter((l) => l.email?.trim());
    console.log(`[send] uploading ${validLeadsPayload.length} leads to campaign ${campaignId} (${leadsPayload.length - validLeadsPayload.length} filtered for empty email)`);
    if (validLeadsPayload.length === 0) {
      return NextResponse.json({ error: "All leads have empty emails — cannot upload to Instantly." }, { status: 400 });
    }

    // Log sample lead for debugging
    const sample = validLeadsPayload[0];
    console.log(`[send] sample lead JSON: ${JSON.stringify({ email: sample.email, first_name: sample.first_name, company_name: sample.company_name, cv_keys: Object.keys(sample.custom_variables ?? {}), step1_subject: String(sample.custom_variables?.step1_subject ?? "").slice(0, 80) })}`);

    // Probe: try adding 1 lead without custom_variables to test if bare email is accepted
    try {
      const probe = await client.bulkAddLeadsToCampaign(campaignId, [{ email: sample.email, first_name: sample.first_name ?? null }], { verify_leads_on_import: false });
      console.log(`[send] probe (bare email): uploaded=${probe.leads_uploaded}, dupes=${probe.duplicated_leads}, blocklist=${probe.in_blocklist}`);
    } catch (probeErr) {
      console.error(`[send] probe (bare email) FAILED: ${probeErr instanceof Error ? probeErr.message : probeErr}`);
    }

    let addResult: { leads_uploaded: number; duplicated_leads: number; in_blocklist: number };
    try {
      addResult = await client.bulkAddLeadsToCampaign(campaignId, validLeadsPayload, {
        verify_leads_on_import: true,
      });
      console.log(`[send] bulkAddLeads result: uploaded=${addResult.leads_uploaded}, dupes=${addResult.duplicated_leads}, blocklist=${addResult.in_blocklist}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`[send] bulkAddLeadsToCampaign failed: ${msg}`);
      return NextResponse.json({
        error: `Instantly rejected leads: "${msg}". Campaign ${campaignId} was created but leads were not added. Common causes: all leads already in Instantly, blocklisted, or invalid emails.`,
        debug: { campaignId, leadsCount: validLeadsPayload.length, sampleEmail: sample.email },
      }, { status: 400 });
    }

    if (addResult.leads_uploaded === 0) {
      return NextResponse.json(
        {
          error: `Instantly accepted the leads but uploaded 0 — all ${validLeadsPayload.length} leads were blocked. Duplicates: ${addResult.duplicated_leads}, blocklisted: ${addResult.in_blocklist}. These leads may already be in another campaign. Try different leads or remove them from existing Instantly campaigns.`,
          validation: {
            numSteps,
            leadsSent: 0,
            duplicated_leads: addResult.duplicated_leads,
            in_blocklist: addResult.in_blocklist,
          },
        },
        { status: 400 }
      );
    }

    await client.activateCampaign(campaignId);
    await markAsSent(leadsPassingAllSteps.map((l) => l.id));

    await prisma.sentCampaign.create({
      data: {
        workspaceId: workspace.id,
        campaignId: flowCampaign?.id ?? null,
        leadBatchId: batch.id,
        instantlyCampaignId: campaignId,
        name: campaignName,
      },
    });
    await registerCampaignWebhooks(client, campaignId, webhookUrl, campaignName);
    if (flowCampaign?.id) {
      await prisma.campaign.update({ where: { id: flowCampaign.id }, data: { status: "launched", name: campaignName } });
    }

    await logActivity(workspace.id, "send",
      `Launched new campaign "${campaignName}" with ${addResult.leads_uploaded} leads`,
      { sent: addResult.leads_uploaded, duplicates: addResult.duplicated_leads, blocklisted: addResult.in_blocklist, instantlyCampaignId: campaignId });

    return NextResponse.json({
      success: true,
      campaignId,
      campaignName,
      leads_uploaded: addResult.leads_uploaded,
      duplicated_leads: addResult.duplicated_leads,
      in_blocklist: addResult.in_blocklist,
      validation: { numSteps, leadsSent: leadsPassingAllSteps.length, allStepsPassed: true },
      message: `Campaign "${campaignName}" created and activated. ${leadsPassingAllSteps.length} leads; each of ${numSteps} steps goes out as a separate email with 2–3 day gaps.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send to Instantly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
