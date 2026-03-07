// Email sending utility
// Uses Resend API (free tier). Requires RESEND_API_KEY in production.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend requires "Display Name <email>" format; free tier allows onboarding@resend.dev
const RESEND_FROM =
  process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
const FROM_DISPLAY = "Outbound Growth Engine";
const RESEND_FROM_HEADER =
  RESEND_FROM.includes("<") && RESEND_FROM.includes(">")
    ? RESEND_FROM
    : `${FROM_DISPLAY} <${RESEND_FROM}>`;

export async function sendVerificationEmail(
  email: string,
  token: string,
  name: string
): Promise<void> {
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) {
    throw new Error(
      "NEXTAUTH_URL is not set. Verification emails require it for the link."
    );
  }
  const verificationUrl = `${baseUrl}/verify-email?token=${token}`;

  // No API key: fail loudly so deploy/env can be fixed (don't silently skip in production)
  if (!RESEND_API_KEY?.trim()) {
    console.warn(
      "[Email] RESEND_API_KEY is not set. Set it in Vercel (or .env) to send verification emails."
    );
    throw new Error(
      "Email is not configured. Set RESEND_API_KEY in your environment to send verification emails."
    );
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_HEADER,
      to: [email],
      subject: "Verify your email for Outbound Growth Engine",
      html: `
        <h2>Welcome to Outbound Growth Engine!</h2>
        <p>Hi ${name},</p>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="${verificationUrl}" style="background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a></p>
        <p>Or copy and paste this URL into your browser:</p>
        <p>${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
      `,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { message?: string };
  const resendMessage = typeof data?.message === "string" ? data.message : "";

  if (!res.ok) {
    // Resend "testing" mode: only send to account owner until domain is verified
    const isTestingMode =
      res.status === 403 &&
      /only send testing emails to your own|verify a domain/i.test(resendMessage);
    const msg = isTestingMode
      ? "Resend is in testing mode: you can only send to your Resend account email until you verify a domain. Go to resend.com/domains, verify your domain (e.g. gatherhq.com), then set RESEND_FROM_EMAIL to an address on that domain (e.g. noreply@gatherhq.com) in Vercel."
      : resendMessage ||
        (res.status === 401
          ? "Invalid Resend API key. Check RESEND_API_KEY."
          : res.status === 422
            ? "Invalid from address or recipient. Use a verified domain for RESEND_FROM_EMAIL."
            : "Resend API error");
    throw new Error(`Verification email failed: ${msg}`);
  }

  return;
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  name?: string
): Promise<void> {
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) {
    throw new Error(
      "NEXTAUTH_URL is not set. Password reset emails require it for the link."
    );
  }
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  if (!RESEND_API_KEY?.trim()) {
    console.warn(
      "[Email] RESEND_API_KEY is not set. Set it in Vercel (or .env) to send password reset emails."
    );
    throw new Error(
      "Email is not configured. Set RESEND_API_KEY in your environment to send password reset emails."
    );
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_HEADER,
      to: [email],
      subject: "Reset your password – Outbound Growth Engine",
      html: `
        <h2>Reset your password</h2>
        <p>Hi ${name || "there"},</p>
        <p>We received a request to reset your password. Click the link below to choose a new password:</p>
        <p><a href="${resetUrl}" style="background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset password</a></p>
        <p>Or copy and paste this URL into your browser:</p>
        <p>${resetUrl}</p>
        <p>This link will expire in 1 hour. If you didn't request a reset, you can ignore this email.</p>
      `,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { message?: string };
  const resendMessage = typeof data?.message === "string" ? data.message : "";

  if (!res.ok) {
    const isTestingMode =
      res.status === 403 &&
      /only send testing emails to your own|verify a domain/i.test(resendMessage);
    const msg = isTestingMode
      ? "Resend is in testing mode: you can only send to your Resend account email until you verify a domain."
      : resendMessage ||
        (res.status === 401
          ? "Invalid Resend API key. Check RESEND_API_KEY."
          : res.status === 422
            ? "Invalid from address or recipient."
            : "Resend API error");
    throw new Error(`Password reset email failed: ${msg}`);
  }

  return;
}

/** Send a feature request to mayank@gatherhq.com */
export async function sendFeatureRequestEmail(
  fromEmail: string,
  fromName: string | null,
  message: string
): Promise<void> {
  if (!RESEND_API_KEY?.trim()) {
    throw new Error("Email is not configured. Set RESEND_API_KEY to submit feature requests.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_HEADER,
      to: ["mayank@gatherhq.com"],
      replyTo: [fromEmail],
      subject: `[Feature Request] From ${fromName || fromEmail}`,
      html: `
        <h2>Feature request</h2>
        <p><strong>From:</strong> ${fromName || "—"} &lt;${fromEmail}&gt;</p>
        <hr />
        <pre style="white-space: pre-wrap; font-family: inherit;">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      `,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) {
    throw new Error(data?.message || "Failed to send feature request.");
  }
}

/** Send error notification to mayank@gatherhq.com (e.g. generation failures) */
export async function sendErrorNotificationEmail(
  context: string,
  error: string,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!RESEND_API_KEY?.trim()) {
    console.warn("[Email] RESEND_API_KEY not set, skipping error notification");
    return;
  }

  const userEmail = extra?.userEmail as string | undefined;
  const userId = extra?.userId as string | undefined;
  const progress = extra?.progress as { total?: number; generated?: number } | undefined;
  const campaignId = extra?.campaignId as string | undefined;
  const batchId = extra?.batchId as string | undefined;

  const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f11; color: #e4e4e7; padding: 24px; border-radius: 12px;">
      <h2 style="margin: 0 0 4px; font-size: 18px; color: #f4f4f5;">⚠️ Error: ${esc(context)}</h2>
      <p style="margin: 0 0 24px; font-size: 13px; color: #71717a;">${new Date().toISOString()}</p>

      <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #52525b;">User</p>
        <p style="margin: 0; font-size: 15px; font-weight: 600; color: #34d399;">${esc(userEmail ?? "unknown")}</p>
        ${userId ? `<p style="margin: 4px 0 0; font-size: 12px; color: #52525b;">ID: ${esc(userId)}</p>` : ""}
      </div>

      ${progress ? `
      <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #52525b;">Progress</p>
        <p style="margin: 0; font-size: 15px; font-weight: 600;">${progress.generated ?? "?"} / ${progress.total ?? "?"} leads</p>
      </div>` : ""}

      <div style="background: #18181b; border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #52525b;">Error</p>
        <pre style="margin: 0; font-size: 13px; color: #fca5a5; white-space: pre-wrap; word-break: break-all;">${esc(error)}</pre>
      </div>

      ${campaignId || batchId ? `
      <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #52525b;">Context</p>
        ${campaignId ? `<p style="margin: 0 0 4px; font-size: 12px; color: #a1a1aa;">Campaign: <code style="color:#e4e4e7">${esc(campaignId)}</code></p>` : ""}
        ${batchId ? `<p style="margin: 0; font-size: 12px; color: #a1a1aa;">Batch: <code style="color:#e4e4e7">${esc(batchId)}</code></p>` : ""}
      </div>` : ""}
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_HEADER,
      to: ["mayank@gatherhq.com"],
      subject: `[Error] ${context} — ${userEmail ?? "unknown user"}`,
      html,
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    console.error("[Email] Error notification failed:", data?.message || res.status);
  }
}

export async function sendFixNotificationEmail(
  userEmail: string,
  context: string,
  fixNote: string
): Promise<void> {
  if (!RESEND_API_KEY?.trim()) return;

  const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f11; color: #e4e4e7; padding: 24px; border-radius: 12px;">
      <h2 style="margin: 0 0 4px; font-size: 18px; color: #f4f4f5;">✅ Fix deployed</h2>
      <p style="margin: 0 0 24px; font-size: 13px; color: #71717a;">Hi — this is Mayank from Gather. We wanted to let you know that an issue you hit has been fixed.</p>

      <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #52525b;">What happened</p>
        <p style="margin: 0; font-size: 14px; color: #a1a1aa;">${esc(context)}</p>
      </div>

      <div style="background: #18181b; border: 1px solid #34d399; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #52525b;">What we fixed</p>
        <p style="margin: 0; font-size: 14px; color: #d1fae5;">${esc(fixNote)}</p>
      </div>

      <p style="font-size: 14px; color: #71717a;">You can head back to <a href="https://growth.gatherhq.com" style="color: #34d399;">growth.gatherhq.com</a> and try again — it should work now. Reply to this email if you hit anything else.</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY.trim()}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM_HEADER,
      to: [userEmail],
      subject: `Fixed: ${context}`,
      html,
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    console.error("[Email] Fix notification failed:", data?.message || res.status);
  }
}
