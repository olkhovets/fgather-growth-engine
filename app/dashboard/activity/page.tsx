"use client";

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
        {link("/dashboard/activity", "Activity log", "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01", active === "activity")}
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

  const load = useCallback(() => {
    if (!session?.user?.id) return;
    const qs = filter === "all" ? "" : `?type=${filter}`;
    fetch(`/api/activity${qs}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setActivity(d.activity ?? []); })
      .finally(() => setLoading(false));
  }, [session?.user?.id, filter]);

  useEffect(() => { load(); }, [load]);

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
