import { prisma } from "@/lib/prisma";

/**
 * SURROUND-SOUND (Phase 3). Build a LinkedIn Matched Audience upload from the
 * accounts the email engine is already working, so the same B2C marketing
 * leaders see Gather in the inbox AND the feed in the same week. LinkedIn matched
 * audiences are uploaded as a CSV (contact list or company list); this produces
 * that CSV. The operator uploads it in Campaign Manager (LinkedIn has no public
 * write API for this), then points the ad sets at the audience.
 */

export type AudienceFormat = "contact" | "company";
export type AudienceStatus = "active" | "positive" | "all";

type AudienceLead = {
  email: string; name: string | null; jobTitle: string | null;
  company: string | null; website: string | null; industry: string | null;
  persona: string | null; replyStatus: string | null;
};

/**
 * Pull the leads for the audience.
 *   active   (default): currently in flight — sent, not suppressed. The set to surround.
 *   positive: only positive repliers — a tight retarget/lookalike seed.
 *   all:      every lead with an email.
 */
export async function getAudienceLeads(
  workspaceId: string,
  opts: { status?: AudienceStatus; persona?: string } = {}
): Promise<AudienceLead[]> {
  const status = opts.status ?? "active";
  const where: Record<string, unknown> = { leadBatch: { workspaceId }, email: { not: "" } };
  if (status === "active") { where.sentAt = { not: null }; where.suppressed = false; }
  else if (status === "positive") { where.replyStatus = "positive"; }
  if (opts.persona) where.persona = opts.persona;

  return prisma.lead.findMany({
    where,
    select: { email: true, name: true, jobTitle: true, company: true, website: true, industry: true, persona: true, replyStatus: true },
    orderBy: { sentAt: "desc" },
    take: 50000, // LinkedIn caps a single upload well under this
  });
}

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function csvLines(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function splitName(name: string | null): { first: string; last: string } {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function domainFromWebsite(website: string | null): string {
  if (!website) return "";
  return website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].trim();
}

/** Build the LinkedIn matched-audience CSV in the column shape LinkedIn expects. */
export function buildAudienceCsv(leads: AudienceLead[], format: AudienceFormat): { csv: string; rowCount: number; filename: string } {
  if (format === "company") {
    // De-dupe by company; LinkedIn company-list columns.
    const seen = new Set<string>();
    const rows: string[][] = [];
    for (const l of leads) {
      const company = (l.company || "").trim();
      if (!company) continue;
      const key = company.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([company, domainFromWebsite(l.website), l.industry || ""]);
    }
    return {
      csv: csvLines(["companyname", "companywebsite", "industry"], rows),
      rowCount: rows.length,
      filename: "gather-linkedin-company-audience.csv",
    };
  }
  // Contact list — LinkedIn matches on email; include name/company/title to lift match rate.
  const rows: string[][] = [];
  for (const l of leads) {
    if (!l.email) continue;
    const { first, last } = splitName(l.name);
    rows.push([l.email, first, last, l.company || "", l.jobTitle || ""]);
  }
  return {
    csv: csvLines(["email", "firstname", "lastname", "companyname", "jobtitle"], rows),
    rowCount: rows.length,
    filename: "gather-linkedin-contact-audience.csv",
  };
}
