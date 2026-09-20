-- CreateTable
CREATE TABLE "Franja" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nombre" TEXT,
    "esquinas" TEXT NOT NULL,
    "lugares" INTEGER NOT NULL DEFAULT 6,
    "vacio" TEXT,
    "vacioAt" TIMESTAMP(3),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Franja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ocupacion" (
    "id" TEXT NOT NULL,
    "franjaId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lugar" INTEGER NOT NULL,
    "plate" TEXT,
    "plateConf" DOUBLE PRECISION,
    "sightingId" TEXT,
    "desde" TIMESTAMP(3) NOT NULL,
    "hasta" TIMESTAMP(3) NOT NULL,
    "cerrada" BOOLEAN NOT NULL DEFAULT false,
    "avisado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ocupacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Franja_deviceId_key" ON "Franja"("deviceId");

-- CreateIndex
CREATE INDEX "Ocupacion_franjaId_lugar_cerrada_idx" ON "Ocupacion"("franjaId", "lugar", "cerrada");

-- CreateIndex
CREATE INDEX "Ocupacion_deviceId_cerrada_idx" ON "Ocupacion"("deviceId", "cerrada");

-- CreateIndex
CREATE INDEX "Ocupacion_plate_idx" ON "Ocupacion"("plate");

-- AddForeignKey
ALTER TABLE "Franja" ADD CONSTRAINT "Franja_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocupacion" ADD CONSTRAINT "Ocupacion_franjaId_fkey" FOREIGN KEY ("franjaId") REFERENCES "Franja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocupacion" ADD CONSTRAINT "Ocupacion_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
