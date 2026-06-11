"use client";

import { useEffect, useState } from "react";

type Row = { provider: string; sent: number; realReplies: number; positive: number; bounced: number; replyRatePct: number; positiveRatePct: number; bounceRatePct: number };

/**
 * Reply/bounce by inbox provider — surfaced across dashboards. Reveals whether a provider
 * (e.g. Microsoft 365) is silently killing deliverability vs another (e.g. Google).
 */
export default function ProviderBreakdown() {
  const [rows, setRows] = useState<Row[]>([]);
  const [unclassified, setUnclassified] = useState(0);

  useEffect(() => {
    fetch("/api/analytics/providers").then((r) => r.json()).then((d) => {
      if (Array.isArray(d.providers)) setRows(d.providers.filter((p: Row) => p.sent > 0));
      setUnclassified(d.unclassified ?? 0);
    }).catch(() => {});
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="card overflow-hidden mb-8">
      <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Performance by inbox provider</h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
          Where your sends land matters. A high bounce or near-zero reply rate on one provider (often Microsoft/365) is a deliverability signal, not a copy problem.
          {unclassified > 0 && <span> {unclassified.toLocaleString()} sent leads not yet classified (filling in over the next day).</span>}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>{["Provider", "Sent", "Replies", "Reply %", "Positive", "Bounce %"].map((h) => <th key={h} className="px-6 py-2.5 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.provider} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
              <td className="px-6 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>{r.provider}</td>
              <td className="px-6 py-2.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>{r.sent.toLocaleString()}</td>
              <td className="px-6 py-2.5 tabular-nums" style={{ color: r.realReplies > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.realReplies}</td>
              <td className="px-6 py-2.5 tabular-nums" style={{ color: r.replyRatePct > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.replyRatePct}%</td>
              <td className="px-6 py-2.5 tabular-nums font-medium" style={{ color: r.positive > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.positive > 0 ? `+${r.positive}` : "—"}</td>
              <td className="px-6 py-2.5 tabular-nums" style={{ color: r.bounceRatePct > 5 ? "#dc2626" : r.bounceRatePct > 2 ? "#b45309" : "var(--text-tertiary)" }}>{r.bounceRatePct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
