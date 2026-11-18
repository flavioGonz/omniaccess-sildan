-- Donde queda el lote, si la persona lo marcó. Nulo es lo normal: el censo no obliga a ubicarse.
ALTER TABLE "SolicitudPadron" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "SolicitudPadron" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
