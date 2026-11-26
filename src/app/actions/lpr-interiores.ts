"use server";

import { getSession } from "@/app/actions/auth";
import { leerInterioresAdentro, type ChapaAdentro } from "@/lib/lpr-interiores";

/**
 * Las matrículas adentro vistas por las LPR interiores (lib/lpr-interiores), para el monitor LPR del panel.
 *
 * Ojo (26/11): un archivo "use server" sólo puede exportar funciones async. Un `export type { … }`
 * acá lo compila Turbopack como una exportación de valor que no existe (ReferenceError al cargar el
 * módulo) y tumba TODAS las acciones de la página que lo importa: el monitor LPR quedó sin cámaras
 * ni capturas. El tipo se importa de lib/lpr-interiores.
 */
export async function interioresAdentro(): Promise<{ ok: boolean; error?: string; camaras: number; chapas: ChapaAdentro[] }> {
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel.", camaras: 0, chapas: [] };
    return leerInterioresAdentro();
}
