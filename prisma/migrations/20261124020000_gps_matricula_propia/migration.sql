-- La matricula del vehiculo que lleva el rastreador, escrita en el propio rastreador (24/11).
-- Antes solo se podia atar a un vehiculo del padron, y el padron obliga a que el vehiculo sea de
-- una persona: para rastrear una camioneta de la empresa habia que inventarle un residente.
ALTER TABLE "GpsEquipo" ADD COLUMN "matricula" TEXT;
-- Los que ya estaban atados conservan su matricula.
UPDATE "GpsEquipo" g SET "matricula" = UPPER(REGEXP_REPLACE(v."plate", '[^0-9A-Za-z]', '', 'g')) FROM "Vehicle" v WHERE g."vehicleId" = v."id";
