-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "incentivesDailyCap" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "incentivesIntervalMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "incentivesLastRunAt" TIMESTAMP(3),
ADD COLUMN     "incentivesPerRun" INTEGER NOT NULL DEFAULT 50;
