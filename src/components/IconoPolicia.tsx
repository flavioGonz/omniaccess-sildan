import { forwardRef } from "react";

/**
 * La placa: «esto lo dice la policía».
 *
 * Por qué no un ícono de la librería (13/11, Nico: «ícono de policía, genera más impacto»): lucide
 * no tiene ninguno; tiene escudos, que en este sistema ya significan «lista negra» o «seguridad» en
 * general, y la sirena, que es «alarma». Una matrícula requerida no es ninguna de las dos cosas: es
 * un pedido de la policía, confirmado. La placa (escudo con estrella) lo dice sin leer nada.
 *
 * Acepta lo mismo que un ícono de lucide (`size`, `color`, `strokeWidth`, y `x`/`y`/`width`/`height`
 * para ir dentro de otro SVG, como en CapaAnalisis), así se usa en los mismos lugares.
 */
export const IconoPolicia = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement> & { size?: number | string }>(function IconoPolicia(
    { size = 24, color = "currentColor", strokeWidth = 2, width, height, ...resto }, ref,
) {
    return (
        <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={width ?? size} height={height ?? size} viewBox="0 0 24 24" fill="none"
            stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...resto}>
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            <path d="M12 7.8 13.06 10.54 15.99 10.7 13.71 12.56 14.47 15.4 12 13.8 9.53 15.4 10.29 12.56 8.01 10.7 10.94 10.54Z" fill={color} strokeWidth={0.6} />
        </svg>
    );
});
