import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;

/**
 * POST: Set a new password using a valid reset token from the email link.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token =
      typeof body?.token === "string" ? body.token.trim() : "";
    const newPassword =
      typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!token) {
      return NextResponse.json(
        { error: "Reset token is required" },
        { status: 400 }
      );
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetRecord) {
      return NextResponse.json(
        { error: "Invalid or expired reset link. Request a new one." },
        { status: 400 }
      );
    }

    if (new Date() > resetRecord.expiresAt) {
      await prisma.passwordResetToken.delete({ where: { id: resetRecord.id } });
      return NextResponse.json(
        { error: "This reset link has expired. Request a new one." },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { email: resetRecord.email },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.delete({ where: { id: resetRecord.id } }),
    ]);

    return NextResponse.json({
      message: "Password updated. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
