"use client";

import { useId } from "react";

/**
 * La marca de OmniAccess, dibujada acá en vez de traída de `/omniaccess-mark.svg`.
 *
 * El archivo existe en `public/` y no lo usaba ninguna pantalla: el logo se mostraba sólo si el
 * barrio había cargado el suyo, y si no, quedaba el nombre en texto pelado. En el censo eso es
 * caro — es la única vez que 300 personas miran la herramienta — así que la marca va siempre.
 *
 * Va en línea y no como <img> por dos razones medidas: el degradado tiene un `id` y dos marcas en
 * la misma página con el mismo `id` se pisan (de ahí el useId), y una imagen suelta parpadea
 * después del primer pintado en un celular con señal mala, que es exactamente el caso de uso.
 */
export function MarcaOmni({ size = 26, className }: { size?: number; className?: string }) {
    const g = `oaG-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
    return (
        <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="OmniAccess" className={className}>
            <defs>
                <linearGradient id={g} x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#0ea5e9" />
                    <stop offset=".55" stopColor="#3b82f6" />
                    <stop offset="1" stopColor="#22d3ee" />
                </linearGradient>
            </defs>
            {/* anillo exterior: cobertura 360 con el paso abierto a la derecha */}
            <path d="M51.7 16.6 A25 25 0 1 0 51.7 47.4" fill="none" stroke={`url(#${g})`} strokeWidth="5.4" strokeLinecap="round" />
            {/* anillo interior: diafragma */}
            <path d="M41 21.3 A14 14 0 1 0 41 42.7" fill="none" stroke={`url(#${g})`} strokeWidth="4.4" strokeLinecap="round" opacity=".78" />
            {/* paso autorizado */}
            <path d="M41.5 24 L49.8 32 L41.5 40" fill="none" stroke={`url(#${g})`} strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M53.4 27.2 L58.2 32 L53.4 36.8" fill="none" stroke={`url(#${g})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
        </svg>
    );
}

/** La bajada de la marca. Está acá y no escrita en cada pantalla porque ya apareció en tres. */
export const LEMA = "Ve. Verifica. Avisa.";

/** Quién lo hace. El censo lo mira gente que no sabe de dónde sale la herramienta. */
export const EMPRESA = "Ingeniería en Seguridad";
