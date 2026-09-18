-- CreateTable
CREATE TABLE "PlateSighting" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "deviceId" TEXT,
    "cameraName" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LPR',
    "eventType" TEXT,
    "decision" TEXT,
    "confidence" DOUBLE PRECISION,
    "snapshotUrl" TEXT,
    "accessEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateSighting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlateSighting_accessEventId_key" ON "PlateSighting"("accessEventId");

-- CreateIndex
CREATE INDEX "PlateSighting_plate_timestamp_idx" ON "PlateSighting"("plate", "timestamp");

-- CreateIndex
CREATE INDEX "PlateSighting_timestamp_idx" ON "PlateSighting"("timestamp");

-- CreateIndex
CREATE INDEX "PlateSighting_deviceId_timestamp_idx" ON "PlateSighting"("deviceId", "timestamp");
