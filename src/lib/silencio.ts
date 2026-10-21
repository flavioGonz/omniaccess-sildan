import { prisma } from "@/lib/prisma";
import { ensureAlert, resolveAlert } from "@/lib/device-health";

/**
 * ¿Cada cámara está reportando? (21/10, Nico: «saber si cada cámara está reportando de verdad»).
 *
 * La salud medía si la cámara RESPONDE (ISAPI, RTSP), no si sus eventos LLEGAN. Una cámara podía
 * estar en verde y muda: le pasó a Otto Villa, con el cruce de línea prendido y cero eventos en tres
 * días porque la red no la dejaba llamar. Acá se mira el último evento real de cada equipo:
 *  · lecturas de acceso (AccessEvent) y de seguimiento (PlateSighting) para las LPR;
 *  · detecciones (Detection: cruces de línea, zonas) para las de intrusión.
 *
 * Alerta («silencio») cuando una cámara que reporta normalmente deja de hacerlo:
 *  · una LPR de acceso, sin lecturas en SALUD_SILENCIO.lprHoras (8 h por defecto: en un acceso
 *    siempre pasa alguien; de noche puede haber huecos de varias horas);
 *  · una de intrusión que tuvo eventos en los últimos 30 días, sin ninguno en intrusionHoras (72 h:
 *    una perimetral tranquila puede pasar días sin cruces, pero tres sin uno es raro).
 * Las que nunca reportaron no alertan (no se sabe si deberían); las apagadas por área tampoco.
 */
export type UltimoEvento = { ts: Date; fuente: "acceso" | "seguimiento" | "deteccion" };
const DIAS_MIRA = 30;

export async function ultimosEventos(ids?: string[]): Promise<Map<string, UltimoEvento>> {
    const desde = new Date(Date.now() - DIAS_MIRA * 864e5);
    const filtro = ids?.length ? { deviceId: { in: ids } } : { deviceId: { not: null } };
    const [acc, seg, det] = await Promise.all([
        prisma.accessEvent.groupBy({ by: ["deviceId"], where: { ...filtro, timestamp: { gte: desde } } as any, _max: { timestamp: true } }).catch(() => [] as any[]),
        prisma.plateSighting.groupBy({ by: ["deviceId"], where: { ...filtro, timestamp: { gte: desde } } as any, _max: { timestamp: true } }).catch(() => [] as any[]),
        prisma.detection.groupBy({ by: ["deviceId"], where: { ...filtro, timestamp: { gte: desde } } as any, _max: { timestamp: true } }).catch(() => [] as any[]),
    ]);
    const out = new Map<string, UltimoEvento>();
    const sumar = (filas: any[], fuente: UltimoEvento["fuente"]) => {
        for (const f of filas) {
            const ts: Date | null = f?._max?.timestamp || null;
            if (!f.deviceId || !ts) continue;
            const ya = out.get(f.deviceId);
            if (!ya || ya.ts < ts) out.set(f.deviceId, { ts, fuente });
        }
    };
    sumar(acc, "acceso"); sumar(seg, "seguimiento"); sumar(det, "deteccion");
    return out;
}

const DEFECTO = { lprHoras: 8, intrusionHoras: 72 };
async function umbrales() {
    try { const v = (await prisma.setting.findUnique({ where: { key: "SALUD_SILENCIO" } }))?.value; return { ...DEFECTO, ...(v ? JSON.parse(v) : {}) }; }
    catch { return DEFECTO; }
}

export async function evaluarSilencio(): Promise<{ alertadas: number }> {
    const u = await umbrales();
    const { equiposApagados } = await import("@/lib/apagado");
    const apagados = await equiposApagados();
    const equipos = await prisma.device.findMany({ where: { deviceType: { in: ["LPR_CAMERA", "LPR_INTERIOR", "CAMERA"] as any } }, select: { id: true, name: true, deviceType: true } });
    const ultimos = await ultimosEventos();
    let alertadas = 0;
    const ahora = Date.now();
    for (const d of equipos) {
        if (apagados.has(d.id)) { await resolveAlert(d.id, d.name, "silencio"); continue; }
        const ult = ultimos.get(d.id);
        if (!ult) { await resolveAlert(d.id, d.name, "silencio"); continue; } // nunca reportó (en 30 días): no se sabe si debería
        const horas = (ahora - +ult.ts) / 36e5;
        const limite = String(d.deviceType) === "LPR_CAMERA" ? u.lprHoras : u.intrusionHoras;
        if (horas > limite) {
            const lapso = horas < 48 ? `${Math.round(horas)} h` : `${Math.round(horas / 24)} días`;
            await ensureAlert(d.id, d.name, "silencio", "warning", `No reporta hace ${lapso}: su último ${ult.fuente === "deteccion" ? "evento de analítica" : "lectura"} fue el ${ult.ts.toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}. Responde, pero sus eventos no llegan: revisá el servidor de alarma, la red de vuelta o la analítica.`);
            alertadas++;
        } else await resolveAlert(d.id, d.name, "silencio");
    }
    return { alertadas };
}
