-- Disparo sin vehículo: la cámara no leyó chapa y OmniVision no vio ningún vehículo en la foto.
ALTER TABLE "AccessEvent" ADD COLUMN "sinVehiculo" BOOLEAN NOT NULL DEFAULT false;

-- Los que ya están analizados.
UPDATE "AccessEvent" e SET "sinVehiculo" = true
FROM "Relectura" r
WHERE r."accessEventId" = e.id AND r.estado = 'SIN_VEHICULO'
  AND e."plateDetected" IN ('NO_LEIDA', 'UNKNOWN', 'unknown', 'S/P');

-- Para contarlos y listarlos solos sin recorrer la tabla.
CREATE INDEX "AccessEvent_sinVehiculo_timestamp_idx" ON "AccessEvent"("sinVehiculo", "timestamp");
