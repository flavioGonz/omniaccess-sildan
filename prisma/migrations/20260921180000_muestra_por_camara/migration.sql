-- Una muestra por camara y por minuto del trabajo del lector.
--
-- Sin clave foranea a "Device" a proposito: el historial de rendimiento de una camara
-- tiene que sobrevivir a la baja de la camara. Por eso tambien se guarda "nombre".
CREATE TABLE "TrackingCamaraMuestra" (
    "id" TEXT NOT NULL,
    "momento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT NOT NULL,
    "nombre" TEXT,
    "disparos" INTEGER NOT NULL DEFAULT 0,
    "lecturas" INTEGER NOT NULL DEFAULT 0,
    "descartes" INTEGER NOT NULL DEFAULT 0,
    "fueraDeLinea" INTEGER NOT NULL DEFAULT 0,
    "frenados" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrackingCamaraMuestra_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrackingCamaraMuestra_momento_idx" ON "TrackingCamaraMuestra"("momento");
CREATE INDEX "TrackingCamaraMuestra_deviceId_momento_idx" ON "TrackingCamaraMuestra"("deviceId", "momento");
