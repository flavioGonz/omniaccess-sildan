-- Validación del conteo de filas: lo que contó una persona contra lo que dijo la cámara. HB, 20/10.
CREATE TABLE "ValidacionConteo" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "deviceId" TEXT NOT NULL,
    "momento" TIMESTAMP(3) NOT NULL,
    "fotoPath" TEXT,
    "camara" INTEGER NOT NULL,
    "humano" INTEGER NOT NULL,
    "usuario" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ValidacionConteo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ValidacionConteo_deviceId_momento_idx" ON "ValidacionConteo"("deviceId", "momento");
CREATE INDEX "ValidacionConteo_eventId_idx" ON "ValidacionConteo"("eventId");
