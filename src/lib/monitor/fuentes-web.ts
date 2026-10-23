/**
 * Las fuentes web de la pared de Cámaras (openspec pared-vms, 23/10, Nico: «el monitor de cámaras
 * debe poder, en un canal, hacer render de una web, para vestir el wall con herramientas externas»).
 *
 * Una fuente es una página (un tablero, un mapa, el NVR, Grafana) que se pone en una casilla de una
 * vista guardada en lugar de un canal de video, con la clave `web:<id>`. El catálogo se carga en
 * Monitores (permiso `monitores.config`) y vive en un ajuste, como las vistas.
 *
 * Este archivo no importa nada de servidor: lo usan la pared, el editor y las acciones.
 */

export type FuenteWeb = {
    id: string;
    nombre: string;
    url: string;
    /** Cada cuántos minutos se vuelve a cargar la página. 0 = nunca. */
    recargaMin: number;
    /** Zoom de la página dentro de la casilla, en %. */
    zoom: number;
    /** Lo que se vio al guardarla (ver revisarFuente en actions/monitores). Avisos, no impedimentos. */
    avisos?: AvisoFuente[];
};
export type AvisoFuente = "no-enmarcable" | "http-en-https" | "sin-respuesta";
export const TEXTO_AVISO: Record<AvisoFuente, string> = {
    "no-enmarcable": "Este sitio no se deja mostrar dentro de otra página: la casilla va a quedar en blanco.",
    "http-en-https": "La dirección es http y el panel se abre por https: el navegador la va a bloquear. Publicala con https.",
    "sin-respuesta": "El servidor de OmniAccess no llegó a la dirección. Si es de la red local de la pared, puede andar igual.",
};

export const AJUSTE_FUENTES_WEB = "MONITOR_FUENTES_WEB";
export const FUENTES_WEB_MAX = 50;
export const NOMBRE_FUENTE_MAX = 40;
export const RECARGA_MAX_MIN = 1440;
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
/** La clave de una fuente en una vista guardada. */
export const PREFIJO_WEB = "web:";
export const CLAVE_WEB = /^web:[\w-]{1,40}$/;
export const esClaveWeb = (k: string | null | undefined): k is string => !!k && CLAVE_WEB.test(k);
export const idDeClaveWeb = (k: string) => k.slice(PREFIJO_WEB.length);

/** Por qué no es una dirección válida; null si lo es. */
export function problemaDeUrl(u: string): string | null {
    let x: URL;
    try { x = new URL(u); } catch { return "No es una dirección: tiene que empezar con http:// o https://"; }
    if (x.protocol !== "http:" && x.protocol !== "https:") return "Tiene que empezar con http:// o https://";
    // Una clave en la dirección quedaría a la vista de cualquiera que abra la pared o el ajuste.
    if (x.username || x.password) return "No pongas usuario ni clave en la dirección: quedarían a la vista.";
    return null;
}

const entero = (v: unknown, min: number, max: number, def: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Lo que llega del navegador, limpio; null si no es una fuente. El id se respeta si tiene forma. */
export function fuenteValida(v: any): FuenteWeb | null {
    if (!v || typeof v !== "object") return null;
    const nombre = String(v.nombre || "").trim().slice(0, NOMBRE_FUENTE_MAX);
    const url = String(v.url || "").trim().slice(0, 2000);
    if (!nombre || problemaDeUrl(url)) return null;
    const id = typeof v.id === "string" && /^[\w-]{1,40}$/.test(v.id) ? v.id : "";
    const avisos = Array.isArray(v.avisos) ? (v.avisos.filter((a: any) => a in TEXTO_AVISO) as AvisoFuente[]) : [];
    return { id, nombre, url, recargaMin: entero(v.recargaMin, 0, RECARGA_MAX_MIN, 0), zoom: entero(v.zoom, ZOOM_MIN, ZOOM_MAX, 100), avisos };
}

export function leerFuentes(json: string | null | undefined): FuenteWeb[] {
    try {
        const a = JSON.parse(json || "[]");
        return Array.isArray(a) ? (a.map(fuenteValida).filter((x) => x && x.id) as FuenteWeb[]) : [];
    } catch { return []; }
}

/**
 * Qué dicen los encabezados de un sitio sobre mostrarse en un marco. `X-Frame-Options` DENY o
 * SAMEORIGIN, o un `frame-ancestors` que no sea `*`, dejan la casilla en blanco.
 */
export function prohibeMarco(xfo: string | null, csp: string | null): boolean {
    if (xfo && /deny|sameorigin/i.test(xfo)) return true;
    const fa = csp?.split(";").map((x) => x.trim()).find((x) => /^frame-ancestors\b/i.test(x));
    if (!fa) return false;
    const valores = fa.split(/\s+/).slice(1);
    return !valores.includes("*");
}
