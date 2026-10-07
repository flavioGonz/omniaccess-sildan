-- Enlaces de pantalla: la credencial de solo lectura con la que un monitor de pared abre una vista.
CREATE TABLE "EnlacePantalla" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "vista" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "creadoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEn" TIMESTAMP(3),
    "ultimoUsoIp" TEXT,
    "revocadoEn" TIMESTAMP(3),
    CONSTRAINT "EnlacePantalla_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnlacePantalla_tokenHash_key" ON "EnlacePantalla"("tokenHash");
CREATE INDEX "EnlacePantalla_vista_idx" ON "EnlacePantalla"("vista");

-- El permiso nuevo "monitores" (menu Monitores y emision de enlaces) lo recibe Administrador;
-- Operador no, por defecto: emitir un enlace es dar acceso permanente a una pantalla.
UPDATE "AppRole" SET "permisos" = array_append("permisos", 'monitores')
WHERE "id" = 'rol-administrador' AND NOT ('monitores' = ANY("permisos"));
