"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Boxes, Camera, ChevronDown, ChevronRight, ImagePlus, Info, Loader2, Pencil, Plus, ScanEye, Video, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { CAJAS_META, CAJAS_MINIMO, LARGO_NOMBRE, type Caja, type ClaseResumen, type FotoFila } from "@/lib/detector-propio";
import { DibujoMovil, COLORES_CLASE } from "@/components/entrenador/DibujoMovil";
import { EscenaMovil, type ZonaMovil } from "@/components/entrenador/EscenaMovil";
import { GuiaDibujo } from "@/components/vision/entrenar/GuiaDibujo";

/**
 * El Entrenador, en el celular (PWA).
 *
 * Enseñarle a OmniVision se hace mejor parado frente a la cosa: caminar hasta el contenedor,
 * sacarle fotos de día y de noche, de cerca y de lejos, y dibujar el recuadro con el dedo en la
 * foto recién sacada. En la compu eso era sacar las fotos, bajarlas, subirlas y dibujar con el
 * mouse. Acá es una pantalla.
 *
 * Dos cosas, las mismas del panel y sobre los mismos datos (no hay un conjunto «del celular»):
 *   - **Objetos**: las clases del detector propio, fotos (cámara del teléfono, galería o una
 *     cámara del barrio) y el recuadro con el dedo.
 *   - **Escenas**: las zonas entrenables; se etiqueta cada muestra con dos botones grandes.
 *
 * El entrenamiento del detector se pide desde el panel (frena OmniVision un rato y se elige
 * cuándo); el de una escena es instantáneo y se puede hacer desde acá.
 */
type Estado = { clases: ClaseResumen[]; fotos: { total: number; revisadas: number; sinRevisar: number; negativas: number }; falta: string[] };
type Pantalla = "inicio" | "objetos" | "escenas";
const VOLVER = "/pwa/entrenador";
/** Lado mayor con que se sube una foto del teléfono: el servidor guarda hasta 1920 igual (LADO_MAX), y así no se suben 8 MB por datos móviles. */
const LADO_SUBIDA = 1920;
const CALIDAD_SUBIDA = 0.88;

class SinSesion extends Error { }
async function pedir(url: string, init?: RequestInit) {
    const r = await fetch(url, { cache: "no-store", ...init });
    if (r.status === 401) throw new SinSesion("Sin sesión");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
    return j;
}

/** Achica la foto en el teléfono antes de subirla (respeta la orientación de la cámara). */
async function achicar(f: File): Promise<Blob> {
    try {
        const bmp = await createImageBitmap(f);
        const k = Math.min(1, LADO_SUBIDA / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        return await new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("sin blob"))), "image/jpeg", CALIDAD_SUBIDA));
    } catch { return f; }
}

export default function Entrenador() {
    const [pantalla, setPantalla] = useState<Pantalla>("inicio");
    const [estado, setEstado] = useState<Estado | null>(null);
    const [zonas, setZonas] = useState<ZonaMovil[] | null>(null);
    const [zona, setZona] = useState<ZonaMovil | null>(null);
    const [camaras, setCamaras] = useState<{ id: string; name: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [dibujo, setDibujo] = useState<{ fotos: FotoFila[]; i: number; nueva: boolean } | null>(null);
    const [subiendo, setSubiendo] = useState<string | null>(null);
    const [elegirCamara, setElegirCamara] = useState(false);
    const [guia, setGuia] = useState(false);
    const [nueva, setNueva] = useState("");
    const camaraTel = useRef<HTMLInputElement>(null);
    const galeria = useRef<HTMLInputElement>(null);

    const manejar = useCallback((e: any) => {
        if (e instanceof SinSesion) { window.location.href = `/login?volver=${encodeURIComponent(VOLVER)}`; return; }
        setError(e?.message || "No se pudo leer");
    }, []);
    const cargar = useCallback(async () => {
        try {
            const [e, z] = await Promise.all([pedir("/api/vision/objetos"), pedir("/api/vision/zonas")]);
            setEstado(e); setZonas(z.zonas || []); setError(null);
        } catch (x) { manejar(x); }
    }, [manejar]);
    useEffect(() => {
        cargar();
        pedir("/api/vision/estado").then((j) => setCamaras(j?.camaras || [])).catch(() => { });
        if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });
    }, [cargar]);

    // El botón «atrás» del teléfono vuelve de pantalla en pantalla en vez de salir de la app.
    useEffect(() => {
        const atras = () => {
            if (dibujo) { setDibujo(null); cargar(); }
            else if (zona) { setZona(null); cargar(); }
            else if (pantalla !== "inicio") setPantalla("inicio");
        };
        window.addEventListener("popstate", atras);
        return () => window.removeEventListener("popstate", atras);
    }, [dibujo, zona, pantalla, cargar]);
    const ir = (p: Pantalla) => { history.pushState(null, ""); setPantalla(p); window.scrollTo(0, 0); };

    async function subir(lista: FileList | null) {
        const fs = [...(lista || [])].filter((f) => f.type.startsWith("image/"));
        if (!fs.length) return;
        const nuevas: FotoFila[] = [];
        for (const [k, f] of fs.entries()) {
            setSubiendo(fs.length > 1 ? `Subiendo ${k + 1} de ${fs.length}…` : "Subiendo la foto…");
            try {
                const b = await achicar(f);
                const j = await pedir("/api/vision/objetos/fotos", { method: "POST", body: b, headers: { "content-type": b.type || "image/jpeg" } });
                nuevas.push(j.foto);
            } catch (x: any) { if (x instanceof SinSesion) return manejar(x); toast.error({ title: "Una foto no se subió", description: x?.message }); }
        }
        setSubiendo(null);
        if (nuevas.length) { history.pushState(null, ""); setDibujo({ fotos: nuevas, i: 0, nueva: true }); }
    }
    async function deCamara(id: string) {
        setElegirCamara(false);
        setSubiendo("Pidiendo el cuadro a la cámara…");
        try { const j = await pedir(`/api/vision/objetos/fotos?camara=${encodeURIComponent(id)}`, { method: "POST" }); history.pushState(null, ""); setDibujo({ fotos: [j.foto], i: 0, nueva: true }); }
        catch (x: any) { if (x instanceof SinSesion) return manejar(x); toast.error({ title: "No se sacó la foto", description: x?.message }); }
        finally { setSubiendo(null); }
    }
    async function pendientes() {
        try { const j = await pedir("/api/vision/objetos/fotos?vista=sin"); if (j.fotos?.length) { history.pushState(null, ""); setDibujo({ fotos: j.fotos, i: 0, nueva: false }); } }
        catch (x) { manejar(x); }
    }
    async function crearClase() {
        if (!nueva.trim()) return;
        try { await pedir("/api/vision/objetos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nombre: nueva.trim(), descripcion: "" }) }); setNueva(""); await cargar(); }
        catch (x: any) { toast.error({ title: "No se creó", description: x?.message }); }
    }
    const siguiente = () => {
        if (!dibujo) return;
        if (dibujo.i + 1 < dibujo.fotos.length) setDibujo({ ...dibujo, i: dibujo.i + 1 });
        else history.back();   // cierra el dibujo por el mismo camino que el botón «atrás» (popstate)
    };
    const guardar = async (cajas: Caja[]) => {
        const f = dibujo!.fotos[dibujo!.i];
        try {
            await pedir(`/api/vision/objetos/fotos/${f.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cajas, revisada: true }) });
            toast.success({ title: cajas.length ? `Guardada · ${cajas.length} ${cajas.length === 1 ? "recuadro" : "recuadros"}` : "Guardada como «no hay ninguno»" });
            siguiente();
            return true;
        } catch (x: any) { toast.error({ title: "No se guardó", description: x?.message }); return false; }
    };
    const descartar = async () => {
        const f = dibujo!.fotos[dibujo!.i];
        try { await pedir(`/api/vision/objetos/fotos/${f.id}`, { method: "DELETE" }); siguiente(); return true; }
        catch (x: any) { toast.error({ title: "No se descartó", description: x?.message }); return false; }
    };

    const contenedor = "min-h-[100dvh] bg-background text-foreground";
    const relleno = { paddingTop: "max(env(safe-area-inset-top), 12px)" } as const;

    if (!estado) {
        return (
            <div className={cn(contenedor, "grid place-items-center p-6 text-center")} style={relleno}>
                {error ? (
                    <div className="space-y-3">
                        <p className="text-[14px]">{error}</p>
                        <button type="button" onClick={cargar} className="h-11 px-5 rounded-xl bg-[var(--accion)] text-white font-semibold">Reintentar</button>
                    </div>
                ) : <Loader2 className="animate-spin text-muted-foreground" />}
            </div>
        );
    }

    const conMinimo = estado.clases.filter((c) => c.cajas >= CAJAS_MINIMO).length;

    return (
        <div className={contenedor} style={relleno}>
            <div className="max-w-[560px] mx-auto px-4 pb-36 space-y-4">
                {/* Encabezado */}
                <div className="flex items-center gap-3 pt-1">
                    {pantalla !== "inicio" && !zona && (
                        <button type="button" onClick={() => history.back()} aria-label="Volver" className="h-10 w-10 grid place-items-center rounded-full border border-border"><ArrowLeft size={18} /></button>
                    )}
                    {pantalla === "inicio" && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src="/iconos/entrenador-192.png" alt="" className="h-10 w-10 rounded-[10px]" />
                    )}
                    {!zona && (
                        <div className="min-w-0">
                            <h1 className="text-[18px] font-bold leading-tight">{pantalla === "objetos" ? "Objetos nuevos" : pantalla === "escenas" ? "Escenas" : "Entrenador"}</h1>
                            <p className="text-[12px] text-muted-foreground leading-snug">
                                {pantalla === "objetos" ? "Fotos con un recuadro sobre cada objeto." : pantalla === "escenas" ? "Cómo se ve un lugar en cada estado." : "Enseñarle a OmniVision, desde el celular."}
                            </p>
                        </div>
                    )}
                </div>

                {/* ── Inicio: las dos cosas que se enseñan ── */}
                {pantalla === "inicio" && (
                    <>
                        <button type="button" onClick={() => ir("objetos")} className="w-full text-left rounded-[14px] border border-border bg-card p-4 flex gap-3 active:bg-accent">
                            <span className="h-11 w-11 shrink-0 grid place-items-center rounded-[10px] bg-foreground text-background"><Boxes size={20} /></span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[15px] font-bold">Objetos nuevos</span>
                                <span className="block text-[12.5px] text-muted-foreground leading-snug">Cosas que el detector no conoce: un contenedor, un cono. Sacás fotos y dibujás un recuadro sobre cada uno.</span>
                                <span className="block text-[12px] mt-1.5 tabular-nums">
                                    {estado.clases.length ? `${estado.clases.length} ${estado.clases.length === 1 ? "clase" : "clases"} · ${conMinimo} lista${conMinimo === 1 ? "" : "s"} para entrenar` : "Todavía no hay clases"}
                                    {estado.fotos.sinRevisar ? <span className="tono-aviso font-semibold"> · {estado.fotos.sinRevisar} sin dibujar</span> : null}
                                </span>
                            </span>
                            <ChevronRight className="self-center text-muted-foreground" size={18} />
                        </button>
                        <button type="button" onClick={() => ir("escenas")} className="w-full text-left rounded-[14px] border border-border bg-card p-4 flex gap-3 active:bg-accent">
                            <span className="h-11 w-11 shrink-0 grid place-items-center rounded-[10px] bg-foreground text-background"><ScanEye size={20} /></span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[15px] font-bold">Escenas</span>
                                <span className="block text-[12.5px] text-muted-foreground leading-snug">Cómo está un lugar: contenedor lleno o normal, portón abierto o cerrado. Decís cuál es en cada foto.</span>
                                <span className="block text-[12px] mt-1.5 tabular-nums">{zonas?.length ? `${zonas.length} ${zonas.length === 1 ? "zona" : "zonas"}` : "Las zonas se crean en el panel"}</span>
                            </span>
                            <ChevronRight className="self-center text-muted-foreground" size={18} />
                        </button>
                        <div className="rounded-[14px] border border-border p-4 text-[12.5px] text-muted-foreground leading-snug space-y-1.5">
                            <div className="flex items-center gap-1.5 text-foreground font-bold text-[13px]"><Info size={14} /> ¿Objeto o escena?</div>
                            <p><b className="text-foreground">Objeto</b>: una cosa que aparece en cualquier lugar y se encierra en un recuadro. Todas las clases forman un solo detector.</p>
                            <p><b className="text-foreground">Escena</b>: un lugar fijo de una cámara que cambia de estado. No se dibuja: se elige el estado.</p>
                        </div>
                    </>
                )}

                {/* ── Objetos ── */}
                {pantalla === "objetos" && (
                    <>
                        <button type="button" onClick={() => setGuia(!guia)} className="w-full flex items-center gap-2 rounded-[12px] border border-border px-3.5 py-3 text-left">
                            <Pencil size={15} className="text-muted-foreground" />
                            <span className="flex-1 text-[13.5px] font-bold">Cómo dibujar bien</span>
                            <ChevronDown size={16} className={cn("text-muted-foreground transition-transform", guia && "rotate-180")} />
                        </button>
                        {guia && <GuiaDibujo abierta alCambiar={setGuia} />}

                        <div className="space-y-1.5">
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Clases · un solo detector las aprende juntas</div>
                            <div className="rounded-[12px] border border-border bg-card divide-y divide-border">
                                {estado.clases.map((c, k) => (
                                    <div key={c.id} className="px-3.5 py-3 flex items-center gap-3">
                                        <span className="h-3 w-3 rounded-full shrink-0" style={{ background: COLORES_CLASE[k % COLORES_CLASE.length] }} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-[14px] font-bold truncate">{c.nombre}</span>
                                                <span className={cn("text-[11.5px] tabular-nums whitespace-nowrap", c.cajas >= CAJAS_MINIMO ? "tono-bien font-semibold" : "text-muted-foreground")}>
                                                    {c.cajas >= CAJAS_MINIMO ? `${c.cajas} · lista` : `faltan ${CAJAS_MINIMO - c.cajas}`}
                                                </span>
                                            </div>
                                            <div className="mt-1.5 relative h-1.5 rounded-full bg-muted overflow-hidden">
                                                <span className={cn("absolute inset-y-0 left-0 rounded-full", c.cajas >= CAJAS_MINIMO ? "bg-[var(--bien)]" : "bg-[var(--accion)]")} style={{ width: `${Math.max(Math.min(1, c.cajas / CAJAS_META) * 100, c.cajas ? 2 : 0)}%` }} />
                                                <span className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ left: `${(CAJAS_MINIMO / CAJAS_META) * 100}%` }} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <form onSubmit={(e) => { e.preventDefault(); crearClase(); }} className="px-3.5 py-2.5 flex items-center gap-2">
                                    <Plus size={16} className="text-muted-foreground shrink-0" />
                                    <input value={nueva} onChange={(e) => setNueva(e.target.value)} maxLength={LARGO_NOMBRE} placeholder={estado.clases.length ? "Otra clase" : "La primera clase: «Contenedor»"}
                                        className="flex-1 min-w-0 h-10 bg-transparent outline-none text-[14px]" />
                                    {nueva.trim() && <button type="submit" className="h-9 px-3 rounded-lg bg-[var(--accion)] text-white text-[13px] font-semibold">Agregar</button>}
                                </form>
                            </div>
                            <p className="text-[11.5px] text-muted-foreground leading-snug">
                                Cada clase necesita {CAJAS_MINIMO} recuadros para entrenar. Sumá también fotos del lugar sin ningún objeto («No hay ninguno»): {estado.fotos.negativas} hasta ahora.
                            </p>
                        </div>

                        {estado.fotos.sinRevisar > 0 && (
                            <button type="button" onClick={pendientes} className="w-full h-12 rounded-xl border border-border text-[14px] font-semibold inline-flex items-center justify-center gap-2">
                                <Pencil size={16} /> Dibujar las {estado.fotos.sinRevisar} pendientes
                            </button>
                        )}
                        {!estado.clases.length && <p className="text-[12.5px] text-muted-foreground text-center">Creá una clase para empezar a sacar fotos.</p>}
                    </>
                )}

                {/* ── Escenas ── */}
                {pantalla === "escenas" && !zona && (
                    zonas?.length ? (
                        <div className="space-y-2">
                            {zonas.map((z) => (
                                <button key={z.id} type="button" onClick={() => { history.pushState(null, ""); setZona(z); }} className="w-full text-left rounded-[12px] border border-border bg-card p-3.5 flex items-center gap-3 active:bg-accent">
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[14px] font-bold truncate">{z.nombre}</span>
                                        <span className="block text-[12px] text-muted-foreground truncate">{z.camara}</span>
                                        <span className="block text-[12px] mt-1 tabular-nums"><span className="tono-aviso font-semibold">{z.positivo} {z.conteo.pos}</span> · <span className="tono-bien font-semibold">{z.negativo} {z.conteo.neg}</span>{z.conteo.sin ? <span className="text-muted-foreground"> · {z.conteo.sin} sin etiquetar</span> : null}</span>
                                    </span>
                                    <ChevronRight size={18} className="text-muted-foreground" />
                                </button>
                            ))}
                        </div>
                    ) : <p className="text-[13px] text-muted-foreground text-center py-8">No hay zonas entrenables. Se crean en el panel: OmniVision › Entrenar › Nueva zona.</p>
                )}
                {pantalla === "escenas" && zona && <EscenaMovil zona={zona} alVolver={() => history.back()} />}
            </div>

            {/* Barra de abajo (objetos): sacar, galería, cámara del barrio. Al alcance del pulgar. */}
            {pantalla === "objetos" && estado.clases.length > 0 && (
                <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}>
                    <div className="max-w-[560px] mx-auto grid grid-cols-[1fr_auto_auto] gap-2">
                        <button type="button" onClick={() => camaraTel.current?.click()} disabled={!!subiendo}
                            className="h-14 rounded-xl bg-[var(--accion)] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60">
                            {subiendo ? <><Loader2 size={18} className="animate-spin" /> <span className="text-[13px]">{subiendo}</span></> : <><Camera size={20} /> Sacar foto</>}
                        </button>
                        <button type="button" onClick={() => galeria.current?.click()} disabled={!!subiendo} aria-label="Elegir de la galería"
                            className="h-14 w-14 rounded-xl border border-border grid place-items-center disabled:opacity-50"><ImagePlus size={20} /></button>
                        <button type="button" onClick={() => setElegirCamara(true)} disabled={!!subiendo || !camaras.length} aria-label="Foto de una cámara del barrio"
                            className="h-14 w-14 rounded-xl border border-border grid place-items-center disabled:opacity-50"><Video size={20} /></button>
                    </div>
                    <input ref={camaraTel} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
                    <input ref={galeria} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
                </div>
            )}

            {/* Elegir una cámara del barrio: hoja desde abajo. */}
            {elegirCamara && (
                <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setElegirCamara(false)}>
                    <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-auto rounded-t-[16px] bg-background p-4 space-y-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <div className="text-[15px] font-bold">Foto de una cámara</div>
                            <button type="button" onClick={() => setElegirCamara(false)} aria-label="Cerrar" className="h-9 w-9 grid place-items-center rounded-full border border-border"><X size={16} /></button>
                        </div>
                        <p className="text-[12px] text-muted-foreground">Toma el cuadro de este momento en máxima resolución. Volvé a sacar a otra hora: de día, de tarde y de noche.</p>
                        {camaras.map((c) => (
                            <button key={c.id} type="button" onClick={() => deCamara(c.id)} className="w-full h-12 px-3 rounded-xl border border-border text-left text-[14px] font-semibold flex items-center gap-2 active:bg-accent">
                                <Video size={16} className="text-muted-foreground" /> <span className="truncate">{c.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {dibujo && estado && (
                <DibujoMovil foto={dibujo.fotos[dibujo.i]} clases={estado.clases}
                    posicion={dibujo.fotos.length > 1 ? `${dibujo.i + 1} de ${dibujo.fotos.length}` : undefined}
                    alGuardar={guardar} alDescartar={descartar} alCerrar={() => history.back()} />
            )}
        </div>
    );
}
