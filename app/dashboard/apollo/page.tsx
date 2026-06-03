"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

type SearchForm = {
  person_titles: string;
  person_seniorities: string;
  organization_locations: string;
  organization_num_employees_ranges: string;
  q_organization_keyword_tags: string;
  q_keywords: string;
  per_page: number;
};

const EMPTY: SearchForm = {
  person_titles: "",
  person_seniorities: "",
  organization_locations: "",
  organization_num_employees_ranges: "",
  q_organization_keyword_tags: "",
  q_keywords: "",
  per_page: 50,
};

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

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

function Field({ label, hint, value, onChange, placeholder, type = "text" }: {
  label: string; hint?: string; value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>{label}</label>
      {hint && <p className="text-xs mb-1.5" style={{ color: "var(--text-tertiary)" }}>{hint}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
      />
    </div>
  );
}

export default function ApolloPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [hasKey, setHasKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [form, setForm] = useState<SearchForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/apollo/config")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        setHasKey(Boolean(d.hasKey));
        if (d.search) {
          setForm({
            person_titles: (d.search.person_titles ?? []).join(", "),
            person_seniorities: (d.search.person_seniorities ?? []).join(", "),
            organization_locations: (d.search.organization_locations ?? []).join(", "),
            organization_num_employees_ranges: (d.search.organization_num_employees_ranges ?? []).join(", "),
            q_organization_keyword_tags: (d.search.q_organization_keyword_tags ?? []).join(", "),
            q_keywords: d.search.q_keywords ?? "",
            per_page: d.search.per_page ?? 50,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  const buildSearch = () => ({
    person_titles: splitList(form.person_titles),
    person_seniorities: splitList(form.person_seniorities),
    organization_locations: splitList(form.organization_locations),
    organization_num_employees_ranges: splitList(form.organization_num_employees_ranges),
    q_organization_keyword_tags: splitList(form.q_organization_keyword_tags),
    q_keywords: form.q_keywords.trim(),
    per_page: Number(form.per_page) || 50,
  });

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: { apiKey?: string; search: ReturnType<typeof buildSearch> } = { search: buildSearch() };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await fetch("/api/apollo/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      setMessage(d.error ? d.error : "Saved.");
      if (!d.error) { setApiKey(""); load(); }
    } finally { setSaving(false); }
  };

  const ingestNow = async () => {
    setIngesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/apollo/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: buildSearch() }),
      });
      const d = await res.json();
      setMessage(d.error ? d.error : d.message);
    } catch {
      setMessage("Ingest request failed.");
    } finally { setIngesting(false); }
  };

  if (!ready || guardLoading || !session) {
    return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
    </div>;
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar email={session.user?.email} active="apollo" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          <div className="mb-8">
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Lead source — Apollo</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Define who to target. The engine pulls matching leads daily, dedupes against everyone you've contacted, and drops them into a fresh batch.
            </p>
          </div>

          {message && (
            <div className="mb-6 card p-4 border-l-4" style={{ borderLeftColor: "var(--accent)" }}>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>
            </div>
          )}

          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
          ) : (
            <div className="space-y-6">
              <div className="card p-6 space-y-4">
                <Field
                  label="Apollo API key"
                  hint={hasKey ? "A key is saved. Leave blank to keep it, or paste a new one to replace." : "Get this from Apollo → Settings → Integrations → API."}
                  value={apiKey}
                  onChange={setApiKey}
                  placeholder={hasKey ? "•••••••••• (saved)" : "Paste your Apollo API key"}
                  type="password"
                />
              </div>

              <div className="card p-6 space-y-4">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Target search</h2>
                <Field label="Job titles" hint="Comma-separated. e.g. CMO, VP of Marketing, Head of Brand" value={form.person_titles} onChange={(v) => setForm({ ...form, person_titles: v })} placeholder="CMO, VP of Marketing" />
                <Field label="Seniorities" hint="Comma-separated Apollo values. e.g. c_suite, vp, head, director" value={form.person_seniorities} onChange={(v) => setForm({ ...form, person_seniorities: v })} placeholder="c_suite, vp, director" />
                <Field label="Locations" hint="Comma-separated. e.g. United States, United Kingdom" value={form.organization_locations} onChange={(v) => setForm({ ...form, organization_locations: v })} placeholder="United States" />
                <Field label="Company size ranges" hint='Comma-separated Apollo ranges. e.g. 11,50  51,200  201,500' value={form.organization_num_employees_ranges} onChange={(v) => setForm({ ...form, organization_num_employees_ranges: v })} placeholder="51,200, 201,500" />
                <Field label="Industry / keyword tags" hint="Comma-separated. e.g. consumer goods, retail, fashion" value={form.q_organization_keyword_tags} onChange={(v) => setForm({ ...form, q_organization_keyword_tags: v })} placeholder="consumer goods, retail" />
                <Field label="Free-text keywords" hint="Optional broad keyword match." value={form.q_keywords} onChange={(v) => setForm({ ...form, q_keywords: v })} placeholder="DTC brand" />
              </div>

              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save"}</button>
                <button onClick={ingestNow} disabled={ingesting || (!hasKey && !apiKey.trim())} className="btn-secondary">
                  {ingesting ? "Pulling leads…" : "Pull leads now"}
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Once saved, the daily job pulls automatically. Use “Pull leads now” to run it immediately. New leads land in a batch named “Apollo &lt;date&gt;” on your dashboard.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
