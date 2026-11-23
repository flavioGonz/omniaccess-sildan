import L from "leaflet";

/**
 * Mover un marcador y la cámara del mapa CON FRACCIÓN DE PÍXEL (23/11).
 *
 * Nico, mirando un auto a 24 km/h: «debe ser más continuo, sin tanto mini saltito… como si tuviera
 * más Hz». Tenía razón, y no era la cuenta de dónde está el auto, que ya se hacía en cada cuadro:
 * eran dos cosas de Leaflet.
 *
 *  1. **Leaflet redondea al píxel entero** la posición de todo marcador (`Marker.update` hace
 *     `latLngToLayerPoint(...).round()`), y también cada corrimiento del mapa (`panBy`). A la escala
 *     de una calle un píxel es un metro: un auto a 24 km/h avanza unos 7 píxeles por segundo, así
 *     que el dibujo cambiaba SIETE veces por segundo aunque la pantalla diera sesenta. Y en diagonal
 *     el eje X y el Y saltan en momentos distintos: una escalera. Ese es el «mini saltito».
 *
 *  2. **Seguir al auto disparaba `moveend` en cada cuadro.** `panTo` sin animación avisa «terminé de
 *     moverme» siempre, aunque no haya movido nada. El mapa del barrio escucha ese aviso para
 *     recalcular qué lotes están a la vista (un estado de React: se redibuja todo el mapa) y para
 *     guardar el encuadre en el navegador. Sesenta veces por segundo, las dos cosas.
 *
 * Lo de acá hace las dos cosas bien: deja que Leaflet lleve su cuenta en píxeles enteros —así el
 * arrastre, el zoom y la carga de imágenes siguen andando como siempre— y le agrega a lo que SE VE
 * la fracción que Leaflet tiró. Y cuando mueve la cámara avisa `move` en cada cuadro (lo necesitan
 * los carteles que flotan sobre el mapa, y es barato) pero `moveend` sólo cada tanto y al soltar.
 *
 * Usa dos cosas internas de Leaflet (`_rawPanBy`, `_getMapPanePos`), que no cambian desde la 1.0;
 * si faltaran, cae al camino de siempre: se ve a saltitos, pero anda.
 */

type MapaPorDentro = L.Map & { _rawPanBy?: (d: L.Point) => void; _getMapPanePos?: () => L.Point; _animatingZoom?: boolean };
type ConPosicion = HTMLElement & { _leaflet_pos?: L.Point };

/** Mientras el mapa anima un zoom, las cuentas de píxeles son las del zoom viejo: no se toca nada. */
export const enZoom = (mapa: L.Map): boolean => !!(mapa as MapaPorDentro)._animatingZoom;

/** Dónde cae un punto en la capa del mapa, SIN redondear. `latLngToLayerPoint` lo redondea. */
const puntoFino = (mapa: L.Map, ll: L.LatLngExpression): L.Point => mapa.project(ll).subtract(mapa.getPixelOrigin());

/** A lo que Leaflet puso en píxeles enteros, sumarle la fracción que falta. Su cuenta (`_leaflet_pos`) no se toca. */
function afinar(el: HTMLElement | null | undefined, resto: L.Point) {
    const base = (el as ConPosicion | null | undefined)?._leaflet_pos;
    if (el && base) L.DomUtil.setTransform(el, L.point(base.x + resto.x, base.y + resto.y));
}

/**
 * Poner un marcador en `ll`, con fracción de píxel. Es `setLatLng` (Leaflet sigue sabiendo dónde
 * está: el globo lo acompaña, el zoom lo reubica) más la fracción, también para su globo o su
 * cartel si están abiertos: si no, el auto iría suave y el globo a saltitos al lado.
 */
export function ponerFino(mapa: L.Map, marca: L.Marker, ll: [number, number]) {
    marca.setLatLng(ll);
    if (enZoom(mapa)) return;
    const fino = puntoFino(mapa, ll), resto = fino.subtract(fino.round());
    afinar(marca.getElement(), resto);
    const globo = marca.getPopup(), cartel = marca.getTooltip();
    if (globo?.isOpen()) afinar(globo.getElement(), resto);
    if (cartel && mapa.hasLayer(cartel)) afinar(cartel.getElement(), resto);
}

/** Cada cuánto se avisa `moveend` mientras la cámara sigue a algo: alcanza para cargar imágenes y recalcular qué se ve. */
const AVISO_MS = 400;
/** Sin que nadie la lleve por este rato, la cámara se da por quieta y se suelta sola. */
export const QUIETO_MS = 250;

/**
 * Una cámara que se queda clavada sobre un punto que se mueve.
 *
 * `llevar(ll)` se llama en cada cuadro, DESPUÉS de mover el marcador. `soltar()` devuelve el mapa a
 * píxeles enteros (la fracción deja las imágenes apenas blandas; quieto tiene que verse nítido) y
 * manda el `moveend` que quedó debiendo. Se llama sola si pasa un rato sin que nadie la lleve —una
 * pausa, el final del camino—, así quien la usa no tiene que acordarse en cada salida.
 */
export function crearCamara(mapa: L.Map) {
    const m = mapa as MapaPorDentro;
    let ultimoAviso = 0, debe = false, reloj: ReturnType<typeof setTimeout> | null = null;
    const soltar = () => {
        if (reloj) { clearTimeout(reloj); reloj = null; }
        if (m._getMapPanePos) L.DomUtil.setTransform(mapa.getPane("mapPane")!, m._getMapPanePos());
        if (debe) { debe = false; ultimoAviso = Date.now(); mapa.fire("moveend"); }
    };
    return {
        llevar(ll: [number, number]) {
            if (enZoom(mapa)) return;
            if (!m._rawPanBy || !m._getMapPanePos) { mapa.panTo(ll, { animate: false }); return; }      // el camino de siempre
            const centro = mapa.getSize().divideBy(2);
            /* Cuánto hay que correr el mapa para que el punto quede en el centro. */
            const falta = puntoFino(mapa, ll).add(m._getMapPanePos()).subtract(centro);
            /* Muy lejos (recién se empezó a seguir, o hubo un salto): se va de una, como siempre. */
            if (Math.abs(falta.x) > centro.x || Math.abs(falta.y) > centro.y) { mapa.setView(ll, mapa.getZoom(), { animate: false }); return; }
            const entero = falta.round();
            if (entero.x || entero.y) m._rawPanBy(entero);
            const resto = falta.subtract(entero), base = m._getMapPanePos();
            L.DomUtil.setTransform(mapa.getPane("mapPane")!, L.point(base.x - resto.x, base.y - resto.y));
            mapa.fire("move");
            debe = true;
            const ahora = Date.now();
            if (ahora - ultimoAviso >= AVISO_MS) { ultimoAviso = ahora; debe = false; mapa.fire("moveend"); }
            if (reloj) clearTimeout(reloj);
            reloj = setTimeout(soltar, QUIETO_MS);
        },
        soltar,
    };
}
export type CamaraFina = ReturnType<typeof crearCamara>;
