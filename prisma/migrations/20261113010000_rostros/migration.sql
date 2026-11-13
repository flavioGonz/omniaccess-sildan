-- Identidad por rostro (modo face): cada cara nítida que no se parece a nadie funda un Rostro,
-- y sus pasadas se le suman. Sólo agrega.

-- CreateTable
CREATE TABLE "Rostro" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "sujeto" TEXT NOT NULL,
    "userId" TEXT,
    "apodo" TEXT,
    "foto" TEXT,
    "calidad" INTEGER NOT NULL DEFAULT 0,
    "primeraVez" TIMESTAMP(3) NOT NULL,
    "ultimaVez" TIMESTAMP(3) NOT NULL,
    "veces" INTEGER NOT NULL DEFAULT 1,
    "ultimaCamara" TEXT,
    "ejemplos" INTEGER NOT NULL DEFAULT 1,
    "parecidaA" TEXT,
    "parecido" DOUBLE PRECISION,
    "noEs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rostro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RostroPasada" (
    "id" TEXT NOT NULL,
    "rostroId" TEXT NOT NULL,
    "deviceId" TEXT,
    "camara" TEXT,
    "cuando" TIMESTAMP(3) NOT NULL,
    "similitud" DOUBLE PRECISION,
    "px" INTEGER,
    "prob" DOUBLE PRECISION,
    "cara" TEXT,
    "cuadro" TEXT,
    "eventoId" TEXT,

    CONSTRAINT "RostroPasada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rostro_numero_key" ON "Rostro"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Rostro_sujeto_key" ON "Rostro"("sujeto");

-- CreateIndex
CREATE INDEX "Rostro_ultimaVez_idx" ON "Rostro"("ultimaVez");

-- CreateIndex
CREATE INDEX "Rostro_userId_idx" ON "Rostro"("userId");

-- CreateIndex
CREATE INDEX "RostroPasada_rostroId_cuando_idx" ON "RostroPasada"("rostroId", "cuando");

-- CreateIndex
CREATE INDEX "RostroPasada_cuando_idx" ON "RostroPasada"("cuando");

-- AddForeignKey
ALTER TABLE "RostroPasada" ADD CONSTRAINT "RostroPasada_rostroId_fkey" FOREIGN KEY ("rostroId") REFERENCES "Rostro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

