import type { NormalizedLead } from "@/lib/leads";
import { classifyEmailProvider } from "@/lib/email-provider";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

export type ProviderFilter = "all" | "google" | "no-gateways";
/** Strict security gateways that quarantine cold email most aggressively. */
const STRICT_GATEWAYS = new Set(["Proofpoint", "Mimecast", "Barracuda"]);
function providerAllowed(provider: string, filter: ProviderFilter): boolean {
  if (filter === "google") return provider === "Google";
  if (filter === "no-gateways") return !STRICT_GATEWAYS.has(provider);
  return true;
}

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
  providerFilter?: ProviderFilter;   // "all" (default) | "google" | "no-gateways" — filter by recipient inbox provider (MX)
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

type ApolloMatchResponse = {
  matches?: (ApolloPerson | null)[];
  people?: (ApolloPerson | null)[];
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
 * Apollo wants each employee range as ONE string "min,max" (e.g. "51,200"). A common
 * mistake is splitting the input on commas, which shatters "51,200" into ["51","200"]
 * — Apollo then rejects "[51] is invalid". This repairs both shapes: valid "min,max"
 * pairs pass through; stray lone numbers get paired up two-by-two; garbage is dropped.
 */
export function normalizeEmployeeRanges(ranges: string[]): string[] {
  // Rejoin with commas (this reverses a bad comma-split that shatters "51,200" into
  // ["51","200"] or "51,200 201,500" into ["51","200 201","500"]), then pull out every
  // "min,max" pair left-to-right. Handles clean input and corrupted saved data alike.
  const joined = ranges.map((r) => String(r).trim()).filter(Boolean).join(",");
  return (joined.match(/\d+\s*,\s*\d+/g) ?? []).map((r) => r.replace(/\s+/g, ""));
}

async function apolloPost<T>(apiKey: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${APOLLO_BASE}${path}`, {
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
    throw new Error(`Apollo ${path} failed (${res.status}): ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

/**
 * Run one page of Apollo People Search. As of 2025 this endpoint (`mixed_people/api_search`,
 * which replaced the deprecated `mixed_people/search`) returns people WITHOUT emails or
 * phone numbers — emails must be unlocked separately via bulk enrichment (apolloEnrichPeople).
 * Returns the raw people (with Apollo `id`s) plus pagination.
 */
export async function apolloSearchPage(
  apiKey: string,
  search: ApolloSearch,
  page: number
): Promise<{ people: ApolloPerson[]; totalPages: number; totalEntries: number; rawCount: number }> {
  const body: Record<string, unknown> = {
    page,
    per_page: 100, // always page at the max; api_search returns no pagination object, so we
    // page until a page comes back not-full (see apolloFetchLeads). search.per_page is ignored.
  };
  if (search.person_titles?.length) body.person_titles = search.person_titles;
  if (search.person_seniorities?.length) body.person_seniorities = search.person_seniorities;
  if (search.organization_locations?.length) body.organization_locations = search.organization_locations;
  if (search.organization_num_employees_ranges?.length) {
    const ranges = normalizeEmployeeRanges(search.organization_num_employees_ranges);
    if (ranges.length) body.organization_num_employees_ranges = ranges;
  }
  if (search.q_organization_keyword_tags?.length) body.q_organization_keyword_tags = search.q_organization_keyword_tags;
  if (search.q_keywords?.trim()) body.q_keywords = search.q_keywords.trim();

  const data = await apolloPost<ApolloSearchResponse>(apiKey, "/mixed_people/api_search", body);
  const people = data.people ?? [];
  return {
    people,
    totalPages: data.pagination?.total_pages ?? 1,
    totalEntries: data.pagination?.total_entries ?? people.length,
    rawCount: people.length,
  };
}

/**
 * Unlock emails for up to 10 people via Apollo Bulk People Enrichment (`people/bulk_match`).
 * Matches primarily on the Apollo person `id` returned by search, with name/domain as hints.
 * Consumes Apollo credits per match. Returns the enriched person records (now with emails).
 */
export async function apolloEnrichPeople(
  apiKey: string,
  people: ApolloPerson[],
  revealPersonalEmails = false
): Promise<ApolloPerson[]> {
  const batch = people.slice(0, 10);
  if (batch.length === 0) return [];
  const details = batch.map((p) => ({
    ...(p.id ? { id: p.id } : {}),
    ...(p.first_name ? { first_name: p.first_name } : {}),
    ...(p.last_name ? { last_name: p.last_name } : {}),
    ...(p.name ? { name: p.name } : {}),
    ...(p.organization?.name ? { organization_name: p.organization.name } : {}),
    ...(p.organization?.primary_domain ? { domain: p.organization.primary_domain } : {}),
  }));
  const data = await apolloPost<ApolloMatchResponse>(apiKey, "/people/bulk_match", {
    details,
    reveal_personal_emails: revealPersonalEmails,
  });
  const matches = data.matches ?? data.people ?? [];
  return matches.filter((m): m is ApolloPerson => Boolean(m));
}

/**
 * Stable key for matching a person against existing leads BEFORE enrichment (when we only have
 * name + company, not email). Used to skip dupes before spending an Apollo enrichment credit.
 */
export function leadDedupKey(name: string | null | undefined, company: string | null | undefined): string {
  const n = (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const c = (company || "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${n}|${c}`;
}

/**
 * Pull up to `limit` leads with usable emails: page through search, then enrich each
 * page in batches of 10 to unlock emails, stopping as soon as `limit` usable emails are
 * collected (to bound credit spend). Enrichment is the only way to get emails now.
 *
 * `existingKeys` (name|company keys of leads already in the workspace) lets us skip people we
 * already have BEFORE enriching them — Apollo charges a credit per enrichment, so on a mined-out
 * search this avoids paying to re-reveal emails for duplicates.
 */
export async function apolloFetchLeads(
  apiKey: string,
  search: ApolloSearch,
  limit: number,
  existingKeys?: Set<string>,
  // Optional ICP fit-screen run on title/company/industry BEFORE enrichment, so off-ICP people
  // never cost an enrichment credit. Returns a keep-mask aligned to the input. Fail-safe to keep.
  screenFn?: (cands: Array<{ jobTitle?: string | null; company?: string | null; industry?: string | null }>) => Promise<boolean[]>,
  // Pagination cursor: the page to START scanning from. api_search returns people in a stable
  // order, so restarting at page 1 every pull re-scans (and re-enriches, wasting credits) people we
  // already ingested. Resuming deeper marches forward into fresh people. Caller persists `nextPage`.
  startPage = 1,
  // Emails already in the workspace (lowercased). Enriched results matching these are NOT counted
  // toward `limit` — so `collected` is exactly `limit` NEW leads. Lets the caller ask for `limit`
  // and get ~`limit` (no over-fetch + slice-discard of already-paid-for leads).
  seenEmails?: Set<string>
): Promise<{ leads: NormalizedLead[]; lockedSkipped: number; pagesScanned: number; totalEntries: number; stoppedEarly: boolean; stopReason: string | null; preEnrichDupesSkipped: number; screenedOut: number; nextPage: number; reachedEnd: boolean }> {
  const collected: NormalizedLead[] = [];
  const emailSeen = new Set(seenEmails ? Array.from(seenEmails) : []); // existing + collected-this-run, for dedup
  let lockedSkipped = 0;
  let page = startPage;
  let lastScannedPage = startPage - 1;
  let reachedEnd = false;
  let totalEntries = 0;
  const PER_PAGE = 100;
  const filter: ProviderFilter = search.providerFilter ?? "all";
  // A provider filter drops most people BEFORE the expensive enrichment step (only keepers get
  // enriched), so a filtered pull can afford to scan far deeper to actually net `limit` leads —
  // at ~9% Google density, 25 pages tops out around ~225 Google leads. Unfiltered pulls enrich
  // every person, so they hit `limit` quickly and don't need the extra pages. The longer function
  // budget (maxDuration 300 on the ingest route) is what makes the deeper scan safe.
  // Scale the page budget to the ASK so a larger `limit` can actually be fulfilled (we early-stop the
  // moment `limit` NEW leads are collected, so small pulls stay fast and we never over-scan). At
  // ~40 new leads/page for "all", ~limit/25 pages reaches the target; cap at 40 pages for the 300s
  // function budget. Filtered pulls (google/no-gateways) drop most pre-enrich, so they scan deeper.
  const MAX_PAGES = filter === "all" ? Math.min(40, Math.ceil(limit / 25) + 5) : 80;

  // Domain -> provider cache (shared across pages). When a provider filter is active we
  // classify the company domain by MX BEFORE enriching, so we never spend enrichment credits
  // on a provider we're going to drop (e.g. Proofpoint/Mimecast gateways).
  const provCache = new Map<string, string>();
  const provFor = async (domain: string) => {
    const d = (domain || "").toLowerCase().trim();
    if (!d) return "Unknown";
    if (!provCache.has(d)) provCache.set(d, await classifyEmailProvider(`x@${d}`));
    return provCache.get(d)!;
  };

  // If Apollo throws mid-pull (most importantly: OUT OF CREDITS, but also rate limits / transient
  // errors), we must NOT discard the leads already enriched — those cost credits. Catch the error,
  // stop, and RETURN what we've collected so the caller still saves it. `stoppedEarly` flags it.
  let stoppedEarly = false;
  let stopReason: string | null = null;
  // Pre-enrichment dedup: skip people already in the workspace (existingKeys) or already pulled
  // earlier in THIS run (pulledKeys) before paying a credit to enrich them.
  const pulledKeys = new Set<string>();
  let preEnrichDupesSkipped = 0;
  let screenedOut = 0;
  const personName = (p: ApolloPerson) => p.name || [p.first_name, p.last_name].filter(Boolean).join(" ");
  const lastAllowedPage = startPage + MAX_PAGES - 1;
  outer: while (collected.length < limit && page <= lastAllowedPage) {
    let res: Awaited<ReturnType<typeof apolloSearchPage>>;
    try {
      res = await apolloSearchPage(apiKey, search, page);
    } catch (err) {
      stoppedEarly = true; stopReason = err instanceof Error ? err.message : "search failed";
      break;
    }
    lastScannedPage = page;
    totalEntries += res.rawCount;
    if (res.rawCount === 0) { reachedEnd = true; break; } // ran past the end of the result set

    let people = res.people;

    // Dedup BEFORE enriching (free) so we never spend a credit on someone we already have or
    // already pulled this run. Match on name|company (email isn't known until enrichment).
    people = people.filter((p) => {
      const key = leadDedupKey(personName(p), p.organization?.name);
      if (key === "|") return true; // no name/company to key on — let enrichment decide
      if ((existingKeys && existingKeys.has(key)) || pulledKeys.has(key)) { preEnrichDupesSkipped += 1; return false; }
      pulledKeys.add(key);
      return true;
    });

    // Provider pre-filter (only when active): classify each person's company domain and
    // keep only allowed providers, so enrichment credits are spent on keepers only.
    if (filter !== "all") {
      const domains = Array.from(new Set(people.map((p) => p.organization?.primary_domain || "").filter(Boolean)));
      const C = 25;
      for (let i = 0; i < domains.length; i += C) await Promise.all(domains.slice(i, i + C).map((d) => provFor(d)));
      people = people.filter((p) => {
        const dom = (p.organization?.primary_domain || "").toLowerCase().trim();
        return dom && providerAllowed(provCache.get(dom) ?? "Unknown", filter);
      });
    }

    // ICP fit-screen BEFORE enrichment (free Claude check on title/company/industry) so we never
    // spend an enrichment credit on an off-ICP lead. Fail-safe: keep on any error.
    if (screenFn && people.length > 0) {
      let mask: boolean[];
      try { mask = await screenFn(people.map((p) => ({ jobTitle: p.title, company: p.organization?.name, industry: p.organization?.industry }))); }
      catch { mask = people.map(() => true); }
      const before = people.length;
      people = people.filter((_, i) => mask[i] !== false);
      screenedOut += before - people.length;
    }

    for (let i = 0; i < people.length && collected.length < limit; i += 10) {
      let enriched: ApolloPerson[];
      try {
        enriched = await apolloEnrichPeople(apiKey, people.slice(i, i + 10));
      } catch (err) {
        // Out of credits / API error mid-enrichment: keep everything collected so far and stop.
        stoppedEarly = true; stopReason = err instanceof Error ? err.message : "enrichment failed";
        break outer;
      }
      for (const e of enriched) {
        const lead = toNormalizedLead(e);
        if (lead) {
          // Dedup by email against existing + this-run: a dupe was still enriched (email unknown
          // until now), but we DON'T count it toward `limit` — so `collected` is `limit` NEW leads,
          // not `limit` total. In forward (cursor) territory dupes are rare, so this is efficient.
          const ek = lead.email.toLowerCase().trim();
          if (emailSeen.has(ek)) continue;
          emailSeen.add(ek);
          // Stamp provider only when a filter is active (cache already warm). When filter is
          // "all" we skip MX here to keep ingest fast — the daily cron backfills providers.
          if (filter !== "all") lead.emailProvider = await provFor((lead.email.split("@")[1] || ""));
          collected.push(lead);
          if (collected.length >= limit) break outer;
        } else {
          lockedSkipped += 1;
        }
      }
    }
    if (res.rawCount < PER_PAGE) { reachedEnd = true; break; } // last (partial) page of results
    page += 1;
  }
  // Where the NEXT pull should resume. If we ran out of results, wrap back to page 1. Otherwise
  // continue past the last page we scanned. Cap well under Apollo's ~50k-record (page ~500) ceiling.
  let nextPage = reachedEnd ? 1 : lastScannedPage + 1;
  if (nextPage > 450) nextPage = 1;

  return { leads: collected, lockedSkipped, pagesScanned: lastScannedPage - startPage + 1, totalEntries, stoppedEarly, stopReason, preEnrichDupesSkipped, screenedOut, nextPage, reachedEnd };
}
