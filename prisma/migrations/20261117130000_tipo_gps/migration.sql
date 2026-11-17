-- Un tipo de equipo mas: rastreador GPS (pedido 17/11 de Nico, junto con Control de acceso, que
-- ya existia en el enum y solo faltaba poder elegirlo). Agregar un valor a un enum no toca
-- ninguna fila existente.

ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'GPS';
