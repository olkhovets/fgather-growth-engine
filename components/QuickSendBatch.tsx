"use client";

import { useState, useCallback } from "react";

type Progress = { sent: number; target: number; generated: number; sendSideSkipped: number; rounds: number; done: boolean; note: string };

/**
 * TEMPORARY "Quick Send" dropdown — a chat-driven experiment, intentionally marked as not-permanent.
 * One spot to just launch: pick how many, the quality bar, and recipients, then send a grade-checked
 * batch of good emails (per-persona styles + guaranteed incentive share) via /api/send-batch.
 * Collapsed by default and visually flagged so it's clear this isn't a core feature.
 */
export default function QuickSendBatch({ home = false, defaultCount = "200" }: { home?: boolean; defaultCount?: string } = {}) {
  const [count, setCount] = useState(defaultCount);
  const [minGrade, setMinGrade] = useState("85");
  const [provider, setProvider] = useState(home ? "all" : "no-gateways");
  const [src, setSrc] = useState<"recycle" | "new">("recycle");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loop: keep sending NEW eligible leads until we actually hit the target (or the pool runs out).
  // Each round excludes the ids already tried, so it walks through sendable leads instead of re-picking
  // the same skipped ones. Skip stats accumulate and stay visible.
  const send = useCallback(async () => {
    const target = Math.max(1, Number(count) || 0);
    setBusy(true); setError(null);
    setProg({ sent: 0, target, generated: 0, sendSideSkipped: 0, rounds: 0, done: false, note: "Writing fresh founder emails…" });
    const attempted: string[] = [];
    let sent = 0, generated = 0, sendSide = 0, rounds = 0;
    const MAX_ROUNDS = 40;
    try {
      while (sent < target && rounds < MAX_ROUNDS) {
        const r = await fetch("/api/send-batch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          // quirky test: write (almost) everything FRESH so no old long drafts slip through; source toggle.
          body: JSON.stringify({ count: target - sent, minGrade: Number(minGrade) || 85, providerFilter: provider, excludeIds: attempted, source: rounds === 0 ? src : "recycle", founderShare: 0.9, deepResearch: deep }),
        });
        const d = await r.json();
        if (!r.ok) { setError(d.error || "Send failed."); break; }
        sent += d.sent || 0;
        generated += d.generated || 0;
        sendSide += d.sendSideSkipped || 0;
        rounds += 1;
        for (const id of d.attemptedIds || []) attempted.push(id);
        const exhausted = (d.chosen || 0) === 0 && (d.generated || 0) === 0;
        setProg({ sent, target, generated, sendSideSkipped: sendSide, rounds, done: sent >= target || exhausted, note: exhausted ? "No more leads left to write for (pool drained)." : d.message || "" });
        if (exhausted) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setProg((p) => (p ? { ...p, done: true } : p));
      setBusy(false);
    }
  }, [count, minGrade, provider, src, deep]);

  const inputStyle = { background: "var(--bg, #111)", color: "var(--text-primary)", border: "1px solid var(--border, #333)" };

  return (
    <details className="mb-6 rounded-xl overflow-hidden" style={{ border: home ? "1px solid var(--accent, #6366f1)" : "1px dashed var(--accent, #6366f1)" }} open>
      <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2 font-semibold" style={{ background: "rgba(99,102,241,0.10)", color: "var(--text-primary)", fontSize: home ? "1rem" : "0.875rem" }}>
        <span>{home ? "🚀 Recycle & send fresh sequences" : "⚡ Quick Send"}</span>
        {!home && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "var(--accent, #818cf8)" }}>temporary · chat experiment</span>}
      </summary>
      <div className="px-4 py-4 space-y-4" style={{ background: "var(--surface, #16161a)" }}>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Writes <strong>brand-new ultra-short sequences</strong> with <strong>quirky, captivating subjects</strong> (emojis + punchy outcomes like &quot;go home early&quot; / &quot;steal their customers&quot;), tiny bodies, and the <strong>money offer</strong> doing the closing — a mix across the quirky styles, sequences kept continuous. Grade-checked, right-fit ICP. Runs in rounds; watch it climb below.
        </p>

        <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: "var(--bg, #111)" }}>
          {(["recycle", "new"] as const).map((s) => (
            <button key={s} onClick={() => setSrc(s)} className="px-3 py-1.5 rounded-md text-xs font-medium transition" style={{ background: src === s ? "var(--accent, #6366f1)" : "transparent", color: src === s ? "#fff" : "var(--text-secondary)" }}>
              {s === "recycle" ? "♻️ Recycle existing" : "✨ Get new leads"}
            </button>
          ))}
        </div>
        {src === "new" && <p className="text-[11px]" style={{ color: "#fbbf24" }}>New leads pull from Apollo first — needs Apollo credits; if none come in it falls back to recycling.</p>}

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="mt-0.5" />
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            🔬 <strong>Deep research each lead</strong> — live web search for a real, recent hook (a post, launch, funding, hire, the phase their brand is in) to open on a genuine personal connection. Much slower + costs more per lead, higher signal.
          </span>
        </label>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="space-y-1">
            <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>How many</div>
            <input type="number" min="1" max="1000" value={count} onChange={(e) => setCount(e.target.value)} className="w-24 rounded-lg px-3 py-2 text-sm" style={inputStyle} />
          </label>
          <label className="space-y-1">
            <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Min quality (0–100)</div>
            <input type="number" min="0" max="100" value={minGrade} onChange={(e) => setMinGrade(e.target.value)} className="w-24 rounded-lg px-3 py-2 text-sm" style={inputStyle} />
          </label>
          <label className="space-y-1">
            <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Recipients</div>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
              <option value="no-gateways">Safe (skip strict gateways)</option>
              <option value="all">All providers (max volume)</option>
              <option value="google">Gmail only (safest)</option>
            </select>
          </label>
        </div>

        <button onClick={send} disabled={busy} className="rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60" style={{ background: busy ? "#444" : "var(--accent, #6366f1)", color: "#fff" }}>
          {busy ? `Crafting + sending… ${prog?.sent ?? 0}/${prog?.target ?? count}` : `🚀  Recycle ${count || 0} · craft fresh sequences · send`}
        </button>

        {prog && (
          <div className="rounded-lg px-4 py-4 text-sm space-y-3" style={{ background: "var(--bg, #111)", color: "var(--text-primary)" }}>
            <div className="flex items-center justify-between">
              <span className="font-medium flex items-center gap-2">
                {!prog.done && <span className="inline-block h-2 w-2 rounded-full animate-ping" style={{ background: "var(--accent, #6366f1)" }} />}
                {prog.done ? "Done" : "Writing + sending…"}
              </span>
              <span className="tabular-nums font-semibold">{prog.sent} / {prog.target} ({Math.min(100, Math.round((prog.sent / prog.target) * 100))}%)</span>
            </div>
            {/* progress bar — taller; the fill pulses while a round is in flight so it never looks frozen */}
            <div className="h-3 w-full rounded-full overflow-hidden" style={{ background: "var(--border, #2a2a2a)" }}>
              <div className={`h-full rounded-full transition-all duration-500 ${busy ? "animate-pulse" : ""}`} style={{ width: `${Math.max(2, Math.min(100, Math.round((prog.sent / prog.target) * 100)))}%`, background: "linear-gradient(90deg, var(--accent, #6366f1), #818cf8)" }} />
            </div>
            <div className="text-xs space-y-0.5" style={{ color: "var(--text-secondary)" }}>
              <div>{busy ? `Round ${prog.rounds + 1} writing fresh emails (~30s)…` : `${prog.rounds} rounds`} · Drafted this run: <span style={{ color: "var(--text-primary)" }}>{prog.generated}</span> · Shipped: <span style={{ color: "var(--text-primary)" }}>{prog.sent}</span></div>
              {prog.generated > prog.sent + 10 && !prog.done && <div style={{ color: "#fbbf24" }}>Drafting faster than shipping — most fresh drafts are queued; shipping is the slow step.</div>}
              {prog.done && prog.sent < prog.target && <div style={{ color: "#fbbf24" }}>{prog.note} Reached {prog.sent} of {prog.target}.</div>}
              {prog.done && prog.sent >= prog.target && <div style={{ color: "#4ade80" }}>✓ Target reached.</div>}
            </div>
          </div>
        )}
        {error && <p className="text-sm rounded-lg px-4 py-3" style={{ background: "#3a1a1a", color: "#fca5a5" }}>{error}</p>}
      </div>
    </details>
  );
}
