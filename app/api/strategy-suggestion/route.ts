import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAggregatedMemory, getStrategySuggestion } from "@/lib/performance-memory";

export const dynamic = "force-dynamic";

/** GET: One actionable strategy suggestion derived from performance memory. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const memory = await getAggregatedMemory(workspace.id);
    const suggestion = getStrategySuggestion(memory);

    return NextResponse.json({ suggestion });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get suggestion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
