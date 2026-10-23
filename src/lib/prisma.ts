import { PrismaClient } from "@prisma/client";
import { middlewareAuditoria } from "@/lib/auditoria";
import { middlewareCifrado } from "@/lib/cifrado-datos";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function crear() {
    const c = new PrismaClient({});
    // Quién cambió qué desde el panel queda en AccionSistema (ver lib/auditoria). Una sola vez por cliente.
    //
    // Sólo en el servidor. Este archivo llega al paquete del navegador por cadenas de imports
    // (layout → AvisosLpr → … → lib/lista-negra o lib/clips → acá), y allí @prisma/client es un
    // sustituto que se puede construir pero que revienta al tocarle cualquier propiedad: el `$use`
    // a secas tiró abajo todo /admin en el lab (21/10). Antes no se notaba porque nadie usaba el
    // cliente al cargar el módulo.
    if (typeof window === "undefined") {
        // Las claves de los equipos cifradas en la base (lib/cifrado-datos): se registra ANTES que la
        // auditoría para que ésta vea los datos ya cifrados y no copie una clave en claro a su registro.
        c.$use(middlewareCifrado());
        c.$use(middlewareAuditoria(c));
    }
    return c;
}

export const prisma = globalForPrisma.prisma || crear();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
