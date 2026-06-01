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
    const domains = Array.isArray(body.domains) ? body.domains : [];
    if (!domains.length || !domains.every((d: unknown) => typeof d === "string")) {
      return NextResponse.json(
        { error: "Provide domains array (e.g. [\"example.com\"])" },
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

    const result = await ctx.client.dfyCheckDomains(domains);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check domains";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
