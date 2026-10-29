/**
 * Lecturas de cámara: el registro de cada LPR (copiado por camara-log.js) al lado de lo que recibió
 * OmniAccess (AccessEvent) y de lo que releyó OmniVision (Relectura), apareado por tiempo. Lo usan
 * la pantalla (/api/lpr/lecturas-camara) y el informe en PDF y Excel (…/informe): una sola manera de
 * aparear, así el informe dice lo mismo que la pantalla.
 *
 * Cómo se aparea: las capturas seguidas de la cámara forman un PASO (ver abajo) y cada evento va
 * al paso de su cámara cuya ventana (±VENTANA_MS) lo contiene. Cada fila es una de:
 *  · coincide  — OmniAccess recibió la chapa que más leyó la cámara (o las dos «sin leer»);
 *  · variante  — recibió una de las otras lecturas de la cámara en ese paso (AI4301 por MAI4301);
 *  · distinta  — llegó un evento a esa hora pero con una chapa que la cámara nunca leyó;
 *  · perdida   — la cámara la tiene y a OmniAccess no le llegó nada: el caso que no se veía;
 *  · solo      — OmniAccess tiene el evento y la cámara no lo registra. Sólo se cuenta dentro
 *                de lo que el registro cubre (desde la primera copia); antes, no se sabe.
 */
import { prisma } from "@/lib/prisma";
import { leerAjuste } from "@/lib/ajustes-db";
import { normalizarMatricula } from "@/lib/lista-negra";

export type EstadoPaso = "coincide" | "variante" | "distinta" | "perdida" | "solo";
export type VisionLectura = { plate: string | null; estado: string; confianza: number | null; recorte: string | null; chapa: string | null; otras: any[] };
export type EventoLectura = { id: string; ts: string; plate: string | null; decision: string; sentido: string; foto: string | null; chapaCamara: string | null; vision: VisionLectura | null };
export type FilaLectura = {
    id: string; ts: string; hasta: string; deviceId: string | null; camara: string;
    cam: null | { plate: string | null; variantes: { plate: string; veces: number }[]; capturas: number; sinLeer: number; pais: string | null; sentido: string | null };
    eventos: EventoLectura[]; estado: EstadoPaso;
};
export type CamaraLectura = { id: string; nombre: string; total: number; desde: string | null; hasta: string | null; copia: { ultimo: string | null; error: string | null } | null };
export type ResumenLecturas = { pasos: number; capturas: number; coincide: number; variante: number; distinta: number; perdida: number; solo: number; desfasajeMs: number | null; sinLeerCamara: number };

/** Hasta cuánta diferencia de reloj se acepta entre la captura de la cámara y el evento recibido. */
const VENTANA_MS = 10_000;
/**
 * Tope de capturas por consulta. Antes era 3000 y con orden ascendente: en 24 h el lab ya hace
 * ~6000, así que se quedaban las más viejas y se perdían las de las últimas horas sin aviso. Ahora
 * el tope es para no tumbar el servidor (30 días de tres cámaras son ~200 000), y si se llega se
 * dice (`truncado`).
 */
const CAPTURAS_MAX = 250_000;
/** Dos capturas de la misma cámara a menos de esto son el mismo vehículo pasando (si la chapa se parece). */
const PASO_GAP_MS = 4000;
/** Con la misma chapa (o parecida) se acepta un hueco más largo: el auto frena frente a la cámara. */
const PASO_MISMA_MS = 15_000;
/** Dos lecturas son «del mismo auto» si una contiene a la otra o difieren en hasta dos caracteres (AI4301 / MAI4301 / THI4301). */
function parecidas(a: string, b: string) {
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return false;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[n] <= 2;
}
/**
 * Lo que no es una chapa, YA NORMALIZADO: normalizarMatricula saca todo lo que no es letra o número,
 * así que «NO_LEIDA» llega como «NOLEIDA» y «S/P» como «SP». Antes la lista tenía las formas sin
 * normalizar y nunca coincidía: un paso donde la cámara no leyó y el evento llegó NO_LEIDA contaba
 * como «otra chapa» (en el lab, 6187 de 6200 «otra chapa» de una semana eran eso).
 */
const NO_LEIDAS = new Set(["NOLEIDA", "UNKNOWN", "SP", ""]);
const chapa = (p: string | null | undefined) => { const n = normalizarMatricula(p || ""); return n && !NO_LEIDAS.has(n) ? n : null; };

export async function compararLecturas(opc: { desde: Date; hasta?: Date; camaras?: string[] }): Promise<{
    camaras: CamaraLectura[]; filas: FilaLectura[]; resumen: ResumenLecturas | null; estado: { t: string; cadaMs: number } | null; truncado: boolean;
}> {
    const desde = opc.desde, hasta = opc.hasta || new Date();
    // Las cámaras que tienen registro copiado, con su estado de copia.
    const [conRegistro, estadoCrudo] = await Promise.all([
        prisma.lecturaCamara.groupBy({ by: ["deviceId"], _count: { _all: true }, _min: { ts: true }, _max: { ts: true } }),
        leerAjuste("CAMARA_LOG_ESTADO"),
    ]);
    let estado: any = null;
    try { estado = JSON.parse(estadoCrudo?.value || "null"); } catch { estado = null; }
    const ids = conRegistro.map((c) => c.deviceId);
    const nombres = new Map((await prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    const camaras = conRegistro.map((c) => ({
        id: c.deviceId, nombre: nombres.get(c.deviceId) || c.deviceId, total: c._count._all,
        desde: c._min.ts?.toISOString() || null, hasta: c._max.ts?.toISOString() || null,
        copia: estado?.camaras?.[c.deviceId] ? { ultimo: estado.camaras[c.deviceId].ultimo, error: estado.camaras[c.deviceId].error } : null,
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const elegidas = opc.camaras?.length ? ids.filter((i) => opc.camaras!.includes(i)) : ids;
    const est = estado ? { t: estado.t as string, cadaMs: estado.cadaMs as number } : null;
    if (!elegidas.length) return { camaras, filas: [] as FilaLectura[], resumen: null, estado: est, truncado: false };

    const [deCamara, eventos] = await Promise.all([
        prisma.lecturaCamara.findMany({ where: { deviceId: { in: elegidas }, ts: { gte: desde, lte: hasta } }, orderBy: { ts: "asc" }, take: CAPTURAS_MAX }),
        prisma.accessEvent.findMany({
            where: { deviceId: { in: elegidas }, timestamp: { gte: new Date(desde.getTime() - VENTANA_MS), lte: new Date(hasta.getTime() + VENTANA_MS) } },
            select: { id: true, timestamp: true, deviceId: true, plateDetected: true, decision: true, direction: true, snapshotPath: true, imagePath: true, details: true },
            orderBy: { timestamp: "asc" }, take: CAPTURAS_MAX,
        }),
    ]);
    const relecturas = eventos.length ? await prisma.relectura.findMany({
        where: { accessEventId: { in: eventos.map((e) => e.id) } }, select: { accessEventId: true, plate: true, estado: true, confianza: true, recorte: true, recorteChapa: true, candidatos: true },
    }) : [];
    const releida = new Map(relecturas.map((r) => [r.accessEventId, r]));
    /*
     * Lo que necesita la comparación (16/10, Nico: «un drawer que haga la comparativa, con zoom en
     * la matrícula»): además de la chapa, el recorte de la chapa que mandó la cámara (PlateCrop en
     * los detalles, o la imagen de la matrícula) y los recortes de OmniVision (vehículo y chapa).
     */
    const recorteCamara = (e: { details: string | null; imagePath: string | null; snapshotPath: string | null }) => {
        const pc = (String(e.details || "").match(/PlateCrop:\s*([^,]+)/)?.[1] || "").trim();
        return pc || (e.imagePath && e.imagePath !== e.snapshotPath ? e.imagePath : null);
    };
    const vistaDe = (r: (typeof relecturas)[number] | undefined) => r ? {
        plate: r.plate, estado: r.estado, confianza: r.confianza,
        recorte: r.recorte ? `/api/vision/imagen/${r.recorte}` : null, chapa: r.recorteChapa ? `/api/vision/imagen/${r.recorteChapa}` : null,
        otras: Array.isArray((r.candidatos as any)?.otras) ? (r.candidatos as any).otras.slice(0, 4) : [],
    } : null;
    const cubreDesde = new Map(conRegistro.map((c) => [c.deviceId, c._min.ts?.getTime() ?? Infinity]));

    /*
     * Los PASOS. La cámara no lee una vez por vehículo: dispara a cada segundo mientras lo tiene
     * en cuadro (medido el 16/10 en LPR Salida: SBF2974 seis veces en 5 s, MAI4301/AI4301/THI4301
     * siete veces en 10 s), y a OmniAccess le manda una o dos alarmas por vehículo. Comparar
     * captura por captura daba casi todo «no llegó». Se agrupan las capturas seguidas (menos de
     * PASO_GAP_MS entre una y otra) en un paso, que se aparea con los eventos de su ventana.
     */
    type Ev = (typeof eventos)[number];
    type Paso = { deviceId: string; capturas: typeof deCamara; desde: number; hasta: number; eventos: Ev[] };
    const pasos: Paso[] = [];
    const ultimoPaso = new Map<string, Paso>();
    for (const l of deCamara) {
        const t = l.ts.getTime(), u = ultimoPaso.get(l.deviceId), cp = chapa(l.plate);
        // Sigue el mismo paso si es seguido Y parece la misma chapa (o la cámara no leyó): dos
        // autos pegados (SC68818 4 s después de MAI4301) son dos pasos, y el mismo auto que
        // vuelve a leerse a los 5-12 s (MAI4301 a las :39 y a las :49) sigue siendo uno.
        const parecida = !cp || !u || u.capturas.every((c) => !chapa(c.plate)) || u.capturas.some((c) => { const k = chapa(c.plate); return !!k && parecidas(k, cp); });
        if (u && parecida && t - u.hasta <= (cp ? PASO_MISMA_MS : PASO_GAP_MS)) { u.capturas.push(l); u.hasta = t; continue; }
        const p: Paso = { deviceId: l.deviceId, capturas: [l], desde: t, hasta: t, eventos: [] };
        pasos.push(p); ultimoPaso.set(l.deviceId, p);
    }
    // La chapa del paso: la que más veces leyó la cámara (con empate, la más larga: «AI4301» es «MAI4301» cortada).
    const chapaDelPaso = (p: Paso) => {
        const n = new Map<string, number>();
        for (const c of p.capturas) { const k = chapa(c.plate); if (k) n.set(k, (n.get(k) || 0) + 1); }
        return [...n.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([k, v]) => ({ plate: k, veces: v }));
    };
    const usados = new Set<string>();
    const desfasajes: number[] = [];
    for (const e of eventos) {
        const t = e.timestamp.getTime();
        let mejor: Paso | null = null, dist = Infinity;
        for (const p of pasos) {
            if (p.deviceId !== e.deviceId || t < p.desde - VENTANA_MS || t > p.hasta + VENTANA_MS) continue;
            const d = t < p.desde ? p.desde - t : t > p.hasta ? t - p.hasta : 0;
            if (d < dist) { mejor = p; dist = d; }
        }
        if (mejor) { mejor.eventos.push(e); usados.add(e.id); desfasajes.push(t - mejor.desde); }
    }
    const filas: FilaLectura[] = [];
    for (const p of pasos) {
        const variantes = chapaDelPaso(p);
        const principal = variantes[0]?.plate || null;
        const conocidas = new Set(variantes.map((v) => v.plate));
        const evs = p.eventos.map((e) => {
            const r = releida.get(e.id);
            return { id: e.id, ts: e.timestamp.toISOString(), plate: e.plateDetected, decision: String(e.decision), sentido: String(e.direction), foto: e.snapshotPath || e.imagePath || null,
                chapaCamara: recorteCamara(e), vision: vistaDe(r) };
        });
        const chapasEv = evs.map((e) => chapa(e.plate));
        const estadoP = !evs.length ? "perdida"
            : chapasEv.some((c) => c && c === principal) || (!principal && chapasEv.every((c) => !c)) ? "coincide"
                : chapasEv.some((c) => c && conocidas.has(c)) ? "variante" : "distinta";
        const sentidoCam = p.capturas.map((c) => c.sentido).find((x) => x && x !== "unknown") || null;
        filas.push({
            id: p.capturas[0].id, ts: new Date(p.desde).toISOString(), hasta: new Date(p.hasta).toISOString(), deviceId: p.deviceId, camara: nombres.get(p.deviceId) || "",
            cam: { plate: principal, variantes, capturas: p.capturas.length, sinLeer: p.capturas.filter((c) => !chapa(c.plate)).length, pais: p.capturas.find((c) => c.pais && c.pais !== "NON")?.pais || null, sentido: sentidoCam },
            eventos: evs, estado: estadoP,
        });
    }
    for (const e of eventos) {
        if (usados.has(e.id) || e.timestamp < desde || e.timestamp > hasta) continue;
        if (e.timestamp.getTime() < (cubreDesde.get(e.deviceId || "") ?? Infinity)) continue;
        const r = releida.get(e.id);
        filas.push({
            id: `e-${e.id}`, ts: e.timestamp.toISOString(), hasta: e.timestamp.toISOString(), deviceId: e.deviceId, camara: nombres.get(e.deviceId || "") || "",
            cam: null,
            eventos: [{ id: e.id, ts: e.timestamp.toISOString(), plate: e.plateDetected, decision: String(e.decision), sentido: String(e.direction), foto: e.snapshotPath || e.imagePath || null, chapaCamara: recorteCamara(e), vision: vistaDe(r) }],
            estado: "solo",
        });
    }
    filas.sort((a, b) => b.ts.localeCompare(a.ts));
    const cuenta = (k: string) => filas.filter((f) => f.estado === k).length;
    const ordenados = [...desfasajes].sort((a, b) => a - b);
    const resumen = {
        pasos: pasos.length, capturas: deCamara.length,
        coincide: cuenta("coincide"), variante: cuenta("variante"), distinta: cuenta("distinta"), perdida: cuenta("perdida"), solo: cuenta("solo"),
        // Cuánto tarda en llegar (o cuánto difieren los relojes): la mediana de evento − captura.
        desfasajeMs: ordenados.length ? ordenados[Math.floor(ordenados.length / 2)] : null,
        sinLeerCamara: pasos.filter((p) => !chapaDelPaso(p).length).length,
    };
    return { camaras, filas, resumen, estado: est, truncado: deCamara.length >= CAPTURAS_MAX || eventos.length >= CAPTURAS_MAX };
}
