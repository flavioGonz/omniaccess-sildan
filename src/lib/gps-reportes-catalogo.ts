/**
 * Los reportes de rastreo: cuáles hay y cómo se lee cada celda (22/11).
 *
 * Pedido de Nico: «reportes en Excel y PDF; debe tener todo lo que tiene un soft de rastreo
 * satelital». Hasta acá había una sola planilla, de un vehículo y de los últimos siete días.
 *
 * Este archivo no calcula nada: es lo que comparten la pantalla, el Excel y el PDF para decir lo
 * mismo con las mismas palabras. Un reporte es una TABLA —columnas con formato, filas, un total—
 * y cada salida la dibuja a su manera: la pantalla y el PDF con `textoDeCelda`, el Excel con
 * números de verdad para que se puedan sumar y filtrar. Va aparte de la cuenta (lib/gps-reportes)
 * para que la pantalla no arrastre al navegador las librerías del cálculo.
 */

export type ClaveReporte = "resumen" | "dias" | "viajes" | "paradas" | "excesos" | "geocercas" | "motor" | "fuera" | "eventos" | "posiciones";

export const REPORTES_GPS: { clave: ClaveReporte; titulo: string; hoja: string; ayuda: string; soloExcel?: boolean }[] = [
    { clave: "resumen", titulo: "Resumen por vehículo", hoja: "Resumen", ayuda: "Un renglón por vehículo: cuánto anduvo, cuánto estuvo quieto, a cuánto llegó, excesos y alarmas." },
    { clave: "dias", titulo: "Kilometraje por día", hoja: "Por día", ayuda: "Cada día de cada vehículo: viajes, kilómetros, primera salida y última llegada." },
    { clave: "viajes", titulo: "Viajes", hoja: "Viajes", ayuda: "Cada viaje: de dónde salió, a dónde llegó, cuánto tardó y a qué velocidad." },
    { clave: "paradas", titulo: "Paradas y estacionamientos", hoja: "Paradas", ayuda: "Dónde quedó quieto y cuánto tiempo, entre viaje y viaje." },
    { clave: "excesos", titulo: "Excesos de velocidad", hoja: "Excesos", ayuda: "Cada vez que pasó la velocidad permitida: cuándo, cuánto duró y a cuánto llegó." },
    { clave: "geocercas", titulo: "Visitas a geocercas", hoja: "Geocercas", ayuda: "Cuándo entró y salió de cada zona, y cuánto se quedó." },
    { clave: "motor", titulo: "Horas de motor y ralentí", hoja: "Motor", ayuda: "Cada vez que se encendió el motor: cuánto estuvo en marcha y cuánto de eso sin moverse." },
    { clave: "fuera", titulo: "Uso fuera de horario", hoja: "Fuera de horario", ayuda: "Los viajes que empezaron o terminaron fuera del horario laboral." },
    { clave: "eventos", titulo: "Eventos y alarmas", hoja: "Eventos", ayuda: "Todo lo que avisó el equipo o se dedujo: alarmas, geocercas, cortes de conexión, comandos." },
    { clave: "posiciones", titulo: "Detalle de posiciones", hoja: "Posiciones", ayuda: "Cada posición que reportó el equipo, una por renglón. Es un listado largo: va sólo al Excel.", soloExcel: true },
];
export const CLAVES_REPORTE = REPORTES_GPS.map((r) => r.clave);
/** Lo que sale si no se elige nada: todo menos el listado crudo, que es para quien lo va a buscar. */
export const REPORTES_POR_DEFECTO: ClaveReporte[] = CLAVES_REPORTE.filter((c) => c !== "posiciones");
export const leerClaves = (texto: string | null | undefined): ClaveReporte[] => {
    const pedidas = String(texto || "").split(",").map((x) => x.trim()).filter((x): x is ClaveReporte => (CLAVES_REPORTE as string[]).includes(x));
    return pedidas.length ? CLAVES_REPORTE.filter((c) => pedidas.includes(c)) : REPORTES_POR_DEFECTO;
};

/**
 * Qué clase de dato lleva una columna. La celda guarda el número crudo (minutos, metros, km/h):
 * la unidad se la pone quien la dibuja. Así el Excel recibe números que se suman y la pantalla un
 * texto que se lee, sin que haya dos cuentas que puedan no coincidir.
 */
export type Formato = "texto" | "entero" | "km" | "kmh" | "dur" | "seg" | "metros" | "coord" | "lugar";
export type Columna = { rotulo: string; formato: Formato; /** Ancho en la planilla, en caracteres. */ ancho: number };
/** Un punto del mapa con su nombre, si cae en una geocerca o cerca de una. En el Excel es un enlace al mapa. */
export type Lugar = { lugar: string | null; lat: number; lon: number };
export type Celda = string | number | null | Lugar;
export type TablaReporte = {
    clave: ClaveReporte; titulo: string; hoja: string; ayuda: string;
    columnas: Columna[]; filas: Celda[][];
    /** El renglón de totales, con las mismas columnas. Null si sumar no dice nada (eventos). */
    total: Celda[] | null;
    /** Algo que hay que saber para leerla bien: de dónde sale el dato, o por qué está vacía. */
    nota: string | null;
    /** Qué decir si no tiene filas. */
    vacio: string;
    /** Cuántas filas tiene de verdad: la vista previa trae sólo las primeras. */
    filasTotales: number;
};

export const esLugar = (c: Celda): c is Lugar => !!c && typeof c === "object";

const coma = (n: number, decimales: number) => n.toFixed(decimales).replace(".", ",");
/** «45 min», «1 h 05 min». Menos de un minuto se dice, no se redondea a cero. */
export function duracionDeReporte(minutos: number): string {
    const m = Math.round(minutos);
    if (m < 1) return "menos de 1 min";
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}
/** Cómo se lee una celda en pantalla y en el PDF. Vacía es «—»: una celda en blanco parece un dato que falta cargar. */
export function textoDeCelda(formato: Formato, c: Celda, vacio = "—"): string {
    if (c === null || c === "") return vacio;
    if (esLugar(c)) return c.lugar || `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`;
    if (typeof c === "string") return c;
    switch (formato) {
        case "km": return `${coma(c, 1)} km`;
        case "kmh": return `${Math.round(c)} km/h`;
        case "dur": return duracionDeReporte(c);
        case "seg": return c < 60 ? `${Math.round(c)} s` : `${Math.floor(c / 60)} min ${String(Math.round(c % 60)).padStart(2, "0")} s`;
        case "metros": return c >= 1000 ? `${coma(c / 1000, 1)} km` : `${Math.round(c)} m`;
        case "coord": return c.toFixed(6);
        default: return Math.round(c).toLocaleString("es-UY");
    }
}
/** Los formatos que son números: en las tablas van alineados a la derecha, para comparar de un vistazo. */
export const esNumero = (f: Formato) => f !== "texto" && f !== "lugar";

/** Los totales del período, para la cabecera del PDF y de la pantalla. */
export type TotalesDeReporte = { vehiculos: number; viajes: number; km: number; andandoMin: number; estacionadoMin: number; ralentiMin: number | null; velMax: number; excesos: number; alarmas: number; fuera: number | null };
