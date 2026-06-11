import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { type ApolloSearch } from "@/lib/apollo";
import { ingestForWorkspace, loadSearch, type IngestResult } from "@/lib/apollo-ingest";

export const dynamic = "force-dynamic";
// 300s (Vercel's current max on all plans) so a provider-filtered pull can scan deep enough to
// actually net a real-volume batch of Google leads instead of stalling at ~225 inside 60s.
export const maxDuration = 300;

// Default per-run ingest size. Large enough to feed the funnel in one go,
// small enough to stay within Apollo credits and the function timeout.
const DEFAULT_INGEST_LIMIT = 250;

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
    const limit = Math.min(1000, Math.max(1, body.limit ?? DEFAULT_INGEST_LIMIT));

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
