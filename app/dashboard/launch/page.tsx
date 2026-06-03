"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

type Sample = { name: string | null; company: string | null; step1Subject: string | null; step1Body: string | null };
type BatchStatus = {
  id: string;
  name: string | null;
  createdAt: string;
  total: number;
  withSequences: number;
  sent: number;
  contactable: number;
  needsGeneration: number;
  samples: Sample[];
};

function Sidebar({ email, active }: { email?: string | null; active: string }) {
  const link = (href: string, label: string, path: string, isActive: boolean) => (
    <Link href={href} className={`sidebar-link${isActive ? " active" : ""}`}>
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
      {label}
    </Link>
  );
  return (
    <aside className="w-60 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="px-5 py-5 border-b" style={{ borderColor: "var(--border)" }}>
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: "var(--accent)" }}>g</div>
          <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>gather</span>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {link("/dashboard", "Dashboard", "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6", active === "dashboard")}
        {link("/dashboard/apollo", "Lead source", "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", active === "apollo")}
        {link("/dashboard/launch", "Launch control", "M13 10V3L4 14h7v7l9-11h-7z", active === "launch")}
        {link("/dashboard/experiments", "Experiments", "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z", active === "experiments")}
        {link("/onboarding", "Settings", "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", active === "settings")}
      </nav>
      <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0" style={{ background: "var(--accent)" }}>
            {email?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{email}</p></div>
          <button onClick={() => signOut({ callbackUrl: "/" })} className="text-xs flex-shrink-0" style={{ color: "var(--text-tertiary)" }} title="Log out">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function LaunchPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [batches, setBatches] = useState<BatchStatus[]>([]);
  const [autopilot, setAutopilot] = useState(false);
  const [playbookApproved, setPlaybookApproved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyBatch, setBusyBatch] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { generated: number; total: number }>>({});
  const [sendLimits, setSendLimits] = useState<Record<string, string>>({});
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/orchestrate/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setMessage(d.error); return; }
        setBatches(d.batches ?? []);
        setAutopilot(Boolean(d.autopilot));
        setPlaybookApproved(d.playbookApproved !== false);
      })
      .finally(() => setLoading(false));
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  const toggleAutopilot = async () => {
    const next = !autopilot;
    setAutopilot(next);
    await fetch("/api/orchestrate/autopilot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  };

  // Generate sequences for a batch using the existing chunked endpoint (human stays on the page)
  const generate = async (batchId: string) => {
    setBusyBatch(batchId);
    setMessage(null);
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetch("/api/leads/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId, useFastModel: true }),
        });
        const text = await res.text();
        let data: { error?: string; done?: number; total?: number } = {};
        try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(text?.slice(0, 200) || "Generate failed"); }
        if (!res.ok) throw new Error(data.error || "Generate failed");
        const done = data.done ?? 0;
        const remaining = data.total ?? 0;
        setProgress((p) => ({ ...p, [batchId]: { generated: Math.max(0, (p[batchId]?.total ?? remaining) - remaining), total: p[batchId]?.total ?? remaining } }));
        if (done === 0) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      setMessage("Sequences generated. Review the samples below, then approve to send.");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusyBatch(null);
    }
  };

  const approveAndSend = async (batchId: string) => {
    const name = (campaignNames[batchId] ?? "").trim();
    if (!name) { setMessage("Give the campaign a name before sending."); return; }
    const limitRaw = sendLimits[batchId];
    const sendLimit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : undefined;
    setBusyBatch(batchId);
    setMessage(null);
    setConfirmSend(null);
    try {
      const res = await fetch("/api/instantly/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, campaignName: name, ...(sendLimit ? { sendLimit } : {}) }),
      });
      const d = await res.json();
      if (!res.ok || d.error) { setMessage(d.error ?? "Send failed."); }
      else { setMessage(`Launched “${name}” — ${d.leads_uploaded ?? 0} leads uploaded to Instantly.`); }
      load();
    } catch {
      setMessage("Send request failed.");
    } finally {
      setBusyBatch(null);
    }
  };

  if (!ready || guardLoading || !session) {
    return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
    </div>;
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar email={session.user?.email} active="launch" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Launch control</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Generate sequences, review the output, then approve each send. Nothing goes out without your click.
            </p>
          </div>

          {/* Mode banner */}
          <div className="mb-6 card p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {autopilot ? "Autopilot preference: ON" : "Manual approval (recommended)"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {autopilot
                  ? "Hands-off sending isn't wired yet — sends still require your approval below until that's enabled."
                  : "Every batch waits for your review and approval before any email is sent."}
              </p>
            </div>
            <button onClick={toggleAutopilot} className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors" style={{ background: autopilot ? "var(--accent)" : "var(--border)" }}>
              <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" style={{ transform: autopilot ? "translateX(24px)" : "translateX(4px)" }} />
            </button>
          </div>

          {!playbookApproved && (
            <div className="mb-6 rounded-xl border px-4 py-3 text-sm" style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" }}>
              Approve your playbook in Settings before sending — it's required to launch.
            </div>
          )}

          {message && (
            <div className="mb-6 card p-4 border-l-4" style={{ borderLeftColor: "var(--accent)" }}>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>
            </div>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading batches…</p>
          ) : batches.length === 0 ? (
            <div className="card p-8 text-center">
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>No lead batches yet</h2>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Pull leads from <Link href="/dashboard/apollo" className="underline" style={{ color: "var(--accent)" }}>Apollo</Link> or upload a CSV to get started.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {batches.map((b) => {
                const allGenerated = b.needsGeneration === 0 && b.withSequences > 0;
                const fullySent = b.contactable === 0 && b.sent > 0;
                return (
                  <div key={b.id} className="card overflow-hidden">
                    <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{b.name ?? "Untitled batch"}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                          {b.total} leads · {b.withSequences} generated · {b.sent} sent · {b.contactable} ready to send
                        </p>
                      </div>
                      {fullySent && <span className="badge-launched"><span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />Sent</span>}
                    </div>

                    <div className="px-6 py-4 space-y-4">
                      {/* Generation */}
                      {b.needsGeneration > 0 ? (
                        <div className="flex items-center justify-between">
                          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                            {b.needsGeneration} lead{b.needsGeneration === 1 ? "" : "s"} need sequences
                          </p>
                          <button onClick={() => generate(b.id)} disabled={busyBatch === b.id} className="btn-secondary">
                            {busyBatch === b.id ? "Generating…" : "Generate sequences"}
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm" style={{ color: "#10b981" }}>✓ All contactable leads have sequences</p>
                      )}

                      {/* Sample preview */}
                      {b.samples.length > 0 && (
                        <div className="rounded-lg border divide-y" style={{ borderColor: "var(--border)" }}>
                          {b.samples.map((s, i) => (
                            <div key={i} className="p-3">
                              <p className="text-xs font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>
                                {s.name ?? "—"}{s.company ? ` · ${s.company}` : ""}
                              </p>
                              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{s.step1Subject ?? "(no subject)"}</p>
                              <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{s.step1Body ?? ""}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Approve & send gate */}
                      {allGenerated && b.contactable > 0 && (
                        <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface-subtle)" }}>
                          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Approve &amp; send</p>
                          <div className="flex gap-2">
                            <input
                              value={campaignNames[b.id] ?? ""}
                              onChange={(e) => setCampaignNames((p) => ({ ...p, [b.id]: e.target.value }))}
                              placeholder="Campaign name"
                              className="flex-1 rounded-lg border px-3 py-2 text-sm"
                              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                            />
                            <input
                              value={sendLimits[b.id] ?? ""}
                              onChange={(e) => setSendLimits((p) => ({ ...p, [b.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                              placeholder={`Limit (max ${b.contactable})`}
                              className="w-36 rounded-lg border px-3 py-2 text-sm"
                              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                            />
                          </div>
                          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                            Leave the limit blank to send all {b.contactable}. Suppressed and already-replied leads are excluded automatically.
                          </p>
                          {confirmSend === b.id ? (
                            <div className="flex items-center gap-2">
                              <button onClick={() => approveAndSend(b.id)} disabled={busyBatch === b.id || !playbookApproved} className="btn-primary">
                                {busyBatch === b.id ? "Sending…" : "Confirm — send now"}
                              </button>
                              <button onClick={() => setConfirmSend(null)} className="btn-secondary">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmSend(b.id)} disabled={!playbookApproved} className="btn-primary">
                              Review done — approve send
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
