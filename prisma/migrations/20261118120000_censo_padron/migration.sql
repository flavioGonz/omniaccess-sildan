-- El censo del barrio: lo que carga un residente desde el QR (pedido 18/11 de Nico, para la
-- asamblea). Es una bandeja de solicitudes, no padron: entra por una URL publica y sin sesion, y
-- nada toca al padron hasta que alguien la aprueba. Solo agrega una tabla.

CREATE TABLE "SolicitudPadron" (
    "id" TEXT NOT NULL,
    "sitio" TEXT NOT NULL DEFAULT '',
    "lote" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT '',
    "tenencia" TEXT NOT NULL DEFAULT 'PROPIETARIO',
    "telefono" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "vehiculos" JSONB NOT NULL DEFAULT '[]',
    "servicios" JSONB NOT NULL DEFAULT '[]',
    "comentario" TEXT NOT NULL DEFAULT '',
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "revisadaPor" TEXT,
    "revisadaAt" TIMESTAMP(3),
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolicitudPadron_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SolicitudPadron_estado_createdAt_idx" ON "SolicitudPadron"("estado", "createdAt");
CREATE INDEX "SolicitudPadron_lote_idx" ON "SolicitudPadron"("lote");
