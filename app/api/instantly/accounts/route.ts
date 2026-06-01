import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ctx = await getInstantlyClientForUserId(session.user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "Instantly API key not configured. Complete onboarding with your Instantly key." },
        { status: 400 }
      );
    }

    const accounts = await ctx.client.listAccounts();
    return NextResponse.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list Instantly accounts";
    // Pass through auth/scope errors (e.g. "Unauthorized" or "Invalid API key") so the user can fix their key
    return NextResponse.json(
      { error: message },
      { status: message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("forbidden") ? 401 : 500 }
    );
  }
}
