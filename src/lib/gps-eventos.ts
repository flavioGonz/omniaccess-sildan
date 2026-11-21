/**
 * Lo que le puede pasar a un rastreador GPS, como lo muestran las pantallas: el nombre, de qué
 * clase es, con qué tono y con qué dibujo. Sin prisma ni React: lo usan el cajón de eventos del
 * mapa, los carteles y la consola de alarmas.
 *
 * Los TIPOS salen de lib-gps-eventos.js (el receptor es JS suelto y no puede importar de acá);
 * tests/gps-eventos.test.ts comprueba que ninguno de los dos tenga un tipo que el otro no.
 *
 * El tono es ESTADO, como en el resto del sistema: `mal` es una alarma, `aviso` algo para mirar,
 * `bien` algo que se resolvió, `info` un hecho, `quieto` ruido que se anota por si hace falta.
 */

export type ClaseEventoGps = "alarma" | "geocerca" | "conexion" | "equipo";
export type TonoEventoGps = "mal" | "aviso" | "bien" | "info" | "quieto";
export type DibujoEventoGps = "sos" | "corte" | "vibracion" | "velocidad" | "movimiento" | "bateria" | "desarme" | "alarma" | "entra" | "sale" | "sinsat" | "consat" | "silencio" | "volvio" | "salto" | "rele";

type Ficha = { rotulo: string; clase: ClaseEventoGps; tono: TonoEventoGps; dibujo: DibujoEventoGps };

export const EVENTOS_GPS: Record<string, Ficha> = {
    GPS_SOS: { rotulo: "Botón de pánico (SOS)", clase: "alarma", tono: "mal", dibujo: "sos" },
    GPS_CORTE: { rotulo: "Le cortaron la alimentación", clase: "alarma", tono: "mal", dibujo: "corte" },
    GPS_DESARME: { rotulo: "Desarmaron el rastreador", clase: "alarma", tono: "mal", dibujo: "desarme" },
    GPS_MOVIMIENTO: { rotulo: "Se mueve con el motor apagado", clase: "alarma", tono: "mal", dibujo: "movimiento" },
    GPS_SALTO: { rotulo: "Posición imposible", clase: "alarma", tono: "aviso", dibujo: "salto" },
    GPS_VELOCIDAD: { rotulo: "Exceso de velocidad", clase: "alarma", tono: "aviso", dibujo: "velocidad" },
    /* La vibración va con el equipo y no con las alarmas: la manda el sensor del rastreador estando
       en guardia, decenas de veces por día, y no abre un caso. En «Alarmas» inflaba el número rojo
       de la pestaña con algo que nadie tiene que atender. */
    GPS_VIBRACION: { rotulo: "Vibración", clase: "equipo", tono: "quieto", dibujo: "vibracion" },
    GPS_OTRA: { rotulo: "Alarma del rastreador", clase: "alarma", tono: "aviso", dibujo: "alarma" },
    GPS_GEOCERCA_ENTRA: { rotulo: "Entró a una geocerca", clase: "geocerca", tono: "info", dibujo: "entra" },
    GPS_GEOCERCA_SALE: { rotulo: "Salió de una geocerca", clase: "geocerca", tono: "info", dibujo: "sale" },
    GPS_SIN_REPORTE: { rotulo: "Dejó de reportar", clase: "conexion", tono: "mal", dibujo: "silencio" },
    GPS_VOLVIO: { rotulo: "Volvió a reportar", clase: "conexion", tono: "bien", dibujo: "volvio" },
    GPS_SIN_SATELITES: { rotulo: "Entró a una zona sin satélites", clase: "conexion", tono: "quieto", dibujo: "sinsat" },
    GPS_CON_SATELITES: { rotulo: "Volvió a tener satélites", clase: "conexion", tono: "quieto", dibujo: "consat" },
    GPS_BATERIA: { rotulo: "Batería del vehículo baja", clase: "equipo", tono: "aviso", dibujo: "bateria" },
    GPS_BATERIA_EQUIPO: { rotulo: "Batería del rastreador baja", clase: "equipo", tono: "aviso", dibujo: "bateria" },
    // Los dos del relé no los manda el equipo: los anota la aplicación cuando alguien lo acciona.
    GPS_RELE_ACCIONADO: { rotulo: "Relé accionado", clase: "equipo", tono: "mal", dibujo: "rele" },
    GPS_RELE_SOLTADO: { rotulo: "Relé en reposo", clase: "equipo", tono: "bien", dibujo: "rele" },
};

/** Los que anota la aplicación y no el receptor (no figuran en lib-gps-eventos.js). */
export const EVENTOS_DE_LA_APLICACION = ["GPS_RELE_ACCIONADO", "GPS_RELE_SOLTADO"];

const DESCONOCIDO: Ficha = { rotulo: "Evento del rastreador", clase: "equipo", tono: "quieto", dibujo: "alarma" };
export const fichaDeEventoGps = (tipo: string): Ficha => EVENTOS_GPS[tipo] || { ...DESCONOCIDO, rotulo: tipo };

export const CLASES_EVENTO_GPS: { clave: ClaseEventoGps; rotulo: string }[] = [
    { clave: "alarma", rotulo: "Alarmas" },
    { clave: "geocerca", rotulo: "Geocercas" },
    { clave: "conexion", rotulo: "Conexión" },
    { clave: "equipo", rotulo: "Equipo" },
];
export const tiposDeClase = (c: ClaseEventoGps): string[] => Object.entries(EVENTOS_GPS).filter(([, f]) => f.clase === c).map(([t]) => t);

/**
 * El renglón como se lee. En un cruce de geocerca el detalle ES el nombre de la zona, así que va
 * en el título («Entró a Base») en vez de un título genérico con el dato escondido abajo.
 */
export function tituloDeEventoGps(e: { tipo: string; detalle?: string | null }): { titulo: string; resto: string | null } {
    const d = (e.detalle || "").trim();
    if (e.tipo === "GPS_GEOCERCA_ENTRA" && d) return { titulo: `Entró a ${d}`, resto: null };
    if (e.tipo === "GPS_GEOCERCA_SALE" && d) return { titulo: `Salió de ${d}`, resto: null };
    return { titulo: fichaDeEventoGps(e.tipo).rotulo, resto: d || null };
}

/** «9 min», «1 h 20 min»: cuánto tardó en llegar una noticia. */
export function demoraLegible(segundos: number | null | undefined): string | null {
    if (!segundos || segundos < 60) return null;
    const min = Math.round(segundos / 60);
    return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

export type EventoGpsLista = { id: string; tipo: string; cuando: string };
export type GrupoEventos<T> = { clave: string; eventos: T[] };

/** Los que se repiten sin que cada uno diga algo nuevo. Sólo éstos se pliegan. */
const SE_PLIEGAN = new Set(["GPS_VIBRACION", "GPS_SIN_SATELITES", "GPS_CON_SATELITES"]);
const PLIEGUE_MIN = 3;

/**
 * Pliega las rachas: tres o más eventos seguidos del mismo tipo «de ruido» pasan a ser un solo
 * renglón que se abre. Medido el 21/11: 62 vibraciones en un día con el auto estacionado tapaban
 * el único corte de alimentación de la lista. No se pliegan las alarmas de verdad: dos SOS seguidos
 * son dos SOS.
 *
 * La lista entra y sale en el mismo orden (más nuevo primero). Los satélites se pliegan juntos
 * (perdió / recuperó / perdió…): es un mismo garage.
 */
export function plegarEventos<T extends EventoGpsLista>(lista: T[]): GrupoEventos<T>[] {
    const familia = (t: string) => (t === "GPS_CON_SATELITES" ? "GPS_SIN_SATELITES" : t);
    const out: GrupoEventos<T>[] = [];
    let i = 0;
    while (i < lista.length) {
        const f = familia(lista[i].tipo);
        let j = i + 1;
        if (SE_PLIEGAN.has(lista[i].tipo)) while (j < lista.length && familia(lista[j].tipo) === f) j++;
        if (j - i >= PLIEGUE_MIN) out.push({ clave: `g-${lista[i].id}`, eventos: lista.slice(i, j) });
        else for (let k = i; k < j; k++) out.push({ clave: lista[k].id, eventos: [lista[k]] });
        i = j;
    }
    return out;
}
