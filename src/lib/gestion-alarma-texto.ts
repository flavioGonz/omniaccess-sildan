/** Lo de la gestión de alarmas que también usa el navegador (sin base de datos). Ver lib/gestion-alarma. */
export type AccionGestion = "TOMO" | "PASO" | "CONFIRMO_REAL" | "MARCO_FALSA" | "MARCO_REAL" | "DESACTIVO" | "ERA_FALSA" | "ATENDIO" | "NOTA";
export type PasoGestion = { id: string; accion: AccionGestion; por: string | null; detalle: string | null; ts: string };
export type Operador = { operador: string | null; desde: string | null };

/** Qué se hizo, en palabras (para la bitácora en pantalla). */
export const TEXTO_ACCION: Record<AccionGestion, string> = {
    TOMO: "La tomó", PASO: "La pasó", CONFIRMO_REAL: "Confirmó intrusión real", MARCO_FALSA: "La marcó falsa alarma", MARCO_REAL: "La marcó real",
    DESACTIVO: "Desactivó la alarma (resuelta)", ERA_FALSA: "La corrigió: era falsa", ATENDIO: "La dio por atendida", NOTA: "Escribió una nota",
};

