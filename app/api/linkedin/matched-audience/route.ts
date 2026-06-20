import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAudienceLeads, buildAudienceCsv, type AudienceFormat, type AudienceStatus } from "@/lib/matched-audience";

export const dynamic = "force-dynamic";

/**
 * GET: download a LinkedIn Matched Audience CSV built from the engine's leads.
 * Query params:
 *   format = contact | company   (default contact)
 *   status = active | positive | all   (default active = sent & not suppressed)
 *   persona = <persona key>   (optional filter)
 * Upload the file in LinkedIn Campaign Manager → Matched Audiences.
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const format: AudienceFormat = url.searchParams.get("format") === "company" ? "company" : "contact";
    const statusParam = url.searchParams.get("status");
    const status: AudienceStatus = statusParam === "positive" || statusParam === "all" ? statusParam : "active";
    const persona = url.searchParams.get("persona") || undefined;

    const leads = await getAudienceLeads(workspace.id, { status, persona });
    const { csv, filename } = buildAudienceCsv(leads, format);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build audience";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
