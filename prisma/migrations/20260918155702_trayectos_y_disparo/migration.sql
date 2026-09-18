-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "trackTrigger" TEXT DEFAULT 'escena';

-- AlterTable
ALTER TABLE "PlateSighting" ADD COLUMN     "passId" TEXT,
ADD COLUMN     "reads" INTEGER;

-- CreateTable
CREATE TABLE "VehiclePass" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehiclePass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehiclePass_plate_startedAt_idx" ON "VehiclePass"("plate", "startedAt");

-- CreateIndex
CREATE INDEX "VehiclePass_startedAt_idx" ON "VehiclePass"("startedAt");

-- CreateIndex
CREATE INDEX "PlateSighting_passId_idx" ON "PlateSighting"("passId");

-- AddForeignKey
ALTER TABLE "PlateSighting" ADD CONSTRAINT "PlateSighting_passId_fkey" FOREIGN KEY ("passId") REFERENCES "VehiclePass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
