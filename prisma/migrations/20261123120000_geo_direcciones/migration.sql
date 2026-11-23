-- Las direcciones ya averiguadas (lib/direcciones): qué calle hay en cada punto, para no preguntar dos veces.
CREATE TABLE "GeoDireccion" (
    "clave" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "calle" TEXT,
    "barrio" TEXT,
    "ciudad" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeoDireccion_pkey" PRIMARY KEY ("clave")
);
