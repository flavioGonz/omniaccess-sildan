-- Las fotos disparadas para entrenar una analitica de escena y las del conjunto de objetos pasan a
-- servir para las dos cosas (pedido 16/11 de Nico). Cada lado guarda de donde vino lo que trajo, y
-- el unico impide traer dos veces lo mismo. Solo agrega columnas: nada existente cambia.

ALTER TABLE "MuestraZona" ADD COLUMN "fotoId" TEXT;
CREATE UNIQUE INDEX "MuestraZona_zonaId_fotoId_key" ON "MuestraZona"("zonaId", "fotoId");

ALTER TABLE "FotoEntrenamiento" ADD COLUMN "muestraId" TEXT;
CREATE UNIQUE INDEX "FotoEntrenamiento_muestraId_key" ON "FotoEntrenamiento"("muestraId");
