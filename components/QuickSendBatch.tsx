"use client";

import { useState, useCallback } from "react";

type Progress = { sent: number; target: number; sendSideSkipped: number; rounds: number; done: boolean; note: string };

/**
 * TEMPORARY "Quick Send" dropdown — a chat-driven experiment, intentionally marked as not-permanent.
 * One spot to just launch: pick how many, the quality bar, and recipients, then send a grade-checked
 * batch of good emails (per-persona styles + guaranteed incentive share) via /api/send-batch.
 * Collapsed by default and visually flagged so it's clear this isn't a core feature.
 */
export default function QuickSendBatch() {
  const [count, setCount] = useState("200");
  const [minGrade, setMinGrade] = useState("85");
  const [provider, setProvider] = useState("no-gateways");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loop: keep sending NEW eligible leads until we actually hit the target (or the pool runs out).
  // Each round excludes the ids already tried, so it walks through sendable leads instead of re-picking
  // the same skipped ones. Skip stats accumulate and stay visible.
  const send = useCallback(async () => {
    const target = Math.max(1, Number(count) || 0);
    setBusy(true); setError(null);
    setProg({ sent: 0, target, sendSideSkipped: 0, rounds: 0, done: false, note: "Starting…" });
    const attempted: string[] = [];
    let sent = 0, sendSide = 0, rounds = 0;
    const MAX_ROUNDS = 30;
    try {
      while (sent < target && rounds < MAX_ROUNDS) {
        const r = await fetch("/api/send-batch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: target - sent, minGrade: Number(minGrade) || 85, providerFilter: provider, excludeIds: attempted }),
        });
        const d = await r.json();
        if (!r.ok) { setError(d.error || "Send failed."); break; }
        sent += d.sent || 0;
        sendSide += d.sendSideSkipped || 0;
        rounds += 1;
        for (const id of d.attemptedIds || []) attempted.push(id);
        const exhausted = (d.chosen || 0) === 0;
        setProg({ sent, target, sendSideSkipped: sendSide, rounds, done: sent >= target || exhausted, note: exhausted ? "No more eligible leads in the pool." : d.message || "" });
        if (exhausted) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setProg((p) => (p ? { ...p, done: true } : p));
      setBusy(false);
    }
  }, [count, minGrade, provider]);

  const inputStyle = { background: "var(--bg, #111)", color: "var(--text-primary)", border: "1px solid var(--border, #333)" };

  return (
    <details className="mb-6 rounded-xl overflow-hidden" style={{ border: "1px dashed var(--accent, #6366f1)" }} open>
      <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2 text-sm font-medium" style={{ background: "rgba(99,102,241,0.08)", color: "var(--text-primary)" }}>
        <span>⚡ Quick Send</span>
        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.2)", color: "var(--accent, #818cf8)" }}>temporary · chat experiment</span>
      </summary>
      <div className="px-4 py-4 space-y-4" style={{ background: "var(--surface, #16161a)" }}>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Sends a grade-checked batch of good emails — right-fit ICP, per-persona best styles, ~50% incentives sprinkled in. Just pick the numbers and launch. (We&apos;re iterating on this in chat; it&apos;s not a permanent part of the dashboard yet.)
        </p>

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
          {busy ? `Sending… ${prog?.sent ?? 0}/${prog?.target ?? count}` : `🚀  Send ${count || 0} good emails (real send)`}
        </button>

        {prog && (
          <div className="rounded-lg px-4 py-3 text-sm space-y-2" style={{ background: "var(--bg, #111)", color: "var(--text-primary)" }}>
            <div className="font-medium">{prog.done ? "Done — " : "Sending… "}Sent {prog.sent} / {prog.target}</div>
            {/* progress bar */}
            <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "var(--border, #333)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((prog.sent / prog.target) * 100))}%`, background: "var(--accent, #6366f1)" }} />
            </div>
            <div className="text-xs space-y-0.5" style={{ color: "var(--text-secondary)" }}>
              <div>Rounds: {prog.rounds} · Skipped (not on a warmed inbox / already in a campaign): <span style={{ color: "var(--text-primary)" }}>{prog.sendSideSkipped}</span></div>
              {prog.done && prog.sent < prog.target && <div style={{ color: "#fbbf24" }}>{prog.note} Reached {prog.sent} of {prog.target}.</div>}
              {prog.done && prog.sent >= prog.target && <div style={{ color: "#4ade80" }}>Target reached.</div>}
            </div>
          </div>
        )}
        {error && <p className="text-sm rounded-lg px-4 py-3" style={{ background: "#3a1a1a", color: "#fca5a5" }}>{error}</p>}
      </div>
    </details>
  );
}
