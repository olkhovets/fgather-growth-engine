import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ verified: false, hasWorkspace: false }, { status: 200 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    // Email verification is not required for this single-operator tool — any
    // logged-in user is treated as verified so they're never stuck on the
    // verify-email-pending screen (the link often can't send without Resend).
    return NextResponse.json(
      {
        verified: true,
        hasWorkspace: !!workspace,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Check verification error:", error);
    return NextResponse.json(
      { verified: false, hasWorkspace: false },
      { status: 200 }
    );
  }
}
