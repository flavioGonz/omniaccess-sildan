-- Alarm Hub (SIA DC-09): un tipo de equipo nuevo y tres tablas. Aditiva: no toca nada existente.
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'ALARM_HUB';

CREATE TABLE "CentralAlarma" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "modelo" TEXT NOT NULL DEFAULT 'generica',
    "cuenta" TEXT NOT NULL,
    "protocolo" TEXT NOT NULL DEFAULT 'SIA-DCS',
    "claveCifrada" TEXT,
    "modoClave" TEXT,
    "lanVpn" BOOLEAN NOT NULL DEFAULT false,
    "prueba" BOOLEAN NOT NULL DEFAULT false,
    "supervisionSeg" INTEGER NOT NULL DEFAULT 600,
    "estado" TEXT NOT NULL DEFAULT 'ESPERANDO',
    "ultimoMensajeAt" TIMESTAMP(3),
    "ipOrigen" TEXT,
    "transporte" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CentralAlarma_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CentralAlarma_deviceId_key" ON "CentralAlarma"("deviceId");
CREATE UNIQUE INDEX "CentralAlarma_cuenta_key" ON "CentralAlarma"("cuenta");
ALTER TABLE "CentralAlarma" ADD CONSTRAINT "CentralAlarma_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ZonaCentral" (
    "id" TEXT NOT NULL,
    "centralId" TEXT NOT NULL,
    "zona" INTEGER NOT NULL,
    "particion" INTEGER,
    "nombre" TEXT,
    "areaId" TEXT,
    "camaras" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tipo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZonaCentral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ZonaCentral_centralId_zona_key" ON "ZonaCentral"("centralId", "zona");
ALTER TABLE "ZonaCentral" ADD CONSTRAINT "ZonaCentral_centralId_fkey" FOREIGN KEY ("centralId") REFERENCES "CentralAlarma"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MensajeCentral" (
    "id" TEXT NOT NULL,
    "centralId" TEXT,
    "cuenta" TEXT,
    "ip" TEXT,
    "transporte" TEXT,
    "idMensaje" TEXT,
    "cifrado" BOOLEAN NOT NULL DEFAULT false,
    "seq" INTEGER,
    "crudo" TEXT NOT NULL,
    "datos" TEXT,
    "horaCentral" TIMESTAMP(3),
    "respuesta" TEXT,
    "error" TEXT,
    "eventos" JSONB,
    "detectionId" TEXT,
    "recibido" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MensajeCentral_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MensajeCentral_centralId_recibido_idx" ON "MensajeCentral"("centralId", "recibido");
CREATE INDEX "MensajeCentral_cuenta_seq_idx" ON "MensajeCentral"("cuenta", "seq");
CREATE INDEX "MensajeCentral_recibido_idx" ON "MensajeCentral"("recibido");
ALTER TABLE "MensajeCentral" ADD CONSTRAINT "MensajeCentral_centralId_fkey" FOREIGN KEY ("centralId") REFERENCES "CentralAlarma"("id") ON DELETE CASCADE ON UPDATE CASCADE;
