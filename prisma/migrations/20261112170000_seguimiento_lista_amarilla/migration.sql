-- Seguimiento de la Lista Amarilla (openspec seguimiento-lista-amarilla). Sólo agrega.

-- AlterTable
ALTER TABLE "PlateWatch" ADD COLUMN "revisarEl" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotaVigilancia" (
    "id" TEXT NOT NULL,
    "fichaClave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'NOTA',
    "texto" TEXT NOT NULL,
    "autor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotaVigilancia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotaVigilancia_fichaClave_createdAt_idx" ON "NotaVigilancia"("fichaClave", "createdAt");

-- Las amarillas activas que ya existían arrancan con 30 días: sin esto aparecerían todas vencidas
-- el primer día. Las de lista negra y las VIP no llevan revisión.
UPDATE "PlateWatch" SET "revisarEl" = NOW() + INTERVAL '30 days'
WHERE "active" = true AND UPPER("category") IN ('SEARCH', 'BUSCA') AND "revisarEl" IS NULL;
