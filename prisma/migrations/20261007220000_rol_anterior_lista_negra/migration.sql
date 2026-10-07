-- Al sacar a una persona de la lista negra (modulo facial) se la promovia a WHITELISTED aunque
-- antes fuera VISITOR: ganaba acceso que no tenia. Se guarda el rol anterior para devolverlo.
ALTER TABLE "User" ADD COLUMN "rolAnterior" "UserRole";
