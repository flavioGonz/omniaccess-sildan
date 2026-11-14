import crypto from "crypto";
import { authenticatedRequest } from "@/lib/digest-auth";
import { ZONA } from "@/lib/fechas";

/**
 * Dónde HAY grabación en un canal de NVR Hikvision (ISAPI ContentMgmt/search), por día.
 * Salió de la regla del monitor (api/monitor/camaras/linea) para que la use también el visor
 * del evento: saber ANTES de pedir el video si a esa hora se grabó, y si no, cuál es lo más
 * cercano. Sólo lectura.
 */

/** De a cuántos se piden. */
const POR_PAGINA = 100;
/**
 * Hasta cuántas páginas por día. Un canal que graba por movimiento tiene cientos de tramos (el de
 * IES, 251 un sábado cualquiera); tres mil ya no es un día de grabación, es otra cosa.
 */
const PAGINAS_MAX = 30;

/**
 * Los NVR guardan y contestan su hora local marcada con Z (ver lib/clip-nvr). Esto pasa
 * «YYYY-MM-DDTHH:MM:SS» de la hora del barrio a milisegundos reales.
 */
export function msDeLocal(texto: string): number | null {
    const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(texto); if (!m) return null;
    const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(comoUtc));
    const g = (t: string) => Number(partes.find((x) => x.type === t)?.value || 0);
    const vistoEnZona = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
    return comoUtc - (vistoEnZona - comoUtc);
}

/**
 * Una página de la búsqueda: sus tramos, cuántos trajo y si el NVR dice que hay más.
 *
 * `cuantos` se CUENTA en la página; no se le cree a `numOfMatches`. Por qué (14/11, Nico: «Ver
 * cuándo llegó en IES dice que no tiene grabaciones, lo cual es mentira»). El NVR de IES pone en
 * `numOfMatches` el TOTAL del día (251) y manda de a 100; el código avanzaba la posición con ese
 * número, pedía desde la 251 —más allá del final— y se quedaba con los primeros cien tramos: la
 * madrugada. A cualquier hora de después, la regla decía «sin grabación a esta hora» y ni
 * intentaba reproducir. No se notó antes porque los otros grabadores graban continuo: pocos tramos
 * largos, una sola página.
 */
export function leerPaginaDeTramos(xml: string): { tramos: [number, number][]; cuantos: number; hayMas: boolean } {
    const tramos: [number, number][] = [];
    let cuantos = 0;
    for (const m of xml.matchAll(/<startTime>([^<]+)<\/startTime>\s*<endTime>([^<]+)<\/endTime>/g)) {
        cuantos++;
        const a = msDeLocal(m[1]), b = msDeLocal(m[2]);
        if (a != null && b != null && b > a) tramos.push([a, b]);
    }
    const estado = (xml.match(/<responseStatusStrg>\s*([^<\s]+)/) || [])[1];
    // El NVR lo dice («MORE»); el que no lo dice, si llenó la página puede tener más.
    return { tramos, cuantos, hayMas: estado ? estado.toUpperCase() === "MORE" : cuantos >= POR_PAGINA };
}

/** Ordenados y pegados: el NVR corta los archivos por hora (o por movimiento) y la regla los quiere continuos. */
export function unirTramos(tramos: [number, number][]): [number, number][] {
    const unidos: [number, number][] = [];
    for (const t of [...tramos].sort((x, y) => x[0] - y[0])) {
        const u = unidos[unidos.length - 1];
        if (u && t[0] <= u[1] + 2000) u[1] = Math.max(u[1], t[1]); else unidos.push([...t] as [number, number]);
    }
    return unidos;
}

/**
 * Los tramos grabados de un día, COMPLETOS, o null si no se pudo saber. Nunca una lista a medias:
 * quien la recibe la lee como «acá hay y acá no», y con media lista afirma que no hay grabación
 * donde sí la hay. Sin lista, la regla no pinta tramos y el reproductor prueba igual.
 */
export async function tramosHik(conn: { ip: string; user: string; pass: string }, ch: number, dia: string): Promise<[number, number][] | null> {
    const dev = { ip: conn.ip, username: conn.user, password: conn.pass, authType: "DIGEST" } as any;
    const tramos: [number, number][] = [];
    let pos = 0;
    for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
        const body = `<CMSearchDescription><searchID>${crypto.randomUUID()}</searchID><trackIDList><trackID>${ch}01</trackID></trackIDList><timeSpanList><timeSpan><startTime>${dia}T00:00:00Z</startTime><endTime>${dia}T23:59:59Z</endTime></timeSpan></timeSpanList><maxResults>${POR_PAGINA}</maxResults><searchResultPostion>${pos}</searchResultPostion></CMSearchDescription>`;
        const pedir = () => authenticatedRequest("POST", "/ISAPI/ContentMgmt/search", dev, { data: body, contentType: "application/xml", accept: "application/xml", responseType: "text", timeout: 12000 }).then(String);
        let xml: string;
        // Una página que falla se pide una vez más; si vuelve a fallar, no se sabe (no «hasta acá hay»).
        try { xml = await pedir(); } catch { try { xml = await pedir(); } catch { return null; } }
        const p = leerPaginaDeTramos(xml);
        tramos.push(...p.tramos);
        if (!p.hayMas) return unirTramos(tramos);
        // Dice que hay más y no mandó nada: no hay cómo avanzar.
        if (!p.cuantos) return null;
        pos += p.cuantos;
    }
    return null;
}


/** «YYYY-MM-DD» del día del barrio en que cae un instante. */
export function diaLocal(ms: number): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
