"use client";
import DashboardSidebar from "@/components/DashboardSidebar";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

type Activity = {
  id: string;
  type: string;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

const TYPE_STYLE: Record<string, { label: string; color: string }> = {
  generate: { label: "Generate", color: "#6366f1" },
  send: { label: "Send", color: "#10b981" },
  ingest: { label: "Ingest", color: "#0ea5e9" },
  experiment: { label: "Experiment", color: "#f59e0b" },
  reply: { label: "Reply", color: "#ec4899" },
  autopilot: { label: "Autopilot", color: "#8b5cf6" },
  info: { label: "Info", color: "#6b7280" },
};

const FILTERS = ["all", "send", "ingest", "experiment", "reply", "autopilot"];

function Sidebar({ email, active }: { email?: string | null; active: string }) {
  return <DashboardSidebar active={active} userEmail={email} />;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.round((now - then) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function ActivityPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [notifyOnActivity, setNotifyOnActivity] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    const qs = filter === "all" ? "" : `?type=${filter}`;
    fetch(`/api/activity${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setActivity(d.activity ?? []); })
      .finally(() => setLoading(false));
  }, [session?.user?.id, filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/activity/notify")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.notifyOnActivity === "boolean") setNotifyOnActivity(d.notifyOnActivity);
        if (typeof d.notifyEmail === "string") setNotifyEmail(d.notifyEmail);
      })
      .catch(() => {});
  }, [session?.user?.id]);

  const toggleNotify = async () => {
    const next = !notifyOnActivity;
    setNotifyOnActivity(next);
    await fetch("/api/activity/notify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next, ...(notifyEmail ? { notifyEmail } : {}) }),
    }).catch(() => {});
  };

  if (!ready || guardLoading || !session) {
    return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
    </div>;
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar email={session.user?.email} active="activity" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Activity log</h1>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>Everything the engine has done — ingests, generations, sends, experiments, replies.</p>
            </div>
            <button onClick={load} className="btn-secondary">Refresh</button>
          </div>

          {/* Email-on-every-action toggle */}
          <div className="mb-5 card p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Email me on every action</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {notifyOnActivity
                  ? `On — sending to ${notifyEmail || "your account email"} for each event.`
                  : "Off — events are logged here but no emails are sent."}
              </p>
            </div>
            <button onClick={toggleNotify} className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors" style={{ background: notifyOnActivity ? "var(--accent)" : "var(--border)" }}>
              <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" style={{ transform: notifyOnActivity ? "translateX(24px)" : "translateX(4px)" }} />
            </button>
          </div>

          <div className="flex gap-1.5 mb-5 flex-wrap">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors"
                style={{ background: filter === f ? "var(--accent)" : "var(--surface)", color: filter === f ? "white" : "var(--text-secondary)", border: `1px solid var(--border)` }}>
                {f}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
          ) : activity.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No activity yet. Once the engine ingests, generates, or sends, it shows up here.</p>
            </div>
          ) : (
            <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
              {activity.map((a) => {
                const ts = TYPE_STYLE[a.type] ?? TYPE_STYLE.info;
                return (
                  <div key={a.id} className="px-5 py-3.5 flex items-start gap-3">
                    <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: `${ts.color}1a`, color: ts.color }}>
                      {ts.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm" style={{ color: "var(--text-primary)" }}>{a.message}</p>
                      {a.meta && Object.keys(a.meta).length > 0 && (
                        <p className="text-xs mt-0.5 tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                          {Object.entries(a.meta)
                            .filter(([, v]) => typeof v === "number" || typeof v === "string")
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-tertiary)" }}>{relativeTime(a.createdAt)}</span>
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
