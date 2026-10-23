/**
 * Las disposiciones de la pared de video y las vistas que se diseñan con ellas.
 *
 * Una disposición es una cuadrícula y sus casillas, como las de un NVR: «1+5» es una de 3×3
 * con una casilla grande de 2×2 arriba a la izquierda y cinco chicas alrededor. Una vista
 * diseñada es una disposición con una cámara elegida para cada casilla.
 *
 * Este archivo no importa nada de servidor: lo usan la pantalla (para dibujar) y la acción que
 * guarda (para validar lo que llega). Si se agrega una disposición, se agrega acá.
 */

export type Casilla = { x: number; y: number; w: number; h: number };
export type Disposicion = { clave: string; nombre: string; cols: number; filas: number; casillas: Casilla[] };

/** Todas las casillas de 1×1 de una cuadrícula, salvo las que tapa `grande`. */
function cuadricula(cols: number, filas: number, grandes: Casilla[] = []): Casilla[] {
    const tapada = (x: number, y: number) => grandes.some((g) => x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h);
    const chicas: Casilla[] = [];
    for (let y = 0; y < filas; y++) for (let x = 0; x < cols; x++) if (!tapada(x, y)) chicas.push({ x, y, w: 1, h: 1 });
    // Las grandes van primero: ahí cae la cámara que detecta en la vista automática.
    return [...grandes, ...chicas];
}

export const DISPOSICIONES: Disposicion[] = [
    { clave: "1", nombre: "Una", cols: 1, filas: 1, casillas: cuadricula(1, 1) },
    { clave: "4", nombre: "2×2", cols: 2, filas: 2, casillas: cuadricula(2, 2) },
    { clave: "1+5", nombre: "1 grande + 5", cols: 3, filas: 3, casillas: cuadricula(3, 3, [{ x: 0, y: 0, w: 2, h: 2 }]) },
    { clave: "9", nombre: "3×3", cols: 3, filas: 3, casillas: cuadricula(3, 3) },
    { clave: "1+7", nombre: "1 grande + 7", cols: 4, filas: 4, casillas: cuadricula(4, 4, [{ x: 0, y: 0, w: 3, h: 3 }]) },
    { clave: "2+8", nombre: "2 grandes + 8", cols: 4, filas: 4, casillas: cuadricula(4, 4, [{ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }]) },
    { clave: "1+12", nombre: "1 al centro + 12", cols: 4, filas: 4, casillas: cuadricula(4, 4, [{ x: 1, y: 1, w: 2, h: 2 }]) },
    { clave: "16", nombre: "4×4", cols: 4, filas: 4, casillas: cuadricula(4, 4) },
    { clave: "25", nombre: "5×5", cols: 5, filas: 5, casillas: cuadricula(5, 5) },
];

export const DISPOSICION_POR_DEFECTO = "9";
export const disposicionDe = (clave: string | null | undefined): Disposicion =>
    DISPOSICIONES.find((d) => d.clave === clave) || DISPOSICIONES.find((d) => d.clave === DISPOSICION_POR_DEFECTO)!;
/** ?grilla=4 de los enlaces viejos (antes del 15/10 la pared sólo tenía n×n). */
export const disposicionDeGrilla = (n: number) => ({ 1: "1", 2: "4", 3: "9", 4: "16", 5: "25" } as Record<number, string>)[n] || null;

/** Una vista diseñada: una disposición y qué canal va en cada casilla (null = vacía). */
export type VistaCamaras = { id: string; nombre: string; disposicion: string; canales: (string | null)[] };

/** Dónde se guardan, en Setting. Un solo JSON: son pocas y se leen todas juntas. */
export const AJUSTE_VISTAS_CAMARAS = "MONITOR_CAMARAS_VISTAS";
export const VISTAS_CAMARAS_MAX = 40;
export const NOMBRE_VISTA_MAX = 40;
/**
 * La clave de un canal tal como la arma /api/monitor/camaras: «dev:<id>» o «nvr:<id>:<ch>». O una
 * fuente web, «web:<id>» (openspec pared-vms): una página en la casilla en lugar de video.
 */
export const CLAVE_CANAL = /^(dev:[\w-]{1,80}|nvr:[\w-]{1,80}:\d{1,4}|web:[\w-]{1,40})$/;

/** Lo que llega del navegador, limpio; null si no es una vista. */
export function vistaValida(v: any): VistaCamaras | null {
    if (!v || typeof v !== "object") return null;
    const nombre = String(v.nombre || "").trim().slice(0, NOMBRE_VISTA_MAX);
    const d = DISPOSICIONES.find((x) => x.clave === v.disposicion);
    if (!nombre || !d || !Array.isArray(v.canales)) return null;
    const canales = d.casillas.map((_, i) => {
        const c = v.canales[i];
        return typeof c === "string" && CLAVE_CANAL.test(c) ? c : null;
    });
    const id = typeof v.id === "string" && /^[\w-]{1,40}$/.test(v.id) ? v.id : "";
    return { id, nombre, disposicion: d.clave, canales };
}

export function leerVistas(json: string | null | undefined): VistaCamaras[] {
    try {
        const a = JSON.parse(json || "[]");
        return Array.isArray(a) ? (a.map(vistaValida).filter((x) => x && x.id) as VistaCamaras[]) : [];
    } catch { return []; }
}
