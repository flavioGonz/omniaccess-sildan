-- Geocercas de los rastreadores GPS.
CREATE TABLE "GpsGeocerca" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "radio" INTEGER NOT NULL,
    "imeis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GpsGeocerca_pkey" PRIMARY KEY ("id")
);
