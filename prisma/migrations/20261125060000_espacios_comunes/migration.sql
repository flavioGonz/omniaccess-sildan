-- Espacios comunes de cada administracion: el SUM, la piscina, canchas, parrilleros (25/11). Con sus
-- reservas y sus tareas de mantenimiento.
CREATE TABLE "EspacioComun" (
    "id" TEXT NOT NULL,
    "administracionId" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'OTRO',
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "capacidad" INTEGER,
    "horario" TEXT,
    "reglamento" TEXT,
    "inventario" TEXT,
    "responsable" TEXT,
    "reservable" BOOLEAN NOT NULL DEFAULT false,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "estadoNota" TEXT,
    "estadoAt" TIMESTAMP(3),
    "estadoPor" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EspacioComun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EspacioComun_administracionId_idx" ON "EspacioComun"("administracionId");
ALTER TABLE "EspacioComun" ADD CONSTRAINT "EspacioComun_administracionId_fkey" FOREIGN KEY ("administracionId") REFERENCES "Administracion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReservaEspacio" (
    "id" TEXT NOT NULL,
    "espacioId" TEXT NOT NULL,
    "unitId" TEXT,
    "lote" TEXT NOT NULL DEFAULT '',
    "responsable" TEXT NOT NULL,
    "telefono" TEXT,
    "motivo" TEXT,
    "invitados" INTEGER,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'CONFIRMADA',
    "nota" TEXT,
    "creadaPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReservaEspacio_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReservaEspacio_espacioId_inicio_idx" ON "ReservaEspacio"("espacioId", "inicio");
ALTER TABLE "ReservaEspacio" ADD CONSTRAINT "ReservaEspacio_espacioId_fkey" FOREIGN KEY ("espacioId") REFERENCES "EspacioComun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TareaEspacio" (
    "id" TEXT NOT NULL,
    "espacioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "detalle" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'MANTENIMIENTO',
    "prioridad" TEXT NOT NULL DEFAULT 'NORMAL',
    "responsable" TEXT,
    "vence" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "hechaAt" TIMESTAMP(3),
    "creadaPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TareaEspacio_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TareaEspacio_espacioId_estado_idx" ON "TareaEspacio"("espacioId", "estado");
ALTER TABLE "TareaEspacio" ADD CONSTRAINT "TareaEspacio_espacioId_fkey" FOREIGN KEY ("espacioId") REFERENCES "EspacioComun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
