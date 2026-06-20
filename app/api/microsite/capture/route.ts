import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const BATCH_NAME = "Microsite Captures";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public email capture for the free-value research microsite (channel #1). A visitor
 * (e.g. arriving from a LinkedIn ad) submits their email → becomes a Lead in the
 * "Microsite Captures" batch, ready for Generate & send. This is the valuable
 * destination that the leaking website-visit clicks lack — it converts a click into
 * an emailable lead. No auth (public form); abuse-guarded by a honeypot + email
 * validation. Attaches to the operator workspace (MICROSITE_OWNER_EMAIL).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: string; name?: string; company?: string; website?: string };
    // Honeypot: real users never fill "website"; bots do.
    if (body.website) return NextResponse.json({ ok: true });
    const email = (body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid work email." }, { status: 400 });

    const ownerEmail = process.env.MICROSITE_OWNER_EMAIL || "peter@gatherhq.com";
    const owner = await prisma.user.findFirst({ where: { email: ownerEmail }, select: { id: true } });
    const ws = owner ? await prisma.workspace.findUnique({ where: { userId: owner.id }, select: { id: true } }) : null;
    if (!ws) return NextResponse.json({ error: "Not configured" }, { status: 500 });

    let batch = await prisma.leadBatch.findFirst({ where: { workspaceId: ws.id, name: BATCH_NAME }, select: { id: true } });
    if (!batch) batch = await prisma.leadBatch.create({ data: { workspaceId: ws.id, name: BATCH_NAME }, select: { id: true } });

    // De-dupe by email within the batch so a double-submit doesn't create two leads.
    const existing = await prisma.lead.findFirst({ where: { leadBatchId: batch.id, email }, select: { id: true } });
    if (!existing) {
      await prisma.lead.create({ data: { leadBatchId: batch.id, email, name: (body.name || "").trim() || null, company: (body.company || "").trim() || null, persona: "growth-general" } });
      await logActivity(ws.id, "ingest", `Microsite capture: ${email}${body.company ? ` (${body.company})` : ""}`, { kind: "microsite_capture", email });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
