-- Los eventos de los rastreadores GPS (alarmas del equipo y las deducidas).
CREATE TABLE "GpsEvento" (
    "id" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cuando" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "detalle" TEXT,
    CONSTRAINT "GpsEvento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GpsEvento_imei_cuando_idx" ON "GpsEvento"("imei", "cuando");
