"use client";

/**
 * Ventanas desacopladas de la pared, para repartir vistas entre varios monitores.
 *
 * Cada ventana es la misma página con su vista en la dirección (?vista=… o ?canal=…) y un
 * nombre propio (window.name). El nombre hace dos cosas: abrir la misma vista dos veces trae
 * al frente la ventana que ya está en vez de duplicarla, y cada ventana guarda sus ajustes
 * aparte (ver clavePrefs), así cambiar el mosaico en el monitor 2 no lo cambia en el 1.
 *
 * Con la API de ventanas en varias pantallas de Chrome y Edge (getScreenDetails) la ventana se
 * abre directamente en el monitor elegido y del tamaño de ese monitor. Sin ella, se abre una
 * ventana común que se arrastra a mano. En la ventana nueva, el primer toque la pone en
 * pantalla completa (MarcoMonitor ya lo hace).
 */

export type Pantalla = { id: string; nombre: string; left: number; top: number; width: number; height: number; principal: boolean };

const PREFIJO_VENTANA = "omni-pared-";

export const hayVariasPantallasApi = () => typeof window !== "undefined" && "getScreenDetails" in window;

/** Pide permiso y lista los monitores. null si el navegador no sabe o el permiso se negó. */
export async function listarPantallas(): Promise<Pantalla[] | null> {
    try {
        const det = await (window as any).getScreenDetails();
        return (det.screens as any[]).map((s, i) => ({
            id: String(i), nombre: s.label || `Monitor ${i + 1}`, left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight, principal: !!s.isPrimary,
        }));
    } catch { return null; }
}

/** Abre (o trae al frente) una ventana con esta dirección; devuelve false si el navegador la bloqueó. */
export function abrirVentana(params: Record<string, string>, nombre: string, pantalla?: Pantalla | null): boolean {
    const url = new URL("/monitor/camaras", window.location.origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const p = pantalla || null;
    const medidas = p ? `left=${p.left},top=${p.top},width=${p.width},height=${p.height}` : `width=${Math.round(window.screen.availWidth * 0.8)},height=${Math.round(window.screen.availHeight * 0.8)}`;
    const w = window.open(url.toString(), PREFIJO_VENTANA + nombre, `popup=yes,${medidas}`);
    if (!w) return false;
    try { w.focus(); } catch { }
    return true;
}

/** Los ajustes de esta ventana: la principal usa la clave de siempre; cada desacoplada, la suya. */
export const clavePrefs = (base: string) => {
    try { return window.name?.startsWith(PREFIJO_VENTANA) ? `${base}:${window.name.slice(PREFIJO_VENTANA.length)}` : base; } catch { return base; }
};
export const esVentanaDesacoplada = () => { try { return !!window.name?.startsWith(PREFIJO_VENTANA); } catch { return false; } };
