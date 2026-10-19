import { leerAjuste } from "@/lib/ajustes-db";
import { leerInterruptores } from "@/lib/vision";
import { CLAVE_REGLAS, canalDeFila, validarReglas, type ReglaVision } from "@/lib/vision-reglas";

/**
 * Las filas de OmniVision vistas desde el módulo Filas (18/10).
 *
 * El módulo Filas nació para cámaras con analítica de fila propia (deviceType QUEUE_COUNTER): las
 * listaba por tipo de equipo. Una regla «Conteo de fila» de Visión → Reglas convierte a cualquier
 * cámara en un contador de fila, y esa cámara tiene que aparecer en Filas, en el Monitor de filas
 * y en las reglas de notificación de Filas aunque su tipo sea «Cámara» o «LPR interior». Esto
 * dice cuáles son, y con qué canal y qué zona.
 */
export type FilaVision = ReglaVision & { canal: string };

/** Las reglas de fila prendidas (la regla y su analítica en Visión → Analíticas). */
export async function filasVision(): Promise<FilaVision[]> {
    const [crudo, inter] = await Promise.all([leerAjuste(CLAVE_REGLAS), leerInterruptores().catch(() => null)]);
    if (inter?.analiticas?.fila === false) return [];
    let reglas: ReglaVision[] = [];
    try { reglas = validarReglas(JSON.parse(crudo?.value || "[]")).reglas; } catch { reglas = []; }
    return reglas.filter((r) => r.tipo === "fila" && r.activa && r.zona && r.zona.length >= 3).map((r) => ({ ...r, canal: canalDeFila(r.nombre) }));
}

/** Los equipos que cuentan una fila con OmniVision. */
export async function idsFilasVision(): Promise<string[]> {
    return [...new Set((await filasVision()).map((r) => r.deviceId))];
}

/** El filtro de Prisma de «los equipos del módulo Filas»: los contadores y las cámaras con fila de OmniVision. */
export async function dondeEquiposDeFila() {
    const ids = await idsFilasVision();
    return ids.length ? { OR: [{ deviceType: "QUEUE_COUNTER" as any }, { id: { in: ids } }] } : { deviceType: "QUEUE_COUNTER" as any };
}
