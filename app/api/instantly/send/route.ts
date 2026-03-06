import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";
import { prisma } from "@/lib/prisma";
import { parsePlaybook, getSequenceSteps } from "@/lib/playbook";

/**
 * Create campaign(s), apply ramp, add leads, activate.
 * Body: { batchId: string, abTest?: boolean, subjectLineA?: string, subjectLineB?: string }
 * When abTest is true, subjectLineA and subjectLineB are required; creates two campaigns (A/B) and assigns leads 50/50.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { batchId, abTest, subjectLineA, subjectLineB, campaignName: campaignNameInput, accountEmails, campaignId: flowCampaignId, skipFailingLeads } = body as {
      batchId?: string;
      abTest?: boolean;
      subjectLineA?: string;
      subjectLineB?: string;
      campaignName?: string;
      accountEmails?: string[];
      campaignId?: string;
      skipFailingLeads?: boolean;
    };
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }
    const campaignNameTrimmed = campaignNameInput?.trim();
    if (!campaignNameTrimmed) {
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
      where: { userId: session.user.id },
      select: { id: true, playbookApproved: true, playbookJson: true },
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

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      include: { leads: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    if (batch.leads.length === 0) {
      return NextResponse.json({ error: "Batch has no leads" }, { status: 400 });
    }

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured. Add it in onboarding." },
        { status: 400 }
      );
    }

    const { client } = ctx;

    try {
      await client.applyRampForUnwarmedAccounts({
        unwarmedDailyLimit: 5,
        warmedDailyLimit: 30,
        ...(selectedEmails != null && selectedEmails.length > 0 && { accountEmails: selectedEmails }),
      });
    } catch (rampErr) {
      // Non-fatal: ramp application failing (e.g. invalid/expired Instantly key for account patch)
      // should not block campaign creation. Log and continue.
      console.warn("[send] applyRampForUnwarmedAccounts failed (non-fatal):", rampErr instanceof Error ? rampErr.message : rampErr);
    }

    const baseName = campaignNameTrimmed;

    // Ensure email body line breaks render in Instantly (plain \n -> <br> for HTML)
    const bodyWithLineBreaks = (text: string) =>
      (text ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\n/g, "<br>\n");

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
    const leadsPassingAllSteps = batch.leads.filter((l) => {
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

    const campaignOptionsWithSequence = {
      ...(selectedEmails != null && selectedEmails.length > 0 ? { email_list: selectedEmails } : {}),
      ...(sequenceSteps.length > 0 ? { sequenceSteps } : {}),
      delayUnit: "days" as const,
    };

    if (abTest) {
      // A/B: assign leads 50/50, create two campaigns, record with abGroupId
      const abGroupId = `ab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const leadsA: typeof leadsPassingAllSteps = [];
      const leadsB: typeof leadsPassingAllSteps = [];
      leadsPassingAllSteps.forEach((l, i) => {
        if (i % 2 === 0) leadsA.push(l);
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
          verify_leads_on_import: false,
        }),
        client.bulkAddLeadsToCampaign(idB, toPayload(leadsB, subjectLineB!.trim()), {
          verify_leads_on_import: false,
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
    const created = await client.createCampaign(campaignName, campaignOptionsWithSequence);
    const campaignId = created.id;
    if (!campaignId) {
      return NextResponse.json({ error: "Instantly did not return campaign id" }, { status: 500 });
    }

    const stepVariableNames = Array.from({ length: numSteps }, (_, i) => [
      `step${i + 1}_subject`,
      `step${i + 1}_body`,
    ]).flat();
    await client.addCampaignVariables(campaignId, stepVariableNames);

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

    const addResult = await client.bulkAddLeadsToCampaign(campaignId, leadsPayload, {
      verify_leads_on_import: false,
    });

    if (addResult.leads_uploaded === 0) {
      return NextResponse.json(
        {
          error: `No leads were uploaded to Instantly — all ${leadsPassingAllSteps.length} leads were either duplicates (already in a campaign) or blocklisted. The campaign was created but not activated. Remove duplicates or use different leads.`,
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

    await prisma.sentCampaign.create({
      data: {
        workspaceId: workspace.id,
        campaignId: flowCampaign?.id ?? null,
        leadBatchId: batch.id,
        instantlyCampaignId: campaignId,
        name: campaignName,
      },
    });
    if (flowCampaign?.id) {
      await prisma.campaign.update({ where: { id: flowCampaign.id }, data: { status: "launched", name: campaignName } });
    }

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
