import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";
import { prisma } from "@/lib/prisma";
import { parsePlaybook } from "@/lib/playbook";

export const dynamic = "force-dynamic";

const MIN_SUBJECT_LENGTH = 10;
const MIN_BODY_LENGTH = 50;

/**
 * POST /api/instantly/send/test
 * Body: { batchId: string, campaignName: string, testEmail: string, campaignId?: string }
 * Creates the same multi-step campaign in Instantly and adds ONE lead (test email) with the first lead's content.
 * Sends the real sequence to the test email so you can verify each step arrives as a separate email.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { batchId, campaignName: campaignNameInput, testEmail, campaignId: flowCampaignId } = body as {
      batchId?: string;
      campaignName?: string;
      testEmail?: string;
      campaignId?: string;
    };

    const testEmailTrimmed = typeof testEmail === "string" ? testEmail.trim() : "";
    if (!testEmailTrimmed || !testEmailTrimmed.includes("@")) {
      return NextResponse.json({ error: "Valid testEmail is required" }, { status: 400 });
    }
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }
    const campaignNameTrimmed = campaignNameInput?.trim();
    if (!campaignNameTrimmed) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, playbookJson: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let flowCampaign: { id: string; playbookJson: string | null } | null = null;
    if (flowCampaignId) {
      flowCampaign = (await prisma.campaign.findFirst({
        where: { id: flowCampaignId, workspaceId: workspace.id },
        select: { id: true, playbookJson: true },
      })) as { id: string; playbookJson: string | null } | null;
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
        { error: "Instantly API key not configured. Add it in Settings." },
        { status: 400 }
      );
    }

    const { client } = ctx;

    const bodyWithLineBreaks = (text: string) =>
      (text ?? "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>\n");

    const playbookSource = flowCampaign?.playbookJson ?? workspace.playbookJson;
    const parsed = parsePlaybook(playbookSource);
    const numStepsFromPlaybook = parsed?.numSteps ?? 3;

    // Test campaign: 2 min between each step so all emails arrive within minutes
    const sequenceSteps = Array.from({ length: numStepsFromPlaybook }, (_, i) => ({
      subject: `{{step${i + 1}_subject}}`,
      body: `{{step${i + 1}_body}}`,
      delayDays: i === 0 ? 0 : 2,
    }));

    type LeadWithSteps = (typeof batch.leads)[0] & { stepsJson?: string | null };
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

    const numSteps = numStepsFromPlaybook;
    const firstLead = batch.leads[0] as LeadWithSteps;
    const steps = getLeadSteps(firstLead, numSteps);

    for (let i = 0; i < steps.length; i++) {
      const subj = (steps[i]?.subject ?? "").trim();
      const body = (steps[i]?.body ?? "").trim();
      if (subj.length < MIN_SUBJECT_LENGTH || body.length < MIN_BODY_LENGTH) {
        return NextResponse.json(
          { error: `Step ${i + 1} of the first lead has insufficient content (subject ≥10, body ≥50 chars). Generate sequences first.` },
          { status: 400 }
        );
      }
    }

    const campaignName = `[TEST] ${campaignNameTrimmed}`;
    const created = await client.createCampaign(campaignName, {
      sequenceSteps,
      delayUnit: "minutes",
    });
    const campaignId = created.id;
    if (!campaignId) {
      return NextResponse.json({ error: "Instantly did not return campaign id" }, { status: 500 });
    }

    const stepVariableNames = Array.from({ length: numSteps }, (_, i) => [
      `step${i + 1}_subject`,
      `step${i + 1}_body`,
    ]).flat();
    await client.addCampaignVariables(campaignId, stepVariableNames);

    const custom_variables: Record<string, string> = {};
    steps.forEach((s, i) => {
      custom_variables[`step${i + 1}_subject`] = s.subject ?? "";
      custom_variables[`step${i + 1}_body`] = bodyWithLineBreaks(s.body ?? "").trim();
    });

    await client.bulkAddLeadsToCampaign(
      campaignId,
      [
        {
          email: testEmailTrimmed,
          first_name: "Test",
          last_name: "Lead",
          company_name: "Test",
          custom_variables,
        },
      ],
      { verify_leads_on_import: false }
    );

    await client.activateCampaign(campaignId);

    return NextResponse.json({
      success: true,
      campaignId,
      campaignName,
      testEmail: testEmailTrimmed,
      numSteps,
      message: `Test campaign created and activated. Emails will send when Instantly's schedule allows (Mon–Fri, 9am–5pm). Check your Instantly dashboard for the [TEST] campaign, and your inbox (including spam).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Test send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
