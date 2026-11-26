import { prisma } from "@/lib/prisma";

/**
 * Las matrículas que están ADENTRO, vistas por las LPR interiores (26/11). Nico: «una tercera
 * columna en el centro del monitor LPR para las interiores, que contabilice el tiempo de cada
 * matrícula que ve y está dentro; tipo bento, sólo matrículas, premium».
 *
 * Qué es «adentro» acá: una chapa que alguna interior vio en las últimas VENTANA_H horas y que no
 * salió (ningún evento de salida después de la última vez que la vio una interior). El reloj corre
 * desde su última ENTRADA si la hubo antes (es el tiempo real adentro); si no, desde la primera vez
 * que la vio una interior en la ventana, y se dice que es «desde que se la vio».
 *
 * Interiores son las de sentido Interior y las LPR_INTERIOR que no miran un acceso. Las lecturas
 * salen de PlateSighting, que junta las dos fuentes: el ANPR de la cámara (server.js) y OmniVision
 * (la pasarela de seguimiento). Sólo lectura.
 */
export type ChapaAdentro = {
    plate: string;
    /** Desde cuándo corre el reloj, y de dónde sale ese instante. */
    desde: string; desdeEs: "entrada" | "vista";
    ultima: string; primera: string; veces: number;
    camara: string | null; foto: string | null;
    /** La última lectura, para abrir su ficha (la misma que un evento LPR). */
    ultimaId: string | null; deviceId: string | null; confianza: number | null;
    quien: { nombre: string; rol: string; lote: string | null; vip: boolean } | null;
    lista: "negra" | "amarilla" | null;
};

const VENTANA_H = 12;
const ENTRADA_H = 24;
const MAX = 60;
const NO_ES_CHAPA = new Set(["NO_LEIDA", "UNKNOWN", "S/P", "SP", ""]);

/** Sin sesión: la llaman la acción del panel y la ruta del monitor de pared (que entra con enlace de pantalla). */
export async function leerInterioresAdentro(): Promise<{ ok: boolean; error?: string; camaras: number; chapas: ChapaAdentro[] }> {
    const devs = await prisma.device.findMany({
        where: { OR: [{ direction: "INTERIOR" }, { deviceType: "LPR_INTERIOR", trackAcceso: false }] },
        select: { id: true, name: true },
    });
    if (!devs.length) return { ok: true, camaras: 0, chapas: [] };
    const nombre = new Map(devs.map((d) => [d.id, d.name]));
    const desde = new Date(Date.now() - VENTANA_H * 3_600_000);

    const vistas = await prisma.plateSighting.findMany({
        where: { deviceId: { in: devs.map((d) => d.id) }, timestamp: { gte: desde } },
        orderBy: { timestamp: "desc" },
        select: { id: true, plate: true, deviceId: true, timestamp: true, snapshotUrl: true, confidence: true },
        take: 4000,
    });
    type Acum = { plate: string; ultima: Date; primera: Date; veces: number; camara: string | null; foto: string | null; ultimaId: string; deviceId: string | null; confianza: number | null };
    const por = new Map<string, Acum>();
    for (const v of vistas) {
        const p = String(v.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (p.length < 5 || NO_ES_CHAPA.has(p)) continue;
        const a = por.get(p);
        if (!a) por.set(p, { plate: p, ultima: v.timestamp, primera: v.timestamp, veces: 1, camara: v.deviceId ? nombre.get(v.deviceId) || null : null, foto: v.snapshotUrl || null, ultimaId: v.id, deviceId: v.deviceId || null, confianza: v.confidence ?? null });
        else { a.primera = v.timestamp; a.veces++; if (!a.foto && v.snapshotUrl) a.foto = v.snapshotUrl; }
    }
    const plates = [...por.keys()];
    if (!plates.length) return { ok: true, camaras: devs.length, chapas: [] };

    const [movs, creds, vigilancia] = await Promise.all([
        prisma.accessEvent.findMany({
            where: { accessType: "PLATE", plateDetected: { in: plates }, direction: { in: ["ENTRY", "EXIT"] }, timestamp: { gte: new Date(Date.now() - ENTRADA_H * 3_600_000) } },
            select: { plateDetected: true, direction: true, timestamp: true }, orderBy: { timestamp: "desc" },
        }),
        prisma.credential.findMany({ where: { type: "PLATE", value: { in: plates } }, select: { value: true, user: { select: { name: true, role: true, vip: true, unit: { select: { name: true } } } } } }),
        prisma.plateWatch.findMany({ where: { plate: { in: plates }, active: true, category: { in: ["BLACKLISTED", "SEARCH"] } }, select: { plate: true, category: true } }),
    ]);
    const quien = new Map(creds.filter((c) => c.user).map((c) => [c.value, { nombre: c.user!.name, rol: String(c.user!.role), lote: c.user!.unit?.name || null, vip: !!c.user!.vip }]));
    const lista = new Map(vigilancia.map((w) => [w.plate, w.category === "BLACKLISTED" ? "negra" as const : "amarilla" as const]));

    const out: ChapaAdentro[] = [];
    for (const a of por.values()) {
        const delAuto = movs.filter((m) => m.plateDetected === a.plate);
        // Salió después de la última vez que la vio una interior: ya no está adentro.
        if (delAuto.some((m) => m.direction === "EXIT" && m.timestamp > a.ultima)) continue;
        const entrada = delAuto.find((m) => m.direction === "ENTRY" && m.timestamp <= a.ultima);
        // La entrada vale si no hubo una salida entre ella y la vista.
        const salioDespues = entrada && delAuto.some((m) => m.direction === "EXIT" && m.timestamp > entrada.timestamp && m.timestamp <= a.ultima);
        const usaEntrada = !!entrada && !salioDespues;
        out.push({
            plate: a.plate, desde: (usaEntrada ? entrada!.timestamp : a.primera).toISOString(), desdeEs: usaEntrada ? "entrada" : "vista",
            ultima: a.ultima.toISOString(), primera: a.primera.toISOString(), veces: a.veces, camara: a.camara, foto: a.foto,
            ultimaId: a.ultimaId, deviceId: a.deviceId, confianza: a.confianza,
            quien: quien.get(a.plate) || null, lista: lista.get(a.plate) || null,
        });
    }
    out.sort((x, y) => Date.parse(y.ultima) - Date.parse(x.ultima));
    return { ok: true, camaras: devs.length, chapas: out.slice(0, MAX) };
}
