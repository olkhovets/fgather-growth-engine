import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseCSV, normalizeRow } from "@/lib/csv";
import { createBatchWithLeads } from "@/lib/leads";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { csv, force } = body as { csv: string; force?: boolean };

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
