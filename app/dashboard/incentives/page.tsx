"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import DashboardSidebar from "@/components/DashboardSidebar";
import ProviderBreakdown from "@/components/ProviderBreakdown";

const ALLOWED_AMOUNTS = [50, 100, 150, 200, 250, 500];
const SUBJECT_PRESETS: Array<{ label: string; template: string; category: "bold" | "clean" }> = [
  { label: "direct-offer", template: "Get ${{amount}} to view a demo (seriously)", category: "bold" },
  { label: "we-pay-you", template: "We'll pay you ${{amount}} for 20 minutes", category: "bold" },
  { label: "no-catch", template: "${{amount}} for a 20-minute demo, no catch", category: "bold" },
  { label: "heres-money", template: "Here's ${{amount}} to watch a demo", category: "bold" },
  { label: "ill-send", template: "I'll send you ${{amount}} to see this", category: "bold" },
  { label: "gift-card", template: "${{amount}} gift card, 20 minutes, no pitch", category: "bold" },
  { label: "time-trade", template: "Trade you 20 minutes for ${{amount}}", category: "bold" },
  { label: "ready-when", template: "Your ${{amount}} is ready when you are", category: "bold" },
  { label: "on-us", template: "${{amount}} on us to check out Gather", category: "bold" },
  { label: "for-your-time", template: "${{amount}} for 20 minutes of your time", category: "bold" },
  { label: "worth-20", template: "Worth 20 minutes?", category: "clean" },
  { label: "quick-q", template: "Quick question about {{companyName}}'s research", category: "clean" },
  { label: "for-insights-team", template: "An offer for the {{companyName}} insights team", category: "clean" },
  { label: "first-name-20", template: "{{firstName}}, worth 20 minutes of your time?", category: "clean" },
  { label: "days-not-months", template: "Research answers in days, not months", category: "clean" },
  { label: "right-person", template: "For whoever owns research at {{companyName}}", category: "clean" },
  { label: "company-faster", template: "{{companyName}} + faster consumer answers", category: "clean" },
  { label: "genuinely-useful", template: "20 minutes for something genuinely useful", category: "clean" },
  { label: "made-offer", template: "{{firstName}}, made you an offer (inside)", category: "clean" },
  { label: "quick-one", template: "{{firstName}} quick one on consumer research", category: "clean" },
];
const BODY_PRESETS = [
  { label: "Blunt + confident", template: "We do AI consumer research that gets brands real audience answers in days, not months. I'm so sure it'll help {{companyName}} that I'll send you a ${{amount}} gift card just to watch a 20-minute demo.\nReply \"yes\" and it's yours." },
  { label: "We do X, you need it", template: "We run AI consumer research. {{companyName}} needs faster, realer audience answers, and I'll pay you ${{amount}} to prove it in 20 minutes.\nWorth a reply?" },
  { label: "Proof-point led", template: "Brands like Einstein Bros and Datadog use us to get consumer answers in days instead of months. I'll send {{firstName}} a ${{amount}} gift card to show you the same in 20 minutes.\nReply and it's yours." },
  { label: "Pure offer", template: "No pitch: I'll give you a ${{amount}} gift card to sit through a 20-minute Gather demo. We do AI consumer research that's fast enough to be worth your time.\nReply \"in\"?" },
  { label: "Confidence bet", template: "I'll bet you ${{amount}} that our AI research tool earns its spot at {{companyName}} in one 20-minute demo. Win or lose, the gift card is yours.\nReply to claim it." },
  { label: "Ultra-short", template: "${{amount}} gift card for 20 minutes on a Gather demo. We do AI consumer research, fast.\nReply \"yes\"?" },
  { label: "Personal + direct", template: "{{firstName}}, real offer: ${{amount}} to you for a 20-minute look at how Gather gets {{companyName}} consumer answers in days. No strings.\nReply and I'll send it over." },
  { label: "Question hook", template: "What's it worth to get real consumer answers in days instead of months? To us, ${{amount}} — that's what I'll send you for a 20-minute demo.\nGame?" },
  { label: "Reverse psychology", template: "Most research tools waste your time, so I'll put money on it: a ${{amount}} gift card if you give Gather 20 minutes and it isn't faster than your current setup.\nReply and I'll book it." },
  { label: "Stat-led", template: "Most consumer research takes six to eight weeks. We get {{companyName}} validated answers in days. I'll send you a ${{amount}} gift card to spend 20 minutes seeing how.\nWorth a reply?" },
  { label: "Peer / social proof", template: "The insights teams at brands like Einstein Bros stopped waiting weeks for answers. I'll give you a ${{amount}} gift card to see what they use, in 20 minutes.\nInterested?" },
  { label: "Casual text", template: "{{firstName}}, odd ask: can I send you a ${{amount}} gift card to show you something for 20 minutes? We do AI consumer research and it's genuinely fast.\nWorth a yes?" },
  { label: "Problem-first", template: "If validating a campaign with real consumers at {{companyName}} still takes weeks, that's exactly what we fix, in days. I'll send a ${{amount}} gift card for 20 minutes to prove it.\nReply \"show me\"." },
  { label: "Time-respect", template: "I know your inbox is brutal, so here's a real reason to reply: a ${{amount}} gift card for 20 minutes seeing how Gather gets {{companyName}} consumer answers in days.\nYes?" },
  { label: "Curiosity + offer", template: "There's a way to get consumer answers in days instead of months, and I'll send you a ${{amount}} gift card to let me show you in 20 minutes.\nReply and I'll explain." },
  { label: "No-BS short", template: "${{amount}} gift card for 20 minutes. We do fast AI consumer research. That's the whole pitch.\nReply if you're in." },
];

// Fixed 2-3 sentence follow-ups appended after the offer (mirrors lib/incentives.ts INCENTIVE_FOLLOWUPS).
const FOLLOWUPS: Array<{ body: string; delayDays: number }> = [
  { delayDays: 3, body: "Quick follow up. Brands like Einstein Bros and Datadog get real consumer answers from us in days, not months, and that ${{amount}} gift card is still yours for 20 minutes. Worth a reply?" },
  { delayDays: 3, body: "Last note from me. Most teams wait weeks on research we turn around in days, and I'll still send you ${{amount}} to see how in 20 minutes. Want me to set it up?" },
];

function render(tpl: string, amount: number) {
  return tpl.replace(/\{\{\s*amount\s*\}\}/g, String(amount)).replace(/\{\{\s*firstName\s*\}\}/g, "Maya").replace(/\{\{\s*companyName\s*\}\}/g, "Olipop");
}

type AmtRow = { amount: number; sent: number; realReplies: number; positive: number; replyRatePct: number };
type StyleRow = { style: string; sent: number; realReplies: number; positive: number; replyRatePct: number };

export default function IncentivesPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
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
      setMessage(d.error || (d.enabled ? "Incentives autopilot ON — it'll pull fresh leads when low and append them into the rolling campaign automatically." : "Incentives autopilot OFF."));
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
    setAutopilotBusy(true); setMessage("Running incentives autopilot…");
    try {
      const res = await fetch("/api/incentives/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run: true }) });
      const d = await res.json();
      const r = d.runResult ?? {};
      setMessage(d.error || r.error || `Autopilot run: pulled ${r.ingested ?? 0} new leads, appended ${r.appended ?? 0} into the rolling campaign.`);
      loadResults(); loadAutopilot();
    } catch { setMessage("Autopilot run failed."); } finally { setAutopilotBusy(false); }
  };

  // Volume preview: how many fresh leads survive each provider filter for the chosen batch.
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
        ? (d.webhooksRegistered >= expectedWebhooks
            ? ` Reply/bounce tracking wired (${d.webhooksRegistered} scoped webhooks).`
            : ` ⚠️ Only ${d.webhooksRegistered}/${expectedWebhooks} webhooks registered — check Instantly API permissions or results may not track.`)
        : "";
      const verb = d.mode === "appended" ? "Appended" : "Launched";
      setMessage(d.error ? d.error : `${verb} ${d.totalUploaded} leads into "${d.campaignName}" across ${d.combos} combos${inboxBit}${provBit}.${whBit}`);
      loadResults();
    } catch { setMessage("Launch failed."); } finally { setLaunching(false); }
  };

  if (guardLoading || !ready || !session) return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}><p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p></div>;

  const comboCount = subjectTemplates.length * amounts.length;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="incentives" userEmail={session.user?.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Incentives Lab</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>Blunt, money-forward emails sent as a 3-step sequence (the offer, then two short re-offers a few days apart). A/B both the dollar amount AND the subject style at once, each combo in its own Instantly campaign. No fluff, no links.</p>
          </div>

          {message && <div className="mb-6 card p-4 border-l-4" style={{ borderLeftColor: "var(--accent)" }}><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p></div>}

          {/* Body preset picker */}
          <div className="card p-6 space-y-4 mb-6">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>1. Pick a body (or edit your own)</h2>
            <div className="flex flex-wrap gap-2">
              {BODY_PRESETS.map((b) => (
                <button key={b.label} onClick={() => setBodyTemplate(b.template)} className="text-xs rounded-full px-3 py-1.5 border" style={{ borderColor: bodyTemplate === b.template ? "var(--accent)" : "var(--border)", background: bodyTemplate === b.template ? "var(--accent)" : "var(--surface)", color: bodyTemplate === b.template ? "#fff" : "var(--text-secondary)" }}>{b.label}</button>
              ))}
            </div>
            <textarea value={bodyTemplate} onChange={(e) => setBodyTemplate(e.target.value)} rows={4} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} />
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Use {"{{amount}}"}, {"{{firstName}}"}, {"{{companyName}}"}. Keep it 2-3 lines.</p>
          </div>

          {/* Subject styles to A/B */}
          <div className="card p-6 space-y-4 mb-6">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>2. Subject styles to A/B (pick up to 4)</h2>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Bold = money in the subject (max impact, higher spam risk on strict gateways). Clean = offer lives in the body (far safer for deliverability). A/B both to see which actually lands and converts.</p>
            {(["bold", "clean"] as const).map((cat) => (
              <div key={cat}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: cat === "bold" ? "#b45309" : "#16a34a" }}>
                  {cat === "bold" ? "Bold — money in subject" : "Clean — money in body (deliverability-safe)"}
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

          {/* Amounts */}
          <div className="card p-6 space-y-3 mb-6">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>3. Amounts to A/B (pick up to 5)</h2>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_AMOUNTS.map((a) => (
                <button key={a} onClick={() => toggleAmount(a)} className="rounded-lg px-3 py-1.5 text-sm font-medium border" style={{ borderColor: amounts.includes(a) ? "var(--accent)" : "var(--border)", background: amounts.includes(a) ? "var(--accent)" : "var(--surface)", color: amounts.includes(a) ? "#fff" : "var(--text-secondary)" }}>${a}</button>
              ))}
            </div>
            <button onClick={saveConfig} disabled={saving} className="btn-secondary">{saving ? "Saving…" : "Save template"}</button>
          </div>

          {/* Preview */}
          <div className="card p-6 mb-6">
            <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Preview — {comboCount} combos (sample: Maya at Olipop)</h2>
            <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>{subjectTemplates.length} styles × {amounts.length} amounts, all in one rolling campaign (each lead gets one combo).</p>
            <div className="space-y-4">
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

          {/* Launch */}
          <div className="card p-6 space-y-4 mb-6">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>4. Send it</h2>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Fresh unsent leads only, appended into one rolling Instantly campaign (each lead gets one combo). Pull more leads anytime and launch again to add them. <Link href="/dashboard/apollo" className="underline" style={{ color: "var(--accent)" }}>Pull more leads</Link>.</p>
            <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={freshCampaign} onChange={(e) => setFreshCampaign(e.target.checked)} />
              <span>Start a fresh campaign instead of appending to the existing one</span>
            </label>

            {/* Deliverability levers — the #1 reason cold incentive mail fails */}
            <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#16a34a" }}>Deliverability</p>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Recipient provider</label>
                <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as "google" | "no-gateways" | "all")} className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
                  <option value="google">Google inboxes only (recommended)</option>
                  <option value="no-gateways">Skip strict gateways (no MS / Proofpoint / Mimecast / Barracuda)</option>
                  <option value="all">All providers</option>
                </select>
                <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>~73% of your past sends hit strict gateways that quarantine cold mail. Google-only gives the offer a real chance to land and get a reply.</p>
                {batchId && eligibility && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span><strong style={{ color: "var(--text-primary)" }}>{eligibility.total.toLocaleString()}</strong> fresh</span>
                    <span style={{ color: providerFilter === "google" ? "#16a34a" : undefined, fontWeight: providerFilter === "google" ? 600 : 400 }}>{eligibility.google.toLocaleString()} Google</span>
                    <span style={{ color: providerFilter === "no-gateways" ? "#16a34a" : undefined, fontWeight: providerFilter === "no-gateways" ? 600 : 400 }}>{eligibility.noGateways.toLocaleString()} non-gateway</span>
                    {eligibility.unclassified > 0 && <span style={{ color: "var(--text-tertiary)" }}>{eligibility.unclassified.toLocaleString()} unclassified (checked at launch)</span>}
                    {providerFilter !== "all" && (() => {
                      const eligible = providerFilter === "google" ? eligibility.google : eligibility.noGateways;
                      if (eligible === 0 && eligibility.unclassified === 0) return <span style={{ color: "#b45309" }}>· no eligible leads — loosen the filter or pull Google leads in <Link href="/dashboard/apollo" className="underline">Lead source</Link></span>;
                      if (eligible < 100 && eligibility.unclassified < 100) return <span style={{ color: "#b45309" }}>· low volume — consider pulling more Google-provider leads</span>;
                      return null;
                    })()}
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
              <button onClick={launch} disabled={launching || !batchId} className="btn-primary">{launching ? "Launching…" : "Launch incentive test"}</button>
            </div>
          </div>

          {/* Autopilot */}
          <div className="card p-6 space-y-3 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>5. Autopilot</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Hands-off: pulls fresh leads from Apollo when the pool runs low and appends them into the rolling campaign automatically, using your saved config above (no-gateway providers, warmed inboxes). Runs on the same cron as the main engine.</p>
              </div>
              <button onClick={toggleAutopilot} disabled={autopilotBusy} className="flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold border" style={{ borderColor: autopilotEnabled ? "#16a34a" : "var(--border)", background: autopilotEnabled ? "#16a34a" : "var(--surface)", color: autopilotEnabled ? "#fff" : "var(--text-secondary)" }}>
                {autopilotBusy ? "…" : autopilotEnabled ? "ON" : "OFF"}
              </button>
            </div>

            {/* Pace controls */}
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Leads per run</label>
                <input type="number" min={1} max={1000} value={apPerRun} onChange={(e) => setApPerRun(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} /></div>
              <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Every (minutes)</label>
                <input type="number" min={1} max={1440} value={apIntervalMin} onChange={(e) => setApIntervalMin(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} /></div>
              <div><label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Daily cap</label>
                <input type="number" min={1} max={13500} value={apDailyCap} onChange={(e) => setApDailyCap(e.target.value.replace(/[^0-9]/g, ""))} className="w-24 rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }} /></div>
              <button onClick={saveAutopilotSettings} disabled={autopilotBusy} className="btn-secondary">Save pace</button>
            </div>

            {(() => {
              const perRun = parseInt(apPerRun) || 0, every = parseInt(apIntervalMin) || 0, cap = parseInt(apDailyCap) || 0;
              if (!perRun || !every || !cap) return null;
              const runsToCap = Math.ceil(cap / perRun);
              const hoursToCap = Math.round((runsToCap * every / 60) * 10) / 10;
              const perHour = Math.round(perRun * (60 / every));
              return <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Cadence: <strong style={{ color: "var(--text-primary)" }}>{perRun} leads every {every} min</strong> (≈{perHour}/hour), stopping at <strong style={{ color: "var(--text-primary)" }}>{cap}/day</strong> — it hits the daily cap in ~{runsToCap} runs ({hoursToCap}h), then resumes tomorrow. Sends only land Mon–Fri 9–5 CT regardless.</p>;
            })()}

            <button onClick={runAutopilotNow} disabled={autopilotBusy} className="btn-secondary">{autopilotBusy ? "Running…" : "Run autopilot once now"}</button>

            {/* Last run + recent autopilot activity */}
            {recentRuns.length > 0 && (() => {
              const last = recentRuns[0];
              const topStyles = [...last.distribution].sort((a, b) => b.leads - a.leads).slice(0, 4);
              return (
                <div className="rounded-lg border p-3 mt-1" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-tertiary)" }}>Last run · {new Date(last.at).toLocaleString()}</p>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                    Pulled <strong>{last.ingested}</strong> new leads · appended <strong>{last.appended}</strong>
                    {last.sentToday != null && last.dailyCap != null ? <span style={{ color: "var(--text-secondary)" }}> · {last.sentToday}/{last.dailyCap} today</span> : null}
                    {last.error ? <span style={{ color: "#b45309" }}> · {last.error}</span> : null}
                  </p>
                  {topStyles.length > 0 && (
                    <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>Styles sent: {topStyles.map((s) => `${s.style} $${s.amount} (${s.leads})`).join(" · ")}</p>
                  )}
                  {recentRuns.length > 1 && (
                    <div className="mt-2 pt-2 border-t space-y-0.5" style={{ borderColor: "var(--border)" }}>
                      {recentRuns.slice(1, 6).map((r, i) => (
                        <p key={i} className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                          {new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — pulled {r.ingested}, sent {r.appended}{r.error ? ` (${r.error.slice(0, 40)})` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <ProviderBreakdown />

          {/* Results */}
          {(amtResults.length > 0 || styleResults.length > 0) && (
            <div className="grid md:grid-cols-2 gap-6">
              {amtResults.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-6 py-3 border-b" style={{ borderColor: "var(--border)" }}><h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>By amount</h2></div>
                  <table className="w-full text-sm"><thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>{["Amount", "Sent", "Replies", "Reply %"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs" style={{ color: "var(--text-tertiary)" }}>{h}</th>)}</tr></thead>
                    <tbody>{amtResults.map((r) => <tr key={r.amount} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}><td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>${r.amount}</td><td className="px-4 py-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>{r.sent}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.realReplies > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.realReplies}{r.positive > 0 ? ` (+${r.positive})` : ""}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.replyRatePct > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.replyRatePct}%</td></tr>)}</tbody></table>
                </div>
              )}
              {styleResults.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-6 py-3 border-b" style={{ borderColor: "var(--border)" }}><h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>By subject style</h2></div>
                  <table className="w-full text-sm"><thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>{["Style", "Sent", "Replies", "Reply %"].map((h) => <th key={h} className="px-4 py-2 text-left text-xs" style={{ color: "var(--text-tertiary)" }}>{h}</th>)}</tr></thead>
                    <tbody>{styleResults.map((r) => <tr key={r.style} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}><td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>{r.style}</td><td className="px-4 py-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>{r.sent}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.realReplies > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.realReplies}{r.positive > 0 ? ` (+${r.positive})` : ""}</td><td className="px-4 py-2 tabular-nums" style={{ color: r.replyRatePct > 0 ? "#16a34a" : "var(--text-tertiary)" }}>{r.replyRatePct}%</td></tr>)}</tbody></table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
