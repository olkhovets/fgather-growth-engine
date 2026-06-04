-- Activity log, custom prompt instructions, autopilot daily limit

ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "customInstructions"  TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "autopilotDailyLimit" INTEGER NOT NULL DEFAULT 200;

CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "message"     TEXT NOT NULL,
  "metaJson"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ActivityLog_workspaceId_createdAt_idx"
  ON "ActivityLog"("workspaceId", "createdAt");
