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

export function OmniLogo({ size = 24, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-label="OmniAccess" fill="none">
            <path d="M6 20V10a4 4 0 0 1 4-4h10M44 6h10a4 4 0 0 1 4 4v10M58 44v10a4 4 0 0 1-4 4H44M20 58H10a4 4 0 0 1-4-4V44"
                stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            <circle cx="32" cy="32" r="14" stroke="currentColor" strokeWidth="5" />
            <circle cx="32" cy="32" r="5.5" fill={VIOLETA_OMNIVISION} />
        </svg>
    );
}

export default OmniLogo;
