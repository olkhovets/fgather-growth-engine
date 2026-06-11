/**
 * Curated default experiment variants so the Experiments page has something to test
 * on day one (before the Claude-powered generator has run). Three per dimension, which
 * matches TARGET_ACTIVE_PER_DIMENSION in experiment-agents.ts. Seeded as status "testing".
 */
export const DEFAULT_EXPERIMENT_VARIANTS: Array<{
  dimension: "subject" | "hook" | "cta" | "incentive";
  label: string;
  instruction: string;
  hypothesis: string;
}> = [
  // Subject lines
  { dimension: "subject", label: "Curiosity gap", instruction: "Open a curiosity gap about their specific situation without revealing the answer. 6-10 words, no punctuation.", hypothesis: "Curiosity drives opens better than value-statement subjects." },
  { dimension: "subject", label: "Company named", instruction: "Put the recipient's company name in the subject with a specific, true observation about them.", hypothesis: "Naming the company signals real research and lifts opens." },
  { dimension: "subject", label: "Blunt question", instruction: "Make the subject a blunt, specific question about their research or creative process.", hypothesis: "A direct question feels human and earns a reply." },

  // Opening hooks
  { dimension: "hook", label: "Pain-first", instruction: "Open on a sharp, specific pain this person feels in their job right now, before mentioning anything about us.", hypothesis: "Leading with their pain out-converts leading with our product." },
  { dimension: "hook", label: "Pattern interrupt", instruction: "Open with an unexpected, mildly contrarian statement that stops the scroll.", hypothesis: "A pattern interrupt beats a polite opener for reply rate." },
  { dimension: "hook", label: "Peer proof", instruction: "Open by referencing a recognizable peer brand's result to create instant relevance.", hypothesis: "Peer proof up top earns attention from brand marketers." },

  // CTAs
  { dimension: "cta", label: "Conditional soft ask", instruction: "Close with a low-friction conditional ask, e.g. 'worth 20 minutes?'", hypothesis: "A soft conditional ask gets more replies than a hard meeting ask." },
  { dimension: "cta", label: "Specific time", instruction: "Ask for a specific small commitment, e.g. 'open to a quick call Thursday?'", hypothesis: "Naming a time reduces decision friction." },
  { dimension: "cta", label: "Confident breakup", instruction: "Close with a confident, low-pressure ask that implies you'll happily move on if the timing is off.", hypothesis: "Takeaway energy out-pulls eager asks." },

  // Incentives (rotate the brand to learn what lands — be generous)
  { dimension: "incentive", label: "Uber Eats $100", instruction: "Offer a $100 Uber Eats card for a 20-minute call, framed as 'for your time'. No link.", hypothesis: "Uber Eats reads as a premium, easy-to-use thank-you." },
  { dimension: "incentive", label: "DoorDash $100", instruction: "Offer a $100 DoorDash card for a 20-minute call, framed as 'for your time'. No link.", hypothesis: "DoorDash has broad appeal across markets." },
  { dimension: "incentive", label: "Amazon $100", instruction: "Offer a $100 Amazon gift card for a 20-minute call, framed as 'for your time'. No link.", hypothesis: "Amazon is universally useful and low-friction to redeem." },
];
