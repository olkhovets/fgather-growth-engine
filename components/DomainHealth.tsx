"use client";

import { Fragment, useState } from "react";

type InboxHealth = {
  email: string;
  statusLabel: string;
  warmupStatus: number;
  dailyLimit: number | null;
  setupPending: boolean;
  healthScore: number | null;
  landedInbox: number | null;
  landedSpam: number | null;
};
type DomainHealth = {
  domain: string;
  inboxCount: number;
  active: number;
  problematic: number;
  paused: number;
  setupPending: number;
  avgHealth: number | null;
  worstHealth: number | null;
  verdict: "healthy" | "watch" | "unhealthy" | "critical";
  reasons: string[];
  inboxes: InboxHealth[];
};
type Summary = { domains: number; inboxes: number; healthy: number; watch: number; unhealthy: number; critical: number; hasHealthData: boolean };

const VERDICT_COLOR: Record<string, string> = {
  healthy: "#16a34a", watch: "#b45309", unhealthy: "#dc2626", critical: "#991b1b",
};
const VERDICT_LABEL: Record<string, string> = {
  healthy: "Healthy", watch: "Watch", unhealthy: "Unhealthy", critical: "Critical",
};

function healthColor(score: number | null): string {
  if (score === null) return "var(--text-tertiary)";
  if (score >= 90) return "#16a34a";
  if (score >= 80) return "#b45309";
  return "#dc2626";
}

export default function DomainHealth() {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [domains, setDomains] = useState<DomainHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const scan = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/instantly/domain-health");
      const d = await res.json();
      if (d.error) { setError(d.error); setSummary(null); setDomains([]); }
      else { setSummary(d.summary); setDomains(d.domains ?? []); }
      setRan(true);
    } catch { setError("Scan failed."); } finally { setLoading(false); }
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between gap-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Sending domain health</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Which of your Instantly domains are healthy enough to actually reach inboxes. Health score is warmup inbox-vs-spam placement; below 80% means pause cold sends.</p>
        </div>
        <button onClick={scan} disabled={loading} className="btn-secondary flex-shrink-0">{loading ? "Scanning…" : ran ? "Rescan" : "Scan inboxes"}</button>
      </div>

      {error && <div className="px-6 py-4"><p className="text-sm" style={{ color: "#dc2626" }}>{error}</p></div>}

      {summary && (
        <>
          <div className="px-6 py-4 border-b flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <span style={{ color: "var(--text-secondary)" }}><strong style={{ color: "var(--text-primary)" }}>{summary.domains}</strong> domains · <strong style={{ color: "var(--text-primary)" }}>{summary.inboxes}</strong> inboxes</span>
            {summary.critical > 0 && <span style={{ color: VERDICT_COLOR.critical, fontWeight: 600 }}>{summary.critical} critical</span>}
            {summary.unhealthy > 0 && <span style={{ color: VERDICT_COLOR.unhealthy, fontWeight: 600 }}>{summary.unhealthy} unhealthy</span>}
            {summary.watch > 0 && <span style={{ color: VERDICT_COLOR.watch }}>{summary.watch} watch</span>}
            <span style={{ color: VERDICT_COLOR.healthy }}>{summary.healthy} healthy</span>
            {!summary.hasHealthData && <span style={{ color: "var(--text-tertiary)" }}>· health scores unavailable (status-only — check Instantly plan)</span>}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                {["Domain", "Verdict", "Inboxes", "Avg health", "Why", ""].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <Fragment key={d.domain}>
                  <tr className="border-b last:border-0 cursor-pointer hover:opacity-80" style={{ borderColor: "var(--border)" }} onClick={() => setExpanded(expanded === d.domain ? null : d.domain)}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>{d.domain}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: VERDICT_COLOR[d.verdict] + "22", color: VERDICT_COLOR[d.verdict] }}>{VERDICT_LABEL[d.verdict]}</span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {d.active}/{d.inboxCount} active{d.problematic > 0 ? <span style={{ color: VERDICT_COLOR.critical }}> · {d.problematic} dead</span> : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-medium" style={{ color: healthColor(d.avgHealth) }}>{d.avgHealth !== null ? `${d.avgHealth}%` : "—"}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-tertiary)" }}>{d.reasons.length > 0 ? d.reasons.join("; ") : "all good"}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-tertiary)" }}>{expanded === d.domain ? "▲" : "▼"}</td>
                  </tr>
                  {expanded === d.domain && (
                    <tr style={{ background: "var(--surface)" }}>
                      <td colSpan={6} className="px-4 py-2">
                        <table className="w-full text-xs">
                          <thead><tr>{["Inbox", "Status", "Health", "Inbox/Spam", "Daily limit"].map((h) => <th key={h} className="px-2 py-1 text-left font-medium" style={{ color: "var(--text-tertiary)" }}>{h}</th>)}</tr></thead>
                          <tbody>
                            {d.inboxes.map((i) => (
                              <tr key={i.email}>
                                <td className="px-2 py-1" style={{ color: "var(--text-secondary)" }}>{i.email}</td>
                                <td className="px-2 py-1" style={{ color: i.warmupStatus < 0 ? VERDICT_COLOR.critical : i.warmupStatus === 0 ? VERDICT_COLOR.watch : "var(--text-secondary)" }}>{i.statusLabel}{i.setupPending ? " (setup)" : ""}</td>
                                <td className="px-2 py-1 tabular-nums font-medium" style={{ color: healthColor(i.healthScore) }}>{i.healthScore !== null ? `${i.healthScore}%` : "—"}</td>
                                <td className="px-2 py-1 tabular-nums" style={{ color: "var(--text-tertiary)" }}>{i.landedInbox !== null ? `${i.landedInbox}/${i.landedSpam ?? 0}` : "—"}</td>
                                <td className="px-2 py-1 tabular-nums" style={{ color: "var(--text-tertiary)" }}>{i.dailyLimit ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!summary && !error && !loading && (
        <div className="px-6 py-8 text-center"><p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Scan your inboxes to see which sending domains are healthy. Takes a few seconds across many inboxes.</p></div>
      )}
    </div>
  );
}
