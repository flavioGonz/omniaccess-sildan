-- Pantallas de fila (kiosco), cada una con dirección propia y token. HB, 20/10.
CREATE TABLE "PantallaFila" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tema" TEXT NOT NULL DEFAULT 'oscuro',
    "verEspera" BOOLEAN NOT NULL DEFAULT true,
    "verHora" BOOLEAN NOT NULL DEFAULT true,
    "mensaje" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PantallaFila_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PantallaFila_slug_key" ON "PantallaFila"("slug");
