-- AlterTable
ALTER TABLE "PlateSighting" ADD COLUMN     "bbox" TEXT,
ADD COLUMN     "estDesde" TIMESTAMP(3),
ADD COLUMN     "estHasta" TIMESTAMP(3),
ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'PASO';

-- CreateIndex
CREATE INDEX "PlateSighting_estado_timestamp_idx" ON "PlateSighting"("estado", "timestamp");
