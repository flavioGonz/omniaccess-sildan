import { prisma } from "@/lib/prisma";
import { normalizarMatricula } from "@/lib/lista-negra";
import { watchCatMeta } from "@/lib/watch-categories";

/**
 * Lo que el historial sabe de una pista de OmniVision (pedido de Nico, 15/10: «combinar Buscar
 * con el historial de detecciones, para un resultado enriquecido, y poder registrar en lista
 * negra, residente o proveedor»).
 *
 * Una pista dice CÓMO se veía algo («moto con caja roja»); el historial dice QUIÉN era: la chapa
 * que leyó la lectora en ese momento, si entró o no, de quién es el auto y si está vigilado. Se
 * cruzan por cámara y por tiempo: la lectura de la MISMA cámara mientras la pista estaba a la
 * vista (con un margen, porque la lectora dispara un poco antes o después que el seguimiento).
 *
 * Qué NO se cruza: una persona con una lectura de chapa. Que alguien camine frente a la lectora
 * mientras pasa un auto no lo hace dueño del auto; sólo las pistas de vehículo toman la chapa.
 * Las alertas de la cámara (cruce de línea, zona) sí van con cualquier pista: dicen qué hizo.
 */

/** Margen alrededor de la pista para tomar una lectura o una alerta de la misma cámara. */
const MARGEN_MS = 8_000;
/** Lo que la lectora escribe cuando no pudo leer: no es una chapa. */
const NO_LEIDAS = new Set(["NO_LEIDA", "UNKNOWN", "S/P", ""]);
/** Una consulta con cientos de OR se vuelve lenta: hasta acá se cruzan (Buscar devuelve 60). */
const PISTAS_MAX = 120;

export type Persona = { id: string; nombre: string; rol: string; unidad: string | null };
export type Vigilancia = { categoria: string; etiqueta: string; motivo: string | null };
export type LecturaCruzada = {
    id: string; ts: string; plate: string; decision: string; sentido: string; foto: string | null;
    persona: Persona | null; vigilancia: Vigilancia | null;
};
export type HistorialPista = { lectura: LecturaCruzada | null; alertas: { id: string; ts: string; tipo: string }[] };

type Pista = { id: string; deviceId: string | null; grupo: string; primeraVez: Date | string; ultimaVez: Date | string };

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const esChapa = (p: string | null | undefined) => !!p && !NO_LEIDAS.has(p.toUpperCase());

/** Quién es y si está vigilada, para un conjunto de chapas: tres consultas para todas. */
export async function queSeSabeDeChapas(chapas: string[]): Promise<Map<string, { persona: Persona | null; vigilancia: Vigilancia | null }>> {
    const ps = [...new Set(chapas.map(normalizarMatricula).filter(Boolean))];
    const out = new Map<string, { persona: Persona | null; vigilancia: Vigilancia | null }>();
    if (!ps.length) return out;
    const sel = { user: { select: { id: true, name: true, role: true, unit: { select: { name: true } } } } };
    const [vehs, creds, watches] = await Promise.all([
        prisma.vehicle.findMany({ where: { plate: { in: ps } }, select: { plate: true, ...sel } }),
        prisma.credential.findMany({ where: { type: "PLATE", value: { in: ps } }, select: { value: true, ...sel } }),
        prisma.plateWatch.findMany({ where: { plate: { in: ps }, active: true }, select: { plate: true, category: true, motivo: true, label: true } }),
    ]);
    const persona = (u: any): Persona | null => (u ? { id: u.id, nombre: u.name, rol: String(u.role), unidad: u.unit?.name || null } : null);
    for (const p of ps) out.set(p, { persona: null, vigilancia: null });
    for (const c of creds) out.get(c.value)!.persona ||= persona(c.user);
    for (const v of vehs) out.get(v.plate)!.persona = persona(v.user) || out.get(v.plate)!.persona;
    for (const w of watches) out.get(w.plate)!.vigilancia = { categoria: w.category, etiqueta: watchCatMeta(w.category as any).label, motivo: w.motivo || w.label || null };
    return out;
}

/** El historial de cada pista, por id. Las pistas sin cámara quedan sin cruzar. */
export async function historialDePistas(pistas: Pista[]): Promise<Map<string, HistorialPista>> {
    const conCamara = pistas.filter((p) => p.deviceId).slice(0, PISTAS_MAX);
    const out = new Map<string, HistorialPista>();
    if (!conCamara.length) return out;
    const ventanas = conCamara.map((p) => ({ deviceId: p.deviceId!, timestamp: { gte: new Date(ms(p.primeraVez) - MARGEN_MS), lte: new Date(ms(p.ultimaVez) + MARGEN_MS) } }));
    const vehiculos = conCamara.filter((p) => p.grupo === "vehiculo");
    const [lecturas, alertas] = await Promise.all([
        vehiculos.length ? prisma.accessEvent.findMany({
            where: { OR: vehiculos.map((p) => ({ deviceId: p.deviceId!, timestamp: { gte: new Date(ms(p.primeraVez) - MARGEN_MS), lte: new Date(ms(p.ultimaVez) + MARGEN_MS) } })) },
            select: { id: true, timestamp: true, deviceId: true, plateDetected: true, decision: true, direction: true, snapshotPath: true, imagePath: true, user: { select: { id: true, name: true, role: true, unit: { select: { name: true } } } } },
            orderBy: { timestamp: "asc" }, take: 2000,
        }) : Promise.resolve([]),
        prisma.detection.findMany({
            where: { OR: ventanas, type: { not: "MOTION" } },
            select: { id: true, timestamp: true, deviceId: true, type: true }, orderBy: { timestamp: "asc" }, take: 2000,
        }).catch(() => []),
    ]);
    const leidas = lecturas.filter((l) => esChapa(l.plateDetected));
    const sabido = await queSeSabeDeChapas(leidas.map((l) => l.plateDetected!));

    for (const p of conCamara) {
        const a = ms(p.primeraVez) - MARGEN_MS, b = ms(p.ultimaVez) + MARGEN_MS, medio = (ms(p.primeraVez) + ms(p.ultimaVez)) / 2;
        let lectura: LecturaCruzada | null = null;
        if (p.grupo === "vehiculo") {
            // La lectura más cercana al medio de la pista: con dos autos seguidos, la de cada uno.
            const l = leidas.filter((x) => x.deviceId === p.deviceId && x.timestamp.getTime() >= a && x.timestamp.getTime() <= b)
                .sort((x, y) => Math.abs(x.timestamp.getTime() - medio) - Math.abs(y.timestamp.getTime() - medio))[0];
            if (l) {
                const plate = normalizarMatricula(l.plateDetected!);
                const s = sabido.get(plate);
                const u = l.user;
                lectura = {
                    id: l.id, ts: l.timestamp.toISOString(), plate, decision: String(l.decision), sentido: String(l.direction), foto: l.snapshotPath || l.imagePath || null,
                    persona: u ? { id: u.id, nombre: u.name, rol: String(u.role), unidad: u.unit?.name || null } : s?.persona || null,
                    vigilancia: s?.vigilancia || null,
                };
            }
        }
        const al = alertas.filter((x) => x.deviceId === p.deviceId && x.timestamp.getTime() >= a && x.timestamp.getTime() <= b)
            .map((x) => ({ id: x.id, ts: x.timestamp.toISOString(), tipo: String(x.type) }));
        if (lectura || al.length) out.set(p.id, { lectura, alertas: al });
    }
    return out;
}

/** ¿Lo que se escribió en Buscar es una matrícula? (ABC1234, AB 123 CD, SBX-1234…) */
export function pareceChapa(q: string): string | null {
    const t = q.trim().toUpperCase().replace(/[\s-]+/g, "");
    return /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{5,8}$/.test(t) ? t : null;
}

/** Los pasos de una matrícula por las lectoras en el rango: el historial de accesos de esa chapa. */
export async function pasosDeChapa(chapa: string, desde: Date, limite = 24) {
    const filas = await prisma.accessEvent.findMany({
        where: { plateDetected: { contains: chapa, mode: "insensitive" }, timestamp: { gte: desde } },
        select: { id: true, timestamp: true, deviceId: true, plateDetected: true, decision: true, direction: true, snapshotPath: true, imagePath: true, device: { select: { name: true } }, user: { select: { id: true, name: true, role: true, unit: { select: { name: true } } } } },
        orderBy: { timestamp: "desc" }, take: limite,
    });
    const sabido = await queSeSabeDeChapas(filas.map((f) => f.plateDetected || ""));
    return filas.map((f) => {
        const plate = normalizarMatricula(f.plateDetected || "");
        const s = sabido.get(plate);
        return {
            id: f.id, ts: f.timestamp.toISOString(), plate, decision: String(f.decision), sentido: String(f.direction), camara: f.device?.name || null, deviceId: f.deviceId,
            foto: f.snapshotPath || f.imagePath || null,
            persona: f.user ? { id: f.user.id, nombre: f.user.name, rol: String(f.user.role), unidad: f.user.unit?.name || null } : s?.persona || null,
            vigilancia: s?.vigilancia || null,
        };
    });
}
export type PasoChapa = Awaited<ReturnType<typeof pasosDeChapa>>[number];

/**
 * Las pistas de OmniVision de esos pasos: el vehículo que la lectora vio, visto por OmniVision en
 * la misma cámara y al mismo tiempo (su mejor foto, el rotulado, los atributos).
 */
export async function pistasDePasos(pasos: { deviceId: string | null; ts: string }[]) {
    const con = pasos.filter((p) => p.deviceId);
    if (!con.length) return [];
    return prisma.objetoVisto.findMany({
        where: { grupo: "vehiculo", OR: con.map((p) => ({ deviceId: p.deviceId!, primeraVez: { lte: new Date(ms(p.ts) + MARGEN_MS) }, ultimaVez: { gte: new Date(ms(p.ts) - MARGEN_MS) } })) },
        orderBy: { primeraVez: "desc" }, take: 60,
    });
}
