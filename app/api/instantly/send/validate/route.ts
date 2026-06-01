import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePlaybook } from "@/lib/playbook";

export const dynamic = "force-dynamic";

const MIN_SUBJECT_LENGTH = 10;
const MIN_BODY_LENGTH = 50;

/**
 * GET /api/instantly/send/validate?batchId=...&campaignId=...
 * Returns per-step validation so UI can show "Email 1: ✓ Passed", "Email 2: ✗ N failed", etc.
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const campaignIdParam = searchParams.get("campaignId");

    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, playbookJson: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let playbookSource: string | null = workspace.playbookJson;
    if (campaignIdParam) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignIdParam, workspaceId: workspace.id },
        select: { playbookJson: true },
      });
      if (campaign?.playbookJson) playbookSource = campaign.playbookJson;
    }

    const parsed = parsePlaybook(playbookSource);
    const numSteps = parsed?.numSteps ?? 3;

    const batch = await prisma.leadBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      include: { leads: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    type LeadWithSteps = (typeof batch.leads)[0] & { stepsJson?: string | null };
    const getLeadSteps = (lead: LeadWithSteps, n: number): Array<{ subject: string; body: string }> => {
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
      for (let i = 0; i < n; i++) {
        const s = arr[i] ?? legacy[i] ?? { subject: "", body: "" };
        steps.push({ subject: s.subject ?? "", body: s.body ?? "" });
      }
      return steps;
    };

    // Leads with zero content (never generated or empty)
    const leadsWithNoContent = batch.leads.filter((l) => {
      const steps = getLeadSteps(l as LeadWithSteps, numSteps);
      const hasAny = steps.some((s) => (s.subject ?? "").trim().length > 0 || (s.body ?? "").trim().length > 0);
      return !hasAny;
    });

    type StepFail = { leadEmail: string; stepIndex: number; reason: string };
    const stepFails: StepFail[] = [];
    const leadsPassingAllSteps = batch.leads.filter((l) => {
      const steps = getLeadSteps(l as LeadWithSteps, numSteps);
      for (let i = 0; i < steps.length; i++) {
        const subj = (steps[i]?.subject ?? "").trim();
        const body = (steps[i]?.body ?? "").trim();
        if (subj.length < MIN_SUBJECT_LENGTH) {
          stepFails.push({ leadEmail: l.email, stepIndex: i + 1, reason: `subject too short (${subj.length} chars)` });
          return false;
        }
        if (body.length < MIN_BODY_LENGTH) {
          stepFails.push({ leadEmail: l.email, stepIndex: i + 1, reason: `body too short (${body.length} chars)` });
          return false;
        }
      }
      return true;
    });

    const failsByStep = new Map<number, StepFail[]>();
    stepFails.forEach((f) => {
      const list = failsByStep.get(f.stepIndex) ?? [];
      list.push(f);
      failsByStep.set(f.stepIndex, list);
    });

    const steps = Array.from({ length: numSteps }, (_, i) => {
      const stepNum = i + 1;
      const failures = failsByStep.get(stepNum) ?? [];
      const passed = leadsPassingAllSteps.length;
      const failed = failures.length;
      return {
        step: stepNum,
        passed,
        failed,
        passedAllLeads: failed === 0,
        sampleFailures: failures.slice(0, 5).map((f) => `${f.leadEmail}: ${f.reason}`),
      };
    });

    return NextResponse.json({
      numSteps,
      totalLeads: batch.leads.length,
      leadsWithNoContent: leadsWithNoContent.length,
      leadsPassingAllSteps: leadsPassingAllSteps.length,
      canSend: leadsPassingAllSteps.length === batch.leads.length && batch.leads.length > 0,
      steps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
