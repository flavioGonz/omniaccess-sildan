-- Días especiales de las filas (feriados u horario distinto). HB, 19/10.
CREATE TABLE "QueueDiaEspecial" (
    "id" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "deviceId" TEXT,
    "cerrada" BOOLEAN NOT NULL DEFAULT true,
    "openTime" TEXT,
    "closeTime" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QueueDiaEspecial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QueueDiaEspecial_fecha_idx" ON "QueueDiaEspecial"("fecha");
