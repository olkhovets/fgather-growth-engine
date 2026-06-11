"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import DashboardSidebar from "@/components/DashboardSidebar";
import WebhookStatus from "@/components/WebhookStatus";

const STEPS = [
  {
    n: 1,
    title: "Tell it about you",
    body: "In Settings, add your website, what you sell, and who you sell to. The 'Auto-fill from website' button reads your site and drafts your product summary and ICP for you. Add your Anthropic and Instantly API keys here too.",
    link: { href: "/onboarding", label: "Go to Settings" },
  },
  {
    n: 2,
    title: "Bring in leads",
    body: "Pull leads automatically from Apollo (Lead source), or upload a CSV / Google Sheet inside a campaign. The right people are B2C marketing leaders at consumer brands.",
    link: { href: "/dashboard/apollo", label: "Lead source" },
  },
  {
    n: 3,
    title: "Let the AI write the emails",
    body: "This is the AI's job, not yours. Give it campaign context once, and it writes a personalized multi-step sequence for every lead — opening on their world, weaving in real proof (Datadog, Einstein Bros), and offering a gift card for their time. You can preview samples before anything sends.",
    link: { href: "/dashboard/launch", label: "Generate & send" },
  },
  {
    n: 4,
    title: "Send through Instantly",
    body: "Emails go out across your sending domains on a schedule. Always send yourself a test first. Step one never contains a link — the goal is a reply, not a click.",
  },
  {
    n: 5,
    title: "Results come back automatically",
    body: "Once a day the engine pulls open/reply stats from Instantly, and the reply webhook classifies every reply (positive, objection, out-of-office) in real time. Positive replies are the only score that matters here.",
  },
  {
    n: 6,
    title: "It gets better on its own",
    body: "The engine constantly A/B tests subject lines, hooks, CTAs and incentives. Whatever earns the most positive replies gets promoted into permanent 'learnings' that every future email is written from. See it on the Experiments page.",
    link: { href: "/dashboard/experiments", label: "Experiments" },
  },
];

export default function HelpPage() {
  const router = useRouter();
  const { ready, loading, session } = useAuthGuard();

  if (loading || !ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading…</p>
      </div>
    );
  }
  if (!session) { router.push("/login"); return null; }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <DashboardSidebar active="help" userEmail={session.user?.email} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>How this works</h1>
          <p className="text-sm mt-1 mb-8" style={{ color: "var(--text-secondary)" }}>
            Find the right people, let AI write emails they actually care about, send through Instantly, learn from the replies, repeat. Here&apos;s the whole loop.
          </p>

          <ol className="space-y-4">
            {STEPS.map((s) => (
              <li key={s.n} className="card p-5 flex gap-4">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: "var(--accent)" }}>{s.n}</span>
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{s.title}</h2>
                  <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{s.body}</p>
                  {s.link && (
                    <Link href={s.link.href} className="mt-2 inline-block text-xs font-medium" style={{ color: "var(--accent)" }}>{s.link.label} →</Link>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8">
            <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Turn on reply tracking</h2>
            <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
              The whole learning loop runs on positive replies, and replies only get counted once you paste this webhook into Instantly.
            </p>
            <WebhookStatus />
          </div>

          <div className="mt-8 card p-5 border-l-4" style={{ borderLeftColor: "var(--accent)" }}>
            <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>The rules that keep emails landing</h2>
            <ul className="space-y-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
              <li>• No links in the first email, ever. Reply-first. Calendar link only after they reply.</li>
              <li>• Sound like a sharp human wrote it in five minutes. No corporate voice, no buzzwords, no em dashes.</li>
              <li>• Be generous with incentives — a gift card for their time works, and the engine rotates which one to find what lands.</li>
              <li>• Lead with their world and the outcome, not our feature list.</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
