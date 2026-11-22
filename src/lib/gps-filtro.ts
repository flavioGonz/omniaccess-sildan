import { limiteDeFiltro, limitesDelDia, paraInput, ZONA } from "@/lib/fechas";
import { EVENTOS_GPS, type ClaseEventoGps } from "@/lib/gps-eventos";

/**
 * Los filtros del cajón de un rastreador en el mapa.
 *
 * Pedido de Nico (22/11): «el GPS en su drawer debe permitir, en el mapa, filtrar por fecha y hora
 * también; mejorá todos los filtros». Había dos: la clase (alarmas, geocercas…) y cuatro períodos
 * fijos contados hacia atrás desde ahora. Con eso no se podía contestar la pregunta más común
 * después de un problema: «¿qué pasó el jueves entre las dos y las cuatro de la mañana?».
 *
 * Ahora el período puede ser un día (hoy, ayer), una ventana hacia atrás, o un rango con fecha y
 * hora de los dos lados; y además se filtra por texto, por tipo de evento dentro de la clase y por
 * «sólo los que abrieron un caso». El mismo período sirve para pedir el recorrido en el mapa.
 *
 * Las fechas que escribe una persona son horas DEL SITIO, no del navegador ni del servidor: de eso
 * se ocupa `limiteDeFiltro` (lib/fechas).
 */

export type PeriodoGps = "hoy" | "ayer" | "24h" | "7d" | "30d" | "todo" | "rango";
export type FiltroGps = {
    clase: ClaseEventoGps | null;
    /** Tipos concretos dentro de la clase. Vacío = todos los de la clase. */
    tipos: string[];
    periodo: PeriodoGps;
    /** Sólo con `periodo: "rango"`: lo que entrega un <input type="datetime-local">, «2026-11-19T02:00». */
    desde: string; hasta: string;
    texto: string;
    /** Sólo los que abrieron un caso en Gestión de alarmas. */
    soloCasos: boolean;
};
export const FILTRO_INICIAL: FiltroGps = { clase: null, tipos: [], periodo: "7d", desde: "", hasta: "", texto: "", soloCasos: false };

export const PERIODOS_GPS: { clave: PeriodoGps; rotulo: string }[] = [
    { clave: "hoy", rotulo: "Hoy" }, { clave: "ayer", rotulo: "Ayer" }, { clave: "24h", rotulo: "24 h" },
    { clave: "7d", rotulo: "7 días" }, { clave: "30d", rotulo: "30 días" }, { clave: "todo", rotulo: "Todo" }, { clave: "rango", rotulo: "Fechas" },
];

/** Una fecha como la quiere un <input type="datetime-local">, en la hora del sitio. */
export function paraInputConHora(d: Date): string {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
    const de = (t: string) => p.find((x) => x.type === t)?.value || "00";
    return `${de("year")}-${de("month")}-${de("day")}T${de("hour")}:${de("minute")}`;
}

/**
 * De qué instante a qué instante es el período. `null` es «sin límite» de ese lado: «hasta» nulo
 * es hasta ahora, y por eso lo que pasa mientras se mira sigue entrando.
 *
 * Un rango a medio escribir no es un error: con sólo el «desde» va de ahí hasta ahora; con sólo el
 * «hasta», desde el principio. El único rango imposible es el que termina antes de empezar.
 */
export function rangoDeFiltro(f: Pick<FiltroGps, "periodo" | "desde" | "hasta">, ahora: Date = new Date()): { desde: Date | null; hasta: Date | null; error?: string } {
    const atras = (h: number) => ({ desde: new Date(ahora.getTime() - h * 3600_000), hasta: null });
    if (f.periodo === "24h") return atras(24);
    if (f.periodo === "7d") return atras(24 * 7);
    if (f.periodo === "30d") return atras(24 * 30);
    if (f.periodo === "hoy") return { desde: limitesDelDia(paraInput(ahora))?.inicio ?? null, hasta: null };
    if (f.periodo === "ayer") {
        const hoy = limitesDelDia(paraInput(ahora));
        // El día anterior a hoy EN EL SITIO: un minuto antes de su medianoche, sea cual sea el huso.
        const ayer = hoy ? limitesDelDia(paraInput(new Date(hoy.inicio.getTime() - 60_000))) : null;
        return { desde: ayer?.inicio ?? null, hasta: ayer?.fin ?? null };
    }
    if (f.periodo === "rango") {
        const desde = limiteDeFiltro(f.desde, "inicio"), hasta = limiteDeFiltro(f.hasta, "fin");
        if (desde && hasta && desde > hasta) return { desde, hasta, error: "El «desde» es posterior al «hasta»." };
        return { desde, hasta };
    }
    return { desde: null, hasta: null };
}

/** Los tipos de evento cuyo nombre dice eso: «corte» encuentra «Le cortaron la alimentación». */
export function tiposQueDicen(texto: string): string[] {
    const t = sinTildes(texto);
    return t.length < 2 ? [] : Object.entries(EVENTOS_GPS).filter(([, f]) => sinTildes(f.rotulo).includes(t)).map(([tipo]) => tipo);
}
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Cuántos filtros están puestos además del período: lo que dice el botón de «Limpiar». */
export const filtrosPuestos = (f: FiltroGps): number => (f.clase ? 1 : 0) + (f.tipos.length ? 1 : 0) + (f.texto.trim() ? 1 : 0) + (f.soloCasos ? 1 : 0);

/** Lo más largo que puede ser el período para pedir su recorrido: más es una telaraña, no un recorrido. */
export const RECORRIDO_MAX_DIAS = 31;
/** ¿Se puede pedir el recorrido de ese período? Necesita un comienzo y no pasar de un mes. */
export function sirveParaRecorrido(r: { desde: Date | null; hasta: Date | null; error?: string }, ahora: Date = new Date()): boolean {
    if (r.error || !r.desde) return false;
    const fin = r.hasta ?? ahora;
    return fin > r.desde && fin.getTime() - r.desde.getTime() <= RECORRIDO_MAX_DIAS * 86_400_000 + 60_000;
}
