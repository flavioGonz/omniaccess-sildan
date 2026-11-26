-- Los proveedores de servicio de cada lote: jardinero, piscinero, limpieza (26/11). Identifican; no autorizan la entrada.
CREATE TABLE "ServicioLote" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'OTRO',
    "nombre" TEXT NOT NULL DEFAULT '',
    "telefono" TEXT,
    "documento" TEXT,
    "chapa" TEXT,
    "dias" JSONB NOT NULL DEFAULT '[]',
    "desde" TEXT,
    "hasta" TEXT,
    "notas" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "origen" TEXT NOT NULL DEFAULT 'panel',
    "creadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServicioLote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServicioLote_unitId_idx" ON "ServicioLote"("unitId");
CREATE INDEX "ServicioLote_chapa_idx" ON "ServicioLote"("chapa");
ALTER TABLE "ServicioLote" ADD CONSTRAINT "ServicioLote_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
