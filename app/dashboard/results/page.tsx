"use client";
import DashboardSidebar from "@/components/DashboardSidebar";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

/**
 * RESULTS — the single reporting home for the whole pipeline. Replaces the
 * scattered reporting that lived across the main dashboard, the cross-channel
 * tab, the experiments page, and the incentives results. Email + LinkedIn in one
 * place, one "last synced / Sync now" control so there's never doubt the numbers
 * are current. Read-only: it composes existing endpoints, it does not send.
 */

type PersonaMem = { positive_reply_count?: number; reply_count_total?: number; objection_count?: number; open_rate_pct_avg?: number };
type PerfMemory = { byPersona?: Record<string, PersonaMem>; byVertical?: Record<string, PersonaMem>; suggestion?: string | null };
type PriorityPersona = { key: string; label: string; emailPositives: number; liClicks: number; liCtr: number; reason: string };
type AdAllocation = { name: string; type: string; ctrPct: number; leads: number; verdict: "scale" | "keep" | "pause"; recommendedBudget: number };
type BudgetPlan = { runningAds: number; totalBudget: number; freedFromPauses: number; allocations: AdAllocation[]; moves: string[]; hasData: boolean };
type SignalResponse = {
  linkedin: { hasData: boolean; totals: { spend: number; impressions: number; clicks: number; leads: number; conversions: number; ctrPct: number }; snapshot: { at: string | null; account: string | null } };
  crossChannel: { priorityPersonas: PriorityPersona[]; suggestion: string | null };
  budgetPlan?: BudgetPlan;
};
type BrainAction = { priority: number; persona: string | null; label: string; why: string; endpoint: string | null };
type IncRow = { amount?: number; style?: string; gift?: string; sent: number; positive: number; replyRatePct: number };
type IncResults = { amounts?: IncRow[]; styles?: IncRow[]; gifts?: IncRow[] };

const fmt = (n: number) => n.toLocaleString();
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>{label}</p>
      <p className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{sub}</p>}
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 mt-8" style={{ color: "var(--text-tertiary)" }}>{children}</h2>;
}

export default function ResultsPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [tab, setTab] = useState<"all" | "email" | "linkedin">("all");
  const [perf, setPerf] = useState<PerfMemory | null>(null);
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const [actions, setActions] = useState<BrainAction[]>([]);
  const [inc, setInc] = useState<IncResults | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [conn, setConn] = useState<{ ingestUrl: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [queued, setQueued] = useState<string[]>([]);

  const queuePause = async (name: string) => {
    setQueued((q) => (q.includes(name) ? q : [...q, name]));
    try { await fetch("/api/linkedin/pause-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); } catch { /* ignore */ }
  };

  const [posts, setPosts] = useState<Array<{ hook: string; body: string; cta: string; persona: string }>>([]);
  const [genPosts, setGenPosts] = useState(false);
  const [postsMsg, setPostsMsg] = useState<string | null>(null);
  const genLinkedInPosts = async () => {
    setGenPosts(true); setPostsMsg(null);
    try {
      const r = await fetch("/api/linkedin/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: 4 }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setPosts(j.posts || []);
    } catch (e) { setPostsMsg(e instanceof Error ? e.message : "Failed"); } finally { setGenPosts(false); }
  };

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/performance-memory").then((r) => r.json()).then(setPerf).catch(() => {});
    fetch("/api/linkedin/signal").then((r) => r.json()).then(setSignal).catch(() => {});
    fetch("/api/cross-channel/brain", { method: "POST" }).then((r) => r.json()).then((d) => setActions(d.actions ?? [])).catch(() => {});
    fetch("/api/incentives/results").then((r) => r.json()).then(setInc).catch(() => {});
    fetch("/api/linkedin/connection").then((r) => r.json()).then((d) => { if (d.ingestUrl) setConn(d); }).catch(() => {});
  }, [session?.user?.id]);

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  // Auto-sync Instantly data on open so the page is never stale, then load.
  useEffect(() => {
    if (!session?.user?.id) return;
    setSyncing(true);
    fetch("/api/performance-memory/sync", { method: "POST" })
      .catch(() => {})
      .finally(() => { setSyncedAt(new Date().toLocaleTimeString()); setSyncing(false); load(); });
  }, [load, session?.user?.id]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await fetch("/api/performance-memory/sync", { method: "POST" });
      setSyncedAt(new Date().toLocaleTimeString());
      load();
    } catch { /* ignore */ } finally { setSyncing(false); }
  };

  const pushAds = async () => {
    setPushing(true); setPushMsg(null);
    try {
      const r = await fetch("/api/linkedin/push-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: 4 }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      const n = j.rows?.length ?? 0;
      setPushMsg(j.push?.dryRun ? `Generated ${n} ad draft${n === 1 ? "" : "s"} (dry run).` : `Pushed ${n} ad${n === 1 ? "" : "s"} to the drafter sheet.`);
    } catch (e) { setPushMsg(e instanceof Error ? e.message : "Failed"); } finally { setPushing(false); }
  };

  if (!ready || guardLoading || !session) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text-tertiary)" }}>Loading…</div>;
  }

  const li = signal?.linkedin;
  const cc = signal?.crossChannel;
  const personas = cc?.priorityPersonas ?? [];
  const byPersona = perf?.byPersona ?? {};
  const emailPositives = Object.values(byPersona).reduce((a, m) => a + (m.positive_reply_count ?? 0), 0);
  const emailReplies = Object.values(byPersona).reduce((a, m) => a + (m.reply_count_total ?? 0), 0);
  const emailPersonaRows = Object.entries(byPersona).filter(([k]) => k !== "unknown").sort((a, b) => (b[1].positive_reply_count ?? 0) - (a[1].positive_reply_count ?? 0));
  const lastSynced = syncedAt ? `email synced ${syncedAt}` : li?.snapshot.at ? `LinkedIn synced ${new Date(li.snapshot.at).toLocaleString()}` : "not synced yet";
  const showE = tab === "all" || tab === "email";
  const showL = tab === "all" || tab === "linkedin";

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="results" userEmail={session.user?.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Results</h1>
            <button onClick={syncNow} disabled={syncing} className="btn-primary text-sm">{syncing ? "Syncing…" : "Sync now"}</button>
          </div>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            Everything that happened, across both channels · <span style={{ color: "var(--text-tertiary)" }}>{lastSynced}</span>
          </p>

          {/* Channel tabs */}
          <div className="flex gap-1 mb-6 border-b" style={{ borderColor: "var(--border)" }}>
            {([["all", "All"], ["email", "Email"], ["linkedin", "LinkedIn"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setTab(k)} className="px-4 py-2 text-sm font-medium"
                style={{ color: tab === k ? "var(--accent)" : "var(--text-secondary)", borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent" }}>{lbl}</button>
            ))}
          </div>

          {/* Steers */}
          {(cc?.suggestion || perf?.suggestion) && (
            <div className="space-y-2 mb-2">
              {tab === "all" && cc?.suggestion && (
                <div className="card p-4" style={{ borderLeft: "3px solid var(--accent)" }}>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--accent)" }}>Cross-channel steer</p>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{cc.suggestion}</p>
                </div>
              )}
              {showE && perf?.suggestion && (
                <div className="card p-4" style={{ borderLeft: "3px solid var(--text-tertiary)" }}>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>Email strategy</p>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{perf.suggestion}</p>
                </div>
              )}
            </div>
          )}

          {/* Growth brain action plan */}
          {tab === "all" && actions.length > 0 && (
            <>
              <SectionTitle>What to do next <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-tertiary)" }}>· auto-graded, recommend-only</span></SectionTitle>
              <ol className="space-y-2">
                {actions.map((a) => (
                  <li key={a.priority} className="card p-3 flex gap-3 items-start">
                    <span className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold text-white" style={{ background: "var(--accent)" }}>{a.priority}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{a.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{a.why}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          {/* Channel summary */}
          <SectionTitle>Channels</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Email positives" value={fmt(emailPositives)} sub={`${fmt(emailReplies)} total replies`} />
            <Stat label="LinkedIn clicks" value={li?.hasData ? fmt(li.totals.clicks) : "—"} sub={li?.hasData ? `${li.totals.ctrPct}% CTR` : "no data yet"} />
            <Stat label="LinkedIn spend" value={li?.hasData ? money(li.totals.spend) : "—"} sub={li?.hasData ? `${fmt(li.totals.impressions)} impressions` : ""} />
            <Stat label="LinkedIn leads" value={li?.hasData ? fmt(li.totals.leads) : "—"} sub={li?.hasData ? `${fmt(li.totals.conversions)} conversions` : ""} />
          </div>

          {/* Connect LinkedIn — shown until data is flowing */}
          {showL && !li?.hasData && (
            <div className="card p-4 mt-3">
              <p className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>Connect LinkedIn (one-time, ~2 min)</p>
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>LinkedIn data can&apos;t be pulled server-side — the extension pushes it. Paste these into the extension&apos;s Settings, reload the extension, and it auto-syncs here from then on.</p>
              <div className="space-y-3">
                <div>
                  <span className="block text-xs uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>1 · Engine ingest URL</span>
                  <div className="flex gap-2 items-center">
                    <code className="flex-1 truncate rounded px-2 py-1 text-xs" style={{ background: "var(--surface-subtle)", color: "var(--text-primary)" }}>{conn?.ingestUrl ?? "loading…"}</code>
                    <button className="btn-secondary text-xs" onClick={() => conn && copy("url", conn.ingestUrl)}>{copied === "url" ? "Copied ✓" : "Copy"}</button>
                  </div>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>2 · Engine ingest token</span>
                  <div className="flex gap-2 items-center">
                    <code className="flex-1 truncate rounded px-2 py-1 text-xs" style={{ background: "var(--surface-subtle)", color: "var(--text-primary)" }}>{conn?.token ?? "loading…"}</code>
                    <button className="btn-secondary text-xs" onClick={() => conn && copy("token", conn.token)}>{copied === "token" ? "Copied ✓" : "Copy"}</button>
                  </div>
                </div>
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>3 · In Chrome: reload the ad-drafter extension (chrome://extensions → reload), paste both values into its Settings, then open the ad dashboard on a logged-in LinkedIn tab. It auto-syncs within seconds.</p>
              </div>
            </div>
          )}

          {/* Budget shifter */}
          {showL && signal?.budgetPlan?.hasData && (
            <>
              <SectionTitle>Budget shifter <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-tertiary)" }}>· ${signal.budgetPlan.totalBudget}/day across {signal.budgetPlan.runningAds} running ads</span></SectionTitle>
              <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>Click <b>Pause</b> to queue it — the ad-drafter extension pauses it on LinkedIn within seconds whenever it&apos;s open on a Campaign Manager tab (the server has no LinkedIn login of its own).</p>
              {signal.budgetPlan.moves.length > 0 && (
                <div className="card p-4 mb-3" style={{ borderLeft: "3px solid var(--accent)" }}>
                  <ul className="text-sm space-y-1" style={{ color: "var(--text-primary)" }}>
                    {signal.budgetPlan.moves.map((m, i) => <li key={i}>• {m}</li>)}
                  </ul>
                  <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>LinkedIn has no API to pause or set ad budgets — apply these moves in Campaign Manager.</p>
                </div>
              )}
              <div className="card overflow-hidden mb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }} className="text-left text-xs uppercase tracking-wide">
                      <th className="px-4 py-2 font-medium">Ad</th><th className="px-4 py-2 font-medium">CTR</th><th className="px-4 py-2 font-medium">Leads</th><th className="px-4 py-2 font-medium">Verdict</th><th className="px-4 py-2 font-medium text-right">Budget/day</th><th className="px-4 py-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signal.budgetPlan.allocations.map((a) => (
                      <tr key={a.name} className="border-t" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                        <td className="px-4 py-2.5 font-medium">{a.name}</td>
                        <td className="px-4 py-2.5">{a.ctrPct}%</td>
                        <td className="px-4 py-2.5">{a.leads}</td>
                        <td className="px-4 py-2.5" style={{ color: a.verdict === "scale" ? "#16a34a" : a.verdict === "pause" ? "#dc2626" : "var(--text-secondary)", fontWeight: 600 }}>{a.verdict}</td>
                        <td className="px-4 py-2.5 text-right">{a.verdict === "pause" ? "$0" : `$${a.recommendedBudget}`}</td>
                        <td className="px-4 py-2.5 text-right">
                          {a.verdict === "pause" ? (
                            queued.includes(a.name)
                              ? <span className="text-xs" style={{ color: "#16a34a" }}>Queued ✓</span>
                              : <button onClick={() => queuePause(a.name)} className="text-xs underline" style={{ color: "#dc2626" }}>Pause</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Priority personas */}
          {showL && personas.length > 0 && (
            <>
              <SectionTitle>Priority personas <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-tertiary)" }}>· fused across email + LinkedIn</span></SectionTitle>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }} className="text-left text-xs uppercase tracking-wide">
                      <th className="px-4 py-2 font-medium">Persona</th><th className="px-4 py-2 font-medium">Email +</th><th className="px-4 py-2 font-medium">Ad clicks</th><th className="px-4 py-2 font-medium">Why</th><th className="px-4 py-2 font-medium text-right">Audience</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personas.map((p) => (
                      <tr key={p.key} className="border-t" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                        <td className="px-4 py-2.5 font-medium">{p.label}</td>
                        <td className="px-4 py-2.5">{p.emailPositives}</td>
                        <td className="px-4 py-2.5">{p.liClicks}{p.liClicks > 0 ? ` (${p.liCtr}%)` : ""}</td>
                        <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>{p.reason}</td>
                        <td className="px-4 py-2.5 text-right"><a className="underline" style={{ color: "var(--accent)" }} href={`/api/linkedin/matched-audience?format=contact&persona=${encodeURIComponent(p.key)}`}>CSV</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Email by persona */}
          {showE && emailPersonaRows.length > 0 && (
            <>
              <SectionTitle>Email by persona</SectionTitle>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }} className="text-left text-xs uppercase tracking-wide">
                      <th className="px-4 py-2 font-medium">Persona</th><th className="px-4 py-2 font-medium">Positive</th><th className="px-4 py-2 font-medium">Replies</th><th className="px-4 py-2 font-medium">Objections</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailPersonaRows.map(([k, m]) => (
                      <tr key={k} className="border-t" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                        <td className="px-4 py-2.5 font-medium">{k}</td>
                        <td className="px-4 py-2.5">{m.positive_reply_count ?? 0}</td>
                        <td className="px-4 py-2.5">{m.reply_count_total ?? 0}</td>
                        <td className="px-4 py-2.5">{m.objection_count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Incentive A/B */}
          {showE && inc?.amounts && inc.amounts.length > 0 && (
            <>
              <SectionTitle>Offer A/B <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-tertiary)" }}>· by gift amount</span></SectionTitle>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "var(--text-tertiary)" }} className="text-left text-xs uppercase tracking-wide">
                      <th className="px-4 py-2 font-medium">Amount</th><th className="px-4 py-2 font-medium">Sent</th><th className="px-4 py-2 font-medium">Positive</th><th className="px-4 py-2 font-medium">Reply rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inc.amounts.map((a) => (
                      <tr key={a.amount} className="border-t" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                        <td className="px-4 py-2.5 font-medium">{a.amount === 0 ? "Value-first" : `$${a.amount}`}</td>
                        <td className="px-4 py-2.5">{fmt(a.sent)}</td>
                        <td className="px-4 py-2.5">{a.positive}</td>
                        <td className="px-4 py-2.5">{a.replyRatePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Actions */}
          {showL && (<>
          <SectionTitle>Actions</SectionTitle>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>Push winning ads to LinkedIn</p>
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>Generate ad drafts from your winning hooks, personas and offer.</p>
              <button onClick={pushAds} disabled={pushing} className="btn-primary text-sm">{pushing ? "Generating…" : "Push winning ads"}</button>
              {pushMsg && <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>{pushMsg}</p>}
            </div>
            <div className="card p-4">
              <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>Surround-sound audience</p>
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>Download the accounts you're emailing as a LinkedIn Matched Audience.</p>
              <div className="flex flex-wrap gap-2 text-sm">
                <a className="btn-secondary" href="/api/linkedin/matched-audience?format=contact&status=active">Contacts</a>
                <a className="btn-secondary" href="/api/linkedin/matched-audience?format=company&status=active">Companies</a>
                <a className="btn-secondary" href="/api/linkedin/matched-audience?format=contact&status=positive">Positive repliers</a>
              </div>
            </div>
            <div className="card p-4">
              <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>LinkedIn organic posts</p>
              <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>Draft organic posts from your winning hooks — the content that warms the same accounts (ColdIQ flywheel).</p>
              <button onClick={genLinkedInPosts} disabled={genPosts} className="btn-primary text-sm">{genPosts ? "Writing…" : "Generate posts"}</button>
              {postsMsg && <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>{postsMsg}</p>}
            </div>
          </div>
          {posts.length > 0 && (
            <div className="space-y-2 mt-3">
              {posts.map((p, i) => (
                <div key={i} className="card p-3">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{p.hook}</p>
                  <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{p.body}</p>
                  {p.cta && <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>{p.cta}</p>}
                  <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>for {p.persona}</p>
                </div>
              ))}
            </div>
          )}
          </>)}
        </div>
      </main>
    </div>
  );
}
