-- CreateTable
CREATE TABLE "TrackingSample" (
    "id" TEXT NOT NULL,
    "momento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gpuUso" INTEGER,
    "gpuMem" INTEGER,
    "gpuTemp" INTEGER,
    "gpuWatts" INTEGER,
    "cpuCont" DOUBLE PRECISION,
    "memCont" INTEGER,
    "camaras" INTEGER,
    "disparos" INTEGER,
    "lecturas" INTEGER,
    "descartes" INTEGER,
    "enGpu" BOOLEAN,

    CONSTRAINT "TrackingSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackingSample_momento_idx" ON "TrackingSample"("momento");
