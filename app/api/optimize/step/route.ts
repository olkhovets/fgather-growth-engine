import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { getInstantlyClientForWorkspaceId } from "@/lib/instantly";

/**
 * Decision agent: reads A/B campaign performance and decides whether to
 * wait, declare a winner, or kill underperformers and generate new variants.
 *
 * POST { abGroupId } — run the agent for one A/B group
 * GET              — scan all active A/B groups for this workspace and run the agent on any that have enough data
 *
 * Also called automatically by /api/cron/analytics after each analytics pull.
 */

const MIN_SENDS_FOR_DECISION = 100;

type AgentDecision =
  | { decision: "WAIT"; reason: string }
  | { decision: "DECLARE_WINNER"; winner: string; reason: string }
  | {
      decision: "KILL_AND_REGENERATE";
      reason: string;
      hypothesis: string;
      new_subject_a: string;
      new_subject_b: string;
    };

async function runDecisionAgent(
  workspaceId: string,
  abGroupId: string,
  anthropicKey: string,
  model: string
): Promise<{ abGroupId: string; decision: AgentDecision; acted: boolean }> {
  // Load both campaigns in the A/B group
  const campaigns = await prisma.sentCampaign.findMany({
    where: { workspaceId, abGroupId },
    select: { id: true, variant: true, instantlyCampaignId: true, leadBatchId: true, name: true },
  });

  if (campaigns.length < 2) {
    return {
      abGroupId,
      decision: { decision: "WAIT", reason: "Less than 2 campaigns in group." },
      acted: false,
    };
  }

  // Get latest performance observations for each campaign
  const getMetrics = async (sentCampaignId: string) => {
    const obs = await prisma.performanceObservation.findMany({
      where: { workspaceId, sourceType: "campaign", sourceId: sentCampaignId },
      select: { metric: true, value: true },
    });
    const byMetric: Record<string, number[]> = {};
    for (const o of obs) {
      if (!byMetric[o.metric]) byMetric[o.metric] = [];
      byMetric[o.metric].push(o.value);
    }
    const avg = (m: string) =>
      byMetric[m] ? byMetric[m].reduce((a, b) => a + b, 0) / byMetric[m].length : 0;
    const sum = (m: string) =>
      byMetric[m] ? byMetric[m].reduce((a, b) => a + b, 0) : 0;
    return {
      open_rate_pct: Math.round(avg("open_rate_pct") * 10) / 10,
      click_rate_pct: Math.round(avg("click_rate_pct") * 10) / 10,
      positive_replies: sum("positive_reply_count"),
    };
  };

  // Count sends per campaign by looking at leads with sentAt set for each variant
  const getLeadCount = async (leadBatchId: string | null, variant: string | null) => {
    if (!leadBatchId) return 0;
    return prisma.lead.count({
      where: { leadBatchId, abVariant: variant, sentAt: { not: null } },
    });
  };

  const metricsAndCounts = await Promise.all(
    campaigns.map(async (c) => ({
      ...c,
      metrics: await getMetrics(c.id),
      sends: await getLeadCount(c.leadBatchId ?? null, c.variant ?? null),
    }))
  );

  // Count remaining unsent leads
  const leadBatchId = campaigns[0].leadBatchId;
  const remainingLeads = leadBatchId
    ? await prisma.lead.count({ where: { leadBatchId, sentAt: null } })
    : 0;

  const campaignA = metricsAndCounts.find((c) => c.variant === "A");
  const campaignB = metricsAndCounts.find((c) => c.variant === "B");

  if (!campaignA || !campaignB) {
    return {
      abGroupId,
      decision: { decision: "WAIT", reason: "Could not find both variants." },
      acted: false,
    };
  }

  // Not enough data yet
  if (campaignA.sends < MIN_SENDS_FOR_DECISION || campaignB.sends < MIN_SENDS_FOR_DECISION) {
    return {
      abGroupId,
      decision: {
        decision: "WAIT",
        reason: `Not enough sends yet. A: ${campaignA.sends}, B: ${campaignB.sends}. Need ${MIN_SENDS_FOR_DECISION} each.`,
      },
      acted: false,
    };
  }

  // Build decision prompt
  const prompt = `You are an email campaign optimiser. Analyse this A/B test and decide what to do next.

Campaign A (name: "${campaignA.name}"):
  Sends: ${campaignA.sends}
  Open rate: ${campaignA.metrics.open_rate_pct}%
  Click rate: ${campaignA.metrics.click_rate_pct}%
  Positive replies: ${campaignA.metrics.positive_replies}

Campaign B (name: "${campaignB.name}"):
  Sends: ${campaignB.sends}
  Open rate: ${campaignB.metrics.open_rate_pct}%
  Click rate: ${campaignB.metrics.click_rate_pct}%
  Positive replies: ${campaignB.metrics.positive_replies}

Remaining uncontacted leads: ${remainingLeads}

Decide one of:
1. WAIT — the data is inconclusive or sample is too small for confidence
2. DECLARE_WINNER — one variant is clearly better (≥3% open rate gap OR ≥2 positive reply difference); route remaining leads to the winner
3. KILL_AND_REGENERATE — both variants are underperforming (open rate < 10% AND positive replies = 0 for both); generate a fresh approach

If DECLARE_WINNER, set "winner" to "A" or "B".
If KILL_AND_REGENERATE, provide:
  - "hypothesis": what angle to try next and why (1-2 sentences)
  - "new_subject_a": a new subject line for variant A
  - "new_subject_b": a new subject line for variant B (different angle from A)

Respond with ONLY valid JSON — no markdown, no preamble:
{ "decision": "WAIT"|"DECLARE_WINNER"|"KILL_AND_REGENERATE", "reason": "...", ...fields }`;

  let agentDecision: AgentDecision;
  try {
    const { text } = await callAnthropic(anthropicKey, prompt, { maxTokens: 600, model });
    const jsonStr = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    agentDecision = JSON.parse(jsonStr) as AgentDecision;
  } catch (err) {
    return {
      abGroupId,
      decision: {
        decision: "WAIT",
        reason: `Agent parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
      acted: false,
    };
  }

  // Act on the decision
  if (agentDecision.decision === "WAIT") {
    return { abGroupId, decision: agentDecision, acted: false };
  }

  if (agentDecision.decision === "DECLARE_WINNER" && remainingLeads > 0 && leadBatchId) {
    const winner = agentDecision.winner;
    const winnerCampaign = metricsAndCounts.find((c) => c.variant === winner);
    if (!winnerCampaign) return { abGroupId, decision: agentDecision, acted: false };

    // Fetch uncontacted leads and add them to the winning Instantly campaign
    const ctx = await getInstantlyClientForWorkspaceId(workspaceId);
    if (ctx) {
      const uncontacted = await prisma.lead.findMany({
        where: { leadBatchId, sentAt: null },
        select: {
          id: true,
          email: true,
          name: true,
          company: true,
          stepsJson: true,
          step1Subject: true,
          step1Body: true,
        },
        take: 500,
      });

      if (uncontacted.length > 0) {
        const leadsPayload = uncontacted.map((l) => {
          let steps: Array<{ subject: string; body: string }> = [];
          try {
            steps = l.stepsJson ? JSON.parse(l.stepsJson) : [];
          } catch {
            steps = [];
          }
          const step1Subject = steps[0]?.subject || l.step1Subject || "";
          const custom_variables: Record<string, string> = {};
          steps.forEach((s, i) => {
            custom_variables[`step${i + 1}_subject`] = i === 0 ? step1Subject : `Re: ${step1Subject}`;
            custom_variables[`step${i + 1}_body`] = (s.body ?? "").replace(/\n/g, "<br>");
          });
          return {
            email: l.email,
            first_name: l.name?.split(/\s+/)[0] ?? null,
            last_name: l.name?.split(/\s+/).slice(1).join(" ") || null,
            company_name: l.company ?? null,
            custom_variables,
          };
        });

        try {
          await ctx.client.bulkAddLeadsToCampaign(
            winnerCampaign.instantlyCampaignId,
            leadsPayload,
            { verify_leads_on_import: false }
          );
          await prisma.lead.updateMany({
            where: { id: { in: uncontacted.map((l) => l.id) } },
            data: { sentAt: new Date(), abVariant: winner },
          });
        } catch (err) {
          console.error(
            "[optimize] bulkAdd to winner campaign failed:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    return { abGroupId, decision: agentDecision, acted: true };
  }

  // KILL_AND_REGENERATE — record decision; user regenerates sequences with new hypothesis
  return { abGroupId, decision: agentDecision, acted: false };
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { abGroupId } = (await request.json()) as { abGroupId?: string };
    if (!abGroupId) {
      return NextResponse.json({ error: "abGroupId required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, anthropicKey: true, anthropicModel: true },
    });
    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    const anthropicKey = decrypt(workspace.anthropicKey);
    const model = workspace.anthropicModel ?? "claude-haiku-4-5";

    const result = await runDecisionAgent(workspace.id, abGroupId, anthropicKey, model);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    // Allow cron to call this without a session (uses CRON_SECRET)
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = request.headers.get("authorization");
      if (auth === `Bearer ${secret}`) {
        // Cron-authenticated: scan all workspaces
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const allGroups = await prisma.sentCampaign.findMany({
          where: { abGroupId: { not: null }, createdAt: { gte: since } },
          select: { abGroupId: true, workspaceId: true },
          distinct: ["abGroupId"],
        });

        const results = await Promise.all(
          allGroups
            .filter((g): g is { abGroupId: string; workspaceId: string } => g.abGroupId !== null)
            .map(async (g) => {
              const ws = await prisma.workspace.findUnique({
                where: { id: g.workspaceId },
                select: { anthropicKey: true, anthropicModel: true },
              });
              if (!ws?.anthropicKey) return null;
              const key = decrypt(ws.anthropicKey);
              const model = ws.anthropicModel ?? "claude-haiku-4-5";
              return runDecisionAgent(g.workspaceId, g.abGroupId, key, model);
            })
        );

        return NextResponse.json({ results: results.filter(Boolean), total: results.length });
      }
    }

    // Otherwise require session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, anthropicKey: true, anthropicModel: true },
    });
    if (!workspace?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }

    const anthropicKey = decrypt(workspace.anthropicKey);
    const model = workspace.anthropicModel ?? "claude-haiku-4-5";

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const groups = await prisma.sentCampaign.findMany({
      where: {
        workspaceId: workspace.id,
        abGroupId: { not: null },
        createdAt: { gte: since },
      },
      select: { abGroupId: true },
      distinct: ["abGroupId"],
    });

    const results = await Promise.all(
      groups
        .filter((g): g is { abGroupId: string } => g.abGroupId !== null)
        .map((g) => runDecisionAgent(workspace.id, g.abGroupId, anthropicKey, model))
    );

    return NextResponse.json({ results, total: results.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
