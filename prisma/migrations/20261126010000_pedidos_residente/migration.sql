-- Lo que pide un residente desde su portal: sumar o sacar una matricula, hasta que la administracion lo aprueba (26/11).
CREATE TABLE "PedidoResidente" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT,
    "tipo" TEXT NOT NULL,
    "chapa" TEXT,
    "detalle" JSONB NOT NULL DEFAULT '{}',
    "nota" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "resueltoPor" TEXT,
    "resueltoAt" TIMESTAMP(3),
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PedidoResidente_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PedidoResidente_estado_createdAt_idx" ON "PedidoResidente"("estado", "createdAt");
CREATE INDEX "PedidoResidente_userId_idx" ON "PedidoResidente"("userId");
