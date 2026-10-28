-- Usuarios de los equipos (openspec usuarios-de-equipos). Aditiva: tablas nuevas y columnas con
-- valores por defecto inertes. Con la función apagada nadie las lee.
ALTER TABLE "AppRole" ADD COLUMN "nivelEquipos" TEXT NOT NULL DEFAULT 'ninguno';
ALTER TABLE "AppRole" ADD COLUMN "tiposEquipos" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "cuentaEquipos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "claveEquipos" TEXT;
ALTER TABLE "User" ADD COLUMN "claveEquiposVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "nombreEquipos" TEXT;
ALTER TABLE "Device" ADD COLUMN "passwordAnterior" TEXT;

CREATE TABLE "CuentaEquipo" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "idEquipo" TEXT,
    "nivel" TEXT,
    "deFabrica" BOOLEAN NOT NULL DEFAULT false,
    "origen" TEXT NOT NULL DEFAULT 'equipo',
    "userId" TEXT,
    "conocida" BOOLEAN NOT NULL DEFAULT false,
    "conocidaMotivo" TEXT,
    "conocidaPor" TEXT,
    "primeraVez" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaVez" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desaparecida" TIMESTAMP(3),
    CONSTRAINT "CuentaEquipo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CuentaEquipo_deviceId_nombre_key" ON "CuentaEquipo"("deviceId", "nombre");
CREATE INDEX "CuentaEquipo_deviceId_idx" ON "CuentaEquipo"("deviceId");
ALTER TABLE "CuentaEquipo" ADD CONSTRAINT "CuentaEquipo_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SesionEquipo" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "procedencia" TEXT NOT NULL,
    "origenNombre" TEXT,
    "desdeEquipo" TEXT,
    "vistaPrimera" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vistaUltima" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasta" TIMESTAMP(3),
    CONSTRAINT "SesionEquipo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SesionEquipo_deviceId_hasta_idx" ON "SesionEquipo"("deviceId", "hasta");
CREATE INDEX "SesionEquipo_vistaUltima_idx" ON "SesionEquipo"("vistaUltima");
ALTER TABLE "SesionEquipo" ADD CONSTRAINT "SesionEquipo_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LecturaUsuariosEquipo" (
    "deviceId" TEXT NOT NULL,
    "cuentasAt" TIMESTAMP(3),
    "cuentasOk" BOOLEAN NOT NULL DEFAULT false,
    "cuentasError" TEXT,
    "sesionesAt" TIMESTAMP(3),
    "sesionesOk" BOOLEAN NOT NULL DEFAULT false,
    "sesionesError" TEXT,
    "maxCuentas" INTEGER,
    "claveDebil" BOOLEAN,
    CONSTRAINT "LecturaUsuariosEquipo_pkey" PRIMARY KEY ("deviceId")
);

CREATE TABLE "SincroCuenta" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "accion" TEXT,
    "motivo" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoIntento" TIMESTAMP(3),
    "claveVersion" INTEGER NOT NULL DEFAULT 0,
    "actualizado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SincroCuenta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SincroCuenta_deviceId_nombre_key" ON "SincroCuenta"("deviceId", "nombre");
CREATE INDEX "SincroCuenta_userId_idx" ON "SincroCuenta"("userId");
CREATE INDEX "SincroCuenta_estado_idx" ON "SincroCuenta"("estado");
