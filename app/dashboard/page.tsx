"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
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
      <aside className="w-60 flex-shrink-0 flex flex-col border-r" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: 'var(--accent)' }}>g</div>
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>gather</span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          <Link href="/dashboard" className="sidebar-link active">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Dashboard
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

        {/* User */}
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0" style={{ background: 'var(--accent)' }}>
              {session.user?.email?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{session.user?.email}</p>
            </div>
            <button onClick={() => signOut({ callbackUrl: "/" })} className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} title="Log out">
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

          {/* Strategy suggestion */}
          {strategySuggestion && (
            <div className="mb-6 card p-4 border-l-4" style={{ borderLeftColor: 'var(--accent)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>Strategy insight</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{strategySuggestion}</p>
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
