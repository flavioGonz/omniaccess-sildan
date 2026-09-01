-- AlterEnum
ALTER TYPE "CredentialType" ADD VALUE 'PASSWORD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceType" ADD VALUE 'ACCESS_CONTROL';
ALTER TYPE "DeviceType" ADD VALUE 'DOOR_INTERCOM';

-- CreateTable
CREATE TABLE "Bitacora" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "plate" TEXT,
    "photoPath" TEXT,
    "notes" TEXT,
    "name" TEXT,
    "dni" TEXT,
    "company" TEXT,
    "destination" TEXT,
    "guardName" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "audioPath" TEXT,
    "accessEventId" TEXT,

    CONSTRAINT "Bitacora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallEvent" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "deviceId" TEXT NOT NULL,
    "callerName" TEXT,
    "callerId" TEXT,
    "calleeName" TEXT,
    "calleeId" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HardwareMirror" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "hardwareId" TEXT NOT NULL,
    "name" TEXT,
    "cardCode" TEXT,
    "pin" TEXT,
    "faceUrl" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'IN_SYNC',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HardwareMirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "phoneNumber" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("phoneNumber")
);

-- CreateTable
CREATE TABLE "WahaRequestLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromNumber" TEXT NOT NULL,
    "messageBody" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseDetails" TEXT,

    CONSTRAINT "WahaRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bitacora_accessEventId_key" ON "Bitacora"("accessEventId");

-- CreateIndex
CREATE UNIQUE INDEX "HardwareMirror_deviceId_hardwareId_key" ON "HardwareMirror"("deviceId", "hardwareId");

-- AddForeignKey
ALTER TABLE "Bitacora" ADD CONSTRAINT "Bitacora_accessEventId_fkey" FOREIGN KEY ("accessEventId") REFERENCES "AccessEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallEvent" ADD CONSTRAINT "CallEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HardwareMirror" ADD CONSTRAINT "HardwareMirror_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
