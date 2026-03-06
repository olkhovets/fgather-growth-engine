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

  // Sync analytics from Instantly and fetch strategy suggestion (runs in background when workspace is ready)
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
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  if (!session) {
    router.push("/login");
    return null;
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  const hasOnboarding = Boolean(workspace?.domain);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800/80 bg-zinc-950/95 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-lg font-semibold text-zinc-100 tracking-tight">
            {APP_DISPLAY_NAME}
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="font-medium text-zinc-200">
              Dashboard
            </Link>
            <Link href="/dashboard/features" className="text-zinc-500 hover:text-zinc-200">
              Feature Request
            </Link>
            <Link href="/onboarding" className="text-zinc-500 hover:text-zinc-200">
              Settings
            </Link>
            <span className="text-zinc-500">{session.user?.email}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-zinc-500 hover:text-zinc-200"
            >
              Log out
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <h1 className="text-2xl font-semibold text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Welcome, {session.user?.name || session.user?.email}
          </p>

          {hasOnboarding && workspace && (!workspace.hasAnthropicKey || !workspace.hasInstantlyKey) && (
            <div className="mt-6 rounded-lg border border-amber-800/60 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
              <strong>Complete setup to unlock everything.</strong> Add your Anthropic key to crawl your site and generate playbooks; add your Instantly key to send campaigns. You can add them anytime in{" "}
              <Link href="/onboarding" className="font-medium text-amber-100 underline hover:no-underline">
                Settings
              </Link>
              .
            </div>
          )}

          {!hasOnboarding ? (
            <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-medium text-zinc-200">Get started</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Enter your company URL (and optionally API keys) in Settings, then come back to launch your first campaign.
              </p>
              <Link
                href="/onboarding"
                className="mt-4 inline-flex rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Go to Settings →
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  onClick={handleLaunchNew}
                  disabled={creating}
                  className="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? "Creating…" : "Launch new campaign"}
                </button>
              </div>

              {strategySuggestion && (
                <div className="mt-8 rounded-xl border border-amber-800/50 bg-amber-950/20 p-5">
                  <h2 className="text-sm font-medium text-amber-200 mb-2">Strategy update (from your data)</h2>
                  <p className="text-sm text-amber-100/90">{strategySuggestion}</p>
                  <p className="mt-2 text-xs text-amber-200/60">
                    These learnings are applied when you generate new sequences. Run &quot;Classify&quot; on leads so we can tailor by persona/vertical.
                  </p>
                </div>
              )}

              {aggregate && (aggregate.totalCampaigns > 0 || aggregate.totalLeads > 0 || aggregate.totalReplies > 0) && (
                <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Campaigns</p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">{aggregate.totalCampaigns}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Launched</p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">{aggregate.launchedCampaigns}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Total leads</p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">{aggregate.totalLeads}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Replies</p>
                    <p className="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">{aggregate.totalReplies}</p>
                  </div>
                </div>
              )}

              <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                <h2 className="px-6 py-4 text-lg font-medium text-zinc-200 border-b border-zinc-800">
                  All campaigns
                </h2>
                {campaigns.length === 0 && legacySentCampaigns.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-zinc-500">
                    No campaigns yet. Click &quot;Launch new campaign&quot; to create one and set up playbook → sequences → send.
                  </p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wider">
                        <th className="px-6 py-3 font-medium">Name</th>
                        <th className="px-6 py-3 font-medium">Status</th>
                        <th className="px-6 py-3 font-medium">Leads</th>
                        <th className="px-6 py-3 font-medium">Created</th>
                        <th className="px-6 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {campaigns.map((c) => (
                        <tr key={`c-${c.id}`} className="text-sm">
                          <td className="px-6 py-4 text-zinc-200">{c.name}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              c.status === "launched" ? "bg-emerald-900/40 text-emerald-300" :
                              c.status === "sequences_ready" ? "bg-amber-900/40 text-amber-300" :
                              "bg-zinc-800 text-zinc-400"
                            }`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-zinc-400">
                            {c.leadBatch?._count?.leads ?? 0}
                          </td>
                          <td className="px-6 py-4 text-zinc-500">
                            {new Date(c.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <Link
                                href={`/dashboard/campaigns/${c.id}`}
                                className="text-emerald-500 hover:text-emerald-400 font-medium"
                              >
                                {c.status === "launched" ? "View" : "Continue"} →
                              </Link>
                              {c.status !== "launched" && (
                                confirmDeleteId === c.id ? (
                                  <span className="flex items-center gap-2 text-xs">
                                    <span className="text-zinc-400">Delete?</span>
                                    <button
                                      onClick={() => handleDelete(c.id)}
                                      disabled={deletingId === c.id}
                                      className="text-red-400 hover:text-red-300 font-medium disabled:opacity-50"
                                    >
                                      {deletingId === c.id ? "Deleting…" : "Yes"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="text-zinc-500 hover:text-zinc-300"
                                    >
                                      No
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteId(c.id)}
                                    className="text-zinc-600 hover:text-red-400 transition-colors"
                                    title="Delete campaign"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                        <tr key={`legacy-${s.id}`} className="text-sm">
                          <td className="px-6 py-4 text-zinc-200">{s.name}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-900/40 text-emerald-300">
                              launched
                            </span>
                          </td>
                          <td className="px-6 py-4 text-zinc-400">{s.leadCount}</td>
                          <td className="px-6 py-4 text-zinc-500">
                            {new Date(s.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <Link
                              href={`/dashboard/sent/${s.id}`}
                              className="text-emerald-500 hover:text-emerald-400 font-medium"
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-zinc-800 px-6 py-3">
        <div className="mx-auto max-w-5xl text-center">
          <a href="https://gatherhq.com" target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-500 hover:text-zinc-400">
            Visit gatherhq.com
          </a>
        </div>
      </footer>
    </div>
  );
}
