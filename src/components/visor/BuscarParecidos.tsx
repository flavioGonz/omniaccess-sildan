"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, ChevronLeft, ChevronRight, ChevronUp, Crop, Film, Image as ImageIcon, LayoutGrid, Loader2, PlayCircle, Scan, ScanSearch, Search, Server, Sparkles } from "lucide-react";
import { useClipEvento, CLIP_ANTES_S } from "@/lib/clip-evento";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { fechaCorta, horaSeg } from "@/lib/fechas";
import { ICONO_GRUPO, nombreClase } from "@/components/vision/ObjetoRegistro";
import { AcuSearchPanel } from "@/components/dashboard/AcuSearchPanel";
import { hasAcuSeekNvr } from "@/app/actions/acuseek";

/**
 * Buscar lo que se ve en el evento en todas las cámaras: se recorta un pedazo de la foto (o se
 * toca un objeto que OmniVision reconoce en ella) y se busca lo parecido.
 *
 * Es la «búsqueda inteligente» de Los Olivos —que recorta sobre la foto y le pregunta al NVR
 * Hikvision VPro (AcuSearch)— hecha con OmniVision: el recorte va a SigLIP y se compara con la
 * huella de cada cosa que registraron las cámaras (lo mismo que OmniVision › Buscar con una
 * foto). Si hay un NVR VPro, la misma búsqueda se puede hacer también en el NVR, en la otra
 * pestaña, para comparar las dos con el mismo recorte.
 *
 * Por qué se busca un RECORTE y no la foto entera: las huellas son de recortes (una persona,
 * un auto). Una foto de la calle entera no se parece a ningún recorte.
 *
 * Se despliega como una PERSIANA dentro de la ventana del evento (pedido de Nico, 13/10): antes
 * era un panel aparte a la derecha de la pantalla y quedaban dos ventanas, una tapando a la otra.
 * Va adentro del marco del evento y baja desde arriba; al cerrarla se enrolla y el evento queda
 * como estaba (encuadre y zoom incluidos). El padre la envuelve en <AnimatePresence> para que
 * también se vea subir.
 *
 * Un resultado se abre EN EL LUGAR de la grilla (14/10): antes se abría en un recuadro con su
 * marco sobre la persiana, que a su vez está sobre el evento — una ventana dentro de otra dentro
 * de otra. Ahora la foto ocupa el panel de resultados a sangre, con la tira de los demás abajo
 * para pasar de uno a otro (← →) y «Resultados» para volver a la grilla.
 */

/** La persiana baja con un recorte que se abre de arriba hacia abajo, sin rebote. */
const PERSIANA = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

type Caja = [number, number, number, number];
type Objeto = { caja: Caja; clase: string; grupo: string; confianza: number };
type Resultado = { id: string; camara: string; deviceId: string | null; clase: string; grupo: string; primeraVez: string; recorte: string | null; foto: string | null; caja: Caja | null; coseno: number };

/** Lado mayor con que se manda la foto: alcanza para detectar sin subir megas. */
const LADO_MAX = 1600;
/** Margen alrededor de un objeto tocado, como el recorte que guarda el registro. */
const MARGEN = 0.06;
/** Un recorte más chico que esto (fracción del lado) es un clic sin arrastre, no un recorte. */
const RECORTE_MIN = 0.03;
const RANGOS = [{ h: 24, r: "24 h" }, { h: 168, r: "7 días" }, { h: 720, r: "30 días" }];

const img = (k: string | null, w?: number) => (k ? `/api/vision/imagen/${k}${w ? `?w=${w}` : ""}` : "");

export function BuscarParecidos({ foto, instanteMs, onCerrar, onVerGrabacion }: {
    foto: string;
    instanteMs: number;
    onCerrar: () => void;
    /** Abrir la grabación de un resultado (su cámara, su instante). */
    onVerGrabacion?: (deviceId: string, ms: number, camara: string) => void;
}) {
    const [base, setBase] = useState<HTMLCanvasElement | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [objetos, setObjetos] = useState<Objeto[] | null>(null);
    const [errorFoto, setErrorFoto] = useState<string | null>(null);
    /** Lo elegido, en fracciones de la foto: un objeto tocado, un recorte arrastrado o la foto entera. */
    const [caja, setCaja] = useState<Caja | null>(null);
    const [etiqueta, setEtiqueta] = useState("");
    const [arrastre, setArrastre] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
    const [h, setH] = useState(168);
    const [motor, setMotor] = useState<"omni" | "nvr">("omni");
    const [conNvr, setConNvr] = useState(false);
    const [recorte, setRecorte] = useState<{ blob: Blob; miniatura: string } | null>(null);
    const [res, setRes] = useState<{ resultados: Resultado[]; comparados: number; ms: number } | null>(null);
    const [buscando, setBuscando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** El resultado abierto, por posición en la lista: así ← y → pasan al anterior y al siguiente. */
    const [abiertoIdx, setAbiertoIdx] = useState<number | null>(null);
    const abierto = abiertoIdx != null ? res?.resultados[abiertoIdx] ?? null : null;
    const tira = useRef<HTMLDivElement>(null);
    const lienzo = useRef<HTMLDivElement>(null);

    useEffect(() => { hasAcuSeekNvr().then(setConNvr).catch(() => { }); }, []);
    useEffect(() => {
        const n = res?.resultados.length || 0;
        const k = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.stopPropagation(); if (abiertoIdx != null) setAbiertoIdx(null); else onCerrar(); return; }
            if (abiertoIdx == null || !n) return;
            if (e.key === "ArrowRight") { e.stopPropagation(); e.preventDefault(); setAbiertoIdx((i) => Math.min(n - 1, (i ?? 0) + 1)); }
            if (e.key === "ArrowLeft") { e.stopPropagation(); e.preventDefault(); setAbiertoIdx((i) => Math.max(0, (i ?? 0) - 1)); }
        };
        window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
    }, [onCerrar, abiertoIdx, res]);
    /*
     * La miniatura del abierto, siempre a la vista en la tira. Con scrollLeft de la TIRA y no con
     * scrollIntoView: scrollIntoView corre también a los contenedores de afuera aunque tengan
     * overflow hidden, y desplazaba la persiana entera de costado (18/10: el panel quedaba cortado
     * a la izquierda y la foto del resultado fuera de la vista).
     */
    useEffect(() => {
        const t = tira.current; if (abiertoIdx == null || !t) return;
        const el = t.querySelector<HTMLElement>(`[data-i="${abiertoIdx}"]`); if (!el) return;
        t.scrollTo({ left: el.offsetLeft - t.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }, [abiertoIdx]);
    // Una búsqueda nueva vuelve a la grilla.
    useEffect(() => { setAbiertoIdx(null); }, [res]);

    // La foto del evento, achicada, y lo que OmniVision reconoce en ella.
    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const r = await fetch(foto, { cache: "force-cache" });
                if (!r.ok) throw new Error(`La foto no está (${r.status})`);
                const bmp = await createImageBitmap(await r.blob());
                const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
                const c = document.createElement("canvas");
                c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
                c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
                if (!vivo) return;
                setBase(c); setUrl(c.toDataURL("image/jpeg", 0.88));
                const b = await aBlob(c);
                const d = await fetch("/api/vision/buscar?objetos=1", { method: "POST", body: b, headers: { "content-type": "image/jpeg" } });
                const j = await d.json().catch(() => ({}));
                if (!d.ok) throw new Error(j?.error || `OmniVision respondió ${d.status}`);
                if (!vivo) return;
                const obs: Objeto[] = j.objetos || [];
                setObjetos(obs);
                // De entrada, lo más grande: casi siempre es lo que se quiere buscar.
                if (obs.length) {
                    const m = obs.reduce((a, o) => ((o.caja[2] - o.caja[0]) * (o.caja[3] - o.caja[1]) > (a.caja[2] - a.caja[0]) * (a.caja[3] - a.caja[1]) ? o : a));
                    setCaja(conMargen(m.caja)); setEtiqueta(nombreClase(m.clase));
                }
            } catch (e: any) { if (vivo) { setErrorFoto(e?.message || "No se pudo mirar la foto"); setObjetos([]); } }
        })();
        return () => { vivo = false; };
    }, [foto]);

    // El recorte elegido, como imagen: lo que se manda a buscar.
    useEffect(() => {
        if (!base) return;
        let vivo = true;
        const c = recortar(base, caja);
        aBlob(c).then((blob) => { if (vivo) setRecorte({ blob, miniatura: c.toDataURL("image/jpeg", 0.8) }); });
        return () => { vivo = false; };
    }, [base, caja]);

    // Buscar en OmniVision cuando cambia el recorte o el rango.
    useEffect(() => {
        // Se espera a saber qué hay en la foto: si no, se buscaría primero la foto entera y enseguida el objeto.
        if (!recorte || motor !== "omni" || objetos === null) return;
        let vivo = true;
        setBuscando(true); setError(null);
        fetch(`/api/vision/buscar?h=${h}`, { method: "POST", body: recorte.blob, headers: { "content-type": "image/jpeg" }, cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { if (vivo) setRes(j); })
            .catch((e) => { if (vivo) setError(e?.message || "No se pudo buscar"); })
            .finally(() => { if (vivo) setBuscando(false); });
        return () => { vivo = false; };
    }, [recorte, h, motor, objetos === null]); // eslint-disable-line react-hooks/exhaustive-deps

    const fraccion = (e: React.PointerEvent) => {
        const r = lienzo.current!.getBoundingClientRect();
        return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };
    const cajaArrastre: Caja | null = arrastre ? [Math.min(arrastre.x0, arrastre.x), Math.min(arrastre.y0, arrastre.y), Math.max(arrastre.x0, arrastre.x), Math.max(arrastre.y0, arrastre.y)] : null;
    const max = res?.resultados[0]?.coseno || 1;
    const min = res?.resultados[res.resultados.length - 1]?.coseno ?? 0;
    const elegidoEs = useMemo(() => (o: Objeto) => !!caja && JSON.stringify(conMargen(o.caja)) === JSON.stringify(caja), [caja]);

    /*
     * Sigue el tema (18/10, Nico: «lo mismo para buscar parecidos», tras el visor en claro).
     * Antes forzaba `dark` y un fondo casi negro: en tema claro bajaba una persiana negra sobre
     * el visor ya claro. Ahora el panel usa las superficies y la tinta del tema; lo que va SOBRE
     * una foto (el recorte, los números de las tarjetas, las flechas) sigue oscuro, porque ahí
     * lo que hay abajo es la imagen y no el panel.
     */
    return (
        <motion.section role="dialog" aria-label="Buscar parecidos"
            onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}
            initial={{ clipPath: "inset(0 0 100% 0)" }} animate={{ clipPath: "inset(0 0 0% 0)" }} exit={{ clipPath: "inset(0 0 100% 0)" }} transition={PERSIANA}
            className="absolute inset-0 z-[60] flex flex-col cajon-vidrio text-foreground">

                <div className="shrink-0 flex items-start gap-3 px-6 pt-5 pb-4 border-b border-border">
                    <span className="w-10 h-10 rounded-[10px] grid place-items-center bg-muted border border-border shrink-0"><ScanSearch size={18} className="text-[var(--accion)]" /></span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold leading-tight">Buscar parecidos</div>
                        <div className="text-[12.5px] text-muted-foreground mt-0.5">Recortá lo que querés buscar en la foto (o tocá lo que reconoce OmniVision) y se busca en todas las cámaras.</div>
                    </div>
                    <button type="button" onClick={onCerrar} aria-label="Subir la persiana" title="Volver al evento  ( Esc )"
                        className="h-8 pl-2 pr-3 rounded-[6px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
                        <ChevronUp size={16} /> Volver al evento
                    </button>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[380px_1fr]">
                    {/* ── Izquierda: la foto y el recorte ── */}
                    <div className="border-b lg:border-b-0 lg:border-r border-border p-5 space-y-3 overflow-y-auto">
                        <div ref={lienzo} className="relative rounded-[10px] overflow-hidden bg-black select-none touch-none cursor-crosshair"
                            onPointerDown={(e) => { if (!url) return; (e.currentTarget as any).setPointerCapture(e.pointerId); const p = fraccion(e); setArrastre({ x0: p.x, y0: p.y, x: p.x, y: p.y }); }}
                            onPointerMove={(e) => { if (!arrastre) return; const p = fraccion(e); setArrastre((a) => (a ? { ...a, x: p.x, y: p.y } : a)); }}
                            onPointerUp={() => {
                                if (cajaArrastre && cajaArrastre[2] - cajaArrastre[0] > RECORTE_MIN && cajaArrastre[3] - cajaArrastre[1] > RECORTE_MIN) { setCaja(cajaArrastre); setEtiqueta("Recorte"); }
                                setArrastre(null);
                            }}>
                            {url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={url} alt="" className="block w-full h-auto pointer-events-none" draggable={false} />
                            ) : <div className="aspect-video grid place-items-center"><Loader2 size={18} className="animate-spin text-white/50" /></div>}
                            {objetos?.map((o, i) => {
                                const [x1, y1, x2, y2] = o.caja;
                                return (
                                    <button key={i} type="button" title={`Buscar ${nombreClase(o.clase)}`}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={() => { setCaja(conMargen(o.caja)); setEtiqueta(nombreClase(o.clase)); }}
                                        className={cn("absolute rounded-[3px] border transition-colors cursor-pointer", elegidoEs(o) ? "border-transparent" : "border-white/60 hover:border-white border-dashed")}
                                        style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }} />
                                );
                            })}
                            {(cajaArrastre || caja) && (() => {
                                const [x1, y1, x2, y2] = (cajaArrastre || caja)!;
                                return (
                                    <>
                                        <div className="absolute inset-0 pointer-events-none bg-black/55" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${x1 * 100}% ${y1 * 100}%,${x1 * 100}% ${y2 * 100}%,${x2 * 100}% ${y2 * 100}%,${x2 * 100}% ${y1 * 100}%,${x1 * 100}% ${y1 * 100}%)` }} />
                                        <div className="absolute pointer-events-none border-2 border-[var(--accion-en-oscuro)] rounded-[3px]" style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }} />
                                    </>
                                );
                            })()}
                            {url && !objetos && (
                                <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] bg-black/65 text-white text-[11.5px] font-semibold"><Loader2 size={12} className="animate-spin" /> Mirando la foto…</span>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                            {objetos?.map((o, i) => {
                                const I = ICONO_GRUPO[o.grupo] || Scan;
                                const sel = elegidoEs(o);
                                // Dos autos en la foto eran dos pastillas «Auto» iguales: se numeran, de izquierda a derecha.
                                const iguales = objetos.filter((x) => x.clase === o.clase);
                                const nombre = iguales.length > 1 ? `${nombreClase(o.clase)} ${[...iguales].sort((a, b) => a.caja[0] - b.caja[0]).indexOf(o) + 1}` : nombreClase(o.clase);
                                return (
                                    <button key={i} type="button" onClick={() => { setCaja(conMargen(o.caja)); setEtiqueta(nombre); }} aria-pressed={sel}
                                        className={cn("h-8 pl-1 pr-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                            sel ? "border-foreground bg-foreground text-background" : "border-border text-foreground/80 hover:bg-muted")}>
                                        <span className={cn("grid place-items-center h-6 w-6 rounded-full", sel ? "bg-background/15" : "bg-muted")}><I size={13} /></span>
                                        {nombre}
                                    </button>
                                );
                            })}
                            <button type="button" onClick={() => { setCaja(null); setEtiqueta("Toda la foto"); }} aria-pressed={!caja && etiqueta === "Toda la foto"}
                                className={cn("h-8 pl-1 pr-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                    !caja && etiqueta === "Toda la foto" ? "border-foreground bg-foreground text-background" : "border-border text-foreground/80 hover:bg-muted")}>
                                <span className="grid place-items-center h-6 w-6 rounded-full bg-muted"><ImageIcon size={13} /></span> Toda la foto
                            </button>
                        </div>
                        <p className="text-[11.5px] text-muted-foreground flex items-start gap-1.5"><Crop size={12} className="mt-0.5 shrink-0" /> Arrastrá sobre la foto para recortar a mano. Lo que no sea una persona, un vehículo o un animal se encuentra peor.</p>
                        {errorFoto && <p className="text-[12px] tono-mal">{errorFoto}</p>}

                        {recorte && (
                            <div className="flex items-center gap-3 rounded-[10px] border border-border bg-muted/40 p-2.5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={recorte.miniatura} alt="" className="w-14 h-14 object-cover rounded-[6px] bg-black" />
                                <div className="min-w-0">
                                    <div className="text-[12.5px] font-semibold">{etiqueta || "Recorte"}</div>
                                    <div className="text-[11px] text-muted-foreground">del evento del {fechaCorta(instanteMs)} {horaSeg(instanteMs)}</div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Derecha: los resultados ── */}
                    <div className="min-h-0 flex flex-col">
                        {abierto && res ? (
                            <DetalleResultado r={abierto} i={abiertoIdx!} total={res.resultados.length} resultados={res.resultados} tira={tira} min={min} max={max}
                                alElegir={setAbiertoIdx} alVolver={() => setAbiertoIdx(null)} onVerGrabacion={onVerGrabacion} />
                        ) : (<>
                        <div className="shrink-0 flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border">
                            <span className="flex items-center rounded-full border border-border p-0.5">
                                <button type="button" onClick={() => setMotor("omni")} aria-pressed={motor === "omni"}
                                    className={cn("h-7 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5", motor === "omni" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                                    <Sparkles size={13} /> OmniVision
                                </button>
                                <button type="button" onClick={() => conNvr && setMotor("nvr")} aria-pressed={motor === "nvr"} disabled={!conNvr}
                                    title={conNvr ? "La misma búsqueda en el NVR (AcuSearch)" : "No hay un NVR Hikvision VPro dado de alta: la búsqueda del NVR no está en esta instalación."}
                                    className={cn("h-7 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5", motor === "nvr" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground", !conNvr && "opacity-40 cursor-not-allowed hover:text-muted-foreground")}>
                                    <Server size={13} /> NVR (AcuSearch)
                                </button>
                            </span>
                            {motor === "omni" && (
                                <span className="flex items-center rounded-full border border-border p-0.5">
                                    {RANGOS.map((x) => (
                                        <button key={x.h} type="button" onClick={() => setH(x.h)} aria-pressed={h === x.h}
                                            className={cn("h-7 px-2.5 rounded-full text-[12px] font-semibold tabular-nums", h === x.h ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{x.r}</button>
                                    ))}
                                </span>
                            )}
                            {motor === "omni" && res && !buscando && (
                                <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums">{res.resultados.length} más parecidos de {res.comparados.toLocaleString("es-UY")} · {res.ms} ms</span>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-5">
                            {motor === "nvr" ? (
                                recorte && <AcuSearchPanel image={recorte.blob} previewUrl={recorte.miniatura} engine="vehicle" centerTimeMs={instanteMs} onBack={() => setMotor("omni")} title="Búsqueda en el NVR" />
                            ) : error ? (
                                <div className="rounded-[10px] border border-[var(--mal)]/30 bg-[var(--mal)]/10 tono-mal px-4 py-3 text-[12.5px]">{error}</div>
                            ) : buscando || !res ? (
                                <div className="h-full grid place-items-center text-muted-foreground text-[13px]"><span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Buscando en lo que vieron las cámaras…</span></div>
                            ) : !res.resultados.length ? (
                                <div className="h-full grid place-items-center text-center text-muted-foreground text-[13px] px-6">Nada parecido en {RANGOS.find((r) => r.h === h)?.r}. Probá un rango más largo o un recorte más ajustado.</div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                                    {res.resultados.map((r, i) => {
                                        const rel = max > min ? (r.coseno - min) / (max - min) : 1;
                                        const I = ICONO_GRUPO[r.grupo] || Scan;
                                        return (
                                            <button key={r.id} type="button" onClick={() => setAbiertoIdx(i)}
                                                className="text-left rounded-[10px] border border-border overflow-hidden hover:border-[var(--accion)] transition-colors bg-card">
                                                <div className="relative aspect-square bg-black">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    {r.recorte && <img src={img(r.recorte, 256)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                                                    <span className="absolute left-1.5 top-1.5 h-5 min-w-5 px-1 rounded-[5px] bg-black/70 text-white text-[10.5px] font-bold tabular-nums grid place-items-center">{i + 1}</span>
                                                </div>
                                                <div className="px-2 py-1.5">
                                                    <div className="flex items-center gap-1 text-[11.5px] font-semibold truncate"><I size={11} className="shrink-0 text-muted-foreground" /> {r.camara}</div>
                                                    <div className="text-[10.5px] text-muted-foreground tabular-nums">{fechaCorta(r.primeraVez)} {horaSeg(r.primeraVez)}</div>
                                                    <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden" title={`coseno ${r.coseno}`}><div className="h-full bg-[var(--accion)]" style={{ width: `${Math.max(8, rel * 100)}%` }} /></div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        </>)}
                    </div>
                </div>

                {/* El borde de abajo de la persiana: tirar de acá la enrolla. */}
                <button type="button" onClick={onCerrar} aria-label="Subir la persiana" title="Volver al evento  ( Esc )"
                    className="shrink-0 h-5 grid place-items-center border-t border-border bg-muted/50 hover:bg-muted transition-colors">
                    <span className="block w-12 h-1 rounded-full bg-foreground/25" />
                </button>
        </motion.section>
    );
}

/** Qué tan parecido, en palabras: el coseno crudo no le dice nada a nadie. */
function parecido(rel: number) {
    return rel >= 0.8 ? { texto: "Muy parecido", tono: "bien" } : rel >= 0.45 ? { texto: "Parecido", tono: "aviso" } : { texto: "Algo parecido", tono: "quieto" };
}

/**
 * Un resultado abierto (18/10, Nico: «sólo trae miniaturas, no lleva a una foto del hecho; debe traer
 * la foto y un clip de video para apreciar la detección; la presentación es fea, no es premium»).
 *
 * Ahora es una ficha del hecho, como el visor: la foto del momento a sangre con la silueta del objeto
 * (la de la segmentación, pedida a api/history/ov-siluetas; mientras tanto, su recuadro), y encima,
 * cuando llega, el clip de los segundos de antes en loop (el mismo de las alarmas: useClipEvento),
 * con la píldora Foto/Video. Abajo a la izquierda qué es, dónde y cuándo, y qué tan parecido; a la
 * derecha las acciones (la grabación, OmniVision › Buscar). La tira de los demás, abajo.
 */
function DetalleResultado({ r, i, total, resultados, tira, min, max, alElegir, alVolver, onVerGrabacion }: {
    r: Resultado; i: number; total: number; resultados: Resultado[]; tira: React.RefObject<HTMLDivElement | null>; min: number; max: number;
    alElegir: (i: number) => void; alVolver: () => void; onVerGrabacion?: (deviceId: string, ms: number, camara: string) => void;
}) {
    const I = ICONO_GRUPO[r.grupo] || Scan;
    const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
    const [silueta, setSilueta] = useState<[number, number][][] | null>(null);
    useEffect(() => { setNat(null); setSilueta(null); }, [r.id]);
    // La silueta de verdad (segmentación a pedido, guardada al lado de la foto).
    useEffect(() => {
        if (!r.foto) return;
        let vivo = true;
        fetch("/api/history/ov-siluetas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [r.id] }) })
            .then((x) => (x.ok ? x.json() : null)).then((j) => { if (vivo && j?.siluetas?.[r.id]) setSilueta(j.siluetas[r.id]); }).catch(() => { });
        return () => { vivo = false; };
    }, [r.id, r.foto]);
    const { clipOn, cambiarClip, clip, clipVisible, setClipVisible } = useClipEvento({ id: `parecido-${r.id}`, deviceId: r.deviceId, instante: r.primeraVez, activo: !!r.deviceId });
    const enVideo = clipOn && clip.estado === "listo" && clipVisible;
    const rel = max > min ? (r.coseno - min) / (max - min) : 1;
    const p = parecido(rel);
    const flecha = "w-11 h-11 grid place-items-center rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md border border-white/15 text-white disabled:opacity-0 transition-[opacity,background-color]";
    const W = nat?.w || 1, H = nat?.h || 1;
    return (
        <>
            {/* ── Arriba: volver a la grilla, cuál de cuántos ── */}
            <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-border">
                <button type="button" onClick={alVolver} title="Volver a la grilla  ( Esc )"
                    className="h-8 pl-2 pr-3 rounded-[6px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
                    <LayoutGrid size={14} /> Resultados
                </button>
                <span className="text-[12px] text-muted-foreground tabular-nums">{i + 1} de {total}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">← → para pasar · Esc vuelve</span>
            </div>

            {/* ── La foto del hecho, a sangre, con la silueta; el clip encima cuando llega ── */}
            <div className="relative flex-1 min-h-0 bg-black overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={r.id} src={img(r.foto || r.recorte)} alt="" onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    className="absolute inset-0 w-full h-full object-contain" />
                {clipOn && clip.estado === "listo" && clip.url && (
                    <video key={clip.url} src={clip.url} autoPlay muted loop playsInline onPlaying={() => setClipVisible(true)} onError={() => setClipVisible(false)}
                        className={cn("absolute inset-0 w-full h-full object-contain transition-opacity duration-500", clipVisible ? "opacity-100" : "opacity-0")} />
                )}
                {r.foto && r.caja && nat && !enVideo && (
                    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none">
                        <defs>
                            <filter id={`brillo-${r.id}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={Math.min(W, H) * 0.004} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                        </defs>
                        {silueta ? silueta.map((poli, k) => (
                            <polygon key={k} points={poli.map(([x, y]) => `${x * W},${y * H}`).join(" ")} fill="var(--accion-en-oscuro)" fillOpacity={0.18}
                                stroke="var(--accion-en-oscuro)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" filter={`url(#brillo-${r.id})`} />
                        )) : (
                            <rect x={r.caja[0] * W} y={r.caja[1] * H} width={(r.caja[2] - r.caja[0]) * W} height={(r.caja[3] - r.caja[1]) * H} rx={Math.min(W, H) * 0.006}
                                fill="var(--accion-en-oscuro)" fillOpacity={0.08} stroke="var(--accion-en-oscuro)" strokeWidth={2} vectorEffect="non-scaling-stroke" filter={`url(#brillo-${r.id})`} />
                        )}
                    </svg>
                )}
                <div className="absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />

                {/* Arriba: la píldora Foto / Video, como en las alarmas. */}
                {r.deviceId && (
                    <div className="absolute top-3 right-3 flex items-center rounded-full bg-black/50 backdrop-blur-xl border border-white/15 p-0.5 text-[11.5px] font-semibold">
                        <button type="button" onClick={() => cambiarClip(false)} aria-pressed={!clipOn}
                            className={cn("h-7 px-3 rounded-full inline-flex items-center gap-1.5", !clipOn ? "bg-white text-black" : "text-white/75 hover:text-white")}><ImageIcon size={12} /> Foto</button>
                        <button type="button" onClick={() => cambiarClip(true)} aria-pressed={clipOn}
                            title={clip.estado === "sin" ? `Sin video: ${clip.motivo}` : `Los ${CLIP_ANTES_S} s de antes, en loop`}
                            className={cn("h-7 px-3 rounded-full inline-flex items-center gap-1.5", clipOn ? "bg-white text-black" : "text-white/75 hover:text-white")}>
                            {clipOn && clip.estado === "cargando" ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                            {clipOn && clip.estado === "sin" ? "Sin video" : clipOn && clip.estado === "cargando" ? "Video…" : "Video"}
                        </button>
                    </div>
                )}

                {/* Abajo: qué es, dónde y cuándo, qué tan parecido; y las acciones. */}
                <div className="absolute inset-x-0 bottom-0 p-5 flex flex-wrap items-end gap-4">
                    <div className="min-w-0 flex-1 text-white">
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className={cn("inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-bold", `pleno-${p.tono}`)}>
                                <Sparkles size={11} /> {p.texto}
                            </span>
                            <span className="text-[11px] text-white/60 tabular-nums">#{i + 1} de {total}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[22px] font-bold tracking-[-0.015em] leading-tight [text-shadow:0_2px_12px_rgba(0,0,0,.8)]">
                            <I size={20} className="shrink-0 opacity-90" /> <span className="truncate">{nombreClase(r.clase)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-white/80 tabular-nums">
                            <Camera size={13} className="opacity-70" /> <span className="font-semibold text-white/95 truncate">{r.camara}</span>
                            <span className="text-white/35">·</span><span>{fechaCorta(r.primeraVez)} {horaSeg(r.primeraVez)}</span>
                            <span className="text-white/35">·</span><span className="text-white/60">{hace(r.primeraVez)}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <a href="/admin/vision/buscar" className="h-9 px-3 rounded-[8px] text-[12.5px] font-semibold text-white/85 hover:text-white bg-white/10 hover:bg-white/20 border border-white/15 backdrop-blur-md inline-flex items-center gap-1.5"><Search size={13} /> OmniVision</a>
                        {onVerGrabacion && r.deviceId && (
                            <button type="button" onClick={() => onVerGrabacion(r.deviceId!, Date.parse(r.primeraVez), r.camara)}
                                className="h-9 px-4 rounded-[8px] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] text-white text-[13px] font-bold inline-flex items-center gap-1.5">
                                <PlayCircle size={15} /> Ver la grabación
                            </button>
                        )}
                    </div>
                </div>

                <button type="button" aria-label="Anterior" disabled={i === 0} onClick={() => alElegir(i - 1)} className={cn(flecha, "absolute left-4 top-1/2 -translate-y-1/2")}><ChevronLeft size={22} /></button>
                <button type="button" aria-label="Siguiente" disabled={i >= total - 1} onClick={() => alElegir(i + 1)} className={cn(flecha, "absolute right-4 top-1/2 -translate-y-1/2")}><ChevronRight size={22} /></button>
            </div>

            {/* ── La tira de todos ── */}
            <div ref={tira} className="shrink-0 flex gap-2 overflow-x-auto px-5 py-3 border-t border-border [scrollbar-width:thin]">
                {resultados.map((x, j) => (
                    <button key={x.id} data-i={j} type="button" onClick={() => alElegir(j)} aria-pressed={j === i} title={`${j + 1} · ${x.camara} · ${horaSeg(x.primeraVez)}`}
                        className={cn("relative shrink-0 w-[96px] aspect-video rounded-[8px] overflow-hidden bg-black transition-[opacity,box-shadow]", j === i ? "ring-2 ring-[var(--accion)] ring-offset-2 ring-offset-background" : "opacity-60 hover:opacity-100")}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {x.recorte && <img src={img(x.recorte, 160)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                        <span className="absolute left-1 top-1 px-1 rounded-[4px] bg-black/70 text-white text-[9.5px] font-bold tabular-nums">{j + 1}</span>
                    </button>
                ))}
            </div>
        </>
    );
}

function conMargen(c: Caja): Caja {
    const mx = (c[2] - c[0]) * MARGEN, my = (c[3] - c[1]) * MARGEN;
    return [Math.max(0, c[0] - mx), Math.max(0, c[1] - my), Math.min(1, c[2] + mx), Math.min(1, c[3] + my)];
}

function recortar(base: HTMLCanvasElement, caja: Caja | null): HTMLCanvasElement {
    if (!caja) return base;
    const W = base.width, H = base.height;
    const a = caja[0] * W, b = caja[1] * H, w = (caja[2] - caja[0]) * W, h = (caja[3] - caja[1]) * H;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    c.getContext("2d")!.drawImage(base, a, b, w, h, 0, 0, c.width, c.height);
    return c;
}

function aBlob(c: HTMLCanvasElement): Promise<Blob> {
    return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar el recorte"))), "image/jpeg", 0.9));
}
