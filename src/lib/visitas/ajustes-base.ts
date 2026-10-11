/**
 * Los ajustes de Visitas y patrones: valores por defecto y cómo se validan.
 *
 * Archivo puro (sin Prisma ni Next) para poder probarlo con `node --test`. La lectura de
 * `Setting` con caché vive en `ajustes.ts`.
 *
 * Cada número de abajo tiene su porqué. Si se cambia uno, se cambia el porqué.
 */

export type ModoAcceso = "ABIERTO" | "CERRADO";

/**
 * Sin ajuste cargado, CERRADO: es como se comportó siempre el sistema, y una instalación
 * con barrera que actualiza no puede amanecer diciendo "No registrado" donde decía "Denegado".
 */
export const MODO_POR_DEFECTO: ModoAcceso = "CERRADO";

export type TipoVisita = { clave: string; nombre: string; minutos: number; activo: boolean };

/**
 * Los tiempos por defecto: lo que dura de verdad cada cosa en un barrio, con margen.
 *  · Delivery 15 min: entregar y salir. Lo pidió el barrio.
 *  · Servicio 120 min: un técnico, un jardinero, un service.
 *  · Obra 480 min: una jornada.
 *  · Visita 180 min: la permanencia mediana medida en San Nicolás es 2 h 19 min; 3 h la cubre.
 */
export const TIPOS_POR_DEFECTO: TipoVisita[] = [
    { clave: "DELIVERY", nombre: "Delivery", minutos: 15, activo: true },
    { clave: "SERVICIO", nombre: "Servicio", minutos: 120, activo: true },
    { clave: "OBRA", nombre: "Obra", minutos: 480, activo: true },
    { clave: "VISITA", nombre: "Visita", minutos: 180, activo: true },
];
/** El tipo que se usa para una visita abierta por invitación. */
export const TIPO_INVITACION = "VISITA";
/**
 * «Indefinido: pase libre», para proveedores: se le abre una visita al entrar —figura adentro,
 * la Salida la cierra— pero sin tiempo. No es un tipo de la lista de Ajustes porque no tiene
 * minutos: es la ausencia de cuenta atrás, y así no se puede apagar ni editar por error.
 */
export const TIPO_PASE_LIBRE = "PASE_LIBRE";
export const NOMBRE_PASE_LIBRE = "Pase libre";
/**
 * Visita.vence es obligatorio: el pase libre lleva un vence lejano para que el resto del sistema
 * (ordenar por vencimiento, «excedida») no lo tome por vencido. Lo cierra antes la Salida o el
 * corte del día; las pantallas y el aviso de excedida lo reconocen por su tipo, no por la hora.
 */
export const PASE_LIBRE_HORAS = 36;
export const esPaseLibre = (tipo: string | null | undefined) => tipo === TIPO_PASE_LIBRE;

/** Topes de lo que se puede configurar: un tipo de un minuto o de una semana es un error de tipeo. */
export const MINUTOS_TIPO_MIN = 1;
export const MINUTOS_TIPO_MAX = 24 * 60;

export type ClaveAviso = "VISITA_EXCEDIDA" | "FUERA_DE_RUTINA" | "PERMANENCIA_INUSUAL" | "PRIMERA_VEZ_NOCHE" | "DA_VUELTAS" | "SIN_REGISTRAR";

export type AjustesAvisos = {
    VISITA_EXCEDIDA: { activo: boolean };
    /** Minutos de distancia a la hora típica de su rutina a partir de los cuales avisa. */
    FUERA_DE_RUTINA: { activo: boolean; margenMin: number };
    PERMANENCIA_INUSUAL: { activo: boolean };
    /** Franja "de noche", en hora del barrio. Si desde > hasta, cruza la medianoche. */
    PRIMERA_VEZ_NOCHE: { activo: boolean; desde: string; hasta: string };
    /** N lecturas de la misma matrícula en M minutos. */
    DA_VUELTAS: { activo: boolean; lecturas: number; minutos: number };
    /** Sólo en modo ABIERTO. Apagado por defecto: en un barrio abierto entra mucha gente sin
     *  registrarse y encenderlo sin mirar llenaría la consola. */
    SIN_REGISTRAR: { activo: boolean };
};

export const AVISOS_POR_DEFECTO: AjustesAvisos = {
    VISITA_EXCEDIDA: { activo: true },
    // 90 min: medido, las rutinas reales varían ±2–9 min; 90 deja afuera un día con tránsito
    // o una salida tarde y agarra lo que de verdad no encaja (un domingo, de madrugada).
    FUERA_DE_RUTINA: { activo: true, margenMin: 90 },
    PERMANENCIA_INUSUAL: { activo: true },
    PRIMERA_VEZ_NOCHE: { activo: true, desde: "23:00", hasta: "06:00" },
    // 4 en 60 min: el mismo umbral de lecturas que usaba el merodeo, en una ventana corta
    // (el merodeo contaba 24 h y marcaba a cualquiera que viniera cuatro veces en el día).
    DA_VUELTAS: { activo: true, lecturas: 4, minutos: 60 },
    SIN_REGISTRAR: { activo: false },
};

export type Ajustes = {
    modo: ModoAcceso;
    tipos: TipoVisita[];
    avisos: AjustesAvisos;
    /** Ventana en la que no se repite el mismo aviso para la misma matrícula o visita. */
    antirreboteMin: number;
    /** Hora del barrio en la que se cierran las visitas que siguen abiertas. Medido: entre las
     *  04:00 y las 06:00 es cuando menos lecturas hay. */
    horaCorte: string;
    /** Rutina: días mínimos y desvío máximo de la hora de llegada. */
    rutinaDiasMin: number;
    rutinaDesvioMaxMin: number;
    /** Cuántos días hacia atrás mira el perfil. */
    ventanaPerfilDias: number;
};

export const AJUSTES_POR_DEFECTO: Ajustes = {
    modo: MODO_POR_DEFECTO,
    tipos: TIPOS_POR_DEFECTO,
    avisos: AVISOS_POR_DEFECTO,
    antirreboteMin: 60,
    horaCorte: "05:00",
    // 4 días con menos de 30 min de variación: con 3 todavía puede ser casualidad; las
    // rutinas medidas tenían ±2–9 min, así que 30 es holgado sin dejar pasar cualquier cosa.
    rutinaDiasMin: 4,
    rutinaDesvioMaxMin: 30,
    ventanaPerfilDias: 30,
};

/** Las claves en `Setting`. */
export const CLAVE_MODO = "MODO_ACCESO";
export const CLAVE_TIPOS = "VISITA_TIPOS";
export const CLAVE_AVISOS = "AVISOS_GUARDIA";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const entero = (v: any, min: number, max: number, def: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const hora = (v: any, def: string) => (typeof v === "string" && HHMM.test(v) ? v : def);
const bool = (v: any, def: boolean) => (typeof v === "boolean" ? v : def);
const leerJson = (s: string | null | undefined): any => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };

/**
 * De los textos guardados en `Setting` a ajustes válidos. Un JSON roto o un valor fuera de
 * rango NO rompe nada: cae al valor por defecto (o se acota), porque esto se lee en cada
 * lectura de matrícula y una coma de más en Ajustes no puede frenar el motor.
 */
export function normalizarAjustes(raw: { modo?: string | null; tipos?: string | null; avisos?: string | null }): Ajustes {
    const modo: ModoAcceso = raw.modo === "ABIERTO" || raw.modo === "CERRADO" ? raw.modo : MODO_POR_DEFECTO;

    const t = leerJson(raw.tipos);
    let tipos = TIPOS_POR_DEFECTO;
    if (Array.isArray(t)) {
        const vistos = new Set<string>();
        const validos = t.map((x: any) => {
            const clave = String(x?.clave || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
            if (!clave || vistos.has(clave)) return null;
            vistos.add(clave);
            const nombre = String(x?.nombre || clave).trim().slice(0, 40) || clave;
            return { clave, nombre, minutos: entero(x?.minutos, MINUTOS_TIPO_MIN, MINUTOS_TIPO_MAX, 15), activo: bool(x?.activo, true) };
        }).filter(Boolean) as TipoVisita[];
        if (validos.length) tipos = validos;
    }

    const a = leerJson(raw.avisos) || {};
    const d = AVISOS_POR_DEFECTO;
    const avisos: AjustesAvisos = {
        VISITA_EXCEDIDA: { activo: bool(a.VISITA_EXCEDIDA?.activo, d.VISITA_EXCEDIDA.activo) },
        FUERA_DE_RUTINA: { activo: bool(a.FUERA_DE_RUTINA?.activo, d.FUERA_DE_RUTINA.activo), margenMin: entero(a.FUERA_DE_RUTINA?.margenMin, 15, 720, d.FUERA_DE_RUTINA.margenMin) },
        PERMANENCIA_INUSUAL: { activo: bool(a.PERMANENCIA_INUSUAL?.activo, d.PERMANENCIA_INUSUAL.activo) },
        PRIMERA_VEZ_NOCHE: { activo: bool(a.PRIMERA_VEZ_NOCHE?.activo, d.PRIMERA_VEZ_NOCHE.activo), desde: hora(a.PRIMERA_VEZ_NOCHE?.desde, d.PRIMERA_VEZ_NOCHE.desde), hasta: hora(a.PRIMERA_VEZ_NOCHE?.hasta, d.PRIMERA_VEZ_NOCHE.hasta) },
        DA_VUELTAS: { activo: bool(a.DA_VUELTAS?.activo, d.DA_VUELTAS.activo), lecturas: entero(a.DA_VUELTAS?.lecturas, 2, 50, d.DA_VUELTAS.lecturas), minutos: entero(a.DA_VUELTAS?.minutos, 5, 24 * 60, d.DA_VUELTAS.minutos) },
        SIN_REGISTRAR: { activo: bool(a.SIN_REGISTRAR?.activo, d.SIN_REGISTRAR.activo) },
    };
    const g = AJUSTES_POR_DEFECTO;
    return {
        modo, tipos, avisos,
        antirreboteMin: entero(a.antirreboteMin, 5, 24 * 60, g.antirreboteMin),
        horaCorte: hora(a.horaCorte, g.horaCorte),
        rutinaDiasMin: entero(a.rutinaDiasMin, 3, 30, g.rutinaDiasMin),
        rutinaDesvioMaxMin: entero(a.rutinaDesvioMaxMin, 5, 180, g.rutinaDesvioMaxMin),
        ventanaPerfilDias: entero(a.ventanaPerfilDias, 7, 120, g.ventanaPerfilDias),
    };
}

/** Lo que se guarda en `AVISOS_GUARDIA`: los avisos más los parámetros generales. */
export function serializarAvisos(aj: Ajustes): string {
    return JSON.stringify({ ...aj.avisos, antirreboteMin: aj.antirreboteMin, horaCorte: aj.horaCorte, rutinaDiasMin: aj.rutinaDiasMin, rutinaDesvioMaxMin: aj.rutinaDesvioMaxMin, ventanaPerfilDias: aj.ventanaPerfilDias });
}
