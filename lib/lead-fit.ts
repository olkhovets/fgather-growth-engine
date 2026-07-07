/**
 * Lead FIT scorer — the targeting gate. The best email in the world still gets no reply from a
 * wrong-fit lead, and Gather's ICP is specific: B2C MARKETING leaders at CONSUMER brands (food,
 * beverage, beauty, fashion, retail, CPG, DTC, consumer apps). Persona (a title bucket) alone
 * doesn't capture this — a "brand-social" person at a cybersecurity company is off-ICP.
 *
 * This scores each lead on two deterministic axes and combines them into a tier:
 *   - titleFit:   is this a B2C marketing decision-maker (CMO/VP Marketing/Brand/Insights/Growth…)?
 *   - companyFit: is the company a B2C consumer brand vs a clear B2B/tech/finance/etc. shop?
 *
 * Free (no API). Used to gate + rank who we actually send to. Missing data is treated as "maybe",
 * never "off" — we only exclude on a CLEAR wrong-fit signal, so sparse leads aren't thrown away.
 */

export type FitTier = "core" | "maybe" | "off";
export type LeadFit = { score: number; tier: FitTier; reasons: string[] };

// Strong B2C consumer-brand verticals — these are the ICP.
const CONSUMER_SIGNALS = [
  "consumer", "cpg", "consumer packaged goods", "fmcg", "retail", "ecommerce", "e-commerce", "dtc",
  "direct to consumer", "d2c", "food", "beverage", "restaurant", "grocery", "snack", "bakery", "coffee",
  "beauty", "cosmetics", "skincare", "personal care", "makeup", "fragrance", "fashion", "apparel",
  "clothing", "footwear", "accessories", "luxury", "jewelry", "home goods", "furniture", "home decor",
  "wellness", "fitness", "supplements", "nutrition", "pet", "toys", "baby", "lifestyle", "hospitality",
  "travel", "outdoor", "sporting goods", "wine", "spirits", "brewery", "cannabis", "candle", "footwear",
];
// Clear NON-ICP (B2B / tech / regulated / heavy industry) — a marketing leader here is off-fit for Gather.
const B2B_SIGNALS = [
  "saas", "software", "b2b", "information technology", "it services", "cybersecurity", "security",
  "cloud", "devtools", "developer tools", "fintech", "banking", "insurance", "financial services",
  "healthcare", "pharmaceutical", "biotech", "medical device", "manufacturing", "industrial",
  "logistics", "supply chain", "construction", "real estate", "oil", "energy", "utilities", "aerospace",
  "defense", "government", "public sector", "education", "university", "nonprofit", "staffing",
  "recruiting", "consulting", "law", "legal", "accounting", "telecommunications", "semiconductor",
  "data center", "enterprise software", "hr software", "martech", "adtech", "analytics platform",
];
// Titles that ARE the buyer — marketing / brand / insights / growth decision-makers.
const MKTG_TITLE_STRONG = [
  "chief marketing", "cmo", "vp marketing", "vp of marketing", "vice president of marketing",
  "head of marketing", "director of marketing", "marketing director", "svp marketing",
  "brand director", "director of brand", "head of brand", "vp brand", "chief brand",
  "head of growth", "vp growth", "head of insights", "vp insights", "consumer insights",
  "customer insights", "head of content", "head of social", "head of ecommerce", "director of ecommerce",
  "head of dtc", "chief growth",
];
const MKTG_TITLE_MID = [
  "marketing manager", "brand manager", "growth marketing", "content marketing", "social media",
  "product marketing", "demand generation", "demand gen", "lifecycle marketing", "marketing lead",
  "campaign manager", "creative director", "marketing", "brand", "growth", "content", "ecommerce",
];
// Titles that are clearly NOT the buyer (dampen fit even at a consumer brand).
const NON_BUYER_TITLE = [
  "engineer", "developer", "software", "sales", "account executive", "sdr", "bdr", "recruiter",
  "human resources", "people ops", "finance", "accountant", "controller", "operations manager",
  "supply chain", "logistics", "legal", "counsel", "it ", "information technology", "data engineer",
  "customer support", "customer success", "product manager", "designer", "administrative",
];

const has = (hay: string, needles: string[]) => needles.some((n) => hay.includes(n));

export function scoreLeadFit(lead: {
  jobTitle?: string | null;
  company?: string | null;
  industry?: string | null;
  vertical?: string | null;
}): LeadFit {
  const title = (lead.jobTitle || "").toLowerCase();
  const co = `${lead.industry || ""} ${lead.vertical || ""} ${lead.company || ""}`.toLowerCase();
  const reasons: string[] = [];

  // --- company axis (0 unknown / +50 consumer / -50 clear B2B) ---
  let companyScore = 20; // neutral when we can't tell — don't punish sparse data
  if (has(co, CONSUMER_SIGNALS)) { companyScore = 50; reasons.push("consumer brand"); }
  else if (has(co, B2B_SIGNALS)) { companyScore = 0; reasons.push("B2B/off-ICP company"); }

  // --- title axis (0 non-buyer / +25 mid / +40 strong marketing leader) ---
  let titleScore = 15; // neutral when title is blank/ambiguous
  if (has(title, MKTG_TITLE_STRONG)) { titleScore = 40; reasons.push("marketing decision-maker"); }
  else if (has(title, NON_BUYER_TITLE) && !has(title, MKTG_TITLE_STRONG)) { titleScore = 0; reasons.push("non-marketing title"); }
  else if (has(title, MKTG_TITLE_MID)) { titleScore = 25; reasons.push("marketing role"); }

  const score = Math.min(100, companyScore + titleScore);

  // Tier: core = clear consumer brand + a real marketing buyer. off = any clear wrong-fit signal.
  let tier: FitTier;
  if (companyScore === 0 || titleScore === 0) tier = "off";          // a clear B2B company OR a non-buyer title
  else if (companyScore >= 50 && titleScore >= 25) tier = "core";     // consumer brand + marketing buyer
  else tier = "maybe";                                               // partial signal / sparse data

  return { score, tier, reasons };
}

export const FIT_TIER_LABEL: Record<FitTier, string> = {
  core: "Core ICP", maybe: "Maybe", off: "Off-ICP",
};
