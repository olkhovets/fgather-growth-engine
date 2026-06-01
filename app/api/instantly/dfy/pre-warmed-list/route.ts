import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const extensions = Array.isArray(body.extensions) ? body.extensions : undefined;
    const search = typeof body.search === "string" ? body.search : undefined;

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured." },
        { status: 400 }
      );
    }

    const result = await ctx.client.dfyPreWarmedList(
      extensions?.length || search ? { extensions, search } : undefined
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch pre-warmed list";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
