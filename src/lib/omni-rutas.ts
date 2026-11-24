import { contenedorPropio, fraseDeFase as frase, type EstadoContenedor, type FaseContenedor } from "@/lib/contenedor-propio";

/**
 * omni-rutas: el contenedor que dice por qué calle fue un recorrido, visto desde OmniAccess (24/11).
 *
 * Es OSRM con el mapa de OpenStreetMap del país (`services/omni-rutas`). Se prende con la función
 * «Recorridos por la calle» y corre en este mismo equipo, por lo mismo que las direcciones: por
 * dónde anda cada vehículo de un cliente no se le manda a un tercero.
 */

export const OMNI_RUTAS = "omni-rutas";
export const PUERTO_RUTAS = Number(process.env.OMNI_RUTAS_PUERTO || 8021);
/* Un punto cualquiera del mapa: lo que importa es que conteste, no qué (lo mismo que mira el contenedor para saberse sano). */
const rutas = contenedorPropio({ nombre: OMNI_RUTAS, puerto: PUERTO_RUTAS, salud: "/nearest/v1/driving/-56.16,-34.9" });
/** Donde contesta el contenedor: sólo en este equipo. */
export const URL_RUTAS = rutas.url;

export type FaseRutas = FaseContenedor;
export type EstadoRutas = EstadoContenedor;
export const estadoOmniRutas = rutas.estado;
export const prenderOmniRutas = rutas.prender;
export const apagarOmniRutas = rutas.apagar;
export const fraseDeRutas = (e: EstadoRutas): string => frase(e, "unos minutos");
