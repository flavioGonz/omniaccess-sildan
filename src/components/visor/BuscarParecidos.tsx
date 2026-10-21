"use client";

import { AjusteVideoFicha } from "@/components/video/AjusteVideoFicha";
import { useEffect, useMemo, useRef, useState } from "react";
import { ElegirArea } from "@/components/devices/ElegirArea";
import { useFiltroArea } from "@/lib/use-filtro-area";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Camera, Check, ChevronLeft, ChevronRight, Crop, Download, Film, Image as ImageIcon, Loader2, Maximize2, PlayCircle, Scan, ScanSearch, Search, Server, Share2, Sparkles, X } from "lucide-react";
import { GrabacionVisor } from "@/components/visor/GrabacionVisor";
import { CompartirEvento } from "@/components/visor/CompartirEvento";
import { useClipEvento } from "@/lib/clip-evento";
import { hace } from "@/lib/fechas";
import { cn } from "@/lib/utils";
import { fechaCorta, horaSeg } from "@/lib/fechas";
import { ICONO_GRUPO, nombreClase } from "@/components/vision/ObjetoRegistro";
import { AcuSearchPanel } from "@/components/dashboard/AcuSearchPanel";
import { hasAcuSeekNvr } from "@/app/actions/acuseek";
import { mismaChapa } from "@/lib/matriculas";
import { CategoriaChapa } from "@/components/ui/CategoriaChapa";
import { ComportamientoDeChapa } from "@/components/visor/PanelComportamiento";
import { MarcoRefinado } from "@/components/ui/marco-refinado";

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

/*
 * La entrada (18/10, Nico: «entra tipo persiana de arriba hacia abajo, y no: debe ser más premium,
 * como splash que aparece encima de lo anterior, tipo navegación de la propia ventana»). La persiana
 * tapaba el evento de arriba abajo como una cortina. Ahora la búsqueda APARECE encima (escala y
 * foco, sin rebote), y adentro se navega como en una app: la grilla → un resultado entra desde la
 * derecha y la grilla se corre a la izquierda; «‹ Resultados» y «‹ Evento» vuelven.
 */
const ENTRADA = { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.8 };
const PASO_ADELANTE = { initial: { x: "12%", opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: "12%", opacity: 0 }, transition: ENTRADA };
const PASO_ATRAS = { initial: { x: "-6%", opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: "-6%", opacity: 0 }, transition: ENTRADA };

type Caja = [number, number, number, number];
type Objeto = { caja: Caja; clase: string; grupo: string; confianza: number };
type Resultado = { id: string; camara: string; deviceId: string | null; clase: string; grupo: string; primeraVez: string; recorte: string | null; foto: string | null; caja: Caja | null; coseno: number };
/** La matrícula de un resultado (api/vision/parecidos/chapas): la del registro o la leída a pedido. */
type Chapa = { texto: string; confianza: number; recorte: string | null; fuente: "registro" | "foto" };
/** Cómo se abre un resultado desde su miniatura: la ficha, o directo en la grabación o en compartir. */
type Apertura = "foto" | "grabacion" | "compartir";
/** De a cuántos se piden las chapas: lo que lee omni-vision sin que la grilla espere demasiado. */
const LOTE_CHAPAS = 12;

/** Lado mayor con que se manda la foto: alcanza para detectar sin subir megas. */
const LADO_MAX = 1600;
/** Margen alrededor de un objeto tocado, como el recorte que guarda el registro. */
const MARGEN = 0.06;
/** Un recorte más chico que esto (fracción del lado) es un clic sin arrastre, no un recorte. */
const RECORTE_MIN = 0.03;
const RANGOS = [{ h: 24, r: "24 h" }, { h: 168, r: "7 días" }, { h: 720, r: "30 días" }];

/** El rótulo de cada grupo de la columna izquierda. */
const ROTULO = "text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground";
/** La grilla de resultados: llena el ancho que haya, con tarjetas de al menos 200 px. */
const GRILLA = "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2";

const img = (k: string | null, w?: number) => (k ? `/api/vision/imagen/${k}${w ? `?w=${w}` : ""}` : "");

export function BuscarParecidos({ foto, instanteMs, chapa: chapaEvento, onCerrar, onVerGrabacion }: {
    foto: string;
    instanteMs: number;
    /** La chapa del evento desde el que se busca, si tiene: para decir qué resultado es EL MISMO vehículo. */
    chapa?: string | null;
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
    // En qué área buscar (21/10, Nico): las cámaras de esa área de Dispositivos y las de adentro.
    const fa = useFiltroArea("parecidos");
    const [motor, setMotor] = useState<"omni" | "nvr">("omni");
    const [conNvr, setConNvr] = useState(false);
    const [recorte, setRecorte] = useState<{ blob: Blob; miniatura: string } | null>(null);
    const [res, setRes] = useState<{ resultados: Resultado[]; comparados: number; ms: number } | null>(null);
    const [buscando, setBuscando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** El resultado abierto, por posición en la lista: así ← y → pasan al anterior y al siguiente. */
    const [abiertoIdx, setAbiertoIdx] = useState<number | null>(null);
    const abierto = abiertoIdx != null ? res?.resultados[abiertoIdx] ?? null : null;
    const [apertura, setApertura] = useState<Apertura>("foto");
    /** Chapa por resultado: undefined = todavía no se sabe, null = no tiene (o no se pudo leer). */
    const [chapas, setChapas] = useState<Record<string, Chapa | null>>({});
    const [leyendoChapas, setLeyendoChapas] = useState(false);
    /** La chapa por la que se filtra la grilla (el representante del grupo). */
    const [filtroChapa, setFiltroChapa] = useState<string | null>(null);
    const tira = useRef<HTMLDivElement>(null);
    /** El resultado abierto tiene algo propio abierto (la grabación, compartir, el clip): las teclas son de eso. */
    const detalleOcupado = useRef(false);
    const lienzo = useRef<HTMLDivElement>(null);

    useEffect(() => { hasAcuSeekNvr().then(setConNvr).catch(() => { }); }, []);
    useEffect(() => {
        const n = res?.resultados.length || 0;
        const k = (e: KeyboardEvent) => {
            if (detalleOcupado.current) return;
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
    useEffect(() => { setAbiertoIdx(null); setFiltroChapa(null); }, [res]);

    /*
     * La chapa de cada resultado (18/10, Nico: «¿podés leer también la matrícula de la foto del
     * parecido e intentar relacionarlas?»). Se piden de a lotes, primero los más parecidos; la
     * grilla no espera: cada miniatura muestra su chapa cuando llega.
     */
    useEffect(() => {
        const ids = (res?.resultados || []).filter((r) => r.grupo === "vehiculo").map((r) => r.id);
        if (!ids.length) { setLeyendoChapas(false); return; }
        let vivo = true;
        setLeyendoChapas(true);
        (async () => {
            for (let i = 0; i < ids.length && vivo; i += LOTE_CHAPAS) {
                const lote = ids.slice(i, i + LOTE_CHAPAS);
                try {
                    const r = await fetch("/api/vision/parecidos/chapas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: lote }), cache: "no-store" });
                    const j = r.ok ? await r.json() : null;
                    // Se guarda siempre, aunque la búsqueda haya cambiado: los ids son únicos.
                    if (j?.chapas) setChapas((c) => ({ ...c, ...j.chapas }));
                } catch { break; }
            }
            if (vivo) setLeyendoChapas(false);
        })();
        return () => { vivo = false; };
    }, [res]);

    /** Los resultados agrupados por chapa (con la tolerancia del OCR: ver lib/matriculas). */
    const grupos = useMemo(() => agruparPorChapa(res?.resultados || [], chapas, chapaEvento || null), [res, chapas, chapaEvento]);
    const visibles = useMemo(() => {
        const todos = (res?.resultados || []).map((r, i) => ({ r, i }));
        if (!filtroChapa) return todos;
        const g = grupos.find((x) => x.chapa === filtroChapa);
        return g ? todos.filter(({ r }) => g.ids.includes(r.id)) : todos;
    }, [res, grupos, filtroChapa]);

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
        fetch(`/api/vision/buscar?h=${h}${fa.filtrando ? `&area=${encodeURIComponent(fa.area)}` : ""}`, { method: "POST", body: recorte.blob, headers: { "content-type": "image/jpeg" }, cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { if (vivo) setRes(j); })
            .catch((e) => { if (vivo) setError(e?.message || "No se pudo buscar"); })
            .finally(() => { if (vivo) setBuscando(false); });
        return () => { vivo = false; };
    }, [recorte, h, motor, objetos === null, fa.area]); // eslint-disable-line react-hooks/exhaustive-deps

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
            initial={{ opacity: 0, scale: 0.965, y: 14, filter: "blur(6px)" }} animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.975, y: 10, filter: "blur(4px)" }} transition={ENTRADA}
            className="absolute inset-0 z-[60] overflow-hidden cajon-vidrio cajon-denso text-foreground">
            <AnimatePresence initial={false} mode="popLayout">
            {abierto && res ? (
                <motion.div key="detalle" className="absolute inset-0 flex flex-col" {...PASO_ADELANTE}>
                    <DetalleResultado r={abierto} i={abiertoIdx!} total={res.resultados.length} resultados={res.resultados} tira={tira} min={min} max={max}
                        buscado={recorte?.miniatura || null} etiqueta={etiqueta} ocupado={detalleOcupado} inicial={apertura}
                        chapas={chapas} chapaEvento={chapaEvento || null}
                        alElegir={(i) => { setApertura("foto"); setAbiertoIdx(i); }} alVolver={() => setAbiertoIdx(null)} alCerrar={onCerrar} />
                </motion.div>
            ) : (
            <motion.div key="busqueda" className="absolute inset-0" {...PASO_ATRAS}>
                {/*
                  * Dos columnas sin barra de título (20/10, Nico, sobre un boceto): a la izquierda todo lo
                  * que define la búsqueda —la foto con el recorte, qué se busca, dónde y cuándo, las
                  * chapas—; a la derecha SÓLO los resultados, a todo el alto. La barra de arriba ocupaba
                  * una franja entera para un título; el título pasa a ir sobre la foto, y «‹ Evento» deja
                  * de ser un botón con texto a la izquierda: es la cruz de la esquina, como cualquier ventana.
                  *
                  * minmax(0,1fr) y min-w-0: con 1fr a secas la columna crece hasta el ancho de su contenido
                  * (ver el resultado abierto, más abajo).
                  */}
                <div className="h-full grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[340px_minmax(0,1fr)]">
                    {/* ── Izquierda: qué se busca, dónde y cuándo ── */}
                    <aside className="min-h-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-border p-4 space-y-4">
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
                            ) : <MarcoRefinado className="aspect-video" etapa={errorFoto ? "error" : "cargando"} />}
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
                            {/* El título, sobre la foto (antes era una barra entera arriba de las dos columnas). */}
                            <div className="absolute inset-x-0 top-0 px-2.5 pt-2.5 pb-6 pointer-events-none bg-[linear-gradient(to_bottom,rgba(0,0,0,.72),transparent)] flex items-center gap-2 text-white">
                                <span className="w-7 h-7 rounded-[8px] grid place-items-center bg-white/15 backdrop-blur-md border border-white/15 shrink-0"><ScanSearch size={14} /></span>
                                <div className="min-w-0 leading-tight [text-shadow:0_1px_6px_rgba(0,0,0,.6)]">
                                    <div className="text-[13px] font-bold">Buscar parecidos</div>
                                    <div className="text-[10.5px] text-white/75 tabular-nums truncate">Evento del {fechaCorta(instanteMs)} · {horaSeg(instanteMs)}</div>
                                </div>
                            </div>
                            {url && !objetos && (
                                <span className="absolute left-2 bottom-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] bg-black/65 text-white text-[11.5px] font-semibold"><Loader2 size={12} className="animate-spin" /> Mirando la foto…</span>
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className={ROTULO}>Qué se busca</div>
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
                                <div className="flex items-center gap-3 rounded-[10px] border border-border bg-muted/40 p-2">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={recorte.miniatura} alt="" className="w-12 h-12 object-cover rounded-[6px] bg-black" />
                                    <div className="min-w-0">
                                        <div className="text-[12.5px] font-semibold">{etiqueta || "Recorte"}</div>
                                        <div className="text-[11px] text-muted-foreground">lo que se manda a buscar</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Dónde y cuándo: estaba en la barra de los resultados (boceto del 20/10). */}
                        <div className="space-y-2">
                            <div className={ROTULO}>Dónde y cuándo</div>
                            <span className="flex w-full items-center rounded-full border border-border p-0.5">
                                <button type="button" onClick={() => setMotor("omni")} aria-pressed={motor === "omni"}
                                    className={cn("flex-1 h-7 px-3 rounded-full text-[12px] font-semibold inline-flex items-center justify-center gap-1.5", motor === "omni" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                                    <Sparkles size={13} /> OmniVision
                                </button>
                                <button type="button" onClick={() => conNvr && setMotor("nvr")} aria-pressed={motor === "nvr"} disabled={!conNvr}
                                    title={conNvr ? "La misma búsqueda en el NVR (AcuSearch)" : "No hay un NVR Hikvision VPro dado de alta: la búsqueda del NVR no está en esta instalación."}
                                    className={cn("flex-1 h-7 px-3 rounded-full text-[12px] font-semibold inline-flex items-center justify-center gap-1.5", motor === "nvr" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground", !conNvr && "opacity-40 cursor-not-allowed hover:text-muted-foreground")}>
                                    <Server size={13} /> NVR (AcuSearch)
                                </button>
                            </span>
                            {motor === "omni" && (
                                <span className="flex w-full items-center rounded-full border border-border p-0.5">
                                    {RANGOS.map((x) => (
                                        <button key={x.h} type="button" onClick={() => setH(x.h)} aria-pressed={h === x.h}
                                            className={cn("flex-1 h-7 px-2.5 rounded-full text-[12px] font-semibold tabular-nums", h === x.h ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{x.r}</button>
                                    ))}
                                </span>
                            )}
                            {motor === "omni" && fa.hayAreas && (
                                <ElegirArea areas={fa.areas} valor={fa.area} alElegir={fa.setArea} sinArea alinear="start" className="w-full h-8 rounded-full" />
                            )}
                            {motor === "omni" && (
                                <p className="text-[11.5px] text-muted-foreground tabular-nums min-h-[17px]">
                                    {buscando ? "Buscando…" : res ? <>{res.resultados.length} más parecidos de {res.comparados.toLocaleString("es-UY")}{fa.nombre ? ` en ${fa.nombre}` : ""} · {res.ms} ms</> : null}
                                </p>
                            )}
                        </div>

                        {motor === "omni" && res && !buscando && <FranjaChapas grupos={grupos} leyendo={leyendoChapas} filtro={filtroChapa} onFiltro={setFiltroChapa} chapaEvento={chapaEvento || null} />}
                    </aside>

                    {/* ── Derecha: sólo los resultados, a todo el alto ── */}
                    <div className="relative min-h-0 min-w-0">
                        <button type="button" onClick={onCerrar} aria-label="Volver al evento" title="Volver al evento  ( Esc )"
                            className="absolute right-3 top-3 z-20 w-9 h-9 rounded-full grid place-items-center bg-black/55 backdrop-blur-md border border-white/20 text-white/90 hover:text-white hover:bg-black/75 transition-colors">
                            <X size={17} />
                        </button>
                        <div className={cn("h-full overflow-y-auto p-3", motor === "nvr" && "pt-14 px-5")}>
                            {motor === "nvr" ? (
                                recorte && <AcuSearchPanel image={recorte.blob} previewUrl={recorte.miniatura} engine="vehicle" centerTimeMs={instanteMs} onBack={() => setMotor("omni")} title="Búsqueda en el NVR" />
                            ) : error ? (
                                <div className="h-full grid place-items-center px-6"><div className="rounded-[10px] border border-[var(--mal)]/30 bg-[var(--mal)]/10 tono-mal px-4 py-3 text-[12.5px] max-w-md">{error}</div></div>
                            ) : buscando || !res ? (
                                /* Mientras busca: la grilla entera ya reservada, cada lugar con su marco trabajando.
                                   Sin cartel (21/10, Nico: «queda feo ese "Buscando en lo que vieron las cámaras",
                                   retiralo y llená el espacio con el resto de capturas loading»): los marcos llenan
                                   todo el lado derecho, y lo que sobra se corta abajo en vez de dejar un hueco. */
                                <div className="h-full overflow-hidden" aria-busy="true" aria-label="Buscando parecidos">
                                    <div className={GRILLA}>
                                        {Array.from({ length: 40 }, (_, k) => <MarcoRefinado key={k} etapa={k % 7 < 3 ? "cargando" : "cola"} retardo={k % 12} conEtapa={false} className="aspect-[4/3] rounded-[10px]" />)}
                                    </div>
                                </div>
                            ) : !res.resultados.length ? (
                                <div className="h-full grid place-items-center text-center text-muted-foreground text-[13px] px-6">Nada parecido en {RANGOS.find((r) => r.h === h)?.r}. Probá un rango más largo o un recorte más ajustado.</div>
                            ) : (
                                /* Sin marco (18/10, Nico: «las mini capturas de parecidos deben ser sin marcos, con
                                   controles y datos overlay»): la foto ocupa la tarjeta entera y los datos van encima. */
                                <div className={GRILLA}>
                                    {visibles.map(({ r, i }) => (
                                        <Miniatura key={r.id} r={r} i={i} rel={max > min ? (r.coseno - min) / (max - min) : 1}
                                            chapa={chapas[r.id]} leyendo={r.grupo === "vehiculo" && chapas[r.id] === undefined && leyendoChapas} chapaEvento={chapaEvento || null}
                                            onAbrir={(m) => { setApertura(m); setAbiertoIdx(i); }} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
            )}
            </AnimatePresence>
        </motion.section>
    );
}

/** Qué tan parecido, en palabras: el coseno crudo no le dice nada a nadie. */
function parecido(rel: number) {
    return rel >= 0.8 ? { texto: "Muy parecido", tono: "bien" } : rel >= 0.45 ? { texto: "Parecido", tono: "aviso" } : { texto: "Algo parecido", tono: "quieto" };
}

/**
 * Un resultado abierto, como una FICHA DE EVENTO (18/10, Nico: «mejorar la foto y video de
 * parecidos con nuestro estilo de ficha de evento, con el playback, compartir clip, etc.»).
 *
 * Ocupa la ventana entera —es un paso más de la navegación: evento › parecidos › resultado— y se
 * arma como el visor: la foto del hecho a sangre con la silueta del objeto y, encima, el clip de los
 * segundos de antes en loop; a la izquierda la ficha (qué tan parecido, lo buscado al lado de lo
 * encontrado, qué es, dónde y cuándo); a la derecha el riel (la grabación AHÍ MISMO, con su regla y
 * sus controles, exportar el clip, compartir); abajo la tira de los demás resultados.
 */
function DetalleResultado({ r, i, total, resultados, tira, min, max, buscado, etiqueta, ocupado, inicial, chapas, chapaEvento, alElegir, alVolver, alCerrar }: {
    r: Resultado; i: number; total: number; resultados: Resultado[]; tira: React.RefObject<HTMLDivElement | null>; min: number; max: number;
    /** El recorte que se buscó, para ponerlo al lado de lo encontrado. */
    buscado: string | null; etiqueta: string;
    /** Le avisa a la búsqueda que las teclas son de lo que está abierto acá (grabación, compartir, clip). */
    ocupado: React.MutableRefObject<boolean>;
    /** Con qué se abre: la ficha, o directo la grabación o compartir (los controles de la miniatura). */
    inicial: Apertura;
    chapas: Record<string, Chapa | null>; chapaEvento: string | null;
    alElegir: (i: number) => void; alVolver: () => void; alCerrar: () => void;
}) {
    const chapa = chapas[r.id] || null;
    const coincide = chapa && chapaEvento ? mismaChapa(chapa.texto, chapaEvento) : null;
    const [historial, setHistorial] = useState(false);
    const I = ICONO_GRUPO[r.grupo] || Scan;
    const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
    const [silueta, setSilueta] = useState<[number, number][][] | null>(null);
    const [modo, setModo] = useState<"foto" | "grabacion">("foto");
    const [clipGrab, setClipGrab] = useState(false);
    const [compartir, setCompartir] = useState(false);
    useEffect(() => { setNat(null); setSilueta(null); setModo(inicial === "grabacion" ? "grabacion" : "foto"); setClipGrab(false); setCompartir(inicial === "compartir"); setHistorial(false); }, [r.id, inicial]);
    useEffect(() => { ocupado.current = modo !== "foto" || compartir || historial; return () => { ocupado.current = false; }; }, [modo, compartir, historial, ocupado]);
    // Esc en la grabación vuelve a la foto (el cajón del clip y compartir manejan su propio Esc).
    useEffect(() => {
        if (modo === "foto") return;
        const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !clipGrab && !compartir && !historial) { e.preventDefault(); setModo("foto"); } };
        window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
    }, [modo, clipGrab, compartir, historial]);
    // Esc cierra el historial de la chapa.
    useEffect(() => {
        if (!historial) return;
        const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setHistorial(false); } };
        window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
    }, [historial]);
    // La silueta de verdad (segmentación a pedido, guardada al lado de la foto).
    useEffect(() => {
        if (!r.foto) return;
        let vivo = true;
        fetch("/api/history/ov-siluetas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [r.id] }) })
            .then((x) => (x.ok ? x.json() : null)).then((j) => { if (vivo && j?.siluetas?.[r.id]) setSilueta(j.siluetas[r.id]); }).catch(() => { });
        return () => { vivo = false; };
    }, [r.id, r.foto]);
    const { clipOn, cambiarClip, clip, clipVisible, setClipVisible, ventana: ventanaFicha } = useClipEvento({ id: `parecido-${r.id}`, deviceId: r.deviceId, instante: r.primeraVez, activo: !!r.deviceId && modo === "foto" });
    const enVideo = clipOn && clip.estado === "listo" && clipVisible && modo === "foto";
    const rel = max > min ? (r.coseno - min) / (max - min) : 1;
    const p = parecido(rel);
    const W = nat?.w || 1, H = nat?.h || 1;
    const momento = new Date(r.primeraVez);
    const flecha = "w-11 h-11 grid place-items-center rounded-full visor-vidrio text-white disabled:opacity-0 transition-opacity";
    const riel = "visor-vidrio w-10 h-10 rounded-full grid place-items-center text-white/85 hover:text-white";

    return (
        <>
            {/* ── Navegación: ‹ Resultados · n de total · cerrar ── */}
            <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-border">
                <button type="button" onClick={alVolver} title="Volver a los resultados  ( Esc )"
                    className="h-9 pl-1.5 pr-3 -ml-1.5 rounded-[10px] text-[13px] font-semibold inline-flex items-center gap-0.5 text-[var(--accion)] hover:bg-muted">
                    <ChevronLeft size={20} /> Resultados
                </button>
                <span className="w-px h-5 bg-border" />
                <span className="flex items-center gap-1.5 text-[13px] font-semibold min-w-0"><I size={14} className="text-muted-foreground shrink-0" /><span className="truncate">{nombreClase(r.clase)} · {r.camara}</span></span>
                <span className="text-[12px] text-muted-foreground tabular-nums">{i + 1} de {total}</span>
                <button type="button" onClick={alCerrar} aria-label="Volver al evento" title="Volver al evento"
                    className="ml-auto h-8 px-3 rounded-[8px] text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5"><X size={14} /> Cerrar búsqueda</button>
            </div>

            {/* ── La foto del hecho, a sangre ── */}
            <div className="relative flex-1 min-h-0 bg-[#05070b] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={r.id} src={img(r.foto || r.recorte)} alt="" onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    className="absolute inset-0 w-full h-full object-contain" />
                {clipOn && clip.estado === "listo" && clip.url && modo === "foto" && (
                    <video key={clip.url} src={clip.url} autoPlay muted loop playsInline onPlaying={() => setClipVisible(true)} onError={() => setClipVisible(false)}
                        className={cn("absolute inset-0 w-full h-full object-contain transition-opacity duration-500", clipVisible ? "opacity-100" : "opacity-0")} />
                )}
                {r.foto && r.caja && nat && !enVideo && modo === "foto" && (
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

                {/* La grabación del NVR, en el lugar de la foto: la regla, ±10 s, velocidades y el clip (como el visor). */}
                {modo === "grabacion" && r.deviceId && (
                    <GrabacionVisor deviceId={r.deviceId} camara={r.camara} instanteMs={momento.getTime()} poster={r.foto ? img(r.foto) : null} clip={clipGrab} onClip={setClipGrab} />
                )}

                {modo === "foto" && (<>
                    <div className="absolute inset-y-0 left-0 w-[46%] bg-gradient-to-r from-black/80 via-black/40 to-transparent pointer-events-none" />
                    <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

                    {/* ── IZQUIERDA · la ficha ── */}
                    <div className="absolute left-6 top-6 bottom-6 w-[min(340px,40%)] flex flex-col justify-center gap-4 text-white [text-shadow:0_2px_12px_rgba(0,0,0,.85)]">
                        <div className="flex items-center gap-2">
                            <span className={cn("inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-bold [text-shadow:none]", `pleno-${p.tono}`)}><Sparkles size={12} /> {p.texto}</span>
                            <span className="text-[11.5px] text-white/60 tabular-nums">#{i + 1} de {total}</span>
                        </div>
                        <div>
                            <div className="flex items-center gap-2.5 text-[26px] font-bold tracking-[-0.02em] leading-tight"><I size={24} className="shrink-0" /> <span className="truncate">{nombreClase(r.clase)}</span></div>
                            <div className="mt-1 flex items-center gap-2 text-[13px] text-white/85"><Camera size={13} className="opacity-70" /><span className="font-semibold truncate">{r.camara}</span></div>
                            <div className="mt-0.5 text-[13px] text-white/70 tabular-nums">{fechaCorta(r.primeraVez)} · {horaSeg(r.primeraVez)} <span className="text-white/45">· {hace(r.primeraVez)}</span></div>
                        </div>
                        {/* La chapa: lo que dice si es EL MISMO vehículo o sólo uno parecido. */}
                        {chapa && (
                            <div className="flex flex-wrap items-center gap-2 [text-shadow:none]">
                                <PlacaChapa texto={chapa.texto} grande />
                                <CategoriaChapa plate={chapa.texto} />
                                {coincide != null && (
                                    <span className={cn("inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-bold", coincide ? "pleno-bien" : "pleno-quieto")}>
                                        {coincide ? <><Check size={12} strokeWidth={3} /> Mismo vehículo</> : "Otra chapa"}
                                    </span>
                                )}
                                <button type="button" onClick={() => setHistorial(true)} title="Por dónde anduvo esta chapa"
                                    className="h-7 px-2.5 rounded-full visor-vidrio text-white/85 hover:text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5"><Activity size={13} /> Comportamiento</button>
                                {chapa.fuente === "foto" && <span className="w-full text-[10.5px] text-white/50">Leída de esta foto · {Math.round(chapa.confianza * 100)} %</span>}
                            </div>
                        )}
                        {/* Lo buscado al lado de lo encontrado: se compara mirando. */}
                        <div className="visor-panel rounded-[12px] p-2.5 [text-shadow:none]">
                            <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/55 mb-2">Lo buscado · lo encontrado</div>
                            <div className="grid grid-cols-2 gap-2">
                                {[{ src: buscado, rot: etiqueta || "Recorte" }, { src: r.recorte ? img(r.recorte, 320) : null, rot: `#${i + 1}` }].map((x, k) => (
                                    <div key={k} className="relative aspect-square rounded-[8px] overflow-hidden bg-black ring-1 ring-white/10">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {x.src && <img src={x.src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                                        <span className="absolute left-1 bottom-1 px-1.5 rounded-[5px] bg-black/70 text-white text-[10px] font-bold">{x.rot}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden" title={`coseno ${r.coseno}`}><div className="h-full bg-[var(--accion-en-oscuro)]" style={{ width: `${Math.max(8, rel * 100)}%` }} /></div>
                        </div>
                    </div>

                    {/* Arriba a la derecha: la píldora Foto / Video. */}
                    {r.deviceId && (
                        <div className="absolute top-4 right-4 flex items-center rounded-full bg-black/50 backdrop-blur-xl border border-white/15 p-0.5 text-[11.5px] font-semibold">
                            <button type="button" onClick={() => cambiarClip(false)} aria-pressed={!clipOn}
                                className={cn("h-7 px-3 rounded-full inline-flex items-center gap-1.5", !clipOn ? "bg-white text-black" : "text-white/75 hover:text-white")}><ImageIcon size={12} /> Foto</button>
                            <button type="button" onClick={() => cambiarClip(true)} aria-pressed={clipOn}
                                title={clip.estado === "sin" ? `Sin video: ${clip.motivo}` : `Los ${ventanaFicha.antes} s de antes, en loop`}
                                className={cn("h-7 px-3 rounded-full inline-flex items-center gap-1.5", clipOn ? "bg-white text-black" : "text-white/75 hover:text-white")}>
                                {clipOn && clip.estado === "cargando" ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                                {clipOn && clip.estado === "sin" ? "Sin video" : clipOn && clip.estado === "cargando" ? "Video…" : "Video"}
                            </button>
                            {/* Cuánto trae el video, al lado del video (21/10). */}
                            <AjusteVideoFicha chico lado="abajo" className="ml-0.5" />
                        </div>
                    )}

                    {/* ── DERECHA · el riel: grabación, clip, compartir ── */}
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 visor-panel rounded-full p-1.5 flex flex-col items-center gap-1.5">
                        {r.deviceId && <button type="button" onClick={() => setModo("grabacion")} title="La grabación de ese momento, acá: regla, ±10 s, velocidades" className={riel}><PlayCircle size={17} /></button>}
                        {r.deviceId && <button type="button" onClick={() => { setModo("grabacion"); setClipGrab(true); }} title="Exportar un clip: bajarlo o mandarlo por WhatsApp" className={riel}><Download size={16} /></button>}
                        {r.foto && <button type="button" onClick={() => setCompartir(true)} title="Compartir por WhatsApp o Telegram" className={riel}><Share2 size={16} /></button>}
                        <span className="w-4 h-px bg-white/15" />
                        <a href="/admin/vision/buscar" title="OmniVision › Buscar" className={riel}><Search size={16} /></a>
                    </div>

                    <button type="button" aria-label="Anterior" disabled={i === 0} onClick={() => alElegir(i - 1)} className={cn(flecha, "absolute left-[calc(min(340px,40%)+40px)] bottom-6")}><ChevronLeft size={22} /></button>
                    <button type="button" aria-label="Siguiente" disabled={i >= total - 1} onClick={() => alElegir(i + 1)} className={cn(flecha, "absolute right-20 bottom-6")}><ChevronRight size={22} /></button>
                </>)}

                {/* En la grabación: qué se mira y volver a la foto (como el visor). */}
                {modo === "grabacion" && !clipGrab && (
                    <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
                        <span className="h-9 pl-2.5 pr-3 rounded-full bg-black/55 backdrop-blur-xl border border-white/15 text-white/85 text-[12px] font-semibold flex items-center gap-2 max-w-[300px]">
                            <PlayCircle size={14} className="text-[var(--accion-en-oscuro)] shrink-0" /><span className="truncate">Grabación · {r.camara}</span>
                        </span>
                        <button type="button" onClick={() => setModo("foto")} title="Volver a la foto  ( Esc )" aria-label="Volver a la foto"
                            className="h-9 w-9 rounded-full bg-black/55 backdrop-blur-xl border border-white/15 grid place-items-center text-white/85 hover:text-white"><ImageIcon size={15} /></button>
                    </div>
                )}

                {/* El comportamiento de la chapa, en un cajón dentro de la ventana (como en el visor). */}
                <AnimatePresence>
                    {historial && chapa && (
                        <motion.aside key="historial" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={ENTRADA}
                            className="absolute right-0 inset-y-0 z-[55] w-[min(420px,92%)] cajon-vidrio border-l border-border text-foreground flex flex-col">
                            <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border">
                                <Activity size={15} className="text-[var(--accion)]" />
                                <span className="text-[13.5px] font-bold">Comportamiento</span>
                                <PlacaChapa texto={chapa.texto} />
                                <button type="button" onClick={() => setHistorial(false)} aria-label="Cerrar" title="Cerrar  ( Esc )"
                                    className="ml-auto w-8 h-8 rounded-[8px] grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted"><X size={16} /></button>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto p-4">
                                <ComportamientoDeChapa plate={chapa.texto} momento={r.primeraVez} />
                            </div>
                        </motion.aside>
                    )}
                </AnimatePresence>

                {compartir && (
                    <CompartirEvento foto={r.foto ? img(r.foto) : null} deviceId={r.deviceId} deviceName={r.camara} instante={r.primeraVez}
                        titulo={`🔎 ${nombreClase(r.clase)} · ${r.camara}`}
                        lineas={[`${fechaCorta(r.primeraVez)} ${horaSeg(r.primeraVez)}`, ...(chapa ? [`Matrícula ${chapa.texto}`] : []), `Parecido a lo buscado (${p.texto.toLowerCase()}) · OmniVision`]}
                        onCerrar={() => setCompartir(false)} />
                )}
            </div>

            {/* ── La tira de todos ── */}
            <div ref={tira} className="shrink-0 flex gap-2 overflow-x-auto px-5 py-3 border-t border-border [scrollbar-width:thin]">
                {resultados.map((x, j) => (
                    <button key={x.id} data-i={j} type="button" onClick={() => alElegir(j)} aria-pressed={j === i} title={`${j + 1} · ${x.camara} · ${horaSeg(x.primeraVez)}`}
                        className={cn("relative shrink-0 w-[96px] aspect-video rounded-[8px] overflow-hidden bg-black transition-[opacity,box-shadow]", j === i ? "ring-2 ring-[var(--accion)] ring-offset-2 ring-offset-background" : "opacity-60 hover:opacity-100")}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {x.recorte && <img src={img(x.recorte, 160)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                        <span className="absolute left-1 top-1 px-1 rounded-[4px] bg-black/70 text-white text-[9.5px] font-bold tabular-nums">{j + 1}</span>
                        {chapas[x.id] && <span className="absolute inset-x-1 bottom-1 truncate text-center px-1 rounded-[3px] bg-white/90 text-black text-[9px] font-bold tracking-wide">{chapas[x.id]!.texto}</span>}
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

/** Un grupo de resultados con la misma chapa (tolerando la confusión del OCR). */
type GrupoChapa = { chapa: string; ids: string[]; coincide: boolean };

function agruparPorChapa(resultados: Resultado[], chapas: Record<string, Chapa | null>, chapaEvento: string | null): GrupoChapa[] {
    const grupos: (GrupoChapa & { conf: number })[] = [];
    for (const r of resultados) {
        const c = chapas[r.id]; if (!c) continue;
        const g = grupos.find((x) => mismaChapa(x.chapa, c.texto));
        if (g) { g.ids.push(r.id); if (c.confianza > g.conf) { g.chapa = c.texto; g.conf = c.confianza; } }
        else grupos.push({ chapa: c.texto, ids: [r.id], conf: c.confianza, coincide: false });
    }
    for (const g of grupos) g.coincide = !!chapaEvento && mismaChapa(g.chapa, chapaEvento);
    // Primero la del evento, después las que más se repiten.
    return grupos.sort((a, b) => Number(b.coincide) - Number(a.coincide) || b.ids.length - a.ids.length).map(({ conf, ...g }) => g);
}

/** La chapa dibujada como chapa: blanca, tinta negra, cifras parejas. Va sobre foto o sobre el panel. */
function PlacaChapa({ texto, grande }: { texto: string; grande?: boolean }) {
    return (
        <span className={cn("inline-flex items-center rounded-[4px] bg-white text-black font-bold tabular-nums tracking-[0.06em] ring-1 ring-black/15",
            grande ? "h-7 px-2.5 text-[14px]" : "h-[18px] px-1.5 text-[10.5px]")}>{texto}</span>
    );
}

/**
 * Las chapas que aparecieron en los resultados, arriba de la grilla: cuántas veces está cada una
 * y, si la búsqueda salió de un evento con chapa, cuál es el mismo vehículo. Tocar una filtra.
 */
function FranjaChapas({ grupos, leyendo, filtro, onFiltro, chapaEvento }: {
    grupos: GrupoChapa[]; leyendo: boolean; filtro: string | null; onFiltro: (c: string | null) => void; chapaEvento: string | null;
}) {
    if (!grupos.length && !leyendo) return null;
    const mismo = grupos.find((g) => g.coincide);
    return (
        <div className="space-y-2">
            <div className={ROTULO}>Chapas en los resultados</div>
            <div className="flex flex-wrap items-center gap-1.5">
            {chapaEvento && !leyendo && grupos.length > 0 && !mismo && (
                <span className="h-7 px-2.5 rounded-full chip-quieto text-[11.5px] font-semibold inline-flex items-center">Ninguna es {chapaEvento}</span>
            )}
            {grupos.map((g) => {
                const sel = filtro === g.chapa;
                return (
                    <button key={g.chapa} type="button" onClick={() => onFiltro(sel ? null : g.chapa)} aria-pressed={sel}
                        title={g.coincide ? "La misma chapa del evento: es el mismo vehículo" : `Mostrar sólo ${g.chapa}`}
                        className={cn("h-7 pl-1 pr-2.5 rounded-full border text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                            sel ? "border-foreground bg-foreground text-background" : g.coincide ? "border-[var(--bien)]/50 bg-[var(--bien)]/10 text-foreground hover:bg-[var(--bien)]/15" : "border-border text-foreground/85 hover:bg-muted")}>
                        <PlacaChapa texto={g.chapa} />
                        {g.coincide && <Check size={12} strokeWidth={3} className="tono-bien" />}
                        <span className="tabular-nums text-muted-foreground">{g.ids.length > 1 ? `×${g.ids.length}` : ""}</span>
                    </button>
                );
            })}
            {leyendo && <span className="h-7 px-2 inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Leyendo chapas…</span>}
            {filtro && <button type="button" onClick={() => onFiltro(null)} className="h-7 px-2 text-[11.5px] font-semibold text-[var(--accion)] hover:underline">Ver todos</button>}
            </div>
        </div>
    );
}

/**
 * Una miniatura de resultado: la foto a sangre, sin marco ni pie (18/10, Nico: «sin marcos, con
 * controles y datos overlay»). Encima: el número y qué tan parecido arriba, la chapa, la cámara y
 * la hora abajo, y al pasar el mouse los controles para ir directo a la grabación o a compartir.
 * La barrita de parecido queda pegada al borde de abajo.
 */
function Miniatura({ r, i, rel, chapa, leyendo, chapaEvento, onAbrir }: {
    r: Resultado; i: number; rel: number; chapa: Chapa | null | undefined; leyendo: boolean; chapaEvento: string | null; onAbrir: (m: Apertura) => void;
}) {
    const I = ICONO_GRUPO[r.grupo] || Scan;
    const p = parecido(rel);
    const coincide = chapa && chapaEvento ? mismaChapa(chapa.texto, chapaEvento) : false;
    const control = "w-7 h-7 rounded-full grid place-items-center bg-black/55 backdrop-blur-md border border-white/20 text-white/90 hover:text-white hover:bg-black/75 transition-colors";
    const parar = (m: Apertura) => (e: React.MouseEvent) => { e.stopPropagation(); onAbrir(m); };
    return (
        <div role="button" tabIndex={0} onClick={() => onAbrir("foto")} onKeyDown={(e) => { if (e.key === "Enter") onAbrir("foto"); }}
            title={`${i + 1} · ${nombreClase(r.clase)} · ${r.camara} · ${horaSeg(r.primeraVez)}`}
            className={cn("group relative aspect-[4/3] rounded-[10px] overflow-hidden bg-black cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                coincide && "ring-2 ring-[var(--bien)]")}>
            {/* La foto entra con el marco que se afina (components/ui/marco-refinado): mientras llega, la
                tarjeta ya ocupa su lugar y dice en qué está; no salta la grilla. */}
            <MarcoRefinado src={r.recorte ? img(r.recorte, 320) : null} etapa={r.recorte ? undefined : "error"} retardo={i}
                className="absolute inset-0" imgClassName="group-hover:scale-[1.05] group-hover:duration-500" />
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_bottom,rgba(0,0,0,.45)_0%,transparent_32%,transparent_48%,rgba(0,0,0,.85)_100%)]" />

            <div className="absolute left-2 right-2 top-2 flex items-center gap-1.5">
                <span className="h-5 min-w-5 px-1.5 rounded-full bg-black/55 backdrop-blur-md text-white text-[10.5px] font-bold tabular-nums grid place-items-center">{i + 1}</span>
                <span className={cn("h-5 px-2 rounded-full text-[10px] font-bold inline-flex items-center", `pleno-${p.tono}`)}>{p.texto}</span>
            </div>
            {/* Los controles, abajo a la derecha al pasar el mouse: arriba a la derecha de la grilla va la cruz. */}
            <span className="absolute right-2 bottom-3 z-[2] flex items-center gap-1 opacity-0 translate-y-[2px] group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 transition-[opacity,transform] duration-150">
                {r.deviceId && <button type="button" onClick={parar("grabacion")} title="Ver la grabación de ese momento" aria-label="Ver la grabación" className={control}><PlayCircle size={14} /></button>}
                {r.foto && <button type="button" onClick={parar("compartir")} title="Compartir por WhatsApp o Telegram" aria-label="Compartir" className={control}><Share2 size={13} /></button>}
                <button type="button" onClick={parar("foto")} title="Abrir la ficha" aria-label="Abrir" className={control}><Maximize2 size={13} /></button>
            </span>

            <div className="absolute left-2 right-2 group-hover:right-[100px] group-focus-within:right-[100px] transition-[right] duration-150 bottom-2.5 text-white pointer-events-none">
                {(chapa || leyendo) && (
                    <div className="mb-1 flex items-center gap-1">
                        {chapa ? <PlacaChapa texto={chapa.texto} /> : <span className="h-[18px] px-1.5 rounded-[4px] bg-white/20 text-white/70 text-[9.5px] font-semibold inline-flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> chapa</span>}
                        {coincide && <span className="h-[18px] px-1.5 rounded-full pleno-bien text-[9.5px] font-bold inline-flex items-center gap-0.5"><Check size={10} strokeWidth={3} /> mismo</span>}
                    </div>
                )}
                <div className="flex items-center gap-1 text-[11.5px] font-semibold truncate [text-shadow:0_1px_6px_rgba(0,0,0,.6)]"><I size={11} className="shrink-0 opacity-80" /> <span className="truncate">{r.camara}</span></div>
                <div className="text-[10.5px] text-white/75 tabular-nums">{fechaCorta(r.primeraVez)} {horaSeg(r.primeraVez)}</div>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10 pointer-events-none" title={`coseno ${r.coseno}`}>
                <div className="h-full bg-[var(--accion-en-oscuro)]" style={{ width: `${Math.max(8, rel * 100)}%` }} />
            </div>
        </div>
    );
}
