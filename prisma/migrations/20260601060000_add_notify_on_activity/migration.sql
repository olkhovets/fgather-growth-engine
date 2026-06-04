-- Email the operator on every activity-log event when enabled
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "notifyOnActivity" BOOLEAN NOT NULL DEFAULT false;
