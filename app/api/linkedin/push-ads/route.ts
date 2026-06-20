import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { logActivity } from "@/lib/activity";
import { generateLinkedInAdRows, pushRowsToSheet } from "@/lib/linkedin-ads-gen";

export const dynamic = "force-dynamic";

/**
 * FORWARD PIPE endpoint — generate LinkedIn ad rows from the workspace's winning
 * email signals and (optionally) append them to the ad-drafter's Google Sheet.
 *
 * POST (operator, authenticated):
 *   body: { count?, destinationUrl?, includeLeadGen?, push? }
 *   Always returns the generated rows. Appends to the sheet only when push=true
 *   AND LINKEDIN_SHEET_APPEND_URL is configured (otherwise it's a safe dry run).
 *
 * GET (cron): same generation for every workspace with an Anthropic key, guarded
 *   by CRON_SECRET. Pushes to the sheet when configured. Lets the twice-daily
 *   agent keep fresh, on-trend ad drafts flowing without manual work.
 */
async function runForWorkspace(
  ws: { id: string; anthropicKey: string | null; anthropicModel: string | null },
  opts: { count?: number; destinationUrl?: string; includeLeadGen?: boolean; push: boolean }
) {
  if (!ws.anthropicKey) return { workspaceId: ws.id, error: "no anthropic key" };
  const { rows, signals } = await generateLinkedInAdRows(
    ws.id,
    decrypt(ws.anthropicKey),
    ws.anthropicModel ?? "claude-haiku-4-5",
    { count: opts.count, destinationUrl: opts.destinationUrl, includeLeadGen: opts.includeLeadGen }
  );
  const push = opts.push ? await pushRowsToSheet(rows) : { appended: 0, dryRun: true as const };
  await logActivity(
    ws.id,
    "info",
    `LinkedIn forward pipe: generated ${rows.length} ad row(s)${push.appended ? `, appended ${push.appended} to sheet` : push.dryRun ? " (dry run, sheet not wired)" : ""}.`,
    { rows: rows.map((r) => ({ ad_name: r.ad_name, ad_type: r.ad_type, persona: r.source_persona, note: r.source_note })), usedSignals: { angles: signals.winningAngles.length, personas: signals.bestPersonas, incentive: signals.incentive } }
  );
  return { workspaceId: ws.id, rows, push };
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ws = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, anthropicKey: true, anthropicModel: true },
    });
    if (!ws?.anthropicKey) {
      return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      count?: number; destinationUrl?: string; includeLeadGen?: boolean; push?: boolean;
    };
    const result = await runForWorkspace(ws, {
      count: body.count,
      destinationUrl: body.destinationUrl,
      includeLeadGen: body.includeLeadGen,
      push: body.push === true,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const workspaces = await prisma.workspace.findMany({
    where: { anthropicKey: { not: null } },
    select: { id: true, anthropicKey: true, anthropicModel: true },
  });
  const results = [];
  for (const ws of workspaces) {
    try {
      results.push(await runForWorkspace(ws, { push: true }));
    } catch (err) {
      results.push({ workspaceId: ws.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
