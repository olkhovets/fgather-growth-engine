CREATE TABLE "ErrorReport" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "userEmail"  TEXT NOT NULL,
  "context"    TEXT NOT NULL,
  "error"      TEXT NOT NULL,
  "extraJson"  TEXT,
  "resolved"   BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP,
  "notifiedAt" TIMESTAMP,
  "createdAt"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
