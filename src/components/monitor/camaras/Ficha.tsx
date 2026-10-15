"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, History, AppWindow, Maximize2, Minimize2, Camera, Radio, Spline, VideoOff, LogIn, LogOut } from "lucide-react";
import { metaDe } from "@/components/intrusion/comun";
import { horaCorta, hace } from "@/lib/monitor/cliente";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { SUAVE } from "@/components/monitor/tactil";
import { Vivo, Foto, Geometria, fotoDe, vivoDe, ubicacion, FOTO_MS, type Canal, type Alerta, type Lectura } from "./piezas";
import { cn } from "@/lib/utils";

/**
 * Un canal a pantalla completa, con los controles flotando encima como en el visor de eventos.
 *
 * Por qué así (pedido 15/10): la primera versión abría el canal dentro de una ventana con
 * barra de título y bordes, y el video quedaba chico en medio de la pantalla. Ahora el video
 * ocupa todo y los controles son íconos sobre la imagen que se esconden solos a los
 * OCULTAR_MS sin mover el mouse — vuelven al moverlo o al tocar.
 *
 * La pantalla completa es la del documento y no la de este elemento: la grabación (VerGrabacion)
 * se abre en <body>, y un elemento en pantalla completa sólo muestra lo que tiene adentro.
 */

/** Sin mover el mouse este tiempo, los controles se apagan. */
const OCULTAR_MS = 3500;
/** Sin tocar nada este tiempo, la ficha se cierra: una pared no puede quedar trabada en un canal. */
const CIERRA_SOLA_MS = 3 * 60_000;
/** Cuánto antes de "ahora" arranca la grabación si no hay detección de referencia. */
const GRABACION_ANTES_MS = 60_000;

function Icono({ children, onClick, titulo, activo, href }: { children: React.ReactNode; onClick?: () => void; titulo: string; activo?: boolean; href?: string }) {
    const cls = cn("w-11 h-11 rounded-full grid place-items-center transition-colors", activo ? "bg-white text-black" : "text-white/85 hover:text-white hover:bg-white/15");
    if (href) return <a href={href} target="_blank" rel="noreferrer" title={titulo} aria-label={titulo} className={cls}>{children}</a>;
    return <button type="button" onClick={onClick} title={titulo} aria-label={titulo} aria-pressed={activo} className={cls}>{children}</button>;
}

function ChapaChica({ l }: { l: Lectura }) {
    const ok = l.decision === "GRANT" && !l.listaNegra;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 visor-panel text-white")}>
            <span className={cn("h-2 w-2 rounded-full", ok ? "bg-[var(--bien)]" : "bg-[var(--mal)]")} />
            {l.sentido === "EXIT" ? <LogOut size={13} className="text-white/60" /> : <LogIn size={13} className="text-white/60" />}
            <span className="text-[15px] font-bold tabular-nums tracking-wide">{l.plate || "SIN LEER"}</span>
            <span className="text-[12px] text-white/60 tabular-nums">{horaCorta(l.ts)}</span>
        </span>
    );
}

export function FichaCanal({ c, h265, alerta, lecturas, alCerrar, alMover, alVentana }: {
    c: Canal | null; h265: boolean; alerta: Alerta | null; lecturas: Lectura[];
    alCerrar: () => void;
    /** Al canal anterior o siguiente de la pared (null si no hay). */
    alMover?: ((paso: 1 | -1) => void) | null;
    /** Abrir este canal solo en otra ventana (para otro monitor). */
    alVentana?: () => void;
}) {
    const [grabacion, setGrabacion] = useState(false);
    const [fallo, setFallo] = useState(false);
    const [hd, setHd] = useState(true);
    const [verGeom, setVerGeom] = useState(true);
    const [visibles, setVisibles] = useState(true);
    const [lleno, setLleno] = useState(false);
    const entreYo = useRef(false);
    useEffect(() => { setGrabacion(false); setFallo(false); }, [c?.clave]);
    const grabacionRef = useRef(grabacion); grabacionRef.current = grabacion;
    const alCerrarRef = useRef(alCerrar); alCerrarRef.current = alCerrar;

    // Controles que se apagan solos, y la ficha que se cierra sola.
    useEffect(() => {
        if (!c) return;
        let apagar = setTimeout(() => setVisibles(false), OCULTAR_MS);
        let cerrar = setTimeout(() => { if (!grabacionRef.current) alCerrarRef.current(); }, CIERRA_SOLA_MS);
        const mover = () => {
            setVisibles(true); clearTimeout(apagar); clearTimeout(cerrar);
            apagar = setTimeout(() => setVisibles(false), OCULTAR_MS);
            cerrar = setTimeout(() => { if (!grabacionRef.current) alCerrarRef.current(); }, CIERRA_SOLA_MS);
        };
        window.addEventListener("pointermove", mover); window.addEventListener("pointerdown", mover); window.addEventListener("keydown", mover);
        return () => { clearTimeout(apagar); clearTimeout(cerrar); window.removeEventListener("pointermove", mover); window.removeEventListener("pointerdown", mover); window.removeEventListener("keydown", mover); };
    }, [c?.clave]); // eslint-disable-line react-hooks/exhaustive-deps
    // (por clave y no por objeto: la lista se vuelve a pedir cada 30 s y el cierre solo se reiniciaba)

    // Pantalla completa al abrir (viene de un toque, así que el navegador la permite) y se
    // devuelve al cerrar sólo si la pidió esta ficha: si la pared ya estaba en completa, queda.
    useEffect(() => {
        if (!c) return;
        const cambio = () => setLleno(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", cambio); cambio();
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => { entreYo.current = true; }).catch(() => { });
        return () => {
            document.removeEventListener("fullscreenchange", cambio);
            if (entreYo.current && document.fullscreenElement) document.exitFullscreen().catch(() => { });
            entreYo.current = false;
        };
    }, [!!c]); // eslint-disable-line react-hooks/exhaustive-deps

    const teclas = useCallback((e: KeyboardEvent) => {
        if (grabacionRef.current) return;
        if (e.key === "Escape") { e.preventDefault(); alCerrar(); }
        else if (e.key === "ArrowRight" && alMover) alMover(1);
        else if (e.key === "ArrowLeft" && alMover) alMover(-1);
    }, [alCerrar, alMover]);
    useEffect(() => { if (!c) return; window.addEventListener("keydown", teclas); return () => window.removeEventListener("keydown", teclas); }, [!!c, teclas]); // eslint-disable-line react-hooks/exhaustive-deps

    // HD convertido es varias veces más caro que el subflujo: sin H.265 se ve el subflujo convertido.
    const enHd = h265 && hd && !fallo;
    const m = alerta ? metaDe(alerta.tipo) : null;
    const ult = c?.ultima ? metaDe(c.ultima.tipo) : null;
    const foto = c ? fotoDe(c, 1280) : null;
    const calidad = c?.online === false ? "sin señal en el NVR" : enHd ? "alta calidad, directo" : h265 ? "subflujo, directo" : fallo ? "subflujo convertido (la alta calidad no abrió)" : "subflujo convertido (este equipo no reproduce H.265 en alta)";
    const alternarLleno = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else document.documentElement.requestFullscreen?.().then(() => { entreYo.current = true; }).catch(() => { }); };

    return (
        <AnimatePresence>
            {c && (
                <motion.div key="ficha" role="dialog" aria-label={c.nombre} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                    className={cn("fixed inset-0 z-[2900] bg-black", !visibles && "cursor-none")}>
                    {c.online === false ? (
                        <>
                            {foto && <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-contain opacity-60" />}
                            <span className="absolute inset-0 grid place-items-center text-white/60"><span className="flex flex-col items-center gap-2"><VideoOff size={40} /><span className="text-[18px] font-semibold">El NVR no ve este canal</span></span></span>
                        </>
                    ) : (
                        <Vivo key={`${c.clave}-${enHd ? "hd" : "sd"}`} src={enHd ? vivoDe(`${c.stream}_hd`, false) : vivoDe(c.stream, !h265)}
                            alResultado={(ok) => { if (!ok && enHd) setFallo(true); }} className="absolute inset-0 w-full h-full object-contain" />
                    )}
                    {c.geom && verGeom && <Geometria geom={c.geom} alerta={!!alerta} ajuste="contain" />}

                    {/* Arriba a la izquierda: qué se mira. Texto sobre la imagen, sin caja. */}
                    <div className={cn("absolute top-0 inset-x-0 p-5 md:px-7 flex items-start justify-between gap-4 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300", !visibles && "opacity-0 pointer-events-none")}>
                        <div className="min-w-0 visor-sombra-texto">
                            <h1 className="text-[24px] font-bold tracking-[-0.015em] text-white leading-tight truncate max-w-[50vw]">{c.nombre}</h1>
                            <p className="flex items-center gap-2 mt-1 text-[14px] text-white/75 tabular-nums">
                                <Radio size={14} className="text-[var(--mal)] animate-pulse shrink-0" />
                                <span className="font-semibold text-white/90">{ubicacion(c)}</span>
                                <span className="text-white/30">·</span><span>{calidad}</span>
                            </p>
                            {alerta && m && (
                                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-bold pleno-mal"><m.Icon size={15} /> {m.label} · {horaCorta(alerta.ts)} · {hace(alerta.ts)}</span>
                            )}
                            {!alerta && c.ultima && ult && (
                                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold visor-panel text-white/85"><ult.Icon size={14} /> Última: {ult.label} · {hace(c.ultima.ts)}</span>
                            )}
                        </div>
                        {/* Arriba a la derecha: las acciones, en íconos, en una sola cápsula. */}
                        <div className="flex items-center gap-2 shrink-0">
                            {alMover && (
                                <span className="visor-panel rounded-full p-1 flex items-center gap-0.5">
                                    <Icono onClick={() => alMover(-1)} titulo="Canal anterior  ( ← )"><ChevronLeft size={20} /></Icono>
                                    <Icono onClick={() => alMover(1)} titulo="Canal siguiente  ( → )"><ChevronRight size={20} /></Icono>
                                </span>
                            )}
                            <span className="visor-panel rounded-full p-1 flex items-center gap-0.5">
                                {h265 && c.online !== false && (
                                    <Icono onClick={() => { setHd((x) => !x); setFallo(false); }} activo={enHd} titulo={enHd ? "Alta calidad · cambiar al subflujo, más liviano" : "Subflujo · cambiar a alta calidad"}>
                                        <span className="text-[11px] font-bold tracking-wide">{enHd ? "HD" : "SD"}</span>
                                    </Icono>
                                )}
                                {c.geom && <Icono onClick={() => setVerGeom((x) => !x)} activo={verGeom} titulo={verGeom ? "Ocultar la línea y la zona" : "Mostrar la línea y la zona de la cámara"}><Spline size={18} /></Icono>}
                                {(c.equipoId || (c.nvrId && c.ch != null)) && <Icono onClick={() => setGrabacion(true)} titulo="Ver la grabación"><History size={18} /></Icono>}
                                {foto && <Icono href={foto.replace(/[?&]w=\d+/, "")} titulo="Abrir la foto de ahora en una pestaña"><Camera size={18} /></Icono>}
                                {alVentana && <Icono onClick={alVentana} titulo="Abrir este canal solo en otra ventana (para otro monitor)"><AppWindow size={18} /></Icono>}
                                <Icono onClick={alternarLleno} titulo={lleno ? "Salir de pantalla completa" : "Pantalla completa"}>{lleno ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</Icono>
                                <span className="w-px h-5 bg-white/15 mx-0.5" />
                                <Icono onClick={alCerrar} titulo="Volver a la pared  ( Esc )"><X size={20} /></Icono>
                            </span>
                        </div>
                    </div>

                    {/* Abajo: las últimas chapas, si la cámara lee. */}
                    {lecturas.length > 0 && (
                        <div className={cn("absolute bottom-0 inset-x-0 p-5 md:px-7 flex items-center gap-2 flex-wrap bg-gradient-to-t from-black/70 to-transparent transition-opacity duration-300", !visibles && "opacity-0")}>
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/60 mr-1">Últimas lecturas</span>
                            {lecturas.slice(0, 6).map((l) => <ChapaChica key={l.id} l={l} />)}
                        </div>
                    )}

                    {grabacion && (
                        <VerGrabacion deviceId={c.equipoId || `nvrch-${c.nvrId}-${c.ch}`} nombre={c.nombre} canal={c.ch} nvrId={c.nvrId}
                            instanteMs={alerta ? +new Date(alerta.ts) : Date.now() - GRABACION_ANTES_MS} onClose={() => setGrabacion(false)} />
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
