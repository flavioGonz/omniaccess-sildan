-- La chapa de un vehiculo quieto pasa a ser la mas leida (src/lib/votos-chapa.ts): se guardan los
-- votos de cada lectura en la estadia y en la ocupacion. Solo agrega; las filas viejas quedan en null.

-- AlterTable
ALTER TABLE "PlateSighting" ADD COLUMN "votos" JSONB;

-- AlterTable
ALTER TABLE "Ocupacion" ADD COLUMN "votos" JSONB;
