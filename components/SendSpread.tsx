"use client";

import { useEffect, useState } from "react";

/**
 * "What's about to go out" — one digestible panel for the launch page. Answers the four things an
 * operator wants to SEE before sending, without digging through nested menus: which workspace/project
 * they're in, the spread of the ready pool (persona / style / gift), real previews with the matched
 * similar-brand proof each will use, and their leads classified by persona. Read-only.
 */

type Bucket = { key: string; count: number };
type Preview = {
  name: string | null;
  company: string | null;
  persona: string;
  style: string;
  gift: string | null;
  matchedBrand: string;
  matchedFamily: string;
  words: number;
  subject: string | null;
  body: string | null;
};
type Data = {
  workspace: { name: string; email: string | null; product: string | null };
  leads: { total: number; byPersona: Bucket[] };
  ready: { total: number; byPersona: Bucket[]; byStyle: Bucket[]; byGift: Bucket[] };
  activeStyles: string[];
  deliverability: { verdict: string; avgHealth: number | null; hasHealthData: boolean } | null;
  length: { maxSendableWords: number; longInSample: number; sampled: number };
  previews: Preview[];
};

const DELIV_COLOR: Record<string, string> = { healthy: "#1A7A4A", warning: "#b45309", unhealthy: "#dc2626", critical: "#dc2626" };

const PERSONA_LABEL: Record<string, string> = {
  "consumer-insights": "Consumer insights",
  "brand-social": "Brand / social",
  "growth-general": "Growth",
  "product-marketing": "Product marketing",
  unclassified: "Unclassified",
};
const prettyPersona = (k: string) => PERSONA_LABEL[k] ?? k;

function Bars({ buckets, total }: { buckets: Bucket[]; total: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="space-y-1.5">
      {buckets.slice(0, 6).map((b) => (
        <div key={b.key} className="flex items-center gap-2">
          <span className="text-xs w-32 flex-shrink-0 truncate" style={{ color: "var(--text-secondary)" }} title={prettyPersona(b.key)}>
            {prettyPersona(b.key)}
          </span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-subtle)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.round((b.count / max) * 100)}%`, background: "var(--accent)" }} />
          </div>
          <span className="text-xs w-16 text-right tabular-nums" style={{ color: "var(--text-tertiary)" }}>
            {b.count.toLocaleString()}{total > 0 ? ` · ${Math.round((b.count / total) * 100)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function Chips({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {buckets.slice(0, 10).map((b) => (
        <span key={b.key} className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--surface-subtle)", color: "var(--text-secondary)" }}>
          {b.key} <span className="font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{b.count.toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}

export default function SendSpread() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [openPreview, setOpenPreview] = useState<number | null>(0);

  useEffect(() => {
    fetch("/api/send-preview")
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch(() => setErr("Could not load the send preview."));
  }, []);

  if (err) return null; // fail quiet — this is an at-a-glance aid, never a blocker
  if (!data) {
    return (
      <div className="mb-6 card p-4">
        <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Loading what's ready to send…</p>
      </div>
    );
  }

  const { workspace, leads, ready, previews, activeStyles, deliverability, length } = data;
  const delivColor = deliverability ? (DELIV_COLOR[deliverability.verdict] ?? "var(--text-tertiary)") : "var(--text-tertiary)";

  return (
    <div className="mb-6 card overflow-hidden">
      {/* Project-space awareness — you always know which workspace you're acting in. */}
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: "var(--border)", background: "var(--surface-subtle)" }}>
        <div className="min-w-0">
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Project space</p>
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {workspace.name}
            {workspace.email && workspace.email !== workspace.name ? <span className="font-normal" style={{ color: "var(--text-tertiary)" }}> · {workspace.email}</span> : null}
          </p>
          {workspace.product && <p className="text-xs truncate" style={{ color: "var(--text-tertiary)" }}>{workspace.product}.</p>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Deliverability folded in here instead of its own menu — the thing to check before sending. */}
          {deliverability?.hasHealthData && (
            <span className="flex items-center gap-1.5 text-xs" title="Inbox placement health">
              <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ background: delivColor }} />
              <span style={{ color: "var(--text-secondary)" }}>
                Inbox {deliverability.verdict}{deliverability.avgHealth != null ? ` ${deliverability.avgHealth}%` : ""}
              </span>
            </span>
          )}
          <button onClick={() => setOpen((o) => !o)} className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {open ? "Hide" : "Show spread"}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-5 space-y-5">
          {/* Headline: ready-to-send count */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{ready.total.toLocaleString()}</span>
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>drafted &amp; ready to send</span>
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>· {leads.total.toLocaleString()} leads total in this project</span>
          </div>

          {/* What kind of emails the engine writes now — always visible so you know what's going out. */}
          {activeStyles.length > 0 && (
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Sending fresh in: {activeStyles.map((s, i) => (
                <span key={s}>
                  {i > 0 ? " · " : ""}<span style={{ color: "var(--text-secondary)" }}>{s}</span>
                </span>
              ))} <span style={{ color: "var(--text-tertiary)" }}>— attention-grab subject + deep-research proof, every email.</span>
            </p>
          )}

          {ready.total === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
              Nothing drafted yet. Generate sequences below (or pull leads) and this fills in with the spread + previews.
            </p>
          ) : (
            <>
              {/* Spread of the READY pool — persona bars + style/gift chips */}
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold tracking-wide mb-2" style={{ color: "var(--text-tertiary)" }}>READY, BY PERSONA</p>
                  <Bars buckets={ready.byPersona} total={ready.total} />
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold tracking-wide mb-2" style={{ color: "var(--text-tertiary)" }}>STYLES IN THE MIX</p>
                    <Chips buckets={ready.byStyle} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wide mb-2" style={{ color: "var(--text-tertiary)" }}>GIFT AMOUNTS</p>
                    <Chips buckets={ready.byGift} />
                  </div>
                </div>
              </div>

              {/* Previews — real drafted step-1 emails, short-enough-to-send only, each with matched proof */}
              <div>
                <p className="text-xs font-semibold tracking-wide mb-2" style={{ color: "var(--text-tertiary)" }}>PREVIEWS ({previews.length}) · short only, ≤{length.maxSendableWords}w</p>
                {length.longInSample > 0 && (
                  <p className="text-xs mb-2" style={{ color: "#b45309" }}>
                    {length.longInSample} of the last {length.sampled} drafts are too long to send (indigestible blocks). They&apos;re filtered out — recycle to rewrite them tight, or run the shorten tool.
                  </p>
                )}
                <div className="rounded-lg border divide-y" style={{ borderColor: "var(--border)" }}>
                  {previews.map((p, i) => (
                    <div key={i} className="p-3">
                      <button onClick={() => setOpenPreview((cur) => (cur === i ? null : i))} className="w-full text-left">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {p.subject || "(no subject)"}
                          </p>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] tabular-nums" style={{ color: p.words <= 40 ? "#1A7A4A" : "var(--text-tertiary)" }}>{p.words}w</span>
                            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{openPreview === i ? "–" : "+"}</span>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{p.name ?? "—"}{p.company ? ` · ${p.company}` : ""}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-subtle)", color: "var(--text-secondary)" }}>{prettyPersona(p.persona)}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-subtle)", color: "var(--text-secondary)" }}>{p.style}</span>
                          {p.gift && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-subtle)", color: "var(--text-secondary)" }}>{p.gift}</span>}
                          {/* Shows the personalization working: which real Gather customer this email leads with */}
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" title="Similar-brand proof this email will lead with" style={{ background: "var(--accent)", color: "#fff" }}>proof: {p.matchedBrand}</span>
                        </div>
                      </button>
                      {openPreview === i && (
                        <p className="text-sm mt-2 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{p.body ?? ""}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Types of leads — the whole pool by persona (not just what's drafted) */}
          <div>
            <p className="text-xs font-semibold tracking-wide mb-2" style={{ color: "var(--text-tertiary)" }}>ALL LEADS, BY PERSONA</p>
            <Bars buckets={leads.byPersona} total={leads.total} />
          </div>
        </div>
      )}
    </div>
  );
}
