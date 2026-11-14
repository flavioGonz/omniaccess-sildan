/**
 * Cuándo cambió de estado una analítica entrenable de escena (un «vigía»: contenedor desbordado,
 * portón abierto…), contado desde sus muestras.
 *
 * Por qué existe (14/11, Nico, con un «Desbordado · Vigía Contenedor 02» abierto: «no me trae el
 * video del momento que se llenó… no sé cuándo fue que se llenó»). El aviso de estas analíticas no
 * sale cuando la escena cambia: sale cuando el estado que avisa se SOSTIENE `sostenerSeg` (quince
 * o veinte minutos), para no avisar por una bolsa apoyada un rato. Entonces la foto y el clip del
 * aviso son de veinte minutos DESPUÉS del hecho, y lo que el guardia quiere ver —quién lo llenó—
 * pasó antes. El dato ya estaba: la zona se mira cada `cadaSeg` y cada mirada queda guardada con su
 * probabilidad. Acá sólo se lee esa historia.
 *
 * Lo que se puede decir y lo que no: la escena cambió ENTRE dos miradas (la última normal y la
 * primera en el estado que avisa), que están a `cadaSeg` una de la otra. No hay un instante más
 * fino que ese: se muestra el intervalo, y la grabación se abre en la última mirada normal.
 */

/** La misma que en vision-zonas.js: para dejar de estar en el estado que avisa hay que bajar este tanto del umbral. */
export const HISTERESIS_ZONA = 0.15;

export type MuestraEscena = { id: string; ts: number; prob: number | null };
export type CambioDeEscena = {
    /** La última mirada antes del cambio (todavía normal). null: la historia guardada no llega tan atrás. */
    antes: MuestraEscena | null;
    /** La primera mirada en el estado que avisa. null: ninguna mirada del evento lo estaba (no debería pasar). */
    desde: MuestraEscena | null;
    /** La mirada que disparó el aviso (la última hasta el evento). */
    evento: MuestraEscena | null;
};

/** Cuánto después de la hora del evento puede estar fechada su mirada (se guarda unos milisegundos antes o después). */
const TOLERANCIA_MS = 5000;

/**
 * `muestras` en cualquier orden. Reproduce la cuenta del worker: el estado que avisa empieza en la
 * primera mirada que llega al umbral y se corta recién cuando una baja del umbral menos la
 * histéresis (una que queda entre los dos no lo corta ni lo empieza).
 */
export function cambioDeEstado(muestras: MuestraEscena[], umbral: number, tsEvento: number): CambioDeEscena {
    const m = muestras.filter((x) => x.prob != null && x.ts <= tsEvento + TOLERANCIA_MS).sort((a, b) => a.ts - b.ts);
    if (!m.length) return { antes: null, desde: null, evento: null };
    const evento = m[m.length - 1];
    // Hacia atrás mientras no haya bajado del umbral menos la histéresis: ese es el tramo sostenido.
    let k = m.length - 1;
    while (k > 0 && m[k - 1].prob! >= umbral - HISTERESIS_ZONA) k--;
    // Dentro del tramo, el estado empezó en la primera que llegó al umbral.
    let d = k;
    while (d < m.length && m[d].prob! < umbral) d++;
    if (d >= m.length) return { antes: null, desde: null, evento };
    return { antes: d > 0 ? m[d - 1] : null, desde: m[d], evento };
}

export type RolEnTira = "antes" | "cambio" | "durante" | "evento";

/**
 * Las miradas que cuentan la historia, pocas: las últimas normales, la del cambio, algunas del
 * tramo sostenido repartidas parejo, y la del aviso. `max` es el total.
 */
export function tiraDelCambio<T extends MuestraEscena>(muestras: T[], c: CambioDeEscena, max = 8, antes = 2): (T & { rol: RolEnTira })[] {
    if (!c.evento) return [];
    const m = muestras.filter((x) => x.prob != null && x.ts <= c.evento!.ts).sort((a, b) => a.ts - b.ts);
    if (!c.desde) return m.slice(-1).map((x) => ({ ...x, rol: "evento" as const }));
    const iD = m.findIndex((x) => x.id === c.desde!.id), iE = m.length - 1;
    const previas = m.slice(Math.max(0, iD - antes), iD).map((x) => ({ ...x, rol: "antes" as const }));
    const out: (T & { rol: RolEnTira })[] = [...previas, { ...m[iD], rol: iD === iE ? "evento" as const : "cambio" as const }];
    if (iE > iD) {
        const medio = m.slice(iD + 1, iE);
        const lugar = Math.max(0, max - out.length - 1);
        const paso = medio.length > lugar && lugar > 0 ? medio.length / lugar : 1;
        const elegidas = lugar === 0 ? [] : medio.length <= lugar ? medio : Array.from({ length: lugar }, (_, i) => medio[Math.min(medio.length - 1, Math.floor(i * paso))]);
        out.push(...elegidas.map((x) => ({ ...x, rol: "durante" as const })), { ...m[iE], rol: "evento" as const });
    }
    return out;
}

/** El rectángulo que envuelve un polígono normalizado: [x1, y1, x2, y2]. */
export function cajaDePoligono(p: [number, number][]): [number, number, number, number] {
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Un polígono guardado como JSON, validado: null si no son al menos tres puntos entre 0 y 1. */
export function poligonoValido(z: unknown): [number, number][] | null {
    if (!Array.isArray(z)) return null;
    const p = z.filter((q) => Array.isArray(q) && q.length >= 2 && q.every((v: unknown) => typeof v === "number" && Number.isFinite(v))).map((q) => [Math.max(0, Math.min(1, q[0])), Math.max(0, Math.min(1, q[1]))] as [number, number]);
    return p.length >= 3 && p.length === z.length ? p : null;
}
