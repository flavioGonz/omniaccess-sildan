/**
 * Los textos con que los accesos quedan en Auditoría (AccionSistema.accion), en un solo lugar:
 * los escriben el login y Ajustes → Accesos, y Accesos busca la última entrada de cada usuario
 * por ENTRO (openspec roles-y-permisos, «Auditoría de accesos»).
 */
export const ACCION_ACCESOS = {
    ENTRO: "Entró al panel",
    ENTRADA_FALLIDA: "Entrada fallida",
    ROL_CREADO: "Creó rol",
    ROL_EDITADO: "Editó rol",
    ROL_DUPLICADO: "Duplicó rol",
    ROL_BORRADO: "Borró rol",
    USUARIO_CREADO: "Creó usuario del panel",
    USUARIO_EDITADO: "Editó usuario del panel",
    USUARIO_BORRADO: "Borró usuario del panel",
} as const;
