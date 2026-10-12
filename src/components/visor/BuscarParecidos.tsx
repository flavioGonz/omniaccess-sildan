"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Crop, Image as ImageIcon, Loader2, PlayCircle, Scan, ScanSearch, Search, Server, Sparkles, X } from "lucide-react";
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
 */

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
    const [abierto, setAbierto] = useState<Resultado | null>(null);
    const lienzo = useRef<HTMLDivElement>(null);

    useEffect(() => { hasAcuSeekNvr().then(setConNvr).catch(() => { }); }, []);
    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (abierto) setAbierto(null); else onCerrar(); } };
        window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
    }, [onCerrar, abierto]);

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

    return (
        <div className="absolute inset-0 z-[70]" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <motion.div className="absolute inset-0 bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onCerrar} />
            <motion.aside role="dialog" aria-label="Buscar parecidos"
                initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
                className="dark absolute inset-y-0 right-0 w-full lg:w-[min(1040px,94%)] flex flex-col bg-[#0c0e12]/[0.98] backdrop-blur-xl border-l border-white/10 text-white shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.7)]">

                <div className="shrink-0 flex items-start gap-3 px-6 pt-5 pb-4 border-b border-white/[0.08]">
                    <span className="w-10 h-10 rounded-[10px] grid place-items-center bg-white/[0.07] border border-white/10 shrink-0"><ScanSearch size={18} className="text-[var(--accion-en-oscuro)]" /></span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold leading-tight">Buscar parecidos</div>
                        <div className="text-[12.5px] text-white/55 mt-0.5">Recortá lo que querés buscar en la foto (o tocá lo que reconoce OmniVision) y se busca en todas las cámaras.</div>
                    </div>
                    <button type="button" onClick={onCerrar} aria-label="Cerrar" title="Cerrar  ( Esc )" className="w-8 h-8 grid place-items-center rounded-[6px] text-white/60 hover:text-white hover:bg-white/10"><X size={17} /></button>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[380px_1fr]">
                    {/* ── Izquierda: la foto y el recorte ── */}
                    <div className="border-b lg:border-b-0 lg:border-r border-white/[0.08] p-5 space-y-3 overflow-y-auto">
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
                                <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] bg-black/65 text-[11.5px] font-semibold"><Loader2 size={12} className="animate-spin" /> Mirando la foto…</span>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                            {objetos?.map((o, i) => {
                                const I = ICONO_GRUPO[o.grupo] || Scan;
                                const sel = elegidoEs(o);
                                return (
                                    <button key={i} type="button" onClick={() => { setCaja(conMargen(o.caja)); setEtiqueta(nombreClase(o.clase)); }} aria-pressed={sel}
                                        className={cn("h-8 pl-1 pr-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                            sel ? "border-white bg-white text-black" : "border-white/15 text-white/80 hover:bg-white/[0.06]")}>
                                        <span className={cn("grid place-items-center h-6 w-6 rounded-full", sel ? "bg-black/10" : "bg-white/10")}><I size={13} /></span>
                                        {nombreClase(o.clase)}
                                    </button>
                                );
                            })}
                            <button type="button" onClick={() => { setCaja(null); setEtiqueta("Toda la foto"); }} aria-pressed={!caja && etiqueta === "Toda la foto"}
                                className={cn("h-8 pl-1 pr-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                                    !caja && etiqueta === "Toda la foto" ? "border-white bg-white text-black" : "border-white/15 text-white/80 hover:bg-white/[0.06]")}>
                                <span className="grid place-items-center h-6 w-6 rounded-full bg-white/10"><ImageIcon size={13} /></span> Toda la foto
                            </button>
                        </div>
                        <p className="text-[11.5px] text-white/50 flex items-start gap-1.5"><Crop size={12} className="mt-0.5 shrink-0" /> Arrastrá sobre la foto para recortar a mano. Lo que no sea una persona, un vehículo o un animal se encuentra peor.</p>
                        {errorFoto && <p className="text-[12px] text-red-300">{errorFoto}</p>}

                        {recorte && (
                            <div className="flex items-center gap-3 rounded-[10px] border border-white/10 bg-white/[0.03] p-2.5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={recorte.miniatura} alt="" className="w-14 h-14 object-cover rounded-[6px] bg-black" />
                                <div className="min-w-0">
                                    <div className="text-[12.5px] font-semibold">{etiqueta || "Recorte"}</div>
                                    <div className="text-[11px] text-white/50">del evento del {fechaCorta(instanteMs)} {horaSeg(instanteMs)}</div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Derecha: los resultados ── */}
                    <div className="min-h-0 flex flex-col">
                        <div className="shrink-0 flex flex-wrap items-center gap-2 px-5 py-3 border-b border-white/[0.08]">
                            <span className="flex items-center rounded-full border border-white/15 p-0.5">
                                <button type="button" onClick={() => setMotor("omni")} aria-pressed={motor === "omni"}
                                    className={cn("h-7 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5", motor === "omni" ? "bg-white text-black" : "text-white/70 hover:text-white")}>
                                    <Sparkles size={13} /> OmniVision
                                </button>
                                <button type="button" onClick={() => conNvr && setMotor("nvr")} aria-pressed={motor === "nvr"} disabled={!conNvr}
                                    title={conNvr ? "La misma búsqueda en el NVR (AcuSearch)" : "No hay un NVR Hikvision VPro dado de alta: la búsqueda del NVR no está en esta instalación."}
                                    className={cn("h-7 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5", motor === "nvr" ? "bg-white text-black" : "text-white/70 hover:text-white", !conNvr && "opacity-40 cursor-not-allowed hover:text-white/70")}>
                                    <Server size={13} /> NVR (AcuSearch)
                                </button>
                            </span>
                            {motor === "omni" && (
                                <span className="flex items-center rounded-full border border-white/15 p-0.5">
                                    {RANGOS.map((x) => (
                                        <button key={x.h} type="button" onClick={() => setH(x.h)} aria-pressed={h === x.h}
                                            className={cn("h-7 px-2.5 rounded-full text-[12px] font-semibold tabular-nums", h === x.h ? "bg-white text-black" : "text-white/70 hover:text-white")}>{x.r}</button>
                                    ))}
                                </span>
                            )}
                            {motor === "omni" && res && !buscando && (
                                <span className="ml-auto text-[11.5px] text-white/50 tabular-nums">{res.resultados.length} más parecidos de {res.comparados.toLocaleString("es-UY")} · {res.ms} ms</span>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-5">
                            {motor === "nvr" ? (
                                recorte && <AcuSearchPanel image={recorte.blob} previewUrl={recorte.miniatura} engine="vehicle" centerTimeMs={instanteMs} onBack={() => setMotor("omni")} title="Búsqueda en el NVR" />
                            ) : error ? (
                                <div className="rounded-[10px] border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12.5px]">{error}</div>
                            ) : buscando || !res ? (
                                <div className="h-full grid place-items-center text-white/60 text-[13px]"><span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Buscando en lo que vieron las cámaras…</span></div>
                            ) : !res.resultados.length ? (
                                <div className="h-full grid place-items-center text-center text-white/60 text-[13px] px-6">Nada parecido en {RANGOS.find((r) => r.h === h)?.r}. Probá un rango más largo o un recorte más ajustado.</div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                                    {res.resultados.map((r, i) => {
                                        const rel = max > min ? (r.coseno - min) / (max - min) : 1;
                                        const I = ICONO_GRUPO[r.grupo] || Scan;
                                        return (
                                            <button key={r.id} type="button" onClick={() => setAbierto(r)}
                                                className="text-left rounded-[10px] border border-white/10 overflow-hidden hover:border-[var(--accion-en-oscuro)] transition-colors bg-white/[0.02]">
                                                <div className="relative aspect-square bg-black">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    {r.recorte && <img src={img(r.recorte, 256)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                                                    <span className="absolute left-1.5 top-1.5 h-5 min-w-5 px-1 rounded-[5px] bg-black/70 text-[10.5px] font-bold tabular-nums grid place-items-center">{i + 1}</span>
                                                </div>
                                                <div className="px-2 py-1.5">
                                                    <div className="flex items-center gap-1 text-[11.5px] font-semibold truncate"><I size={11} className="shrink-0 text-white/60" /> {r.camara}</div>
                                                    <div className="text-[10.5px] text-white/50 tabular-nums">{fechaCorta(r.primeraVez)} {horaSeg(r.primeraVez)}</div>
                                                    <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden" title={`coseno ${r.coseno}`}><div className="h-full bg-[var(--accion-en-oscuro)]" style={{ width: `${Math.max(8, rel * 100)}%` }} /></div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Un resultado, en grande. */}
                {abierto && (
                    <div className="absolute inset-0 z-10 bg-black/80 grid place-items-center p-6" onClick={() => setAbierto(null)}>
                        <div className="w-full max-w-4xl rounded-[14px] overflow-hidden border border-white/10 bg-[#0c0e12]" onClick={(e) => e.stopPropagation()}>
                            <div className="relative bg-black">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={img(abierto.foto || abierto.recorte)} alt="" className="block w-full max-h-[66vh] object-contain" />
                                {abierto.foto && abierto.caja && (
                                    <div className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-[3px] pointer-events-none"
                                        style={{ left: `${abierto.caja[0] * 100}%`, top: `${abierto.caja[1] * 100}%`, width: `${(abierto.caja[2] - abierto.caja[0]) * 100}%`, height: `${(abierto.caja[3] - abierto.caja[1]) * 100}%` }} />
                                )}
                            </div>
                            <div className="flex items-center gap-3 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="text-[14px] font-bold">{nombreClase(abierto.clase)} · {abierto.camara}</div>
                                    <div className="text-[12px] text-white/55 tabular-nums">{fechaCorta(abierto.primeraVez)} {horaSeg(abierto.primeraVez)}</div>
                                </div>
                                <div className="ml-auto flex items-center gap-2">
                                    {onVerGrabacion && abierto.deviceId && (
                                        <button type="button" onClick={() => onVerGrabacion(abierto.deviceId!, Date.parse(abierto.primeraVez), abierto.camara)}
                                            className="h-9 px-4 rounded-[6px] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] text-white text-[13px] font-bold inline-flex items-center gap-2">
                                            <PlayCircle size={15} /> Ver grabación
                                        </button>
                                    )}
                                    <a href="/admin/vision/buscar" className="h-9 px-3 rounded-[6px] text-[13px] font-semibold text-white/70 hover:text-white hover:bg-white/10 inline-flex items-center gap-1.5"><Search size={14} /> OmniVision › Buscar</a>
                                    <button type="button" onClick={() => setAbierto(null)} className="w-9 h-9 grid place-items-center rounded-[6px] text-white/60 hover:text-white hover:bg-white/10"><X size={16} /></button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </motion.aside>
        </div>
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
