-- Lista de vigilancia unica: una fila por matricula con motivo, quien, persona vinculada y baja.
ALTER TABLE "PlateWatch" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PlateWatch" ADD COLUMN     "motivo" TEXT;
ALTER TABLE "PlateWatch" ADD COLUMN     "createdBy" TEXT;
ALTER TABLE "PlateWatch" ADD COLUMN     "userId" TEXT;
ALTER TABLE "PlateWatch" ADD COLUMN     "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "PlateWatch" ALTER COLUMN "category" SET DEFAULT 'BLACKLISTED';

-- Las categorias viejas (negra | vip | busca) pasan al vocabulario canonico. Idempotente.
UPDATE "PlateWatch" SET "category" = CASE lower("category")
    WHEN 'negra' THEN 'BLACKLISTED' WHEN 'blacklist' THEN 'BLACKLISTED' WHEN 'blacklisted' THEN 'BLACKLISTED'
    WHEN 'vip' THEN 'WHITELISTED' WHEN 'whitelist' THEN 'WHITELISTED' WHEN 'whitelisted' THEN 'WHITELISTED'
    WHEN 'busca' THEN 'SEARCH' WHEN 'search' THEN 'SEARCH'
    ELSE "category" END;

-- Lo que ya estaba inactivo no tiene fecha de baja conocida: se deja en NULL a proposito.
CREATE INDEX "PlateWatch_userId_idx" ON "PlateWatch"("userId");
CREATE INDEX "PlateWatch_active_category_idx" ON "PlateWatch"("active", "category");
