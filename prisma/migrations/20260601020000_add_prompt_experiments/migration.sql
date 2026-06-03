-- Self-improving prompt engine: experiments registry + learnings + per-lead attribution

ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "learningsJson" TEXT;
ALTER TABLE "Lead"      ADD COLUMN IF NOT EXISTS "experimentIdsJson" TEXT;

CREATE TABLE IF NOT EXISTS "PromptExperiment" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "dimension"   TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "instruction" TEXT NOT NULL,
  "hypothesis"  TEXT,
  "status"      TEXT NOT NULL DEFAULT 'testing',
  "generation"  INTEGER NOT NULL DEFAULT 1,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromptExperiment_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PromptExperiment_workspaceId_dimension_status_idx"
  ON "PromptExperiment"("workspaceId", "dimension", "status");
