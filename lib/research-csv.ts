/**
 * Robust parser for a bulk research upload — the file/paste Peter builds from his deep-research agents.
 *
 * The whole point is that this survives real, messy input: research insights that CONTAIN commas,
 * quotes, and line breaks; spreadsheet copy-paste (tab-separated) as well as CSV; smart quotes; header
 * rows in any column order with human-worded names ("Insight", "What we found", "Company / Org"); blank
 * rows; and rows missing required fields. Nothing here spends a credit — it just turns text into clean
 * rows plus a list of exactly which rows were rejected and why, so a bad line never silently vanishes.
 */

export type ResearchRow = {
  name: string;
  company: string;
  signal: string;   // the research insight — becomes the email's opener
  source?: string;
  title?: string;
  domain?: string;
};

export type RejectedRow = { row: number; reason: string; raw: string };

export type ParseResult = { rows: ResearchRow[]; rejected: RejectedRow[]; headerFound: boolean };

// Header aliases — case/space/punctuation-insensitive. Maps many human phrasings to our field.
const FIELD_ALIASES: Record<keyof ResearchRow, string[]> = {
  name: ["name", "full name", "fullname", "contact", "contact name", "person", "prospect", "lead", "first and last"],
  company: ["company", "company name", "organization", "organisation", "org", "account", "employer", "brand", "company/org", "company / org"],
  signal: ["signal", "insight", "research", "research insight", "what we found", "finding", "hook", "note", "notes", "trigger", "pain", "pain point", "reason", "why", "context", "detail", "details"],
  source: ["source", "where", "where from", "from", "link", "url source", "cite", "citation", "proof", "evidence"],
  title: ["title", "job title", "jobtitle", "role", "position", "seniority"],
  domain: ["domain", "website", "web site", "site", "url", "company domain", "company website", "web"],
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[\s._/\\-]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

/** Map a normalized header cell to one of our fields, or null if unrecognized. */
function fieldForHeader(h: string): keyof ResearchRow | null {
  const n = normHeader(h);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [keyof ResearchRow, string[]][]) {
    if (aliases.some((a) => normHeader(a) === n)) return field;
  }
  // Loose contains-match as a fallback (e.g. "prospect full name" -> name).
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [keyof ResearchRow, string[]][]) {
    if (aliases.some((a) => n.includes(normHeader(a)) || normHeader(a).includes(n))) return field;
  }
  return null;
}

/**
 * Parse one delimited line-set into a matrix of cells. Full CSV state machine: honors double-quoted
 * fields (so commas/newlines/tabs INSIDE an insight are preserved), doubled "" as an escaped quote,
 * and \r\n or \n line endings. `delim` is "," or "\t".
 */
function toMatrix(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else if (c === "\r") {
      // swallow; \n handles the row break (handles lone \r too via next check)
      if (text[i + 1] !== "\n") pushRow();
    } else {
      field += c;
    }
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

/** Normalize smart quotes and NBSPs that break naive parsing when pasted from docs/sheets. */
function preclean(text: string): string {
  return text
    .replace(/﻿/g, "")               // BOM
    .replace(/[“”]/g, '"')      // curly double quotes
    .replace(/[‘’]/g, "'")      // curly single quotes
    .replace(/ /g, " ");             // non-breaking space
}

function cleanCell(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Parse a bulk research upload (CSV or TSV, with a header row) into clean rows + rejections.
 * Required per row: name AND company (needed to resolve an email) AND signal (the whole point).
 * Rows missing any of those are rejected with a reason, never silently dropped.
 */
export function parseResearchUpload(input: string): ParseResult {
  const text = preclean(input || "");
  if (!text.trim()) return { rows: [], rejected: [], headerFound: false };

  // Auto-detect delimiter from the first non-empty line: tabs win if present (spreadsheet paste),
  // else comma. This lets Peter paste straight from Google Sheets/Excel OR upload a .csv.
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const delim = firstLine.includes("\t") ? "\t" : ",";

  const matrix = toMatrix(text, delim).filter((r) => r.some((c) => c.trim() !== ""));
  if (matrix.length === 0) return { rows: [], rejected: [], headerFound: false };

  // Header row: map each column to a field. Require that we recognize at least name+company+signal.
  const headerCells = matrix[0].map(cleanCell);
  const colMap = headerCells.map(fieldForHeader);
  const haveHeader = ["name", "company", "signal"].every((f) => colMap.includes(f as keyof ResearchRow));

  const rows: ResearchRow[] = [];
  const rejected: RejectedRow[] = [];

  // If no usable header, fall back to positional columns: name, company, signal, source, title, domain.
  const POSITIONAL: (keyof ResearchRow)[] = ["name", "company", "signal", "source", "title", "domain"];
  const dataRows = haveHeader ? matrix.slice(1) : matrix;

  dataRows.forEach((cells, idx) => {
    const rowNum = (haveHeader ? idx + 2 : idx + 1); // human-friendly line number
    const rec: Partial<ResearchRow> = {};
    cells.forEach((cell, ci) => {
      const field = haveHeader ? colMap[ci] : POSITIONAL[ci];
      if (field) rec[field] = cleanCell(cell);
    });
    const name = cleanCell(rec.name);
    const company = cleanCell(rec.company);
    const signal = cleanCell(rec.signal);
    const raw = cells.join(delim === "\t" ? " | " : ", ").slice(0, 160);
    const missing = [!name && "name", !company && "company", !signal && "signal"].filter(Boolean);
    if (missing.length) {
      rejected.push({ row: rowNum, reason: `missing ${missing.join(" + ")}`, raw });
      return;
    }
    rows.push({
      name, company, signal,
      source: cleanCell(rec.source) || undefined,
      title: cleanCell(rec.title) || undefined,
      domain: cleanCell(rec.domain) || undefined,
    });
  });

  return { rows, rejected, headerFound: haveHeader };
}
