-- Planilla de un proveedor: sus empleados son personas con credencial propia.
ALTER TABLE "User" ADD COLUMN "empleadorId" TEXT;
ALTER TABLE "User" ADD COLUMN "autorizado" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "autorizadoCambio" TIMESTAMP(3);
CREATE INDEX "User_empleadorId_idx" ON "User"("empleadorId");
ALTER TABLE "User" ADD CONSTRAINT "User_empleadorId_fkey" FOREIGN KEY ("empleadorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
