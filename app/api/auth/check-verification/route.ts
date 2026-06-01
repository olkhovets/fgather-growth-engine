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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { emailVerified: true },
    });

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    return NextResponse.json(
      {
        verified: !!user?.emailVerified,
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
