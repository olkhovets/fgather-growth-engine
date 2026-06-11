"use client";
import DashboardSidebar from "@/components/DashboardSidebar";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import ProviderBreakdown from "@/components/ProviderBreakdown";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { APP_DISPLAY_NAME } from "@/lib/app-config";

type Campaign = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  leadBatch?: { id: string; name: string | null; _count: { leads: number } } | null;
  sentCampaigns: Array<{ id: string; name: string; createdAt: string }>;
};

type LegacySentCampaign = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  leadCount: number;
  isLegacy: true;
};

type Aggregate = {
  totalCampaigns: number;
  launchedCampaigns: number;
  totalSentCampaigns: number;
  totalLeads: number;
  totalReplies: number;
} | null;

type CampaignAnalytics = {
  id: string;
  name: string;
  instantlyCampaignId: string;
  createdAt: string;
  variant: string | null;
  metrics: {
    sent: number;
    opened: number;
    open_rate_pct: number;
    clicked: number;
    click_rate_pct: number;
    replies: number;
    reply_rate_pct: number;
    bounced: number;
    bounce_rate_pct: number;
    unsubscribed: number;
    positive_replies: number;
  };
};

function StatusBadge({ status }: { status: string }) {
  if (status === "launched") return (
    <span className="badge-launched">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
      Active
    </span>
  );
  if (status === "sequences_ready") return (
    <span className="badge-ready">
      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 inline-block" />
      Ready
    </span>
  );
  return (
    <span className="badge-draft">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" />
      Draft
    </span>
  );
}

export default function DashboardPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const router = useRouter();
  const [workspace, setWorkspace] = useState<{ domain?: string; hasAnthropicKey?: boolean; hasInstantlyKey?: boolean } | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [legacySentCampaigns, setLegacySentCampaigns] = useState<LegacySentCampaign[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [strategySuggestion, setStrategySuggestion] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<CampaignAnalytics[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [autopilotActivity, setAutopilotActivity] = useState<{ runs: number; runsWithWork: number; generated: number; sent: number; lastRunAt: string | null; bounceRate?: number; bouncedRecent?: number; sentRecent?: number; sentToday?: number; throttled?: boolean; replyStats?: { sentTotal: number; totalReplies: number; replyRatePct: number; ooo: number; oooRatePct: number; positive: number; positiveRatePct: number; objection: number; notInterested: number; other: number } } | null>(null);
  const [capacity, setCapacity] = useState<{ warmed: number; total: number; capacityPerDay: number } | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    Promise.all([
      fetch("/api/onboarding").then((r) => r.json()),
      fetch("/api/campaigns").then((r) => r.json()),
    ])
      .then(([onboardingData, campaignsData]) => {
        setWorkspace(onboardingData.workspace ?? null);
        setCampaigns(campaignsData.campaigns ?? []);
        setLegacySentCampaigns(campaignsData.legacySentCampaigns ?? []);
        setAggregate(campaignsData.aggregate ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/orchestrate/activity")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setAutopilotActivity(d); })
      .catch(() => {});
    fetch("/api/instantly/capacity")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setCapacity(d); })
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !workspace?.domain) return;
    fetch("/api/performance-memory/sync", { method: "POST" })
      .then(() => fetch("/api/performance-memory"))
      .then((r) => r.json())
      .then((data) => {
        if (data.suggestion && typeof data.suggestion === "string") {
          setStrategySuggestion(data.suggestion);
        }
      })
      .catch(() => {});
  }, [session?.user?.id, workspace?.domain]);

  useEffect(() => {
    if (!session?.user?.id || !workspace?.hasInstantlyKey) return;
    setAnalyticsLoading(true);
    fetch("/api/instantly/analytics")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.campaigns)) setAnalyticsData(data.campaigns);
      })
      .catch(() => {})
      .finally(() => setAnalyticsLoading(false));
  }, [session?.user?.id, workspace?.hasInstantlyKey]);

  const handleLaunchNew = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New campaign" }),
      });
      const data = await res.json();
      if (res.ok && data.campaign?.id) {
        router.push(`/dashboard/campaigns/${data.campaign.id}`);
        return;
      }
    } catch {
      // ignore
    }
    setCreating(false);
  };

  const handleDelete = async (campaignId: string) => {
    setDeletingId(campaignId);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      if (res.ok) {
        setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
        setAggregate((prev) => prev ? { ...prev, totalCampaigns: Math.max(0, prev.totalCampaigns - 1) } : prev);
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  if (guardLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      </div>
    );
  }

  if (!session) { router.push("/login"); return null; }
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
      </div>
    );
  }

  const hasOnboarding = Boolean(workspace?.domain);
  const allCampaigns = [
    ...campaigns.map(c => ({ ...c, isLegacy: false as const })),
    ...legacySentCampaigns,
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const launchedCount = campaigns.filter(c => c.status === "launched").length + legacySentCampaigns.length;
  const draftCount = campaigns.filter(c => c.status !== "launched").length;

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Sidebar */}
      <DashboardSidebar active="dashboard" userEmail={session.user?.email} />

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Campaigns</h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {workspace?.domain ?? "Configure your workspace in Settings"}
              </p>
            </div>
            <button onClick={handleLaunchNew} disabled={creating} className="btn-primary">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {creating ? "Creating…" : "New Campaign"}
            </button>
          </div>

          {/* Two paths, same outcome — make the overlap with the sidebar explicit */}
          {hasOnboarding && (
            <div className="mb-6 rounded-xl border px-4 py-3 text-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-primary)' }}>Two ways to run a campaign, same result.</span>{" "}
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>New Campaign</span> walks you through it all in one place. Or use the sidebar step by step:{" "}
              <Link href="/dashboard/apollo" className="underline" style={{ color: 'var(--accent)' }}>Lead source</Link> to get leads, then{" "}
              <Link href="/dashboard/launch" className="underline" style={{ color: 'var(--accent)' }}>Generate &amp; send</Link> to write and ship them. New to this?{" "}
              <Link href="/dashboard/help" className="underline" style={{ color: 'var(--accent)' }}>How it works</Link>.
            </div>
          )}

          {/* Autopilot activity — last 24h, so the operator can confirm the cron is healthy at a glance */}
          {autopilotActivity && (
            <div className="mb-6 rounded-xl border px-4 py-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${autopilotActivity.runsWithWork > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Autopilot · last 24h</span>
                </div>
                <div className="flex items-center gap-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span><span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{autopilotActivity.runs}</span> runs</span>
                  <span><span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{autopilotActivity.generated.toLocaleString()}</span> generated</span>
                  <span><span className="font-semibold tabular-nums" style={{ color: '#16a34a' }}>{autopilotActivity.sent.toLocaleString()}</span> sent</span>
                  {typeof autopilotActivity.bounceRate === 'number' && (autopilotActivity.sentRecent ?? 0) >= 20 && (
                    <span style={{ color: autopilotActivity.bounceRate > 5 ? '#dc2626' : autopilotActivity.bounceRate > 2 ? '#b45309' : '#16a34a' }}>
                      {autopilotActivity.bounceRate}% bounce
                    </span>
                  )}
                  {autopilotActivity.lastRunAt && (
                    <span style={{ color: 'var(--text-tertiary)' }}>last {(() => { const s = Math.round((Date.now() - new Date(autopilotActivity.lastRunAt).getTime())/1000); return s<60?`${s}s`:s<3600?`${Math.round(s/60)}m`:`${Math.round(s/3600)}h`; })()} ago</span>
                  )}
                </div>
              </div>
              {capacity && (autopilotActivity.sentToday ?? 0) >= 0 && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Delivered today: <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{(autopilotActivity.sentToday ?? 0).toLocaleString()}</span> of ~{capacity.capacityPerDay.toLocaleString()}/day capacity
                    </span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{capacity.warmed} of {capacity.total} inboxes warmed</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, capacity.capacityPerDay > 0 ? ((autopilotActivity.sentToday ?? 0) / capacity.capacityPerDay) * 100 : 0)}%`, background: 'var(--accent)' }} />
                  </div>
                  {capacity.warmed < capacity.total && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      Your ceiling is warmed inboxes × ~30/day. Warm the other {capacity.total - capacity.warmed} in Instantly to raise it.
                    </p>
                  )}
                </div>
              )}
              {autopilotActivity.throttled && (
                <p className="text-xs mt-1.5 font-medium" style={{ color: '#dc2626' }}>
                  ⚠ Sending auto-paused — bounce rate {autopilotActivity.bounceRate}% is above 5%. Autopilot keeps generating but holds sends to protect your domains; it resumes automatically when bounces drop. Check inbox warmup in Instantly.
                </p>
              )}
              {autopilotActivity.runs === 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>No autopilot runs in the last 24h. If your cron is enabled, check its execution log; or use &ldquo;Run a batch now&rdquo; on Generate &amp; send.</p>
              )}
            </div>
          )}

          {/* Setup warning */}
          {hasOnboarding && workspace && (!workspace.hasAnthropicKey || !workspace.hasInstantlyKey) && (
            <div className="mb-6 rounded-xl border px-4 py-3 text-sm flex items-start gap-3" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)', color: 'var(--warning-text)' }}>
              <svg className="h-4 w-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                <strong>Complete setup</strong> — add your Anthropic and Instantly keys in{" "}
                <Link href="/onboarding" className="underline font-medium">Settings</Link> to unlock all features.
              </span>
            </div>
          )}

          {/* Stats */}
          {aggregate && (
            <div className="grid grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total Campaigns", value: aggregate.totalCampaigns },
                { label: "Active", value: launchedCount },
                { label: "Draft", value: draftCount },
                { label: "Total Leads", value: aggregate.totalLeads.toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="card p-5">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
                  <p className="text-2xl font-semibold mt-1.5 tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Reply metrics — what's coming back from everything we've sent */}
          {autopilotActivity?.replyStats && autopilotActivity.replyStats.sentTotal > 0 && (
            <div className="grid grid-cols-4 gap-4 mb-8">
              {[
                { label: "Reply rate", value: `${autopilotActivity.replyStats.replyRatePct}%`, sub: `${autopilotActivity.replyStats.totalReplies.toLocaleString()} of ${autopilotActivity.replyStats.sentTotal.toLocaleString()} sent`, color: 'var(--text-primary)' },
                { label: "Positive replies", value: `${autopilotActivity.replyStats.positive.toLocaleString()}`, sub: `${autopilotActivity.replyStats.positiveRatePct}% of sent`, color: '#16a34a' },
                { label: "Out of office", value: `${autopilotActivity.replyStats.oooRatePct}%`, sub: `${autopilotActivity.replyStats.ooo.toLocaleString()} OOO, auto-requeued`, color: '#b45309' },
                { label: "Objections / not interested", value: `${(autopilotActivity.replyStats.objection + autopilotActivity.replyStats.notInterested).toLocaleString()}`, sub: `${autopilotActivity.replyStats.objection} obj · ${autopilotActivity.replyStats.notInterested} no`, color: 'var(--text-secondary)' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="card p-5">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
                  <p className="text-2xl font-semibold mt-1.5 tabular-nums" style={{ color }}>{value}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Performance by inbox provider */}
          <ProviderBreakdown />

          {/* Strategy suggestion */}
          {strategySuggestion && (
            <div className="mb-6 card p-4 border-l-4" style={{ borderLeftColor: 'var(--accent)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>Strategy insight</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{strategySuggestion}</p>
            </div>
          )}

          {/* Live Instantly Analytics */}
          {(analyticsLoading || analyticsData.length > 0) && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Campaign performance</h2>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Live from Instantly · last 30 days</span>
              </div>
              <div className="card overflow-hidden">
                {analyticsLoading ? (
                  <div className="px-6 py-8 flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
                    Pulling live data from Instantly…
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                        {["Campaign", "Sent", "Opens", "Open %", "Replies", "Reply %", "Bounced", "+Reply"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.map((c) => (
                        <tr key={c.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-4 py-2.5 font-medium max-w-[200px] truncate" style={{ color: 'var(--text-primary)' }} title={c.name}>
                            {c.name}
                            {c.variant && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>{c.variant}</span>}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{c.metrics.sent.toLocaleString()}</td>
                          <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{c.metrics.opened.toLocaleString()}</td>
                          <td className="px-4 py-2.5 tabular-nums font-medium" style={{ color: c.metrics.open_rate_pct >= 20 ? '#16a34a' : c.metrics.open_rate_pct >= 10 ? 'var(--text-primary)' : '#dc2626' }}>
                            {c.metrics.open_rate_pct}%
                          </td>
                          <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{c.metrics.replies.toLocaleString()}</td>
                          <td className="px-4 py-2.5 tabular-nums font-medium" style={{ color: c.metrics.reply_rate_pct >= 3 ? '#16a34a' : 'var(--text-primary)' }}>
                            {c.metrics.reply_rate_pct}%
                          </td>
                          <td className="px-4 py-2.5 tabular-nums" style={{ color: c.metrics.bounce_rate_pct > 5 ? '#dc2626' : 'var(--text-tertiary)' }}>
                            {c.metrics.bounced > 0 ? `${c.metrics.bounced} (${c.metrics.bounce_rate_pct}%)` : '—'}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums font-medium" style={{ color: c.metrics.positive_replies > 0 ? '#16a34a' : 'var(--text-tertiary)' }}>
                            {c.metrics.positive_replies > 0 ? `+${c.metrics.positive_replies}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Get started */}
          {!hasOnboarding ? (
            <div className="card p-8 text-center">
              <div className="h-12 w-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--accent-subtle)' }}>
                <svg className="h-6 w-6" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Get started</h2>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Enter your company URL and API keys in Settings to launch your first campaign.</p>
              <Link href="/onboarding" className="btn-primary">Go to Settings →</Link>
            </div>
          ) : (
            /* Campaigns table */
            <div className="card overflow-hidden">
              <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>All campaigns</h2>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{allCampaigns.length} total</span>
              </div>

              {allCampaigns.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No campaigns yet. Click "New Campaign" to get started.</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      {["Campaign", "Status", "Leads", "Created", ""].map((h) => (
                        <th key={h} className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={`c-${c.id}`} className="border-b last:border-0 hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-6 py-3.5">
                          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                        </td>
                        <td className="px-6 py-3.5"><StatusBadge status={c.status} /></td>
                        <td className="px-6 py-3.5 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>{c.leadBatch?._count?.leads ?? 0}</td>
                        <td className="px-6 py-3.5 text-sm" style={{ color: 'var(--text-tertiary)' }}>{new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3 justify-end">
                            <Link href={`/dashboard/campaigns/${c.id}`} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                              {c.status === "launched" ? "View" : "Continue"} →
                            </Link>
                            {c.status !== "launched" && (
                              confirmDeleteId === c.id ? (
                                <span className="flex items-center gap-1.5 text-xs">
                                  <span style={{ color: 'var(--text-tertiary)' }}>Delete?</span>
                                  <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id} className="font-medium text-red-500 hover:text-red-600 disabled:opacity-50">
                                    {deletingId === c.id ? "…" : "Yes"}
                                  </button>
                                  <button onClick={() => setConfirmDeleteId(null)} style={{ color: 'var(--text-tertiary)' }} className="hover:text-gray-600">No</button>
                                </span>
                              ) : (
                                <button onClick={() => setConfirmDeleteId(c.id)} style={{ color: 'var(--text-tertiary)' }} className="hover:text-red-500 transition-colors" title="Delete">
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {legacySentCampaigns.map((s) => (
                      <tr key={`legacy-${s.id}`} className="border-b last:border-0 hover:bg-gray-50/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-6 py-3.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
                        <td className="px-6 py-3.5"><StatusBadge status="launched" /></td>
                        <td className="px-6 py-3.5 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>{s.leadCount}</td>
                        <td className="px-6 py-3.5 text-sm" style={{ color: 'var(--text-tertiary)' }}>{new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                        <td className="px-6 py-3.5 text-right">
                          <Link href={`/dashboard/sent/${s.id}`} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>View →</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
