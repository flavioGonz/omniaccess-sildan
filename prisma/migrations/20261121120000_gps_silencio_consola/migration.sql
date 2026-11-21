-- El rastreador: desde cuándo figura el motor como está, si se avisó que dejó de reportar, y de
-- qué lado de cada geocerca está (para que un reinicio del receptor no lo olvide).
ALTER TABLE "GpsEquipo" ADD COLUMN "encendidoDesde" TIMESTAMP(3);
ALTER TABLE "GpsEquipo" ADD COLUMN "sinReporteDesde" TIMESTAMP(3);
ALTER TABLE "GpsEquipo" ADD COLUMN "lados" JSONB;

-- El evento: cuándo llegó (distinto de cuándo pasó), cuánto se demoró, si es una alarma para la
-- consola y dónde fue en palabras.
ALTER TABLE "GpsEvento" ADD COLUMN "llego" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "GpsEvento" ADD COLUMN "tarde" INTEGER;
ALTER TABLE "GpsEvento" ADD COLUMN "prioridad" INTEGER;
ALTER TABLE "GpsEvento" ADD COLUMN "lugar" TEXT;
-- Los que ya estaban llegaron cuando pasaron, hasta donde se sabe.
UPDATE "GpsEvento" SET "llego" = "cuando";

CREATE INDEX "GpsEvento_cuando_idx" ON "GpsEvento"("cuando");

-- Los que ya estaban y son alarmas para la consola (la lista vive en lib-gps-eventos.js).
UPDATE "GpsEvento" SET "prioridad" = 1 WHERE "tipo" IN ('GPS_SOS', 'GPS_CORTE', 'GPS_DESARME');
UPDATE "GpsEvento" SET "prioridad" = 2 WHERE "tipo" = 'GPS_MOVIMIENTO';
UPDATE "GpsEvento" SET "prioridad" = 4 WHERE "tipo" IN ('GPS_BATERIA', 'GPS_VELOCIDAD', 'GPS_OTRA');
