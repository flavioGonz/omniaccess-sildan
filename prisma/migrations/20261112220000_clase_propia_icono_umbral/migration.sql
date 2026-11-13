-- El ícono de cada clase entrenada y desde qué confianza se dibuja en el vivo. Sólo agrega.

-- AlterTable
ALTER TABLE "ClasePropia" ADD COLUMN "icono" TEXT,
ADD COLUMN "umbralPantalla" DOUBLE PRECISION NOT NULL DEFAULT 0.59;
