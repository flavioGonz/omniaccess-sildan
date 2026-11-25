-- El censo a TODOS los residentes, con el codigo del lote (25/11). Cada envio a alguien que no es el
-- principal del lote es una copia, con su propio estado. La carga recuerda a quien le llego el enlace.
CREATE TABLE "CopiaCenso" (
    "id" TEXT NOT NULL,
    "invitacionId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT '',
    "enviadoAt" TIMESTAMP(3),
    "enviadoDesde" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "usadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CopiaCenso_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CopiaCenso_invitacionId_email_key" ON "CopiaCenso"("invitacionId", "email");
CREATE INDEX "CopiaCenso_enviadoAt_idx" ON "CopiaCenso"("enviadoAt");
ALTER TABLE "CopiaCenso" ADD CONSTRAINT "CopiaCenso_invitacionId_fkey" FOREIGN KEY ("invitacionId") REFERENCES "InvitacionCenso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SolicitudPadron" ADD COLUMN "paraUserId" TEXT;
