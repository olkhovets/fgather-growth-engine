"use client";
import DashboardSidebar from "@/components/DashboardSidebar";

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
  readyToSend: number;
  samples: Sample[];
};

function Sidebar({ email, active }: { email?: string | null; active: string }) {
  return <DashboardSidebar active={active} userEmail={email} />;
}

function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function LaunchPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [batches, setBatches] = useState<BatchStatus[]>([]);
  const [autopilot, setAutopilot] = useState(false);
  const [autopilotLimit, setAutopilotLimit] = useState("200");
  const [savingLimit, setSavingLimit] = useState(false);
  const [lastRun, setLastRun] = useState<{ at: string; generated: number; sent: number } | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [inboxLimit, setInboxLimit] = useState("30");
  const [sentToday, setSentToday] = useState(0);
  const [capacity, setCapacity] = useState<{ total: number; warmed: number; unwarmed: number; perInbox: number; capacityPerDay: number } | null>(null);
  const [playbookApproved, setPlaybookApproved] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyBatch, setBusyBatch] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { generated: number; total: number }>>({});
  const [sendLimits, setSendLimits] = useState<Record<string, string>>({});
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState<string | null>(null);
  const [approvingPlaybook, setApprovingPlaybook] = useState(false);
  const [hasPlaybook, setHasPlaybook] = useState(true);
  const [hasProductContext, setHasProductContext] = useState(true);
  const [settingUpPlaybook, setSettingUpPlaybook] = useState(false);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [instantlyCampaigns, setInstantlyCampaigns] = useState<Array<{ instantlyCampaignId: string; name: string }>>([]);
  const [selectedInstantlyId, setSelectedInstantlyId] = useState<string>("");
  const [genCounts, setGenCounts] = useState<Record<string, string>>({});
  const [customInstructions, setCustomInstructions] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  // Guidelines preview/edit (so they can actually be reviewed before approval)
  const [pbText, setPbText] = useState("");
  const [pbMeta, setPbMeta] = useState<{ numSteps?: number; stepDelays?: number[] }>({});
  const [pbExists, setPbExists] = useState(false);
  const [pbSaving, setPbSaving] = useState(false);

  // Flatten a playbook's guidelines into editable text (context, or tone + structure).
  const guidelinesToText = (g: { context?: string; tone?: string; structure?: string }) =>
    g?.context?.trim()
      ? g.context
      : [g?.tone ? `Tone: ${g.tone}` : "", g?.structure ?? ""].filter(Boolean).join("\n\n");

  const loadPlaybook = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/playbook")
      .then((r) => r.json())
      .then((d) => {
        const g = d?.playbook?.guidelines;
        if (g) {
          setPbExists(true);
          setPbText(guidelinesToText(g));
          setPbMeta({ numSteps: g.numSteps, stepDelays: Array.isArray(g.stepDelays) ? g.stepDelays : undefined });
        }
      })
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => { loadPlaybook(); }, [loadPlaybook]);

  const savePlaybookText = async () => {
    setPbSaving(true);
    try {
      const playbook = { guidelines: { context: pbText.trim(), numSteps: pbMeta.numSteps ?? 5, stepDelays: pbMeta.stepDelays ?? [1, 3, 5, 7, 10] } };
      const res = await fetch("/api/playbook", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playbook }),
      });
      const d = await res.json();
      setMessage(d.error ? d.error : "Guidelines saved.");
    } catch {
      setMessage("Could not save guidelines.");
    } finally {
      setPbSaving(false);
    }
  };

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    fetch("/api/orchestrate/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setMessage(d.error); return; }
        setBatches(d.batches ?? []);
        setAutopilot(Boolean(d.autopilot));
        if (d.autopilotDailyLimit) setAutopilotLimit(String(d.autopilotDailyLimit));
        if (d.inboxDailyLimit) setInboxLimit(String(d.inboxDailyLimit));
        setSentToday(d.sentToday ?? 0);
        setLastRun(d.lastAutopilotRun ?? null);
        setPlaybookApproved(d.playbookApproved !== false);
        setHasPlaybook(d.hasPlaybook !== false);
        setHasProductContext(d.hasProductContext !== false);
        const camps = d.campaigns ?? [];
        setCampaigns(camps);
        // Default to the most recent existing campaign so new leads run under its guidelines
        setSelectedCampaignId((prev) => prev || (camps[0]?.id ?? ""));
        const instCamps = d.instantlyCampaigns ?? [];
        setInstantlyCampaigns(instCamps);
        // Default to appending into the most recent live Instantly campaign
        setSelectedInstantlyId((prev) => prev || (instCamps[0]?.instantlyCampaignId ?? ""));
      })
      .finally(() => setLoading(false));
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/instantly/capacity")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setCapacity(d); })
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/orchestrate/instructions")
      .then((r) => r.json())
      .then((d) => { if (typeof d.customInstructions === "string") setCustomInstructions(d.customInstructions); })
      .catch(() => {});
  }, [session?.user?.id]);

  const saveInstructions = async () => {
    setSavingInstructions(true);
    try {
      const res = await fetch("/api/orchestrate/instructions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customInstructions }),
      });
      const d = await res.json();
      setMessage(d.error ? d.error : "Saved — applied to all future generation.");
    } catch {
      setMessage("Could not save instructions.");
    } finally {
      setSavingInstructions(false);
    }
  };

  // Generate workspace guidelines from product + ICP and save them, in one click.
  const setupPlaybook = async () => {
    setSettingUpPlaybook(true);
    setMessage(null);
    try {
      // 1. Generate a default playbook from product summary + ICP (or template fallback)
      const genRes = await fetch("/api/playbook/default", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const gen = await genRes.json();
      if (!genRes.ok || !gen.playbook) {
        setMessage(gen.error ?? "Could not generate guidelines. Add a product summary and ICP in Settings first.");
        return;
      }
      // 2. Save it to the workspace
      const saveRes = await fetch("/api/playbook", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playbook: gen.playbook }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok || saved.error) {
        setMessage(saved.error ?? "Could not save guidelines.");
        return;
      }
      setHasPlaybook(true);
      setPlaybookApproved(false);
      // Surface the generated guidelines immediately so they can be reviewed/edited.
      if (gen.playbook?.guidelines) {
        setPbExists(true);
        setPbText(guidelinesToText(gen.playbook.guidelines));
        setPbMeta({ numSteps: gen.playbook.guidelines.numSteps, stepDelays: gen.playbook.guidelines.stepDelays });
      }
      setMessage("Guidelines created. Review and edit them below, then approve to enable sending.");
    } catch {
      setMessage("Setup request failed.");
    } finally {
      setSettingUpPlaybook(false);
    }
  };

  const approvePlaybook = async () => {
    setApprovingPlaybook(true);
    setMessage(null);
    try {
      const res = await fetch("/api/playbook", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true }),
      });
      const d = await res.json();
      if (!res.ok || d.error) { setMessage(d.error ?? "Could not approve playbook. Make sure you've set one up in Settings."); }
      else { setPlaybookApproved(true); setMessage("Playbook approved — you can send now."); }
    } catch {
      setMessage("Approve request failed.");
    } finally {
      setApprovingPlaybook(false);
    }
  };

  const toggleAutopilot = async () => {
    const next = !autopilot;
    setAutopilot(next);
    await fetch("/api/orchestrate/autopilot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  };

  const saveDailyLimit = async () => {
    setSavingLimit(true);
    try {
      const dailyLimit = Math.min(20000, Math.max(1, parseInt(autopilotLimit) || 200));
      const inboxDailyLimit = Math.min(200, Math.max(1, parseInt(inboxLimit) || 30));
      const res = await fetch("/api/orchestrate/autopilot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLimit, inboxDailyLimit }),
      });
      const d = await res.json();
      if (d.autopilotDailyLimit) setAutopilotLimit(String(d.autopilotDailyLimit));
      if (d.inboxDailyLimit) setInboxLimit(String(d.inboxDailyLimit));
      setMessage(d.error ? d.error : `Saved: ${d.autopilotDailyLimit} leads/day, ${d.inboxDailyLimit}/inbox.`);
    } catch {
      setMessage("Could not save the daily limit.");
    } finally {
      setSavingLimit(false);
    }
  };

  const runAutopilotNow = async () => {
    setRunningNow(true);
    setMessage(null);
    try {
      const res = await fetch("/api/orchestrate/run", { method: "POST" });
      const d = await res.json();
      if (d.error) setMessage(d.error);
      else if (d.skipped) setMessage("Nothing to run — no leads need generating or sending. Pull or upload more leads first.");
      else {
        const diag = d.genDiag?.error ? ` Generation issue: ${d.genDiag.error}` : "";
        const sErr = d.sendError ? ` Send issue: ${d.sendError}` : "";
        setMessage(`Autopilot run: generated ${d.generated ?? 0}, sent ${d.sent ?? 0}.${diag}${sErr}`);
      }
      load();
    } catch {
      setMessage("Run failed.");
    } finally {
      setRunningNow(false);
    }
  };

  // Leads sitting in batches that autopilot still has to work through (not yet sent).
  const queuedLeads = batches.reduce((sum, b) => sum + Math.max(0, (b.needsGeneration ?? 0) + (b.readyToSend ?? 0)), 0);
  const dailyLimitNum = Math.min(20000, Math.max(1, parseInt(autopilotLimit) || 200));
  const daysToClear = queuedLeads > 0 ? Math.ceil(queuedLeads / dailyLimitNum) : 0;

  // Generate sequences for a batch in a capped batch size (a few hundred at a time).
  // Stops once `cap` leads have sequences generated, leaving the rest of the batch untouched.
  const generate = async (batchId: string) => {
    const capRaw = genCounts[batchId];
    const cap = capRaw ? Math.max(1, parseInt(capRaw, 10)) : 200; // default 200 at a time
    setBusyBatch(batchId);
    setMessage(null);
    let generatedThisRun = 0;
    try {
      while (generatedThisRun < cap) {
        const res = await fetch("/api/leads/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId, useFastModel: true, ...(selectedCampaignId ? { campaignId: selectedCampaignId } : {}) }),
        });
        const text = await res.text();
        let data: { error?: string; done?: number; total?: number } = {};
        try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(text?.slice(0, 200) || "Generate failed"); }
        if (!res.ok) throw new Error(data.error || "Generate failed");
        const done = data.done ?? 0;
        generatedThisRun += done;
        setProgress((p) => ({ ...p, [batchId]: { generated: generatedThisRun, total: cap } }));
        if (done === 0) break; // nothing left needing work
        await new Promise((r) => setTimeout(r, 300));
      }
      setMessage(`Generated ${generatedThisRun} sequence(s). Review the samples below, then approve to send.`);
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusyBatch(null);
    }
  };

  const approveAndSend = async (batchId: string) => {
    const appending = Boolean(selectedInstantlyId);
    const name = (campaignNames[batchId] ?? "").trim();
    // Campaign name only required when creating a NEW Instantly campaign
    if (!appending && !name) { setMessage("Give the campaign a name, or pick an existing Instantly campaign to add to."); return; }
    const limitRaw = sendLimits[batchId];
    const sendLimit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : undefined;
    setBusyBatch(batchId);
    setMessage(null);
    setConfirmSend(null);
    try {
      const res = await fetch("/api/instantly/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          skipFailingLeads: true, // only the freshly generated leads have sequences; skip the rest of the 10k
          ...(sendLimit ? { sendLimit } : {}),
          ...(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
          ...(appending ? { addToInstantlyCampaignId: selectedInstantlyId } : { campaignName: name }),
        }),
      });
      const d = await res.json();
      if (!res.ok || d.error) { setMessage(d.error ?? "Send failed."); }
      else { setMessage(d.message ?? `Sent — ${d.leads_uploaded ?? 0} leads to Instantly.`); }
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
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Generate &amp; send</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Generate sequences, review the output, then approve each send. Nothing goes out without your click.
            </p>
          </div>

          {/* Mode banner */}
          <div className="mb-6 card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {autopilot ? "Autopilot: ON" : "Manual approval (recommended)"}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {autopilot
                    ? "Runs once a day (~08:00 ET): generates fresh sequences and sends them into your latest campaign, up to the daily limit. You can still send manually below anytime."
                    : "Every batch waits for your review and approval before any email is sent."}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                <button onClick={runAutopilotNow} disabled={runningNow} className="btn-primary whitespace-nowrap">
                  {runningNow ? "Running…" : "Run a batch now"}
                </button>
                <button onClick={toggleAutopilot} title={autopilot ? "Turn autopilot off" : "Turn autopilot on"} className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors" style={{ background: autopilot ? "var(--accent)" : "var(--border)" }}>
                  <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" style={{ transform: autopilot ? "translateX(24px)" : "translateX(4px)" }} />
                </button>
              </div>
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
              &ldquo;Run a batch now&rdquo; kicks a cycle immediately (generates ~30, sends what&apos;s ready) — no need to wait for the daily run. Works whether autopilot is on or off.
            </p>

            {autopilot && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Leads per day</label>
                    <input
                      type="number" min={1} max={20000} value={autopilotLimit}
                      onChange={(e) => setAutopilotLimit(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-28 rounded-lg border px-3 py-2 text-sm"
                      style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Per inbox/day</label>
                    <input
                      type="number" min={1} max={200} value={inboxLimit}
                      onChange={(e) => setInboxLimit(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-24 rounded-lg border px-3 py-2 text-sm"
                      style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                    />
                  </div>
                  <button onClick={saveDailyLimit} disabled={savingLimit} className="btn-secondary">
                    {savingLimit ? "Saving…" : "Set pace"}
                  </button>
                </div>
                <div className="mt-3 text-xs space-y-1" style={{ color: "var(--text-tertiary)" }}>
                  <p>
                    <span style={{ color: "var(--text-secondary)" }}>Sent today:</span>{" "}
                    <span className="font-medium" style={{ color: "var(--text-primary)" }}>{sentToday.toLocaleString()}</span> leads pushed to Instantly.
                  </p>
                  {capacity && (
                    <p>
                      <span style={{ color: "var(--text-secondary)" }}>Real capacity:</span>{" "}
                      <span className="font-medium" style={{ color: capacity.warmed > 0 ? "#1A7A4A" : "#dc2626" }}>{capacity.warmed}</span> of {capacity.total} inboxes warmed → about <span className="font-medium" style={{ color: "var(--text-primary)" }}>{capacity.capacityPerDay.toLocaleString()}/day</span> Instantly will actually send.
                      {capacity.unwarmed > 0 && <span> {capacity.unwarmed} still warming (~5/day each until ready).</span>}
                      {dailyLimitNum > capacity.capacityPerDay && <span style={{ color: "#b45309" }}> Your {dailyLimitNum.toLocaleString()}/day limit is above capacity — extra leads just queue.</span>}
                    </p>
                  )}
                  {parseInt(inboxLimit) > 50 && (
                    <p style={{ color: "#b45309" }}>
                      ⚠ {inboxLimit}/inbox is aggressive — only safe on inboxes aged several months. New/recently-warmed inboxes will land in spam at this rate.
                    </p>
                  )}
                  <p>
                    <span style={{ color: "var(--text-secondary)" }}>Last run:</span>{" "}
                    {lastRun
                      ? <span style={{ color: "var(--text-primary)" }}>{relativeTime(lastRun.at)} — generated {lastRun.generated}, sent {lastRun.sent}</span>
                      : "no autopilot run yet (first run happens at the next daily cycle)"}
                  </p>
                  <p>
                    <span style={{ color: "var(--text-secondary)" }}>Pace:</span> up to <span className="font-medium" style={{ color: "var(--text-primary)" }}>{dailyLimitNum}</span> leads generated &amp; queued per day, in one daily run.
                  </p>
                  {queuedLeads > 0 ? (
                    <p>
                      <span style={{ color: "var(--text-secondary)" }}>Queue:</span> {queuedLeads.toLocaleString()} leads not yet sent → about <span className="font-medium" style={{ color: "var(--text-primary)" }}>{daysToClear} {daysToClear === 1 ? "day" : "days"}</span> to work through at this pace.
                    </p>
                  ) : (
                    <p>No leads queued right now — pull or upload more from <Link href="/dashboard/apollo" className="underline" style={{ color: "var(--accent)" }}>Lead source</Link> to keep autopilot fed.</p>
                  )}
                  <p>Actual send speed is also capped by Instantly (~30 emails per warmed inbox per day), so real throughput is the lower of this limit and your inbox capacity.</p>
                </div>
              </div>
            )}
          </div>

          {/* Custom instructions — quick free-text addendum applied to every email */}
          <div className="mb-6 card p-4">
            <button onClick={() => setInstructionsOpen((o) => !o)} className="w-full flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Extra instructions {customInstructions.trim() ? "(active)" : "(none)"}
              </span>
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{instructionsOpen ? "Hide" : "Edit"}</span>
            </button>
            {instructionsOpen && (
              <div className="mt-3 space-y-2">
                <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                  A line or two added to every email the engine writes from now on. Example: "Offer a $100 Uber Eats card for any booked demo."
                </p>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  rows={3}
                  placeholder="e.g. Offer a $100 Uber Eats card for booked demos."
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                />
                <button onClick={saveInstructions} disabled={savingInstructions} className="btn-primary">
                  {savingInstructions ? "Saving…" : "Save instructions"}
                </button>
              </div>
            )}
          </div>

          {/* Destination: append new leads into an existing live Instantly campaign */}
          {instantlyCampaigns.length > 0 && (
            <div className="mb-6 card p-4">
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>Add the sent leads to</label>
              <p className="text-xs mb-2.5" style={{ color: "var(--text-tertiary)" }}>
                Append this batch into a campaign that's already live in Instantly — same inbox, same sequence, no new campaign created. Choosing "new" creates a separate one.
              </p>
              <select
                value={selectedInstantlyId}
                onChange={(e) => setSelectedInstantlyId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                {instantlyCampaigns.map((ic) => (
                  <option key={ic.instantlyCampaignId} value={ic.instantlyCampaignId}>{ic.name} (add to this)</option>
                ))}
                <option value="">Create a new Instantly campaign</option>
              </select>
            </div>
          )}

          {/* Run new leads under an existing campaign's guidelines — no new setup needed */}
          {campaigns.length > 0 ? (
            <div className="mb-6 card p-4">
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>Run new leads under campaign</label>
              <p className="text-xs mb-2.5" style={{ color: "var(--text-tertiary)" }}>
                New leads are generated using this campaign's existing guidelines — same messaging, fed straight into the experiment loop.
              </p>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.status === "launched" ? " (active)" : ""}</option>
                ))}
              </select>
            </div>
          ) : !hasPlaybook ? (
            <div className="mb-6 rounded-xl border px-4 py-3 flex items-center justify-between gap-4" style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" }}>
              <span className="text-sm">
                No campaigns or guidelines yet. {hasProductContext
                  ? "Generate starter guidelines from your product & ICP."
                  : "Add a product summary and ICP in Settings first — then generate guidelines here."}
              </span>
              <button onClick={setupPlaybook} disabled={settingUpPlaybook || !hasProductContext} className="btn-primary whitespace-nowrap">
                {settingUpPlaybook ? "Generating…" : "Generate guidelines"}
              </button>
            </div>
          ) : !playbookApproved ? (
            <div className="mb-6 rounded-xl border px-4 py-3 flex items-center justify-between gap-4" style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" }}>
              <span className="text-sm">Your guidelines aren't approved yet — required before any send. Review them, then approve here.</span>
              <button onClick={approvePlaybook} disabled={approvingPlaybook} className="btn-primary whitespace-nowrap">
                {approvingPlaybook ? "Approving…" : "Approve guidelines"}
              </button>
            </div>
          ) : null}

          {pbExists && (
            <div className="mb-6 card p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Your guidelines {playbookApproved ? "" : "(review before approving)"}
                </h2>
                {!playbookApproved && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}>Not approved yet</span>
                )}
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--text-tertiary)" }}>
                This is what the AI follows when writing every email. Edit it freely, then save and approve.
              </p>
              <textarea
                value={pbText}
                onChange={(e) => setPbText(e.target.value)}
                rows={10}
                className="w-full rounded-lg border px-3 py-2.5 text-sm leading-relaxed font-mono resize-y"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
              {(pbMeta.numSteps || pbMeta.stepDelays?.length) && (
                <p className="mt-1.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
                  {pbMeta.numSteps ?? "?"}-step sequence{pbMeta.stepDelays?.length ? ` · days between: ${pbMeta.stepDelays.join(", ")}` : ""}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={savePlaybookText} disabled={pbSaving || !pbText.trim()} className="btn-secondary">
                  {pbSaving ? "Saving…" : "Save guidelines"}
                </button>
                {!playbookApproved && (
                  <button onClick={approvePlaybook} disabled={approvingPlaybook} className="btn-primary">
                    {approvingPlaybook ? "Approving…" : "Approve guidelines"}
                  </button>
                )}
              </div>
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
                const canSend = b.readyToSend > 0; // has generated-but-unsent, contactable leads
                const fullySent = b.contactable === 0 && b.sent > 0;
                return (
                  <div key={b.id} className="card overflow-hidden">
                    <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{b.name ?? "Untitled batch"}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                          {b.total} leads · {b.sent} sent · {b.readyToSend} generated &amp; ready · {b.needsGeneration} not yet generated
                        </p>
                      </div>
                      {fullySent && <span className="badge-launched"><span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />Sent</span>}
                    </div>

                    <div className="px-6 py-4 space-y-4">
                      {/* Generation — in capped batches */}
                      {b.needsGeneration > 0 ? (
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                            {b.withSequences} ready · {b.needsGeneration} still need sequences
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              value={genCounts[b.id] ?? "200"}
                              onChange={(e) => setGenCounts((p) => ({ ...p, [b.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                              className="w-24 rounded-lg border px-3 py-2 text-sm"
                              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                              title="How many to generate this round"
                            />
                            <button onClick={() => generate(b.id)} disabled={busyBatch === b.id} className="btn-secondary whitespace-nowrap">
                              {busyBatch === b.id
                                ? `Generating… ${progress[b.id]?.generated ?? 0}`
                                : "Generate this many"}
                            </button>
                          </div>
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

                      {/* Approve & send gate — sends the generated-but-unsent leads */}
                      {canSend && (
                        <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface-subtle)" }}>
                          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            Approve &amp; send {b.readyToSend} generated lead{b.readyToSend === 1 ? "" : "s"}
                            {selectedInstantlyId ? " → existing Instantly campaign" : ""}
                          </p>
                          <div className="flex gap-2">
                            {!selectedInstantlyId && (
                              <input
                                value={campaignNames[b.id] ?? ""}
                                onChange={(e) => setCampaignNames((p) => ({ ...p, [b.id]: e.target.value }))}
                                placeholder="New campaign name"
                                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                              />
                            )}
                            <input
                              value={sendLimits[b.id] ?? ""}
                              onChange={(e) => setSendLimits((p) => ({ ...p, [b.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                              placeholder={`Limit (max ${b.readyToSend})`}
                              className="w-36 rounded-lg border px-3 py-2 text-sm"
                              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                            />
                          </div>
                          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                            Leave the limit blank to send all {b.readyToSend} generated. Only generated, contactable leads go — the rest of the batch stays untouched.
                          </p>
                          {confirmSend === b.id ? (
                            <div className="flex items-center gap-2">
                              <button onClick={() => approveAndSend(b.id)} disabled={busyBatch === b.id || (!selectedCampaignId && !playbookApproved)} className="btn-primary">
                                {busyBatch === b.id ? "Sending…" : "Confirm — send now"}
                              </button>
                              <button onClick={() => setConfirmSend(null)} className="btn-secondary">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmSend(b.id)} disabled={!selectedCampaignId && !playbookApproved} className="btn-primary">
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
