-- Gestión de alarmas: la nota del operador sobre cada alarma (Nico, 16/10: «un campo de texto
-- para registrar información sobre la gestión de cada evento»). La fila pasa a guardar la gestión
-- de cualquier alarma (intrusión, aviso o lectura), y una nota sola no la da por atendida.
ALTER TABLE "AlarmaAtendida" ADD COLUMN "atendida" BOOLEAN NOT NULL DEFAULT true;
