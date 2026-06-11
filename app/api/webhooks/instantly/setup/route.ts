import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET: return (and lazily create) the Instantly reply-webhook URL for this
 * workspace. Paste the returned URL into Instantly → Settings → Webhooks
 * for the "Reply received" event.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, webhookSecret: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let secret = workspace.webhookSecret;
    if (!secret) {
      secret = crypto.randomBytes(24).toString("hex");
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { webhookSecret: secret },
      });
    }

    const baseUrl =
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhooks/instantly?secret=${secret}`;

    // We can't know if the user pasted the URL into Instantly, but receiving any
    // reply event proves the wiring works. This is the real "is it live?" signal —
    // and the learning loop's positive-reply signal depends entirely on it.
    const [repliesReceived, positiveReplies] = await Promise.all([
      prisma.campaignReply.count({ where: { sentCampaign: { workspaceId: workspace.id } } }),
      prisma.campaignReply.count({ where: { sentCampaign: { workspaceId: workspace.id }, classification: "positive" } }),
    ]);

    return NextResponse.json({
      webhookUrl,
      event: "Reply received",
      instructions:
        "In Instantly: Settings → Webhooks → New Webhook. Set the event to 'Reply received' (or 'Email replied') and paste this URL.",
      repliesReceived,
      positiveReplies,
      configured: repliesReceived > 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to set up webhook";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
