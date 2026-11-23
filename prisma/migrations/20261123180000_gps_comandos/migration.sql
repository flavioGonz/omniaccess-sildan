-- El historial de comandos a los rastreadores (23/11): que se mando, quien, y que contesto el equipo.
CREATE TABLE "GpsComando" (
    "id" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "respuesta" TEXT,
    "quedo" TEXT,
    "quien" TEXT NOT NULL,
    "cuando" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsComando_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GpsComando_imei_cuando_idx" ON "GpsComando"("imei", "cuando");
