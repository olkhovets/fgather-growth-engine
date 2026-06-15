import { prisma } from "@/lib/prisma";
import { apolloFetchLeads, leadDedupKey, type ApolloSearch } from "@/lib/apollo";
import { createBatchWithLeads, type NormalizedLead } from "@/lib/leads";
import { verifyEmailBatch } from "@/lib/verify-email";
import { logActivity } from "@/lib/activity";

export type IngestResult = {
  workspaceId: string;
  batchId: string | null;
  fetched: number;
  inserted: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  lockedSkipped: number;
  message: string;
};

/**
 * Pull leads from Apollo for one workspace, dedupe against everyone ever
 * contacted, optionally verify emails, and create a fresh batch.
 * Shared by the Apollo ingest route and the autopilot orchestrators.
 */
export async function ingestForWorkspace(
  workspaceId: string,
  apolloApiKey: string,
  search: ApolloSearch,
  limit: number,
  zeroBounceKey?: string | null,
  personaTag?: string
): Promise<IngestResult> {
  // Load everyone already in the workspace ONCE — used both to dedup BEFORE enriching (by
  // name|company, to save Apollo credits) and to dedup AFTER enriching (by email, authoritative).
  const existing = await prisma.lead.findMany({
    where: { leadBatch: { workspaceId } },
    select: { email: true, name: true, company: true },
  });
  const seen = new Set(existing.map((r) => r.email.toLowerCase().trim()));
  const existingKeys = new Set(existing.map((r) => leadDedupKey(r.name, r.company)));

  // Build the ICP fit-screen as a PRE-enrichment callback (title/company/industry only) so off-ICP
  // people are dropped BEFORE we spend an enrichment credit on them. Fail-safe: keep on error.
  const wsScreen = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { anthropicKey: true, anthropicModel: true, icp: true, productSummary: true },
  });
  let screenFn: ((cands: Array<{ jobTitle?: string | null; company?: string | null; industry?: string | null }>) => Promise<boolean[]>) | undefined;
  if (wsScreen?.anthropicKey && wsScreen.icp?.trim()) {
    const { decrypt: dec } = await import("@/lib/encryption");
    const { screenLeadsForFit } = await import("@/lib/lead-screener");
    const aKey = dec(wsScreen.anthropicKey);
    const model = wsScreen.anthropicModel ?? "claude-haiku-4-5";
    const icp = wsScreen.icp;
    const ps = wsScreen.productSummary ?? "";
    screenFn = async (cands) => {
      const { keep } = await screenLeadsForFit(cands.map((c) => ({ email: "", company: c.company, jobTitle: c.jobTitle, industry: c.industry })), icp, ps, aKey, model);
      const keepSet = new Set(keep);
      return cands.map((_, i) => keepSet.has(i));
    };
  }

  // Over-fetch a bit so that after dedupe we still land near `limit`. Pass existingKeys (skip dupes
  // before enriching) and screenFn (skip off-ICP before enriching) — both save Apollo credits.
  const { leads: fetched, lockedSkipped, stoppedEarly, stopReason, preEnrichDupesSkipped, screenedOut } = await apolloFetchLeads(apolloApiKey, search, Math.ceil(limit * 1.5), existingKeys, screenFn);
  const earlyNote = stoppedEarly ? ` (Apollo stopped the pull early: ${stopReason} — the leads enriched before that ARE saved below)` : "";

  if (fetched.length === 0) {
    return {
      workspaceId, batchId: null, fetched: 0, inserted: 0, skippedDuplicate: 0,
      skippedInvalid: 0, lockedSkipped,
      message: lockedSkipped > 0
        ? `Apollo returned ${lockedSkipped} people but all emails were locked. Check your Apollo plan/credits for email access.`
        : "Apollo returned no matching people for this search.",
    };
  }

  // Post-enrichment dedupe by EMAIL (authoritative) — catches anything the name|company
  // pre-filter missed (e.g. name formatted differently). Uses the `seen` set built above.
  let deduped: NormalizedLead[] = [];
  const localSeen = new Set<string>();
  for (const l of fetched) {
    const key = l.email.toLowerCase().trim();
    if (seen.has(key) || localSeen.has(key)) continue;
    localSeen.add(key);
    deduped.push(l);
  }
  const preDedupSkipped = fetched.length - deduped.length;
  deduped = deduped.slice(0, limit);
  // (Off-ICP screening now happens PRE-enrichment inside apolloFetchLeads — screenedOut above.)

  if (deduped.length === 0) {
    return {
      workspaceId, batchId: null, fetched: fetched.length, inserted: 0,
      skippedDuplicate: preDedupSkipped, skippedInvalid: 0, lockedSkipped,
      message: "All Apollo results were already in your workspace (duplicates).",
    };
  }

  // Optional email verification — drop confirmed-invalid addresses to protect deliverability
  let skippedInvalid = 0;
  let verified = deduped;
  if (zeroBounceKey) {
    try {
      const results = await verifyEmailBatch(deduped.map((l) => l.email), zeroBounceKey);
      verified = deduped.filter((l) => results.get(l.email) !== "invalid");
      skippedInvalid = deduped.length - verified.length;
    } catch {
      verified = deduped; // verification is best-effort; never block ingestion on it
    }
  }

  if (verified.length === 0) {
    return {
      workspaceId, batchId: null, fetched: fetched.length, inserted: 0,
      skippedDuplicate: preDedupSkipped, skippedInvalid, lockedSkipped,
      message: "All fetched emails failed verification.",
    };
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  const { batchId, count, skippedDuplicate } = await createBatchWithLeads(workspaceId, verified, {
    batchName: `Apollo ${dateLabel}`,
    dedupe: true,
  });

  await logActivity(workspaceId, "ingest",
    `Ingested ${count} new leads from Apollo${screenedOut > 0 ? ` (${screenedOut} screened out as off-ICP)` : ""}${preEnrichDupesSkipped > 0 ? `; skipped ${preEnrichDupesSkipped} known leads before enriching (saved credits)` : ""}${earlyNote}`,
    { ingested: count, fetched: fetched.length, preEnrichDupesSkipped, duplicatesSkipped: preDedupSkipped + skippedDuplicate, invalidSkipped: skippedInvalid, screenedOut, lockedSkipped, stoppedEarly, stopReason });

  return {
    workspaceId,
    batchId,
    fetched: fetched.length,
    inserted: count,
    skippedDuplicate: preDedupSkipped + skippedDuplicate,
    skippedInvalid,
    lockedSkipped,
    message: `Ingested ${count} new leads into "Apollo ${dateLabel}"${screenedOut > 0 ? `, ${screenedOut} screened out as off-ICP` : ""}${earlyNote}. Generate sequences, then launch.`,
  };
}

/** Load the saved Apollo search for a workspace. */
export async function loadSearch(workspaceId: string): Promise<ApolloSearch | null> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { apolloSearchJson: true },
  });
  if (!ws?.apolloSearchJson) return null;
  try {
    return JSON.parse(ws.apolloSearchJson) as ApolloSearch;
  } catch {
    return null;
  }
}
