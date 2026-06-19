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
    const prompt = `You are a LENIENT gatekeeper for cold-outreach leads. The Apollo search already filtered by title and consumer industry, so the DEFAULT is KEEP. Only drop a lead when the company is CLEARLY not a consumer/B2C brand.

PRODUCT: ${productSummary || "(n/a)"}
IDEAL CUSTOMER PROFILE: ${icp}

LEADS (index. title at company (industry)):
${list}

KEEP every consumer-facing brand: DTC, CPG, food/beverage, beauty/cosmetics, fashion/apparel, footwear, retail, ecommerce, wellness/fitness, consumer electronics, restaurants, hospitality, consumer apps, household/home goods, pet, etc. Use the COMPANY NAME: if it's a recognizable consumer brand (e.g. Converse, Crocs, Spanx, Aveda, Tropicana), KEEP it even when the industry is blank.
ONLY DROP when the company is clearly B2B software/SaaS, a marketing/research/staffing agency or consultancy, a distributor/3PL/logistics firm, a bank/insurer, or otherwise plainly NOT selling to consumers. When in any doubt, KEEP.

Return ONLY a JSON object: {"keep":[indices to keep]}.`;
    try {
      const { text } = await callAnthropic(anthropicKey, prompt, { maxTokens: 800, model });
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
