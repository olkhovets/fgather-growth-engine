import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST: Resend the verification email for the current user.
 * User must be logged in and not already verified.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true, emailVerified: true, emailVerificationToken: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.emailVerified) {
      return NextResponse.json(
        { error: "Email already verified", verified: true },
        { status: 400 }
      );
    }

    if (!user.emailVerificationToken) {
      return NextResponse.json(
        { error: "No verification token. Please sign up again or contact support." },
        { status: 400 }
      );
    }

    await sendVerificationEmail(
      user.email,
      user.emailVerificationToken,
      user.name || user.email
    );

    return NextResponse.json({
      message: "Verification email sent. Check your inbox and spam folder.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resend email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
