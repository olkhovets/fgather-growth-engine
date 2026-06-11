-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "builderPrefsJson" TEXT;

-- AlterTable
ALTER TABLE "ErrorReport" ALTER COLUMN "resolvedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "notifiedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PromptExperiment" ALTER COLUMN "updatedAt" DROP DEFAULT;
