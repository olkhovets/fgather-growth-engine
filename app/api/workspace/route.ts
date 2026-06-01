import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { anthropicModel } = body as { anthropicModel?: string | null };

    await prisma.workspace.update({
      where: { userId: session.user.id },
      data: { anthropicModel: anthropicModel ?? null },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Workspace PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
