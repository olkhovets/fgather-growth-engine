-- Add structured landing page content per lead (generated at sequence-gen time)
ALTER TABLE "Lead" ADD COLUMN "landingPageContentJson" TEXT;

-- Add CTA URL per campaign (shown on personalized landing pages)
ALTER TABLE "Campaign" ADD COLUMN "ctaUrl" TEXT;
