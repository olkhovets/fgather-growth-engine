"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

type NavKey = "dashboard" | "apollo" | "launch" | "crosschannel" | "results" | "poach" | "experiments" | "incentives" | "deliverability" | "activity" | "features" | "help" | "settings";

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  apollo: <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  launch: <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />,
  crosschannel: <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />,
  results: <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  poach: <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />,
  experiments: <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />,
  incentives: <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  deliverability: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
  activity: <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />,
  features: <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />,
  help: <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  settings: <><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></>,
};

// The core workflow — a numbered, obvious left-to-right path. This IS the engine:
// who we target → what we send → what came back.
const PIPELINE: Array<{ key: NavKey; href: string; label: string; hint: string }> = [
  { key: "apollo", href: "/dashboard/apollo", label: "Leads", hint: "who we target" },
  { key: "launch", href: "/dashboard/launch", label: "Generate & send", hint: "write + send" },
  { key: "results", href: "/dashboard/results", label: "Results", hint: "what came back" },
];
// Secondary — sources + utility, demoted so the pipeline stays the obvious path.
const MORE: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "poach", href: "/dashboard/poach", label: "Competitors" },
  { key: "deliverability", href: "/dashboard/deliverability", label: "Deliverability" },
  { key: "activity", href: "/dashboard/activity", label: "Activity log" },
  { key: "help", href: "/dashboard/help", label: "How it works" },
];

/** Single source of truth for the dashboard sidebar — replaces 5 copy-pasted copies. */
export default function DashboardSidebar({ active, userEmail }: { active: NavKey | string; userEmail?: string | null }) {
  return (
    <aside className="w-60 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="px-5 py-5 border-b" style={{ borderColor: "var(--border)" }}>
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: "var(--accent)" }}>g</div>
          <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>gather</span>
        </Link>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto">
        <p className="px-3 pt-1 pb-2 text-[10px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-tertiary)" }}>PIPELINE</p>
        <div className="space-y-0.5 relative">
          {PIPELINE.map((l, i) => {
            const on = active === l.key;
            return (
              <Link key={l.key} href={l.href} className={`sidebar-link${on ? " active" : ""}`} style={{ alignItems: "center" }}>
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ background: on ? "var(--accent)" : "var(--surface-subtle)", color: on ? "#fff" : "var(--text-tertiary)" }}>{i + 1}</span>
                <span className="flex-1 leading-tight">
                  {l.label}
                  <span className="block text-[10px] font-normal" style={{ color: "var(--text-tertiary)" }}>{l.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
        <p className="px-3 pt-5 pb-2 text-[10px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-tertiary)" }}>MORE</p>
        <div className="space-y-0.5">
          {MORE.map((l) => (
            <Link key={l.key} href={l.href} className={`sidebar-link${active === l.key ? " active" : ""}`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                {ICONS[l.key]}
              </svg>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
        <Link href="/onboarding" className={`sidebar-link${active === "settings" ? " active" : ""}`}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>{ICONS.settings}</svg>
          Settings
        </Link>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2 mt-1">
          <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0" style={{ background: "var(--accent)" }}>
            {userEmail?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{userEmail}</p>
          </div>
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
