/**
 * ZeroBounce email verification wrapper.
 * Falls back gracefully if no API key is configured — returns "unknown" so the
 * lead is still processed rather than dropped.
 */

const ZEROBOUNCE_API = "https://api.zerobounce.net/v2/validate";

export type VerifyResult = "valid" | "invalid" | "unknown";

const BASIC_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function verifyEmail(
  email: string,
  apiKey?: string
): Promise<VerifyResult> {
  const key = apiKey ?? process.env.ZEROBOUNCE_API_KEY;
  if (!BASIC_RE.test(email)) return "invalid";
  if (!key) return "unknown";

  try {
    const url = `${ZEROBOUNCE_API}?api_key=${key}&email=${encodeURIComponent(email)}&ip_address=`;
    const res = await fetch(url);
    if (!res.ok) return "unknown";
    const data = await res.json();
    const status: string = data.status ?? "";
    if (status === "valid") return "valid";
    if (["invalid", "abuse", "do_not_mail", "spamtrap"].includes(status))
      return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function verifyEmailBatch(
  emails: string[],
  apiKey?: string,
  concurrency = 10
): Promise<Map<string, VerifyResult>> {
  const results = new Map<string, VerifyResult>();
  for (let i = 0; i < emails.length; i += concurrency) {
    const chunk = emails.slice(i, i + concurrency);
    const settled = await Promise.all(
      chunk.map((e) => verifyEmail(e, apiKey).then((r) => ({ e, r })))
    );
    for (const { e, r } of settled) results.set(e, r);
  }
  return results;
}
