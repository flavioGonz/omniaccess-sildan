-- CreateTable
CREATE TABLE "EjecucionTarea" (
    "id" TEXT NOT NULL,
    "tarea" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "ok" BOOLEAN,
    "detalle" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'cron',

    CONSTRAINT "EjecucionTarea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccionSistema" (
    "id" TEXT NOT NULL,
    "cuando" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quien" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "objetivo" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detalle" TEXT,

    CONSTRAINT "AccionSistema_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EjecucionTarea_tarea_inicio_idx" ON "EjecucionTarea"("tarea", "inicio");

-- CreateIndex
CREATE INDEX "AccionSistema_cuando_idx" ON "AccionSistema"("cuando");
