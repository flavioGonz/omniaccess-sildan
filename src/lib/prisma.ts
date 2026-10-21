import { PrismaClient } from "@prisma/client";
import { middlewareAuditoria } from "@/lib/auditoria";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function crear() {
    const c = new PrismaClient({});
    // Quién cambió qué desde el panel queda en AccionSistema (ver lib/auditoria). Una sola vez por cliente.
    c.$use(middlewareAuditoria(c));
    return c;
}

export const prisma = globalForPrisma.prisma || crear();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
