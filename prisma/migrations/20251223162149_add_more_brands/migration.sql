-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceBrand" ADD VALUE 'INTELBRAS';
ALTER TYPE "DeviceBrand" ADD VALUE 'DAHUA';
ALTER TYPE "DeviceBrand" ADD VALUE 'ZKTECO';
ALTER TYPE "DeviceBrand" ADD VALUE 'AVICAM';
ALTER TYPE "DeviceBrand" ADD VALUE 'MILESIGHT';
ALTER TYPE "DeviceBrand" ADD VALUE 'UNIFI';
ALTER TYPE "DeviceBrand" ADD VALUE 'UNIVIEW';
