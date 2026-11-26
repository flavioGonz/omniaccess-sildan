/**
 * Geometría de lectura de OmniVision: carriles, zonas de captura y líneas de cruce (26/11).
 *
 * Nico: «para las cámaras que leen con OmniVision el calibrador no deja dibujar líneas A-B y B-A
 * ni carriles para los disparos LPR; toma toda la imagen como válida. Tiene que dejarme dibujar
 * líneas o zonas de captura para bajar el rebote de lecturas, más premium que las de Hik:
 * carriles, dirección del auto, zonas de captura o línea de cruce vehicular. Algo nuevo, sin
 * afectar lo actual: los dos tienen que convivir».
 *
 * Convive así: si la cámara no tiene geometría (o la tiene apagada), la compuerta de siempre
 * (zona de interés o línea de pasada del calibrador de lectura) sigue igual. Con geometría
 * prendida, decide ésta.
 *
 * Formato (Device.lprGeometria, JSON). Coordenadas en fracciones 0..1 del cuadro ENTERO, origen
 * arriba-izquierda (como la zona y la línea del calibrador de lectura):
 *
 *   { v: 1, activa: true, rebote: 30,
 *     carriles: [{ id, nombre, puntos: [{x,y}…], sentido: "entra"|"sale"|"ambos", flecha: {a:{x,y}, b:{x,y}} }],
 *     zonas:    [{ id, nombre, puntos: [{x,y}…] }],
 *     lineas:   [{ id, nombre, a:{x,y}, b:{x,y}, sentido: "ab"|"ba"|"ambos" }] }
 *
 * Qué decide cada cosa, sobre el centro de la chapa leída:
 *  · Carril: la chapa tiene que caer adentro. Si el carril tiene sentido y se vio al auto moverse,
 *    el movimiento tiene que ir a favor de la flecha (un auto de contramano no se lee como del
 *    carril). Un carril «entra» o «sale» además dice el sentido del evento: una sola cámara que
 *    mira la entrada y la salida separa las dos manos.
 *  · Zona de captura: la chapa tiene que caer adentro. Sin sentido.
 *  · Línea de cruce: la chapa tiene que pasar cerca (una banda, como la línea de pasada) y, si la
 *    línea tiene sentido y se vio el movimiento, cruzar del lado A al B (o al revés).
 *  · Rebote: la misma chapa en el mismo carril (o elemento) dentro de `rebote` segundos se
 *    descarta: es el mismo auto leído en dos ráfagas seguidas.
 *
 * El movimiento sale de la propia ráfaga: las lecturas del mismo vehículo en cuadros distintos.
 * Si no hay dos lecturas separadas (o el auto apenas se movió) no se sabe el sentido, y entonces
 * NO se descarta por sentido: mejor una lectura de más que perder la del auto que más interesa.
 *
 * Puro y sin dependencias: lo usan el worker (CJS), la pantalla y las pruebas.
 */

const SENTIDOS_CARRIL = new Set(["entra", "sale", "ambos"]);
const SENTIDOS_LINEA = new Set(["ab", "ba", "ambos"]);
/** Desplazamiento mínimo (en alturas de cuadro) para decir que el auto se movió en la ráfaga. */
const MOV_MIN = 0.015;
/** La banda de la línea de cruce, en alturas de cuadro (como la línea de pasada del worker). */
const BANDA_MIN = 0.04, BANDA_MAX = 0.12, BANDA_ALTURAS = 2.5;
const REBOTE_DEF = 30, REBOTE_MAX = 600;

const num = (v) => typeof v === "number" && Number.isFinite(v);
const punto = (p) => (p && num(p.x) && num(p.y) ? { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) } : null);
const texto = (v, max = 40) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** El JSON guardado → geometría válida, o null si no hay nada que aplicar (vacía, apagada o rota). */
function leerGeometria(crudo) {
    let g = crudo;
    if (typeof crudo === "string") { try { g = JSON.parse(crudo); } catch { return null; } }
    const n = normalizar(g);
    if (!n || !n.activa) return null;
    if (!n.carriles.length && !n.zonas.length && !n.lineas.length) return null;
    return n;
}

/** Normaliza lo que manda la pantalla: descarta lo inválido, limita tamaños. Devuelve aunque esté apagada. */
function normalizar(g) {
    if (!g || typeof g !== "object") return null;
    const poligono = (l) => (Array.isArray(l) ? l.map(punto).filter(Boolean).slice(0, 24) : []);
    const id = (v, i, pre) => texto(v, 24) || `${pre}${i + 1}`;
    const carriles = (Array.isArray(g.carriles) ? g.carriles : []).slice(0, 8).map((c, i) => {
        const puntos = poligono(c && c.puntos);
        const a = punto(c && c.flecha && c.flecha.a), b = punto(c && c.flecha && c.flecha.b);
        return { id: id(c && c.id, i, "c"), nombre: texto(c && c.nombre) || `Carril ${i + 1}`, puntos, sentido: SENTIDOS_CARRIL.has(c && c.sentido) ? c.sentido : "ambos", flecha: a && b ? { a, b } : null };
    }).filter((c) => c.puntos.length >= 3);
    const zonas = (Array.isArray(g.zonas) ? g.zonas : []).slice(0, 8).map((z, i) => ({ id: id(z && z.id, i, "z"), nombre: texto(z && z.nombre) || `Zona ${i + 1}`, puntos: poligono(z && z.puntos) })).filter((z) => z.puntos.length >= 3);
    const lineas = (Array.isArray(g.lineas) ? g.lineas : []).slice(0, 8).map((l, i) => ({ id: id(l && l.id, i, "l"), nombre: texto(l && l.nombre) || `Línea ${i + 1}`, a: punto(l && l.a), b: punto(l && l.b), sentido: SENTIDOS_LINEA.has(l && l.sentido) ? l.sentido : "ambos" })).filter((l) => l.a && l.b && Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y) > 0.01);
    const rebote = num(g.rebote) ? Math.min(REBOTE_MAX, Math.max(0, Math.round(g.rebote))) : REBOTE_DEF;
    return { v: 1, activa: g.activa !== false, rebote, carriles, zonas, lineas };
}

/** ¿El punto cae adentro del polígono? (par/impar de cruces). */
function dentroDePoligono(p, puntos) {
    let dentro = false;
    for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
        const a = puntos[i], b = puntos[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
    }
    return dentro;
}

const centro = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * El movimiento del vehículo en la ráfaga: del primer recuadro al último (por número de cuadro).
 * La x se corrige por la relación de aspecto para que «derecho» sea derecho en la imagen.
 * null = no se sabe (una sola lectura, o se movió menos que MOV_MIN).
 */
function movimiento(lecturas) {
    const l = (lecturas || []).filter((x) => x && x.recuadro && num(x.cuadro)).sort((a, b) => a.cuadro - b.cuadro);
    if (l.length < 2) return null;
    const p = centro(l[0].recuadro), q = centro(l[l.length - 1].recuadro);
    const ar = l[0].recuadro.ar || 1;
    const dx = (q.x - p.x) * ar, dy = q.y - p.y;
    if (Math.hypot(dx, dy) < MOV_MIN) return null;
    return { dx, dy, ar };
}

/**
 * La velocidad aproximada del vehículo en la ráfaga, SIN calibrar distancias (26/11).
 *
 * Nico: «¿con qué datos podés enriquecer nuestro LPR?». La chapa misma es la regla: una Mercosur
 * mide 40 cm de ancho, así que su recuadro dice cuántos metros hay en un tramo de imagen justo
 * donde está el auto. Desplazamiento del centro de la chapa entre la primera y la última lectura,
 * en anchos de chapa, por 0,40 m, dividido por el tiempo entre esos cuadros.
 *
 * Es APROXIMADA y se presenta así: la perspectiva cambia la escala a lo largo del recorrido (se
 * usa el ancho medio), una chapa de moto es más chica y el recuadro del lector no es exacto.
 * Hace falta validarla con un auto a velocidad conocida antes de usarla para algo más que mirar.
 * `t` es el instante de cada cuadro en ms (lo guarda el worker al recibirlo).
 */
const CHAPA_ANCHO_M = 0.4;
const VEL_DT_MIN_MS = 150;
const VEL_MAX_KMH = 160;
function velocidad(lecturas) {
    const l = (lecturas || []).filter((x) => x && x.recuadro && num(x.t) && x.recuadro.w > 0).sort((a, b) => a.t - b.t);
    if (l.length < 2) return null;
    const a = l[0], b = l[l.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt * 1000 < VEL_DT_MIN_MS) return null;
    const ar = a.recuadro.ar || 1;
    const p = centro(a.recuadro), q = centro(b.recuadro);
    const desplazamiento = Math.hypot((q.x - p.x) * ar, q.y - p.y);
    const anchoMedio = ((a.recuadro.w + b.recuadro.w) / 2) * ar;
    if (!(anchoMedio > 0)) return null;
    const kmh = (desplazamiento / anchoMedio) * CHAPA_ANCHO_M / dt * 3.6;
    if (!Number.isFinite(kmh) || kmh > VEL_MAX_KMH) return null;
    return Math.round(kmh);
}

/** Distancia (en alturas) del punto al segmento, y de qué lado queda (signo del producto cruz). */
function aLaLinea(p, l, ar) {
    const px = p.x * ar, py = p.y, x1 = l.a.x * ar, y1 = l.a.y, x2 = l.b.x * ar, y2 = l.b.y;
    const vx = x2 - x1, vy = y2 - y1, largo2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / largo2));
    return { d: Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy)), vx, vy };
}

/**
 * El sentido «ab» de una línea: el auto cruza del lado izquierdo de A→B al derecho, mirando la
 * imagen (con y hacia abajo, eso es girar A→B 90° en sentido horario). La pantalla dibuja esa
 * misma flecha, así que lo que se ve es lo que se aplica.
 */
function cruzaAB(mov, vx, vy) {
    const nx = -vy, ny = vx; // normal horaria en pantalla (y hacia abajo)
    return mov.dx * nx + mov.dy * ny > 0;
}

/**
 * Decide sobre UNA lectura. Devuelve { pasa, motivo, elemento?, sentido?, detalle }:
 * `elemento` es el id del carril/zona/línea que la aceptó (la clave del rebote) y `sentido` el del
 * evento si lo dijo un carril («entra» → ENTRY, «sale» → EXIT).
 */
function evaluarGeometria(geo, recuadro, mov) {
    if (!geo) return { pasa: true, motivo: "sin geometria" };
    if (!recuadro) return { pasa: true, motivo: "sin recuadro" };
    const p = centro(recuadro), ar = recuadro.ar || 1;
    let contramano = null;

    for (const c of geo.carriles) {
        if (!dentroDePoligono(p, c.puntos)) continue;
        if (c.sentido !== "ambos" && c.flecha && mov) {
            const fx = (c.flecha.b.x - c.flecha.a.x) * ar, fy = c.flecha.b.y - c.flecha.a.y;
            if (mov.dx * fx + mov.dy * fy < 0) { contramano = c; continue; }
        }
        return { pasa: true, motivo: "carril", elemento: c.id, nombre: c.nombre, sentido: c.sentido === "ambos" ? null : c.sentido, detalle: `en ${c.nombre}${mov ? "" : " (sin movimiento)"}` };
    }
    for (const l of geo.lineas) {
        const r = aLaLinea(p, l, ar);
        const banda = Math.min(BANDA_MAX, Math.max(BANDA_MIN, recuadro.h * BANDA_ALTURAS));
        if (r.d > banda) continue;
        if (l.sentido !== "ambos" && mov) {
            const ab = cruzaAB(mov, r.vx, r.vy);
            if ((l.sentido === "ab") !== ab) { contramano = contramano || l; continue; }
        }
        return { pasa: true, motivo: "linea", elemento: l.id, nombre: l.nombre, sentido: null, detalle: `cruzando ${l.nombre}` };
    }
    for (const z of geo.zonas) {
        if (dentroDePoligono(p, z.puntos)) return { pasa: true, motivo: "zona", elemento: z.id, nombre: z.nombre, sentido: null, detalle: `en ${z.nombre}` };
    }
    if (contramano) return { pasa: false, motivo: "contramano", elemento: contramano.id, nombre: contramano.nombre, detalle: `${contramano.nombre}: va al revés de su sentido` };
    return { pasa: false, motivo: "fuera de la geometria", detalle: `chapa en ${p.x.toFixed(2)},${p.y.toFixed(2)}` };
}

/**
 * El rebote: recuerda cuándo se aceptó cada chapa en cada elemento. `memoria` es un Map que vive
 * en el worker por cámara. Devuelve true si es un rebote (y entonces no se manda).
 */
function esRebote(memoria, geo, plate, elemento, ahora = Date.now()) {
    if (!geo || !geo.rebote || !plate) return false;
    const clave = `${plate}|${elemento || "*"}`;
    const antes = memoria.get(clave);
    // Limpieza barata: cada tanto se tiran las viejas.
    if (memoria.size > 500) for (const [k, t] of memoria) if (ahora - t > geo.rebote * 1000) memoria.delete(k);
    if (antes && ahora - antes < geo.rebote * 1000) return true;
    memoria.set(clave, ahora);
    return false;
}

/** El sentido del evento que dice un carril, para una cámara que mira un acceso. */
const tipoPorSentido = (s) => (s === "entra" ? "ENTRY" : s === "sale" ? "EXIT" : null);

/**
 * Si el ffmpeg recorta el cuadro (la zona de interés del calibrador de lectura), los recuadros
 * vienen relativos al recorte. La geometría se dibuja sobre el cuadro entero: se traduce.
 */
function aCuadroEntero(recuadro, roi) {
    if (!recuadro || !roi || !(roi.w > 0 && roi.h > 0) || (roi.w >= 1 && roi.h >= 1 && !roi.x && !roi.y)) return recuadro;
    return { ...recuadro, x: roi.x + recuadro.x * roi.w, y: roi.y + recuadro.y * roi.h, w: recuadro.w * roi.w, h: recuadro.h * roi.h, ar: (recuadro.ar || 1) * (roi.h / roi.w) };
}

module.exports = { leerGeometria, normalizar, dentroDePoligono, movimiento, velocidad, evaluarGeometria, esRebote, tipoPorSentido, aCuadroEntero, REBOTE_DEF, REBOTE_MAX };
