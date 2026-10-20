import { prisma } from "@/lib/prisma";
import { celda, dentroDelPoligono, leerEsquinas, lugarDeLaChapa, type Esquinas, type Punto } from "@/lib/franja";
import { confirmarOcupacion, cerrarOcupacion, olvidarFranjas } from "@/lib/ocupaciones";
import { detectar, leerInterruptores } from "@/lib/vision";
import { normalizarChapa } from "@/lib/formato-chapa";
import sharp from "sharp";

/**
 * Estacionamiento como analítica de OmniVision (18/10, Nico: «que sea una analítica más de
 * OmniVision, activable como el resto; auditá, mejorá y corregí lo visual y lo lógico»).
 *
 * La franja sigue siendo la misma —cuatro esquinas sobre el cordón, N lugares que se achican con
 * la perspectiva (lib/franja)— pero quien decide si un lugar está ocupado ya no es la comparación
 * de píxeles contra «cómo se ve vacía»: es OmniVision, que ve el VEHÍCULO. Por qué:
 *
 *  · La comparación de píxeles necesitaba que una persona le enseñara la calle vacía, y sin eso
 *    no medía (en el lab: ninguna franja aprendida, ningún estacionamiento en 7 días). Ver un
 *    auto no necesita referencia.
 *  · La luz, la noche y la sombra mueven los píxeles; no cambian que ahí haya un auto.
 *  · Un camión que pasa por delante tapaba la celda igual que un auto parado; ahora tapa con un
 *    vehículo, y el que estaba sigue ahí debajo.
 *
 * vision-worker mira las cámaras con franja al menos cada ESTAC_CADA_MS aunque la imagen no cambie
 * (un auto quieto no cambia la imagen: con la compuerta normal nunca se analizaría) y manda lo que
 * vio a /api/tracking/franja/vision. Acá se decide, con tiempos y no con «vueltas» (el reloj de
 * vueltas de 60 s se rompía cuando las miradas llegaban cada 20 s, ver la auditoría del 18/10):
 *
 *    ocupa    un vehículo en la celda, sostenido OCUPAR_MS (con huecos de menos de HUECO_MS)
 *    sigue    cada vez que se lo vuelve a ver
 *    libera   LIBERAR_MS sin verlo, CON miradas llegando: sin miradas (cámara caída, worker
 *             parado) no se libera nada — «no sé» no es «se fue».
 *
 * Los avisos y el plano no cambian: la misma Ocupacion, los mismos PARKED / LEFT de lib/ocupaciones.
 */

/** Vehículo sostenido en la celda para abrir la ocupación: un auto que frena para dejar a alguien no estaciona. */
export const OCUPAR_MS = Number(process.env.ESTAC_OCUPAR_SEG || 45) * 1000;
/** Sin ver el vehículo durante esto (con miradas llegando), el lugar queda libre. */
export const LIBERAR_MS = Number(process.env.ESTAC_LIBERAR_SEG || 90) * 1000;
/** Un hueco más corto que esto mientras se confirma no corta la racha (una detección perdida, alguien que pasa delante). */
export const HUECO_MS = Number(process.env.ESTAC_HUECO_SEG || 25) * 1000;
/** Si la última mirada es más vieja que esto, la pantalla dice que no hay datos (y no se libera nada). */
export const MIRADA_VIEJA_MS = 2 * 60_000;
/** Cada cuánto se escribe `hasta` de una ocupación viva: cada mirada sería una escritura cada 15 s por lugar. */
const ESCRIBIR_HASTA_MS = 30_000;
/** Fracción mínima de la base del vehículo dentro de la celda para contarlo ahí. */
const PISO_EN_CELDA = 0.3;
/** Las clases que estacionan. */
const VEHICULOS = new Set(["car", "truck", "bus", "motorcycle"]);

export type VehiculoVisto = { caja: [number, number, number, number]; clase: string; confianza: number; pista?: number | null };

/**
 * ¿En qué lugar está cada vehículo? Se muestrea la BASE de la caja (el 40 % de abajo, donde el
 * auto toca el piso): la caja entera de un auto visto en diagonal invade el lugar de al lado y
 * el de atrás. Cada vehículo va a UN lugar (el que más base contiene) y cada lugar se queda con
 * el vehículo que más lo ocupa.
 */
export function asignar(esq: Esquinas, lugares: number, vehiculos: VehiculoVisto[]): (VehiculoVisto & { fraccion: number })[] {
    const celdas = Array.from({ length: lugares }, (_, i) => celda(esq, i, lugares));
    const porLugar: ((VehiculoVisto & { fraccion: number }) | null)[] = new Array(lugares).fill(null);
    for (const v of vehiculos) {
        if (!VEHICULOS.has(v.clase)) continue;
        const [x1, y1, x2, y2] = v.caja;
        const muestras: Punto[] = [];
        for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) muestras.push({ x: x1 + ((i + 0.5) / 5) * (x2 - x1), y: y2 - (j + 0.5) / 3 * 0.4 * (y2 - y1) });
        let mejor = -1, fr = 0;
        celdas.forEach((c, i) => {
            const f = muestras.filter((p) => dentroDelPoligono(c, p)).length / muestras.length;
            if (f > fr) { fr = f; mejor = i; }
        });
        if (mejor < 0 || fr < PISO_EN_CELDA) continue;
        const ya = porLugar[mejor];
        if (!ya || fr > ya.fraccion) porLugar[mejor] = { ...v, fraccion: fr };
    }
    return porLugar as any;
}

type EstadoLugar = { vistoDesde: number | null; ultimoVisto: number | null; caja: [number, number, number, number] | null; escritoHasta: number };
type EstadoFranja = { franjaId: string; lugares: number; ultimaMirada: number; vehiculos: number; lugaresEst: EstadoLugar[]; cola: Promise<unknown> };
const estados: Map<string, EstadoFranja> = (globalThis as any).__estacionamiento ?? new Map();
(globalThis as any).__estacionamiento = estados;

/** Olvidar el estado en memoria de una cámara (redibujo, borrado). */
export function olvidarEstado(deviceId: string) { estados.delete(deviceId); olvidarFranjas(); }

/** ¿La analítica está prendida? Por defecto sí: sin franja dibujada no mira nada. */
export async function estacionamientoPrendido(): Promise<boolean> {
    try { return (await leerInterruptores()).analiticas.estacionamiento !== false; } catch { return true; }
}

/**
 * Una mirada de OmniVision sobre una cámara con franja. Se procesan de a una por cámara (una
 * cola): dos miradas que se pisen podían abrir dos ocupaciones para el mismo lugar.
 */
export function observar(deviceId: string, ts: number, vehiculos: VehiculoVisto[]) {
    const previo = estados.get(deviceId);
    const cola = (previo?.cola ?? Promise.resolve()).then(() => observarYa(deviceId, ts, vehiculos)).catch((e) => console.error("[estacionamiento]", deviceId, e?.message));
    if (previo) previo.cola = cola;
    return cola;
}

async function observarYa(deviceId: string, ts: number, vehiculos: VehiculoVisto[]) {
    const franja = await prisma.franja.findUnique({ where: { deviceId }, include: { device: { select: { name: true } } } }).catch(() => null);
    if (!franja || !franja.activa) return null;
    const esq = leerEsquinas(franja.esquinas);
    if (!esq) return null;
    let st = estados.get(deviceId);
    if (!st || st.franjaId !== franja.id || st.lugares !== franja.lugares) {
        st = { franjaId: franja.id, lugares: franja.lugares, ultimaMirada: 0, vehiculos: 0, lugaresEst: Array.from({ length: franja.lugares }, () => ({ vistoDesde: null, ultimoVisto: null, caja: null, escritoHasta: 0 })), cola: st?.cola ?? Promise.resolve() };
        estados.set(deviceId, st);
    }
    // Una mirada vieja que llega tarde (después de una más nueva) no cuenta.
    if (ts <= st.ultimaMirada) return null;
    st.ultimaMirada = ts;
    st.vehiculos = vehiculos.filter((v) => VEHICULOS.has(v.clase)).length;
    const nombre = franja.device?.name || deviceId;
    const asignados = asignar(esq, franja.lugares, vehiculos);
    const abiertas = await prisma.ocupacion.findMany({ where: { franjaId: franja.id, cerrada: false }, orderBy: { desde: "asc" } });
    // Una sola abierta por lugar: si hubiera dos (la carrera vieja entre el barrido y la mirada), la más nueva se cierra.
    const porLugar = new Map<number, (typeof abiertas)[number]>();
    for (const o of abiertas) {
        if (o.lugar >= franja.lugares) { await cerrarOcupacion(o as any, nombre).catch(() => null); continue; }
        if (porLugar.has(o.lugar)) { await cerrarOcupacion(o as any, nombre).catch(() => null); continue; }
        porLugar.set(o.lugar, o);
    }
    for (let i = 0; i < franja.lugares; i++) {
        const e = st.lugaresEst[i];
        const v = asignados[i];
        let viva = porLugar.get(i) || null;
        // Después de un reinicio el estado en memoria está vacío: lo último que se sabe de una viva es su `hasta`.
        if (viva && e.ultimoVisto == null) { e.ultimoVisto = viva.hasta.getTime(); e.vistoDesde = viva.desde.getTime(); }
        if (v) {
            if (e.vistoDesde == null || (e.ultimoVisto != null && ts - e.ultimoVisto > HUECO_MS && !viva)) e.vistoDesde = ts;
            e.ultimoVisto = ts; e.caja = v.caja;
            if (!viva && ts - e.vistoDesde >= OCUPAR_MS) {
                viva = await prisma.ocupacion.create({ data: { franjaId: franja.id, deviceId, lugar: i, desde: new Date(e.vistoDesde), hasta: new Date(ts) } }).catch(() => null);
                if (viva) { e.escritoHasta = ts; void nombrarDesdeLecturas(viva.id, deviceId, esq, franja.lugares, i, e.vistoDesde).then((ok) => { if (!ok) void nombrarPorVision(viva!.id, deviceId, v.caja); }); }
            } else if (viva) {
                if (ts - e.escritoHasta >= ESCRIBIR_HASTA_MS) {
                    await prisma.ocupacion.update({ where: { id: viva.id }, data: { hasta: new Date(ts) } }).catch(() => null);
                    e.escritoHasta = ts;
                }
                const avisado = await confirmarOcupacion({ ...viva, hasta: new Date(ts) } as any, nombre).catch(() => false);
                // Al confirmarse, si todavía no tiene nombre, se intenta otra vez leer la chapa.
                if (avisado && !viva.plate) void nombrarPorVision(viva.id, deviceId, v.caja);
            }
        } else {
            if (!viva && e.vistoDesde != null && e.ultimoVisto != null && ts - e.ultimoVisto > HUECO_MS) { e.vistoDesde = null; e.caja = null; }
            if (viva && e.ultimoVisto != null && ts - e.ultimoVisto >= LIBERAR_MS) {
                await prisma.ocupacion.update({ where: { id: viva.id }, data: { hasta: new Date(e.ultimoVisto) } }).catch(() => null);
                await cerrarOcupacion({ ...viva, hasta: new Date(e.ultimoVisto) } as any, nombre).catch(() => null);
                e.vistoDesde = null; e.ultimoVisto = null; e.caja = null;
            }
        }
    }
    return true;
}

/**
 * El nombre por la lectura LPR del auto llegando: la lectora lee la chapa mientras entra al
 * lugar, ANTES de que la ocupación se abra (45 s después), y `nombrarOcupante` sólo nombra una
 * ocupación ya abierta — por eso «estacionó» salía sin chapa. Al abrir se busca la lectura de esa
 * cámara cuyo recuadro cae en ese lugar, desde un rato antes de que empezara a verse.
 */
async function nombrarDesdeLecturas(ocupacionId: string, deviceId: string, esq: Esquinas, lugares: number, lugar: number, desde: number): Promise<boolean> {
    try {
        const filas = await prisma.plateSighting.findMany({
            where: { deviceId, source: "TRACK", timestamp: { gte: new Date(desde - 60_000) }, bbox: { not: null } },
            orderBy: [{ confidence: "desc" }, { timestamp: "desc" }], take: 30,
        });
        for (const f of filas) {
            let caja: any = null; try { caja = JSON.parse(f.bbox || ""); } catch { }
            if (!caja || !Number.isFinite(caja.x)) continue;
            if (lugarDeLaChapa(esq, lugares, caja).lugar !== lugar) continue;
            await prisma.ocupacion.update({ where: { id: ocupacionId }, data: { plate: f.plate, plateConf: f.confidence ?? null, sightingId: f.id } });
            return true;
        }
    } catch { /* sin lectura: se intenta con OmniVision */ }
    return false;
}

/**
 * El nombre del ocupante, leído por OmniVision sobre el vehículo: el cuadro principal (HD) de la
 * cámara, recortado a la caja del vehículo, al OCR. Antes el nombre llegaba sólo si la lectora LPR
 * leía la chapa DESPUÉS de abrirse la ocupación — la lectura del auto llegando ocurre antes — así
 * que «estacionó» salía casi siempre sin chapa.
 */
const GO2RTC = process.env.GO2RTC_API || "http://127.0.0.1:1984";
export async function nombrarPorVision(ocupacionId: string, deviceId: string, caja: [number, number, number, number]) {
    try {
        let jpeg: Buffer | null = null;
        for (const src of [`lpr_${deviceId}_hd`, `lpr_${deviceId}`]) {
            const r = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(src)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
            if (!r?.ok) continue;
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length > 1000) { jpeg = b; break; }
        }
        if (!jpeg) return;
        const { width: W = 0, height: H = 0 } = await sharp(jpeg).metadata();
        const [x1, y1, x2, y2] = caja;
        const mx = (x2 - x1) * 0.08, my = (y2 - y1) * 0.08;
        const left = Math.max(0, Math.floor((x1 - mx) * W)), top = Math.max(0, Math.floor((y1 - my) * H));
        const width = Math.min(W - left, Math.ceil((x2 - x1 + 2 * mx) * W)), height = Math.min(H - top, Math.ceil((y2 - y1 + 2 * my) * H));
        if (width < 24 || height < 16) return;
        let rec = sharp(jpeg).extract({ left, top, width, height });
        if (width < 640) rec = rec.resize({ width: 640, kernel: "lanczos3" });
        const r = await detectar(await rec.jpeg({ quality: 92 }).toBuffer(), { texto: true, umbral: 0.9 });
        let mejor: { plate: string; conf: number } | null = null;
        for (const t of (r as any).textos || []) {
            if (t?.tipo !== "matricula" || t.sobreimpreso) continue;
            const n = Number(t.confianza) >= 0.5 ? normalizarChapa(t.texto) : null;
            if (n && (!mejor || t.confianza > mejor.conf)) mejor = { plate: n.plate, conf: Number(t.confianza) };
        }
        if (!mejor) return;
        const o = await prisma.ocupacion.findUnique({ where: { id: ocupacionId } });
        if (!o || o.cerrada || (o.plate && (o.plateConf ?? 0) >= mejor.conf)) return;
        await prisma.ocupacion.update({ where: { id: ocupacionId }, data: { plate: mejor.plate, plateConf: Math.round(mejor.conf * 1000) / 1000 } });
    } catch { /* sin nombre: queda «sin chapa leída», que es la verdad */ }
}

/** Lo que la pantalla muestra en vivo de una cámara: por lugar, si hay vehículo ahora y desde cuándo. */
export function estadoEnVivo(deviceId: string) {
    const st = estados.get(deviceId);
    if (!st) return null;
    return {
        ultimaMirada: st.ultimaMirada || null,
        vieja: !st.ultimaMirada || Date.now() - st.ultimaMirada > MIRADA_VIEJA_MS,
        vehiculos: st.vehiculos,
        lugares: st.lugaresEst.map((e) => ({ viendo: e.ultimoVisto != null && st!.ultimaMirada - e.ultimoVisto < 1000, vistoDesde: e.vistoDesde, caja: e.caja })),
    };
}
