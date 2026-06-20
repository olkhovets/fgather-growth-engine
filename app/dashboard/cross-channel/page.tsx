"use client";
import DashboardSidebar from "@/components/DashboardSidebar";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

type PriorityPersona = {
  key: string; label: string; emailPositives: number; liClicks: number; liCtr: number; score: number; reason: string;
};
type SignalResponse = {
  linkedin: {
    hasData: boolean;
    totals: { spend: number; impressions: number; clicks: number; leads: number; conversions: number; ctrPct: number };
    byPersona: Record<string, { impressions: number; clicks: number; ctr: number }>;
    snapshot: { at: string | null; account: string | null; dateRange: { from?: string; to?: string } | null };
  };
  crossChannel: { priorityPersonas: PriorityPersona[]; suggestion: string | null; channels: { email: boolean; linkedin: boolean } };
};

const fmt = (n: number) => n.toLocaleString();
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>{label}</p>
      <p className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}

type BrainAction = { priority: number; type: string; persona: string | null; label: string; why: string; endpoint: string | null };
type BrainResult = { actions: BrainAction[]; scoreboard: unknown[] };

export default function CrossChannelPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [data, setData] = useState<SignalResponse | null>(null);
  const [brain, setBrain] = useState<BrainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!session?.user?.id) return;
    setLoading(true);
    Promise.all([
      fetch("/api/linkedin/signal").then((r) => r.json()).then((d) => setData(d)).catch(() => {}),
      fetch("/api/cross-channel/brain", { method: "POST" }).then((r) => r.json()).then((d) => setBrain(d)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [session?.user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const pushAds = async () => {
    setPushing(true);
    setPushMsg(null);
    try {
      const r = await fetch("/api/linkedin/push-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 4 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      const n = j.rows?.length ?? 0;
      setPushMsg(j.push?.dryRun ? `Generated ${n} ad draft${n === 1 ? "" : "s"} (dry run — set LINKEDIN_SHEET_APPEND_URL to write them to the sheet).` : `Pushed ${n} ad${n === 1 ? "" : "s"} to the drafter sheet.`);
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Failed to push ads");
    } finally {
      setPushing(false);
    }
  };

  if (!ready || guardLoading || !session) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text-tertiary)" }}>Loading…</div>;
  }

  const li = data?.linkedin;
  const cc = data?.crossChannel;
  const personas = cc?.priorityPersonas ?? [];

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="crosschannel" userEmail={session.user?.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Cross-channel</h1>
            <button onClick={refresh} className="btn-secondary text-sm" style={{ color: "var(--text-secondary)" }}>Refresh</button>
          </div>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            One view across cold email and LinkedIn ads. Email reply wins steer ad creative; ad engagement steers who we email next.
          </p>

          {/* Cross-channel steer */}
          {cc?.suggestion && (
            <div className="card p-4 mb-6" style={{ borderLeft: "3px solid var(--accent)" }}>
              <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--accent)" }}>Cross-channel steer</p>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>{cc.suggestion}</p>
            </div>
          )}

          {/* Growth brain — the ranked action plan */}
          {brain?.actions && brain.actions.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>What to do next <span style={{ color: "var(--text-tertiary)", fontWeight: 400, textTransform: "none" }}>· auto-graded each run, recommend-only</span></h2>
              <ol className="space-y-2">
                {brain.actions.map((a) => (
                  <li key={a.priority} className="card p-3 flex gap-3 items-start">
                    <span className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>{a.priority}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{a.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{a.why}</p>
                      {a.endpoint && <p className="text-xs mt-1 font-mono" style={{ color: "var(--text-tertiary)" }}>{a.endpoint}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* LinkedIn channel totals */}
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>LinkedIn ads</h2>
          {li?.hasData ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-2">
                <Stat label="Spend" value={money(li.totals.spend)} />
                <Stat label="Impressions" value={fmt(li.totals.impressions)} />
                <Stat label="Clicks" value={fmt(li.totals.clicks)} />
                <Stat label="CTR" value={`${li.totals.ctrPct}%`} />
                <Stat label="Leads" value={fmt(li.totals.leads)} />
                <Stat label="Conversions" value={fmt(li.totals.conversions)} />
              </div>
              {li.snapshot.at && (
                <p className="text-xs mb-6" style={{ color: "var(--text-tertiary)" }}>
                  Last synced {new Date(li.snapshot.at).toLocaleString()}{li.snapshot.account ? ` · ${li.snapshot.account}` : ""} · from the ad-drafter dashboard "Export to engine"
                </p>
              )}
            </>
          ) : (
            <div className="card p-4 mb-6" style={{ color: "var(--text-secondary)" }}>
              <p className="text-sm">No LinkedIn data yet. In the ad-drafter dashboard, set the engine ingest URL in Settings and click <b>Export to engine</b>.</p>
            </div>
          )}

          {/* Priority personas — the fused signal */}
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>Priority personas</h2>
          {personas.length > 0 ? (
            <div className="card overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "var(--text-tertiary)" }} className="text-left text-xs uppercase tracking-wide">
                    <th className="px-4 py-2 font-medium">Persona</th>
                    <th className="px-4 py-2 font-medium">Positive replies</th>
                    <th className="px-4 py-2 font-medium">Ad clicks</th>
                    <th className="px-4 py-2 font-medium">Why it's hot</th>
                    <th className="px-4 py-2 font-medium text-right">Audience</th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.key} className="border-t" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                      <td className="px-4 py-2.5 font-medium">{p.label}</td>
                      <td className="px-4 py-2.5">{p.emailPositives}</td>
                      <td className="px-4 py-2.5">{p.liClicks}{p.liClicks > 0 ? ` (${p.liCtr}%)` : ""}</td>
                      <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>{p.reason}</td>
                      <td className="px-4 py-2.5 text-right">
                        <a className="underline" style={{ color: "var(--accent)" }} href={`/api/linkedin/matched-audience?format=contact&persona=${encodeURIComponent(p.key)}`}>CSV</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card p-4 mb-6" style={{ color: "var(--text-secondary)" }}>
              <p className="text-sm">{loading ? "Loading…" : "No fused signal yet. Once positive replies and/or ad clicks accrue, the hottest personas rank here."}</p>
            </div>
          )}

          {/* Actions — the two pipes, operator-triggerable */}
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>Actions</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>Forward pipe → LinkedIn ads</p>
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>Generate ad drafts from your winning hooks, personas and incentives.</p>
              <button onClick={pushAds} disabled={pushing} className="btn-primary text-sm">{pushing ? "Generating…" : "Push winning ads"}</button>
              {pushMsg && <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>{pushMsg}</p>}
            </div>
            <div className="card p-4">
              <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>Surround-sound audience</p>
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>Download the accounts you're emailing as a LinkedIn Matched Audience, then upload it in Campaign Manager.</p>
              <div className="flex flex-wrap gap-2 text-sm">
                <a className="btn-secondary" href="/api/linkedin/matched-audience?format=contact&status=active">Contacts (active)</a>
                <a className="btn-secondary" href="/api/linkedin/matched-audience?format=company&status=active">Companies (active)</a>
                <a className="btn-secondary" href="/api/linkedin/matched-audience?format=contact&status=positive">Positive repliers</a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
