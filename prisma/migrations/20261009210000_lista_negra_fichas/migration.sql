-- Lista negra como pestaña con fichas: varias matrículas de una misma ficha (persona o vehículo
-- sin identificar) comparten este id. Null = la entrada es suelta (monitor, bot) y se muestra
-- como una ficha de una sola matrícula.
ALTER TABLE "PlateWatch" ADD COLUMN "ficha" TEXT;
CREATE INDEX "PlateWatch_ficha_idx" ON "PlateWatch"("ficha");

-- VIP deja de ser una lista aparte: es una marca de un residente o de alguien del personal.
ALTER TABLE "User" ADD COLUMN "vip" BOOLEAN NOT NULL DEFAULT false;
-- Quien tenía el rol «Lista blanca» queda marcado VIP (el rol no se toca: lo sigue leyendo la barrera).
UPDATE "User" SET "vip" = true WHERE "role" = 'WHITELISTED';
