import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isAdmin(email: string | null | undefined): boolean {
  const list = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? "";
  const emails = list.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return email ? emails.includes(email.toLowerCase()) : false;
}

/**
 * POST: Admin-only. Mark a user's email as verified (e.g. for stuck or manual verification).
 * Body: { email: string } or { userId: string }
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { email, userId } = body as { email?: string; userId?: string };

    if (!email && !userId) {
      return NextResponse.json(
        { error: "Provide email or userId" },
        { status: 400 }
      );
    }

    const user = email
      ? await prisma.user.findUnique({ where: { email: email.trim() } })
      : await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerificationToken: null,
      },
    });

    return NextResponse.json({
      message: "User email verified",
      email: user.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to verify user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
