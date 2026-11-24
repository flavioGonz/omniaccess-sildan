-- Cada administración manda los correos a sus lotes desde su propia cuenta (25/11).
ALTER TABLE "Administracion" ADD COLUMN "correoCuenta" TEXT;
ALTER TABLE "Administracion" ADD COLUMN "correoNombre" TEXT;
ALTER TABLE "Administracion" ADD COLUMN "correoClave" TEXT;
ALTER TABLE "Administracion" ADD COLUMN "correoProbadoAt" TIMESTAMP(3);
ALTER TABLE "Administracion" ADD COLUMN "correoError" TEXT;
-- Desde qué cuenta salió cada invitación del censo.
ALTER TABLE "InvitacionCenso" ADD COLUMN "enviadoDesde" TEXT;
