import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { logActivity } from "@/lib/activity";
import { generateLinkedInPosts } from "@/lib/linkedin-content-gen";

export const dynamic = "force-dynamic";

/** POST: generate LinkedIn organic post drafts from the workspace's winning signals. Operator-triggered. */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true, anthropicKey: true, anthropicModel: true } });
    if (!ws?.anthropicKey) return NextResponse.json({ error: "Anthropic API key not configured." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { count?: number };
    const result = await generateLinkedInPosts(ws.id, decrypt(ws.anthropicKey), ws.anthropicModel ?? "claude-haiku-4-5", body.count ?? 4);
    await logActivity(ws.id, "info", `Generated ${result.posts.length} LinkedIn organic post draft(s).`, { kind: "linkedin_content" });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
