-- Geocercas de forma libre, con horario y que avisan un solo sentido. Sólo agrega columnas: las
-- geocercas que ya existen siguen siendo círculos que vigilan siempre y avisan los dos cruces.
ALTER TABLE "GpsGeocerca" ADD COLUMN "puntos" JSONB;
ALTER TABLE "GpsGeocerca" ADD COLUMN "horario" JSONB;
ALTER TABLE "GpsGeocerca" ADD COLUMN "avisa" TEXT NOT NULL DEFAULT 'ambos';

-- Los enlaces para compartir la posición de un rastreador.
CREATE TABLE "GpsCompartido" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "venceAt" TIMESTAMP(3) NOT NULL,
    "conRecorrido" BOOLEAN NOT NULL DEFAULT true,
    "creadoPor" TEXT NOT NULL,
    "revocadoAt" TIMESTAMP(3),
    "vistas" INTEGER NOT NULL DEFAULT 0,
    "ultimaVista" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsCompartido_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GpsCompartido_token_key" ON "GpsCompartido"("token");
CREATE INDEX "GpsCompartido_imei_idx" ON "GpsCompartido"("imei");
