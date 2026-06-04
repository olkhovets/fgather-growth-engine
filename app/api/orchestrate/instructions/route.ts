import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** GET: current custom instructions. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({
    where: { userId: session.user.id },
    select: { customInstructions: true },
  });
  return NextResponse.json({ customInstructions: ws?.customInstructions ?? "" });
}

/** POST { customInstructions } — save the free-text generation addendum. */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const { customInstructions } = (await request.json()) as { customInstructions?: string };
    const value = typeof customInstructions === "string" ? customInstructions.trim() : "";
    await prisma.workspace.update({
      where: { id: ws.id },
      data: { customInstructions: value || null },
    });
    await logActivity(ws.id, "info",
      value ? "Updated custom generation instructions" : "Cleared custom generation instructions",
      value ? { preview: value.slice(0, 120) } : undefined);
    return NextResponse.json({ saved: true, customInstructions: value });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save instructions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
