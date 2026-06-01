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

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null,
        emailVerificationToken: verificationToken,
      },
    });

    // Send verification email (required for flow; roll back user if email can't be sent)
    try {
      await sendVerificationEmail(email, verificationToken, name || email);
    } catch (emailError) {
      const msg = emailError instanceof Error ? emailError.message : "Failed to send verification email";
      console.error("Failed to send verification email:", emailError);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      return NextResponse.json(
        {
          error: "Verification email could not be sent.",
          details: msg,
          hint: "Set RESEND_API_KEY (and optionally RESEND_FROM_EMAIL) in your environment. Use onboarding@resend.dev or a verified domain.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        message: "User created successfully. Please check your email to verify your account.",
        userId: user.id,
        requiresVerification: true,
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
