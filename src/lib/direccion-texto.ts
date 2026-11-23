/**
 * Decir un punto del mapa en palabras: «Cavour 3230, La Blanqueada, Montevideo» (23/11).
 *
 * Hasta acá un lugar era el nombre de una geocerca o, si no había ninguna cerca, dos números con
 * cinco decimales. Una parada en «-34.88927, -56.14395» no le dice nada a nadie.
 *
 * Lo de acá no pregunta nada: toma lo que contesta el servicio de direcciones (Nominatim, con el
 * mapa de OpenStreetMap, en una máquina propia de IES) y arma el texto. Va suelto, sin base ni
 * red, para poder probarlo con respuestas de verdad.
 */

/** Las partes de una dirección como las devuelve Nominatim (`address`). Todas pueden faltar. */
export type PartesOsm = Partial<Record<
    "road" | "pedestrian" | "footway" | "path" | "cycleway" | "residential" | "house_number"
    | "neighbourhood" | "suburb" | "quarter" | "city_district"
    | "city" | "town" | "village" | "hamlet" | "municipality" | "county" | "state" | "country", string>>;

export type Direccion = { texto: string; calle: string | null; barrio: string | null; ciudad: string | null };

/** Cuántos decimales se guardan de un punto: cuatro son unos once metros, menos que el ancho de una calle. */
const DECIMALES = 4;
/**
 * La clave de un punto para guardarle la dirección. Dos puntos a menos de once metros comparten
 * dirección: un auto estacionado «camina» más que eso con el ruido del GPS, y sin redondear cada
 * salto sería una pregunta nueva por el mismo lugar.
 */
export const claveDeLugar = (lat: number, lon: number): string => `${lat.toFixed(DECIMALES)},${lon.toFixed(DECIMALES)}`;

const limpio = (x: string | undefined) => (x || "").trim() || null;

/**
 * La dirección en una línea, de lo más chico a lo más grande: calle y número, barrio, ciudad.
 *
 * Decisiones:
 *  · **El número va si viene**, aunque sea el del edificio más cercano y no el de la puerta exacta:
 *    es como la gente dice dónde dejó el auto.
 *  · **Sin el nombre del comercio de al lado.** El servicio devuelve el objeto más cercano, y un auto
 *    estacionado frente a una farmacia no «está en la farmacia». Un lugar con nombre propio es una
 *    geocerca, que la dibujó alguien y sabe lo que es.
 *  · **Lo repetido se dice una vez**: en una ciudad chica el barrio y la ciudad suelen llamarse igual.
 *  · Sin calle (campo, ruta sin nombre) queda el paraje o la localidad: sirve más que nada.
 *  · El país no va, y el departamento sólo si no hay nada más chico.
 */
export function textoDeDireccion(a: PartesOsm | null | undefined): Direccion | null {
    if (!a) return null;
    const via = limpio(a.road) || limpio(a.pedestrian) || limpio(a.residential) || limpio(a.footway) || limpio(a.cycleway) || limpio(a.path);
    const numero = limpio(a.house_number);
    const calle = via ? (numero ? `${via} ${numero}` : via) : null;
    const barrio = limpio(a.suburb) || limpio(a.neighbourhood) || limpio(a.quarter) || limpio(a.city_district);
    const ciudad = limpio(a.city) || limpio(a.town) || limpio(a.village) || limpio(a.hamlet) || limpio(a.municipality) || limpio(a.county) || limpio(a.state);
    const partes: string[] = [];
    for (const p of [calle, barrio, ciudad]) if (p && !partes.some((x) => x.toLowerCase() === p.toLowerCase())) partes.push(p);
    return partes.length ? { texto: partes.join(", "), calle, barrio, ciudad } : null;
}

/** Junta el nombre de la geocerca con la dirección: «en Base · Cavour 3230». La geocerca manda; la dirección la ubica. */
export function lugarConDireccion(geocerca: string | null | undefined, direccion: string | null | undefined): string | null {
    const g = (geocerca || "").trim(), d = (direccion || "").trim();
    if (g && d) return `${g} · ${d.split(", ")[0]}`;
    return g || d || null;
}
