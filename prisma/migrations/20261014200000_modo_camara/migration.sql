-- Modo por cámara: doble verificación LPR, apertura por lectura de OmniVision y modo de intrusión.
ALTER TABLE "Device" ADD COLUMN "lprVerifica" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN "lprAbre" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN "intrusionModo" TEXT;
