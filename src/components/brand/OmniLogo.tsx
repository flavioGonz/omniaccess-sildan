/**
 * Isotipo OmniAccess.
 *
 * Un anillo de cobertura (todo vigilado) con el paso abierto a la derecha y el
 * cheurón de avance (acceso autorizado). Es el mismo dibujo que va en la portada
 * de los manuales — si se cambia acá, cambiar también en scripts/build-manuals.js.
 */
export function OmniLogo({ size = 24, className }: { size?: number; className?: string }) {
    const id = `oa${size}`;
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-label="OmniAccess">
            <defs>
                <linearGradient id={id} x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#0ea5e9" />
                    <stop offset=".55" stopColor="#3b82f6" />
                    <stop offset="1" stopColor="#22d3ee" />
                </linearGradient>
            </defs>
            <path d="M51.7 16.6 A25 25 0 1 0 51.7 47.4" fill="none" stroke={`url(#${id})`} strokeWidth="5.4" strokeLinecap="round" />
            <path d="M41 21.3 A14 14 0 1 0 41 42.7" fill="none" stroke={`url(#${id})`} strokeWidth="4.4" strokeLinecap="round" opacity=".78" />
            <path d="M41.5 24 L49.8 32 L41.5 40" fill="none" stroke={`url(#${id})`} strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M53.4 27.2 L58.2 32 L53.4 36.8" fill="none" stroke={`url(#${id})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
        </svg>
    );
}

export default OmniLogo;
