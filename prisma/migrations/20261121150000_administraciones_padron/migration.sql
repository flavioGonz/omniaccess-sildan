-- Las administraciones del complejo (una por etapa o grupo de etapas), con sus contactos y servicios.
CREATE TABLE "Administracion" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "sigla" TEXT NOT NULL,
    "notas" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Administracion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Administracion_nombre_key" ON "Administracion"("nombre");
CREATE UNIQUE INDEX "Administracion_sigla_key" ON "Administracion"("sigla");

CREATE TABLE "AdministracionContacto" (
    "id" TEXT NOT NULL,
    "administracionId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL DEFAULT '',
    "telefono" TEXT,
    "email" TEXT,
    "notas" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdministracionContacto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdministracionContacto_administracionId_idx" ON "AdministracionContacto"("administracionId");
ALTER TABLE "AdministracionContacto" ADD CONSTRAINT "AdministracionContacto_administracionId_fkey" FOREIGN KEY ("administracionId") REFERENCES "Administracion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdministracionServicio" (
    "id" TEXT NOT NULL,
    "administracionId" TEXT NOT NULL,
    "rubro" TEXT NOT NULL,
    "proveedor" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "horario" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdministracionServicio_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdministracionServicio_administracionId_idx" ON "AdministracionServicio"("administracionId");
ALTER TABLE "AdministracionServicio" ADD CONSTRAINT "AdministracionServicio_administracionId_fkey" FOREIGN KEY ("administracionId") REFERENCES "Administracion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El lote: a qué administración pertenece y cómo figura en el plano.
ALTER TABLE "Unit" ADD COLUMN "administracionId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "manzana" TEXT;
ALTER TABLE "Unit" ADD COLUMN "solar" TEXT;
ALTER TABLE "Unit" ADD COLUMN "subunidad" TEXT;
ALTER TABLE "Unit" ADD COLUMN "edificio" TEXT;
ALTER TABLE "Unit" ADD COLUMN "areaM2" DOUBLE PRECISION;
ALTER TABLE "Unit" ADD COLUMN "titular" TEXT;
ALTER TABLE "Unit" ADD COLUMN "situacion" TEXT;
CREATE INDEX "Unit_administracionId_idx" ON "Unit"("administracionId");
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_administracionId_fkey" FOREIGN KEY ("administracionId") REFERENCES "Administracion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Una persona puede tener más de un lote.
CREATE TABLE "UserUnidad" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "vinculo" TEXT NOT NULL DEFAULT 'PROPIETARIO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserUnidad_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserUnidad_userId_unitId_key" ON "UserUnidad"("userId", "unitId");
CREATE INDEX "UserUnidad_unitId_idx" ON "UserUnidad"("unitId");
ALTER TABLE "UserUnidad" ADD CONSTRAINT "UserUnidad_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserUnidad" ADD CONSTRAINT "UserUnidad_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La invitación del censo pasa a ser por PERSONA (un correo), con sus lotes adentro. Antes era una
-- por lote; con dos personas en el mismo lote, la segunda pisaba a la primera.
ALTER TABLE "InvitacionCenso" ADD COLUMN "lotes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "InvitacionCenso" ADD COLUMN "userId" TEXT;
DROP INDEX "InvitacionCenso_sitio_lote_key";
CREATE UNIQUE INDEX "InvitacionCenso_sitio_email_key" ON "InvitacionCenso"("sitio", "email");

-- La carga del censo dice para qué lote del padrón es.
ALTER TABLE "SolicitudPadron" ADD COLUMN "unitId" TEXT;
