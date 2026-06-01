import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInstantlyClientForUserId } from "@/lib/instantly";
import type { DfyOrderItem, DfyOrderType } from "@/lib/instantly";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    const order_type = (body.order_type ?? "dfy") as DfyOrderType;
    const simulation = Boolean(body.simulation);

    if (!items.length) {
      return NextResponse.json(
        { error: "Provide items array with at least one domain (and accounts for type dfy)" },
        { status: 400 }
      );
    }

    const validTypes: DfyOrderType[] = ["dfy", "pre_warmed_up", "extra_accounts"];
    if (!validTypes.includes(order_type)) {
      return NextResponse.json(
        { error: "order_type must be dfy, pre_warmed_up, or extra_accounts" },
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

    const payload: { items: DfyOrderItem[]; order_type: DfyOrderType; simulation: boolean } = {
      items: items.map((it: Record<string, unknown>) => ({
        domain: String(it.domain ?? ""),
        ...(it.email_provider != null && { email_provider: Number(it.email_provider) }),
        ...(typeof it.forwarding_domain === "string" && { forwarding_domain: it.forwarding_domain }),
        ...(Array.isArray(it.accounts) && {
          accounts: it.accounts.map((a: Record<string, unknown>) => ({
            first_name: String(a.first_name ?? ""),
            last_name: String(a.last_name ?? ""),
            email_address_prefix: String(a.email_address_prefix ?? ""),
          })),
        }),
      })),
      order_type,
      simulation,
    };

    const result = await ctx.client.dfyPlaceOrder(payload);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to place DFY order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
