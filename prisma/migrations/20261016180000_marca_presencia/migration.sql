-- Correcciones a mano de quién está adentro (Monitor LPR › Presencia). En San Nicolás el
-- barrio es abierto y la salida de ~55 % de los autos no se lee: sin esto, un auto que salió
-- sin verse figura adentro hasta que vuelva a pasar.
CREATE TABLE "MarcaPresencia" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "por" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarcaPresencia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarcaPresencia_plate_ts_idx" ON "MarcaPresencia"("plate", "ts");
CREATE INDEX "MarcaPresencia_ts_idx" ON "MarcaPresencia"("ts");
