/**
 * Lo repetido, en una sola tarjeta (búsqueda de parecidos).
 *
 * Por qué existe (13/11, Nico: «búsqueda de parecidos anda muy mal… trae cualquier cosa»). Medido
 * ese día sobre todo el registro del lab (227 búsquedas): el 29 % de lo que se mostraba eran
 * REPETIDOS — el mismo auto estacionado, o la misma persona parada, vistos otra vez por la misma
 * cámara y guardados como otra pista. Cada repetido ocupa uno de los sesenta lugares y empuja
 * afuera a un candidato distinto, que es lo que se vino a buscar.
 *
 * Dos pistas son «lo mismo otra vez» si son de la MISMA cámara y sus huellas son casi idénticas
 * (coseno ≥ REPETIDO_COSENO). Para dar la escala: en esa medición el mismo vehículo visto dos
 * veces por la misma cámara daba alrededor de 0,87, y dos vehículos distintos en la misma cámara,
 * alrededor de 0,75. 0,97 es casi la misma foto: mismo encuadre, mismo lugar, misma luz. Es un
 * umbral prudente y NO está afinado: si agrupa de menos se ven repetidos, que es lo de antes; lo
 * que no puede pasar es que junte dos cosas distintas. Entre cámaras distintas nunca se agrupa —
 * ahí la coincidencia ES el hallazgo.
 *
 * Queda la más parecida a lo buscado de cada grupo, con cuántas veces se la vio (`veces`).
 * No toca el orden: sólo saca de la fila lo que ya está representado.
 */
export const REPETIDO_COSENO = 0.97;
/** Cuántos candidatos (los más parecidos) se miran para llenar la lista: lo demás no iba a entrar igual. */
export const CANDIDATOS_A_AGRUPAR = 240;
/** Ids de los repetidos que se devuelven con cada tarjeta (para abrirlos); el número va entero en `veces`. */
const REPETIDOS_QUE_SE_LISTAN = 12;

export type Candidato = { id: string; coseno: number; camara: string | null; v: Int8Array };
export type Agrupado<T> = T & { veces: number; repetidos: string[] };

const norma = (v: Int8Array) => { let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; return Math.sqrt(n) || 1; };

/**
 * `orden` viene de más a menos parecido. Devuelve hasta `cuantos` representantes, en ese orden.
 */
export function agruparRepetidos<T extends Candidato>(orden: T[], cuantos: number, umbral = REPETIDO_COSENO): Agrupado<T>[] {
    const puestos: (Agrupado<T> & { n: number })[] = [];
    for (const c of orden.slice(0, Math.max(cuantos, CANDIDATOS_A_AGRUPAR))) {
        const n = norma(c.v);
        let igual: (typeof puestos)[number] | null = null;
        if (c.camara) {
            for (const p of puestos) {
                if (p.camara !== c.camara || p.v.length !== c.v.length) continue;
                let d = 0;
                for (let i = 0; i < c.v.length; i++) d += c.v[i] * p.v[i];
                if (d / (n * p.n) >= umbral) { igual = p; break; }
            }
        }
        if (igual) { igual.veces++; if (igual.repetidos.length < REPETIDOS_QUE_SE_LISTAN) igual.repetidos.push(c.id); continue; }
        // Lleno: se sigue sólo para contar los repetidos de lo que ya está, no para sumar tarjetas.
        if (puestos.length >= cuantos) continue;
        puestos.push({ ...c, veces: 1, repetidos: [], n });
    }
    return puestos.map(({ n: _n, ...p }) => p as unknown as Agrupado<T>);
}
