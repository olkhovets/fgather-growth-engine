import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseCSV, normalizeRow } from "@/lib/csv";
import { createBatchWithLeads } from "@/lib/leads";

/** Extract Google Sheet ID from URL (edit or view). */
function extractSheetId(url: string): string | null {
  const trimmed = url.trim();
  const m = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { sheetUrl?: string } = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === "object") body = raw as { sheetUrl?: string };
    } catch {
      // Empty or invalid JSON body
    }
    const { sheetUrl } = body;

    if (!sheetUrl || typeof sheetUrl !== "string") {
      return NextResponse.json(
        { error: "Sheet URL is required. Paste the full Google Sheet URL (share as 'Anyone with the link can view' to import)." },
        { status: 400 }
      );
    }

    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) {
      return NextResponse.json(
        { error: "Invalid Google Sheet URL. Use a link like https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit" },
        { status: 400 }
      );
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found. Complete onboarding first." }, { status: 400 });
    }

    // Public CSV export (works when sheet is shared "Anyone with the link can view"). gid=0 = first sheet.
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    const res = await fetch(exportUrl, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        // Some Google endpoints check this; signals we want raw data not a browser experience
        "Accept": "text/csv, text/plain, */*",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Could not fetch sheet. Ensure it is shared as 'Anyone with the link can view' (File > Share > Change to Anyone with the link)." },
        { status: 400 }
      );
    }

    // If Google redirected to a login page, the content-type will be text/html, not text/csv
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      return NextResponse.json(
        { error: "Sheet is not publicly accessible. Open the sheet → File → Share → Change to 'Anyone with the link can view', then try again." },
        { status: 400 }
      );
    }

    const text = await res.text();
    const { rows } = parseCSV(text);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No data rows in sheet. First row should be headers (e.g. email, name, company, job title, industry)." },
        { status: 400 }
      );
    }

    const leads = rows.map((row) => normalizeRow(row)).filter((r) => r.email);
    if (leads.length === 0) {
      return NextResponse.json(
        { error: "No valid rows with email. Include an 'email' column (or use it as first column)." },
        { status: 400 }
      );
    }

    const { batchId, count, skippedDuplicate } = await createBatchWithLeads(workspace.id, leads, {
      batchName: `Sheet ${new Date().toLocaleDateString()}`,
    });

    return NextResponse.json({
      batchId,
      count,
      skippedDuplicate,
      message:
        skippedDuplicate > 0
          ? `Imported ${count} leads from Google Sheet (${skippedDuplicate} duplicates skipped).`
          : `Imported ${count} leads from Google Sheet.`,
    });
  } catch (error) {
    console.error("Leads import sheet error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
