/**
 * Persona search variants. The Apollo autopilot rotates through these, swapping the title set on
 * the workspace's saved search each pull, so consecutive pulls reach DIFFERENT people instead of
 * re-scraping one exhausted query. Same locations / industries / company sizes from the saved
 * search; only person_titles change. Each lead is tagged with its persona key for tailored copy.
 */
export type Persona = { key: string; label: string; titles: string[] };

/**
 * Classify a lead's actual job title into one of the persona buckets, so we can tag leads for
 * tailored copy + per-persona reporting WITHOUT narrowing the Apollo search (we pull the full
 * variety of titles, then bucket each person by what they actually are). Returns a persona key,
 * defaulting to "growth-general" when nothing else matches.
 */
export function personaForTitle(title: string | null | undefined): string {
  const t = (title || "").toLowerCase();
  if (!t) return "growth-general";
  if (/insight|research|analyt|intelligence|voice of customer/.test(t)) return "consumer-insights";
  if (/brand|social|content/.test(t)) return "brand-social";
  if (/product marketing|messaging|positioning/.test(t)) return "product-marketing";
  return "growth-general";
}

export const PERSONAS: Persona[] = [
  {
    key: "consumer-insights",
    label: "Consumer Insights",
    titles: [
      "VP Insights", "Director of Insights", "Head of Insights", "Consumer Insights Manager",
      "Consumer Insights Director", "VP Consumer Insights", "Head of Consumer Insights",
      "Customer Insights Director", "Head of Customer Insights", "Market Research Director",
      "VP Research", "Head of Research", "Director of Market Intelligence", "Strategic Insights Director",
    ],
  },
  {
    key: "brand-social",
    label: "Brand & Social",
    titles: [
      "Brand Director", "Director of Brand", "Head of Brand", "VP Brand", "Brand Manager",
      "Senior Brand Manager", "Brand Marketing Manager", "Social Media Director", "Head of Social",
      "Social Media Manager", "Director of Content", "Head of Content", "Content Marketing Manager",
    ],
  },
  {
    key: "product-marketing",
    label: "Product Marketing",
    titles: [
      "VP Product Marketing", "Director of Product Marketing", "Head of Product Marketing",
      "Product Marketing Manager", "Senior Product Marketing Manager", "Group Product Marketing Manager",
      "VP of Product Marketing", "Director of Messaging", "Head of Positioning",
    ],
  },
  {
    key: "growth-general",
    label: "Growth & General Marketing",
    titles: [
      "Chief Marketing Officer", "VP Marketing", "VP of Marketing", "Head of Marketing",
      "Marketing Director", "Director of Marketing", "Senior Marketing Manager", "Marketing Manager",
      "Head of Growth", "VP Growth", "Director of Growth", "Growth Marketing Manager",
      "Demand Generation Director", "Director of Consumer Marketing",
    ],
  },
];
