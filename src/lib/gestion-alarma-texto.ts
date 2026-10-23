/** Lo de la gestión de alarmas que también usa el navegador (sin base de datos). Ver lib/gestion-alarma. */
/** SE_FUE no lo hace un operador: lo anota OmniVision cuando termina la estadía de «Se quedó en la zona». */
export type AccionGestion = "TOMO" | "PASO" | "CONFIRMO_REAL" | "MARCO_FALSA" | "MARCO_REAL" | "DESACTIVO" | "ERA_FALSA" | "ATENDIO" | "NOTA" | "SE_FUE" | "VOLVIO"
    /** Eventos de central (lib/centrales/tratamiento): tildó / destildó un paso del procedimiento, lo trató, se escaló. */
    | "PASO_PROC" | "PASO_PROC_NO" | "PASO_PROC_SALTEO" | "TRATO" | "ESCALO";
export type PasoGestion = { id: string; accion: AccionGestion; por: string | null; detalle: string | null; ts: string };
export type Operador = { operador: string | null; desde: string | null };

/** Qué se hizo, en palabras (para la bitácora en pantalla). */
export const TEXTO_ACCION: Record<AccionGestion, string> = {
    TOMO: "La tomó", PASO: "La pasó", CONFIRMO_REAL: "Confirmó intrusión real", MARCO_FALSA: "La marcó falsa alarma", MARCO_REAL: "La marcó real",
    DESACTIVO: "Desactivó la alarma (resuelta)", ERA_FALSA: "La corrigió: era falsa", ATENDIO: "La dio por atendida", NOTA: "Escribió una nota",
    SE_FUE: "Terminó la permanencia",
    /** Lo anota OmniVision: el que se había dado por ido volvió a verse en el mismo lugar (ver vision-reglas reabrirAvisoEstadia). */
    VOLVIO: "Volvió a verse: no se había ido",
    PASO_PROC: "Hizo un paso del procedimiento", PASO_PROC_NO: "Destildó un paso", PASO_PROC_SALTEO: "Salteó un paso", TRATO: "Trató el evento", ESCALO: "Se escaló",
};

