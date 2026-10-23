-- Las cámaras del abonado (openspec alarmas-como-funciones). Aditiva.
ALTER TABLE "CentralAlarma" ADD COLUMN "camaras" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
