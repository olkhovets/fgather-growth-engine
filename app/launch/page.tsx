"use client";

import { useAuthGuard } from "@/hooks/useAuthGuard";
import DashboardSidebar from "@/components/DashboardSidebar";
import { useEffect, useState, useCallback } from "react";

type Target = { currentPct: number; targetPct: number; sending?: { sent24: number }; totalPositive?: number };
type SendResult = { requested: number; candidates: number; gradedGood: number; sent: number; skipped: number; provider: string; styleMix: Record<string, number>; message: string };

export default function LaunchPage() {
  const { ready, session } = useAuthGuard();
  const [count, setCount] = useState("200");
  const [provider, setProvider] = useState("no-gateways");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stat, setStat] = useState<Target | null>(null);

  const refreshStat = useCallback(() => {
    fetch("/api/target").then((r) => (r.ok ? r.json() : null)).then((d) => d && setStat(d)).catch(() => {});
  }, []);
  useEffect(() => { if (ready) refreshStat(); }, [ready, refreshStat]);

  const send = useCallback(async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/send-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: Number(count) || 0, providerFilter: provider }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || "Send failed.");
      else setResult(d);
      refreshStat();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }, [count, provider, refreshStat]);

  if (!ready || !session) {
    return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
    </div>;
  }

  const inputStyle = { background: "var(--surface, #1a1a1a)", color: "var(--text-primary)", border: "1px solid var(--border, #333)" };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="launch" userEmail={session.user?.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-8 py-10 space-y-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Send good emails</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              Picks right-fit ICP leads that already have a strong draft (various proven styles, the dead
              specialist-proof excluded), grade-checks each, and sends exactly those. The number sent is the
              chosen batch minus any skipped for deliverability — shown below.
            </p>
          </div>

          <div className="flex gap-3 items-end">
            <div className="space-y-1">
              <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>How many</div>
              <input type="number" min="1" max="1000" value={count} onChange={(e) => setCount(e.target.value)} className="w-28 rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Recipients</div>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                <option value="no-gateways">Safe (skip strict gateways)</option>
                <option value="all">All providers (max volume)</option>
                <option value="google">Gmail only (safest)</option>
              </select>
            </div>
          </div>

          <button
            onClick={send}
            disabled={busy}
            className="w-full rounded-xl px-6 py-4 text-base font-semibold transition disabled:opacity-60"
            style={{ background: busy ? "#444" : "var(--accent, #4f46e5)", color: "#fff" }}
          >
            {busy ? "Sending…" : `🚀  Send ${count || 0} good emails (real send)`}
          </button>

          {result && (
            <div className="rounded-lg px-4 py-3 text-sm space-y-1" style={{ background: "var(--surface, #1a1a1a)", color: "var(--text-primary)" }}>
              <div className="font-medium">Sent {result.sent}{result.skipped > 0 ? ` · skipped ${result.skipped}` : ""}</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{result.message}</div>
            </div>
          )}
          {error && <p className="text-sm rounded-lg px-4 py-3" style={{ background: "#3a1a1a", color: "#fca5a5" }}>{error}</p>}

          {stat && (
            <p className="text-xs pt-2" style={{ color: "var(--text-tertiary)" }}>
              Reply rate {stat.currentPct}% (target {stat.targetPct}%) · {stat.sending?.sent24 ?? 0} sent in 24h · {stat.totalPositive ?? 0} positive replies all-time
            </p>
          )}
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            Each press is a real send. After July 4th, ask Claude to run the OOO retarget for your engaged leads.
          </p>
        </div>
      </main>
    </div>
  );
}
