-- Avisos por equipo (29/10): qué alertas de salud se prenden en cada equipo y si van a Telegram.
-- JSON con un booleano por aviso; lo que falta vale «prendido», así nada cambia hasta que se toque.
ALTER TABLE "Device" ADD COLUMN "avisos" JSONB;
