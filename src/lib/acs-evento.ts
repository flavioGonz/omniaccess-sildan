/**
 * La bitácora de un control de acceso Hikvision (ISAPI `AccessControl/AcsEvent`), traducida.
 *
 * Pedido de Nico (18/11): integrar el portero y el control de acceso Hikvision «mediante nuestro
 * driver», y poder consultar su bitácora para el historial de accesos.
 *
 * Los códigos NO salen de la documentación: salen de medir el equipo real (DS-K1T343MFWX
 * V3.21.0, 240 eventos del 31/10 al 18/11). Eso es lo que apareció:
 *
 *   5/1   48   tarjeta válida        · trae cardNo, name, employeeNoString
 *   5/75  23   rostro reconocido     · trae cardNo, name, employeeNoString y FaceRect
 *   5/76  21   rostro NO reconocido  · trae FaceRect y nada de persona
 *   5/39   4   autenticación fallida · trae lector y puerta, sin persona
 *   5/21  70   puerta abierta        · no es una persona: es el estado de la puerta
 *   5/22  70   puerta cerrada        · idem
 *   3/112, 3/121, 3/122  4  operación remota (entrar, salir, cambiar config), con su IP
 *
 * Lo que se guarda como acceso son los cuatro primeros. La puerta abriéndose y cerrándose y el
 * log de administración del equipo NO son accesos: meterlos en el historial lo llenaría de ruido
 * —serían el 58 % de las filas— y ninguno dice quién pasó. Se cuentan aparte para que «se
 * leyeron 240 y se guardaron 96» no parezca que se perdió algo.
 */

export type AcsEvent = {
    major?: number; minor?: number; time?: string;
    cardNo?: string; name?: string; employeeNoString?: string; employeeNo?: string | number;
    doorNo?: number; cardReaderNo?: number; serialNo?: number;
    currentVerifyMode?: string; userType?: string; remoteHostAddr?: string;
};

export type Traduccion = {
    /** Qué pasó, en una línea, para el historial. */
    detalle: string;
    decision: "GRANT" | "DENY";
    /** Con qué se identificó. `null` cuando el equipo no lo dice (una falla sin persona). */
    tipo: "TAG" | "FACE" | "FINGERPRINT" | "PIN" | null;
    credencial: string | null;
    nombre: string | null;
    legajo: string | null;
    puerta: number | null;
    /** El número que el equipo le da al evento: con él se sabe qué ya se trajo. */
    serie: number | null;
};

/** Lo que es una persona pasando (o intentando). El resto se cuenta y no se guarda. */
const PERSONA: Record<string, Omit<Traduccion, "credencial" | "nombre" | "legajo" | "puerta" | "serie">> = {
    "5/1": { detalle: "Tarjeta válida", decision: "GRANT", tipo: "TAG" },
    "5/75": { detalle: "Rostro reconocido", decision: "GRANT", tipo: "FACE" },
    "5/76": { detalle: "Rostro no reconocido", decision: "DENY", tipo: "FACE" },
    "5/39": { detalle: "Autenticación fallida", decision: "DENY", tipo: null },
    // Medidos en otros equipos de la misma familia; se dejan escritos porque el día que aparezcan
    // es mejor tenerlos traducidos que como «código 5/38».
    "5/38": { detalle: "Huella válida", decision: "GRANT", tipo: "FINGERPRINT" },
    "5/40": { detalle: "Huella no reconocida", decision: "DENY", tipo: "FINGERPRINT" },
    "5/2": { detalle: "Tarjeta y huella", decision: "GRANT", tipo: "FINGERPRINT" },
    "5/5": { detalle: "Tarjeta fuera de horario", decision: "DENY", tipo: "TAG" },
    "5/6": { detalle: "Tarjeta sin permiso en esta puerta", decision: "DENY", tipo: "TAG" },
    "5/8": { detalle: "Tarjeta vencida", decision: "DENY", tipo: "TAG" },
    "5/9": { detalle: "Clave equivocada", decision: "DENY", tipo: "PIN" },
    "5/10": { detalle: "Tarjeta desconocida", decision: "DENY", tipo: "TAG" },
};

/** Lo que pasa en el equipo y no es una persona: se cuenta por motivo y no entra al historial. */
export const NO_ES_ACCESO: Record<string, string> = {
    "5/21": "puerta abierta",
    "5/22": "puerta cerrada",
    "5/23": "puerta forzada",
    "5/24": "puerta abierta demasiado tiempo",
    "3/112": "alguien entró a la configuración del equipo",
    "3/121": "alguien salió de la configuración",
    "3/122": "se cambió la configuración del equipo",
};

/**
 * Traduce un evento. `null` si no es un acceso (puerta, administración, o un código que este
 * equipo nunca mandó y que no sabemos leer: inventarle un significado sería peor).
 */
export function traducirAcs(e: AcsEvent): Traduccion | null {
    const k = `${e.major ?? ""}/${e.minor ?? ""}`;
    const base = PERSONA[k];
    if (!base) return null;
    const legajo = String(e.employeeNoString ?? e.employeeNo ?? "").trim() || null;
    return {
        ...base,
        credencial: String(e.cardNo ?? "").trim() || null,
        // El equipo guarda el nombre que le cargaron, que en esta instalación es un número de
        // unidad («304»). Se trae tal cual: el padrón de OmniAccess es el que pone el nombre.
        nombre: String(e.name ?? "").trim() || null,
        legajo,
        puerta: Number.isFinite(Number(e.doorNo)) ? Number(e.doorNo) : null,
        serie: Number.isFinite(Number(e.serialNo)) ? Number(e.serialNo) : null,
    };
}

/**
 * El desfasaje del reloj del equipo, en milisegundos (positivo: el equipo está adelantado).
 *
 * Hace falta porque el terminal medido está **once horas atrasado**: el 18/11 a las 16:17 de acá
 * decía `2026-11-18T05:17:37-03:00`. Sus eventos salen con esa hora, y guardarlos así deja el
 * historial once horas corrido — que es peor que no tenerlo, porque parece cierto.
 *
 * Se mide, no se adivina: se compara la hora que dice el equipo contra la nuestra en el momento
 * de leer. Corregir es lo que permite usar la bitácora HOY, sin escribirle nada al equipo; pero
 * es un parche y la pantalla tiene que decirlo, porque lo que corresponde es ponerlo en hora.
 */
export const DESFASAJE_AVISA_MS = 2 * 60 * 1000;

export function desfasajeDeEquipo(horaDelEquipo: string | null | undefined, ahora = Date.now()): number | null {
    if (!horaDelEquipo) return null;
    const t = Date.parse(horaDelEquipo);
    if (!Number.isFinite(t)) return null;
    return t - ahora;
}

/** La hora real de un evento, con el desfasaje del equipo descontado. */
export function cuandoFue(e: AcsEvent, desfasajeMs: number | null): Date | null {
    const t = Date.parse(String(e.time ?? ""));
    if (!Number.isFinite(t)) return null;
    return new Date(t - (desfasajeMs ?? 0));
}

/** «11 h 3 min atrasado» / «2 min adelantado». Para decirlo en pantalla sin hacer cuentas. */
export function diceDesfasaje(ms: number): string {
    const atrasado = ms < 0;
    const s = Math.round(Math.abs(ms) / 1000);
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    const partes = [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "menos de un minuto";
    return `${partes} ${atrasado ? "atrasado" : "adelantado"}`;
}
