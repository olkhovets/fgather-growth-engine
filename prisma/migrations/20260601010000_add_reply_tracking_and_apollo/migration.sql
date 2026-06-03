-- Reply tracking + OOO re-queue on Lead, webhook/notify/Apollo config on Workspace

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "replyStatus" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "repliedAt"   TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "requeueAt"   TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "suppressed"  BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "webhookSecret"    TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "notifyEmail"      TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "apolloApiKey"     TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "apolloSearchJson" TEXT;
