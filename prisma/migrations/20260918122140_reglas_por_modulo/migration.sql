-- AlterTable
ALTER TABLE "NotificationRule" ADD COLUMN     "eventos" TEXT,
ADD COLUMN     "modulo" TEXT NOT NULL DEFAULT 'QUEUE';
