-- Analíticas entrenables: zona fija clasificada en dos estados, con sus muestras.
CREATE TABLE "ZonaEntrenable" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "zona" JSONB NOT NULL,
    "positivo" TEXT NOT NULL,
    "negativo" TEXT NOT NULL,
    "frasesPositivo" TEXT[],
    "frasesNegativo" TEXT[],
    "cadaSeg" INTEGER NOT NULL DEFAULT 300,
    "sostenerSeg" INTEGER NOT NULL DEFAULT 900,
    "umbral" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "horario" JSONB,
    "avisar" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "modelo" JSONB,
    "estado" JSONB,
    "forzarAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ZonaEntrenable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MuestraZona" (
    "id" TEXT NOT NULL,
    "zonaId" TEXT NOT NULL,
    "recorte" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "escala" DOUBLE PRECISION NOT NULL,
    "prob" DOUBLE PRECISION,
    "fuente" TEXT NOT NULL,
    "etiqueta" TEXT,
    "etiquetadoPor" TEXT,
    "etiquetadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MuestraZona_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MuestraZona_zonaId_createdAt_idx" ON "MuestraZona"("zonaId", "createdAt");
CREATE INDEX "MuestraZona_zonaId_etiqueta_idx" ON "MuestraZona"("zonaId", "etiqueta");
ALTER TABLE "MuestraZona" ADD CONSTRAINT "MuestraZona_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "ZonaEntrenable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
