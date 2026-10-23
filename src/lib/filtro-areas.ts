/**
 * Filtrar el Historial por ÁREA (21/10, Nico: «el historial de acceso debe poder filtrar búsquedas
 * por áreas; recordá que los dispositivos los agrupamos en áreas»).
 *
 * Las áreas son las de Dispositivos (DEVICE_AREAS): cada equipo está en una, y un área puede tener
 * otras adentro. Elegir un área es elegir las cámaras que están en ella o en alguna de las de
 * adentro. El historial nombra a las cámaras por su nombre (el acceso, el seguimiento y OmniVision
 * guardan el nombre), así que el filtro termina siendo una lista de nombres.
 *
 * «Sin área» no es una lista sino lo contrario: lo que NO está en ningún área. Ahí entran también
 * las cámaras RTSP de OmniVision que no son un equipo dado de alta, que de otra forma no estarían
 * en ningún lado. Por eso el filtro es «en» (sólo estos nombres) o «fuera» (todos menos estos).
 *
 * Sin dependencias de servidor: lo usan la ruta (para la consulta) y la tabla (para lo que trae la
 * IA, que llega aparte y se filtra en pantalla).
 */
export const SIN_AREA = "__sin_area";

/** Un área con las cámaras que caen en ella (las suyas y las de las áreas de adentro), por nombre. */
export type AreaHistorial = { id: string; nombre: string; padre: string | null; color: string; nivel: number; camaras: string[] };
export type DatosAreasHistorial = { areas: AreaHistorial[]; /** Los nombres de todos los equipos que están en algún área. */ asignadas: string[] };

export type FiltroAreas = { en: string[] } | { fuera: string[] } | null;

export function filtroDeAreas(elegidas: string[], datos: DatosAreasHistorial | null): FiltroAreas {
    if (!elegidas.length || !datos) return null;
    const nombres = new Set(datos.areas.filter((a) => elegidas.includes(a.id)).flatMap((a) => a.camaras));
    if (!elegidas.includes(SIN_AREA)) return { en: [...nombres] };
    // «Sin área» más algunas áreas: todo lo que no está en un área, salvo lo de las elegidas.
    return { fuera: datos.asignadas.filter((n) => !nombres.has(n)) };
}

export const pasaAreas = (f: FiltroAreas, camara: string | null | undefined): boolean => {
    if (!f) return true;
    const c = camara || "";
    return "en" in f ? f.en.includes(c) : !f.fuera.includes(c);
};
