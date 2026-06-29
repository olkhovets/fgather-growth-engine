import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeEmail, PASS_THRESHOLD } from "@/lib/email-grader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Are the emails good?" for leads ALREADY generated (the recycle pool, a batch, the queue).
 * Grades step 1 of each lead deterministically against the research rubric and returns the
 * distribution + the worst offenders with their specific fixes. Read-only — no sends, no spends.
 *
 * Query: ?batchId=... (optional, scope to one batch) & ?limit=200 (default 200, max 1000)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Dual auth: operator session (dashboard) OR CRON_SECRET (CLI / loop), like the other loop routes.
  const secret = process.env.CRON_SECRET;
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const viaCron = !!secret && bearer === secret;

  let workspace: { id: string } | null = null;
  if (viaCron) {
    const wsId = url.searchParams.get("workspaceId");
    workspace = wsId
      ? await prisma.workspace.findUnique({ where: { id: wsId }, select: { id: true } })
      : await prisma.workspace.findFirst({ select: { id: true } }); // single-tenant default
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    workspace = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  }
  if (!workspace) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const batchId = url.searchParams.get("batchId");
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 200));

  const leads = await prisma.lead.findMany({
    where: {
      leadBatch: { workspaceId: workspace.id, ...(batchId ? { id: batchId } : {}) },
      step1Subject: { not: null },
      step1Body: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, company: true, email: true, emailStyle: true, step1Subject: true, step1Body: true },
  });

  if (leads.length === 0) {
    return NextResponse.json({ count: 0, message: "No generated leads to grade yet." });
  }

  const graded = leads.map((l) => {
    const g = gradeEmail({ subject: l.step1Subject ?? "", body: l.step1Body ?? "" });
    return { id: l.id, company: l.company, email: l.email, style: l.emailStyle, score: g.score, pass: g.pass, hardFail: g.hardFail, topIssues: g.issues.slice(0, 3), fixes: g.fixes.slice(0, 3) };
  });

  const scores = graded.map((g) => g.score);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const passed = graded.filter((g) => g.pass).length;

  // Average score per style — shows which styles are producing the best copy.
  const byStyle: Record<string, { count: number; avg: number; pass: number }> = {};
  for (const g of graded) {
    const k = g.style ?? "unknown";
    const b = (byStyle[k] ||= { count: 0, avg: 0, pass: 0 });
    b.count += 1; b.avg += g.score; b.pass += g.pass ? 1 : 0;
  }
  for (const k of Object.keys(byStyle)) byStyle[k].avg = Math.round(byStyle[k].avg / byStyle[k].count);

  return NextResponse.json({
    count: graded.length,
    passThreshold: PASS_THRESHOLD,
    avgScore: avg,
    passRate: Math.round((passed / graded.length) * 100),
    distribution: {
      excellent: scores.filter((s) => s >= 85).length,
      good: scores.filter((s) => s >= PASS_THRESHOLD && s < 85).length,
      weak: scores.filter((s) => s >= 50 && s < PASS_THRESHOLD).length,
      bad: scores.filter((s) => s < 50).length,
    },
    byStyle,
    worst: graded.sort((a, b) => a.score - b.score).slice(0, 15),
  });
}
