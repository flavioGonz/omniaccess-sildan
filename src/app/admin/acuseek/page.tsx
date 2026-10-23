import { redirect } from "next/navigation";

/**
 * «Búsqueda inteligente» ya no es una pantalla aparte (21/10, Nico: «está todo mezclado y no queda
 * claro la búsqueda de parecidos nuestra con la de ellos»). Juntaba la búsqueda de OmniVision, la del
 * grabador (AcuSeek) y la de accesos, cada una con su grilla. Ahora es el buscador del Historial: lo
 * escrito busca en los registros, y un botón por motor suma OmniVision y la IA del grabador, todo en
 * la misma lista. Esta ruta queda para los enlaces viejos.
 */
export default async function BusquedaInteligente({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
    const q = (await searchParams)?.q;
    redirect(q ? `/admin/history?search=${encodeURIComponent(q)}` : "/admin/history");
}
