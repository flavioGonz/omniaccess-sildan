-- Gestión de alarmas: quién atendió una alarma que no tiene dónde guardarlo. Las de intrusión
-- (Detection.acknowledged) y los avisos (AvisoGuardia.atendidoAt) ya lo guardan en su fila; una
-- lectura de lista negra o en búsqueda es un AccessEvent, que no se toca.
CREATE TABLE "AlarmaAtendida" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "resultado" TEXT,
    "nota" TEXT,
    "por" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlarmaAtendida_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AlarmaAtendida_clave_key" ON "AlarmaAtendida"("clave");
CREATE INDEX "AlarmaAtendida_ts_idx" ON "AlarmaAtendida"("ts");
