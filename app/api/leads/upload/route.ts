import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseCSV, normalizeRow } from "@/lib/csv";
import { createBatchWithLeads } from "@/lib/leads";

export const maxDuration = 60;

// Increase body size limit for large CSV files (default is 4.5MB on Vercel)
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let csv: string | undefined;
    let force = false;
    let preLeads: Array<{ email: string; name?: string; jobTitle?: string; company?: string; website?: string; industry?: string }> | undefined;

    const text = await request.text();
    let body: { csv?: string; leads?: typeof preLeads; force?: boolean };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    csv = body.csv;
    force = body.force ?? false;
    preLeads = body.leads;

    if (!csv || typeof csv !== "string") {
      return NextResponse.json(
        { error: "CSV content is required (send as { csv: \"...\" })" },
        { status: 400 }
      );
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found. Complete onboarding first." }, { status: 400 });
    }

    let leads: Array<{ email: string; name?: string; jobTitle?: string; company?: string; website?: string; industry?: string }>;

    if (preLeads && preLeads.length > 0) {
      // Client already parsed the CSV — use directly
      leads = preLeads.filter((r) => r.email?.trim());
    } else if (csv) {
      const { rows } = parseCSV(csv);
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "No rows found in CSV. Ensure first row is headers (e.g. email, name, company, job title, industry)." },
          { status: 400 }
        );
      }
      leads = rows.map((row) => normalizeRow(row)).filter((r) => r.email);
    } else {
      return NextResponse.json({ error: "No CSV content or leads provided." }, { status: 400 });
    }

    if (leads.length === 0) {
      return NextResponse.json(
        { error: "No valid rows with email. Include an 'email' column (or first column as email)." },
        { status: 400 }
      );
    }

    const { batchId, count, skippedDuplicate } = await createBatchWithLeads(workspace.id, leads, { dedupe: !force });

    return NextResponse.json({
      batchId,
      count,
      skippedDuplicate,
      message: skippedDuplicate > 0 ? `Uploaded ${count} leads (${skippedDuplicate} duplicates skipped).` : `Uploaded ${count} leads.`,
    });
  } catch (error) {
    console.error("Leads upload error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
