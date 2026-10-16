-- Lo que leyó cada cámara LPR según su propio registro (camara-log.js): para comparar con lo que
-- recibió OmniAccess por el evento y con lo que releyó OmniVision.
CREATE TABLE "LecturaCamara" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "picName" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "plate" TEXT,
    "pais" TEXT,
    "sentido" TEXT,
    "carril" INTEGER,
    "lista" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LecturaCamara_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LecturaCamara_deviceId_picName_key" ON "LecturaCamara"("deviceId", "picName");
CREATE INDEX "LecturaCamara_deviceId_ts_idx" ON "LecturaCamara"("deviceId", "ts");
CREATE INDEX "LecturaCamara_ts_idx" ON "LecturaCamara"("ts");
