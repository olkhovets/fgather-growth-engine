import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendVerificationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // Create user — auto-verified. Email verification isn't required for this
    // single-operator tool, so accounts work immediately even without Resend set up.
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null,
        emailVerified: new Date(),
        emailVerificationToken: verificationToken,
      },
    });

    // Best-effort verification email — never block signup if it can't send.
    try {
      await sendVerificationEmail(email, verificationToken, name || email);
    } catch (emailError) {
      console.warn("[signup] verification email not sent (non-fatal):", emailError instanceof Error ? emailError.message : emailError);
    }

    return NextResponse.json(
      {
        message: "Account created. You can sign in now.",
        userId: user.id,
        requiresVerification: false,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
