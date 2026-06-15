/**
 * Persona search variants. The Apollo autopilot rotates through these, swapping the title set on
 * the workspace's saved search each pull, so consecutive pulls reach DIFFERENT people instead of
 * re-scraping one exhausted query. Same locations / industries / company sizes from the saved
 * search; only person_titles change. Each lead is tagged with its persona key for tailored copy.
 */
export type Persona = { key: string; label: string; titles: string[] };

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
