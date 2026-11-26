/**
 * Los proveedores de servicio de cada lote (26/11), sin base. Nico: «cada lote tiene que tener sus
 * propios servicios —jardinería, etc.— asociados a su lote, para identificar a proveedores de
 * servicio». Un servicio IDENTIFICA (quién es, qué días viene, en qué vehículo): no abre el portón.
 * Para que entre solo, hay que autorizarlo aparte; eso es otra decisión de la administración.
 */
import { DIAS, TIPOS_SERVICIO, type Dia, type ServicioCargado } from "@/lib/registro-padron";

export { TIPOS_SERVICIO, DIAS };
export const rotuloServicio = (t: string) => TIPOS_SERVICIO.find((x) => x.id === t)?.rotulo || t;

/** Los días en orden de semana y sin repetir, sólo los que existen. */
export const ordenarDias = (d: unknown): Dia[] => [...new Set((Array.isArray(d) ? d : []).map(String))].filter((x): x is Dia => (DIAS as readonly string[]).includes(x)).sort((a, b) => DIAS.indexOf(a) - DIAS.indexOf(b));

/** «lun a vie», «lun, mié y vie», «todos los días». Para leerlo de un vistazo en una fila. */
export function diasEnPalabras(dias: Dia[]): string {
    const d = ordenarDias(dias);
    if (!d.length) return "";
    if (d.length === 7) return "todos los días";
    const idx = d.map((x) => DIAS.indexOf(x));
    const seguidos = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    if (seguidos && d.length >= 3) return `${d[0]} a ${d[d.length - 1]}`;
    return d.length === 1 ? d[0] : `${d.slice(0, -1).join(", ")} y ${d[d.length - 1]}`;
}

/** Cuándo viene, en una línea: «lun a vie · 08:00 a 12:00». */
export const cuandoViene = (s: { dias: unknown; desde?: string | null; hasta?: string | null }) =>
    [diasEnPalabras(ordenarDias(s.dias)), s.desde || s.hasta ? `${s.desde || "?"} a ${s.hasta || "?"}` : ""].filter(Boolean).join(" · ");

/** El mismo servicio (para no duplicar al aprobar un censo que ya lo trae): mismo tipo y mismo nombre, o misma chapa. */
export function mismoServicio(a: { tipo: string; nombre?: string | null; chapa?: string | null }, b: { tipo: string; nombre?: string | null; chapa?: string | null }): boolean {
    const n = (x?: string | null) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    if (a.chapa && b.chapa && n(a.chapa) === n(b.chapa)) return true;
    return a.tipo === b.tipo && n(a.nombre) === n(b.nombre);
}

/** Un servicio del censo, en la forma de la tabla. */
export const delCenso = (s: ServicioCargado) => ({ tipo: s.tipo, nombre: s.nombre || "", dias: ordenarDias(s.dias), desde: s.desde || null, hasta: s.hasta || null, chapa: s.chapa || null });
