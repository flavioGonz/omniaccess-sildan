/**
 * Los distintivos que van sobre el mapa, como HTML suelto.
 *
 * Viven acá y no adentro de una vista porque el barrio se mira con DOS motores: la vista
 * plana con capas dibujadas por Leaflet y la girada/3D con MapLibre. Los dos aceptan un
 * elemento de HTML como marcador, así que el dibujo puede ser el mismo — y tiene que
 * serlo: un guardia que se ve de una manera al girar el mapa y de otra al aplanarlo hace
 * dudar de si son el mismo guardia.
 *
 * Estaba escrito adentro de `BarrioMap.tsx`, así que la vista 3D no podía usarlo y
 * sencillamente no dibujaba los guardias.
 *
 * Son cadenas de HTML con estilo puesto a mano, y eso es a propósito: MapLibre crea el
 * elemento por fuera del árbol de React, donde una clase de Tailwind no llega. Los colores
 * salen de los tokens igual — `var()` funciona en un atributo `style`.
 */

/**
 * El guardia, con su nombre y hacia dónde mira.
 *
 * Verde porque es un estado —hay alguien y está reportando—, no una acción. El anillo
 * blanco no es decoración: esto va sobre una foto satelital, y a las tres de la tarde en
 * Calle 22 el fondo es asfalto gris con sol. Sin el borde, el distintivo desaparece.
 */
export const guardIconHtml = (name: string, heading?: number | null) => `
<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-2px)">
  <span style="margin-bottom:2px;padding:1px 6px;border-radius:6px;background:var(--bien);color:#fff;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)">${name}</span>
  <span style="position:relative;width:30px;height:30px;border-radius:50%;background:var(--bien);border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.45)">
    ${heading != null ? `<span style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${Math.round(heading)}deg);transform-origin:50% 24px"><svg width="14" height="14" viewBox="0 0 24 24" fill="var(--bien)" stroke="#fff" stroke-width="1.5"><path d="M12 2 L19 21 L12 17 L5 21 Z"/></svg></span>` : ``}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
  </span>
</div>`;

/** Lo que una vista necesita saber de un guardia para dibujarlo. */
export type GuardiaEnMapa = {
    id: string | number;
    lat: number;
    lng: number;
    guardName?: string | null;
    name?: string | null;
    heading?: number | null;
};
