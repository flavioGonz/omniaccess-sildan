-- Los clips pedidos con «Grabar» en el vivo pasan a ser tareas del servidor (src/lib/clips-grabados.ts):
-- se arman aunque se cierre la pestaña y quedan en la bandeja de quien los pidió. Sólo agrega una tabla.

-- CreateTable
CREATE TABLE "ClipGrabado" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "usuario" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'en-cola',
    "avance" JSONB,
    "tramos" JSONB NOT NULL,
    "rotulo" TEXT,
    "nombre" TEXT,
    "guardado" TEXT,
    "foto" TEXT,
    "segundos" INTEGER,
    "camaras" INTEGER,
    "salteados" INTEGER,
    "motivo" TEXT,
    "latido" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "oculto" BOOLEAN NOT NULL DEFAULT false,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminado" TIMESTAMP(3),

    CONSTRAINT "ClipGrabado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipGrabado_usuarioId_creado_idx" ON "ClipGrabado"("usuarioId", "creado");

-- CreateIndex
CREATE INDEX "ClipGrabado_estado_latido_idx" ON "ClipGrabado"("estado", "latido");
