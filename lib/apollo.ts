import type { NormalizedLead } from "@/lib/leads";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

/**
 * Saved Apollo search parameters. These mirror Apollo's People Search filters.
 * Stored as JSON on the workspace so the ingest cron can re-run the same search.
 */
export type ApolloSearch = {
  person_titles?: string[];          // e.g. ["VP of Marketing", "CMO", "Head of Brand"]
  person_seniorities?: string[];     // e.g. ["vp", "head", "director", "c_suite"]
  organization_locations?: string[]; // e.g. ["United States", "United Kingdom"]
  organization_num_employees_ranges?: string[]; // e.g. ["11,50", "51,200", "201,500"]
  q_organization_keyword_tags?: string[]; // industry-ish keywords e.g. ["consumer goods", "retail"]
  q_keywords?: string;               // free-text
  per_page?: number;                 // max 100
};

type ApolloPerson = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  organization?: {
    name?: string | null;
    website_url?: string | null;
    primary_domain?: string | null;
    industry?: string | null;
  } | null;
};

type ApolloSearchResponse = {
  people?: ApolloPerson[];
  pagination?: { page?: number; per_page?: number; total_entries?: number; total_pages?: number };
};

/** Apollo returns this placeholder when an email is gated behind credits/plan. */
function isUsableEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return false;
  if (e.includes("email_not_unlocked") || e.includes("not_unlocked") || e === "email_not_unlocked@domain.com") return false;
  return true;
}

function toNormalizedLead(p: ApolloPerson): NormalizedLead | null {
  if (!isUsableEmail(p.email)) return null;
  const name =
    p.name?.trim() ||
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
    undefined;
  const org = p.organization ?? undefined;
  const website = org?.website_url?.trim() || (org?.primary_domain ? `https://${org.primary_domain}` : undefined);
  return {
    email: p.email!.trim(),
    name,
    jobTitle: p.title?.trim() || undefined,
    company: org?.name?.trim() || undefined,
    website,
    industry: org?.industry?.trim() || undefined,
  };
}

/**
 * Run one page of an Apollo People Search and return normalized leads with
 * usable emails, plus pagination + how many results were skipped for locked emails.
 */
export async function apolloSearchPage(
  apiKey: string,
  search: ApolloSearch,
  page: number
): Promise<{ leads: NormalizedLead[]; totalPages: number; totalEntries: number; lockedSkipped: number; rawCount: number }> {
  const body: Record<string, unknown> = {
    page,
    per_page: Math.min(100, Math.max(1, search.per_page ?? 50)),
  };
  if (search.person_titles?.length) body.person_titles = search.person_titles;
  if (search.person_seniorities?.length) body.person_seniorities = search.person_seniorities;
  if (search.organization_locations?.length) body.organization_locations = search.organization_locations;
  if (search.organization_num_employees_ranges?.length) body.organization_num_employees_ranges = search.organization_num_employees_ranges;
  if (search.q_organization_keyword_tags?.length) body.q_organization_keyword_tags = search.q_organization_keyword_tags;
  if (search.q_keywords?.trim()) body.q_keywords = search.q_keywords.trim();

  const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apollo search failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as ApolloSearchResponse;
  const people = data.people ?? [];
  const leads: NormalizedLead[] = [];
  let lockedSkipped = 0;
  for (const p of people) {
    const lead = toNormalizedLead(p);
    if (lead) leads.push(lead);
    else lockedSkipped += 1;
  }

  return {
    leads,
    totalPages: data.pagination?.total_pages ?? 1,
    totalEntries: data.pagination?.total_entries ?? people.length,
    lockedSkipped,
    rawCount: people.length,
  };
}

/**
 * Pull up to `limit` leads with usable emails across multiple pages.
 * Stops when limit is reached, pages are exhausted, or a hard page cap is hit.
 */
export async function apolloFetchLeads(
  apiKey: string,
  search: ApolloSearch,
  limit: number
): Promise<{ leads: NormalizedLead[]; lockedSkipped: number; pagesScanned: number; totalEntries: number }> {
  const collected: NormalizedLead[] = [];
  let lockedSkipped = 0;
  let page = 1;
  let totalPages = 1;
  let totalEntries = 0;
  const MAX_PAGES = 25; // safety cap (Apollo caps deep pagination anyway)

  while (collected.length < limit && page <= totalPages && page <= MAX_PAGES) {
    const res = await apolloSearchPage(apiKey, search, page);
    totalPages = res.totalPages;
    totalEntries = res.totalEntries;
    lockedSkipped += res.lockedSkipped;
    for (const l of res.leads) {
      collected.push(l);
      if (collected.length >= limit) break;
    }
    if (res.rawCount === 0) break; // no more results
    page += 1;
  }

  return { leads: collected, lockedSkipped, pagesScanned: page - 1, totalEntries };
}
