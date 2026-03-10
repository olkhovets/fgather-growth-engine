/**
 * Simple CSV/TSV parser: first row = headers, rest = rows.
 * Auto-detects tab vs comma delimiter. Handles quoted fields with commas.
 */
export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Auto-detect delimiter: if first line has more tabs than commas, treat as TSV
  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  const parseLine = (line: string): string[] => {
    if (delimiter === "\t") {
      return line.split("\t").map((v) => v.trim().replace(/^"|"$/g, ""));
    }
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === "," && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ""));
        current = "";
      } else current += c;
    }
    result.push(current.trim().replace(/^"|"$/g, ""));
    return result;
  };

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = values[j]?.trim() ?? "";
    });
    if (Object.values(row).some((v) => v)) rows.push(row);
  }

  return { headers, rows };
}

/** Normalize column name to our schema: email, name, job_title, company, industry */
const COLUMN_ALIASES: Record<string, string> = {
  email: "email",
  e_mail: "email",
  work_email: "email",
  first_name: "name",
  firstname: "name",
  name: "name",
  full_name: "name",
  fullname: "name",
  job_title: "job_title",
  jobtitle: "job_title",
  title: "job_title",
  company: "company",
  company_name: "company",
  organization: "company",
  website: "website",
  company_url: "website",
  company_website: "website",
  industry: "industry",
};

export function normalizeRow(row: Record<string, string>): { email: string; name?: string; jobTitle?: string; company?: string; website?: string; industry?: string } {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k] ?? row[COLUMN_ALIASES[k]];
      if (v) return v;
    }
    return "";
  };
  const email = get("email", "e_mail", "work_email") || Object.values(row)[0] || "";
  const rawWebsite = get("website", "company_url", "company_website");
  const website = rawWebsite ? (rawWebsite.startsWith("http") ? rawWebsite : `https://${rawWebsite.replace(/^www\./, "")}`) : undefined;
  return {
    email,
    name: get("name", "first_name", "firstname", "full_name", "fullname") || undefined,
    jobTitle: get("job_title", "jobtitle", "title") || undefined,
    company: get("company", "company_name", "organization") || undefined,
    website: website || undefined,
    industry: get("industry") || undefined,
  };
}
