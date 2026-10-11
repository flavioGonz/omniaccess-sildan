import { prisma } from "@/lib/prisma";

/**
 * Los semaforos de las garitas (Olivos).
 *
 * Cada lectora LPR tiene su lista (whiteList) y un rele: cuando la matricula esta en la lista,
 * la camara manda el pulso y prende el semaforo VERDE de la garita; si no esta, el semaforo
 * queda en ROJO. El guardia mira esa luz para saber si es alguien conocido.
 *
 * El monitor no puede leer la lampara: la deduce de lo que dijo la camara. Una lectura con
 * decision GRANT y `Source: Camera` en los detalles es exactamente "la camara la encontro en
 * su lista" (server.js arma asi el evento), o sea: el rele disparo. Una GRANT decidida por el
 * servidor (sin la camara) NO prende el semaforo, y se muestra distinto.
 */
export type EstadoSemaforo = {
    deviceId: string; nombre: string; garita: string; sentido: string;
    ultima: { id: string; ts: string; plate: string | null; decision: string; rele: boolean } | null;
};

export const SEMAFORO_SEG_DEFECTO = 8;

/** "P1 - Entrada (207)" -> "P1"; "Matriculas P 4" -> "P4"; si no hay P<n>, el nombre entero. */
export function garitaDe(nombre: string): string {
    const m = nombre.match(/\bP\s*(\d+)/i);
    return m ? `P${m[1]}` : nombre;
}

export const releDisparo = (decision: string | null | undefined, details: string | null | undefined) =>
    decision === "GRANT" && /Source:\s*Camera/i.test(details || "");

export async function semaforosLpr(): Promise<{ seg: number; camaras: EstadoSemaforo[] }> {
    const [camaras, ajuste] = await Promise.all([
        prisma.device.findMany({ where: { deviceType: "LPR_CAMERA" }, select: { id: true, name: true, direction: true }, orderBy: { name: "asc" } }),
        prisma.setting.findUnique({ where: { key: "MONITOR_SEMAFORO_SEG" } }).catch(() => null),
    ]);
    const seg = Math.min(60, Math.max(2, Number(ajuste?.value) || SEMAFORO_SEG_DEFECTO));
    if (!camaras.length) return { seg, camaras: [] };
    // La ultima lectura de cada camara, en una sola consulta.
    const filas = await prisma.$queryRaw<{ id: string; deviceId: string; timestamp: Date; plate: string | null; decision: string; details: string | null }[]>`
        SELECT DISTINCT ON ("deviceId") id, "deviceId", timestamp, COALESCE("plateDetected", "plateNumber") AS plate, decision::text AS decision, details
        FROM "AccessEvent"
        WHERE "deviceId" = ANY(${camaras.map((c) => c.id)}) AND timestamp > now() - interval '7 days'
        ORDER BY "deviceId", timestamp DESC`.catch(() => []);
    const porCamara = new Map(filas.map((f) => [f.deviceId, f]));
    return {
        seg,
        camaras: camaras.map((c) => {
            const f = porCamara.get(c.id);
            return {
                deviceId: c.id, nombre: c.name, garita: garitaDe(c.name), sentido: String(c.direction || "ENTRY"),
                ultima: f ? { id: f.id, ts: new Date(f.timestamp).toISOString(), plate: f.plate, decision: f.decision, rele: releDisparo(f.decision, f.details) } : null,
            };
        }),
    };
}
