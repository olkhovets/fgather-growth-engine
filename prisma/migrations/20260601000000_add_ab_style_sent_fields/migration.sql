-- Add A/B testing, email style, and send tracking fields to Lead

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "abVariant"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "emailStyle"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "sentAt"      TIMESTAMP(3);
