import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendFixNotificationEmail } from "@/lib/email";

/**
 * POST: Notify all users who hit a specific error that a fix has been deployed.
 * Body: { context: string, fixNote: string }
 * Only callable by mayank@gatherhq.com.
 *
 * Example:
 *   POST /api/admin/notify-fix
 *   { "context": "Sequence generation failed", "fixNote": "Fixed a JSON parsing bug in the research phase. Please try generating again." }
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.email !== "mayank@gatherhq.com") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const context = typeof body.context === "string" ? body.context.trim() : "";
  const fixNote = typeof body.fixNote === "string" ? body.fixNote.trim() : "";

  if (!context || !fixNote) {
    return NextResponse.json({ error: "context and fixNote are required" }, { status: 400 });
  }

  // Find all unresolved error reports matching this context
  const reports = await prisma.errorReport.findMany({
    where: {
      context,
      resolved: false,
      notifiedAt: null,
    },
    select: { id: true, userEmail: true },
  });

  if (reports.length === 0) {
    return NextResponse.json({ ok: true, notified: 0, message: "No unresolved reports found for that context." });
  }

  // Deduplicate by email — one notification per user even if they hit it multiple times
  const uniqueEmails = [...new Set(reports.map((r) => r.userEmail))];
  const reportIds = reports.map((r) => r.id);

  // Send fix emails
  const results = await Promise.allSettled(
    uniqueEmails.map((email) => sendFixNotificationEmail(email, context, fixNote))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;

  // Mark all matching reports as resolved + notified
  await prisma.errorReport.updateMany({
    where: { id: { in: reportIds } },
    data: {
      resolved: true,
      resolvedAt: new Date(),
      notifiedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    notified: succeeded,
    total: uniqueEmails.length,
    resolvedReports: reportIds.length,
  });
}

/** GET: List unresolved error reports, grouped by context. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.email !== "mayank@gatherhq.com") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reports = await prisma.errorReport.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userEmail: true,
      context: true,
      error: true,
      createdAt: true,
    },
  });

  // Group by context
  const grouped = reports.reduce<Record<string, { count: number; users: string[]; latest: string; sample: string }>>((acc, r) => {
    if (!acc[r.context]) {
      acc[r.context] = { count: 0, users: [], latest: r.createdAt.toISOString(), sample: r.error };
    }
    acc[r.context].count++;
    if (!acc[r.context].users.includes(r.userEmail)) {
      acc[r.context].users.push(r.userEmail);
    }
    return acc;
  }, {});

  return NextResponse.json({ grouped, total: reports.length });
}
