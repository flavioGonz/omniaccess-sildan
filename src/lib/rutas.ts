import { funcionActiva } from "@/app/actions/funciones";
import { URL_RUTAS } from "@/lib/omni-rutas";
import { juntarAjustes, leerAjuste, pedidosDeAjuste, porLaCalle, type Ajuste, type PuntoCrudo, type RespuestaOsrm } from "@/lib/gps-calle";

/**
 * Poner un recorrido sobre la calle, preguntándole al servicio de rutas (24/11).
 *
 * El servicio es omni-rutas: OSRM con el mapa de OpenStreetMap, como contenedor de OmniAccess en
 * este mismo equipo (`services/omni-rutas`, `lib/omni-rutas`). Se prende con la función
 * «Recorridos por la calle». Qué se pregunta y qué se le cree a la respuesta está en `lib/gps-calle`.
 *
 * No se guarda nada: preguntar cien puntos tarda unos diez milisegundos (medido en el lab), así
 * que el camino se calcula cada vez que se pide el recorrido. Guardarlo sería tener que acordarse
 * de rehacerlo cuando cambia el mapa o cambia el criterio.
 *
 * Los mismos cuidados que las direcciones, porque de esto cuelga el mapa en vivo:
 *  · **Si el servicio no contesta, nadie espera.** Tras unas fallas seguidas se lo da por caído un
 *    minuto y el recorrido sale como antes de que existiera: en línea recta entre posiciones.
 *  · **Tiene tope.** Un mes de un camión son cien mil posiciones: eso no se ajusta (serían mil
 *    preguntas para una línea que a esa escala no se distingue de la recta).
 */

/** Cuánto se espera cada respuesta. Está en este mismo equipo: si tarda más que esto, está mal. */
const ESPERA_MS = 2500;
const A_LA_VEZ = 4;
/** Más posiciones que esto en un pedido no se ajustan: salen en recta. Son unas 33 h de marcha de un equipo que reporta cada 10 s. */
export const PUNTOS_MAX = 12_000;
const FALLAS_PARA_CAIDO = 3, CAIDO_MS = 60_000;

let leido: { url: string | null; hasta: number } | null = null;
let fallas = 0, caidoHasta = 0;

/** A quién se le pregunta. Con la función apagada, a nadie. Se relee cada medio minuto. */
export async function servicioDeRutas(): Promise<string | null> {
    if (leido && leido.hasta > Date.now()) return leido.url;
    leido = { url: (await funcionActiva("GPS_POR_CALLE").catch(() => false)) ? URL_RUTAS : null, hasta: Date.now() + 30_000 };
    return leido.url;
}
/** Para que prender o apagar la función valga en el acto, y no al medio minuto. */
export const olvidarServicioDeRutas = () => { leido = null; fallas = 0; caidoHasta = 0; };

async function preguntar(url: string, ruta: string): Promise<RespuestaOsrm | null> {
    try {
        const r = await fetch(url + ruta, { signal: AbortSignal.timeout(ESPERA_MS), cache: "no-store" });
        /* Un 400 con «NoMatch» o «NoSegment» es una respuesta: ahí no hay calle. No es que el servicio ande mal. */
        const j = (await r.json().catch(() => null)) as RespuestaOsrm | null;
        return j && typeof j.code === "string" ? j : null;
    } catch { return null; }
}

/**
 * Varios tramos de posiciones (los viajes de un recorrido), cada uno por la calle. Lo que no se pudo
 * ajustar —un tramo, un viaje, o todo— vuelve como entró. `ajustado` dice si se preguntó algo.
 */
export async function porLaCalleDe<T extends PuntoCrudo>(tramos: T[][]): Promise<{ tramos: (T & { via?: true })[][]; ajustado: boolean }> {
    const url = await servicioDeRutas();
    const cuantos = tramos.reduce((a, t) => a + t.length, 0);
    if (!url || Date.now() < caidoHasta || cuantos > PUNTOS_MAX || cuantos < 2) return { tramos, ajustado: false };

    const tareas: { tramo: number; desde: number; hasta: number; ruta: string }[] = [];
    tramos.forEach((t, k) => { for (const p of pedidosDeAjuste(t)) tareas.push({ tramo: k, ...p }); });
    const tandas: { desde: number; ajustes: Ajuste[] }[][] = tramos.map(() => []);
    let i = 0, cortar = false, contestadas = 0;
    const obrero = async () => {
        while (i < tareas.length && !cortar) {
            const t = tareas[i++];
            const r = await preguntar(url, t.ruta);
            if (!r) { if (++fallas >= FALLAS_PARA_CAIDO) { caidoHasta = Date.now() + CAIDO_MS; cortar = true; } continue; }
            fallas = 0; contestadas++;
            tandas[t.tramo].push({ desde: t.desde, ajustes: leerAjuste(tramos[t.tramo].slice(t.desde, t.hasta + 1), r) });
        }
    };
    await Promise.all(Array.from({ length: Math.min(A_LA_VEZ, tareas.length) }, obrero));
    if (!contestadas) return { tramos, ajustado: false };
    return {
        ajustado: true,
        /* Las tandas llegan en cualquier orden (van varias a la vez): se ordenan antes de juntarlas. */
        tramos: tramos.map((t, k) => porLaCalle(t, juntarAjustes(t.length, tandas[k].sort((a, b) => a.desde - b.desde)))),
    };
}
