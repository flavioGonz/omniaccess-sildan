-- Entrenamientos del detector propio (los corre scripts/entrenador.js).
CREATE TABLE "EntrenamientoDetector" (
    "id" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'EN_COLA',
    "cuando" TEXT NOT NULL DEFAULT 'noche',
    "parametros" JSONB NOT NULL,
    "conjunto" JSONB,
    "progreso" JSONB,
    "resultado" JSONB,
    "error" TEXT,
    "carpeta" TEXT,
    "pedidoPor" TEXT,
    "cancelar" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoAt" TIMESTAMP(3),
    "terminadoAt" TIMESTAMP(3),
    CONSTRAINT "EntrenamientoDetector_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EntrenamientoDetector_estado_createdAt_idx" ON "EntrenamientoDetector"("estado", "createdAt");
