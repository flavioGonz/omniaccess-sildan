/*
  Warnings:

  - You are about to drop the column `faceImagePath` on the `User` table. All the data in the column will be lost.
  - Made the column `phone` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('SEDAN', 'SUV', 'PICKUP', 'VAN', 'TRUCK', 'MOTORCYCLE');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('BARRIO', 'EDIFICIO', 'CASA');

-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('NONE', 'BASIC', 'DIGEST');

-- CreateEnum
CREATE TYPE "DoorStatus" AS ENUM ('OPEN', 'CLOSED', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CredentialType" ADD VALUE 'TAG';
ALTER TYPE "CredentialType" ADD VALUE 'PIN';
ALTER TYPE "CredentialType" ADD VALUE 'FINGERPRINT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'PROVIDER';
ALTER TYPE "UserRole" ADD VALUE 'TEMPORARY_VISITOR';

-- DropForeignKey
ALTER TABLE "AccessEvent" DROP CONSTRAINT "AccessEvent_deviceId_fkey";

-- AlterTable
ALTER TABLE "AccessEvent" ADD COLUMN     "accessType" "CredentialType",
ADD COLUMN     "details" TEXT,
ADD COLUMN     "direction" "DeviceDirection" NOT NULL DEFAULT 'ENTRY',
ADD COLUMN     "location" TEXT,
ADD COLUMN     "plateNumber" TEXT,
ADD COLUMN     "snapshotPath" TEXT,
ALTER COLUMN "deviceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "authType" "AuthType" NOT NULL DEFAULT 'BASIC',
ADD COLUMN     "brandLogo" TEXT,
ADD COLUMN     "deviceModel" TEXT,
ADD COLUMN     "doorStatus" "DoorStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "lastOnlinePull" TIMESTAMP(3),
ADD COLUMN     "lastOnlinePush" TIMESTAMP(3),
ADD COLUMN     "location" TEXT,
ADD COLUMN     "modelPhoto" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "address" TEXT,
ADD COLUMN     "adminPhone" TEXT,
ADD COLUMN     "coordinates" TEXT,
ADD COLUMN     "deviceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deviceType" TEXT,
ADD COLUMN     "floors" INTEGER,
ADD COLUMN     "number" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "type" "UnitType" NOT NULL DEFAULT 'EDIFICIO';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "faceImagePath",
ADD COLUMN     "accessTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cara" TEXT,
ADD COLUMN     "dni" TEXT,
ALTER COLUMN "phone" SET NOT NULL;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "type" "VehicleType" NOT NULL DEFAULT 'SEDAN';

-- CreateTable
CREATE TABLE "ParkingSlot" (
    "id" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "isOccupied" BOOLEAN NOT NULL DEFAULT false,
    "points" TEXT,
    "unitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParkingSlot_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_deviceId_fkey_v2" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSlot" ADD CONSTRAINT "ParkingSlot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
