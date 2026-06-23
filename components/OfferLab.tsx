"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import ProviderBreakdown from "@/components/ProviderBreakdown";

/**
 * The "offer" (incentive) send mode, extracted from the old Incentives Lab page so
 * it can live INSIDE the one Generate & send pipeline instead of being a separate
 * tab + separate send path. It reuses the proven /api/incentives/* backends
 * verbatim — this is a UI consolidation, not a send-logic rewrite. Rendered both
 * by the Generate & send page (folded in) and the legacy incentives route.
 */

const ALLOWED_AMOUNTS = [50, 100, 150, 200, 250, 500];
const SUBJECT_PRESETS: Array<{ label: string; template: string; category: "credentialed" | "confident" | "clean" }> = [
  { label: "belk-bagel-want", template: "how Belk and Bagel Brands learn what customers actually want", category: "credentialed" },
  { label: "behind-staples-belk", template: "the consumer research behind Staples and Belk", category: "credentialed" },
  { label: "gartner-team", template: "{{firstName}}, the team behind Gartner Peer Insights built this", category: "credentialed" },
  { label: "menlo-backed", template: "Menlo-backed consumer research for {{companyName}}", category: "credentialed" },
  { label: "ai-marketing-hire", template: "an AI marketing hire for {{companyName}}", category: "credentialed" },
  { label: "days-not-six-weeks", template: "real consumer answers in days, not six weeks", category: "credentialed" },
  { label: "behind-our-pitch", template: "{{firstName}}, we'll put ${{amount}} behind our pitch", category: "confident" },
  { label: "confident-enough", template: "confident enough to put ${{amount}} on 20 minutes", category: "confident" },
  { label: "back-it", template: "we'll back it with ${{amount}} for your time, {{firstName}}", category: "confident" },
  { label: "sure-it-helps", template: "${{amount}} for 20 minutes, and here's why we're sure", category: "confident" },
  { label: "worth-20", template: "{{firstName}}, worth 20 minutes?", category: "clean" },
  { label: "quick-one", template: "quick one on {{companyName}}'s consumer research", category: "clean" },
  { label: "right-person", template: "for whoever owns consumer research at {{companyName}}", category: "clean" },
  { label: "faster-answers", template: "{{companyName}} + faster consumer answers", category: "clean" },
];
const BODY_PRESETS = [
  { label: "The gap (mission-led)", template: "Most teams market on what they think customers want, not what customers actually need. Gather closes that gap with real consumer research in days, not six weeks. Brands like Belk, Bagel Brands, and Empire Today run it, and we're backed by Menlo. Confident it helps {{companyName}}, so I'll back it with a ${{amount}} {{gift}} for a 20-minute demo.\nWorth it?" },
  { label: "Not generic AI copy", template: "Most teams are drowning in generic AI copy. Gather is the opposite: real consumer research underneath every asset, the kind you'd have briefed to an agency. Used by Staples, Belk, and Bagel Brands, backed by Menlo. I'll send a ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nReply and I'll set it up?" },
  { label: "Six weeks + budget", template: "If a real consumer study at {{companyName}} still means six weeks and next year's research budget, that's exactly what we fix: answers in days at a tenth of the cost. Belk, Empire Today, and Bagel Brands use us; we're Menlo-backed. A ${{amount}} {{gift}} for a 20-minute demo.\nWorth a reply?" },
  { label: "One study, twelve outputs", template: "With Gather, one consumer study fans out into a dozen ship-ready assets, the report, the landing page, the ad copy. Brands like Staples, Belk, and Bagel Brands run it, and we're backed by Menlo. Confident it helps {{companyName}}, so a ${{amount}} {{gift}} for a 20-minute demo.\nIn?" },
  { label: "Founder pedigree", template: "Gather is from the team that built Gartner Peer Insights. We run AI consumer research for Belk, Staples, and Bagel Brands, answers in days not months, backed by Menlo and Anthropic. I'll put a ${{amount}} {{gift}} behind a 20-minute demo for {{companyName}}.\nWorth it?" },
  { label: "AI marketing hire", template: "Think of Gather as an AI marketing hire: it runs real consumer research and turns it into on-brand content, in days. Belk, Empire Today, and Bagel Brands already use it, and we're Menlo-backed. I'll send a ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nReply and I'll set it up?" },
  { label: "Surveys miss the why", template: "Surveys miss the why. Gather runs AI-moderated interviews against a 60M-person panel and turns them into content in days. Used by Staples, Belk, and Bagel Brands, backed by Menlo. A ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nWorth a yes?" },
  { label: "Consumer peers", template: "Consumer brands like Bagel Brands, Naf Naf, and Belk use Gather to find out what their customers actually want before they spend on a campaign, in days, not months. We're Menlo-backed. A ${{amount}} {{gift}} for a 20-minute demo with {{companyName}}.\nReply \"yes\"?" },
  { label: "Cost + confidence", template: "Traditional consumer research runs six to eight weeks and up to $100k. Gather does it in days at a tenth of that, which is why Staples, Belk, and Bagel Brands use us. We're confident enough it helps {{companyName}} to put a ${{amount}} {{gift}} behind a 20-minute demo.\nWorth a reply?" },
];
const FOLLOWUPS: Array<{ body: string; delayDays: number }> = [
  { delayDays: 3, body: "Quick follow up, {{firstName}}. Belk, Staples, and Bagel Brands use Gather to learn what their customers actually want, in days. We're Menlo-backed. That ${{amount}} {{gift}} for a 20-minute demo still stands. Worth a reply?" },
  { delayDays: 3, body: "Last note from me. Gather is from the team behind Gartner Peer Insights, backed by Menlo and Anthropic, and I'm confident it helps {{companyName}}. The ${{amount}} {{gift}} for a 20-minute demo is still yours. Want me to set it up?" },
];

function render(tpl: string, amount: number) {
  return tpl.replace(/\{\{\s*amount\s*\}\}/g, String(amount)).replace(/\{\{\s*gift\s*\}\}/g, "Uber Eats card").replace(/\{\{\s*firstName\s*\}\}/g, "Maya").replace(/\{\{\s*companyName\s*\}\}/g, "Olipop");
}

type AmtRow = { amount: number; sent: number; realReplies: number; positive: number; replyRatePct: number };
type StyleRow = { style: string; sent: number; realReplies: number; positive: number; replyRatePct: number };

export default function OfferLab() {
  const { data: session } = useSession();
  const [subjectTemplates, setSubjectTemplates] = useState<string[]>([SUBJECT_PRESETS[0].template, SUBJECT_PRESETS[1].template]);
  const [bodyTemplate, setBodyTemplate] = useState(BODY_PRESETS[0].template);
  const [amounts, setAmounts] = useState<number[]>([50, 100, 200]);
  const [batches, setBatches] = useState<Array<{ id: string; name: string | null; leadCount: number }>>([]);
  const [batchId, setBatchId] = useState("");
  const [sendLimit, setSendLimit] = useState("300");
  const [providerFilter, setProviderFilter] = useState<"google" | "no-gateways" | "all">("google");
  const [warmedInboxesOnly, setWarmedInboxesOnly] = useState(true);
  const [freshCampaign, setFreshCampaign] = useState(false);
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [autopilotBusy, setAutopilotBusy] = useState(false);
  const [apPerRun, setApPerRun] = useState("50");
  const [apIntervalMin, setApIntervalMin] = useState("30");
  const [apDailyCap, setApDailyCap] = useState("500");
  const [recentRuns, setRecentRuns] = useState<Array<{ at: string; ingested: number; appended: number; sentToday: number | null; dailyCap: number | null; distribution: Array<{ amount: number; style: string; leads: number }>; error: string | null }>>([]);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [amtResults, setAmtResults] = useState<AmtRow[]>([]);
  const [styleResults, setStyleResults] = useState<StyleRow[]>([]);
  const [eligibility, setEligibility] = useState<{ total: number; google: number; noGateways: number; unclassified: number } | null>(null);

  const loadResults = useCallback(() => {
    fetch("/api/incentives/results").then((r) => r.json()).then((d) => { setAmtResults(d.amounts ?? []); setStyleResults(d.styles ?? []); }).catch(() => {});
  }, []);

  const loadAutopilot = useCallback(() => {
    fetch("/api/incentives/autopilot").then((r) => r.json()).then((d) => {
      setAutopilotEnabled(Boolean(d.enabled));
      if (d.perRun != null) setApPerRun(String(d.perRun));
      if (d.intervalMin != null) setApIntervalMin(String(d.intervalMin));
      if (d.dailyCap != null) setApDailyCap(String(d.dailyCap));
      setRecentRuns(d.recentRuns ?? []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/incentives/config").then((r) => r.json()).then((d) => {
      if (d.config) { setSubjectTemplates(d.config.subjectTemplates ?? [SUBJECT_PRESETS[0].template]); setBodyTemplate(d.config.bodyTemplate); setAmounts(d.config.amounts); }
    }).catch(() => {});
    fetch("/api/leads").then((r) => r.json()).then((d) => setBatches(d.batches ?? [])).catch(() => {});
    loadAutopilot();
    loadResults();
  }, [session?.user?.id, loadResults, loadAutopilot]);

  const toggleAutopilot = async () => {
    setAutopilotBusy(true);
    try {
      const res = await fetch("/api/incentives/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !autopilotEnabled }) });
      const d = await res.json();
      if (!d.error) setAutopilotEnabled(Boolean(d.enabled));
      setMessage(d.error || (d.enabled ? "Offer autopilot ON — it'll pull fresh leads when low and append them into the rolling campaign automatically." : "Offer autopilot OFF."));
    } finally { setAutopilotBusy(false); }
  };

  const saveAutopilotSettings = async () => {
    setAutopilotBusy(true);
    try {
      const res = await fetch("/api/incentives/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ perRun: parseInt(apPerRun) || 50, intervalMin: parseInt(apIntervalMin) || 30, dailyCap: parseInt(apDailyCap) || 500 }) });
      const d = await res.json();
      if (!d.error) { setApPerRun(String(d.perRun)); setApIntervalMin(String(d.intervalMin)); setApDailyCap(String(d.dailyCap)); }
      setMessage(d.error || "Autopilot pace saved.");
    } finally { setAutopilotBusy(false); }
  };

  const runAutopilotNow = async () => {
    setAutopilotBusy(true); setMessage("Running offer autopilot…");
    try {
      const res = await fetch("/api/incentives/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run: true }) });
      const d = await res.json();
      const r = d.runResult ?? {};
      setMessage(d.error || r.error || `Autopilot run: pulled ${r.ingested ?? 0} new leads, appended ${r.appended ?? 0} into the rolling campaign.`);
      loadResults(); loadAutopilot();
    } catch { setMessage("Autopilot run failed."); } finally { setAutopilotBusy(false); }
  };

  useEffect(() => {
    if (!batchId) { setEligibility(null); return; }
    setEligibility(null);
    fetch(`/api/incentives/eligibility?batchId=${encodeURIComponent(batchId)}`).then((r) => r.json()).then((d) => { if (!d.error) setEligibility(d); }).catch(() => {});
  }, [batchId]);

  const toggleSubject = (t: string) => setSubjectTemplates((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t].slice(0, 4));
  const toggleAmount = (a: number) => setAmounts((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a].sort((x, y) => x - y).slice(0, 5));

  const saveConfig = async () => {
    setSaving(true); setMessage(null);
    try { const res = await fetch("/api/incentives/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: { subjectTemplates, bodyTemplate, amounts } }) }); const d = await res.json(); setMessage(d.error || "Saved."); } finally { setSaving(false); }
  };

  const launch = async () => {
    if (!batchId) { setMessage("Pick a lead batch first."); return; }
    if (subjectTemplates.length === 0 || amounts.length === 0) { setMessage("Pick at least one subject style and one amount."); return; }
    setLaunching(true); setMessage(null);
    try {
      const res = await fetch("/api/incentives/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, sendLimit: parseInt(sendLimit) || 300, providerFilter, warmedInboxesOnly, freshCampaign, config: { subjectTemplates, bodyTemplate, amounts } }) });
      const d = await res.json();
      const inboxBit = d.warmedInboxes != null ? ` from ${d.warmedInboxes} warmed inboxes` : "";
      const provBit = d.providerFilter && d.providerFilter !== "all" && d.eligibleLeads != null ? ` (${d.eligibleLeads} of ${d.candidatePool} fresh leads matched ${d.providerFilter === "google" ? "Google" : "non-gateway"} providers)` : "";
      const expectedWebhooks = d.webhookEventsPerCampaign ?? 3;
      const whBit = d.webhooksRegistered != null
        ? (d.webhooksRegistered >= expectedWebhooks ? ` Reply/bounce tracking wired (${d.webhooksRegistered} scoped webhooks).` : ` ⚠️ Only ${d.webhooksRegistered}/${expectedWebhooks} webhooks registered — check Instantly API permissions or results may not track.`)
        : "";
      const verb = d.mode === "appended" ? "Appended" : "Launched";
      setMessage(d.error ? d.error : `${verb} ${d.totalUploaded} leads into "${d.campaignName}" across ${d.combos} combos${inboxBit}${provBit}.${whBit}`);
      loadResults();
    } catch { setMessage("Launch failed."); } finally { setLaunching(false); }
  };

  const comboCount = subjectTemplates.length * amounts.length;

  return (
    <div className="space-y-6">
      {message && <div className="card p-4 border-l-4" style={{ borderLeftColor: "var(--accent)" }}><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p></div>}

      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>1. Pick a body (or edit your own)</h3>
        <div className="flex flex-wrap gap-2">
          {BODY_PRESETS.map((b) => (
            <button key={b.label} onClick={() => setBodyTemplate(b.template)} className="text-xs rounded-full px-3 py-1.5 border" style={{ borderColor: bodyTemplate === b.template ? "var(--accent)" : "var(--border)", background: bodyTemplate === b.template ? "var(--accent)" : "var(--surface)", color: bodyTemplate === b.template ? "#fff" : "var(--text-secondary)" }}>{b.label}</button>
          ))}
        </div>
        <textarea value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} rows={4} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Use {"{{amount}}"}, {"{{firstName}}"}, {"{{companyName}}"}. Keep it 2-3 lines.</p>
      </div>

      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>2. Subject styles to A/B (pick up to 4)</h3>
        {(["credentialed", "confident", "clean"] as const).map((cat) => (
          <div key={cat}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: cat === "credentialed" ? "#2563eb" : cat === "confident" ? "#b45309" : "#16a34a" }}>
              {cat === "credentialed" ? "Credentialed — lead with credibility" : cat === "confident" ? "Confident — money as conviction" : "Clean — no money in subject (deliverability-safe)"}
            </p>
            <div className="space-y-1.5">
              {SUBJECT_PRESETS.filter((s) => s.category === cat).map((s) => (
                <label key={s.label} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>
                  <input type="checkbox" checked={subjectTemplates.includes(s.template)} onChange={() => toggleSubject(s.template)} />
                  <span style={{ color: "var(--text-primary)" }}>{s.template.replace("{{amount}}", "X").replace("{{firstName}}", "Maya").replace("{{companyName}}", "Olipop")}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>3. Amounts to A/B (pick up to 5)</h3>
        <div className="flex flex-wrap gap-2">
          {ALLOWED_AMOUNTS.map((a) => (
            <button key={a} onClick={() => toggleAmount(a)} className="rounded-lg px-3 py-1.5 text-sm font-medium border" style={{ borderColor: amounts.includes(a) ? "var(--accent)" : "var(--border)", background: amounts.includes(a) ? "var(--accent)" : "var(--surface)", color: amounts.includes(a) ? "#fff" : "var(--text-secondary)" }}>${a}</button>
          ))}
        </div>
        <button onClick={saveConfig} disabled={saving} className="btn-secondary">{saving ? "Saving…" : "Save template"}</button>
      </div>

      <div className="card p-6">
        <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Preview — {comboCount} combos (sample: Maya at Olipop)</h3>
        <div className="space-y-4 mt-3">
          {subjectTemplates.map((st) => (
            <div key={st} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              {amounts.map((a) => <p key={a} className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Subject: {render(st, a)}</p>)}
              <p className="text-xs font-medium mt-2" style={{ color: "var(--text-tertiary)" }}>Step 1 (day 0)</p>
              <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{render(bodyTemplate, amounts[0] ?? 100)}</p>
              {FOLLOWUPS.map((f, i) => (
                <div key={i} className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>Step {i + 2} (+{f.delayDays} days, in-thread reply)</p>
                  <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{render(f.body, amounts[0] ?? 100)}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>4. Send it</h3>
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Fresh unsent leads only, appended into one rolling Instantly campaign (each lead gets one combo). <Link href="/dashboard/apollo" className="underline" style={{ color: "var(--accent)" }}>Pull more leads</Link>.</p>
        <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={freshCampaign} onChange={(e) => setFreshCampaign(e.target.checked)} />
          <span>Start a fresh campaign instead of appending to the existing one</span>
        </label>
        <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#16a34a" }}>Deliverability</p>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Recipient provider</label>
            <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as "google" | "no-gateways" | "all")} className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
              <option value="google">Google inboxes only (recommended)</option>
              <option value="no-gateways">Skip strict gateways (no MS / Proofpoint / Mimecast / Barracuda)</option>
              <option value="all">All providers</option>
            </select>
            {batchId && eligibility && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span><strong style={{ color: "var(--text-primary)" }}>{eligibility.total.toLocaleString()}</strong> fresh</span>
                <span style={{ color: providerFilter === "google" ? "#16a34a" : undefined }}>{eligibility.google.toLocaleString()} Google</span>
                <span style={{ color: providerFilter === "no-gateways" ? "#16a34a" : undefined }}>{eligibility.noGateways.toLocaleString()} non-gateway</span>
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={warmedInboxesOnly} onChange={(e) => setWarmedInboxesOnly(e.target.checked)} />
            <span>Send only from warmed inboxes</span>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Lead batch</label>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
              <option value="">Select batch</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name ?? b.id} ({b.leadCount})</option>)}
            </select></div>
          <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Max leads</label>
            <input type="number" min={1} max={2000} value={sendLimit} onChange={(e) => setSendLimit(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} /></div>
          <button onClick={launch} disabled={launching || !batchId} className="btn-primary">{launching ? "Launching…" : "Send with offer"}</button>
        </div>
      </div>

      <div className="card p-6 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>5. Offer autopilot</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Hands-off: pulls fresh leads when low and appends into the rolling campaign automatically, using the saved config above.</p>
          </div>
          <button onClick={toggleAutopilot} disabled={autopilotBusy} className="flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold border" style={{ borderColor: autopilotEnabled ? "#16a34a" : "var(--border)", background: autopilotEnabled ? "#16a34a" : "var(--surface)", color: autopilotEnabled ? "#fff" : "var(--text-secondary)" }}>
            {autopilotBusy ? "…" : autopilotEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Leads per run</label>
            <input type="number" min={1} max={1000} value={apPerRun} onChange={(e) => setApPerRun(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} /></div>
          <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Every (minutes)</label>
            <input type="number" min={1} max={1440} value={apIntervalMin} onChange={(e) => setApIntervalMin(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} /></div>
          <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Daily cap</label>
            <input type="number" min={1} max={13500} value={apDailyCap} onChange={(e) => setApDailyCap(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} /></div>
          <button onClick={saveAutopilotSettings} disabled={autopilotBusy} className="btn-secondary">Save pace</button>
          <button onClick={runAutopilotNow} disabled={autopilotBusy} className="btn-secondary">{autopilotBusy ? "Running…" : "Run once now"}</button>
        </div>
        {recentRuns.length > 0 && (
          <div className="rounded-lg border p-3 mt-1" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>Last run · {new Date(recentRuns[0].at).toLocaleString()}</p>
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>Pulled <strong>{recentRuns[0].ingested}</strong> new leads · appended <strong>{recentRuns[0].appended}</strong>{recentRuns[0].error ? <span style={{ color: "#b45309" }}> · {recentRuns[0].error}</span> : null}</p>
          </div>
        )}
      </div>

      <ProviderBreakdown />

      {(amtResults.length > 0 || styleResults.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6">
          {amtResults.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-6 py-3 border-b" style={{ borderColor: "var(--border)" }}><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>By amount</h3></div>
              <table className="w-full text-sm"><thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>{["Amount", "Sent", "Replies", "Reply %"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs" style={{ color: "var(--text-tertiary)" }}>{h}</th>)}</tr></thead>
                <tbody>{amtResults.map((r) => <tr key={r.amount} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}><td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>${r.amount}</td><td className="px-4 py-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>{r.sent}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.realReplies > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.realReplies}{r.positive > 0 ? ` (+${r.positive})` : ""}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.replyRatePct > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.replyRatePct}%</td></tr>)}</tbody></table>
            </div>
          )}
          {styleResults.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-6 py-3 border-b" style={{ borderColor: "var(--border)" }}><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>By subject style</h3></div>
              <table className="w-full text-sm"><thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>{["Style", "Sent", "Replies", "Reply %"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs" style={{ color: "var(--text-tertiary)" }}>{h}</th>)}</tr></thead>
                <tbody>{styleResults.map((r) => <tr key={r.style} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}><td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>{r.style}</td><td className="px-4 py-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>{r.sent}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.realReplies > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.realReplies}{r.positive > 0 ? ` (+${r.positive})` : ""}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.replyRatePct > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.replyRatePct}%</td></tr>)}</tbody></table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
