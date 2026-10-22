import { prisma } from "@/lib/prisma";
import { AJUSTE_PRIORIDADES, leerPrioridades, type Prioridades } from "./prioridades";

/** Las prioridades guardadas por el administrador (o las de fábrica). */
export async function leerPrioridadesGuardadas(): Promise<Prioridades> {
    const f = await prisma.setting.findUnique({ where: { key: AJUSTE_PRIORIDADES } }).catch(() => null);
    return leerPrioridades(f?.value);
}
