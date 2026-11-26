"use server";

import { getSession } from "@/app/actions/auth";
import { leerInterioresAdentro, type ChapaAdentro } from "@/lib/lpr-interiores";

/** Las matrículas adentro vistas por las LPR interiores (lib/lpr-interiores), para el monitor LPR del panel. */
export type { ChapaAdentro };
export async function interioresAdentro(): Promise<{ ok: boolean; error?: string; camaras: number; chapas: ChapaAdentro[] }> {
    if (!(await getSession())) return { ok: false, error: "Hace falta una sesión del panel.", camaras: 0, chapas: [] };
    return leerInterioresAdentro();
}
