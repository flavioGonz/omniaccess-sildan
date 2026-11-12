/**
 * Capturas programadas para el conjunto de entrenamiento (openspec capturas-programadas-entrenamiento).
 *
 * «Sacar foto ahora» pide que alguien esté sentado tocando el botón, y la pantalla misma recomienda
 * fotos de las cámaras de día y de noche. Una programación las toma sola cada cierto tiempo.
 *
 * Este archivo es lo que comparten la pantalla, las rutas y los tests: los frenos, la validación,
 * la regla de cuándo toca (`queHacer`) y la de «la escena no cambió» (`comparar`). Sin base, sin
 * red y sin sharp: la huella se calcula en el servidor (capturas-programadas-servidor.ts).
 */
import { ZONA } from "@/lib/fechas";

// ── Frenos ──
/** Menos que esto es abrir el stream principal de un grabador más seguido de lo que tiene sentido. */
export const CADA_MIN_MINIMO = 5;
export const CADA_MIN_MAXIMO = 1440;
export const CADA_MIN_DEFECTO = 30;
/** Para elegir sin escribir: lo que se ofrece en el formulario. */
export const CADA_MIN_OPCIONES = [5, 10, 15, 30, 60, 120, 360, 720, 1440];
/** Fotos por programación. Cuenta las tomadas: descartar no devuelve cupo. */
export const TOPE_DEFECTO = 200;
export const TOPE_MAXIMO = 1000;
/** Una programación olvidada no sigue para siempre. */
export const DIAS_DEFECTO = 7;
export const DIAS_MAXIMO = 90;
/** Con esta cantidad sin dibujar, todas las programaciones esperan: más que esto no se dibuja nunca. */
export const COLA_MAXIMA = 500;
/** Más cámaras y una vuelta puede no terminar antes de la siguiente. */
export const CAMARAS_MAXIMO = 30;
export const LARGO_NOMBRE_PROGRAMA = 60;
/** Una vuelta marcada «en curso» hace más que esto quedó colgada (el proceso murió): se puede volver a tomar. */
export const VUELTA_COLGADA_MS = 10 * 60_000;
/** Sin pasada del reloj en este tiempo, con programaciones activas, las capturas no se están tomando. */
export const LATIDO_VIEJO_MS = 5 * 60_000;
export const CLAVE_LATIDO = "CAPTURAS_LATIDO";

// ── La huella de un cuadro ──
/** La escena en gris a este tamaño: cada celda son unos 30×30 px de un cuadro de 1920. */
export const HUELLA_ANCHO = 64;
export const HUELLA_ALTO = 36;
/** La huella se mira además por bloques de este lado: un objeto que aparece en una esquina mueve su bloque, no el promedio. */
export const BLOQUE = 6;
/**
 * Debajo de los DOS, la escena es la misma y la foto se saltea.
 *
 * Medido el 12/11 de noche en 8 cámaras del lab, 15 cuadros por cámara cada 20 s (design.md,
 * «Repetida»). Una escena de verdad quieta da bloque 0,6–5,6 y media 0,4–2,4; un auto que pasa,
 * bloque 13–130. Entre 6 y 13 quedan las luces que titilan (un farol entre ramas): se guardan.
 *
 * Es un filtro conservador a propósito: sólo saltea cuando no cambió NADA. Una cámara con árboles
 * al viento (Arapey: bloque 18–68 sin que pase nadie) o con tránsito al fondo nunca da «repetida»,
 * y ningún umbral de píxeles lo arregla sin perder los autos de verdad. Para esas cámaras el freno
 * es el tope de la programación, no esto.
 */
export const DIF_MEDIA_MAX = 2.5;
export const DIF_BLOQUE_MAX = 6;

export type Horario = { desde: string; hasta: string } | null;
export type EstadoCamara = {
    /** Huella (base64) de la última foto GUARDADA: se compara contra esa, así un cambio lento termina sumando. */
    huella?: string;
    ultimaAt?: string | null;
    guardadas?: number;
    salteadas?: number;
    /** Vueltas seguidas sin cuadro. */
    fallos?: number;
    error?: string | null;
    errorDesde?: string | null;
    /** Las últimas comparaciones [media, bloque, 1 = se guardó]: para revisar los umbrales con datos del lugar. */
    difs?: [number, number, number][];
};
export type EstadoPrograma = { enVueltaDesde?: string | null; ultimaVueltaAt?: string | null; ultimaMs?: number | null; camaras?: Record<string, EstadoCamara> };

export type Programa = {
    id: string; nombre: string; camaras: string[]; cadaMin: number; horario: Horario; tope: number;
    hasta: string | null; activa: boolean; forzarAt: string | null; proximaAt: string;
    guardadas: number; salteadas: number; terminada: string | null; creadaPor: string | null; createdAt: string;
};
/** Lo que ve la pantalla de cada cámara de una programación: el estado sin la huella. */
export type CamaraDePrograma = { id: string; nombre: string; guardadas: number; salteadas: number; ultimaAt: string | null; fallos: number; error: string | null; errorDesde: string | null };
export type ProgramaFila = Programa & { situacion: Situacion; camarasEstado: CamaraDePrograma[]; pendientes: number; ultimaVueltaAt: string | null };

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_CAMARA = /^[\w-]{1,80}$/;

/** Valida lo que manda el formulario. Devuelve el error en palabras: no recorta en silencio. */
export function validarPrograma(x: any, ahora = new Date()): { datos: { nombre: string; camaras: string[]; cadaMin: number; horario: Horario; tope: number; hasta: Date } } | { error: string } {
    const nombre = String(x?.nombre ?? "").trim().slice(0, LARGO_NOMBRE_PROGRAMA);
    if (!nombre) return { error: "Ponele un nombre a la programación." };
    const camaras = Array.isArray(x?.camaras) ? [...new Set(x.camaras.map((c: unknown) => String(c)))] as string[] : [];
    if (!camaras.length) return { error: "Elegí al menos una cámara." };
    if (camaras.length > CAMARAS_MAXIMO) return { error: `Como mucho ${CAMARAS_MAXIMO} cámaras por programación. Para más, armá otra.` };
    if (camaras.some((c) => !ID_CAMARA.test(c))) return { error: "Hay una cámara que no se reconoce." };
    const cadaMin = Number(x?.cadaMin);
    if (!Number.isInteger(cadaMin) || cadaMin < CADA_MIN_MINIMO || cadaMin > CADA_MIN_MAXIMO) return { error: `El intervalo va de ${CADA_MIN_MINIMO} minutos a 24 horas.` };
    let horario: Horario = null;
    if (x?.horario) {
        const { desde, hasta } = x.horario;
        if (!HORA.test(desde || "") || !HORA.test(hasta || "")) return { error: "La franja horaria va como HH:MM." };
        if (desde === hasta) return { error: "La franja empieza y termina a la misma hora: dejala vacía para todo el día." };
        horario = { desde, hasta };
    }
    const tope = Number(x?.tope);
    if (!Number.isInteger(tope) || tope < 1 || tope > TOPE_MAXIMO) return { error: `El tope de fotos va de 1 a ${TOPE_MAXIMO}.` };
    const hasta = new Date(x?.hasta);
    if (Number.isNaN(hasta.getTime())) return { error: "Falta hasta cuándo." };
    if (hasta.getTime() <= ahora.getTime()) return { error: "La fecha de fin ya pasó." };
    if (hasta.getTime() > ahora.getTime() + DIAS_MAXIMO * 86_400_000) return { error: `Como mucho ${DIAS_MAXIMO} días. Después se puede renovar.` };
    return { datos: { nombre, camaras, cadaMin, horario, tope, hasta } };
}

/** Minuto del día en la hora del barrio (no la del servidor ni la del navegador). */
export function minutoDelDia(d: Date): number {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const n = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
    return (n("hour") % 24) * 60 + n("minute");
}
const aMinutos = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
/** La misma cuenta que `enHorario` de las reglas de visión, con la franja que cruza medianoche. */
export function enFranja(h: Horario, d: Date): boolean {
    if (!h) return true;
    const a = aMinutos(h.desde), b = aMinutos(h.hasta), x = minutoDelDia(d);
    if (a === b) return true;
    return a < b ? x >= a && x < b : x >= a || x < b;
}
/** Cuándo vuelve a abrir la franja (si ya está abierta, ahora). */
export function proximaApertura(h: Horario, d: Date): Date {
    if (!h || enFranja(h, d)) return d;
    const falta = (aMinutos(h.desde) - minutoDelDia(d) + 1440) % 1440;
    // Al minuto en punto: los segundos de ahora no cuentan.
    return new Date(Math.floor(d.getTime() / 60_000) * 60_000 + falta * 60_000);
}

/**
 * Qué le toca a una programación en este momento. La usan la vuelta (para decidir), la pantalla
 * (para decir en qué está) y los tests.
 *
 *  · `terminada`: llegó al tope o a la fecha. No vuelve sola.
 *  · `pausada`: la pausó una persona.
 *  · `cola`: hay demasiadas fotos sin dibujar; sigue sola cuando baje.
 *  · `franja`: fuera de su horario.
 *  · `tomar`: le toca (o alguien pidió «Tomar ahora», que no espera la hora ni la franja, pero sí los topes).
 *  · `esperar`: activa, todavía no es la hora.
 */
export type Situacion =
    | { que: "terminada"; motivo: "tope" | "fecha" }
    | { que: "pausada" }
    | { que: "cola"; proxima: string }
    | { que: "franja"; proxima: string }
    | { que: "tomar"; pedida: boolean }
    | { que: "esperar"; proxima: string };

export function queHacer(p: Pick<Programa, "activa" | "terminada" | "tope" | "guardadas" | "hasta" | "horario" | "cadaMin" | "proximaAt" | "forzarAt">, m: { ahora: Date; sinDibujar: number }): Situacion {
    const { ahora } = m;
    if (p.terminada === "tope" || p.guardadas >= p.tope) return { que: "terminada", motivo: "tope" };
    if (p.terminada === "fecha" || (p.hasta && new Date(p.hasta).getTime() <= ahora.getTime())) return { que: "terminada", motivo: "fecha" };
    if (!p.activa) return { que: "pausada" };
    const enCadencia = new Date(ahora.getTime() + p.cadaMin * 60_000).toISOString();
    if (m.sinDibujar >= COLA_MAXIMA) return { que: "cola", proxima: enCadencia };
    if (p.forzarAt) return { que: "tomar", pedida: true };
    if (!enFranja(p.horario, ahora)) return { que: "franja", proxima: proximaApertura(p.horario, ahora).toISOString() };
    if (new Date(p.proximaAt).getTime() <= ahora.getTime()) return { que: "tomar", pedida: false };
    return { que: "esperar", proxima: new Date(p.proximaAt).toISOString() };
}

/** Cuántas fotos le quedan por tomar en esta vuelta sin pasarse del tope. */
export const cupoDe = (p: Pick<Programa, "tope" | "guardadas">) => Math.max(0, p.tope - p.guardadas);

/**
 * Cuánto cambió la escena entre dos huellas (gris, HUELLA_ANCHO × HUELLA_ALTO, 0-255):
 *  · `media`: la diferencia absoluta media de todo el cuadro. La mueve la luz (día a noche).
 *  · `bloque`: la mayor diferencia media entre los bloques de BLOQUE × BLOQUE celdas. La mueve
 *    algo que aparece o se va en un lugar, aunque el resto del cuadro siga igual.
 * Huellas de otro tamaño (se cambió la constante) no se pueden comparar: devuelve null y se guarda.
 */
export function comparar(a: Uint8Array, b: Uint8Array): { media: number; bloque: number } | null {
    const n = HUELLA_ANCHO * HUELLA_ALTO;
    if (a.length !== n || b.length !== n) return null;
    const bx = Math.ceil(HUELLA_ANCHO / BLOQUE), by = Math.ceil(HUELLA_ALTO / BLOQUE);
    const suma = new Float64Array(bx * by), cuenta = new Uint16Array(bx * by);
    let total = 0;
    for (let y = 0; y < HUELLA_ALTO; y++) {
        for (let x = 0; x < HUELLA_ANCHO; x++) {
            const d = Math.abs(a[y * HUELLA_ANCHO + x] - b[y * HUELLA_ANCHO + x]);
            total += d;
            const k = Math.floor(y / BLOQUE) * bx + Math.floor(x / BLOQUE);
            suma[k] += d; cuenta[k]++;
        }
    }
    let bloque = 0;
    for (let k = 0; k < suma.length; k++) if (cuenta[k]) bloque = Math.max(bloque, suma[k] / cuenta[k]);
    return { media: total / n, bloque };
}
/** ¿La misma escena? Sin huella anterior (primera foto de la cámara) nunca es repetida. */
export function esRepetida(d: { media: number; bloque: number } | null): boolean {
    return !!d && d.media < DIF_MEDIA_MAX && d.bloque < DIF_BLOQUE_MAX;
}

/** Cada cuánto, en palabras: «cada 30 min», «cada 2 h», «una vez por día». */
export function cadaCuanto(min: number): string {
    if (min >= 1440) return "una vez por día";
    if (min >= 60 && min % 60 === 0) return `cada ${min / 60} h`;
    return `cada ${min} min`;
}
