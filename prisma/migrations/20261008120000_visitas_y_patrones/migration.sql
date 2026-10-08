-- Visitas y patrones: tres tablas nuevas, nada existente cambia.

-- CreateTable
CREATE TABLE "Visita" (
    "id" TEXT NOT NULL,
    "plate" TEXT,
    "tipo" TEXT NOT NULL,
    "unitId" TEXT,
    "loteNombre" TEXT,
    "nombre" TEXT,
    "empresa" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'GUARDIA',
    "registradaPor" TEXT,
    "invitationId" TEXT,
    "entra" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence" TIMESTAMP(3) NOT NULL,
    "sale" TIMESTAMP(3),
    "cierre" TEXT,
    "cerradaPor" TEXT,
    "extensiones" JSONB,
    "vistoAdentroAt" TIMESTAMP(3),
    "accessEventEntradaId" TEXT,
    "accessEventSalidaId" TEXT,
    "avisadaExcedidaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilMatricula" (
    "plate" TEXT NOT NULL,
    "primeraVez" TIMESTAMP(3) NOT NULL,
    "ultimaVez" TIMESTAMP(3) NOT NULL,
    "diasVistos" INTEGER NOT NULL DEFAULT 0,
    "entradas" INTEGER NOT NULL DEFAULT 0,
    "salidas" INTEGER NOT NULL DEFAULT 0,
    "visitasConSalida" INTEGER NOT NULL DEFAULT 0,
    "permanenciaMedianaMin" INTEGER,
    "permanenciaP90Min" INTEGER,
    "entradaNoVista" BOOLEAN NOT NULL DEFAULT false,
    "rutina" JSONB,
    "clase" TEXT NOT NULL,
    "unitIdProbable" TEXT,
    "actualizado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerfilMatricula_pkey" PRIMARY KEY ("plate")
);

-- CreateTable
CREATE TABLE "AvisoGuardia" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "plate" TEXT,
    "visitaId" TEXT,
    "accessEventId" TEXT,
    "camara" TEXT,
    "motivo" TEXT NOT NULL,
    "datos" JSONB,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atendidoPor" TEXT,
    "atendidoAt" TIMESTAMP(3),
    "nota" TEXT,

    CONSTRAINT "AvisoGuardia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visita_plate_sale_idx" ON "Visita"("plate", "sale");
CREATE INDEX "Visita_sale_vence_idx" ON "Visita"("sale", "vence");
CREATE INDEX "Visita_entra_idx" ON "Visita"("entra");
CREATE INDEX "PerfilMatricula_clase_idx" ON "PerfilMatricula"("clase");
CREATE INDEX "AvisoGuardia_atendidoAt_creado_idx" ON "AvisoGuardia"("atendidoAt", "creado");
CREATE INDEX "AvisoGuardia_tipo_plate_creado_idx" ON "AvisoGuardia"("tipo", "plate", "creado");
CREATE INDEX "AvisoGuardia_visitaId_idx" ON "AvisoGuardia"("visitaId");
