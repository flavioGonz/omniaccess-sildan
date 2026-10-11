/**
 * Los cálculos de los perfiles y los patrones, sin base ni Next: entran números, salen
 * números. Son estadística simple a propósito — mediana, percentil, desvío — para que cada
 * aviso pueda decir en una frase por qué se disparó. Un modelo que no se puede explicar en el
 * aviso no le sirve a un guardia.
 */

export type Rutina = { dows: number[]; minutoMedio: number; desvioMin: number; dias: number };
export type Llegada = { dow: number; minuto: number };
export type Clase = "RESIDENTE" | "HABITUAL" | "FRECUENTE" | "OCASIONAL" | "PRIMERA_VEZ";

/** Mediana; null sin datos. */
export function mediana(xs: number[]): number | null { return percentil(xs, 50); }

/** Percentil con interpolación lineal (como `percentile_cont` de Postgres); null sin datos. */
export function percentil(xs: number[], p: number): number | null {
    const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const pos = (Math.min(100, Math.max(0, p)) / 100) * (v.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Desvío estándar muestral (n-1, como `stddev` de Postgres); 0 con un solo dato. */
export function desvio(xs: number[]): number {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * La rutina de una matrícula a partir de su primera llegada de cada día. Hay rutina si llegó
 * al menos `diasMin` días distintos y la hora varía menos de `desvioMax` minutos. Los días de
 * la semana son los que se vio (1 = lunes … 7 = domingo).
 *
 * Límite conocido: una rutina alrededor de la medianoche (23:50 un día, 00:10 otro) da un
 * desvío falso grande y no se detecta. Es raro en llegadas; está en el diseño.
 */
export function detectarRutina(llegadas: Llegada[], diasMin: number, desvioMax: number): Rutina | null {
    if (llegadas.length < diasMin) return null;
    const minutos = llegadas.map((l) => l.minuto);
    const d = desvio(minutos);
    if (d > desvioMax) return null;
    const medio = Math.round(minutos.reduce((a, b) => a + b, 0) / minutos.length);
    const dows = [...new Set(llegadas.map((l) => l.dow))].sort((a, b) => a - b);
    return { dows, minutoMedio: medio, desvioMin: Math.round(d), dias: llegadas.length };
}

const DIAS = ["", "lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
export const hhmm = (minuto: number) => `${String(Math.floor(((minuto % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((minuto % 60) + 60) % 60).padStart(2, "0")}`;

/** "lun a vie", "lun, mié, vie", "todos los días". */
export function describirDias(dows: number[]): string {
    const d = [...new Set(dows)].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
    if (d.length === 7) return "todos los días";
    if (!d.length) return "—";
    const seguidos = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    return seguidos ? `${DIAS[d[0]]} a ${DIAS[d[d.length - 1]]}` : d.map((x) => DIAS[x]).join(", ");
}

/** "lun a vie · 06:50 ±2 min" */
export function describirRutina(r: Rutina): string {
    return `${describirDias(r.dows)} · ${hhmm(r.minutoMedio)} ±${r.desvioMin} min`;
}

/** "2 h 19 min", "45 min" */
export function duracion(min: number | null | undefined): string {
    if (min == null || !Number.isFinite(min)) return "—";
    const m = Math.max(0, Math.round(min));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * La clase de una matrícula. El padrón manda; después la rutina; después la frecuencia.
 *  · Frecuente: 4 días o más sin rutina (viene seguido, a cualquier hora).
 *  · Ocasional: 2 o 3 días.
 */
export function claseDe(p: { enPadron: boolean; rutina: Rutina | null; diasVistos: number }): Clase {
    if (p.enPadron) return "RESIDENTE";
    if (p.rutina) return "HABITUAL";
    if (p.diasVistos >= 4) return "FRECUENTE";
    if (p.diasVistos >= 2) return "OCASIONAL";
    return "PRIMERA_VEZ";
}

export const NOMBRE_CLASE: Record<Clase, string> = {
    RESIDENTE: "Residente", HABITUAL: "Habitual con rutina", FRECUENTE: "Frecuente", OCASIONAL: "Ocasional", PRIMERA_VEZ: "Primera vez",
};

/** Distancia en minutos entre dos horas del día, dando la vuelta por la medianoche. */
export function distanciaMin(a: number, b: number): number {
    const d = Math.abs((((a - b) % 1440) + 1440) % 1440);
    return Math.min(d, 1440 - d);
}

/**
 * ¿Esta llegada está fuera de su rutina? Fuera por DÍA si la rutina tiene días definidos (no
 * todos) y hoy no es uno; fuera por HORA si se aleja más del margen — o de tres desvíos, si su
 * rutina es más variable que el margen.
 */
export function fueraDeRutina(r: Rutina, llegada: Llegada, margenMin: number): { por: "dia" | "hora"; diferenciaMin: number } | null {
    const diferencia = distanciaMin(llegada.minuto, r.minutoMedio);
    if (r.dows.length < 7 && !r.dows.includes(llegada.dow)) return { por: "dia", diferenciaMin: diferencia };
    if (diferencia > Math.max(margenMin, 3 * r.desvioMin)) return { por: "hora", diferenciaMin: diferencia };
    return null;
}

/** ¿El minuto del día cae en la franja "HH:MM"–"HH:MM"? Si desde > hasta, la franja cruza la medianoche. */
export function enFranja(minuto: number, desde: string, hasta: string): boolean {
    const a = aMinutos(desde), b = aMinutos(hasta);
    return a <= b ? minuto >= a && minuto < b : minuto >= a || minuto < b;
}
export const aMinutos = (hm: string) => { const [h, m] = hm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

/** Día de la semana (1 = lunes) y minuto del día de un instante, en la zona del barrio. */
export function enZona(fecha: Date, zona: string): Llegada {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(fecha);
    const v = (t: string) => partes.find((p) => p.type === t)?.value || "";
    const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(v("weekday")) + 1;
    return { dow: dow || 1, minuto: Number(v("hour")) * 60 + Number(v("minute")) };
}

/**
 * "Entrada no vista": se la leyó saliendo y nunca entrando. NO es tránsito de calle: medido en
 * San Nicolás, la cámara de Entrada casi no lee de noche (de 19 a 6 h, 0–227 lecturas por hora
 * contra 300–600 de día) y la de Salida sí; los ómnibus aparecen en las dos. El auto entró sin
 * ser leído. Cuenta para frecuencia y rutina; lo único que no tiene es permanencia.
 */
export const entradaNoVista = (p: { entradas: number; salidas: number }) => p.entradas === 0 && p.salidas > 0;
