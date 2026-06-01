import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendFeatureRequestEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Sign in to submit a feature request." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length < 10) {
      return NextResponse.json(
        { error: "Please describe your idea (at least 10 characters)." },
        { status: 400 }
      );
    }

    const fromEmail = session.user?.email ?? "unknown@gatherhq.com";
    const fromName = session.user?.name ?? null;

    await sendFeatureRequestEmail(fromEmail, fromName, message);

    return NextResponse.json({ success: true, message: "Thanks! Your idea has been sent." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to submit.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
