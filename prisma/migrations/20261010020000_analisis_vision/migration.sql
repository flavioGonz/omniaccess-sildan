-- Verificación de intrusión y análisis de las fotos de lecturas LPR (omni-vision).
ALTER TABLE "Detection" ADD COLUMN "verifEstado" TEXT;
ALTER TABLE "Detection" ADD COLUMN "verifAnalisis" JSONB;
ALTER TABLE "Detection" ADD COLUMN "verifAt" TIMESTAMP(3);
ALTER TABLE "Detection" ADD COLUMN "verifMs" INTEGER;
ALTER TABLE "Detection" ADD COLUMN "verifError" TEXT;

CREATE TABLE "AnalisisFoto" (
    "id" TEXT NOT NULL,
    "accessEventId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "analisis" JSONB,
    "ms" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalisisFoto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalisisFoto_accessEventId_key" ON "AnalisisFoto"("accessEventId");
CREATE INDEX "AnalisisFoto_createdAt_idx" ON "AnalisisFoto"("createdAt");
