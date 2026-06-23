"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

/**
 * Always-visible daily send counter: how many emails went out in the last 24h, split into
 * fresh first-time sends vs recycle re-contacts (the recycle arm is invisible to the old
 * sentAt-based stat, so it's surfaced explicitly here). Auto-refreshes so a recycle batch
 * shows up shortly after you click. Reads /api/leads/sends-today.
 */
export default function SendsTodayCard() {
  const { data: session } = useSession();
  const [data, setData] = useState<{ fresh: number; recycled: number; total: number } | null>(null);

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/leads/sends-today").then((r) => r.json()).then((d) => { if (!d.error) setData(d); }).catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // refresh every 30s so new batches appear
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mb-6 card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>Emails sent · last 24h</p>
          <p className="text-3xl font-semibold mt-1 tabular-nums" style={{ color: "var(--text-primary)" }}>{data ? data.total.toLocaleString() : "—"}</p>
        </div>
        <div className="text-right text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
          <p><span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>{data ? data.fresh.toLocaleString() : "—"}</span> new (first-time)</p>
          <p><span className="tabular-nums font-medium" style={{ color: "#b45309" }}>{data ? data.recycled.toLocaleString() : "—"}</span> recycled (re-contacts)</p>
          <button onClick={load} className="text-xs underline" style={{ color: "var(--text-tertiary)" }}>Refresh</button>
        </div>
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
        Counts leads pushed to Instantly in the last 24h. Instantly then drips them out (~30 per warmed inbox/day), so delivery trails this number over the following days.
      </p>
    </div>
  );
}
