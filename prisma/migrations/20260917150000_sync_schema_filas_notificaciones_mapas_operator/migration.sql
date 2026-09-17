-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceBrand" ADD VALUE 'BOSCH';
ALTER TYPE "DeviceBrand" ADD VALUE 'AXIS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceType" ADD VALUE 'NVR';
ALTER TYPE "DeviceType" ADD VALUE 'QUEUE_COUNTER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'BLACKLISTED';
ALTER TYPE "UserRole" ADD VALUE 'WHITELISTED';
ALTER TYPE "UserRole" ADD VALUE 'SECURITY';
ALTER TYPE "UserRole" ADD VALUE 'OPERATOR';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "floorPlanId" TEXT,
ADD COLUMN     "mapX" DOUBLE PRECISION,
ADD COLUMN     "mapY" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blacklistReason" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "observations" TEXT,
ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "FloorPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEvent" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,
    "channelName" TEXT,
    "channelId" INTEGER,
    "peopleCount" INTEGER NOT NULL,
    "regionId" TEXT,
    "snapshotPath" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueAlert" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceId" TEXT,
    "channelName" TEXT,
    "threshold" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMin" INTEGER NOT NULL DEFAULT 5,
    "cooldownSec" INTEGER,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingRegistration" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "guardName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "alertId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceId" TEXT,
    "daysOfWeek" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    "openTime" TEXT NOT NULL DEFAULT '08:00',
    "closeTime" TEXT NOT NULL DEFAULT '20:00',
    "resetOnOpen" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraOutage" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "lastValue" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraOutage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deviceId" TEXT,
    "channelName" TEXT,
    "metric" TEXT NOT NULL DEFAULT 'aforo',
    "operator" TEXT NOT NULL DEFAULT '>=',
    "threshold" INTEGER NOT NULL DEFAULT 1,
    "daysOfWeek" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    "startTime" TEXT NOT NULL DEFAULT '00:00',
    "endTime" TEXT NOT NULL DEFAULT '23:59',
    "channels" TEXT NOT NULL DEFAULT 'telegram',
    "minSeverity" TEXT,
    "cooldownSec" INTEGER NOT NULL DEFAULT 60,
    "dedupe" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "ruleId" TEXT,
    "deviceId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "bullJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "time" TEXT NOT NULL DEFAULT '22:00',
    "dayOfWeek" INTEGER NOT NULL DEFAULT 7,
    "period" TEXT NOT NULL DEFAULT 'daily',
    "deviceId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceHealthSample" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reachable" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "memPct" INTEGER,
    "uptimeSec" INTEGER,
    "driftSec" INTEGER,
    "disksOk" BOOLEAN,
    "viewers" INTEGER,

    CONSTRAINT "DeviceHealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAlert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DeviceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateWatch" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'negra',
    "color" TEXT,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueEvent_deviceId_idx" ON "QueueEvent"("deviceId");

-- CreateIndex
CREATE INDEX "QueueEvent_timestamp_idx" ON "QueueEvent"("timestamp");

-- CreateIndex
CREATE INDEX "QueueEvent_deviceId_channelName_idx" ON "QueueEvent"("deviceId", "channelName");

-- CreateIndex
CREATE INDEX "QueueAlert_deviceId_idx" ON "QueueAlert"("deviceId");

-- CreateIndex
CREATE INDEX "NotificationChannel_type_idx" ON "NotificationChannel"("type");

-- CreateIndex
CREATE INDEX "NotificationLog_channelId_idx" ON "NotificationLog"("channelId");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");

-- CreateIndex
CREATE INDEX "CameraOutage_deviceId_idx" ON "CameraOutage"("deviceId");

-- CreateIndex
CREATE INDEX "CameraOutage_startedAt_idx" ON "CameraOutage"("startedAt");

-- CreateIndex
CREATE INDEX "CameraOutage_deviceId_endedAt_idx" ON "CameraOutage"("deviceId", "endedAt");

-- CreateIndex
CREATE INDEX "NotificationRule_enabled_idx" ON "NotificationRule"("enabled");

-- CreateIndex
CREATE INDEX "NotificationRule_deviceId_idx" ON "NotificationRule"("deviceId");

-- CreateIndex
CREATE INDEX "DispatchJob_status_idx" ON "DispatchJob"("status");

-- CreateIndex
CREATE INDEX "DispatchJob_type_idx" ON "DispatchJob"("type");

-- CreateIndex
CREATE INDEX "DispatchJob_scheduledAt_idx" ON "DispatchJob"("scheduledAt");

-- CreateIndex
CREATE INDEX "DispatchJob_createdAt_idx" ON "DispatchJob"("createdAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_enabled_idx" ON "ReportSchedule"("enabled");

-- CreateIndex
CREATE INDEX "DeviceHealthSample_deviceId_ts_idx" ON "DeviceHealthSample"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "DeviceAlert_active_idx" ON "DeviceAlert"("active");

-- CreateIndex
CREATE INDEX "DeviceAlert_deviceId_idx" ON "DeviceAlert"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlateWatch_plate_key" ON "PlateWatch"("plate");

-- CreateIndex
CREATE INDEX "AccessEvent_plateDetected_timestamp_idx" ON "AccessEvent"("plateDetected", "timestamp");

-- CreateIndex
CREATE INDEX "AccessEvent_timestamp_idx" ON "AccessEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueAlert" ADD CONSTRAINT "QueueAlert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

