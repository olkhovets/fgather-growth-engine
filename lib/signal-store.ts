/**
 * Research-signal store — the closed loop between deep-research agents and the email engine.
 *
 * A "signal" is the pain-point / trigger your research found for a specific person (e.g. "just
 * launched a DTC line into Target", "hiring 3 growth roles", "CMO said in a podcast they're moving
 * off their agency") plus WHERE it came from. That signal is the single best opener for a 1:1 email.
 *
 * There is no dedicated Lead column for it (adding one needs a live migration this build avoids), so
 * we pack it into the existing `landingPageContentJson` field under a namespaced marker. Signal-ingested
 * leads never use the landing-page flow, so there is no collision. Generation reads it back and opens
 * the email on it — bypassing the model's own web search when a real, provided signal already exists.
 */

import type { DeepResearch } from "@/lib/deep-research";

export type LeadSignal = { hook: string; source: string; connection?: string };

const MARKER = "__signal_v1";

/** Serialize a signal for storage in Lead.landingPageContentJson. */
export function packSignal(sig: LeadSignal): string {
  return JSON.stringify({ [MARKER]: true, hook: sig.hook, source: sig.source, connection: sig.connection ?? "" });
}

/** Read a stored signal back from Lead.landingPageContentJson; null if the field holds something else. */
export function readSignal(landingPageContentJson: string | null | undefined): LeadSignal | null {
  if (!landingPageContentJson) return null;
  try {
    const o = JSON.parse(landingPageContentJson) as Record<string, unknown>;
    if (!o || o[MARKER] !== true || typeof o.hook !== "string" || !o.hook.trim()) return null;
    return { hook: o.hook.trim(), source: typeof o.source === "string" ? o.source : "", connection: typeof o.connection === "string" ? o.connection : "" };
  } catch {
    return null;
  }
}

/** Turn a stored signal into the DeepResearch shape generation already knows how to open on. */
export function signalToResearch(sig: LeadSignal): DeepResearch {
  return { hook: sig.hook, connection: sig.connection ?? "", source: sig.source, confidence: 100 };
}
