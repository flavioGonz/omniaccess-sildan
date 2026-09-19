/**
 * Fecha y hora, una sola vez.
 *
 * El relevamiento encontró **169 llamadas a `toLocale*` con 33 firmas distintas**, en tres
 * locales a la vez — es-UY, es-AR y es-ES — dentro del mismo producto. Dieciocho maneras
 * de escribir una hora y quince de escribir una fecha.
 *
 * Pero el problema no es que se vean distinto. La firma MÁS usada era
 * `toLocaleTimeString()` **sin argumentos, trece veces**: eso toma el idioma y la zona
 * horaria del equipo que abre la página. La hora que ve el guardia en su tablet depende de
 * cómo esté configurada la tablet, no de cuándo pasó el auto. Si alguien deja un equipo en
 * inglés, la bitácora pasa a decir "9:15 PM"; si una computadora quedó en otra zona, la
 * hora de un evento cambia de lugar. Y en todo el repositorio **una sola llamada pasaba
 * `timeZone`**.
 *
 * Eso no es inconsistencia visual: es un registro de seguridad que muestra una hora que no
 * es la hora en que ocurrió el hecho. Acá todo queda fijo al barrio, no al equipo.
 *
 * Reglas del sistema:
 *   · 24 horas siempre. Un registro de seguridad no tiene AM/PM.
 *   · `tabular-nums` del lado del CSS, para que las cifras no bailen al actualizarse.
 *   · Nada de segundos salvo que los segundos importen — en un listado son ruido, en un
 *     evento de acceso son el dato.
 */

/** Dónde ocurren las cosas. No dónde está el equipo que las mira. */
export const ZONA = process.env.NEXT_PUBLIC_TZ || "America/Montevideo";
export const IDIOMA = "es-UY";

const base: Intl.DateTimeFormatOptions = { timeZone: ZONA };

/** Acepta lo que venga de la base, del socket o de una prop. */
function leer(v: string | number | Date | null | undefined): Date | null {
    if (v == null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

const dar = (v: any, opciones: Intl.DateTimeFormatOptions, vacio = "—") => {
    const d = leer(v);
    return d ? d.toLocaleString(IDIOMA, { ...base, ...opciones }) : vacio;
};

/** 14:07 */
export const hora = (v: any, vacio?: string) =>
    dar(v, { hour: "2-digit", minute: "2-digit", hour12: false }, vacio);

/** 14:07:32 — cuando el segundo es el dato, no adorno. */
export const horaSeg = (v: any, vacio?: string) =>
    dar(v, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }, vacio);

/** 19 set */
export const fechaCorta = (v: any, vacio?: string) =>
    dar(v, { day: "2-digit", month: "short" }, vacio);

/** 19 set 2026 */
export const fecha = (v: any, vacio?: string) =>
    dar(v, { day: "2-digit", month: "short", year: "numeric" }, vacio);

/** 19/09/2026 — para exportar, donde el mes escrito no sirve. */
export const fechaNumerica = (v: any, vacio?: string) =>
    dar(v, { day: "2-digit", month: "2-digit", year: "numeric" }, vacio);

/** 19 set, 14:07 */
export const fechaHora = (v: any, vacio?: string) =>
    dar(v, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }, vacio);

/** 19 set 2026, 14:07:32 — la ficha completa de un evento. */
export const fechaHoraSeg = (v: any, vacio?: string) =>
    dar(v, {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }, vacio);

/** viernes 19 */
export const diaSemana = (v: any, vacio?: string) =>
    dar(v, { weekday: "long", day: "2-digit" }, vacio);

/** Para un <input type="date">, que sólo entiende AAAA-MM-DD y en la zona del barrio. */
export function paraInput(v: any): string {
    const d = leer(v);
    if (!d) return "";
    const p = new Intl.DateTimeFormat("en-CA", { ...base, year: "numeric", month: "2-digit", day: "2-digit" });
    return p.format(d);
}

/**
 * "hace 4 min", "hace 2 h", "hace 3 d".
 *
 * Cortado en días a propósito: pasado el mes, "hace 47 d" no le dice nada a nadie y una
 * fecha sí. Ahí devuelve la fecha.
 */
export function hace(v: any, vacio = "—"): string {
    const d = leer(v);
    if (!d) return vacio;
    const seg = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (seg < 45) return "recién";
    if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
    if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`;
    if (seg < 30 * 86400) return `hace ${Math.round(seg / 86400)} d`;
    return fecha(d);
}

/**
 * Una duración, en palabras cortas: "45 s", "17 min", "2 h 05", "1 d 03 h".
 *
 * Toma segundos, que es como vienen de la base (permanencia, estadía, tiempo entre
 * tramos). Es la misma escalera que usa el cronómetro de una estadía.
 */
export function duracion(segundos: number | null | undefined): string {
    if (segundos == null || !isFinite(segundos)) return "—";
    const s = Math.max(0, Math.floor(segundos));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")}`;
    return `${Math.floor(h / 24)} d ${String(h % 24).padStart(2, "0")} h`;
}

/** La misma duración, pero entre dos momentos. */
export const duracionEntre = (desde: any, hasta: any) => {
    const a = leer(desde), b = leer(hasta);
    return a && b ? duracion((b.getTime() - a.getTime()) / 1000) : "—";
};
