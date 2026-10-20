-- Reglas de aviso por tipo de chapa (taxi, policía, ambulancia…): csv de ids de TIPOS_CHAPA.
ALTER TABLE "NotificationRule" ADD COLUMN "tiposChapa" TEXT;
