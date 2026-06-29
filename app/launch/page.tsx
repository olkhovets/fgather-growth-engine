"use client";

import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useEffect, useState, useCallback } from "react";

type Target = { currentPct: number; targetPct: number; sending?: { sent24: number }; totalPositive?: number };

export default function LaunchPage() {
  const { ready, session } = useAuthGuard();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stat, setStat] = useState<Target | null>(null);

  const refreshStat = useCallback(() => {
    fetch("/api/target").then((r) => (r.ok ? r.json() : null)).then((d) => d && setStat(d)).catch(() => {});
  }, []);
  useEffect(() => { if (ready) refreshStat(); }, [ready, refreshStat]);

  const launch = useCallback(async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/launch-campaign", { method: "POST" });
      const d = await r.json();
      if (!r.ok) setError(d.error || "Launch failed.");
      else setResult(d.message || "Done.");
      refreshStat();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed.");
    } finally {
      setBusy(false);
    }
  }, [refreshStat]);

  if (!ready || !session) {
    return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
    </div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-md text-center space-y-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Launch holiday campaign</h1>
          <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
            Drafts your right-fit ICP leads in the holiday-incentive style (money offer, holiday-aware,
            optimized subject lines) and sends them. One press = one batch — press again for more.
          </p>
        </div>

        <button
          onClick={launch}
          disabled={busy}
          className="w-full rounded-xl px-6 py-5 text-lg font-semibold transition disabled:opacity-60"
          style={{ background: busy ? "var(--accent-muted, #444)" : "var(--accent, #4f46e5)", color: "#fff" }}
        >
          {busy ? "Launching…" : "🚀  Launch a batch (sends real emails)"}
        </button>

        {result && <p className="text-sm rounded-lg px-4 py-3" style={{ background: "var(--surface, #1a1a1a)", color: "var(--text-primary)" }}>{result}</p>}
        {error && <p className="text-sm rounded-lg px-4 py-3" style={{ background: "#3a1a1a", color: "#fca5a5" }}>{error}</p>}

        {stat && (
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            Current reply rate {stat.currentPct}% (target {stat.targetPct}%) · {stat.sending?.sent24 ?? 0} sent in 24h · {stat.totalPositive ?? 0} positive replies all-time
          </p>
        )}

        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Each press is a real send. After July 4th, ask Claude to run the OOO retarget for your engaged leads.
        </p>
      </div>
    </div>
  );
}
