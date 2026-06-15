-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "recycleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recycledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "recycleCooldownDays" INTEGER NOT NULL DEFAULT 21;
