import { useSyncExternalStore } from "react";

/**
 * El puente entre el mapa y su capa de GPS.
 *
 * El menú contextual del mapa (clic derecho sobre el plano) vive en `BarrioMap`; las geocercas, su
 * borrador y su panel viven en `CapaGps`, que es una capa adentro del mapa. Para que el menú pueda
 * decir «nueva geocerca acá» (22/11, Nico: «en el menú contextual del mapa, agregá la posibilidad
 * de agregar geocercas») hacen falta dos cosas que cruzan de un componente al otro:
 *  · que el menú sepa si hay rastreadores — sin ninguno, ofrecer geocercas es ofrecer algo que no
 *    hace nada —, y
 *  · que el pedido llegue a la capa, con el punto donde se hizo clic.
 * Es un avisador mínimo y no un contexto de React porque la capa es hija del mapa y el menú es su
 * hermano: no hay un padre común más cerca que la pantalla entera.
 */

export type PedidoDeGeocerca = { que: "circulo" | "libre" | "ver"; /** Dónde se hizo clic, en la pantalla. */ x?: number; y?: number };

let hay = false;
const oyentes = new Set<() => void>();
const pedidos = new Set<(p: PedidoDeGeocerca) => void>();

/** La capa avisa si tiene rastreadores a la vista. */
export function avisarRastreadores(v: boolean) { if (v !== hay) { hay = v; for (const o of oyentes) o(); } }
/** ¿Hay rastreadores en el mapa? Para mostrar u ocultar lo de GPS en los menús del mapa. */
export function useHayRastreadores(): boolean {
    return useSyncExternalStore((cb) => { oyentes.add(cb); return () => { oyentes.delete(cb); }; }, () => hay, () => false);
}
/** El menú pide una geocerca; la capa la atiende. */
export function pedirGeocerca(p: PedidoDeGeocerca) { for (const f of pedidos) f(p); }
export function alPedirGeocerca(f: (p: PedidoDeGeocerca) => void): () => void { pedidos.add(f); return () => { pedidos.delete(f); }; }
