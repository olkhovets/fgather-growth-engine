"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

/**
 * Recycle prior leads — re-contact people already emailed (e.g. an old/under-performing campaign)
 * with the gift offer. Standalone + always-visible (not buried in the offer accordion), because this
 * is a primary action. Two styles:
 *   - "specialist" (DEFAULT): each lead gets its own AI-written per-company specialist-proof email
 *     (prepared via /api/leads/generate recycle mode, then sent via /api/incentives/launch
 *     useGeneratedSteps). Costs Claude tokens; needs a batch selected.
 *   - "templates": the shared credentialed gift-offer bodies (free, instant; uses the saved offer config).
 * Both reuse the proven recycle pipeline: skips repliers/bounces/suppressed, honors the cooldown +
 * 2x re-touch cap, sends paced through warmed inboxes, and is tracked in Results (by amount/gift/style).
 * Sending — and, for per-company, the AI writing spend — stay operator clicks. Nothing auto-fires here.
 */

const PROVIDER_FILTER = "google" as const; // recommended deliverability default
const WARMED_ONLY = true;

export default function RecycleCard() {
  const { data: session } = useSession();
  const [batches, setBatches] = useState<Array<{ id: string; name: string | null; leadCount: number }>>([]);
  const [batchId, setBatchId] = useState("");
  const [style, setStyle] = useState<"templates" | "specialist">("specialist"); // per-company is the default
  const [limit, setLimit] = useState("400");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<{ total: number; google: number; noGateways: number; cooldownDays: number } | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/leads").then((r) => r.json()).then((d) => setBatches(d.batches ?? [])).catch(() => {});
  }, [session?.user?.id]);

  const refreshCount = useCallback(() => {
    if (!session?.user?.id) return;
    const q = batchId ? `recycle=true&batchId=${encodeURIComponent(batchId)}` : "recycle=true";
    fetch(`/api/incentives/eligibility?${q}`).then((r) => r.json()).then((d) => { if (!d.error) setEligibility(d); }).catch(() => {});
  }, [batchId, session?.user?.id]);

  useEffect(() => { setEligibility(null); refreshCount(); }, [refreshCount]);

  // Templates recycle: send shared merge-template bodies (no config sent → server uses saved offer config).
  const recycleTemplates = async () => {
    setBusy(true); setMessage(null);
    try {
      const res = await fetch("/api/incentives/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recycle: true, ...(batchId ? { batchId } : {}), sendLimit: parseInt(limit) || 400, providerFilter: PROVIDER_FILTER, warmedInboxesOnly: WARMED_ONLY }) });
      const d = await res.json();
      const inboxBit = d.warmedInboxes != null ? ` from ${d.warmedInboxes} warmed inboxes` : "";
      const verb = d.mode === "appended" ? "Appended" : "Launched";
      setMessage(d.error ? d.error : `Recycle (templates): ${verb} ${d.totalUploaded} prior leads into "${d.campaignName}"${inboxBit}. Repeat to drain the pool.`);
      refreshCount();
    } catch { setMessage("Recycle failed."); } finally { setBusy(false); }
  };

  // Per-company recycle: AI-write specialist-proof for recycle-eligible leads (paced/chunked), then send.
  const recyclePerCompany = async () => {
    if (!batchId) { setMessage("Pick a lead batch first — per-company writing needs a batch to scope to."); return; }
    const target = Math.max(1, parseInt(limit) || 400);
    setBusy(true);
    setMessage("Preparing per-company emails — AI writes each one, this can take a few minutes for a big batch…");
    try {
      let prepared = 0;
      const maxRounds = Math.ceil(target / 5) + 10; // generation does ~10/round; generous guard
      for (let round = 0; round < maxRounds && prepared < target; round++) {
        const r = await fetch("/api/leads/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, style: "specialist-proof", recycle: true, useFastModel: true }) });
        const d = await r.json();
        if (d.error) { setMessage(`Preparation stopped: ${d.error}`); break; }
        const done = d.done ?? 0;
        prepared += done;
        setMessage(`Prepared ${prepared} per-company emails…`);
        if (done === 0) break;
        await new Promise((res) => setTimeout(res, 300));
      }
      const res = await fetch("/api/incentives/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recycle: true, useGeneratedSteps: true, batchId, sendLimit: target, providerFilter: PROVIDER_FILTER, warmedInboxesOnly: WARMED_ONLY }) });
      const d = await res.json();
      if (d.error) { setMessage(d.error); }
      else {
        const inboxBit = d.warmedInboxes != null ? ` from ${d.warmedInboxes} warmed inboxes` : "";
        const skipBit = d.skipped > 0 ? ` (${d.skipped} eligible but not yet prepared — run again to catch them)` : "";
        const verb = d.mode === "appended" ? "Appended" : "Launched";
        setMessage(`Per-company recycle: ${verb} ${d.totalUploaded} AI-written emails into "${d.campaignName}"${inboxBit}${skipBit}. Tracked in Results as the "specialist-proof" arm.`);
      }
      refreshCount();
    } catch { setMessage("Per-company recycle failed."); } finally { setBusy(false); }
  };

  const cooldown = eligibility?.cooldownDays ?? 21;
  const noneEligible = eligibility != null && eligibility.total === 0;

  return (
    <div className="mb-6 card p-6 space-y-4 border-l-4" style={{ borderLeftColor: "#b45309" }}>
      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recycle prior leads</h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
          Re-contact people you already emailed (e.g. an old or under-performing campaign) with the gift offer. Skips anyone who replied, bounced, or is suppressed; only re-touches leads past the {cooldown}-day cooldown, capped at 2 re-touches each; paced through warmed inboxes into a tracked recycle campaign. No Apollo credits used.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Lead batch (the prior campaign to recycle)</label>
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
          <option value="">All prior leads (whole workspace)</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name ?? b.id} ({b.leadCount})</option>)}
        </select>
        {eligibility && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span><strong style={{ color: "var(--text-primary)" }}>{eligibility.total.toLocaleString()}</strong> eligible to recycle</span>
            <span style={{ color: "#16a34a" }}>{eligibility.google.toLocaleString()} Google</span>
            <span>{eligibility.noGateways.toLocaleString()} non-gateway</span>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Email style</label>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setStyle("specialist")} className="text-xs rounded-full px-3 py-1.5 border" style={{ borderColor: style === "specialist" ? "var(--accent)" : "var(--border)", background: style === "specialist" ? "var(--accent)" : "var(--surface)", color: style === "specialist" ? "#fff" : "var(--text-secondary)" }}>Per-company (specialist-proof, AI) — default</button>
          <button onClick={() => setStyle("templates")} className="text-xs rounded-full px-3 py-1.5 border" style={{ borderColor: style === "templates" ? "var(--accent)" : "var(--border)", background: style === "templates" ? "var(--accent)" : "var(--surface)", color: style === "templates" ? "#fff" : "var(--text-secondary)" }}>Templates (free, instant)</button>
        </div>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-tertiary)" }}>
          {style === "specialist"
            ? <><strong style={{ color: "var(--text-primary)" }}>Per-company:</strong> AI writes a unique email per lead — a specific read on their company, then real Gather proof + the gift. Best reply rate. Costs Claude tokens to write each one, and needs a batch selected. Tracked in Results as the “specialist-proof” arm.</>
            : <><strong style={{ color: "var(--text-primary)" }}>Templates:</strong> the shared credentialed gift-offer bodies (free, sends instantly). Same proof + gift, not personalized per company.</>}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Max per batch (rate)</label>
          <input type="number" min={1} max={2000} value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
        </div>
        {style === "specialist" ? (
          <button onClick={recyclePerCompany} disabled={busy || !batchId || noneEligible} className="btn-primary">{busy ? "Working…" : "Prepare & recycle (per-company)"}</button>
        ) : (
          <button onClick={recycleTemplates} disabled={busy || noneEligible} className="btn-primary">{busy ? "Recycling…" : "Recycle now (paced)"}</button>
        )}
      </div>
      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
        {style === "specialist"
          ? "Each click writes (with AI) up to this many per-company emails, then sends them — paced through your warmed inboxes. A big batch takes a few minutes to write. Repeat to drain the pool."
          : "Each click sends up to this many, paced through your warmed inboxes. Repeat daily (or click a few times) to drain the pool at a deliverability-safe rate."}
        {style === "specialist" && !batchId && <span style={{ color: "#b45309" }}> Select a lead batch above to enable per-company.</span>}
      </p>

      {message && <div className="rounded-lg border-l-4 px-3 py-2" style={{ borderLeftColor: "var(--accent)", background: "var(--surface)" }}><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p></div>}
    </div>
  );
}
