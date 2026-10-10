import { prisma } from "@/lib/prisma";

/**
 * OmniVision › Accesos (fase 2): lo que pasó por la línea de conteo de una cámara de acceso,
 * cruzado con lo que leyó la cámara.
 *
 * Por qué sobre los CRUCES de la regla de conteo y no sobre el registro de objetos: medido el
 * 10/10 en LPR Salida, el 91 % de las pistas de vehículo eran autos pasando por la calle que
 * corre detrás de la rampa. El registro mira todo el cuadro; la línea, sólo el carril. Y los
 * cruces en el sentido de salida tenían lectura a ±10 s en 94 de 99: el criterio funciona.
 *
 * Lo que se cuenta:
 *  · el SENTIDO DE PASO es el de la línea que trae lecturas (el otro, en una salida, es alguien
 *    que entra de contramano o un auto de otra calle que pisa la línea);
 *  · cada cruce de paso se empareja con la lectura más cercana a ±VENTANA_S, una lectura por cruce;
 *  · sin lectura: el cruce de paso que se quedó sin pareja;
 *  · posible colado: uno sin lectura pegado (±COLADO_S) a otro que sí la tuvo;
 *  · motos: los cruces de paso de clase moto (si la regla las cuenta, que hoy no);
 *  · cobertura: de los vehículos que la cámara leyó, cuántos vio cruzar la línea. Es la medida
 *    del propio contador: si la línea no ve la mitad de los autos, «sin lectura» se queda corto.
 */

import { VENTANA_S, COLADO_S, MISMO_VEHICULO_S, CRUCES_MIN, PASO_MIN, CLASES_ACCESO, type Sentido, type ResumenAcceso } from "@/lib/accesos-vision-comun";

/** Cuántos «sin lectura» se devuelven con su foto. */
const SIN_LECTURA_MAX = 60;

type Regla = { id: string; nombre: string; tipo: string; deviceId: string; clases?: string[]; activa?: boolean };

export async function resumenAccesos(horas: number): Promise<ResumenAcceso[]> {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - horas * 3600_000);
    const fila = await prisma.setting.findUnique({ where: { key: "VISION_REGLAS" } });
    let reglas: Regla[] = [];
    try { reglas = JSON.parse(fila?.value || "[]"); } catch { reglas = []; }
    const conteos = reglas.filter((r) => r && r.tipo === "conteo" && r.deviceId);
    if (!conteos.length) return [];
    const camaras = await prisma.device.findMany({ where: { id: { in: conteos.map((r) => r.deviceId) }, deviceType: "LPR_CAMERA" }, select: { id: true, name: true } });
    const nombre = new Map(camaras.map((c) => [c.id, c.name]));
    const out: ResumenAcceso[] = [];
    for (const r of conteos) {
        if (!nombre.has(r.deviceId)) continue;  // sólo las cámaras de acceso: las que leen
        out.push(await resumir(r, nombre.get(r.deviceId)!, desde, hasta));
    }
    return out;
}

async function resumir(r: Regla, camara: string, desde: Date, hasta: Date): Promise<ResumenAcceso> {
    const v = VENTANA_S * 1000;
    const [cruces, lecturas] = await Promise.all([
        prisma.eventoVision.findMany({ where: { reglaId: r.id, tipo: "CRUCE", ts: { gte: desde, lte: hasta } }, orderBy: { ts: "asc" }, select: { id: true, ts: true, clase: true, sentido: true, foto: true, caja: true } }),
        prisma.accessEvent.findMany({ where: { deviceId: r.deviceId, timestamp: { gte: new Date(desde.getTime() - v), lte: new Date(hasta.getTime() + v) } }, orderBy: { timestamp: "asc" }, select: { timestamp: true } }),
    ]);
    const tl = lecturas.map((l) => l.timestamp.getTime());
    const hayLectura = (t: number) => tl.some((x) => Math.abs(x - t) <= v);

    const porSentido: ResumenAcceso["porSentido"] = { ab: { cruces: 0, conLectura: 0 }, ba: { cruces: 0, conLectura: 0 } };
    for (const c of cruces) {
        const s = c.sentido === "ba" ? "ba" : "ab";
        porSentido[s].cruces++;
        if (hayLectura(c.ts.getTime())) porSentido[s].conLectura++;
    }
    const frac = (s: Sentido) => porSentido[s].cruces ? porSentido[s].conLectura / porSentido[s].cruces : 0;
    const candidato: Sentido = frac("ab") >= frac("ba") ? "ab" : "ba";
    const sentidoPaso = porSentido[candidato].cruces >= CRUCES_MIN && frac(candidato) >= PASO_MIN ? candidato : null;

    // Emparejar: cada cruce de paso con la lectura libre más cercana dentro de la ventana.
    const pasos = sentidoPaso ? cruces.filter((c) => (c.sentido === "ba" ? "ba" : "ab") === sentidoPaso) : [];
    const usada = new Array(tl.length).fill(false);
    const conPareja = new Map<string, boolean>();
    for (const c of pasos) {
        const t = c.ts.getTime();
        let mejor = -1, dmin = Infinity;
        for (let i = 0; i < tl.length; i++) {
            if (usada[i]) continue;
            const d = Math.abs(tl[i] - t);
            if (d <= v && d < dmin) { dmin = d; mejor = i; }
        }
        if (mejor >= 0) usada[mejor] = true;
        conPareja.set(c.id, mejor >= 0);
    }
    const sinPareja = pasos.filter((c) => !conPareja.get(c.id));
    const esColado = (c: (typeof pasos)[number]) => pasos.some((o) => o.id !== c.id && conPareja.get(o.id) && Math.abs(o.ts.getTime() - c.ts.getTime()) <= COLADO_S * 1000);
    const porClase: Record<string, number> = {};
    for (const c of pasos) porClase[c.clase || "?"] = (porClase[c.clase || "?"] || 0) + 1;

    // Cobertura: las lecturas agrupadas en vehículos, y cuántos tienen un cruce de paso cerca.
    const vehiculos: number[] = [];
    for (const t of tl) if (t >= desde.getTime() && t <= hasta.getTime() && (!vehiculos.length || t - vehiculos[vehiculos.length - 1] > MISMO_VEHICULO_S * 1000)) vehiculos.push(t);
    const tp = pasos.map((c) => c.ts.getTime());
    const leidosConCruce = vehiculos.filter((t) => tp.some((x) => Math.abs(x - t) <= v)).length;

    const clases = Array.isArray(r.clases) ? r.clases : [];
    return {
        deviceId: r.deviceId, camara, regla: { id: r.id, nombre: r.nombre, clases },
        porSentido, sentidoPaso,
        pasos: pasos.length, conLectura: pasos.length - sinPareja.length, sinLectura: sinPareja.length,
        colados: sinPareja.filter(esColado).length, motos: porClase.motorcycle || 0, porClase,
        leidos: vehiculos.length, leidosConCruce,
        sin: sinPareja.slice(-SIN_LECTURA_MAX).reverse().map((c) => ({
            id: c.id, ts: c.ts.toISOString(), clase: c.clase, foto: c.foto, caja: Array.isArray(c.caja) ? (c.caja as number[]) : null, colado: esColado(c),
        })),
        // La regla cuenta sólo las clases que tiene (vision-reglas.js: `r.clases.includes`).
        faltanClases: CLASES_ACCESO.filter((c) => !clases.includes(c)),
    };
}
