import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCrossChannelSignals } from "@/lib/cross-channel";
import { COMPETITOR_COMPANIES, COMPETITOR_PEOPLE } from "@/lib/competitor-targets";

export const dynamic = "force-dynamic";

/** GET: competitor-poach targets + the cross-channel priority personas that drive email targeting. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const cross = await getCrossChannelSignals(ws.id);
    return NextResponse.json({
      companies: COMPETITOR_COMPANIES,
      people: COMPETITOR_PEOPLE,
      priorityPersonas: cross.priorityPersonas,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
