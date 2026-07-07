/**
 * Brand-proof matching — the "we helped a brand like YOU" engine.
 *
 * The old pipeline injected the SAME generic 4-name stack ("Belk, Staples, Bagel Brands
 * and Empire Today") into every email regardless of who the lead was. A food-brand CMO and
 * a fashion retailer got the identical name-drop. That is the opposite of relevance, and the
 * 2026 reply-rate data is blunt about it: vertical-matched, signal-based proof roughly doubles
 * to 5x's replies vs. a generic list. This library fixes that — given a lead's category, it
 * picks the ONE Gather customer that actually looks like them and leads with that, so the proof
 * reads "a [their category] brand like you already does this," not "here are four logos."
 *
 * HONESTY: every customer + angle below is drawn from Gather's real, public customer list
 * (gatherhq.com, and lib/gather-defaults.ts). Angles are QUALITATIVE — what they use Gather for —
 * never invented metrics, ARR, or per-logo results. That keeps the hard "never fabricate" rule
 * intact while still being specific and relevant to the recipient.
 */

export type GatherCustomer = {
  name: string;
  /** Broad family for picking a same-family second name and for register. */
  family: "consumer" | "tech";
  /** Category tags matched against the lead's industry / vertical / company. */
  tags: string[];
  /** One honest, qualitative line on what THIS brand uses Gather for (no invented metrics). */
  angle: string;
};

/**
 * The canonical, source-of-truth customer set. Consumer brands are Gather's ICP proof;
 * the tech names are here so a tech-marketer lead gets a name they respect instead of a
 * consumer brand that reads as irrelevant to them.
 */
export const GATHER_CUSTOMERS: GatherCustomer[] = [
  {
    name: "Einstein Bros",
    family: "consumer",
    tags: ["food", "beverage", "restaurant", "qsr", "bakery", "cafe", "cpg", "snack", "grocery", "consumer packaged goods", "fmcg", "hospitality", "coffee"],
    angle: "tests campaigns and creative against real customers before spending media, so launches match what people actually want",
  },
  {
    name: "Belk",
    family: "consumer",
    tags: ["fashion", "apparel", "clothing", "department store", "retail", "beauty", "cosmetics", "accessories", "luxury", "style", "shoes", "footwear"],
    angle: "reads what shoppers actually want before a season, instead of guessing and finding out at the register",
  },
  {
    name: "Staples",
    family: "consumer",
    tags: ["retail", "ecommerce", "e-commerce", "office", "supplies", "omnichannel", "consumer", "shopping", "marketplace", "dtc", "direct to consumer"],
    angle: "gets real buyer answers in days to sharpen campaigns instead of waiting on a six-week study",
  },
  {
    name: "Empire Today",
    family: "consumer",
    tags: ["home", "home goods", "furniture", "flooring", "home services", "improvement", "decor", "interior", "appliances", "diy", "renovation"],
    angle: "validates messaging with real homeowners before the campaign runs, not after the spend",
  },
  {
    name: "Datadog",
    family: "tech",
    tags: ["tech", "saas", "software", "b2b", "developer", "devtools", "cloud", "platform", "infrastructure", "data", "analytics", "ai", "startup"],
    angle: "runs buyer and messaging research in-house in days rather than waiting months on an outside agency",
  },
  {
    name: "Fortinet",
    family: "tech",
    tags: ["security", "cybersecurity", "tech", "saas", "software", "enterprise", "network", "it", "infosec", "cyber"],
    angle: "gets grounded buyer answers fast instead of guessing what a technical audience actually cares about",
  },
  {
    name: "SailPoint",
    family: "tech",
    tags: ["identity", "security", "tech", "saas", "software", "enterprise", "iam", "b2b", "cloud", "governance"],
    angle: "pressure-tests positioning against real buyers before it goes into a campaign",
  },
  {
    name: "Envoy",
    family: "tech",
    tags: ["workplace", "saas", "software", "tech", "b2b", "hr", "facilities", "startup", "productivity", "office"],
    angle: "turns a messaging question into a validated answer in days, not a quarter",
  },
];

/** Synonym expansion so loose lead data ("apparel co", "DTC food") still lands on the right family. */
const SYNONYMS: Record<string, string[]> = {
  cpg: ["consumer packaged goods", "fmcg", "packaged", "food", "beverage"],
  dtc: ["direct to consumer", "d2c", "ecommerce", "consumer", "retail"],
  beauty: ["cosmetics", "skincare", "personal care", "makeup"],
  fashion: ["apparel", "clothing", "style", "footwear", "accessories"],
  food: ["beverage", "restaurant", "grocery", "snack", "qsr"],
  saas: ["software", "b2b", "tech", "platform", "cloud"],
  retail: ["ecommerce", "shopping", "omnichannel", "consumer", "store"],
  home: ["furniture", "decor", "home goods", "improvement", "appliances"],
};

export type BrandMatch = {
  primary: GatherCustomer;
  secondary: GatherCustomer | null;
  family: "consumer" | "tech";
  /** True when we matched on real signal; false when we fell back to the default consumer proof. */
  matched: boolean;
};

function normalize(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Pick the Gather customer that most resembles this lead. Scores each customer by how many of
 * its category tags (plus synonym expansions) appear in the lead's industry/vertical/company/persona.
 * Returns the best match as `primary`, a same-family runner-up as `secondary`, and whether the
 * match was real (vs. the safe consumer-brand default when the lead has no usable category signal).
 */
export function matchBrandProof(lead: {
  company?: string | null;
  industry?: string | null;
  vertical?: string | null;
  persona?: string | null;
}): BrandMatch {
  const hay = normalize(lead.industry, lead.vertical, lead.company, lead.persona);

  const scored = GATHER_CUSTOMERS.map((c) => {
    let score = 0;
    for (const tag of c.tags) {
      if (hay.includes(tag)) score += 2;
      const syns = SYNONYMS[tag];
      if (syns) for (const s of syns) if (hay.includes(s)) score += 1;
    }
    return { c, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  // No real signal → default to a consumer brand (Gather's ICP is B2C), rotating by company hash so
  // the whole unclassified pool doesn't get the identical name. Never a tech name on a blind guess.
  if (!best || best.score === 0) {
    const consumers = GATHER_CUSTOMERS.filter((c) => c.family === "consumer");
    const idx = Math.abs(hashString(lead.company ?? lead.persona ?? "x")) % consumers.length;
    const primary = consumers[idx];
    const secondary = consumers[(idx + 1) % consumers.length];
    return { primary, secondary, family: "consumer", matched: false };
  }

  const primary = best.c;
  // Secondary: the next-best in the SAME family (only surfaced for proof-stacking styles). Keeps the
  // pairing coherent (two consumer names, or two tech names) rather than food + cybersecurity.
  const secondary =
    scored.find((s) => s.c !== primary && s.c.family === primary.family && s.score > 0)?.c ??
    GATHER_CUSTOMERS.find((c) => c !== primary && c.family === primary.family) ??
    null;

  return { primary, secondary, family: primary.family, matched: true };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * The prompt block that forces the writer to use the MATCHED customer as the primary name-drop —
 * "a brand like you" — instead of the generic four-name stack. `allowStack` lets social-proof style
 * add the same-family second name; every other style uses exactly one.
 */
export function brandProofBlock(
  lead: { company?: string | null; industry?: string | null; vertical?: string | null; persona?: string | null },
  opts: { allowStack?: boolean } = {}
): string {
  const m = matchBrandProof(lead);
  const companyRef = lead.company?.trim() || "them";
  const familyWord = m.family === "consumer" ? "consumer brand" : "tech company";

  const lines = [
    `\n\n*** MATCHED PROOF FOR THIS LEAD (use THIS, not a generic list of logos) ***`,
    `The single most relevant Gather customer for ${companyRef} is ${m.primary.name} — a ${familyWord} in the same world as them. When you use proof, name ${m.primary.name} specifically and tie it to why it maps to ${companyRef}: ${m.primary.angle}.`,
    `Frame it as "a brand like you already does this," e.g. "${m.primary.name}, ${lead.company ? `same space as ${lead.company}, ` : ""}${m.primary.angle}."`,
  ];

  if (opts.allowStack && m.secondary) {
    lines.push(`If (and only if) the style stacks two names, add ${m.secondary.name} as the second — same family, keeps it coherent. Otherwise use ONE name only.`);
  } else {
    lines.push(`Use ${m.primary.name} as the ONE proof name. Do NOT stack multiple logos — one relevant name beats four irrelevant ones.`);
  }

  if (!m.matched) {
    lines.push(`(We could not read a clear category for this lead, so ${m.primary.name} is a safe consumer-brand default — keep the proof qualitative and do not claim they are in the exact same niche.)`);
  }

  return lines.join("\n");
}
