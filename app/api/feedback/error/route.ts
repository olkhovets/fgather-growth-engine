import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendErrorNotificationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const context = typeof body.context === "string" ? body.context.trim() : "Unknown";
    const error = typeof body.error === "string" ? body.error : String(body.error ?? "Unknown error");
    const extra = body.extra && typeof body.extra === "object" ? body.extra as Record<string, unknown> : undefined;

    const userEmail = session.user.email ?? "unknown";
    const userId = session.user.id;

    // Persist to DB so we can follow up when a fix is deployed
    await prisma.errorReport.create({
      data: {
        userId,
        userEmail,
        context,
        error,
        extraJson: extra ? JSON.stringify(extra) : null,
      },
    });

    // Send alert email to mayank@gatherhq.com
    await sendErrorNotificationEmail(context, error, {
      ...extra,
      userEmail,
      userId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Error report failed:", err);
    return NextResponse.json({ error: "Failed to report" }, { status: 500 });
  }
}
