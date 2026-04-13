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

    // Read raw text to avoid JSON body parser 4.5MB limit on Vercel
    // The client sends { csv: "...", force: bool } but for large files we
    // fall back to reading the body as text and parsing manually
    let csv: string;
    let force = false;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const text = await request.text();
      let body: { csv?: string; force?: boolean };
      try {
        body = JSON.parse(text) as { csv?: string; force?: boolean };
      } catch {
        return NextResponse.json({ error: "Invalid JSON body — if your CSV is very large, try Google Sheets import instead." }, { status: 400 });
      }
      csv = body.csv ?? "";
      force = body.force ?? false;
    } else {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 400 });
    }

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

    const { rows } = parseCSV(csv);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No rows found in CSV. Ensure first row is headers (e.g. email, name, company, job title, industry)." },
        { status: 400 }
      );
    }

    const leads = rows.map((row) => normalizeRow(row)).filter((r) => r.email);
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
