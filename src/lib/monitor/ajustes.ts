/** Claves y topes de los ajustes de Monitores. Separado de las acciones porque un archivo "use server" sólo puede exportar funciones. */
export const AJUSTE_ROTACION_VISTAS = "MONITOR_ROTACION_VISTAS";
export const AJUSTE_ROTACION_SEG = "MONITOR_ROTACION_SEG";
/** Menos de 10 s no se alcanza a leer una vista; es el piso, no una sugerencia. */
export const ROTACION_SEG_MIN = 10;
export const ROTACION_SEG_POR_DEFECTO = 30;
/** Las vistas de la rotación si nadie la configuró todavía. */
export const ROTACION_VISTAS_POR_DEFECTO = ["intrusion", "lpr", "mapa"] as const;
