import { prisma } from "@/lib/prisma";
import { CANAL_ENTRADA, CANAL_SALIDA, LIMITE_FILA_POR_DEFECTO } from "@/lib/filas/constantes";
import { DESFASAJE_UY_MS, enMontevideo } from "@/lib/filas/horario";
import { limitesPorFila } from "@/lib/filas/demora";

/**
 * Medidas de una fila que no dependen de emparejar a cada persona (HB, 20/10).
 *
 * Por qué no «la espera de cada persona»: se probó con los datos de HB (3 días) y no sirve con la
 * cámara como está. Las líneas de Entrada y Salida no cuadran (524 contra 316) y el aforo parpadea
 * (el calibrador midió 52%); emparejando la n-ésima entrada con la n-ésima salida, la mediana daba
 * 5 segundos en una sala con sillas. Lo honesto con estos datos es:
 *   · el aforo PONDERADO POR TIEMPO (un parpadeo de un segundo pesa un segundo, no una lectura);
 *   · la permanencia media por la ley de Little (gente promedio ÷ ritmo de salida);
 *   · y decir, al lado, qué tan confiable es el dato (calidadDelDato).
 * La espera por persona con percentiles queda para cuando la Bosch tenga una línea en el puesto.
 */

const MIN = 60_000;
export const TRAMO_MIN = 15;
const TRAMO_MS = TRAMO_MIN * MIN;
export const TRAMOS_DIA = (24 * 60) / TRAMO_MIN;
/** Una reversión más corta que esto (sube y vuelve, o baja y vuelve) es un parpadeo. */
const PARPADEO_MS = 3_000;
/** Sin lecturas por más de esto, el último valor deja de valer (la cámara pudo estar caída). */
const VALOR_VIGENTE_MS = 30 * MIN;

export type Lectura = { t: number; v: number };

/** Aforo de una fila entre dos instantes, ordenado, con el valor que venía de antes. */
export async function lecturasAforo(deviceId: string, desde: Date, hasta: Date): Promise<Lectura[]> {
    const noCruce = { NOT: { channelName: { in: [CANAL_ENTRADA, CANAL_SALIDA] } } };
    const [previa, filas] = await Promise.all([
        prisma.queueEvent.findFirst({ where: { deviceId, timestamp: { lt: desde }, ...noCruce }, orderBy: { timestamp: "desc" }, select: { timestamp: true, peopleCount: true } }),
        prisma.queueEvent.findMany({ where: { deviceId, timestamp: { gte: desde, lte: hasta }, ...noCruce }, orderBy: { timestamp: "asc" }, select: { timestamp: true, peopleCount: true } }),
    ]);
    const out: Lectura[] = [];
    if (previa && desde.getTime() - previa.timestamp.getTime() < VALOR_VIGENTE_MS) out.push({ t: desde.getTime(), v: previa.peopleCount });
    for (const f of filas) out.push({ t: f.timestamp.getTime(), v: f.peopleCount });
    return out;
}

/**
 * Promedio ponderado por tiempo y máximo, por tramos de TRAMO_MIN desde `inicio`.
 * Un tramo sin dato vigente queda en null (no en 0: «no sabemos» no es «vacía»).
 */
export function porTramos(lecturas: Lectura[], inicio: number, n: number): { prom: number | null; max: number | null }[] {
    const tramos = Array.from({ length: n }, () => ({ area: 0, ms: 0, max: null as number | null }));
    for (let i = 0; i < lecturas.length; i++) {
        const a = lecturas[i];
        const fin = Math.min(i + 1 < lecturas.length ? lecturas[i + 1].t : Date.now(), a.t + VALOR_VIGENTE_MS);
        let t = Math.max(a.t, inicio);
        while (t < fin) {
            const k = Math.floor((t - inicio) / TRAMO_MS);
            if (k >= n) break;
            const finTramo = inicio + (k + 1) * TRAMO_MS;
            const hasta = Math.min(fin, finTramo);
            if (k >= 0) {
                tramos[k].area += a.v * (hasta - t);
                tramos[k].ms += hasta - t;
                tramos[k].max = Math.max(tramos[k].max ?? 0, a.v);
            }
            t = hasta;
        }
    }
    return tramos.map((x) => (x.ms > 0 ? { prom: x.area / x.ms, max: x.max } : { prom: null, max: null }));
}

/** Medianoche (Montevideo) del día de `t`, como instante. */
export function medianocheUy(t: number): number {
    const u = new Date(t - DESFASAJE_UY_MS);
    return Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()) + DESFASAJE_UY_MS;
}

/* ── Calidad del dato ─────────────────────────────────────────────────────────── */

export type Calidad = {
    tono: "bien" | "aviso" | "mal" | "quieto";
    resumen: string;
    parpadeoPct: number | null;
    entradas: number; salidas: number; balancePct: number | null;
    coberturaPct: number | null;
    validadas: number; exactasPct: number | null; dentroDeUnoPct: number | null;
    motivos: string[];
};

/** Umbrales del semáforo de calidad. Por encima de «aviso», el número se muestra con reparo. */
const CALIDAD = { parpadeoAviso: 15, parpadeoMal: 35, balanceAviso: 15, balanceMal: 30, coberturaAviso: 95, coberturaMal: 85 };

export async function calidadDelDato(deviceId: string, desde: Date, hasta: Date): Promise<Calidad> {
    const [lect, entradas, salidas, cortes, validaciones] = await Promise.all([
        lecturasAforo(deviceId, desde, hasta),
        prisma.queueEvent.count({ where: { deviceId, channelName: CANAL_ENTRADA, timestamp: { gte: desde, lte: hasta } } }),
        prisma.queueEvent.count({ where: { deviceId, channelName: CANAL_SALIDA, timestamp: { gte: desde, lte: hasta } } }),
        prisma.cameraOutage.findMany({ where: { deviceId, startedAt: { lte: hasta }, OR: [{ endedAt: null }, { endedAt: { gte: desde } }] }, select: { startedAt: true, endedAt: true } }),
        // La validación contra una persona (pantalla Validar conteo), si ya existe en esta instalación.
        (prisma as any).validacionConteo?.findMany?.({ where: { deviceId }, select: { camara: true, humano: true } }).catch(() => []) ?? Promise.resolve([]),
    ]);

    // Parpadeo: cambios que se deshacen en menos de PARPADEO_MS, sobre el total de cambios.
    let cambios = 0, parpadeos = 0;
    for (let i = 1; i < lect.length; i++) {
        if (lect[i].v === lect[i - 1].v) continue;
        cambios++;
        const sig = lect[i + 1];
        if (sig && sig.v === lect[i - 1].v && sig.t - lect[i].t < PARPADEO_MS) parpadeos++;
    }
    const parpadeoPct = cambios >= 20 ? Math.round((parpadeos / cambios) * 100) : null;
    const balancePct = Math.max(entradas, salidas) >= 20 ? Math.round((Math.abs(entradas - salidas) / Math.max(entradas, salidas)) * 100) : null;
    const span = hasta.getTime() - desde.getTime();
    const caido = cortes.reduce((s: number, c: any) => s + Math.max(0, Math.min(hasta.getTime(), (c.endedAt || hasta).getTime()) - Math.max(desde.getTime(), c.startedAt.getTime())), 0);
    const coberturaPct = span > 0 ? Math.round((1 - caido / span) * 1000) / 10 : null;
    const vs = (validaciones || []) as { camara: number; humano: number }[];
    const exactasPct = vs.length ? Math.round((vs.filter((v) => v.camara === v.humano).length / vs.length) * 100) : null;
    const dentroDeUnoPct = vs.length ? Math.round((vs.filter((v) => Math.abs(v.camara - v.humano) <= 1).length / vs.length) * 100) : null;

    const motivos: string[] = [];
    let peor = 0; // 0 bien, 1 aviso, 2 mal
    const marcar = (nivel: number, texto: string) => { peor = Math.max(peor, nivel); motivos.push(texto); };
    if (parpadeoPct != null) {
        if (parpadeoPct >= CALIDAD.parpadeoMal) marcar(2, `El aforo parpadea mucho (${parpadeoPct}% de los cambios se deshacen en segundos): subir el rebote de la zona en Calibración.`);
        else if (parpadeoPct >= CALIDAD.parpadeoAviso) marcar(1, `El aforo parpadea (${parpadeoPct}% de los cambios).`);
    }
    if (balancePct != null) {
        if (balancePct >= CALIDAD.balanceMal) marcar(2, `Entradas y salidas no cuadran (${entradas} contra ${salidas}): revisar las líneas de cruce de la cámara.`);
        else if (balancePct >= CALIDAD.balanceAviso) marcar(1, `Entradas y salidas difieren un ${balancePct}%.`);
    }
    if (coberturaPct != null) {
        if (coberturaPct < CALIDAD.coberturaMal) marcar(2, `La cámara estuvo sin datos el ${Math.round(100 - coberturaPct)}% del tiempo.`);
        else if (coberturaPct < CALIDAD.coberturaAviso) marcar(1, `La cámara estuvo sin datos el ${Math.round(100 - coberturaPct)}% del tiempo.`);
    }
    if (dentroDeUnoPct != null && dentroDeUnoPct < 90) marcar(dentroDeUnoPct < 75 ? 2 : 1, `Contra una persona, acierta con ±1 el ${dentroDeUnoPct}% de las veces.`);
    if (!vs.length) motivos.push("Todavía no se validó contra un conteo a mano.");

    const sinDatos = parpadeoPct == null && balancePct == null;
    const tono = sinDatos ? "quieto" : peor === 2 ? "mal" : peor === 1 ? "aviso" : "bien";
    const resumen = sinDatos ? "Pocos datos para juzgar" : tono === "bien" ? "Dato confiable" : tono === "aviso" ? "Dato con reparos" : "Dato poco confiable";
    return { tono, resumen, parpadeoPct, entradas, salidas, balancePct, coberturaPct, validadas: vs.length, exactasPct, dentroDeUnoPct, motivos };
}

/* ── Permanencia (Little) ─────────────────────────────────────────────────────── */

/** Permanencia media en la zona (min) = gente promedio ÷ salidas por minuto. null sin salidas. */
export async function permanenciaMedia(deviceId: string, desde: Date, hasta: Date): Promise<{ min: number | null; gentePromedio: number | null; salidasPorHora: number }> {
    const [lect, salidas] = await Promise.all([
        lecturasAforo(deviceId, desde, hasta),
        prisma.queueEvent.count({ where: { deviceId, channelName: CANAL_SALIDA, timestamp: { gte: desde, lte: hasta } } }),
    ]);
    const n = Math.ceil((hasta.getTime() - desde.getTime()) / TRAMO_MS);
    const tr = porTramos(lect, desde.getTime(), n).filter((x) => x.prom != null);
    const gente = tr.length ? tr.reduce((s, x) => s + (x.prom as number), 0) / tr.length : null;
    const minutos = (tr.length * TRAMO_MS) / MIN;
    const porMin = minutos > 0 ? salidas / minutos : 0;
    return {
        min: gente != null && porMin > 0 ? Math.round((gente / porMin) * 10) / 10 : null,
        gentePromedio: gente != null ? Math.round(gente * 10) / 10 : null,
        salidasPorHora: Math.round(porMin * 60),
    };
}

/* ── Pronóstico ───────────────────────────────────────────────────────────────── */

/** Semanas de historia para la semana típica. Cuatro: un mes reciente pesa más que un año viejo. */
const SEMANAS_HISTORIA = 4;
/** Cuánto hacia adelante mira el aviso anticipado. */
export const ANTICIPO_MIN = 45;
/** Cuánto de hoy se usa para ajustar el pronóstico («hoy viene 30% más cargado que lo normal»). */
const AJUSTE_VENTANA_MIN = 60;
/** El ajuste de hoy contra lo típico no se lleva a extremos con poca historia. */
const AJUSTE_MIN = 0.5, AJUSTE_MAX = 2;
const CACHE_MS = 5 * MIN;

export type Semana = { dia: number; tramo: number; prom: number | null; sobrePct: number | null; muestras: number }[];
export type Pronostico = {
    deviceId: string; fila: string; limite: number;
    semana: Semana;
    hoy: { tramo: number; real: number | null; tipico: number | null; ajustado: number | null }[];
    ahora: { aforo: number | null; tramo: number; ajuste: number | null };
    seLlena: { a: string; enMin: number; aforoEsperado: number } | null;
    franjas: { dia: number; desde: string; hasta: string; sobrePct: number; prom: number }[];
    calidad: Calidad;
    permanencia: { hoy: Awaited<ReturnType<typeof permanenciaMedia>>; semana: Awaited<ReturnType<typeof permanenciaMedia>> };
};

const g = globalThis as unknown as { __pronostico?: Map<string, { t: number; p: Pronostico }> };
const cache: Map<string, { t: number; p: Pronostico }> = (g.__pronostico ||= new Map());

export const hhmmDeTramo = (k: number) => `${String(Math.floor((k * TRAMO_MIN) / 60)).padStart(2, "0")}:${String((k * TRAMO_MIN) % 60).padStart(2, "0")}`;

export async function pronosticoFila(deviceId: string, ahoraD = new Date()): Promise<Pronostico> {
    const c = cache.get(deviceId);
    if (c && Date.now() - c.t < CACHE_MS) return actualizarAhora(c.p, deviceId, ahoraD);

    const ahora = ahoraD.getTime();
    const hoy0 = medianocheUy(ahora);
    const desde = hoy0 - SEMANAS_HISTORIA * 7 * 24 * 60 * MIN;
    const [dev, limites, lect] = await Promise.all([
        prisma.device.findUnique({ where: { id: deviceId }, select: { name: true } }),
        limitesPorFila(),
        lecturasAforo(deviceId, new Date(desde), ahoraD),
    ]);
    const limite = limites[deviceId] ?? LIMITE_FILA_POR_DEFECTO;

    // La historia día por día (sin hoy), por tramos.
    const acum = Array.from({ length: 8 }, () => Array.from({ length: TRAMOS_DIA }, () => ({ suma: 0, n: 0, sobre: 0 })));
    for (let d = desde; d < hoy0; d += 24 * 60 * MIN) {
        const dia = enMontevideo(new Date(d + 12 * 60 * MIN)).dow;
        const lectDia = lect.filter((x) => x.t >= d - VALOR_VIGENTE_MS && x.t < d + 24 * 60 * MIN);
        if (!lectDia.length) continue;
        const tr = porTramos(lectDia, d, TRAMOS_DIA);
        tr.forEach((x, k) => {
            if (x.prom == null) return;
            const a = acum[dia][k];
            a.suma += x.prom; a.n++; if ((x.max ?? 0) >= limite) a.sobre++;
        });
    }
    const semana: Semana = [];
    for (let dia = 1; dia <= 7; dia++) for (let k = 0; k < TRAMOS_DIA; k++) {
        const a = acum[dia][k];
        semana.push({ dia, tramo: k, prom: a.n ? Math.round((a.suma / a.n) * 10) / 10 : null, sobrePct: a.n ? Math.round((a.sobre / a.n) * 100) : null, muestras: a.n });
    }

    // Franjas para reforzar: tramos seguidos donde la fila suele llegar al límite (≥ 1 de cada 3 días).
    const franjas: Pronostico["franjas"] = [];
    for (let dia = 1; dia <= 7; dia++) {
        let ini = -1, suma = 0, sumaP = 0, n = 0;
        for (let k = 0; k <= TRAMOS_DIA; k++) {
            const s = k < TRAMOS_DIA ? semana[(dia - 1) * TRAMOS_DIA + k] : null;
            const caliente = !!s && s.muestras >= 2 && (s.sobrePct ?? 0) >= 34;
            if (caliente) { if (ini < 0) ini = k; suma += s!.sobrePct!; sumaP += s!.prom ?? 0; n++; }
            else if (ini >= 0) { franjas.push({ dia, desde: hhmmDeTramo(ini), hasta: hhmmDeTramo(k), sobrePct: Math.round(suma / n), prom: Math.round((sumaP / n) * 10) / 10 }); ini = -1; suma = 0; sumaP = 0; n = 0; }
        }
    }
    franjas.sort((a, b) => b.sobrePct - a.sobrePct);

    const [calidad, permHoy, permSemana] = await Promise.all([
        calidadDelDato(deviceId, new Date(ahora - 7 * 24 * 60 * MIN), ahoraD),
        permanenciaMedia(deviceId, new Date(hoy0), ahoraD),
        permanenciaMedia(deviceId, new Date(ahora - 7 * 24 * 60 * MIN), ahoraD),
    ]);

    const p: Pronostico = {
        deviceId, fila: dev?.name || "Fila", limite, semana, hoy: [], ahora: { aforo: null, tramo: 0, ajuste: null }, seLlena: null,
        franjas: franjas.slice(0, 8), calidad, permanencia: { hoy: permHoy, semana: permSemana },
    };
    cache.set(deviceId, { t: Date.now(), p });
    return actualizarAhora(p, deviceId, ahoraD);
}

/** Lo que cambia minuto a minuto: la curva de hoy, el ajuste y el aviso anticipado. */
async function actualizarAhora(base: Pronostico, deviceId: string, ahoraD: Date): Promise<Pronostico> {
    const ahora = ahoraD.getTime();
    const hoy0 = medianocheUy(ahora);
    const dia = enMontevideo(ahoraD).dow;
    const lect = await lecturasAforo(deviceId, new Date(hoy0), ahoraD);
    const real = porTramos(lect, hoy0, TRAMOS_DIA);
    const kAhora = Math.floor((ahora - hoy0) / TRAMO_MS);
    const tipico = base.semana.filter((s) => s.dia === dia).map((s) => s.prom);

    // ¿Hoy viene más o menos cargado que lo típico? Última hora real contra la típica.
    const ventana = AJUSTE_VENTANA_MIN / TRAMO_MIN;
    let r = 0, t = 0;
    for (let k = Math.max(0, kAhora - ventana); k <= kAhora; k++) { if (real[k].prom != null && tipico[k] != null) { r += real[k].prom!; t += tipico[k]!; } }
    const ajuste = t > 0.5 ? Math.min(AJUSTE_MAX, Math.max(AJUSTE_MIN, r / t)) : null;

    const hoy = real.map((x, k) => ({
        tramo: k,
        real: k <= kAhora && x.prom != null ? Math.round(x.prom * 10) / 10 : null,
        tipico: tipico[k] ?? null,
        ajustado: k > kAhora && tipico[k] != null ? Math.round(tipico[k]! * (ajuste ?? 1) * 10) / 10 : null,
    }));

    // Aviso anticipado: el primer tramo de los próximos ANTICIPO_MIN donde lo esperado llega al límite.
    const aforo = lect.length ? lect[lect.length - 1].v : null;
    let seLlena: Pronostico["seLlena"] = null;
    if (aforo == null || aforo < base.limite) {
        for (let k = kAhora + 1; k <= kAhora + ANTICIPO_MIN / TRAMO_MIN && k < TRAMOS_DIA; k++) {
            const esperado = hoy[k].ajustado;
            if (esperado != null && esperado >= base.limite) {
                seLlena = { a: hhmmDeTramo(k), enMin: Math.max(1, Math.round((hoy0 + k * TRAMO_MS - ahora) / MIN)), aforoEsperado: esperado };
                break;
            }
        }
    }
    return { ...base, hoy, ahora: { aforo, tramo: kAhora, ajuste: ajuste != null ? Math.round(ajuste * 100) / 100 : null }, seLlena };
}
