-- El censo pasa a un codigo POR LOTE, al correo principal del lote (25/11). Una persona que es la
-- principal de dos lotes tiene dos invitaciones con el mismo correo: el correo deja de ser unico.
ALTER TABLE "InvitacionCenso" ADD COLUMN "unitId" TEXT;
ALTER TABLE "InvitacionCenso" ADD COLUMN "aMano" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX IF EXISTS "InvitacionCenso_sitio_email_key";
CREATE INDEX "InvitacionCenso_sitio_email_idx" ON "InvitacionCenso"("sitio", "email");
CREATE UNIQUE INDEX "InvitacionCenso_sitio_unitId_key" ON "InvitacionCenso"("sitio", "unitId");
