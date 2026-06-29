import { promises as dns } from "dns";

/**
 * Email authentication check — the half of deliverability you can CONFIRM without sending anything.
 * SPF, DKIM and DMARC are DNS records; if they're missing or broken, mailbox providers spam-folder or
 * reject cold mail no matter how good the copy is. This resolves them per sending domain so the engine
 * can say "your domains are/aren't authenticated" with certainty, alongside the warmup placement score.
 *
 * Pure DNS, no third-party service. DKIM selectors vary by provider, so we probe the common ones and
 * report "unknown" (not "missing") when none resolve — absence of a known selector isn't proof of absence.
 */

export type DomainAuth = {
  domain: string;
  spf: boolean;
  dmarc: boolean;
  dmarcPolicy: string | null;   // none | quarantine | reject
  dkim: boolean | "unknown";
  dkimSelector: string | null;
  issues: string[];
  verdict: "authenticated" | "weak" | "unauthenticated" | "error";
};

// Selectors used by the common cold-email sending stacks (Google Workspace, M365, Mailgun, SendGrid, etc.)
const DKIM_SELECTORS = ["google", "default", "selector1", "selector2", "k1", "k2", "s1", "s2", "mail", "dkim", "smtp", "mandrill", "sig1"];

async function txt(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

export async function checkDomainAuth(domain: string): Promise<DomainAuth> {
  const d = domain.toLowerCase().trim();
  const issues: string[] = [];

  try {
    // SPF: a TXT record at the root starting with v=spf1
    const root = await txt(d);
    const spf = root.some((r) => /v=spf1/i.test(r));
    if (!spf) issues.push("No SPF record (v=spf1) — receivers can't verify your senders.");

    // DMARC: TXT at _dmarc.<domain>
    const dmarcRecs = await txt(`_dmarc.${d}`);
    const dmarcRec = dmarcRecs.find((r) => /v=dmarc1/i.test(r)) ?? null;
    const dmarc = !!dmarcRec;
    const dmarcPolicy = dmarcRec ? (dmarcRec.match(/p=\s*(none|quarantine|reject)/i)?.[1]?.toLowerCase() ?? null) : null;
    if (!dmarc) issues.push("No DMARC record — providers treat unauthenticated cold mail harshly.");
    else if (dmarcPolicy === "none") issues.push("DMARC policy is p=none (monitor only) — fine for deliverability, no enforcement.");

    // DKIM: probe common selectors at <selector>._domainkey.<domain>
    let dkim: boolean | "unknown" = "unknown";
    let dkimSelector: string | null = null;
    for (const sel of DKIM_SELECTORS) {
      const recs = await txt(`${sel}._domainkey.${d}`);
      if (recs.some((r) => /v=dkim1|k=rsa|p=/i.test(r))) { dkim = true; dkimSelector = sel; break; }
    }
    if (dkim === "unknown") issues.push("DKIM not found on common selectors — verify your provider's selector is published (couldn't confirm signing).");

    // Verdict: SPF + DMARC are the confirmable floor; DKIM unknown is a soft flag.
    let verdict: DomainAuth["verdict"] = "authenticated";
    if (!spf && !dmarc) verdict = "unauthenticated";
    else if (!spf || !dmarc) verdict = "weak";
    else if (dkim === "unknown") verdict = "weak";

    return { domain: d, spf, dmarc, dmarcPolicy, dkim, dkimSelector, issues, verdict };
  } catch {
    return { domain: d, spf: false, dmarc: false, dmarcPolicy: null, dkim: "unknown", dkimSelector: null, issues: ["DNS lookup failed for this domain."], verdict: "error" };
  }
}

/** Check many domains concurrently (bounded). */
export async function checkDomainsAuth(domains: string[]): Promise<DomainAuth[]> {
  const unique = Array.from(new Set(domains.map((d) => d.toLowerCase().trim()))).filter(Boolean);
  const out: DomainAuth[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(unique.slice(i, i + CONCURRENCY).map(checkDomainAuth))));
  }
  return out;
}
