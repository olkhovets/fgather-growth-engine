"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

type VariantStat = {
  id: string;
  dimension: string;
  label: string;
  instruction: string;
  hypothesis: string | null;
  generation: number;
  sends: number;
  positives: number;
  anyReplies: number;
  positiveRate: number;
};

type ExperimentsData = {
  baselinePositiveRate: number;
  testingByDimension: Record<string, VariantStat[]>;
  testingCount: number;
  winners: VariantStat[];
  killed: Array<{ id: string; dimension: string; label: string; instruction: string; generation: number }>;
  learnings: string[];
};

const DIMENSION_LABELS: Record<string, string> = {
  subject: "Subject lines",
  hook: "Opening hooks",
  cta: "Calls to action",
  incentive: "Incentives",
};

const MIN_SENDS = 40; // matches evaluator's MIN_SENDS_FOR_VERDICT

function RateBar({ rate, baseline }: { rate: number; baseline: number }) {
  const beating = rate > baseline;
  const max = Math.max(rate, baseline, 5);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, (rate / max) * 100)}%`, background: beating ? "#10b981" : "var(--text-tertiary)" }}
        />
      </div>
      <span className="text-xs tabular-nums w-12 text-right" style={{ color: beating ? "#10b981" : "var(--text-secondary)" }}>
        {rate}%
      </span>
    </div>
  );
}

export default function ExperimentsPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [data, setData] = useState<ExperimentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    setLoading(true);
    fetch("/api/optimize/variants")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (path: string, label: string) => {
    setBusy(label);
    setMessage(null);
    try {
      const res = await fetch(path, { method: "POST" });
      const d = await res.json();
      if (d.error) { setMessage(d.error); }
      else if (label === "generate") { setMessage(`Generated ${d.total ?? 0} new variant(s).`); }
      else { setMessage(`Evaluation done — promoted ${d.promoted?.length ?? 0}, killed ${d.killed?.length ?? 0}, refilled ${d.refilled ?? 0}.`); }
      load();
    } catch {
      setMessage("Request failed.");
    } finally {
      setBusy(null);
    }
  };

  if (!ready || guardLoading || !session) {
    return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
    </div>;
  }

  const dimensions = data ? Object.keys(data.testingByDimension) : [];

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="px-5 py-5 border-b" style={{ borderColor: "var(--border)" }}>
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: "var(--accent)" }}>g</div>
            <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>gather</span>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          <Link href="/dashboard" className="sidebar-link">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Dashboard
          </Link>
          <Link href="/dashboard/apollo" className="sidebar-link">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Lead source
          </Link>
          <Link href="/dashboard/launch" className="sidebar-link">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Launch control
          </Link>
          <Link href="/dashboard/experiments" className="sidebar-link active">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            Experiments
          </Link>
          <Link href="/dashboard/features" className="sidebar-link">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Feature Requests
          </Link>
          <Link href="/onboarding" className="sidebar-link">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </nav>
        <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0" style={{ background: "var(--accent)" }}>
              {session.user?.email?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{session.user?.email}</p>
            </div>
            <button onClick={() => signOut({ callbackUrl: "/" })} className="text-xs flex-shrink-0" style={{ color: "var(--text-tertiary)" }} title="Log out">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Self-improving engine</h1>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
                Message variants being tested, scored on real positive-reply rate
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => runAction("/api/optimize/variants/evaluate", "evaluate")} disabled={!!busy} className="btn-secondary">
                {busy === "evaluate" ? "Evaluating…" : "Run evaluation"}
              </button>
              <button onClick={() => runAction("/api/optimize/variants/generate", "generate")} disabled={!!busy} className="btn-primary">
                {busy === "generate" ? "Generating…" : "Generate variants"}
              </button>
            </div>
          </div>

          {message && (
            <div className="mb-6 card p-4 border-l-4" style={{ borderLeftColor: "var(--accent)" }}>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>
            </div>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading experiments…</p>
          ) : !data || (data.testingCount === 0 && data.winners.length === 0 && data.learnings.length === 0) ? (
            <div className="card p-8 text-center">
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>No experiments yet</h2>
              <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                Click “Generate variants” to have the engine invent its first batch of subject lines, hooks, CTAs and incentives to test.
              </p>
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-4 mb-8">
                {[
                  { label: "Baseline reply rate", value: `${data.baselinePositiveRate}%` },
                  { label: "Active experiments", value: data.testingCount },
                  { label: "Proven winners", value: data.winners.length },
                  { label: "Learnings banked", value: data.learnings.length },
                ].map(({ label, value }) => (
                  <div key={label} className="card p-5">
                    <p className="text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>{label}</p>
                    <p className="text-2xl font-semibold mt-1.5 tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Proven learnings */}
              {data.learnings.length > 0 && (
                <div className="mb-8 card p-5 border-l-4" style={{ borderLeftColor: "#10b981" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#10b981" }}>Proven patterns (applied to every email)</p>
                  <ul className="space-y-1.5">
                    {data.learnings.map((l, i) => (
                      <li key={i} className="text-sm" style={{ color: "var(--text-secondary)" }}>• {l}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Active experiments by dimension */}
              {dimensions.map((dim) => (
                <div key={dim} className="mb-6 card overflow-hidden">
                  <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                    <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{DIMENSION_LABELS[dim] ?? dim}</h2>
                  </div>
                  <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {data.testingByDimension[dim].map((v) => (
                      <div key={v.id} className="px-6 py-4">
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{v.label}</p>
                            <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{v.instruction}</p>
                          </div>
                          <span className="text-xs whitespace-nowrap tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                            {v.sends < MIN_SENDS ? `${v.sends}/${MIN_SENDS} sends` : `${v.positives}/${v.sends} replies`}
                          </span>
                        </div>
                        {v.sends < MIN_SENDS ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                              <div className="h-full rounded-full" style={{ width: `${(v.sends / MIN_SENDS) * 100}%`, background: "var(--text-tertiary)" }} />
                            </div>
                            <span className="text-xs w-12 text-right" style={{ color: "var(--text-tertiary)" }}>gathering</span>
                          </div>
                        ) : (
                          <RateBar rate={v.positiveRate} baseline={data.baselinePositiveRate} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Winners */}
              {data.winners.length > 0 && (
                <div className="mb-6 card overflow-hidden">
                  <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                    <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Promoted winners</h2>
                  </div>
                  <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {data.winners.map((v) => (
                      <div key={v.id} className="px-6 py-4 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            <span className="text-xs mr-2 px-1.5 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-secondary)" }}>{v.dimension}</span>
                            {v.label}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{v.instruction}</p>
                        </div>
                        <span className="text-xs whitespace-nowrap tabular-nums font-medium" style={{ color: "#10b981" }}>{v.positiveRate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Killed */}
              {data.killed.length > 0 && (
                <div className="mb-6 card overflow-hidden">
                  <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                    <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Retired variants</h2>
                  </div>
                  <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {data.killed.map((v) => (
                      <div key={v.id} className="px-6 py-3">
                        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                          <span className="text-xs mr-2 px-1.5 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-tertiary)" }}>{v.dimension}</span>
                          {v.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
