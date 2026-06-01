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
    const domain = typeof body.domain === "string" ? body.domain.trim() : "";
    if (!domain) {
      return NextResponse.json(
        { error: "Provide domain (e.g. \"example.com\")" },
        { status: 400 }
      );
    }

    const extensions = Array.isArray(body.extensions) ? body.extensions : undefined;

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured." },
        { status: 400 }
      );
    }

    const result = await ctx.client.dfySimilarDomains(domain, extensions);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get similar domains";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
