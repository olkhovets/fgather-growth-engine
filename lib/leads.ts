import { prisma } from "@/lib/prisma";

export type NormalizedLead = {
  email: string;
  name?: string;
  jobTitle?: string;
  company?: string;
  website?: string;
  industry?: string;
  emailProvider?: string;
};

/**
 * Create a lead batch and insert leads. Returns batch id, count, and skipped duplicates.
 * When dedupe is true, skips leads whose email already exists in any batch in this workspace.
 */
export async function createBatchWithLeads(
  workspaceId: string,
  leads: NormalizedLead[],
  options?: { batchName?: string; dedupe?: boolean; existingBatchId?: string }
): Promise<{ batchId: string; count: number; skippedDuplicate: number }> {
  const valid = leads.filter((r) => r.email?.trim());
  if (valid.length === 0) {
    throw new Error("No valid leads with email.");
  }

  let toInsert = valid;
  let skippedDuplicate = 0;

  if (options?.dedupe !== false) {
    const existing = await prisma.lead.findMany({
      where: { leadBatch: { workspaceId } },
      select: { email: true },
    });
    const seen = new Set(existing.map((r) => r.email.toLowerCase().trim()));
    const before = toInsert.length;
    toInsert = toInsert.filter((l) => {
      const key = l.email.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    skippedDuplicate = before - toInsert.length;
  }

  if (toInsert.length === 0) {
    throw new Error(skippedDuplicate > 0 ? "All leads were duplicates (already in workspace)." : "No valid leads with email.");
  }

  // Reuse existing batch for chunked uploads, or create a new one
  let batchId: string;
  if (options?.existingBatchId) {
    batchId = options.existingBatchId;
  } else {
    const batch = await prisma.leadBatch.create({
      data: {
        workspaceId,
        name: options?.batchName ?? `Import ${new Date().toLocaleDateString()}`,
      },
    });
    batchId = batch.id;
  }

  await prisma.lead.createMany({
    data: toInsert.map((l) => ({
      leadBatchId: batchId,
      email: l.email.trim(),
      name: l.name?.trim() || null,
      jobTitle: l.jobTitle?.trim() || null,
      company: l.company?.trim() || null,
      website: l.website?.trim() || null,
      industry: l.industry?.trim() || null,
      emailProvider: l.emailProvider ?? null,
    })),
  });

  // Return total count in this batch
  const totalCount = await prisma.lead.count({ where: { leadBatchId: batchId } });
  return { batchId, count: totalCount, skippedDuplicate };
}
