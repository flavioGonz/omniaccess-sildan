-- Detector propio: clases nuevas y fotos con recuadros para entrenarlo.
CREATE TABLE "ClasePropia" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClasePropia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FotoEntrenamiento" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "origen" TEXT NOT NULL,
    "deviceId" TEXT,
    "cajas" JSONB NOT NULL DEFAULT '[]',
    "revisada" BOOLEAN NOT NULL DEFAULT false,
    "revisadaPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FotoEntrenamiento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FotoEntrenamiento_revisada_createdAt_idx" ON "FotoEntrenamiento"("revisada", "createdAt");
