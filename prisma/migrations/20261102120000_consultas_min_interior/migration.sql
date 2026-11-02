-- Consultas a Matrículas Requeridas (2/11): la última respuesta por matrícula y quién consultó.
CREATE TABLE "ConsultaMinInterior" (
    "id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matricula" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "extracto" TEXT,
    "quien" TEXT,
    CONSTRAINT "ConsultaMinInterior_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsultaMinInterior_matricula_creadoEn_idx" ON "ConsultaMinInterior"("matricula", "creadoEn");
