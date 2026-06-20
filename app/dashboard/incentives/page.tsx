"use client";
import DashboardSidebar from "@/components/DashboardSidebar";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import OfferLab from "@/components/OfferLab";

/**
 * Legacy route. The offer (incentives) flow now lives inside Generate & send;
 * this page is kept reachable for old links and just renders the same component.
 */
export default function IncentivesPage() {
  const { ready, loading: guardLoading, session } = useAuthGuard();
  if (!ready || guardLoading || !session) {
    return <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}><p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p></div>;
  }
  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="launch" userEmail={session.user?.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Send with an offer</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>This now lives inside Generate &amp; send — A/B gift amount, subject style, and body in one rolling campaign.</p>
          </div>
          <OfferLab />
        </div>
      </main>
    </div>
  );
}
