import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { callAnthropic } from "@/lib/anthropic";
import { sendNotificationEmail } from "@/lib/email";

export const REPLY_CLASSIFICATIONS = [
  "positive",
  "objection",
  "ooo",
  "not_interested",
  "other",
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

export type ClassifyResult = {
  classification: ReplyClassification;
  /** For OOO replies: ISO date the person returns, if Claude could extract one. */
  requeueDate: string | null;
};

/**
 * Classify a cold-outreach reply and, for out-of-office replies, extract the
 * return date so the lead can be automatically re-queued.
 * Falls back to "other" on any error so the caller never blocks on this.
 */
export async function classifyReply(
  anthropicKey: string,
  fromEmail: string,
  subject: string,
  body: string,
  model = "claude-haiku-4-5"
): Promise<ClassifyResult> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Classify this cold outreach reply into exactly one category and, if it is an out-of-office auto-reply, extract the date the person returns to the office.

Categories:
- positive: interested, wants a demo/call, asks a buying question
- objection: pushback you can respond to (timing, budget, "tell me more")
- ooo: automatic out-of-office / vacation / parental leave auto-reply
- not_interested: explicit no, unsubscribe request, "remove me", hostile
- other: anything else (bounce notice, irrelevant, forwarded internally)

Today's date is ${today}.
Reply from: ${fromEmail}
Subject: ${subject}
Body:
${body || "(empty)"}

Respond with ONLY a JSON object, no markdown:
{ "classification": "positive|objection|ooo|not_interested|other", "return_date": "YYYY-MM-DD or null" }
For return_date (ooo only): use the date the person says they are BACK / returning. Resolve relative phrases against today's date and always pick the SOONEST future date that matches — "Monday" / "next week" / "the 20th" / "back on 6/20" all become an absolute YYYY-MM-DD in the future. If they give a range, use the day they return. If no return date is stated, use null.`;

  try {
    const { text } = await callAnthropic(anthropicKey, prompt, { maxTokens: 150, model });
    const jsonStr = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as { classification?: string; return_date?: string | null };
    const c = (parsed.classification ?? "").toLowerCase();
    const classification = (REPLY_CLASSIFICATIONS as readonly string[]).includes(c)
      ? (c as ReplyClassification)
      : "other";
    let requeueDate: string | null = null;
    if (classification === "ooo" && parsed.return_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.return_date)) {
      requeueDate = parsed.return_date;
    }
    return { classification, requeueDate };
  } catch {
    return { classification: "other", requeueDate: null };
  }
}

/**
 * Apply the consequence of a classified reply to the matching Lead(s):
 *  - positive       → record reply, notify the user by email
 *  - not_interested → record reply, suppress (never contact again)
 *  - ooo            → record reply, set requeueAt so the lead is re-contacted later
 *  - objection/other→ record reply only
 *
 * Matches leads by email within the workspace. Idempotent-ish: re-running with
 * the same reply just overwrites the same fields.
 */
export async function applyReplyToLead(
  workspaceId: string,
  fromEmail: string,
  classification: ReplyClassification,
  requeueDate: string | null,
  opts: { campaignName?: string; subject?: string; bodySnippet?: string; notifyEmail?: string | null }
): Promise<{ matchedLeads: number }> {
  const email = fromEmail.trim().toLowerCase();

  // Find leads in this workspace with this email
  const leads = await prisma.lead.findMany({
    where: {
      email: { equals: email, mode: "insensitive" },
      leadBatch: { workspaceId },
    },
    select: { id: true, name: true, company: true },
  });

  if (leads.length === 0) return { matchedLeads: 0 };

  const leadIds = leads.map((l) => l.id);
  const data: Record<string, unknown> = {
    replyStatus: classification,
    repliedAt: new Date(),
  };

  if (classification === "not_interested") {
    data.suppressed = true;
  } else if (classification === "ooo") {
    // Re-contact when they're back. Parse the stated return date, but sanity-clamp it: a past date
    // (LLM resolved the wrong year, or they're already back) or one absurdly far out falls back to
    // a sensible window. Default to +7 days when no usable date was extracted.
    const now = Date.now();
    const min = now + 24 * 60 * 60 * 1000;       // never sooner than tomorrow
    const max = now + 90 * 24 * 60 * 60 * 1000;  // never further than ~3 months
    let when = now + 7 * 24 * 60 * 60 * 1000;     // fallback: +7 days
    if (requeueDate) {
      // Re-contact the morning AFTER they return, so we don't land in the inbox the day they're
      // back to a pile of email.
      const d = new Date(`${requeueDate}T09:00:00Z`).getTime() + 24 * 60 * 60 * 1000;
      if (!isNaN(d) && d >= min) when = Math.min(d, max);
    }
    data.requeueAt = new Date(when);
  }

  await prisma.lead.updateMany({ where: { id: { in: leadIds } }, data });

  // Notify on positive replies — this is the money signal
  if (classification === "positive" && opts.notifyEmail) {
    const lead = leads[0];
    await sendNotificationEmail(
      opts.notifyEmail,
      `🎯 Positive reply from ${lead.name ?? email}${lead.company ? ` (${lead.company})` : ""}`,
      `<h2>Positive reply</h2>
       <p><strong>From:</strong> ${lead.name ?? "—"} &lt;${email}&gt;</p>
       ${lead.company ? `<p><strong>Company:</strong> ${lead.company}</p>` : ""}
       ${opts.campaignName ? `<p><strong>Campaign:</strong> ${opts.campaignName}</p>` : ""}
       ${opts.subject ? `<p><strong>Subject:</strong> ${opts.subject}</p>` : ""}
       <hr />
       <pre style="white-space: pre-wrap; font-family: inherit;">${(opts.bodySnippet ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
       <p>Reply to them directly to keep the thread warm.</p>`
    );
  }

  return { matchedLeads: leads.length };
}

/** Convenience: decrypt a workspace's Anthropic key, or null if absent. */
export function decryptKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}
