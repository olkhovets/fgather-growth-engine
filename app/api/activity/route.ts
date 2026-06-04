import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET: recent activity-log rows for this workspace (newest first). */
export async function GET(request: Request) {
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

    const url = new URL(request.url);
    const typeFilter = url.searchParams.get("type");

    const rows = await prisma.activityLog.findMany({
      where: { workspaceId: workspace.id, ...(typeFilter ? { type: typeFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      activity: rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.message,
        meta: r.metaJson ? safeParse(r.metaJson) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
