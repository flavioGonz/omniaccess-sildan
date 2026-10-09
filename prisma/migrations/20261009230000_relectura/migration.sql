-- Relectura de las NO_LEIDA: cuando la lectora de un acceso no lee la chapa, vision-worker
-- recorta el vehículo de la foto del evento y se la vuelve a pasar a omni-lpr. Una fila por
-- evento. Es una SUGERENCIA para el guardia: no cambia el evento ni lo que decidió la barrera.
CREATE TABLE "Relectura" (
    "id" TEXT NOT NULL,
    "accessEventId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "plate" TEXT,
    "confianza" DOUBLE PRECISION,
    "candidatos" JSONB,
    "vehiculo" TEXT,
    "vehiculos" INTEGER NOT NULL DEFAULT 0,
    "recorte" TEXT,
    "recorteChapa" TEXT,
    "ms" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Relectura_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Relectura_accessEventId_key" ON "Relectura"("accessEventId");
CREATE INDEX "Relectura_plate_idx" ON "Relectura"("plate");
CREATE INDEX "Relectura_createdAt_idx" ON "Relectura"("createdAt");
