"use client";

import { useEffect, useState } from "react";

type WebhookInfo = {
  webhookUrl: string;
  repliesReceived: number;
  positiveReplies: number;
  configured: boolean;
};

/**
 * Shows whether the Instantly reply webhook is live, with the exact URL to paste.
 * The positive-reply signal the whole learning loop runs on depends on this, so we
 * surface it both in Settings and on the experiment dashboard.
 */
export default function WebhookStatus({ compact = false }: { compact?: boolean }) {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/webhooks/instantly/setup")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setInfo(d); })
      .catch(() => {});
  }, []);

  if (!info) return null;

  const copy = () => {
    navigator.clipboard?.writeText(info.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${info.configured ? "bg-emerald-500" : "bg-amber-400"}`} />
        <h3 className="text-sm font-medium text-gray-700">
          Reply webhook {info.configured ? "live" : "not confirmed yet"}
        </h3>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {info.configured
          ? `Receiving replies: ${info.repliesReceived} classified, ${info.positiveReplies} positive. This is what the engine learns from.`
          : "No replies received yet. Paste this URL into Instantly so positive replies get tracked — without it, experiments can't find winners."}
      </p>
      {!info.configured && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={info.webhookUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 font-mono"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-300"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {!compact && (
            <p className="text-xs text-gray-400">
              In Instantly: Settings → Webhooks → New Webhook → event &quot;Reply received&quot;, paste this URL.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
