"use client";
import { useState } from "react";

/**
 * Public free-value research microsite (channel #1) — the valuable, capturing
 * destination for LinkedIn ad clicks (which currently leak with no capture).
 * ICP-first (Ivan Falco / ColdIQ): lead with the buyer's real problem, give
 * something genuinely useful, capture the email. Submits to /api/microsite/capture.
 */
export default function ResearchMicrosite() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — hidden from real users
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending"); setErr("");
    try {
      const r = await fetch("/api/microsite/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, company, website }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Something went wrong."); setState("error"); return; }
      setState("done");
    } catch { setErr("Network error."); setState("error"); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #0b0f1a)", color: "var(--text-primary, #e8edf7)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ maxWidth: 620, width: "100%" }}>
        <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".15em", color: "var(--accent, #3b82f6)", marginBottom: 14 }}>Gather · free for B2C marketing leaders</p>
        <h1 style={{ fontSize: "clamp(30px,5vw,46px)", lineHeight: 1.05, fontWeight: 700, margin: 0 }}>
          We&apos;ll tear down what your real buyers actually think of your category — free.
        </h1>
        <p style={{ fontSize: 17, color: "var(--text-secondary, #93a0bd)", marginTop: 18, lineHeight: 1.5 }}>
          Most teams market on what they assume customers want. We run real AI-moderated consumer interviews and send you a short teardown of where your positioning is landing, where it isn&apos;t, and the one message your buyers are waiting to hear. No pitch, no six-week study — just the insight.
        </p>
        <ul style={{ fontSize: 15, color: "var(--text-secondary, #93a0bd)", marginTop: 16, lineHeight: 1.7, paddingLeft: 18 }}>
          <li>What your buyers say made them choose you — and what nearly made them walk.</li>
          <li>The gap between your messaging and what the category actually rewards.</li>
          <li>One concrete message to test next, grounded in real interviews.</li>
        </ul>

        {state === "done" ? (
          <div style={{ marginTop: 26, padding: 18, borderRadius: 12, background: "var(--surface, #141a2b)", border: "1px solid var(--border, #26304a)" }}>
            <p style={{ fontWeight: 600, margin: 0 }}>You&apos;re in. We&apos;ll send your teardown shortly.</p>
            <p style={{ fontSize: 14, color: "var(--text-secondary, #93a0bd)", marginTop: 6 }}>Check your inbox over the next day or two.</p>
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" autoComplete="email"
              style={{ padding: "13px 14px", borderRadius: 10, border: "1px solid var(--border, #26304a)", background: "var(--surface, #141a2b)", color: "inherit", fontSize: 15 }} />
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)"
              style={{ padding: "13px 14px", borderRadius: 10, border: "1px solid var(--border, #26304a)", background: "var(--surface, #141a2b)", color: "inherit", fontSize: 15 }} />
            {/* honeypot: visually hidden, off-screen */}
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
            <button type="submit" disabled={state === "sending"}
              style={{ padding: "13px 16px", borderRadius: 10, border: 0, background: "var(--accent, #3b82f6)", color: "#fff", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
              {state === "sending" ? "Sending…" : "Get my free teardown"}
            </button>
            {state === "error" && <p style={{ color: "#f87171", fontSize: 14, margin: 0 }}>{err}</p>}
            <p style={{ fontSize: 12, color: "var(--text-tertiary, #6b7280)", marginTop: 4 }}>Used by teams at consumer brands. No spam — just the teardown and a note if you want to go deeper.</p>
          </form>
        )}
      </div>
    </div>
  );
}
