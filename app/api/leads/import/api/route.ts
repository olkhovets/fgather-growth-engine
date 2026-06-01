import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createBatchWithLeads, NormalizedLead } from "@/lib/leads";

export const dynamic = "force-dynamic";

/** Normalize a raw object from API to our lead shape. Accepts snake_case or camelCase. */
function normalizeApiLead(row: Record<string, unknown>): NormalizedLead | null {
  const email =
    typeof row.email === "string" ? row.email
    : typeof row.Email === "string" ? row.Email
    : "";
  if (!email?.trim()) return null;

  const getStr = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };

  return {
    email: email.trim(),
    name: getStr("name", "Name", "first_name", "full_name"),
    jobTitle: getStr("job_title", "jobTitle", "title", "Title"),
    company: getStr("company", "Company", "company_name", "organization"),
    industry: getStr("industry", "Industry"),
  };
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { url, apiKey } = body as { url?: string; apiKey?: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "API URL is required. Your endpoint should return JSON: { leads: [...] } or an array of lead objects (email required)." },
        { status: 400 }
      );
    }

    // Basic URL safety: only allow http/https
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return NextResponse.json({ error: "URL must be http or https." }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found. Complete onboarding first." }, { status: 400 });
    }

    const headers: Record<string, string> = {};
    if (apiKey && typeof apiKey === "string") {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["X-API-Key"] = apiKey; // some APIs use this
    }
    // Don't send Content-Type: application/json on GET - some servers reject GET with that header and no body

    const res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `API returned ${res.status}. Check the URL and API key.` },
        { status: 400 }
      );
    }

    const data = await res.json().catch(() => null);
    if (data == null) {
      return NextResponse.json({ error: "API did not return valid JSON." }, { status: 400 });
    }

    let rawLeads: unknown[] = [];
    if (Array.isArray(data)) {
      rawLeads = data;
    } else if (data && typeof data === "object" && Array.isArray(data.leads)) {
      rawLeads = data.leads;
    } else if (data && typeof data === "object" && Array.isArray(data.data)) {
      rawLeads = data.data;
    } else {
      return NextResponse.json(
        { error: "Expected JSON: { leads: [...] } or an array of objects with at least 'email'." },
        { status: 400 }
      );
    }

    const leads: NormalizedLead[] = [];
    for (const item of rawLeads) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const lead = normalizeApiLead(item as Record<string, unknown>);
        if (lead) leads.push(lead);
      }
    }

    if (leads.length === 0) {
      return NextResponse.json(
        { error: "No valid leads with email in the response. Each object must have an 'email' field." },
        { status: 400 }
      );
    }

    const { batchId, count, skippedDuplicate } = await createBatchWithLeads(workspace.id, leads, {
      batchName: `API ${new Date().toLocaleDateString()}`,
    });

    return NextResponse.json({
      batchId,
      count,
      skippedDuplicate,
      message:
        skippedDuplicate > 0 ? `Imported ${count} leads from API (${skippedDuplicate} duplicates skipped).` : `Imported ${count} leads from API.`,
    });
  } catch (error) {
    console.error("Leads import API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
