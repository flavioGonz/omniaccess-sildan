"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Globe, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { estiloCasilla } from "@/components/monitor/camaras/piezas";
import type { Casilla } from "@/lib/monitor/disposiciones";
import { TEXTO_AVISO, type FuenteWeb } from "@/lib/monitor/fuentes-web";
import { cn } from "@/lib/utils";

/**
 * Una casilla de la pared con una página web en lugar de video (openspec pared-vms).
 *
 * La página va AISLADA: `sandbox` sin `allow-top-navigation` ni `allow-popups` (no puede llevarse
 * la pared a otro lado ni abrir ventanas) y sin referrer. `allow-same-origin` sí, porque sin él la
 * mayoría de los tableros no anda (cookies, almacenamiento); es seguro porque el origen es el del
 * sitio externo, no el de OmniAccess: la página no puede leer la sesión ni la pared.
 *
 * Fuera de lo que es una cámara: no se pone roja, no pasa adelante y no se toca para abrir la ficha.
 */
export function CasillaWeb({ casilla, fuente, clave, libre = false }: { casilla: Casilla; fuente: FuenteWeb | null; clave: string; libre?: boolean }) {
    const [vuelta, setVuelta] = useState(0);
    const [cargada, setCargada] = useState(false);
    /** Una página con aviso de que no se deja mostrar no se carga: el navegador pinta su error gris. Se puede probar igual. */
    const [probar, setProbar] = useState(false);
    // La recarga: cambiar la llave del iframe la vuelve a pedir sin tocar el resto de la pared.
    useEffect(() => {
        if (!fuente?.recargaMin) return;
        const t = setInterval(() => { setCargada(false); setVuelta((v) => v + 1); }, fuente.recargaMin * 60_000);
        return () => clearInterval(t);
    }, [fuente?.recargaMin, fuente?.url]);
    useEffect(() => { setCargada(false); }, [fuente?.url]);

    const estilo = libre ? undefined : estiloCasilla(casilla);
    if (!fuente) {
        return (
            <div style={estilo} className="relative min-h-0 rounded-[10px] bg-muted/60 ring-1 ring-border grid place-items-center text-center text-[12px] text-muted-foreground/80 px-3">
                <span className="flex flex-col items-center gap-1.5"><Globe size={18} className="opacity-60" />Página web que ya no existe<span className="text-[10.5px] opacity-60">{clave}</span></span>
            </div>
        );
    }
    const zoom = (fuente.zoom || 100) / 100;
    const host = (() => { try { return new URL(fuente.url).host; } catch { return fuente.url; } })();
    const bloqueada = fuente.avisos?.includes("no-enmarcable") || fuente.avisos?.includes("http-en-https");
    if (bloqueada && !probar) {
        const aviso = fuente.avisos!.includes("no-enmarcable") ? "no-enmarcable" : "http-en-https";
        return (
            <div style={estilo} className="relative min-h-0 rounded-[10px] overflow-hidden ring-1 ring-white/10 bg-[radial-gradient(120%_90%_at_15%_0%,color-mix(in_oklab,var(--aviso)_16%,transparent),transparent_60%),#0b0e14] grid place-items-center px-6 text-center">
                <span className="flex flex-col items-center gap-2 max-w-[360px]">
                    <span className="grid place-items-center h-11 w-11 rounded-[12px] bg-white/[.07] text-[var(--aviso-texto)]"><TriangleAlert size={20} /></span>
                    <span className="text-[14px] font-bold text-white">{fuente.nombre}</span>
                    <span className="text-[12px] text-white/60 leading-snug">{TEXTO_AVISO[aviso].split(":")[0]}.</span>
                    <span className="mt-1 flex items-center gap-1.5">
                        <a href={fuente.url} target="_blank" rel="noreferrer noopener" className="h-8 px-3 rounded-full bg-white/10 border border-white/10 text-white text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-white/15"><ExternalLink size={13} /> Abrir en una pestaña</a>
                        <button type="button" onClick={() => setProbar(true)} className="h-8 px-3 rounded-full text-white/70 text-[12px] font-semibold hover:text-white">Probar igual</button>
                    </span>
                </span>
            </div>
        );
    }
    return (
        <motion.div layout="position" style={estilo} className="group relative min-h-0 rounded-[10px] overflow-hidden bg-[#0b0e14] ring-1 ring-white/10">
            {/* El zoom: el marco se dibuja más grande (o más chico) y se escala para ocupar la casilla. */}
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}>
                <iframe key={`${fuente.url}#${vuelta}`} src={fuente.url} title={fuente.nombre} loading="lazy" referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-same-origin allow-forms" onLoad={() => setCargada(true)}
                    className={cn("w-full h-full border-0 bg-white transition-opacity duration-500", cargada ? "opacity-100" : "opacity-0")} />
            </div>
            <AnimatePresence>
                {!cargada && (
                    <motion.div key="cargando" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center">
                        <span className="flex flex-col items-center gap-2 text-white/60 text-[12.5px]">
                            <Loader2 size={20} className="animate-spin" />
                            <span className="font-semibold text-white/80">{fuente.nombre}</span>
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* El rótulo, como el de un canal; los controles aparecen al pasar. */}
            <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 max-w-[calc(100%-80px)]">
                <span className="pointer-events-auto h-6 pl-1.5 pr-2 rounded-full bg-black/65 backdrop-blur-md border border-white/10 text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5 min-w-0" title={host}>
                    <Globe size={12} className="text-[var(--accion-en-oscuro)] shrink-0" /><span className="truncate">{fuente.nombre}</span>
                </span>
            </div>
            <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => { setCargada(false); setVuelta((v) => v + 1); }} title="Volver a cargar la página" aria-label="Volver a cargar"
                    className="h-7 w-7 grid place-items-center rounded-full bg-black/65 backdrop-blur-md border border-white/10 text-white/85 hover:text-white"><RefreshCw size={13} /></button>
                <a href={fuente.url} target="_blank" rel="noreferrer noopener" title="Abrir en una pestaña" aria-label="Abrir en una pestaña"
                    className="h-7 w-7 grid place-items-center rounded-full bg-black/65 backdrop-blur-md border border-white/10 text-white/85 hover:text-white"><ExternalLink size={13} /></a>
            </div>
        </motion.div>
    );
}
