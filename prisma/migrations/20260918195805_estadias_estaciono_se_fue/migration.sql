-- AlterTable
ALTER TABLE "PlateSighting" ADD COLUMN     "estAvisado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estCerrada" BOOLEAN NOT NULL DEFAULT false;
