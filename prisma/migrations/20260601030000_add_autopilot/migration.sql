-- Autopilot flag: when true, the daily orchestrator generates AND sends without manual approval
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "autopilot" BOOLEAN NOT NULL DEFAULT false;
