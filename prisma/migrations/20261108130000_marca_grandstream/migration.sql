-- Agrega la marca Grandstream (portero IP GDS) al enum DeviceBrand.
-- Aditivo: no toca datos existentes. Ver src/lib/drivers/GrandstreamDriver.ts y catalogo.ts.
ALTER TYPE "DeviceBrand" ADD VALUE IF NOT EXISTS 'GRANDSTREAM';
