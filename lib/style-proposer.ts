import { prisma } from "@/lib/prisma";
import { callAnthropic } from "@/lib/anthropic";
import { gradeEmail } from "@/lib/email-grader";
import { researchPlaybookBlock } from "@/lib/cold-email-research";
import { loadLearnings } from "@/lib/experiments";
import { rateStylesByReply } from "@/lib/style-performance";

/**
 * Style factory — the engine PROPOSES new email styles, self-GRADES them on sample emails, Peter
 * APPROVES via CLI, approved styles enter the generation ROTATION and get REPLY-RATED like any other
 * style (lib/style-performance.ts). Human-in-the-loop: nothing a proposer invents is ever sent until
 * Peter approves it.
 *
 * Storage is migration-free: reuses the PromptExperiment table with dimension="style" and a custom
 * status lifecycle ("proposed" → "approved" | "killed"). dimension="style" is NOT in
 * EXPERIMENT_DIMENSIONS, so these rows are invisible to the subject/hook/cta/incentive A/B machinery.
 * The full style guide is stored as JSON in `instruction`; the rationale in `hypothesis`.
 */

export const STYLE_DIMENSION = "style";

export type StyleDef = { name: string; prompt: string; usePS: boolean };
export type StoredStyle = StyleDef & { sampleGrade?: number; samples?: Array<{ subject: string; body: string; score: number }> };

export type StyleRecord = {
  id: string;
  key: string;            // Lead.emailStyle value (the experiment label)
  status: string;         // proposed | approved | killed
  name: string;
  prompt: string;
  usePS: boolean;
  sampleGrade: number | null;
  rationale: string | null;
  // live outcome (only meaningful once it has accrued sends):
  sent: number;
  positives: number;
  positiveRate: number;   // percent
};

// Synthetic ICP-representative leads used to self-test a candidate style before surfacing it.
const SAMPLE_LEADS = [
  { name: "Dana Reed", jobTitle: "VP Marketing", company: "Brightland", industry: "consumer goods (olive oil / pantry DTC)" },
  { name: "Marcus Lee", jobTitle: "Head of Growth", company: "Caraway", industry: "DTC cookware" },
];

function slug(name: string): string {
  return ("custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).slice(0, 48);
}

/** Generate one sample step-1 email for a candidate style + grade it. Best-effort. */
async function sampleAndGrade(
  anthropicKey: string,
  model: string,
  product: string,
  candidate: StyleDef,
  lead: (typeof SAMPLE_LEADS)[number]
): Promise<{ subject: string; body: string; score: number } | null> {
  const system = `You are an expert B2B cold email writer.
PRODUCT:
${product || "Gather — AI consumer research for B2C marketing leaders; real customer answers in days, used by brands like Belk and Staples."}

${candidate.prompt}${researchPlaybookBlock()}

Hard rules: no links in step 1, no em dashes, no AI-tell words, sign off as a human. Reply-first.`;
  const user = `Write step 1 of a cold email for this lead, in the style above.
LEAD: ${lead.name}, ${lead.jobTitle} at ${lead.company} (${lead.industry}).
Greet as "Hi ${lead.name.split(" ")[0]},". Return ONLY JSON: {"subject":"...","body":"..."}`;
  try {
    const { text } = await callAnthropic(anthropicKey, user, { maxTokens: 600, model, systemPrompt: system });
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof j.subject !== "string" || typeof j.body !== "string") return null;
    const g = gradeEmail({ subject: j.subject, body: j.body });
    return { subject: j.subject, body: j.body, score: g.score };
  } catch {
    return null;
  }
}

/** Propose `count` new candidate styles, self-grade each, store as status="proposed". */
export async function proposeStyles(
  workspaceId: string,
  anthropicKey: string,
  model: string,
  count = 2
): Promise<{ proposed: Array<{ key: string; name: string; sampleGrade: number | null }>; total: number }> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { productSummary: true, icp: true, proofPointsJson: true },
  });
  const product = ws?.productSummary ?? "";
  const icp = ws?.icp ?? "";
  let proofPoints = "";
  try {
    if (ws?.proofPointsJson) {
      const arr = JSON.parse(ws.proofPointsJson) as Array<{ title?: string; text: string }>;
      proofPoints = arr.map((p) => (p.title ? `${p.title}: ${p.text}` : p.text)).join("; ");
    }
  } catch { /* ignore */ }

  const learnings = await loadLearnings(workspaceId);
  const perf = await rateStylesByReply(workspaceId);
  const existing = await prisma.promptExperiment.findMany({
    where: { workspaceId, dimension: STYLE_DIMENSION },
    select: { label: true },
  });
  const existingNames = existing.map((e) => e.label);

  const winningLine = perf.leader ? `Our current best-performing style by positive replies is "${perf.leader}". Build NEAR it (same spirit, different mechanism), don't copy it.` : "";
  const learningsLine = learnings.length ? `Proven learnings to honor:\n${learnings.slice(-12).map((l) => `- ${l}`).join("\n")}` : "";

  const system = `You design COLD-EMAIL STYLES. A style is a reusable directive block (like a recipe) that tells the email writer HOW to write — its opening move, structure, subject approach, and close. Not a finished email.

You will get a product, ICP, proven learnings, and the data-backed rules below. Propose ${count} genuinely NEW styles, each with a distinct mechanism (e.g. a contrarian take, a teardown-first offer, a one-line pattern interrupt, a peer-referral framing). Each must obey: reply-first (no links in step 1), under ~80 words, problem-before-pitch, real specificity, no em dashes, no AI-tell words.

Return STRICT JSON only:
{"styles":[{"name":"2-4 word Title","usePS":false,"rationale":"why this could beat our current styles, 1-2 sentences","prompt":"EMAIL STYLE: <Name>\\n<the full directive: sentence-by-sentence what to do, subject guidance, and the reply-first close>"}]}`;

  const user = `PRODUCT:\n${product || "(none)"}\n\nICP:\n${icp || "(none)"}\n\nPROOF POINTS:\n${proofPoints || "(none)"}\n\n${winningLine}\n${learningsLine}\n\nAlready have these styles (propose DIFFERENT mechanisms): ${["specialist-proof", "lean-personal", "pain-led", "insight-hook", "social-proof", "direct-ask", ...existingNames].join(", ")}${researchPlaybookBlock()}\n\nReturn STRICT JSON.`;

  let candidates: StyleDef[] = [];
  try {
    const { text } = await callAnthropic(anthropicKey, user, { maxTokens: 1600, model, systemPrompt: system });
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (Array.isArray(j.styles)) {
      candidates = j.styles
        .filter((s: unknown): s is StyleDef => typeof s === "object" && s !== null && typeof (s as StyleDef).name === "string" && typeof (s as StyleDef).prompt === "string")
        .slice(0, count)
        .map((s: StyleDef & { rationale?: string }) => ({ name: s.name.trim().slice(0, 40), prompt: s.prompt.trim(), usePS: !!s.usePS, rationale: (s as { rationale?: string }).rationale }));
    }
  } catch {
    return { proposed: [], total: 0 };
  }

  const maxGen = (await prisma.promptExperiment.aggregate({ where: { workspaceId }, _max: { generation: true } }))._max.generation ?? 0;
  const proposed: Array<{ key: string; name: string; sampleGrade: number | null }> = [];

  for (const c of candidates) {
    const key = slug(c.name);
    // skip duplicates by key
    if (existingNames.includes(key)) continue;
    // self-test: sample + grade on representative leads
    const samples = (await Promise.all(SAMPLE_LEADS.map((l) => sampleAndGrade(anthropicKey, model, product, c, l)))).filter((x): x is NonNullable<typeof x> => x !== null);
    const sampleGrade = samples.length ? Math.round(samples.reduce((a, b) => a + b.score, 0) / samples.length) : null;
    const stored: StoredStyle = { name: c.name, prompt: c.prompt, usePS: c.usePS, sampleGrade: sampleGrade ?? undefined, samples };

    await prisma.promptExperiment.create({
      data: {
        workspaceId,
        dimension: STYLE_DIMENSION,
        label: key,
        instruction: JSON.stringify(stored),
        hypothesis: ((c as StyleDef & { rationale?: string }).rationale ?? "").toString().slice(0, 400) || null,
        status: "proposed",
        generation: maxGen + 1,
      },
    });
    proposed.push({ key, name: c.name, sampleGrade });
  }

  return { proposed, total: proposed.length };
}

function parseStored(instruction: string): StoredStyle | null {
  try {
    const j = JSON.parse(instruction);
    if (typeof j?.prompt === "string") return { name: j.name ?? "", prompt: j.prompt, usePS: !!j.usePS, sampleGrade: j.sampleGrade, samples: j.samples };
    return null;
  } catch {
    return null;
  }
}

/** List proposed + approved styles with their self-test grade and live reply outcome. */
export async function listStyles(workspaceId: string): Promise<StyleRecord[]> {
  const [rows, perf] = await Promise.all([
    prisma.promptExperiment.findMany({
      where: { workspaceId, dimension: STYLE_DIMENSION, status: { in: ["proposed", "approved"] } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: { id: true, label: true, status: true, instruction: true, hypothesis: true },
    }),
    rateStylesByReply(workspaceId),
  ]);
  const perfByStyle = new Map(perf.styles.map((s) => [s.style, s]));
  return rows.map((r) => {
    const s = parseStored(r.instruction);
    const live = perfByStyle.get(r.label);
    return {
      id: r.id, key: r.label, status: r.status,
      name: s?.name || r.label, prompt: s?.prompt || "", usePS: s?.usePS ?? false,
      sampleGrade: s?.sampleGrade ?? null, rationale: r.hypothesis,
      sent: live?.sent ?? 0, positives: live?.positives ?? 0,
      positiveRate: live ? Math.round(live.rate * 10000) / 100 : 0,
    };
  });
}

/** Approve or reject a proposed style. */
export async function setStyleStatus(workspaceId: string, id: string, status: "approved" | "killed"): Promise<boolean> {
  const row = await prisma.promptExperiment.findFirst({ where: { id, workspaceId, dimension: STYLE_DIMENSION } });
  if (!row) return false;
  await prisma.promptExperiment.update({ where: { id }, data: { status } });
  return true;
}

/** Load APPROVED styles as a generation-ready map keyed by Lead.emailStyle value. */
export async function loadApprovedStyles(workspaceId: string): Promise<Record<string, StyleDef>> {
  const rows = await prisma.promptExperiment.findMany({
    where: { workspaceId, dimension: STYLE_DIMENSION, status: "approved" },
    select: { label: true, instruction: true },
  });
  const out: Record<string, StyleDef> = {};
  for (const r of rows) {
    const s = parseStored(r.instruction);
    if (s) out[r.label] = { name: s.name, prompt: s.prompt, usePS: s.usePS };
  }
  return out;
}
