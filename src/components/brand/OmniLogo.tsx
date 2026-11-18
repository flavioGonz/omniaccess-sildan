/**
 * Isotipo OmniAccess.
 *
 * El recuadro de detección (las cuatro esquinas que OmniVision dibuja sobre lo que ve)
 * encuadrando una lente. El punto del centro es OmniVision: lo único de color propio.
 *
 * Reemplaza al anillo con cheurón (octubre 2026, identidad nueva). Las esquinas y la
 * lente van con `currentColor` para que el isotipo herede el color del texto donde se
 * pone —claro sobre la barra oscura, oscuro sobre papel— en vez de traer un degradado
 * fijo que en uno de los dos temas no se lee.
 *
 * Es el mismo dibujo que va en scripts/iconos-marca.py y en la portada de los manuales
 * (scripts/build-manuals.js): si se cambia acá, cambiarlo también allá.
 */

/** El violeta de OmniVision. Es de la marca, no de la interfaz: no es un tono de estado
 *  ni un color de acción, por eso no vive entre los tokens de globals.css. */
export const VIOLETA_OMNIVISION = "#8A6CFF";

/** Las cuatro esquinas del recuadro de detección, en una sola traza. */
export const ESQUINAS = "M6 20V10a4 4 0 0 1 4-4h10M44 6h10a4 4 0 0 1 4 4v10M58 44v10a4 4 0 0 1-4 4H44M20 58H10a4 4 0 0 1-4-4V44";

/**
 * El mismo isotipo como texto, para lo que no es React: componer el QR del censo, una imagen con
 * sharp, un PDF. Existe para que el servidor no tenga que leer un .svg suelto de `public/` —que
 * es justo como se coló el isotipo anterior en el formulario del censo el 18/11— ni volver a
 * dibujar las curvas a mano en otro archivo.
 */
export function isotipoSvg(trazo = "#0A0E14", lado = 64): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${lado}" height="${lado}" fill="none">`
        + `<path d="${ESQUINAS}" stroke="${trazo}" stroke-width="5" stroke-linecap="round"/>`
        + `<circle cx="32" cy="32" r="14" stroke="${trazo}" stroke-width="5"/>`
        + `<circle cx="32" cy="32" r="5.5" fill="${VIOLETA_OMNIVISION}"/>`
        + `</svg>`;
}

export function OmniLogo({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-label="OmniAccess" fill="none">
            <path d={ESQUINAS} stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            <circle cx="32" cy="32" r="14" stroke="currentColor" strokeWidth="5" />
            <circle cx="32" cy="32" r="5.5" fill={VIOLETA_OMNIVISION} />
        </svg>
    );
}

export default OmniLogo;
