-- Una credencial puede no tener dueño todavía.
--
-- La pantalla de tags ofrecía "dejar en el cajón" y "desasignar", y para eso escribía
-- userId = "" — una cadena vacía, que no es el id de nadie. La clave foránea lo rechazaba
-- y el error se perdía en un catch. Las dos acciones nunca funcionaron.
ALTER TABLE "Credential" DROP CONSTRAINT IF EXISTS "Credential_userId_fkey";
ALTER TABLE "Credential" ALTER COLUMN "userId" DROP NOT NULL;

-- Por las dudas quedara alguna fila con la cadena vacía de intentos anteriores.
UPDATE "Credential" SET "userId" = NULL WHERE "userId" = '';

ALTER TABLE "Credential"
  ADD CONSTRAINT "Credential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
