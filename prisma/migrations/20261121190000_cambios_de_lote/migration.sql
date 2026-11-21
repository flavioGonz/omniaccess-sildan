-- La auditoría de cada lote: qué cambió (matrículas, gente, censo, código) y la última foto de
-- cada lote contra la que se compara. Sólo agrega tablas: no toca ninguna fila existente.
CREATE TABLE "CambioLote" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "cuando" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "que" TEXT NOT NULL,
    "chapa" TEXT,
    "persona" TEXT,
    "userId" TEXT,
    "quien" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'sistema',
    "detalle" TEXT,

    CONSTRAINT "CambioLote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoteEstado" (
    "unitId" TEXT NOT NULL,
    "personas" JSONB NOT NULL DEFAULT '[]',
    "chapas" JSONB NOT NULL DEFAULT '[]',
    "vistoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoteEstado_pkey" PRIMARY KEY ("unitId")
);

CREATE INDEX "CambioLote_unitId_cuando_idx" ON "CambioLote"("unitId", "cuando");
CREATE INDEX "CambioLote_cuando_idx" ON "CambioLote"("cuando");
CREATE INDEX "CambioLote_chapa_idx" ON "CambioLote"("chapa");

ALTER TABLE "CambioLote" ADD CONSTRAINT "CambioLote_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoteEstado" ADD CONSTRAINT "LoteEstado_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
