import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { apolloEnrichPeople, leadDedupKey, type ApolloPerson } from "@/lib/apollo";
import { classifyEmailProvider } from "@/lib/email-provider";
import { verifyEmail } from "@/lib/verify-email";
import { personaForTitle } from "@/lib/apollo-personas";
import { createBatchWithLeads, type NormalizedLead } from "@/lib/leads";
import { packSignal } from "@/lib/signal-store";
import { parseResearchUpload, type RejectedRow } from "@/lib/research-csv";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_CALL = 500;

/**
 * SIGNAL INGEST — the closed loop from your deep-research agents into the email engine.
 *
 * You send a BULK list of people you found (name + company + the SIGNAL/insight + its source).
 * This: (1) resolves each email from name+company via Apollo enrichment (bulk_match — the cheap,
 * targeted use, one credit per person you actually want), (2) verifies it, (3) dedupes against
 * existing leads AND within the upload, (4) creates a lead with the signal stored so generation
 * opens the email on it.
 *
 * It NEVER sends and NEVER auto-generates — it stages reply-ready, signal-carrying leads for the
 * normal gated pipeline. Spends Apollo enrichment credits (operator's key), so it's an operator action.
 *
 * Accepts EITHER:
 *   - a pasted/uploaded CSV or TSV (spreadsheet copy works): { csv: "<text>" }  (or { text }, or raw text body)
 *     Columns (header row, any order, human names ok): name, company, signal, source?, title?, domain?
 *   - structured JSON: { leads: [{ name, company, signal, source?, title?, domain?, website? }] }
 * Plus optional { workspaceId } (cron auth) and { batchName }.
 */

type InputLead = { name?: string; company?: string; domain?: string; title?: string; website?: string; signal?: string; source?: string };

function splitName(full?: string): { first?: string; last?: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function domainOf(l: InputLead): string | undefined {
  const raw = (l.domain || l.website || "").trim();
  if (!raw) return undefined;
  return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] || undefined;
}

export async function POST(request: Request) {
  try {
    // Accept JSON ({leads}|{csv}|{text}) OR a raw CSV/TSV text body.
    const contentType = request.headers.get("content-type") || "";
    let body: Record<string, unknown> = {};
    let rawText = "";
    if (contentType.includes("application/json")) {
      body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    } else {
      rawText = await request.text().catch(() => "");
      // A raw body might still be JSON sent without the header — try to parse, else treat as CSV text.
      try { body = JSON.parse(rawText) as Record<string, unknown>; rawText = ""; } catch { /* it's CSV text */ }
    }
    const cron = process.env.CRON_SECRET;
    const workspaceIdParam = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const viaCron = Boolean(cron && request.headers.get("x-cron-secret") === cron && workspaceIdParam);

    let ws: { id: string; apolloApiKey: string | null } | null = null;
    if (viaCron) {
      ws = await prisma.workspace.findUnique({ where: { id: workspaceIdParam }, select: { id: true, apolloApiKey: true } });
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) return NextResponse.json({ error: "Please log in." }, { status: 401 });
      ws = await prisma.workspace.findUnique({ where: { userId: session.user.id }, select: { id: true, apolloApiKey: true } });
    }
    if (!ws) return NextResponse.json({ error: "No workspace." }, { status: 400 });
    if (!ws.apolloApiKey) return NextResponse.json({ error: "Apollo API key not configured (needed to resolve emails)." }, { status: 400 });

    // Gather input from whichever shape was sent, and track rows we reject up front so nothing vanishes.
    let input: InputLead[] = [];
    let rejected: RejectedRow[] = [];
    if (Array.isArray(body.leads)) {
      input = body.leads as InputLead[];
    } else {
      const csvText = rawText || (typeof body.csv === "string" ? body.csv : "") || (typeof body.text === "string" ? body.text : "");
      if (csvText.trim()) {
        const parsed = parseResearchUpload(csvText);
        input = parsed.rows.map((r) => ({ name: r.name, company: r.company, signal: r.signal, source: r.source, title: r.title, domain: r.domain }));
        rejected = parsed.rejected;
      }
    }

    // A JSON lead still needs name + company + signal to be worth a credit; reject (don't drop) the rest.
    const clean: InputLead[] = [];
    input.forEach((l, i) => {
      const name = (l?.name || "").trim(), company = (l?.company || "").trim(), signal = (l?.signal || "").trim();
      const missing = [!name && "name", !company && "company", !signal && "signal"].filter(Boolean);
      if (missing.length) { rejected.push({ row: i + 1, reason: `missing ${missing.join(" + ")}`, raw: `${name || "?"} / ${company || "?"}` }); return; }
      clean.push({ ...l, name, company, signal });
    });

    // Dedupe WITHIN the upload itself (same person listed twice) before anything hits Apollo.
    const seenInFile = new Set<string>();
    let dupesInFile = 0;
    const deduped = clean.filter((l) => {
      const k = leadDedupKey(l.name, l.company);
      if (seenInFile.has(k)) { dupesInFile += 1; return false; }
      seenInFile.add(k);
      return true;
    });

    if (deduped.length === 0) {
      return NextResponse.json({ error: "No usable rows. Each needs name + company + signal.", rejected: rejected.slice(0, 50), dupesInFile }, { status: 400 });
    }
    if (deduped.length > MAX_PER_CALL) {
      return NextResponse.json({ error: `Max ${MAX_PER_CALL} per call — split into batches (got ${deduped.length}).` }, { status: 400 });
    }

    const apolloKey = decrypt(ws.apolloApiKey);

    // 1) Dedupe against existing leads by name+company BEFORE spending an enrichment credit.
    const existing = await prisma.lead.findMany({ where: { leadBatch: { workspaceId: ws.id } }, select: { name: true, company: true } });
    const existingKeys = new Set(existing.map((e) => leadDedupKey(e.name, e.company)));
    const fresh = deduped.filter((l) => !existingKeys.has(leadDedupKey(l.name, l.company)));
    const skippedDupes = deduped.length - fresh.length;

    // 2) Enrich emails via Apollo bulk_match (name + company [+ domain]) in batches of 10.
    const resolved: Array<{ input: InputLead; email: string; title?: string; industry?: string; website?: string }> = [];
    const unresolved: Array<{ name?: string; company?: string }> = [];
    for (let i = 0; i < fresh.length; i += 10) {
      const slice = fresh.slice(i, i + 10);
      const people: ApolloPerson[] = slice.map((l) => {
        const { first, last } = splitName(l.name);
        return { first_name: first, last_name: last, name: l.name, organization: { name: l.company, primary_domain: domainOf(l) } } as ApolloPerson;
      });
      let matches: ApolloPerson[] = [];
      try { matches = await apolloEnrichPeople(apolloKey, people, false); } catch { matches = []; }
      // Map matches back to the input. Prefer name+company key; fall back to name-only, since
      // Apollo may echo a slightly different company name ("Apple" vs "Apple Inc.") and we don't
      // want to lose the signal association over that. Names are unique enough within a 10-person slice.
      const matchName = (m: ApolloPerson) => m.name ?? `${m.first_name ?? ""} ${m.last_name ?? ""}`;
      const byKey = new Map<string, ApolloPerson>();
      const byName = new Map<string, ApolloPerson>();
      for (const m of matches) {
        byKey.set(leadDedupKey(matchName(m), m.organization?.name), m);
        byName.set(leadDedupKey(matchName(m), ""), m);
      }
      for (const l of slice) {
        const m = byKey.get(leadDedupKey(l.name, l.company)) ?? byName.get(leadDedupKey(l.name, ""));
        const email = m?.email?.trim();
        if (m && email && !email.includes("not_unlocked") && /@/.test(email)) {
          resolved.push({ input: l, email, title: m.title ?? l.title, industry: m.organization?.industry ?? undefined, website: m.organization?.primary_domain ?? domainOf(l) });
        } else {
          unresolved.push({ name: l.name, company: l.company });
        }
      }
    }

    if (resolved.length === 0) {
      return NextResponse.json({ ok: true, created: 0, skippedDupes, dupesInFile, rejected: rejected.length, rejectedRows: rejected.slice(0, 50), unresolved: unresolved.length, message: `No emails resolved (${unresolved.length} not found in Apollo, ${skippedDupes} already-in-DB dupes, ${dupesInFile} in-file dupes, ${rejected.length} bad rows).` });
    }

    // 3) Verify + provider-classify, then create leads via the shared batch path.
    const normalized: NormalizedLead[] = [];
    const signalByEmail = new Map<string, { hook: string; source: string }>();
    for (const r of resolved) {
      let ok = true;
      try { const v = await verifyEmail(r.email); ok = v !== "invalid"; } catch { ok = true; } // fail-open on unknown/verifier error
      if (!ok) { unresolved.push({ name: r.input.name, company: r.input.company }); continue; }
      const provider = await classifyEmailProvider(r.email).catch(() => undefined);
      normalized.push({
        email: r.email, name: r.input.name, jobTitle: r.title, company: r.input.company,
        website: r.website ? `https://${r.website.replace(/^https?:\/\//, "")}` : r.input.website, industry: r.industry, emailProvider: provider,
      });
      if (r.input.signal?.trim()) signalByEmail.set(r.email.toLowerCase(), { hook: r.input.signal.trim(), source: (r.input.source || "").trim() });
    }
    if (normalized.length === 0) {
      return NextResponse.json({ ok: true, created: 0, skippedDupes, dupesInFile, rejected: rejected.length, unresolved: unresolved.length, message: "No emails passed verification." });
    }

    const batchName = typeof body.batchName === "string" && body.batchName.trim() ? body.batchName.trim() : `Signal ingest ${new Date().toISOString().slice(0, 10)}`;
    const { batchId, count } = await createBatchWithLeads(ws.id, normalized, { batchName, dedupe: true });

    // 4) Stamp each created lead with its research signal (opener) + persona from the resolved title.
    const created = await prisma.lead.findMany({ where: { leadBatchId: batchId }, select: { id: true, email: true, jobTitle: true } });
    let stamped = 0;
    for (const lead of created) {
      const sig = signalByEmail.get((lead.email || "").toLowerCase());
      const data: Record<string, string | null> = { persona: personaForTitle(lead.jobTitle) };
      if (sig) { data.landingPageContentJson = packSignal(sig); stamped += 1; }
      await prisma.lead.update({ where: { id: lead.id }, data });
    }

    return NextResponse.json({
      ok: true,
      batchId,
      batchName,
      received: input.length,
      created: count,
      withSignal: stamped,
      skippedDupes,        // already in your DB
      dupesInFile,         // listed twice in the upload
      rejected: rejected.length,   // rows missing name/company/signal
      rejectedRows: rejected.slice(0, 50),
      unresolved: unresolved.length,   // Apollo couldn't find / verify an email
      unresolvedList: unresolved.slice(0, 25),
      message: `Ingested ${count} lead(s), ${stamped} carrying a research signal. Skipped ${skippedDupes} already-in-DB + ${dupesInFile} in-file dupes; ${rejected.length} rows rejected (bad format); ${unresolved.length} emails not resolved. Staged in "${batchName}" — ready to generate + send.`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Signal ingest failed" }, { status: 500 });
  }
}
