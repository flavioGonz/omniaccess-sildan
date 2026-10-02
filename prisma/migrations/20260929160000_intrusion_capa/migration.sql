-- Intrusión: capa transversal a los 3 modos. No destructiva (IF NOT EXISTS) para
-- que se pueda aplicar sobre instancias vivas sin tocar lo existente.

-- Cámara: participa en intrusión y con qué geometría (JSON 0..1, igual que trackLine).
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "intrusionEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "intrusionGeometry" TEXT;

-- Eventos de cruce de línea / entrada-salida de zona.
CREATE TABLE IF NOT EXISTS "IntrusionEvent" (
    "id"           TEXT NOT NULL,
    "deviceId"     TEXT,
    "type"         TEXT NOT NULL,
    "regionId"     TEXT,
    "direction"    TEXT,
    "timestamp"    TIMESTAMP(3) NOT NULL,
    "snapshotPath" TEXT,
    "details"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntrusionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IntrusionEvent_deviceId_timestamp_idx" ON "IntrusionEvent"("deviceId", "timestamp");
CREATE INDEX IF NOT EXISTS "IntrusionEvent_timestamp_idx" ON "IntrusionEvent"("timestamp");

-- FK sólo si no existe ya (Postgres no tiene ADD CONSTRAINT IF NOT EXISTS antes de v9.6;
-- se envuelve en un bloque que la ignora si ya está).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'IntrusionEvent_deviceId_fkey'
    ) THEN
        ALTER TABLE "IntrusionEvent"
            ADD CONSTRAINT "IntrusionEvent_deviceId_fkey"
            FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
