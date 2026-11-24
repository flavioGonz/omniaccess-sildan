import { ESQUINAS, VIOLETA_OMNIVISION } from "@/components/brand/OmniLogo";
import { cn } from "@/lib/utils";

/**
 * El loader de OmniAccess: el isotipo animado (24/11, Nico: «tenemos que crear un loader de
 * OmniAccess con el logo, animado, para todos los procesos de loading y de carga de toda la app»).
 *
 * Qué cuenta la animación, porque no es decoración: el isotipo ES un recuadro de detección
 * encuadrando una lente. Cargando, la lente gira buscando, el recuadro se cierra sobre ella como
 * cuando OmniVision engancha algo, y el punto de OmniVision late en el momento del enganche. Es lo
 * que el producto hace todo el día, en un segundo y medio.
 *
 * Tres piezas, un solo dibujo:
 *   · `IsotipoAnimado`: el isotipo entero, para cargas de bloque y de pantalla.
 *   · `Girando`: lo que había con `Loader2` de lucide, con sus mismas props. Chico (botones, al
 *     lado de un texto) es sólo la lente girando con el punto: a 14 px las esquinas se vuelven
 *     ruido. Desde 24 px es el isotipo entero. Las 213 pantallas que usaban `Loader2` lo importan
 *     con ese nombre (`import { Girando as Loader2 }`), así que ninguna cambió de forma: cambió el
 *     dibujo. Ignora `animate-spin`, que haría girar las esquinas: gira sólo lo que tiene que girar.
 *   · `PantallaDeCarga`: el isotipo con la marca debajo, a pantalla completa o en el área de
 *     contenido mientras cambia la ruta (app/loading.tsx, app/admin/loading.tsx).
 *
 * Las esquinas y la lente van con `currentColor`, como el isotipo quieto: heredan el color del texto
 * donde se ponen. El punto es el violeta de OmniVision, lo único de color propio de la marca.
 *
 * Con «reducir movimiento» nada gira ni se mueve: el isotipo queda quieto y sólo el punto respira,
 * que alcanza para decir «está trabajando» (globals.css, `oa-carga`).
 *
 * Las cargas de bloque y de pantalla aparecen con una demora corta (`oa-carga-asoma`): lo que tarda
 * menos que eso no dibuja nada, en vez de un destello del logo que se va antes de poder verlo.
 */

/** Largo de la lente (r = 14): con él se arma el arco que gira. */
const LENTE = 2 * Math.PI * 14;

export function IsotipoAnimado({ size = 44, className, titulo = "Cargando" }: { size?: number; className?: string; titulo?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label={titulo} className={cn("oa-carga shrink-0", className)}>
            {/* El recuadro de detección, cerrándose sobre la lente. */}
            <path d={ESQUINAS} stroke="currentColor" strokeWidth="5" strokeLinecap="round" className="oa-carga-encuadre" />
            {/* La lente: un rastro tenue siempre, y el arco que gira buscando. */}
            <circle cx="32" cy="32" r="14" stroke="currentColor" strokeWidth="5" opacity="0.18" />
            <circle cx="32" cy="32" r="14" stroke="currentColor" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${LENTE * 0.62} ${LENTE * 0.38}`} className="oa-carga-lente" />
            {/* OmniVision: late cuando el recuadro engancha. */}
            <circle cx="32" cy="32" r="5.5" fill={VIOLETA_OMNIVISION} className="oa-carga-punto" />
        </svg>
    );
}

/** La lente sola, girando, con el punto: el loader chico. */
function LenteGirando({ size, className, strokeWidth }: { size: number; className?: string; strokeWidth?: number | string }) {
    const r = 8.5;
    const largo = 2 * Math.PI * r;
    const grosor = Math.max(2.4, Number(strokeWidth) || 3);
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label="Cargando" className={cn("oa-carga shrink-0", className)}>
            <circle cx="12" cy="12" r={r} stroke="currentColor" strokeWidth={grosor} opacity="0.2" />
            <circle cx="12" cy="12" r={r} stroke="currentColor" strokeWidth={grosor} strokeLinecap="round"
                strokeDasharray={`${largo * 0.3} ${largo * 0.7}`} className="oa-carga-gira" />
            <circle cx="12" cy="12" r="2.9" fill={VIOLETA_OMNIVISION} className="oa-carga-punto" />
        </svg>
    );
}

/** Desde este tamaño el loader es el isotipo entero; debajo, la lente sola. */
const ISOTIPO_DESDE = 24;

/**
 * El reemplazo de `Loader2`: mismas props (`size`, `className`, `strokeWidth`), el dibujo de la
 * marca. Ver arriba por qué saca `animate-spin`.
 */
export function Girando({ size = 24, className, strokeWidth }: { size?: number | string; className?: string; strokeWidth?: number | string; [x: string]: unknown }) {
    const lado = Number(size) || 24;
    const clase = (className || "").split(/\s+/).filter((c) => c && c !== "animate-spin").join(" ");
    return lado >= ISOTIPO_DESDE ? <IsotipoAnimado size={lado} className={clase} /> : <LenteGirando size={lado} className={clase} strokeWidth={strokeWidth} />;
}

/**
 * El isotipo con la marca debajo. `pantalla` ocupa toda la ventana (arranque de la aplicación,
 * pantallas sueltas); sin `pantalla` llena el lugar que le dan (el área de contenido del panel
 * mientras cambia la ruta).
 */
export function PantallaDeCarga({ texto, pantalla = false, className }: { texto?: string; pantalla?: boolean; className?: string }) {
    return (
        <div role="status" aria-live="polite"
            className={cn("oa-carga-asoma flex flex-col items-center justify-center gap-4 text-foreground", pantalla ? "fixed inset-0 z-[60] bg-background" : "h-full min-h-[320px] w-full", className)}>
            <IsotipoAnimado size={pantalla ? 64 : 52} />
            <div className="flex flex-col items-center gap-1.5">
                <span className="text-[12px] font-bold tracking-[0.32em] pl-[0.32em]">OMNIACCESS</span>
                {texto && <span className="text-[12px] text-muted-foreground">{texto}</span>}
            </div>
        </div>
    );
}
