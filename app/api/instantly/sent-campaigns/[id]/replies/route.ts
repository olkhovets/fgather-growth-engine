import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { recordReplyObservation } from "@/lib/performance-memory";

export const dynamic = "force-dynamic";

const CLASSIFICATIONS = ["positive", "objection", "ooo", "not_interested", "other"] as const;

/** GET: List replies for a sent campaign. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Campaign id required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const sent = await prisma.sentCampaign.findFirst({
      where: { id, workspaceId: workspace.id },
      include: { replies: { orderBy: { createdAt: "desc" } } },
    });
    if (!sent) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json({ replies: sent.replies });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list replies";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST: Add a reply (e.g. pasted from inbox), classify with Claude, and store. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Campaign id required" }, { status: 400 });
    }

    const body = await request.json();
    const { fromEmail, subject, body: bodyText } = body as { fromEmail?: string; subject?: string; body?: string };

    if (!fromEmail || typeof fromEmail !== "string" || !fromEmail.trim()) {
      return NextResponse.json({ error: "fromEmail is required" }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const sent = await prisma.sentCampaign.findFirst({
      where: { id, workspaceId: workspace.id },
    });
    if (!sent) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const subjectStr = typeof subject === "string" ? subject.trim() : "";
    const bodySnippet = typeof bodyText === "string" ? bodyText.trim().slice(0, 500) : "";

    let classification: string | null = null;

    if (workspace.anthropicKey) {
      try {
        const key = decrypt(workspace.anthropicKey);
        const prompt = `Classify this cold outreach reply into exactly one category: positive, objection, ooo, not_interested, other.

Reply from: ${fromEmail}
Subject: ${subjectStr}
Body:
${bodySnippet || "(empty)"}

Respond with ONLY one word: positive, objection, ooo, not_interested, or other.`;
        const { text } = await callAnthropic(key, prompt, { maxTokens: 20 });
        const word = text.trim().toLowerCase();
        if (CLASSIFICATIONS.includes(word as (typeof CLASSIFICATIONS)[number])) {
          classification = word;
        } else {
          classification = "other";
        }
      } catch {
        classification = "other";
      }
    }

    const reply = await prisma.campaignReply.create({
      data: {
        sentCampaignId: sent.id,
        fromEmail: fromEmail.trim(),
        subject: subjectStr || null,
        bodySnippet: bodySnippet || null,
        classification,
      },
    });

    await recordReplyObservation(workspace.id, reply.id, fromEmail.trim(), classification).catch(() => {});

    return NextResponse.json({ reply, message: "Reply logged and classified." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add reply";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
