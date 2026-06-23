import { redirect } from "next/navigation";

/**
 * Legacy route. The offer (incentives) flow now lives inside Generate & send (the OfferLab is folded
 * into /dashboard/launch), so this page is just a redirect — kept so old links don't 404, without
 * rendering a duplicate copy of the same UI.
 */
export default function IncentivesPage() {
  redirect("/dashboard/launch");
}
