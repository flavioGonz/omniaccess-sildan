"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, History, AppWindow, Maximize2, Minimize2, Camera, Radio, Spline, VideoOff, LogIn, LogOut, Sparkles, Crosshair, ScanEye, Joystick, ScanSearch } from "lucide-react";
import { JoystickPtz } from "./Joystick";
import { metaDe } from "@/components/intrusion/comun";
import { horaCorta, hace } from "@/lib/monitor/cliente";
import { Grabacion } from "./Grabacion";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { SUAVE } from "@/components/monitor/tactil";
import { PasoVisionCanal, type PasoVision } from "./PasoVision";
import { TipVisor, tip } from "./TipVisor";
import { Vivo, Foto, Geometria, fotoDe, vivoDe, ubicacion, idCanal, FOTO_MS, useSiluetasEnVivo, type Canal, type Alerta, type Lectura } from "./piezas";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { SeguimientoVisual } from "./Seguimiento";
import type { TrackLink } from "@/app/actions/detections";
import { geomDeIntrusion } from "@/lib/vision-capa";
import { cn } from "@/lib/utils";

/**
 * Un canal a pantalla completa, con los controles flotando encima como en el visor de eventos.
 *
 * Por qué así (pedido 15/10): la primera versión abría el canal dentro de una ventana con
 * barra de título y bordes, y el video quedaba chico en medio de la pantalla. Ahora el video
 * ocupa todo y los controles son íconos sobre la imagen que se esconden solos a los
 * OCULTAR_MS sin mover el mouse — vuelven al moverlo o al tocar.
 *
 * La grabación se ve en este mismo cuadro (Grabacion), con la regla encima: no abre otra ventana.
 * La pantalla completa es la del documento y no la de este elemento, para que los menús que
 * se montan en <body> se sigan viendo.
 */

/** Sin mover el mouse este tiempo, los controles se apagan. */
const OCULTAR_MS = 3500;
/** Sin tocar nada este tiempo, la ficha se cierra: una pared no puede quedar trabada en un canal. */
const CIERRA_SOLA_MS = 3 * 60_000;
/** Cuánto antes de "ahora" arranca la grabación si no hay detección de referencia. */
const GRABACION_ANTES_MS = 60_000;
/** Con una detección en curso, la grabación arranca un poco antes de ella: se ve llegar al que la causó. */
const GRABACION_ANTES_ALERTA_MS = 5_000;

function Icono({ children, onClick, titulo, activo, href }: { children: React.ReactNode; onClick?: () => void; titulo: string; activo?: boolean; href?: string }) {
    const cls = cn("w-11 h-11 rounded-full grid place-items-center transition-colors", activo ? "bg-white text-black" : "text-white/85 hover:text-white hover:bg-white/15");
    if (href) return <a href={href} target="_blank" rel="noreferrer" {...tip(titulo)} className={cls}>{children}</a>;
    return <button type="button" onClick={onClick} {...tip(titulo)} aria-pressed={activo} className={cls}>{children}</button>;
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

export function FichaCanal({ c, h265, hls = false, alerta, lecturas, alCerrar, alMover, alVentana, grabacionInicial = null, canales = [], seguimiento = {}, puedeEditar = false, alertaDe, alSeguir, origen, alVolverOrigen, alSoltarOrigen, alVision, pasoVision = null, alCerrarPaso, alGuardarSeguimiento, alBuscar }: {
    c: Canal | null; h265: boolean; hls?: boolean; alerta: Alerta | null; lecturas: Lectura[];
    /** Todas las cámaras de la pared y los enlaces del seguimiento visual (por idCanal). */
    canales?: Canal[]; seguimiento?: Record<string, TrackLink[]>; puedeEditar?: boolean;
    /** Se guardaron enlaces desde la ficha: la pared los muestra sin esperar la próxima recarga. */
    alGuardarSeguimiento?: (idCanal: string, links: TrackLink[]) => void;
    alertaDe?: (c: Canal) => Alerta | null;
    /** Pasar a la cámara vecina por un enlace del seguimiento; `origen` es de dónde se vino. */
    alSeguir?: (destino: Canal) => void; origen?: Canal | null; alVolverOrigen?: () => void; alSoltarOrigen?: () => void;
    /** Mandar esta cámara a OmniVision o retirarla (sólo con permiso de Ajustes). */
    alVision?: () => void;
    /** Entrando o saliendo de OmniVision: se cuenta sobre el cuadro (ver PasoVision). */
    pasoVision?: PasoVision | null; alCerrarPaso?: () => void;
    /** Abrir directo en la grabación, desde este instante (el control de la baldosa). null = en vivo. */
    grabacionInicial?: number | null;
    alCerrar: () => void;
    /** Al canal anterior o siguiente de la pared (null si no hay). */
    alMover?: ((paso: 1 | -1) => void) | null;
    /** Abrir este canal solo en otra ventana (para otro monitor). */
    alVentana?: () => void;
    /** «Buscar parecidos» desde este canal: congela su cuadro y busca (openspec pared-vms). */
    alBuscar?: () => void;
}) {
    // La grabación se ve en el mismo cuadro (Grabacion): `desde` es dónde arranca; null = en vivo.
    const [grabacion, setGrabacionDesde] = useState<number | null>(null);
    const { pantalla } = useMarco();
    const [fallo, setFallo] = useState(false);
    const [hd, setHd] = useState(true);
    const [verGeom, setVerGeom] = useState(true);
    // Siluetas de OmniVision sobre el vivo (pedido 15/10: «pretendo que sea la silueta»). Prendidas
    // al abrir; sólo mientras se mira el vivo de ESTE canal (la GPU no trabaja para nadie más).
    const [verSiluetas, setVerSiluetas] = useState(true);
    /**
     * El tamaño del video que se ve. Las siluetas salen del subflujo y vienen en 0–1 de su cuadro;
     * se dibujan con el tamaño del video EN PANTALLA, porque el HD puede tener otra proporción que
     * el subflujo (medido el 15/10: el subflujo de LPR Entrada es 704×576, 4:3, y su HD es 16:9).
     * Los dos ven lo mismo; cambia cómo está estirado.
     */
    const [tamVideo, setTamVideo] = useState<{ w: number; h: number } | null>(null);
    // Dónde cae el cuadro del video en la pantalla («contain»): ahí se ubican los enlaces.
    const [pantallaTam, setPantallaTam] = useState(() => (typeof window === "undefined" ? { w: 1920, h: 1080 } : { w: window.innerWidth, h: window.innerHeight }));
    useEffect(() => { const r = () => setPantallaTam({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
    const cuadro = useMemo(() => {
        if (!tamVideo) return null;
        const k = Math.min(pantallaTam.w / tamVideo.w, pantallaTam.h / tamVideo.h);
        const width = tamVideo.w * k, height = tamVideo.h * k;
        return { left: (pantallaTam.w - width) / 2, top: (pantallaTam.h - height) / 2, width, height };
    }, [tamVideo, pantallaTam]);
    const [editandoSeguimiento, setEditandoSeguimiento] = useState(false);
    useEffect(() => { setEditandoSeguimiento(false); }, [c?.clave]);
    // PTZ: se le pregunta al equipo si la cámara se mueve (el servidor lo recuerda media hora); el
    // ícono del joystick aparece sólo si es así.
    const [ptz, setPtz] = useState(false);
    const [verPtz, setVerPtz] = useState(false);
    const idPtz = c ? idCanal(c) : null;
    useEffect(() => {
        setPtz(false); setVerPtz(false);
        if (!idPtz || pantalla) return;
        let vivo = true;
        fetch(`/api/devices/ptz?deviceId=${encodeURIComponent(idPtz)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo) setPtz(!!j?.ptz); }).catch(() => { });
        return () => { vivo = false; };
    }, [idPtz, pantalla]);
    const [visibles, setVisibles] = useState(true);
    const [lleno, setLleno] = useState(false);
    const entreYo = useRef(false);
    useEffect(() => { setGrabacionDesde(grabacionInicial); setFallo(false); }, [c?.clave]); // eslint-disable-line react-hooks/exhaustive-deps
    const grabacionRef = useRef(grabacion != null); grabacionRef.current = grabacion != null;
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
        // En la grabación, Esc vuelve al vivo; las flechas son de la regla (Grabacion).
        if (grabacionRef.current) { if (e.key === "Escape") { e.preventDefault(); setGrabacionDesde(null); } return; }
        if (e.key === "Escape") { e.preventDefault(); alCerrar(); }
        else if (e.key === "ArrowRight" && alMover) alMover(1);
        else if (e.key === "ArrowLeft" && alMover) alMover(-1);
    }, [alCerrar, alMover]);
    useEffect(() => { if (!c) return; window.addEventListener("keydown", teclas); return () => window.removeEventListener("keydown", teclas); }, [!!c, teclas]); // eslint-disable-line react-hooks/exhaustive-deps

    const sil = useSiluetasEnVivo(c && c.online !== false ? c.stream : null, !!c && verSiluetas && grabacion == null);
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
                    {grabacion != null ? (
                        <Grabacion c={c} h265={h265} hls={hls} desdeMs={grabacion} visibles={visibles} alVivo={() => setGrabacionDesde(null)}
                            deviceIdEnvio={!pantalla && c.equipoId ? c.equipoId : undefined} />
                    ) : c.online === false ? (
                        <>
                            {foto && <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-contain opacity-60" />}
                            <span className="absolute inset-0 grid place-items-center text-white/60"><span className="flex flex-col items-center gap-2"><VideoOff size={40} /><span className="text-[18px] font-semibold">El NVR no ve este canal</span></span></span>
                        </>
                    ) : (
                        <Vivo key={`${c.clave}-${enHd ? "hd" : "sd"}`} src={enHd ? vivoDe(`${c.stream}_hd`, false, hls) : vivoDe(c.stream, !h265, hls)}
                            alResultado={(ok) => { if (!ok && enHd) setFallo(true); }} alMedir={(w, h) => setTamVideo({ w, h })} className="absolute inset-0 w-full h-full object-contain" />
                    )}
                    {c.geom && verGeom && !(sil.analisis && grabacion == null) && <Geometria geom={c.geom} alerta={!!alerta} ajuste="contain" />}
                    {/* Las siluetas van sobre el vivo con el mismo ajuste (contain): el análisis es del
                        subflujo 16:9, igual que el video. Si dejan de llegar cuadros, se borran solas. */}
                    {grabacion == null && sil.analisis && (
                        <CapaAnalisis analisis={tamVideo ? { ...sil.analisis, ancho: tamVideo.w, alto: tamVideo.h } : sil.analisis} geom={verGeom ? geomDeIntrusion(c.geom) : null} ajuste="contain" className="pointer-events-none" />
                    )}

                    {grabacion == null && <PasoVisionCanal paso={pasoVision} nombre={c.nombre} foto={foto} grande alCerrar={alCerrarPaso} capa="z-0" />}

                    {/* Arriba a la izquierda: qué se mira. Texto sobre la imagen, sin caja. */}
                    <div className={cn("absolute top-0 inset-x-0 p-3 sm:p-5 md:px-7 flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300", !visibles && "opacity-0 pointer-events-none")}>
                        <div className="min-w-0 visor-sombra-texto">
                            <h1 className="text-[18px] sm:text-[24px] font-bold tracking-[-0.015em] text-white leading-tight truncate max-w-[80vw] lg:max-w-[calc(50vw-330px)]">{c.nombre}</h1>
                            <p className="flex items-center gap-2 mt-1 text-[14px] text-white/75 tabular-nums">
                                {grabacion != null ? <History size={14} className="text-[var(--accion-en-oscuro)] shrink-0" /> : <Radio size={14} className="text-[var(--mal)] animate-pulse shrink-0" />}
                                <span className="font-semibold text-white/90">{ubicacion(c)}</span>
                                <span className="text-white/30">·</span><span>{grabacion != null ? "grabación" : calidad}</span>
                                {grabacion == null && verSiluetas && sil.estado !== "apagado" && (<>
                                    <span className="text-white/30">·</span>
                                    <span className={cn(sil.estado === "ocupado" || sil.estado === "error" ? "text-[var(--aviso-texto)]" : "")}>
                                        {sil.estado === "vivo" ? "siluetas en vivo" : sil.estado === "conectando" ? "buscando siluetas…" : sil.estado === "ocupado" ? "siluetas ocupadas (2 canales a la vez)" : "siluetas sin respuesta"}
                                    </span>
                                </>)}
                            </p>
                            {alerta && m && (
                                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-bold pleno-mal"><m.Icon size={15} /> {m.label} · {horaCorta(alerta.ts)} · {hace(alerta.ts)}</span>
                            )}
                            {!alerta && c.ultima && ult && (
                                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold visor-panel text-white/85"><ult.Icon size={14} /> Última: {ult.label} · {hace(c.ultima.ts)}</span>
                            )}
                        </div>
                    </div>

                    {/*
                     * Las acciones, en íconos, arriba al centro (16/10, Nico). Arriba a la derecha
                     * competían con la hora que sobreimprime la cámara; abajo chocaban con la regla de
                     * la grabación y las últimas lecturas. En pantallas angostas van debajo del nombre.
                     */}
                    <div className={cn("absolute inset-x-0 z-10 flex justify-center px-3 pointer-events-none transition-opacity duration-300 top-[84px] sm:top-[92px] lg:top-5",
                        !visibles && "opacity-0 [&_*]:pointer-events-none")}>
                        <div className="flex items-center gap-2 max-w-full overflow-x-auto pointer-events-auto">
                            {alMover && (
                                <span className="visor-panel rounded-full p-1 flex items-center gap-0.5">
                                    <Icono onClick={() => alMover(-1)} titulo="Canal anterior  ( ← )"><ChevronLeft size={20} /></Icono>
                                    <Icono onClick={() => alMover(1)} titulo="Canal siguiente  ( → )"><ChevronRight size={20} /></Icono>
                                </span>
                            )}
                            <span className="visor-panel rounded-full p-1 flex items-center gap-0.5">
                                {h265 && c.online !== false && grabacion == null && (
                                    <Icono onClick={() => { setHd((x) => !x); setFallo(false); }} activo={enHd} titulo={enHd ? "Alta calidad · cambiar al subflujo, más liviano" : "Subflujo · cambiar a alta calidad"}>
                                        <span className="text-[11px] font-bold tracking-wide">{enHd ? "HD" : "SD"}</span>
                                    </Icono>
                                )}
                                {grabacion == null && c.online !== false && (
                                    <Icono onClick={() => setVerSiluetas((x) => !x)} activo={verSiluetas}
                                        titulo={verSiluetas ? `Siluetas de OmniVision en vivo${sil.estado === "vivo" && sil.ms != null ? ` · ${sil.ms} ms por cuadro` : sil.estado === "ocupado" ? " · ocupado: ya hay dos canales con siluetas" : ""} · tocar para apagar` : "Mostrar las siluetas de OmniVision en vivo"}>
                                        <Sparkles size={18} />
                                    </Icono>
                                )}
                                {alBuscar && grabacion == null && c.online !== false && (
                                    <Icono onClick={alBuscar} titulo="Buscar parecidos: congelar este cuadro y buscar a esa persona, vehículo u objeto en lo que registraron las cámaras"><ScanSearch size={18} /></Icono>
                                )}
                                {alVision && (
                                    <Icono onClick={alVision} activo={!!c.vision?.analiza}
                                        titulo={c.vision?.analiza ? `OmniVision analiza esta cámara${c.vision.porSeg != null ? ` (${c.vision.porSeg.toLocaleString("es-UY", { maximumFractionDigits: 2 })} análisis/s)` : ""} · tocar para retirarla` : "Analizar con OmniVision: siluetas, búsqueda, reglas y verificación"}><ScanEye size={18} /></Icono>
                                )}
                                {grabacion == null && puedeEditar && (
                                    <Icono onClick={() => setEditandoSeguimiento((x) => !x)} activo={editandoSeguimiento}
                                        titulo={editandoSeguimiento ? "Terminar de editar el seguimiento visual" : "Editar el seguimiento visual (a qué cámaras se pasa desde esta)"}><Crosshair size={18} /></Icono>
                                )}
                                {ptz && grabacion == null && c.online !== false && (
                                    <Icono onClick={() => setVerPtz((x) => !x)} activo={verPtz} titulo={verPtz ? "Ocultar el joystick" : "Mover la cámara (PTZ)"}><Joystick size={18} /></Icono>
                                )}
                                {c.geom && <Icono onClick={() => setVerGeom((x) => !x)} activo={verGeom} titulo={verGeom ? "Ocultar la línea y la zona" : "Mostrar la línea y la zona de la cámara"}><Spline size={18} /></Icono>}
                                {c.nvrId && c.ch != null && (
                                    <Icono onClick={() => setGrabacionDesde((g) => (g != null ? null : alerta ? +new Date(alerta.ts) - GRABACION_ANTES_ALERTA_MS : Date.now() - GRABACION_ANTES_MS))}
                                        activo={grabacion != null} titulo={grabacion != null ? "Volver al vivo  ( Esc )" : "Ver la grabación sobre este mismo cuadro"}><History size={18} /></Icono>
                                )}
                                {foto && <span className="hidden sm:contents"><Icono href={foto.replace(/[?&]w=\d+/, "")} titulo="Abrir la foto de ahora en una pestaña"><Camera size={18} /></Icono></span>}
                                {alVentana && <span className="hidden md:contents"><Icono onClick={alVentana} titulo="Abrir este canal solo en otra ventana (para otro monitor)"><AppWindow size={18} /></Icono></span>}
                                <Icono onClick={alternarLleno} titulo={lleno ? "Salir de pantalla completa" : "Pantalla completa"}>{lleno ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</Icono>
                                <span className="w-px h-5 bg-white/15 mx-0.5" />
                                <Icono onClick={alCerrar} titulo="Volver a la pared  ( Esc )"><X size={20} /></Icono>
                            </span>
                        </div>
                    </div>

                    {/* Seguimiento visual: los enlaces a las cámaras vecinas, sobre el vivo. */}
                    {grabacion == null && c.online !== false && (
                        <SeguimientoVisual key={c.clave} c={c} canales={canales} links={seguimiento[idCanal(c)] || []} editando={editandoSeguimiento}
                            cuadro={cuadro} h265={h265} hls={hls} alertaDe={alertaDe || (() => null)} alSeguir={(d) => alSeguir?.(d)}
                            alGuardado={(n) => alGuardarSeguimiento?.(idCanal(c), n)} />
                    )}
                    {/* La cámara de la que se vino por el seguimiento: chica, abajo a la izquierda, para volver. */}
                    {origen && grabacion == null && (
                        <div className={cn("absolute left-4 bottom-24 w-[240px] aspect-video rounded-[10px] overflow-hidden ring-1 ring-white/25 bg-black transition-opacity", !visibles && "opacity-60")}>
                            <Vivo src={vivoDe(origen.stream, !h265, hls)} className="absolute inset-0 w-full h-full object-cover" />
                            <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white"><Crosshair size={11} /> Origen · {origen.nombre}</span>
                            <button type="button" onClick={alVolverOrigen} className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[var(--accion)] text-white text-[12px] font-semibold"><ChevronLeft size={13} /> Volver</button>
                            <button type="button" onClick={alSoltarOrigen} aria-label="Cerrar el origen" className="absolute top-1.5 right-1.5 w-7 h-7 grid place-items-center rounded-full bg-black/60 text-white/85"><X size={14} /></button>
                        </div>
                    )}


                    {/* El joystick PTZ: abajo a la derecha, donde llega la mano. */}
                    <AnimatePresence>
                        {verPtz && ptz && grabacion == null && idPtz && (
                            <div key="ptz" className="absolute right-4 sm:right-7 bottom-5 sm:bottom-7 z-10">
                                <JoystickPtz deviceId={idPtz} alCerrar={() => setVerPtz(false)} />
                            </div>
                        )}
                    </AnimatePresence>

                    {/* Abajo: las últimas chapas, si la cámara lee. */}
                    {lecturas.length > 0 && grabacion == null && (
                        <div className={cn("absolute bottom-0 inset-x-0 p-5 md:px-7 flex items-center gap-2 flex-wrap bg-gradient-to-t from-black/70 to-transparent transition-opacity duration-300", !visibles && "opacity-0")}>
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/60 mr-1">Últimas lecturas</span>
                            {lecturas.slice(0, 6).map((l) => <ChapaChica key={l.id} l={l} />)}
                        </div>
                    )}

                    <TipVisor />
                </motion.div>
            )}
        </AnimatePresence>
    );
}
