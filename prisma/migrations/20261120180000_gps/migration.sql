-- Rastreadores GPS (gps-receiver.js): el ultimo estado de cada uno y su recorrido.
CREATE TABLE "GpsEquipo" (
    "imei" TEXT NOT NULL,
    "nombre" TEXT,
    "deviceId" TEXT,
    "vehicleId" TEXT,
    "protocolo" TEXT NOT NULL DEFAULT 'GT06',
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "velocidad" INTEGER,
    "rumbo" INTEGER,
    "cuando" TIMESTAMP(3),
    "encendido" BOOLEAN,
    "bateria" INTEGER,
    "senal" INTEGER,
    "ultimoLatido" TIMESTAMP(3),
    "ultimaIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GpsEquipo_pkey" PRIMARY KEY ("imei")
);

CREATE TABLE "GpsPosicion" (
    "id" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "cuando" TIMESTAMP(3) NOT NULL,
    "llego" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "velocidad" INTEGER NOT NULL,
    "rumbo" INTEGER NOT NULL,
    "satelites" INTEGER NOT NULL,
    "encendido" BOOLEAN,
    "alarma" INTEGER,
    CONSTRAINT "GpsPosicion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GpsPosicion_imei_cuando_idx" ON "GpsPosicion"("imei", "cuando");
