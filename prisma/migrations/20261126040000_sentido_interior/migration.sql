-- Cámaras LPR de adentro: leen pero no cuentan entradas ni salidas (26/11).
ALTER TYPE "DeviceDirection" ADD VALUE IF NOT EXISTS 'INTERIOR';
