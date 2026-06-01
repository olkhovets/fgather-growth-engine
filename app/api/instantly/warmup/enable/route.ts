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
    const emails = Array.isArray(body.emails) ? body.emails : [body.email].filter(Boolean);
    if (!emails.length || !emails.every((e: unknown) => typeof e === "string")) {
      return NextResponse.json(
        { error: "Provide emails array or email string" },
        { status: 400 }
      );
    }

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured." },
        { status: 400 }
      );
    }

    await ctx.client.enableWarmup(emails);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enable warmup";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
