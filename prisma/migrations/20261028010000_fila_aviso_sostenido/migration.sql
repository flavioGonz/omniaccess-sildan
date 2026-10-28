-- Aviso de fila sostenida: segundos seguidos sobre el límite antes de avisar (0 = en el momento).
ALTER TABLE "QueueAlert" ADD COLUMN "sostenidoSeg" INTEGER NOT NULL DEFAULT 0;
