import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/instantly/sent-campaigns/[id]/test
 * Body: { testEmail: string }
 * Creates a separate test campaign with minute-based delays so all emails arrive within minutes.
 * Uses a lead that has step content from this campaign's batch.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sentId } = await params;
    if (!sentId) {
      return NextResponse.json({ error: "Sent campaign id required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const testEmail = typeof body.testEmail === "string" ? body.testEmail.trim() : "";
    if (!testEmail || !testEmail.includes("@")) {
      return NextResponse.json({ error: "Valid testEmail is required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const sent = await prisma.sentCampaign.findFirst({
      where: { id: sentId, workspaceId: workspace.id },
      include: {
        leadBatch: {
          include: {
            leads: {
              select: {
                id: true,
                email: true,
                step1Subject: true,
                step1Body: true,
                step2Subject: true,
                step2Body: true,
                step3Subject: true,
                step3Body: true,
                stepsJson: true,
              },
              orderBy: { createdAt: "asc" },
              take: 500,
            },
          },
        },
      },
    });

    if (!sent) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const leads = sent.leadBatch?.leads ?? [];
    if (leads.length === 0) {
      return NextResponse.json({ error: "No leads in this campaign" }, { status: 400 });
    }

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured. Add it in Settings." },
        { status: 400 }
      );
    }

    type LeadRow = (typeof leads)[0];
    const getSteps = (lead: LeadRow): Array<{ subject: string; body: string }> => {
      if (lead.stepsJson) {
        try {
          const arr = JSON.parse(lead.stepsJson) as Array<{ subject?: string; body?: string }>;
          if (Array.isArray(arr) && arr.length > 0) {
            return arr.map((s) => ({ subject: s.subject ?? "", body: s.body ?? "" }));
          }
        } catch {
          //
        }
      }
      return [
        { subject: lead.step1Subject ?? "", body: lead.step1Body ?? "" },
        { subject: lead.step2Subject ?? "", body: lead.step2Body ?? "" },
        { subject: lead.step3Subject ?? "", body: lead.step3Body ?? "" },
      ].filter((s) => (s.subject ?? "").trim() || (s.body ?? "").trim());
    };

    const templateLead = leads.find((l) => getSteps(l).length > 0);
    if (!templateLead) {
      return NextResponse.json(
        { error: "No leads in this campaign have email content (all have blank subject/body). There’s nothing to send as a test." },
        { status: 400 }
      );
    }

    const steps = getSteps(templateLead);

    const MIN_SUBJECT_LENGTH = 10;
    const MIN_BODY_LENGTH = 50;
    for (let i = 0; i < steps.length; i++) {
      const subj = (steps[i]?.subject ?? "").trim();
      const body = (steps[i]?.body ?? "").trim();
      if (subj.length < MIN_SUBJECT_LENGTH || body.length < MIN_BODY_LENGTH) {
        return NextResponse.json(
          { error: `Step ${i + 1} has insufficient content (subject ≥10 chars, body ≥50 chars). Regenerate sequences.` },
          { status: 400 }
        );
      }
    }

    const bodyWithLineBreaks = (text: string) =>
      (text ?? "").replace(/\r\n/g, "\n").replace(/\n/g, "<br>\n");

    const custom_variables: Record<string, string> = {};
    steps.forEach((s, i) => {
      custom_variables[`step${i + 1}_subject`] = s.subject ?? "";
      custom_variables[`step${i + 1}_body`] = bodyWithLineBreaks(s.body ?? "").trim();
    });

    // Create a separate test campaign with 2-min delays so all emails arrive within minutes
    const sequenceSteps = steps.map((_, i) => ({
      subject: `{{step${i + 1}_subject}}`,
      body: `{{step${i + 1}_body}}`,
      delayDays: i === 0 ? 0 : 2,
    }));

    const campaignName = `[TEST] ${sent.name}`;
    const created = await ctx.client.createCampaign(campaignName, {
      sequenceSteps,
      delayUnit: "minutes",
    });
    const campaignId = created.id;
    if (!campaignId) {
      return NextResponse.json({ error: "Instantly did not return campaign id" }, { status: 500 });
    }

    const stepVariableNames = steps.map((_, i) => [`step${i + 1}_subject`, `step${i + 1}_body`]).flat();
    await ctx.client.addCampaignVariables(campaignId, stepVariableNames);

    await ctx.client.bulkAddLeadsToCampaign(
      campaignId,
      [
        {
          email: testEmail,
          first_name: "Test",
          last_name: "Lead",
          company_name: "Test",
          custom_variables,
        },
      ],
      { verify_leads_on_import: false }
    );

    await ctx.client.activateCampaign(campaignId);

    return NextResponse.json({
      success: true,
      testEmail,
      message: `Test campaign created and activated. Emails will send when Instantly's schedule allows (Mon–Fri, 9am–5pm in campaign timezone). Check your Instantly dashboard for the [TEST] campaign, and your inbox (including spam).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add test lead";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
