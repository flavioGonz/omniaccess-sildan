-- CreateEnum
CREATE TYPE "InvitationKind" AS ENUM ('SINGLE', 'EVENT');

-- CreateEnum
CREATE TYPE "Reentry" AS ENUM ('SINGLE_USE', 'MULTI');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "GuestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- AlterEnum
ALTER TYPE "DeviceType" ADD VALUE 'CAMERA';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "port" INTEGER;

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "type" TEXT NOT NULL,
    "eventType" TEXT,
    "label" TEXT,
    "snapshotPath" TEXT,
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "ackKind" TEXT,
    "ackAt" TIMESTAMP(3),

    CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "hostUserId" TEXT,
    "hostUnitId" TEXT,
    "hostName" TEXT NOT NULL DEFAULT '',
    "hostLabel" TEXT NOT NULL DEFAULT '',
    "kind" "InvitationKind" NOT NULL DEFAULT 'SINGLE',
    "title" TEXT NOT NULL DEFAULT '',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "reentry" "Reentry" NOT NULL DEFAULT 'MULTI',
    "maxGuests" INTEGER,
    "status" "InvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "token" TEXT NOT NULL,
    "createdVia" TEXT NOT NULL DEFAULT 'GUARD',
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "doc" TEXT,
    "qrToken" TEXT NOT NULL,
    "status" "GuestStatus" NOT NULL DEFAULT 'APPROVED',
    "selfRegistered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestPlate" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,

    CONSTRAINT "GuestPlate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestEntry" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "accessEventId" TEXT,
    "gate" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'ENTRY',
    "method" TEXT NOT NULL DEFAULT 'LPR',
    "validatedBy" TEXT,
    "plate" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Detection_deviceId_timestamp_idx" ON "Detection"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "Detection_acknowledged_timestamp_idx" ON "Detection"("acknowledged", "timestamp");

-- CreateIndex
CREATE INDEX "Detection_timestamp_idx" ON "Detection"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_status_validTo_idx" ON "Invitation"("status", "validTo");

-- CreateIndex
CREATE INDEX "Invitation_hostUnitId_idx" ON "Invitation"("hostUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_qrToken_key" ON "Guest"("qrToken");

-- CreateIndex
CREATE INDEX "Guest_invitationId_idx" ON "Guest"("invitationId");

-- CreateIndex
CREATE INDEX "GuestPlate_plate_idx" ON "GuestPlate"("plate");

-- CreateIndex
CREATE INDEX "GuestPlate_guestId_idx" ON "GuestPlate"("guestId");

-- CreateIndex
CREATE INDEX "GuestEntry_invitationId_timestamp_idx" ON "GuestEntry"("invitationId", "timestamp");

-- CreateIndex
CREATE INDEX "GuestEntry_guestId_timestamp_idx" ON "GuestEntry"("guestId", "timestamp");

-- CreateIndex
CREATE INDEX "GuestEntry_timestamp_idx" ON "GuestEntry"("timestamp");

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPlate" ADD CONSTRAINT "GuestPlate_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestEntry" ADD CONSTRAINT "GuestEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

