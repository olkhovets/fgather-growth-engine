import { promises as dns } from "dns";

/**
 * Classify the inbox provider behind an email. Free providers are mapped directly by domain;
 * corporate domains are resolved via MX records (so we can tell Google Workspace from
 * Microsoft 365 — the split the Jungler CAC article found mattered most for deliverability).
 * Results should be cached per-domain by the caller (MX lookups are slow).
 */
const FREE_DOMAINS: Record<string, string> = {
  "gmail.com": "Google", "googlemail.com": "Google",
  "outlook.com": "Microsoft", "hotmail.com": "Microsoft", "live.com": "Microsoft", "msn.com": "Microsoft",
  "yahoo.com": "Yahoo", "ymail.com": "Yahoo", "yahoo.co.uk": "Yahoo",
  "aol.com": "AOL",
  "icloud.com": "Apple", "me.com": "Apple", "mac.com": "Apple",
  "proton.me": "Proton", "protonmail.com": "Proton",
};

/** Map an MX exchange hostname to a provider. */
function providerFromMx(exchanges: string[]): string {
  const joined = exchanges.join(" ").toLowerCase();
  if (/google|googlemail|aspmx/.test(joined)) return "Google";
  if (/outlook|microsoft|office365|protection\.outlook/.test(joined)) return "Microsoft";
  if (/pphosted|proofpoint/.test(joined)) return "Proofpoint";
  if (/mimecast/.test(joined)) return "Mimecast";
  if (/barracuda/.test(joined)) return "Barracuda";
  if (/yahoodns|yahoo/.test(joined)) return "Yahoo";
  if (/secureserver|godaddy/.test(joined)) return "GoDaddy";
  if (/amazonaws|amazonses/.test(joined)) return "Amazon";
  if (/zoho/.test(joined)) return "Zoho";
  return "Other";
}

export async function classifyEmailProvider(email: string): Promise<string> {
  const domain = (email.split("@")[1] || "").toLowerCase().trim();
  if (!domain) return "Unknown";
  if (FREE_DOMAINS[domain]) return FREE_DOMAINS[domain];
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) return "Other";
    return providerFromMx(mx.map((m) => m.exchange));
  } catch {
    return "Other";
  }
}

/**
 * Classify many emails, caching by domain so each domain is only looked up once.
 * Returns a map of email -> provider. Runs MX lookups with bounded concurrency.
 */
export async function classifyEmailProviders(emails: string[]): Promise<Record<string, string>> {
  const byDomain: Record<string, string> = {};
  const domains = Array.from(new Set(emails.map((e) => (e.split("@")[1] || "").toLowerCase().trim()).filter(Boolean)));
  const CONCURRENCY = 25;
  for (let i = 0; i < domains.length; i += CONCURRENCY) {
    const chunk = domains.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (d) => { byDomain[d] = await classifyEmailProvider(`x@${d}`); }));
  }
  const out: Record<string, string> = {};
  for (const e of emails) {
    const d = (e.split("@")[1] || "").toLowerCase().trim();
    out[e] = byDomain[d] ?? "Unknown";
  }
  return out;
}
