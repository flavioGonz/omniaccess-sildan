-- Proveedores del lote con la entrada habilitada por matrícula, en sus días y horario (26/11).
ALTER TABLE "ServicioLote" ADD COLUMN "autorizado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServicioLote" ADD COLUMN "autorizadoPor" TEXT;
ALTER TABLE "ServicioLote" ADD COLUMN "autorizadoAt" TIMESTAMP(3);
CREATE INDEX "ServicioLote_chapa_autorizado_idx" ON "ServicioLote"("chapa", "autorizado");
