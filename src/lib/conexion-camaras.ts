/**
 * ¿Está conectada cada cámara LPR? (25/11, Nico: «debemos indicar si perdimos conexión con las
 * cámaras, no? Una lectura que no llega puede ser producto de la red»).
 *
 * La respuesta sale del proceso que copia el registro de cada cámara (camara-log.js): cada 10 s le
 * pide sus últimas lecturas por la red. Si contesta, la cámara está en la red; si no, se anota desde
 * cuándo. Es la medición más directa que hay: no depende de que pase un auto.
 *
 * Tres cosas distintas que no hay que mezclar:
 *   · «sin conexión»: la cámara no contesta. Lo que no llega en ese rato no es culpa del motor.
 *   · «sin copiar»: el proceso que pregunta está parado (su última vuelta es vieja). No se sabe
 *     nada de las cámaras, y se dice eso — no «están bien».
 *   · «en línea»: contestó en la última vuelta.
 * Pura, sin base, para poder probarla.
 */
export type CopiaCamara = { ultimo: string | null; error: string | null; caidaDesde?: string | null } | null | undefined;
export type Conexion = {
    estado: "en-linea" | "sin-conexion" | "sin-copiar" | "sin-registro";
    /** Desde cuándo está así (la caída, o la última vez que contestó). */
    desde: string | null;
    detalle: string | null;
};

/** Cuántas vueltas sin contestar hacen falta para decir «sin conexión»: una sola puede ser un pedido lento. */
export const VUELTAS_PARA_CAIDA = 3;

export function conexionDeCamara(copia: CopiaCamara, proceso: { t: string; cadaMs: number } | null, ahora = Date.now()): Conexion {
    const cada = proceso?.cadaMs || 10_000;
    if (!proceso || ahora - Date.parse(proceso.t) > cada * 6) {
        return { estado: "sin-copiar", desde: proceso?.t || null, detalle: "El proceso que pregunta a las cámaras (camara-log) no está corriendo: no se sabe si están conectadas." };
    }
    if (!copia) return { estado: "sin-copiar", desde: null, detalle: "Todavía no se le preguntó a esta cámara." };
    if (copia.error && /sin registro/i.test(copia.error)) return { estado: "sin-registro", desde: null, detalle: copia.error };
    if (copia.error) return { estado: "sin-conexion", desde: copia.caidaDesde || copia.ultimo, detalle: copia.error };
    const ultimo = copia.ultimo ? Date.parse(copia.ultimo) : NaN;
    if (!Number.isFinite(ultimo) || ahora - ultimo > cada * VUELTAS_PARA_CAIDA) return { estado: "sin-conexion", desde: copia.ultimo, detalle: "No contestó en las últimas vueltas." };
    return { estado: "en-linea", desde: copia.ultimo, detalle: null };
}
