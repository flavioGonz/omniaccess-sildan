/**
 * Cómo se dice una lectura y cómo se dice un aviso. Un solo lugar, para que ninguna pantalla
 * escriba "Denegado" a mano en un barrio donde nadie deniega nada.
 *
 *  · CERRADO (hay barrera): PERMITIDO / DENEGADO con su motivo, como siempre.
 *  · ABIERTO (no hay barrera): REGISTRADO / NO REGISTRADO. "No registrado" no es un error:
 *    va en tono neutro. Sólo la lista negra lleva el rojo, en los dos modos.
 */

export type Tono = "bien" | "mal" | "aviso" | "info" | "neutro";
export type Presentacion = { texto: string; tono: Tono; pleno: string; error: boolean };

const PLENO: Record<Tono, string> = { bien: "pleno-bien", mal: "pleno-mal", aviso: "pleno-aviso", info: "pleno-info", neutro: "bg-neutral-700 text-white" };

export function presentarLectura(p: { modo: "ABIERTO" | "CERRADO"; decision: string | null | undefined; registrada: boolean; listaNegra: boolean }): Presentacion {
    const t = (texto: string, tono: Tono): Presentacion => ({ texto, tono, pleno: PLENO[tono], error: tono === "mal" });
    if (p.listaNegra) return t("Lista negra", "mal");
    if (p.modo === "ABIERTO") return p.registrada ? t("Registrado", "bien") : t("No registrado", "neutro");
    return p.decision === "GRANT" ? t("Permitido", "bien") : t("Denegado", "mal");
}

/** Los rótulos de los contadores del día según el modo. */
export function rotulosContadores(modo: "ABIERTO" | "CERRADO") {
    return modo === "ABIERTO"
        ? { entradas: "Entradas hoy", salidas: "Salidas hoy", rechazos: "No registrados hoy", adentro: "Visitas en curso" }
        : { entradas: "Entradas hoy", salidas: "Salidas hoy", rechazos: "Denegados hoy", adentro: "Adentro ahora" };
}

export type TipoAviso = "VISITA_EXCEDIDA" | "FUERA_DE_RUTINA" | "PERMANENCIA_INUSUAL" | "PRIMERA_VEZ_NOCHE" | "DA_VUELTAS" | "SIN_REGISTRAR"
    // Los de las reglas de visión (vision-worker → vision-reglas.js), con su foto en `datos.foto`.
    | "VISION_SENTIDO" | "VISION_PERMANENCIA" | "VISION_AGLOMERACION" | "VISION_CRUCE" | "VISION_INTRUSION" | "VISION_MERODEO" | "VISION_RETIRADO" | "VISION_ZONA";

export const ETIQUETA_AVISO: Record<TipoAviso, { titulo: string; tono: Tono }> = {
    VISITA_EXCEDIDA: { titulo: "Visita excedida", tono: "mal" },
    FUERA_DE_RUTINA: { titulo: "Fuera de rutina", tono: "aviso" },
    PERMANENCIA_INUSUAL: { titulo: "Se quedó más de lo habitual", tono: "aviso" },
    PRIMERA_VEZ_NOCHE: { titulo: "Primera vez, de noche", tono: "aviso" },
    DA_VUELTAS: { titulo: "Da vueltas", tono: "info" },
    SIN_REGISTRAR: { titulo: "Entró sin registrarse", tono: "neutro" },
    VISION_SENTIDO: { titulo: "Sentido contrario", tono: "mal" },
    VISION_PERMANENCIA: { titulo: "Se quedó en la zona", tono: "aviso" },
    VISION_AGLOMERACION: { titulo: "Aglomeración", tono: "aviso" },
    VISION_CRUCE: { titulo: "Cruce de línea", tono: "aviso" },
    VISION_INTRUSION: { titulo: "Intrusión", tono: "mal" },
    VISION_MERODEO: { titulo: "Merodeo", tono: "aviso" },
    VISION_RETIRADO: { titulo: "Objeto retirado", tono: "mal" },
    VISION_ZONA: { titulo: "Analítica entrenable", tono: "aviso" },
};

/** Las frases de cada aviso: siempre con el dato que lo disparó. */
export const motivo = {
    excedida: (v: { tipoNombre: string; lote: string | null; minutos: number; excedidoMin: number }) =>
        `${v.tipoNombre}${v.lote ? ` a ${v.lote}` : ""}: tenía ${v.minutos} min y lleva ${v.excedidoMin} min de más.`,
    fueraDeRutina: (v: { hora: string; rutina: string; por: "dia" | "hora" }) =>
        `Llegó ${v.por === "dia" ? "un día que no es de su rutina" : "a una hora que no es la suya"}, a las ${v.hora}; su rutina es ${v.rutina}.`,
    permanencia: (v: { lleva: string; p90: string }) => `Lleva ${v.lleva} adentro; 9 de cada 10 veces se va antes de ${v.p90}.`,
    primeraVezNoche: (v: { hora: string; camara: string | null }) => `Nunca vista antes; entró a las ${v.hora}${v.camara ? ` por ${v.camara}` : ""}.`,
    daVueltas: (v: { lecturas: number; minutos: number }) => `Pasó ${v.lecturas} veces en ${v.minutos} min, sin visita registrada ni rutina conocida.`,
    sinRegistrar: (v: { hora: string; camara: string | null }) => `Entró a las ${v.hora}${v.camara ? ` por ${v.camara}` : ""} sin registrarse en la garita.`,
};
