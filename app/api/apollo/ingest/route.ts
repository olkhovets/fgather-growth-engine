import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { apolloFetchLeads, type ApolloSearch } from "@/lib/apollo";
import { createBatchWithLeads, type NormalizedLead } from "@/lib/leads";
import { verifyEmailBatch } from "@/lib/verify-email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Default per-run ingest size. Large enough to feed the funnel in one go,
// small enough to stay within Apollo credits and the function timeout.
const DEFAULT_INGEST_LIMIT = 250;

type IngestResult = {
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
 */
async function ingestForWorkspace(
  workspaceId: string,
  apolloApiKey: string,
  search: ApolloSearch,
  limit: number,
  zeroBounceKey?: string | null
): Promise<IngestResult> {
  // Over-fetch a bit so that after dedupe we still land near `limit`
  const { leads: fetched, lockedSkipped } = await apolloFetchLeads(apolloApiKey, search, Math.ceil(limit * 1.5));

  if (fetched.length === 0) {
    return {
      workspaceId, batchId: null, fetched: 0, inserted: 0, skippedDuplicate: 0,
      skippedInvalid: 0, lockedSkipped,
      message: lockedSkipped > 0
        ? `Apollo returned ${lockedSkipped} people but all emails were locked. Check your Apollo plan/credits for email access.`
        : "Apollo returned no matching people for this search.",
    };
  }

  // Pre-dedupe against everyone already in the workspace so we don't waste verification credits
  const existing = await prisma.lead.findMany({
    where: { leadBatch: { workspaceId } },
    select: { email: true },
  });
  const seen = new Set(existing.map((r) => r.email.toLowerCase().trim()));
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

  return {
    workspaceId,
    batchId,
    fetched: fetched.length,
    inserted: count,
    skippedDuplicate: preDedupSkipped + skippedDuplicate,
    skippedInvalid,
    lockedSkipped,
    message: `Ingested ${count} new leads into batch "Apollo ${dateLabel}". Generate sequences, then launch.`,
  };
}

async function loadSearch(workspaceId: string): Promise<ApolloSearch | null> {
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

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { userId: session.user.id },
      select: { id: true, apolloApiKey: true, apolloSearchJson: true },
    });
    if (!workspace?.apolloApiKey) {
      return NextResponse.json({ error: "Apollo API key not configured. Save it in Apollo settings first." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { search?: ApolloSearch; limit?: number };
    const search = body.search ?? (await loadSearch(workspace.id));
    if (!search) {
      return NextResponse.json({ error: "No Apollo search configured. Save search filters first or pass them in the request." }, { status: 400 });
    }
    const limit = Math.min(500, Math.max(1, body.limit ?? DEFAULT_INGEST_LIMIT));

    const result = await ingestForWorkspace(
      workspace.id,
      decrypt(workspace.apolloApiKey),
      search,
      limit,
      process.env.ZEROBOUNCE_API_KEY ?? null
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apollo ingest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Cron entrypoint: ingest the daily quota for every workspace with Apollo configured. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const workspaces = await prisma.workspace.findMany({
    where: { apolloApiKey: { not: null }, apolloSearchJson: { not: null } },
    select: { id: true, apolloApiKey: true },
  });
  const results: IngestResult[] = [];
  for (const ws of workspaces) {
    if (!ws.apolloApiKey) continue;
    const search = await loadSearch(ws.id);
    if (!search) continue;
    try {
      const r = await ingestForWorkspace(
        ws.id, decrypt(ws.apolloApiKey), search, DEFAULT_INGEST_LIMIT, process.env.ZEROBOUNCE_API_KEY ?? null
      );
      results.push(r);
    } catch (err) {
      results.push({
        workspaceId: ws.id, batchId: null, fetched: 0, inserted: 0, skippedDuplicate: 0,
        skippedInvalid: 0, lockedSkipped: 0,
        message: err instanceof Error ? err.message : "ingest failed",
      });
    }
  }
  return NextResponse.json({ results, total: results.length });
}
