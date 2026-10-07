-- Roles de la aplicacion: que pantallas puede abrir cada usuario del panel.
CREATE TABLE "AppRole" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "permisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "esSistema" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppRole_nombre_key" ON "AppRole"("nombre");

ALTER TABLE "User" ADD COLUMN "appRoleId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_appRoleId_fkey" FOREIGN KEY ("appRoleId") REFERENCES "AppRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Los dos roles que ya existian de hecho (ADMIN = todo, OPERATOR = opera, no edita), con las
-- claves de lib/permisos.ts. Si se agrega un permiso al catalogo, Administrador lo recibe en
-- el arranque de la app (ver actions/accesos.ts); Operador no.
INSERT INTO "AppRole" ("id","nombre","descripcion","permisos","esSistema") VALUES
 ('rol-administrador','Administrador','Acceso total al panel, incluidos los accesos de otros usuarios.',
  ARRAY['monitor','intrusion','historial','mapa','invitados','vigilancia','guardia','acuseek','usuarios','unidades','vehiculos','grupos','plazas','dispositivos','filas','notificaciones','ajustes','accesos'], true),
 ('rol-operador','Operador','Opera el sistema (monitores, historial, mapa, invitados, lista de vigilancia) sin tocar padron, equipos ni ajustes.',
  ARRAY['monitor','intrusion','historial','mapa','invitados','vigilancia','guardia','acuseek','plazas','filas'], true)
ON CONFLICT ("nombre") DO NOTHING;

-- Los usuarios del panel que ya existen quedan con su rol equivalente.
UPDATE "User" SET "appRoleId" = 'rol-administrador' WHERE "role" = 'ADMIN' AND "appRoleId" IS NULL;
UPDATE "User" SET "appRoleId" = 'rol-operador' WHERE "role" = 'OPERATOR' AND "appRoleId" IS NULL;
