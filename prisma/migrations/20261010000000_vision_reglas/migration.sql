-- Analíticas con reglas (conteo por línea, sentido contrario, permanencia, aglomeración) y
-- empresa por rotulado. Las reglas viven en Setting VISION_REGLAS; lo que pasó, acá.

-- Lo que omni-vision leyó escrito en un vehículo (rotulado), para cruzarlo con el catálogo de
-- empresas al mostrarlo: así un alias nuevo en el catálogo vale también para lo ya visto.
ALTER TABLE "ObjetoVisto" ADD COLUMN "textos" JSONB;

-- Un hecho de una regla: un cruce (conteo), un sentido contrario, una permanencia larga o una
-- aglomeración. Los cruces son muchos y livianos (sin foto); los demás llevan foto y aviso.
CREATE TABLE "EventoVision" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "reglaId" TEXT NOT NULL,
    "deviceId" TEXT,
    "camara" TEXT NOT NULL,
    "clase" TEXT,
    "pista" INTEGER,
    "sentido" TEXT,
    "valor" DOUBLE PRECISION,
    "foto" TEXT,
    "caja" JSONB,
    "avisoId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventoVision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventoVision_reglaId_ts_idx" ON "EventoVision"("reglaId", "ts");
CREATE INDEX "EventoVision_tipo_ts_idx" ON "EventoVision"("tipo", "ts");
