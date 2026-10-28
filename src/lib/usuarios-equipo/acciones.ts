/**
 * Los textos con que las cuentas y sesiones de los equipos quedan en Auditoría (AccionSistema.accion),
 * en un solo lugar, como ACCION_ACCESOS (openspec usuarios-de-equipos). La auditoría de un área los
 * busca por estos textos y por el nombre del equipo.
 */
export const ACCION_EQUIPOS = {
    CUENTA_NUEVA: "Cuenta nueva en el equipo",
    CUENTA_YA_NO_ESTA: "Cuenta que ya no está en el equipo",
    SESION_DESCONOCIDA: "Sesión desde una IP desconocida",
    CUENTA_CONOCIDA: "Marcó como conocida una cuenta del equipo",
    CUENTA_NO_CONOCIDA: "Quitó la marca de conocida a una cuenta del equipo",
    IP_CONOCIDA: "Marcó como conocida una IP",
    IP_NO_CONOCIDA: "Quitó una IP conocida",
} as const;

export const ACCIONES_DE_EQUIPOS: string[] = Object.values(ACCION_EQUIPOS);

/** Quién figura en Auditoría para lo que encuentra la lectura automática. */
export const QUIEN_LECTURA = "OmniAccess · lectura de equipos";
