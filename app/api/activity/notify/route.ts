import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET: current "email me on every action" setting + the target email. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({
    where: { userId: session.user.id },
    select: { notifyOnActivity: true, notifyEmail: true, user: { select: { email: true } } },
  });
  return NextResponse.json({
    notifyOnActivity: ws?.notifyOnActivity ?? false,
    notifyEmail: ws?.notifyEmail ?? ws?.user?.email ?? "",
  });
}

/** POST { enabled?: boolean, notifyEmail?: string } */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const { enabled, notifyEmail } = (await request.json()) as { enabled?: boolean; notifyEmail?: string };
    const data: Record<string, unknown> = {};
    if (typeof enabled === "boolean") data.notifyOnActivity = enabled;
    if (typeof notifyEmail === "string") data.notifyEmail = notifyEmail.trim() || null;
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    await prisma.workspace.update({ where: { id: ws.id }, data });
    return NextResponse.json({ saved: true, ...data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update notifications";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
