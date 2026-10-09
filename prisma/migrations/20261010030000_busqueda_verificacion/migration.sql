-- Búsqueda de objetos (huella SigLIP por pista) y doble verificación en las reglas de aviso.
CREATE TABLE "HuellaObjeto" (
    "objetoId" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "escala" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HuellaObjeto_pkey" PRIMARY KEY ("objetoId")
);
CREATE INDEX "HuellaObjeto_createdAt_idx" ON "HuellaObjeto"("createdAt");
ALTER TABLE "HuellaObjeto" ADD CONSTRAINT "HuellaObjeto_objetoId_fkey" FOREIGN KEY ("objetoId") REFERENCES "ObjetoVisto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationRule" ADD COLUMN "verificacion" TEXT NOT NULL DEFAULT 'avisar';
ALTER TABLE "EventoVision" ADD COLUMN "fotoAntes" TEXT;
ALTER TABLE "Detection" ADD COLUMN "verifAviso" TEXT;
