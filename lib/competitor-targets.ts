/**
 * Competitor-testimonial poaching targets. People/companies publicly praising a
 * competitor (Listen Labs, Outset, Evidenza, VoicePanel) already buy AI consumer
 * research — the warmest cold audience we can find. Seeded from public case
 * studies / reviews (2026-06-19); the loop expands this over time.
 *
 * Kept as code (not DB) so the Competitors tab + audience export work with no
 * migration. b2cFit flags Gather's true ICP (consumer brands) for prioritization.
 */

export type CompetitorCompany = { name: string; domain: string; competitor: string; b2cFit: boolean; note?: string };
export type CompetitorPerson = { name: string; title: string; company: string; competitor: string; angle: string };

export const COMPETITOR_COMPANIES: CompetitorCompany[] = [
  { name: "Away", domain: "awaytravel.com", competitor: "Outset", b2cFit: true, note: "Jennifer Lien ran 75 interviews on Outset" },
  { name: "Chubbies", domain: "chubbiesshorts.com", competitor: "Listen Labs", b2cFit: true, note: "24x research participation via Listen Labs" },
  { name: "Canva", domain: "canva.com", competitor: "Listen Labs", b2cFit: true },
  { name: "Mars", domain: "mars.com", competitor: "Evidenza", b2cFit: true },
  { name: "Indeed", domain: "indeed.com", competitor: "Outset", b2cFit: true, note: "Consumer Insights Sr. Manager praised Outset" },
  { name: "Glassdoor", domain: "glassdoor.com", competitor: "Outset", b2cFit: true },
  { name: "HubSpot", domain: "hubspot.com", competitor: "Outset", b2cFit: false },
  { name: "Microsoft", domain: "microsoft.com", competitor: "Listen Labs / Evidenza", b2cFit: false },
  { name: "Dentsu", domain: "dentsu.com", competitor: "Evidenza", b2cFit: false, note: "agency — many consumer brands" },
  { name: "Salesforce", domain: "salesforce.com", competitor: "Evidenza", b2cFit: false },
  { name: "BlackRock", domain: "blackrock.com", competitor: "Evidenza", b2cFit: false },
  { name: "JP Morgan", domain: "jpmorgan.com", competitor: "Evidenza", b2cFit: false },
  { name: "EY", domain: "ey.com", competitor: "Evidenza", b2cFit: false },
  { name: "Emerald Research Group", domain: "emeraldresearch.com", competitor: "Listen Labs", b2cFit: false },
  { name: "ServiceNow", domain: "servicenow.com", competitor: "Evidenza", b2cFit: false, note: "Jim Lesser publicly criticized Evidenza — warm" },
];

export const COMPETITOR_PEOPLE: CompetitorPerson[] = [
  { name: "Jennifer Lien", title: "Senior UX Researcher", company: "Away", competitor: "Outset", angle: "Ran 75 AI-moderated interviews overnight on Outset, set an add-to-cart record. Perfect B2C fit — show her Gather does the same, deeper." },
  { name: "Jim Lesser", title: "Brand Chief", company: "ServiceNow", competitor: "Evidenza", angle: "Publicly said NOT to work with Evidenza (wants to keep the research edge in-house). Gather gives the edge without the synthetic-data trust problem." },
  { name: "(find on LinkedIn)", title: "Consumer Insights Sr. Manager", company: "Indeed", competitor: "Outset", angle: "Quoted praising Outset; name not public. Find via LinkedIn — Insights title at Indeed." },
];

/** LinkedIn matched-audience company-list CSV (only needs company name — no Apollo). */
export function competitorAudienceCsv(b2cOnly = false): string {
  const rows = COMPETITOR_COMPANIES.filter((c) => !b2cOnly || c.b2cFit);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["companyname", "companywebsite", "source_competitor"].map(esc).join(",")];
  for (const c of rows) lines.push([c.name, c.domain, c.competitor].map(esc).join(","));
  return lines.join("\r\n");
}
