-- AlterEnum
ALTER TYPE "DeviceType" ADD VALUE 'LPR_INTERIOR';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "rtspUrl" TEXT,
ADD COLUMN     "trackEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trackScene" DOUBLE PRECISION;
