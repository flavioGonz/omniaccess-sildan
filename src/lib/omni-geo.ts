import { contenedorPropio, fraseDeFase as frase, type EstadoContenedor, type FaseContenedor } from "@/lib/contenedor-propio";

/**
 * omni-geo: el contenedor de las direcciones, visto desde OmniAccess (23/11).
 *
 * Nico, apenas vio la primera versión —una máquina aparte, con su dirección de red cargada a
 * mano—: «¿no debe ser un contenedor de OmniAccess, en vez de algo aparte? ¿Activable como una
 * función incorporada?». Sí. Es lo mismo que omni-lpr y omni-vision: una pieza que viene con el
 * programa (`services/omni-geo`), que se prende desde Ajustes › Características y que cada
 * instalación tiene para sí, sin depender de un servidor de otro lado.
 *
 * Cómo se instala, se prende y se apaga está en `lib/contenedor-propio`, que comparte con
 * omni-rutas desde el 24/11. Acá queda quién es: su nombre, su puerto y cómo se le pregunta si anda.
 */

export const OMNI_GEO = "omni-geo";
export const PUERTO_GEO = Number(process.env.OMNI_GEO_PUERTO || 8020);
const geo = contenedorPropio({ nombre: OMNI_GEO, puerto: PUERTO_GEO, salud: "/status" });
/** Donde contesta el contenedor: sólo en este equipo. */
export const URL_GEO = geo.url;

export type FaseGeo = FaseContenedor;
export type EstadoGeo = EstadoContenedor;
export const estadoOmniGeo = geo.estado;
export const prenderOmniGeo = geo.prender;
export const apagarOmniGeo = geo.apagar;
export const fraseDeFase = (e: EstadoGeo): string => frase(e, "unos diez minutos");
