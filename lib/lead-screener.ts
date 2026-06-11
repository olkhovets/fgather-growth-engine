import { callAnthropic } from "@/lib/anthropic";

type ScreenLead = { email: string; company?: string | null; jobTitle?: string | null; industry?: string | null };

/**
 * AI fit-screen (Jungler-article best practice): score each lead's company/title against the
 * ICP and drop clear non-fits BEFORE sending — so we stop wasting sends + enrichment credits
 * on the wrong audience (e.g. enterprise B2B when the ICP is B2C consumer brands).
 * Batched (one Claude call per ~30 leads). Fails safe: on any error, keep all leads.
 * Returns the indices to KEEP.
 */
export async function screenLeadsForFit(
  leads: ScreenLead[],
  icp: string,
  productSummary: string,
  anthropicKey: string,
  model: string
): Promise<{ keep: number[]; droppedReasons: Record<number, string> }> {
  if (!icp.trim() || leads.length === 0) return { keep: leads.map((_, i) => i), droppedReasons: {} };

  const keep = new Set<number>();
  const droppedReasons: Record<number, string> = {};
  const BATCH = 30;

  // Build all batches, then screen them in PARALLEL so this adds ~one Claude round-trip
  // of latency to ingest, not one per batch.
  const batches: Array<{ start: number; batch: ScreenLead[] }> = [];
  for (let start = 0; start < leads.length; start += BATCH) batches.push({ start, batch: leads.slice(start, start + BATCH) });

  await Promise.all(batches.map(async ({ start, batch }) => {
    const list = batch.map((l, i) => `${i}. ${l.jobTitle ?? "?"} at ${l.company ?? "?"} (${l.industry ?? "industry unknown"})`).join("\n");
    const prompt = `You screen cold-outreach leads for fit. Keep only leads that genuinely match the Ideal Customer Profile; drop clear mismatches.

PRODUCT: ${productSummary || "(n/a)"}
IDEAL CUSTOMER PROFILE: ${icp}

LEADS (index. title at company (industry)):
${list}

Return ONLY a JSON object: {"keep":[indices of good-fit leads]}. Be inclusive when unsure (keep), but drop obvious mismatches (wrong industry, clearly outside the ICP).`;
    try {
      const { text } = await callAnthropic(anthropicKey, prompt, { maxTokens: 400, model });
      const j = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(j) as { keep?: number[] };
      const keepIdx = Array.isArray(parsed.keep) ? parsed.keep : batch.map((_, i) => i);
      const keepSet = new Set(keepIdx);
      batch.forEach((_, i) => { if (keepSet.has(i)) keep.add(start + i); else droppedReasons[start + i] = "off-ICP"; });
    } catch {
      batch.forEach((_, i) => keep.add(start + i)); // fail safe: keep on error
    }
  }));
  return { keep: Array.from(keep).sort((a, b) => a - b), droppedReasons };
}
