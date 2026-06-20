"use client";
import DashboardSidebar from "@/components/DashboardSidebar";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

type Company = { name: string; domain: string; competitor: string; b2cFit: boolean; note?: string };
type Person = { name: string; title: string; company: string; competitor: string; angle: string };
type Persona = { key: string; label: string; emailPositives: number; liClicks: number; liCtr: number; reason: string };
type Targets = { companies: Company[]; people: Person[]; priorityPersonas: Persona[] };

export default function PoachPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [data, setData] = useState<Targets | null>(null);

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/poach/targets").then((r) => r.json()).then(setData).catch(() => {});
  }, [session?.user?.id]);
  useEffect(() => { load(); }, [load]);

  if (!ready || guardLoading || !session) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text-tertiary)" }}>Loading…</div>;
  }

  const companies = data?.companies ?? [];
  const people = data?.people ?? [];
  const personas = (data?.priorityPersonas ?? []).filter((p) => p.liClicks > 0 || p.emailPositives > 0);
  const b2c = companies.filter((c) => c.b2cFit);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="poach" userEmail={session.user?.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>Competitors</h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            People and companies publicly using Listen Labs, Outset, Evidenza or VoicePanel already buy AI consumer research — the warmest cold audience there is. Reach them on LinkedIn (no Apollo needed) and via email.
          </p>

          {/* The #3 ask: email targeting from both channels */}
          <div className="card p-5 mb-6" style={{ borderLeft: "3px solid var(--accent)" }}>
            <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Turn both channels into email targets</h2>
            <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
              You can&apos;t get the emails of people who *clicked* your LinkedIn ads — LinkedIn only shares aggregate demographics. Two real ways to convert the signal into email:
            </p>
            <ol className="text-sm space-y-1.5 mb-3" style={{ color: "var(--text-secondary)" }}>
              <li>1. <b>Lead-gen ads capture emails directly</b> — those become leads in the pipeline; email them.</li>
              <li>2. <b>Let engagement pick who to pull + email.</b> The personas/companies engaging below are exactly who to pull from Apollo (their Insights/Brand titles) and cold-email while the ad demand is warm.</li>
            </ol>
            {personas.length > 0 ? (
              <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--text-tertiary)" }}>Email these next (engaging on LinkedIn / email)</p>
                {personas.map((p) => (
                  <div key={p.key} className="flex justify-between text-sm py-0.5" style={{ color: "var(--text-primary)" }}>
                    <span>{p.label}</span><span style={{ color: "var(--text-tertiary)" }}>{p.reason}</span>
                  </div>
                ))}
                <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>→ In Leads, pull these titles from Apollo (when credits allow) and run them through Generate &amp; send.</p>
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>No engagement signal yet — once LinkedIn/email data accrues, the personas to email show here.</p>
            )}
          </div>

          {/* LinkedIn audience download — Apollo-free */}
          <div className="card p-4 mb-6">
            <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>LinkedIn matched audience (no Apollo needed)</p>
            <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>Download the competitor companies as a LinkedIn company list, upload it in Campaign Manager, and aim ads at Insights/Brand/Growth titles there.</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <a className="btn-secondary" href="/api/poach/audience?b2c=1">Consumer brands ({b2c.length})</a>
              <a className="btn-secondary" href="/api/poach/audience">All companies ({companies.length})</a>
            </div>
          </div>

          {/* Named people */}
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>Named people — reach directly</h2>
          <div className="space-y-2 mb-6">
            {people.map((p) => (
              <div key={p.name + p.company} className="card p-3">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{p.name} · {p.title}, {p.company} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(uses {p.competitor})</span></p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{p.angle}</p>
              </div>
            ))}
          </div>

          {/* Companies */}
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-tertiary)" }}>Companies ({companies.length})</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text-tertiary)" }} className="text-left text-xs uppercase tracking-wide">
                  <th className="px-4 py-2 font-medium">Company</th><th className="px-4 py-2 font-medium">Uses</th><th className="px-4 py-2 font-medium">Fit</th><th className="px-4 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.name} className="border-t" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>{c.competitor}</td>
                    <td className="px-4 py-2.5">{c.b2cFit ? <span style={{ color: "#16a34a", fontWeight: 600 }}>B2C ✓</span> : <span style={{ color: "var(--text-tertiary)" }}>enterprise</span>}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-tertiary)" }}>{c.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
