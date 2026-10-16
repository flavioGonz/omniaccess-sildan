-- Quién opera cada alarma en vivo y la bitácora de su gestión (Nico, 16/10: «cuando un usuario
-- toma una alerta debe quedar registrado qué usuario la está operando; y un historial claro»).
ALTER TABLE "AlarmaAtendida" ADD COLUMN "operador" TEXT;
ALTER TABLE "AlarmaAtendida" ADD COLUMN "operadorDesde" TIMESTAMP(3);

CREATE TABLE "AlarmaGestion" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "deviceId" TEXT,
    "accion" TEXT NOT NULL,
    "por" TEXT,
    "detalle" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlarmaGestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AlarmaGestion_clave_ts_idx" ON "AlarmaGestion"("clave", "ts");
CREATE INDEX "AlarmaGestion_ts_idx" ON "AlarmaGestion"("ts");
