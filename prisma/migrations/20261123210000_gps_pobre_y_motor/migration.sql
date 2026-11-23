-- Cada posicion dice si es «pobre» para SU equipo, en vez de compararse en cada lectura con un
-- numero de satelites unico (8), que se midio con un GT06 y dejaba afuera todas las de un TopFly.
ALTER TABLE "GpsPosicion" ADD COLUMN "pobre" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GpsPosicion" ADD COLUMN "motor" JSONB;
ALTER TABLE "GpsEquipo" ADD COLUMN "vin" TEXT;
ALTER TABLE "GpsEquipo" ADD COLUMN "odometro" INTEGER;
ALTER TABLE "GpsEquipo" ADD COLUMN "motor" JSONB;

-- Lo ya guardado: con la regla que valia cuando llego (8), salvo los TopFly, cuyo minimo es 4.
UPDATE "GpsPosicion" SET "pobre" = true
 WHERE "satelites" < CASE WHEN "imei" IN (SELECT "imei" FROM "GpsEquipo" WHERE "protocolo" = 'TOPFLY') THEN 4 ELSE 8 END;
