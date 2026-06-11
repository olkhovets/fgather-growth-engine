"use client";
import DashboardSidebar from "@/components/DashboardSidebar";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import WebhookStatus from "@/components/WebhookStatus";
import ProviderBreakdown from "@/components/ProviderBreakdown";

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
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [webhook, setWebhook] = useState<{ configured: boolean } | null>(null);
  const [wildcards, setWildcards] = useState<Array<{ approach: string; sent: number; realReplies: number; positive: number; ooo: number; replyRatePct: number; positiveRatePct: number }>>([]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/onboarding").then((r) => r.json()).then((d) => setHasKey(Boolean(d.workspace?.hasAnthropicKey))).catch(() => {});
    fetch("/api/webhooks/instantly/setup").then((r) => r.json()).then((d) => { if (!d.error) setWebhook({ configured: d.configured }); }).catch(() => {});
    fetch("/api/optimize/wildcards").then((r) => r.json()).then((d) => { if (Array.isArray(d.approaches)) setWildcards(d.approaches); }).catch(() => {});
  }, [session?.user?.id]);

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
      else if (label === "seed") { setMessage(d.seeded > 0 ? `Added ${d.seeded} starter variants to test.` : (d.message ?? "Experiments already exist.")); }
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
      <DashboardSidebar active="experiments" userEmail={session.user?.email} />

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Self-improving engine</h1>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
                Two tests running: whole-email wildcard styles (clean) and blended subject/hook/CTA/incentive variants (directional). Both scored on positive replies.
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

          {/* Methodology — what's being measured and how, so the numbers aren't a mystery */}
          <details className="mb-6 card p-4" open>
            <summary className="text-sm font-semibold cursor-pointer" style={{ color: "var(--text-primary)" }}>How to read this page (methodology)</summary>
            <div className="mt-3 space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
              <p>There are <strong style={{ color: "var(--text-primary)" }}>two separate tests</strong> running, measured differently:</p>
              <div>
                <p style={{ color: "var(--text-primary)" }} className="font-medium">1. Wildcard approaches — whole-email styles (clean attribution)</p>
                <p>~10% of sends each get <em>one</em> radically different email style and nothing else layered on. A reply is cleanly attributable to that style. This is the better signal when hunting for what works from scratch.</p>
              </div>
              <div>
                <p style={{ color: "var(--text-primary)" }} className="font-medium">2. Variant experiments — subject / hook / CTA / incentive (blended, directional)</p>
                <p>Every normal email is a <strong style={{ color: "var(--text-primary)" }}>blend</strong>: it carries one subject variant + one hook + one CTA + one incentive <em>at the same time</em>. So when a variant shows &ldquo;0/2,551 replies,&rdquo; it means 2,551 emails that <em>included</em> this variant got 0 positive replies — but each of those emails also carried three other variants. These numbers show which elements <em>correlate</em> with replies; they are <strong style={{ color: "var(--text-primary)" }}>not</strong> a clean isolated A/B, because the same send counts toward four different variants. Treat them as directional.</p>
              </div>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                &ldquo;Replies&rdquo; = positive replies only (out-of-office and bounces are excluded). A variant needs ≥{MIN_SENDS} sends before it&apos;s scored — below that it shows &ldquo;N/{MIN_SENDS} sends, gathering data.&rdquo; Baseline = your overall positive-reply rate across all sends.
              </p>
            </div>
          </details>

          <ProviderBreakdown />

          {/* Wildcard approaches — radical swings on ~10% of sends, to find what breaks through */}
          {wildcards.length > 0 && (
            <div className="mb-8 card overflow-hidden">
              <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Wildcard approaches</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  Radically different email styles, each sent to a small slice. Watching for any that earns real replies (out-of-office excluded). A green positive count is a signal worth scaling.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                    {["Approach", "Sent", "Real replies", "Positive", "Reply %"].map((h) => (
                      <th key={h} className="px-6 py-2.5 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wildcards.map((a) => (
                    <tr key={a.approach} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="px-6 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>{a.approach}</td>
                      <td className="px-6 py-2.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>{a.sent.toLocaleString()}</td>
                      <td className="px-6 py-2.5 tabular-nums" style={{ color: a.realReplies > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{a.realReplies}</td>
                      <td className="px-6 py-2.5 tabular-nums font-medium" style={{ color: a.positive > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{a.positive > 0 ? `+${a.positive}` : "—"}</td>
                      <td className="px-6 py-2.5 tabular-nums" style={{ color: a.replyRatePct > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{a.replyRatePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading experiments…</p>
          ) : !data || (data.testingCount === 0 && data.winners.length === 0 && data.learnings.length === 0) ? (
            <div className="space-y-4">
              <div className="card p-6">
                <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>How the self-improving engine works</h2>
                <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                  The engine writes competing variants of your subject lines, hooks, CTAs and incentives, tags every email with the variants it used, then promotes the ones that earn the most positive replies. Four things need to be true before you&apos;ll see results here:
                </p>
                <ol className="space-y-3">
                  {[
                    { done: hasKey === true, title: "Add your Anthropic API key", detail: "Needed to generate variants and write emails.", href: "/onboarding", cta: "Open Settings" },
                    { done: (data?.testingCount ?? 0) > 0, title: "Generate the first variants", detail: "The engine invents a batch of subject lines, hooks, CTAs and incentives to test.", action: "generate" as const },
                    { done: (data?.baselinePositiveRate ?? 0) > 0, title: "Send some leads", detail: "Generate sequences in a campaign and launch them so variants get attached to real sends." },
                    { done: webhook?.configured === true, title: "Turn on reply tracking", detail: "Paste the Instantly reply webhook below so positive replies get counted — this is what picks winners." },
                  ].map((s, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-500 text-white" : "border border-gray-300 text-gray-400"}`}>
                        {s.done ? "✓" : i + 1}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{s.title}</p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.detail}</p>
                        {!s.done && "href" in s && s.href && (
                          <Link href={s.href} className="mt-1 inline-block text-xs font-medium" style={{ color: "var(--accent)" }}>{s.cta} →</Link>
                        )}
                        {!s.done && "action" in s && s.action === "generate" && (
                          <div className="mt-1 flex flex-wrap gap-3">
                            <button onClick={() => runAction("/api/optimize/variants/seed", "seed")} disabled={!!busy} className="text-xs font-medium disabled:opacity-50" style={{ color: "var(--accent)" }}>
                              {busy === "seed" ? "Adding…" : "Start with a default set →"}
                            </button>
                            <button onClick={() => runAction("/api/optimize/variants/generate", "generate")} disabled={!!busy || hasKey === false} className="text-xs font-medium disabled:opacity-50" style={{ color: "var(--text-secondary)" }}>
                              {busy === "generate" ? "Generating…" : "Or generate with AI"}
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <WebhookStatus />
            </div>
          ) : (
            <>
              {webhook?.configured === false && (
                <div className="mb-6"><WebhookStatus compact /></div>
              )}
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
              {dimensions.length > 0 && (
                <div className="mb-3">
                  <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Variant experiments (blended)</h2>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    Each email mixes one variant from every group below at once, so &ldquo;X/Y replies&rdquo; = positive replies among the Y emails that included this variant (which also carried a subject, hook, CTA and incentive variant). Directional, not an isolated A/B.
                  </p>
                </div>
              )}
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
