import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import type { ApolloSearch } from "@/lib/apollo";

export const dynamic = "force-dynamic";

/** GET: whether an Apollo key is set + the saved search params. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { apolloApiKey: true, apolloSearchJson: true },
    });
    let search: ApolloSearch | null = null;
    try {
      if (workspace?.apolloSearchJson) search = JSON.parse(workspace.apolloSearchJson) as ApolloSearch;
    } catch { /* ignore */ }
    return NextResponse.json({ hasKey: Boolean(workspace?.apolloApiKey), search });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load Apollo config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST: save the Apollo API key (encrypted) and/or the saved search params. */
export async function POST(request: Request) {
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

    const body = (await request.json()) as { apiKey?: string; search?: ApolloSearch };
    const data: Record<string, string | null> = {};

    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      data.apolloApiKey = encrypt(body.apiKey.trim());
    }
    if (body.search && typeof body.search === "object") {
      data.apolloSearchJson = JSON.stringify(body.search);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to save. Provide apiKey and/or search." }, { status: 400 });
    }

    await prisma.workspace.update({ where: { id: workspace.id }, data });
    return NextResponse.json({ saved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save Apollo config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
