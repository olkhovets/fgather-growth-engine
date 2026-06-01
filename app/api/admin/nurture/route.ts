import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isAdmin(email: string | null | undefined): boolean {
  const list = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? "";
  const emails = list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return email ? emails.includes(email.toLowerCase()) : false;
}

// ── Funnel stage definitions ────────────────────────────────────
type FunnelStage =
  | "signed_up_unverified"
  | "verified_no_domain"
  | "onboarded_no_keys"
  | "has_anthropic_no_instantly"
  | "has_instantly_no_anthropic"
  | "has_keys_no_campaign"
  | "created_campaign_not_sent"
  | "sent_campaign";

type UserWithStage = {
  id: string;
  email: string;
  name: string | null;
  stage: FunnelStage;
  createdAt: Date;
};

const STAGE_LABELS: Record<FunnelStage, string> = {
  signed_up_unverified: "Signed up but hasn't verified email",
  verified_no_domain: "Verified email but hasn't completed onboarding",
  onboarded_no_keys: "Added domain but no API keys yet",
  has_anthropic_no_instantly: "Has Anthropic key but no Instantly key",
  has_instantly_no_anthropic: "Has Instantly key but no Anthropic key",
  has_keys_no_campaign: "Both keys added but no campaign created",
  created_campaign_not_sent: "Created a campaign but never sent",
  sent_campaign: "Sent at least one campaign",
};

const STAGE_NEXT_STEP: Record<FunnelStage, string> = {
  signed_up_unverified:
    "Verify your email to unlock the dashboard and start building your first campaign.",
  verified_no_domain:
    "Complete onboarding by adding your domain so we can crawl your site and build your playbook.",
  onboarded_no_keys:
    "Add your Anthropic and Instantly API keys in Settings so you can generate personalized sequences and send.",
  has_anthropic_no_instantly:
    "You're one step away: add your Instantly API key in Settings to start sending campaigns.",
  has_instantly_no_anthropic:
    "Add your Anthropic API key in Settings so we can generate hyper-personalized email sequences for your leads.",
  has_keys_no_campaign:
    "You're fully set up! Create your first campaign from the dashboard, import leads, and let the AI write your sequences.",
  created_campaign_not_sent:
    "Your campaign is ready to go. Review your sequences, pick your sending accounts, and hit Send.",
  sent_campaign:
    "Great work on your first campaign! Check your analytics, review reply classifications, and use the strategy suggestions to optimize your next batch.",
};

const NEW_FEATURES_SUMMARY = `Here's what's new since you last checked in:

- **Hyper-personalized sequences**: Claude writes a unique multi-step email for every lead using their name, title, company, and your playbook.
- **Persona + vertical classification**: AI classifies your leads by role and industry so every email is tailored.
- **Performance memory**: Tracks what works (opens, clicks, replies) by segment and feeds learnings into the next batch.
- **Strategy suggestions**: After your first campaigns, the engine tells you exactly what to change.
- **Google Sheets import**: Paste a URL instead of downloading CSVs.
- **10x faster generation**: Parallel processing with one-click generate.
- **Smart ramp & send limits**: Protects your deliverability automatically (5/day cold, 30/day warm).
- **Social proof & sender identity**: Configure proof points and sender name so your emails always sound right.
- **Reply classification**: Positive, objection, OOO, not interested — all auto-classified and tracked.`;

// ── Classify each user into a funnel stage ──────────────────────
async function classifyUsers(): Promise<UserWithStage[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      createdAt: true,
      workspace: {
        select: {
          domain: true,
          anthropicKey: true,
          instantlyKey: true,
          campaigns: { select: { id: true }, take: 1 },
          sentCampaigns: { select: { id: true }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return users.map((u) => {
    let stage: FunnelStage;

    if (!u.emailVerified) {
      stage = "signed_up_unverified";
    } else if (!u.workspace?.domain) {
      stage = "verified_no_domain";
    } else if (!u.workspace.anthropicKey && !u.workspace.instantlyKey) {
      stage = "onboarded_no_keys";
    } else if (u.workspace.anthropicKey && !u.workspace.instantlyKey) {
      stage = "has_anthropic_no_instantly";
    } else if (!u.workspace.anthropicKey && u.workspace.instantlyKey) {
      stage = "has_instantly_no_anthropic";
    } else if (
      u.workspace.anthropicKey &&
      u.workspace.instantlyKey &&
      (!u.workspace.campaigns || u.workspace.campaigns.length === 0)
    ) {
      stage = "has_keys_no_campaign";
    } else if (
      u.workspace.campaigns &&
      u.workspace.campaigns.length > 0 &&
      (!u.workspace.sentCampaigns || u.workspace.sentCampaigns.length === 0)
    ) {
      stage = "created_campaign_not_sent";
    } else {
      stage = "sent_campaign";
    }

    return { id: u.id, email: u.email, name: u.name, stage, createdAt: u.createdAt };
  });
}

// ── Generate email copy per stage using Anthropic ───────────────
async function generateNurtureEmail(
  user: UserWithStage,
  anthropicKey: string
): Promise<{ subject: string; html: string }> {
  const firstName = user.name?.split(/\s+/)[0] || "there";
  const daysSinceSignup = Math.floor(
    (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  const prompt = `You are writing a short, warm, personal email from Mayank (founder of Gather) to a user of the Outbound Growth Engine (growth.gatherhq.com).

The user's first name is "${firstName}".
They signed up ${daysSinceSignup} day(s) ago.
Their current stage: "${STAGE_LABELS[user.stage]}"
Their next best step: "${STAGE_NEXT_STEP[user.stage]}"

Here are the latest features and capabilities of the product:
${NEW_FEATURES_SUMMARY}

Write a short email (4-6 sentences max) that:
1. Greets them warmly by first name
2. Acknowledges where they are in their journey (without being condescending)
3. Tells them their specific next step clearly
4. Mentions 1-2 new features that are most relevant to their stage
5. Ends with a friendly CTA to log in at growth.gatherhq.com
6. Signs off as "Mayank" (no last name)

Rules:
- Plain, conversational tone. Not salesy. Like a founder checking in.
- No bullet points, no markdown. Just flowing sentences.
- Keep it under 100 words.
- Do NOT use em dashes.

Return ONLY a JSON object with two fields:
- "subject": a short, lowercase email subject (no period at end)
- "body": the email body as plain text (no HTML)

No markdown fences, no preamble.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic error: ${res.status} ${JSON.stringify(err)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = data.content?.[0]?.text ?? "";

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const subject = parsed.subject ?? `quick note from mayank`;
    const body = parsed.body ?? "";

    // Build simple HTML email
    const html = `
      <div style="max-width: 560px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">
        ${body
          .split("\n")
          .filter((l: string) => l.trim())
          .map((p: string) => `<p style="margin: 0 0 12px 0;">${p}</p>`)
          .join("")}
        <p style="margin: 20px 0 0 0;">
          <a href="https://growth.gatherhq.com/login" style="display: inline-block; background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500;">Log in to your dashboard</a>
        </p>
      </div>
    `;

    return { subject, html };
  } catch {
    // Fallback if parsing fails
    const subject = `you're ${
      user.stage === "signed_up_unverified" ? "one step away" : "almost there"
    }`;
    const body = `Hi ${firstName}, just checking in. Your next step: ${STAGE_NEXT_STEP[user.stage]} Log in at growth.gatherhq.com anytime. - Mayank`;
    const html = `<div style="max-width: 560px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;"><p>${body}</p></div>`;
    return { subject, html };
  }
}

// ── Send via Resend ─────────────────────────────────────────────
async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY?.trim()) {
    return { ok: false, error: "RESEND_API_KEY not set" };
  }

  const RESEND_FROM =
    process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
  const fromHeader = RESEND_FROM.includes("<")
    ? RESEND_FROM
    : `Mayank from Gather <${RESEND_FROM}>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      from: fromHeader,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: data?.message || `${res.status}` };
  }

  return { ok: true };
}

// ── GET: Preview (dry run) ──────────────────────────────────────
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const users = await classifyUsers();
    const summary: Record<string, number> = {};
    for (const u of users) {
      summary[STAGE_LABELS[u.stage]] = (summary[STAGE_LABELS[u.stage]] || 0) + 1;
    }

    return NextResponse.json({
      totalUsers: users.length,
      byStage: summary,
      users: users.map((u) => ({
        email: u.email,
        name: u.name,
        stage: u.stage,
        stageLabel: STAGE_LABELS[u.stage],
        nextStep: STAGE_NEXT_STEP[u.stage],
        daysSinceSignup: Math.floor(
          (Date.now() - u.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        ),
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to preview";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: Generate + send nurture emails ────────────────────────
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Admin's own Anthropic key (from their workspace) or env fallback
    const adminWorkspace = await prisma.workspace.findFirst({
      where: { user: { email: session.user.email } },
      select: { anthropicKey: true },
    });

    // Try workspace key first, then env var
    let anthropicKey = "";
    if (adminWorkspace?.anthropicKey) {
      // Decrypt if using encryption
      const CryptoJS = await import("crypto-js");
      const secret = process.env.ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET || "fallback";
      try {
        const bytes = CryptoJS.AES.decrypt(adminWorkspace.anthropicKey, secret);
        anthropicKey = bytes.toString(CryptoJS.enc.Utf8);
      } catch {
        anthropicKey = adminWorkspace.anthropicKey;
      }
    }
    if (!anthropicKey) {
      anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
    }
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "No Anthropic API key available. Set ANTHROPIC_API_KEY env var or add one in your workspace." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;
    const stageFilter: string[] | undefined = body?.stages;

    let users = await classifyUsers();

    // Optionally filter by stage
    if (stageFilter && stageFilter.length > 0) {
      users = users.filter((u) => stageFilter.includes(u.stage));
    }

    // Exclude admin's own email
    users = users.filter(
      (u) => u.email.toLowerCase() !== session.user!.email!.toLowerCase()
    );

    if (users.length === 0) {
      return NextResponse.json({ sent: 0, errors: [], message: "No users to email." });
    }

    const results: Array<{
      email: string;
      stage: string;
      subject: string;
      sent: boolean;
      error?: string;
    }> = [];

    // Process sequentially to avoid rate limits
    for (const user of users) {
      try {
        const { subject, html } = await generateNurtureEmail(user, anthropicKey);

        if (dryRun) {
          results.push({ email: user.email, stage: user.stage, subject, sent: false });
          continue;
        }

        const sendResult = await sendEmail(user.email, subject, html);
        results.push({
          email: user.email,
          stage: user.stage,
          subject,
          sent: sendResult.ok,
          error: sendResult.error,
        });

        // Small delay between sends
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ email: user.email, stage: user.stage, subject: "", sent: false, error: msg });
      }
    }

    const sent = results.filter((r) => r.sent).length;
    const errors = results.filter((r) => !r.sent && !dryRun);

    return NextResponse.json({
      dryRun,
      total: users.length,
      sent: dryRun ? 0 : sent,
      failed: dryRun ? 0 : errors.length,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send nurture emails";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
