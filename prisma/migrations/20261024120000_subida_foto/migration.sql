-- La foto que un celular le manda a una pared por QR (openspec pared-vms). Aditiva.
CREATE TABLE "SubidaFoto" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "creada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence" TIMESTAMP(3) NOT NULL,
    "abrio" TEXT,
    "foto" BYTEA,
    "tipo" TEXT,
    "llego" TIMESTAMP(3),
    "retirada" TIMESTAMP(3),

    CONSTRAINT "SubidaFoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubidaFoto_tokenHash_key" ON "SubidaFoto"("tokenHash");
CREATE INDEX "SubidaFoto_vence_idx" ON "SubidaFoto"("vence");
