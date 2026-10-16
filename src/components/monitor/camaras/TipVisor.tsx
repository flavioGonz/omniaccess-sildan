"use client";

import { Tooltip as RTooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";

/**
 * La ayuda de los íconos del visor (cámara abierta, grabación, regla), con react-tooltip
 * (16/10, Nico: «tienen tooltip, pero quiero react-tooltip más estilizado»).
 *
 * Antes era el `title` del navegador: aparece tarde, con la letra del sistema operativo, y un
 * atajo escrito como «Volver al vivo  ( Esc )» quedaba pegado al texto. Acá la frase va en la
 * letra de la app sobre vidrio oscuro, y el atajo en una tecla aparte.
 *
 * Uso: `{...tip("Volver al vivo  ( Esc )")}` en el botón (pone también aria-label) y un
 * `<TipVisor />` una vez en la pantalla. Las marcas de la regla (Scrub) usan el id «mi-tip»:
 * también se atienden acá.
 */
export const TIP_VISOR = "visor-tip";
const ATAJO = /\s+\(\s*([^()]+?)\s*\)\s*$/;

export function tip(titulo: string) {
    const m = ATAJO.exec(titulo);
    const texto = m ? titulo.slice(0, m.index) : titulo;
    return { "data-tooltip-id": TIP_VISOR, "data-tooltip-content": texto, ...(m ? { "data-atajo": m[1] } : {}), "aria-label": texto };
}

const CLASES = "!z-[3200] !rounded-[10px] !bg-[rgba(12,12,14,0.92)] !backdrop-blur-xl !text-white !px-3 !py-2 !text-[12.5px] !font-semibold !leading-snug !max-w-[300px] !ring-1 !ring-white/10 !shadow-[0_10px_30px_rgba(0,0,0,0.55)] !opacity-100";

function Contenido({ content, activeAnchor }: { content: string | null; activeAnchor: HTMLElement | null }) {
    const atajo = activeAnchor?.getAttribute("data-atajo");
    return (
        <span className="flex items-center gap-2">
            <span>{content}</span>
            {atajo && atajo.split(/\s*·\s*|\s*,\s*/).map((k) => (
                <kbd key={k} className="inline-flex items-center h-5 min-w-5 px-1.5 rounded-[5px] bg-white/12 ring-1 ring-white/20 text-[11px] font-bold text-white/90 tabular-nums font-[inherit]">{k}</kbd>
            ))}
        </span>
    );
}

export function TipVisor() {
    return (
        <>
            <RTooltip id={TIP_VISOR} place="top" offset={12} delayShow={180} noArrow={false} className={CLASES}
                render={({ content, activeAnchor }) => <Contenido content={content} activeAnchor={activeAnchor} />} />
            <RTooltip id="mi-tip" place="top" offset={10} delayShow={120} className={CLASES} />
        </>
    );
}
