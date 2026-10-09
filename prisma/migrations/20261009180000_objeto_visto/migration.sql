-- CreateTable
CREATE TABLE "ObjetoVisto" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "camara" TEXT NOT NULL,
    "clase" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "confianza" DOUBLE PRECISION NOT NULL,
    "primeraVez" TIMESTAMP(3) NOT NULL,
    "ultimaVez" TIMESTAMP(3) NOT NULL,
    "cuadros" INTEGER NOT NULL DEFAULT 1,
    "pista" INTEGER,
    "recorte" TEXT,
    "foto" TEXT,
    "caja" JSONB,
    "atributos" JSONB,
    "recorrido" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjetoVisto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObjetoVisto_primeraVez_idx" ON "ObjetoVisto"("primeraVez");

-- CreateIndex
CREATE INDEX "ObjetoVisto_deviceId_primeraVez_idx" ON "ObjetoVisto"("deviceId", "primeraVez");

-- CreateIndex
CREATE INDEX "ObjetoVisto_clase_primeraVez_idx" ON "ObjetoVisto"("clase", "primeraVez");
