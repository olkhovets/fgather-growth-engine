"use client";

import { useAuthGuard } from "@/hooks/useAuthGuard";
import DashboardSidebar from "@/components/DashboardSidebar";
import DomainHealth from "@/components/DomainHealth";
import ProviderBreakdown from "@/components/ProviderBreakdown";

export default function DeliverabilityPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();

  if (guardLoading || !ready || !session) return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}><p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p></div>;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="deliverability" userEmail={session.user?.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8 space-y-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Deliverability</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>The most likely reason 14k sends produced few replies: mail not reaching inboxes. Two views — your sending domains&apos; health, and which recipient providers you&apos;re hitting.</p>
          </div>

          <DomainHealth />

          <div>
            <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Recipient provider mix</h2>
            <ProviderBreakdown />
          </div>
        </div>
      </main>
    </div>
  );
}
