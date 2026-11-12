-- Capturas programadas para el conjunto de entrenamiento (openspec capturas-programadas-entrenamiento). Sólo agrega.

-- AlterTable
ALTER TABLE "FotoEntrenamiento" ADD COLUMN "programaId" TEXT;

-- CreateTable
CREATE TABLE "CapturaProgramada" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "camaras" TEXT[],
    "cadaMin" INTEGER NOT NULL DEFAULT 30,
    "horario" JSONB,
    "tope" INTEGER NOT NULL DEFAULT 200,
    "hasta" TIMESTAMP(3),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "forzarAt" TIMESTAMP(3),
    "proximaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardadas" INTEGER NOT NULL DEFAULT 0,
    "salteadas" INTEGER NOT NULL DEFAULT 0,
    "estado" JSONB NOT NULL DEFAULT '{}',
    "terminada" TEXT,
    "creadaPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapturaProgramada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FotoEntrenamiento_programaId_revisada_idx" ON "FotoEntrenamiento"("programaId", "revisada");

-- CreateIndex
CREATE INDEX "CapturaProgramada_activa_proximaAt_idx" ON "CapturaProgramada"("activa", "proximaAt");
