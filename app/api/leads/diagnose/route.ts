import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leads/diagnose?batchId=...
 * Returns a breakdown of what's wrong with leads so the UI can show a specific error.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

  const workspace = await prisma.workspace.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const batch = await prisma.leadBatch.findFirst({
    where: { id: batchId, workspaceId: workspace.id },
    include: {
      leads: {
        select: {
          id: true, email: true,
          stepsJson: true,
          step1Subject: true, step1Body: true,
          step2Subject: true, step2Body: true,
          step3Subject: true, step3Body: true,
        },
      },
    },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const total = batch.leads.length;
  let noSequence = 0;
  let hasSequence = 0;
  const stepIssues: Record<string, { shortSubject: number; shortBody: number }> = {};
  const sampleProblems: string[] = [];

  for (const lead of batch.leads) {
    let steps: Array<{ subject?: string; body?: string }> = [];
    try {
      if (lead.stepsJson) steps = JSON.parse(lead.stepsJson) as Array<{ subject?: string; body?: string }>;
    } catch { steps = []; }

    const hasAnyContent = steps.length > 0 || lead.step1Body;
    if (!hasAnyContent) {
      noSequence++;
      if (sampleProblems.length < 5) sampleProblems.push(`${lead.email}: no sequence generated`);
      continue;
    }

    hasSequence++;
    const checkSteps = steps.length > 0 ? steps : [
      { subject: lead.step1Subject ?? "", body: lead.step1Body ?? "" },
      { subject: lead.step2Subject ?? "", body: lead.step2Body ?? "" },
      { subject: lead.step3Subject ?? "", body: lead.step3Body ?? "" },
    ];

    checkSteps.forEach((s, i) => {
      const key = `step${i + 1}`;
      if (!stepIssues[key]) stepIssues[key] = { shortSubject: 0, shortBody: 0 };
      const subj = (s.subject ?? "").trim();
      const body = (s.body ?? "").trim();
      if (subj.length < 10) {
        stepIssues[key].shortSubject++;
        if (sampleProblems.length < 10) sampleProblems.push(`${lead.email} ${key}: subject too short ("${subj.slice(0, 40)}", ${subj.length} chars)`);
      }
      if (body.length < 50) {
        stepIssues[key].shortBody++;
        if (sampleProblems.length < 10) sampleProblems.push(`${lead.email} ${key}: body too short (${body.length} chars)`);
      }
    });
  }

  const hasQualityIssues = Object.values(stepIssues).some(s => s.shortSubject > 0 || s.shortBody > 0);

  return NextResponse.json({
    total,
    noSequence,
    hasSequence,
    stepIssues,
    sampleProblems,
    verdict: noSequence === total
      ? `No sequences generated yet — ${total} leads need sequences. Go back to Sequences and run Generate.`
      : noSequence > 0
      ? `${noSequence}/${total} leads are missing sequences — re-run Generate to fill the gaps.`
      : hasQualityIssues
      ? `All leads have sequences but some fail quality check (subject ≥10 chars, body ≥50 chars). Re-generate or use Skip failing leads.`
      : `Sequences look fine — the issue may be Instantly blocklist or duplicate leads already in a campaign.`,
  });
}
