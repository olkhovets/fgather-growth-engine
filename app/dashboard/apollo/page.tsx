"use client";
import DashboardSidebar from "@/components/DashboardSidebar";

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
  providerFilter: string;
};

const EMPTY: SearchForm = {
  person_titles: "",
  person_seniorities: "",
  organization_locations: "",
  organization_num_employees_ranges: "",
  q_organization_keyword_tags: "",
  q_keywords: "",
  per_page: 50,
  providerFilter: "all",
};

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
// Employee ranges each look like "51,200" (a comma INSIDE the value), so we can't split
// on commas. Pull out every "min,max" pair regardless of how the user separates them.
const splitRanges = (s: string) => (s.match(/\d+\s*,\s*\d+/g) ?? []).map((r) => r.replace(/\s+/g, ""));

function Sidebar({ email, active }: { email?: string | null; active: string }) {
  return <DashboardSidebar active={active} userEmail={email} />;
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
  const [numToPull, setNumToPull] = useState("100");
  const [csvInput, setCsvInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

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
            organization_num_employees_ranges: (d.search.organization_num_employees_ranges ?? []).join("  "),
            q_organization_keyword_tags: (d.search.q_organization_keyword_tags ?? []).join(", "),
            q_keywords: d.search.q_keywords ?? "",
            per_page: d.search.per_page ?? 50,
            providerFilter: d.search.providerFilter ?? "all",
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
    organization_num_employees_ranges: splitRanges(form.organization_num_employees_ranges),
    q_organization_keyword_tags: splitList(form.q_organization_keyword_tags),
    q_keywords: form.q_keywords.trim(),
    per_page: Number(form.per_page) || 50,
    providerFilter: form.providerFilter || "all",
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
      const limit = Math.min(1000, Math.max(1, parseInt(numToPull) || 100));
      const res = await fetch("/api/apollo/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search: buildSearch(), limit }),
      });
      const d = await res.json();
      setMessage(d.error ? d.error : d.message);
    } catch {
      setMessage("Ingest request failed.");
    } finally { setIngesting(false); }
  };

  const uploadCsv = async () => {
    if (!csvInput.trim()) { setUploadMsg("Paste CSV rows or choose a file first."); return; }
    setUploading(true);
    setUploadMsg(null);
    try {
      // Parse client-side and upload pre-parsed rows in chunks. Sending the raw CSV in one
      // request can exceed Vercel's 4.5MB body limit (which returns non-JSON and looks like
      // a generic failure); chunked pre-parsed rows stay well under it.
      const lines = csvInput.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("Need a header row plus at least one data row.");
      const first = lines[0];
      const isTab = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length;
      const split = (line: string) => isTab
        ? line.split("\t").map((v) => v.trim().replace(/^"|"$/g, ""))
        : (() => {
            const out: string[] = []; let cur = ""; let q = false;
            for (const c of line) {
              if (c === '"') q = !q;
              else if (c === "," && !q) { out.push(cur.trim().replace(/^"|"$/g, "")); cur = ""; }
              else cur += c;
            }
            out.push(cur.trim().replace(/^"|"$/g, "")); return out;
          })();
      const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      const ALIASES: Record<string, string> = {
        email: "email", e_mail: "email", work_email: "email",
        first_name: "name", firstname: "name", name: "name", full_name: "name",
        job_title: "job_title", jobtitle: "job_title", title: "job_title",
        company: "company", company_name: "company", organization: "company",
        website: "website", company_url: "website", company_website: "website", industry: "industry",
      };
      const get = (row: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) { const v = row[k] ?? row[ALIASES[k]]; if (v) return v; }
        return "";
      };
      const leads: Array<{ email: string; name?: string; jobTitle?: string; company?: string; website?: string; industry?: string }> = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = split(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, j) => { row[h] = vals[j]?.trim() ?? ""; });
        const email = get(row, "email", "e_mail", "work_email") || vals[0] || "";
        if (!email.trim()) continue;
        const site = get(row, "website", "company_url", "company_website");
        leads.push({
          email: email.trim(),
          name: get(row, "name", "first_name", "firstname", "full_name") || undefined,
          jobTitle: get(row, "job_title", "jobtitle", "title") || undefined,
          company: get(row, "company", "company_name", "organization") || undefined,
          website: site ? (site.startsWith("http") ? site : `https://${site.replace(/^www\./, "")}`) : undefined,
          industry: get(row, "industry") || undefined,
        });
      }
      if (leads.length === 0) throw new Error("No rows with a valid email found. Check your column headers.");

      const CHUNK = 500;
      let batchId: string | null = null;
      let total = 0;
      for (let i = 0; i < leads.length; i += CHUNK) {
        const res = await fetch("/api/leads/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: leads.slice(i, i + CHUNK), batchId }),
        });
        const text = await res.text();
        let d: { error?: string; batchId?: string; count?: number };
        try { d = JSON.parse(text); } catch { throw new Error(`Server error (${res.status}). ${text.slice(0, 120)}`); }
        if (!res.ok || d.error) throw new Error(d.error || `Upload failed (${res.status}).`);
        if (i === 0) batchId = d.batchId ?? null;
        total = d.count ?? total;
      }
      setUploadMsg(`Uploaded ${total} leads. It's now a batch on your dashboard, ready to generate & send.`);
      setCsvInput("");
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : "Upload failed.");
    } finally { setUploading(false); }
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
                <Field label="Company size ranges" hint='Each range is min,max. Separate multiple ranges with spaces. e.g. 51,200  201,500  501,1000' value={form.organization_num_employees_ranges} onChange={(v) => setForm({ ...form, organization_num_employees_ranges: v })} placeholder="51,200  201,500  501,1000" />
                <Field label="Industry / keyword tags" hint="Comma-separated. e.g. consumer goods, retail, fashion" value={form.q_organization_keyword_tags} onChange={(v) => setForm({ ...form, q_organization_keyword_tags: v })} placeholder="consumer goods, retail" />
                <Field label="Free-text keywords" hint="Optional broad keyword match." value={form.q_keywords} onChange={(v) => setForm({ ...form, q_keywords: v })} placeholder="DTC brand" />
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>Inbox provider filter</label>
                  <p className="text-xs mb-1.5" style={{ color: "var(--text-tertiary)" }}>
                    Only keep leads whose email provider is friendly to cold outreach (classified by MX at pull time). ~73% of your current sends hit strict gateways (Proofpoint/Mimecast/Microsoft) that quarantine cold email.
                  </p>
                  <select
                    value={form.providerFilter}
                    onChange={(e) => setForm({ ...form, providerFilter: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                  >
                    <option value="all">All providers (no filter)</option>
                    <option value="no-gateways">Exclude strict gateways (drop Proofpoint / Mimecast / Barracuda)</option>
                    <option value="google">Google Workspace only (best deliverability)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>Leads to pull</label>
                  <input
                    type="number" min={1} max={1000} value={numToPull}
                    onChange={(e) => setNumToPull(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-28 rounded-lg border px-3 py-2 text-sm"
                    style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                  />
                </div>
                <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save"}</button>
                <button onClick={ingestNow} disabled={ingesting || (!hasKey && !apiKey.trim())} className="btn-secondary">
                  {ingesting ? "Pulling leads…" : `Pull ${Math.min(1000, Math.max(1, parseInt(numToPull) || 100))} leads now`}
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Max 500 per pull. Each enriched lead uses one Apollo credit. Once saved, the daily job also pulls automatically. New leads land in a batch named “Apollo &lt;date&gt;” on your dashboard.
              </p>

              <div className="card p-6 space-y-3">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Or upload your own leads (CSV)</h2>
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                  Columns: email, name, company, job title, website, industry (any order; extra columns ignored). Upload a file or paste rows.
                </p>
                <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                  Choose CSV file
                  <input type="file" accept=".csv,.txt" className="sr-only" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    setCsvInput(await file.text()); setUploadMsg(`Loaded ${file.name}. Click Upload leads.`); e.target.value = "";
                  }} />
                </label>
                <textarea
                  value={csvInput}
                  onChange={(e) => setCsvInput(e.target.value)}
                  rows={4}
                  placeholder={"email,name,company,job title,website\njane@acme.com,Jane,Acme,VP Marketing,acme.com"}
                  className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                  style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                />
                <div className="flex items-center gap-3">
                  <button onClick={uploadCsv} disabled={uploading || !csvInput.trim()} className="btn-primary">
                    {uploading ? "Uploading…" : "Upload leads"}
                  </button>
                  {uploadMsg && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{uploadMsg}</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
