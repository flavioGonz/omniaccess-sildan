/**
 * Los espacios comunes y sus reservas, sin base (25/11). Nico: «agrega una tab SUM y otra Espacios
 * comunes, desarrollalas premium». Eligió: ficha y reglamento, reservas con calendario (el SUM y los
 * espacios reservables), mantenimiento y tareas, y el estado en vivo (abierto, cerrado, en
 * mantenimiento). Las reservas las carga la administración desde el panel.
 *
 * Acá van los catálogos y las cuentas que hay que poder probar: si una reserva choca con otra, y
 * cómo se parte una semana.
 */

export const TIPOS_ESPACIO = [
    { id: "SUM", rotulo: "SUM", plural: "SUM", reservable: true },
    { id: "PISCINA", rotulo: "Piscina", plural: "Piscinas", reservable: false },
    { id: "CANCHA", rotulo: "Cancha", plural: "Canchas", reservable: true },
    { id: "PARRILLERO", rotulo: "Parrillero", plural: "Parrilleros", reservable: true },
    { id: "GIMNASIO", rotulo: "Gimnasio", plural: "Gimnasios", reservable: false },
    { id: "PARQUE", rotulo: "Parque o plaza", plural: "Parques y plazas", reservable: false },
    { id: "OTRO", rotulo: "Otro", plural: "Otros", reservable: false },
] as const;
export type TipoEspacio = (typeof TIPOS_ESPACIO)[number]["id"];
export const rotuloTipo = (t: string) => TIPOS_ESPACIO.find((x) => x.id === t)?.rotulo || t;

/** El estado en vivo. El tono es el de la interfaz: abierto está bien, mantenimiento avisa, cerrado es un no. */
export const ESTADOS_ESPACIO = [
    { id: "ABIERTO", rotulo: "Abierto", tono: "bien" },
    { id: "MANTENIMIENTO", rotulo: "En mantenimiento", tono: "aviso" },
    { id: "CERRADO", rotulo: "Cerrado", tono: "mal" },
] as const;
export type EstadoEspacio = (typeof ESTADOS_ESPACIO)[number]["id"];

export const ESTADOS_RESERVA = [
    { id: "PEDIDA", rotulo: "Pedida", tono: "aviso" },
    { id: "CONFIRMADA", rotulo: "Confirmada", tono: "bien" },
    { id: "CANCELADA", rotulo: "Cancelada", tono: "quieto" },
] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number]["id"];

export const TIPOS_TAREA = [
    { id: "MANTENIMIENTO", rotulo: "Mantenimiento" }, { id: "LIMPIEZA", rotulo: "Limpieza" },
    { id: "REPARACION", rotulo: "Reparación" }, { id: "RECLAMO", rotulo: "Reclamo" },
] as const;
export const ESTADOS_TAREA = [
    { id: "PENDIENTE", rotulo: "Pendiente", tono: "aviso" }, { id: "EN_CURSO", rotulo: "En curso", tono: "info" }, { id: "HECHA", rotulo: "Hecha", tono: "bien" },
] as const;

type Turno = { id?: string; inicio: Date | string; fin: Date | string; estado?: string };
const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));

/**
 * La reserva que choca con `nueva`, si hay. Las canceladas no ocupan el espacio, y una reserva no
 * choca consigo misma (al editarla). Que una termine justo cuando empieza la otra no es choque: es
 * lo normal (de 14 a 18 y de 18 a 22).
 */
export function choque<T extends Turno>(existentes: T[], nueva: Turno): T | null {
    const a = ms(nueva.inicio), b = ms(nueva.fin);
    return existentes.find((r) => r.estado !== "CANCELADA" && (!nueva.id || r.id !== nueva.id) && ms(r.inicio) < b && a < ms(r.fin)) || null;
}

/** Lo que hace inválido un turno, en palabras; null si está bien. */
export function problemaDeTurno(t: { inicio: Date | string; fin: Date | string }, ahora = Date.now()): string | null {
    const a = ms(t.inicio), b = ms(t.fin);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return "Falta el día o la hora.";
    if (b <= a) return "La hora de fin tiene que ser después de la de inicio.";
    if (b - a > 24 * 3600_000) return "Una reserva dura como mucho un día.";
    if (b < ahora - 24 * 3600_000) return "Ese turno ya pasó.";
    return null;
}

/** El lunes 00:00 (hora local) de la semana de `d`. */
export function inicioDeSemana(d: Date): Date {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (x.getDay() + 6) % 7;                    // lunes = 0
    x.setDate(x.getDate() - dow);
    return x;
}
export function diasDeSemana(lunes: Date): Date[] {
    return Array.from({ length: 7 }, (_, i) => new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i));
}
/**
 * Dónde cae un turno dentro de un día de la agenda (en fracciones de la franja visible), recortado a
 * la franja. Null si no toca ese día.
 */
export function posicionEnDia(t: { inicio: Date | string; fin: Date | string }, dia: Date, desdeHora: number, hastaHora: number): { arriba: number; alto: number } | null {
    const d0 = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), desdeHora).getTime();
    const d1 = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), hastaHora).getTime();
    const a = Math.max(ms(t.inicio), d0), b = Math.min(ms(t.fin), d1);
    if (b <= a) return null;
    return { arriba: (a - d0) / (d1 - d0), alto: (b - a) / (d1 - d0) };
}
