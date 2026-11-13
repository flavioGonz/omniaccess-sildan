-- Marcar una detección del registro como falsa. Sólo agrega.

-- AlterTable
ALTER TABLE "ObjetoVisto" ADD COLUMN "falsa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "falsaPor" TEXT,
ADD COLUMN "falsaAt" TIMESTAMP(3);
