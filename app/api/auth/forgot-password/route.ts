import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { sendPasswordResetEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const RESET_TOKEN_EXPIRY_HOURS = 1;

/**
 * POST: Request a password reset. Sends an email with a reset link if the user
 * exists and has a password (credentials account). Always returns 200 with the
 * same message to avoid leaking whether the email is registered.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email.trim() : "";

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, name: true, password: true },
    });

    // Only send email if user exists and has a password (not OAuth-only)
    if (user?.password) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + RESET_TOKEN_EXPIRY_HOURS);

      // Delete any existing reset tokens for this email so only the latest link works
      await prisma.passwordResetToken.deleteMany({
        where: { email: user.email },
      });

      await prisma.passwordResetToken.create({
        data: {
          email: user.email,
          token,
          expiresAt,
        },
      });

      try {
        await sendPasswordResetEmail(
          user.email,
          token,
          user.name ?? undefined
        );
      } catch (emailError) {
        console.error("Failed to send password reset email:", emailError);
        await prisma.passwordResetToken.deleteMany({
          where: { email: user.email, token },
        });
        return NextResponse.json(
          {
            error: "We couldn't send the reset email. Please try again later or contact support.",
          },
          { status: 503 }
        );
      }
    }

    return NextResponse.json({
      message:
        "If an account exists with that email, we've sent a link to reset your password. Check your inbox and spam folder.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
