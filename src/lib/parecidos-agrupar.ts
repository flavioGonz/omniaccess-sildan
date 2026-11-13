/**
 * Lo repetido, en una sola tarjeta (búsqueda de parecidos).
 *
 * Por qué existe (13/11, Nico: «búsqueda de parecidos anda muy mal… trae cualquier cosa»). El
 * registro está lleno de lo mismo visto otra vez: el auto estacionado, que cada vehículo que
 * cruza hace detectar de nuevo y se guarda como otra pista. Medido ese día en el lab, sobre
 * 80.000 vehículos de siete días: de los sesenta resultados de una búsqueda, más de cuarenta
 * eran repeticiones de otro que ya estaba en la lista. Cada una ocupa un lugar y empuja afuera a
 * un candidato distinto, que es lo que se vino a buscar.
 *
 * Qué cuenta como «lo mismo otra vez» — las tres cosas juntas:
 *   - la MISMA cámara (entre cámaras distintas la coincidencia ES el hallazgo: nunca se agrupa);
 *   - casi la misma huella (coseno ≥ REPETIDO_COSENO);
 *   - casi la misma CAJA en la foto (se pisan ≥ REPETIDO_CAJA): no se movió de su lugar.
 *
 * Y NO en las cámaras de acceso (`fija: false`). Ahí cada pista es un vehículo distinto que
 * frena en el mismo punto, con el mismo encuadre, y dos autos parecidos dan la misma huella y la
 * misma caja. Medido con 554 vehículos con chapa leída en cinco lectoras del lab:
 *
 *     sólo coseno ≥ 0,97            → el 23 % de lo que juntaba eran vehículos DISTINTOS
 *     coseno ≥ 0,95 y caja ≥ 0,92   → el 8 %
 *
 * (La chapa leída también se equivoca, así que el número real es algo mejor; no se sabe cuánto.)
 * Esconder uno de cada doce candidatos distintos no es aceptable en una búsqueda, así que en los
 * accesos no se agrupa nada. En las demás cámaras el criterio no está medido —no hay chapa con
 * qué etiquetar—: se apoya en que un vehículo que pasa no deja su mejor foto en la caja exacta de
 * otro. El caso que sí puede fallar: dos autos parecidos estacionados en el mismo lugar en
 * momentos distintos.
 *
 * Queda la más parecida a lo buscado de cada grupo, con cuántas veces se la vio (`veces`).
 * No toca el orden: sólo saca de la fila lo que ya está representado.
 */
export const REPETIDO_COSENO = 0.95;
export const REPETIDO_CAJA = 0.92;
/** Hasta dónde se baja por la lista buscando candidatos distintos para llenarla. */
const MIRAR_MAX = 1500;
/** Y cuánto se mira aunque ya esté llena, para contar bien las repeticiones de lo que quedó. */
const MIRAR_MIN = 240;
/** Ids de los repetidos que se devuelven con cada tarjeta; el número va entero en `veces`. */
const REPETIDOS_QUE_SE_LISTAN = 12;

export type Candidato = {
    id: string; coseno: number; camara: string | null; v: Int8Array;
    /** La caja en la foto, normalizada [x1, y1, x2, y2]. Sin caja no se agrupa. */
    caja: number[] | null;
    /** Una cámara donde lo quieto es lo mismo (no un acceso, donde cada pista es otro vehículo). */
    fija: boolean;
};
export type Agrupado<T> = T & { veces: number; repetidos: string[] };

const norma = (v: Int8Array) => { let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; return Math.sqrt(n) || 1; };
/** Cuánto se pisan dos cajas (intersección sobre unión). */
export function solape(a: number[] | null, b: number[] | null): number {
    if (!a || !b || a.length !== 4 || b.length !== 4) return 0;
    const i = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
}

/** `orden` viene de más a menos parecido. Devuelve hasta `cuantos` representantes, en ese orden. */
export function agruparRepetidos<T extends Candidato>(orden: T[], cuantos: number): Agrupado<T>[] {
    const puestos: (Agrupado<T> & { n: number })[] = [];
    const hasta = Math.min(orden.length, MIRAR_MAX);
    for (let k = 0; k < hasta; k++) {
        if (puestos.length >= cuantos && k >= MIRAR_MIN) break;
        const c = orden[k], n = norma(c.v);
        let igual: (typeof puestos)[number] | null = null;
        if (c.camara && c.fija && c.caja) {
            for (const p of puestos) {
                if (p.camara !== c.camara || p.v.length !== c.v.length || solape(c.caja, p.caja) < REPETIDO_CAJA) continue;
                let d = 0;
                for (let i = 0; i < c.v.length; i++) d += c.v[i] * p.v[i];
                if (d / (n * p.n) >= REPETIDO_COSENO) { igual = p; break; }
            }
        }
        if (igual) { igual.veces++; if (igual.repetidos.length < REPETIDOS_QUE_SE_LISTAN) igual.repetidos.push(c.id); continue; }
        // Lleno: se sigue sólo para contar los repetidos de lo que ya está, no para sumar tarjetas.
        if (puestos.length >= cuantos) continue;
        puestos.push({ ...c, veces: 1, repetidos: [], n });
    }
    return puestos.map(({ n: _n, ...p }) => p as unknown as Agrupado<T>);
}
