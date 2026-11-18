-- El censo con clave por lote: un correo por lote, con copia a la administración.
CREATE TABLE IF NOT EXISTS "InvitacionCenso" (
    "id" TEXT NOT NULL,
    "sitio" TEXT NOT NULL DEFAULT '',
    "lote" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT '',
    "clave" TEXT NOT NULL,
    "enviadoAt" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "usadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvitacionCenso_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvitacionCenso_clave_key" ON "InvitacionCenso"("clave");
CREATE UNIQUE INDEX IF NOT EXISTS "InvitacionCenso_sitio_lote_key" ON "InvitacionCenso"("sitio", "lote");
CREATE INDEX IF NOT EXISTS "InvitacionCenso_enviadoAt_idx" ON "InvitacionCenso"("enviadoAt");

ALTER TABLE "SolicitudPadron" ADD COLUMN IF NOT EXISTS "clave" TEXT;
