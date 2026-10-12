"use client";

/**
 * Ajustes › Video del evento › Logo en los clips: el logo de Sildan sobre la foto de una
 * alerta y sobre el clip que se exporta para mandar. Se elige si va y en qué lugar del cuadro
 * (global para todo el barrio). Las descargas de evidencia no lo llevan. Se muestra cómo
 * queda, no se describe.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Info, Check, Upload, Trash2, Play, Palette, ImageIcon } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { sileo as toast } from "sileo";
import { Switch } from "@/components/ui/switch";
import { getSetting, updateSetting } from "@/app/actions/settings";
import {
    AJUSTE_MARCA_AGUA, ARCHIVO_MARCA_AGUA, AJUSTE_MARCA_POSICION, POSICIONES_MARCA, POSICION_MARCA_DEFECTO,
    ROTULO_POSICION, esPosicionMarca, type PosicionMarca,
} from "@/lib/clips";
import { cn } from "@/lib/utils";

/** Clases de ubicación del logo en la vista previa (mismo criterio que el overlay de ffmpeg). */
const LUGAR: Record<PosicionMarca, string> = {
    "sup-izq": "left-[3%] top-[5%]", "sup-centro": "left-1/2 -translate-x-1/2 top-[5%]", "sup-der": "right-[3%] top-[5%]",
    "centro-izq": "left-[3%] top-1/2 -translate-y-1/2", "centro": "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2", "centro-der": "right-[3%] top-1/2 -translate-y-1/2",
    "inf-izq": "left-[3%] bottom-[5%]", "inf-centro": "left-1/2 -translate-x-1/2 bottom-[5%]", "inf-der": "right-[3%] bottom-[5%]",
};

export default function MarcaAgua() {
    const [on, setOn] = useState(true);
    const [pos, setPos] = useState<PosicionMarca>(POSICION_MARCA_DEFECTO);
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    /* La intro animada de los clips exportados (lib/intro-clip). La clave va escrita acá: el
       módulo del servidor no se importa desde una pantalla del navegador. */
    const [intro, setIntro] = useState(true);
    const [vuelta, setVuelta] = useState(0);
    const [color, setColor] = useState("#0ea5e9");
    const [logoV, setLogoV] = useState(0);          // fuerza a recargar la imagen del logo
    const [hayLogoIntro, setHayLogoIntro] = useState(false);
    const [subiendo, setSubiendo] = useState(false);
    const [muestra, setMuestra] = useState<string | null>(null);
    const [armando, setArmando] = useState(false);
    const archivoRef = useRef<HTMLInputElement>(null);
    useEffect(() => { fetch(`/api/clip/intro-logo?v=${logoV}`, { cache: "no-store" }).then((r) => setHayLogoIntro(r.ok)).catch(() => setHayLogoIntro(false)); }, [logoV]);

    useEffect(() => {
        Promise.all([getSetting(AJUSTE_MARCA_AGUA), getSetting(AJUSTE_MARCA_POSICION), getSetting("CLIP_INTRO"), getSetting("CLIP_INTRO_COLOR")])
            .then(([a, p, i, c]: any[]) => { setOn(a?.value !== "false"); if (esPosicionMarca(p?.value)) setPos(p.value); setIntro(i?.value !== "false"); if (/^#[0-9a-fA-F]{6}$/.test(c?.value || "")) setColor(c.value); })
            .catch(() => { }).finally(() => setCargando(false));
    }, []);

    const cambiar = async (v: boolean) => {
        setOn(v); setGuardando(true);
        try { await updateSetting(AJUSTE_MARCA_AGUA, v ? "true" : "false"); toast.success({ title: v ? "Logo activado" : "Logo desactivado" }); }
        catch (e: any) { setOn(!v); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    const cambiarIntro = async (v: boolean) => {
        setIntro(v); setGuardando(true);
        try { await updateSetting("CLIP_INTRO", v ? "true" : "false"); toast.success({ title: v ? "Intro animada activada" : "Intro animada desactivada" }); }
        catch (e: any) { setIntro(!v); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    const elegirColor = async (c: string) => {
        setColor(c);
        try { await updateSetting("CLIP_INTRO_COLOR", c); } catch (e: any) { toast.error({ title: "No se pudo guardar el color", description: e?.message }); }
    };
    const subirLogo = async (f: File) => {
        setSubiendo(true);
        try {
            const fd = new FormData(); fd.append("archivo", f);
            const r = await fetch("/api/clip/intro-logo", { method: "POST", body: fd }).then((x) => x.json());
            if (!r.ok) throw new Error(r.error);
            toast.success({ title: "Logo de la intro actualizado" }); setLogoV((v) => v + 1); setMuestra(null);
        } catch (e: any) { toast.error({ title: "No se pudo subir el logo", description: e?.message }); }
        finally { setSubiendo(false); if (archivoRef.current) archivoRef.current.value = ""; }
    };
    const quitarLogo = async () => {
        await fetch("/api/clip/intro-logo", { method: "DELETE" }).catch(() => null);
        toast.success({ title: "Logo de la intro quitado", description: "Vuelve a usar el logo de la marca de agua." }); setLogoV((v) => v + 1); setMuestra(null);
    };
    const verMuestra = async () => {
        setArmando(true);
        try {
            const r = await fetch(`/api/clip/intro-prueba?color=${encodeURIComponent(color)}`, { cache: "no-store" });
            if (!r.ok) throw new Error(await r.text());
            const b = await r.blob(); if (muestra) URL.revokeObjectURL(muestra); setMuestra(URL.createObjectURL(b));
        } catch (e: any) { toast.error({ title: "No se pudo armar la muestra", description: e?.message }); }
        finally { setArmando(false); }
    };
    const ubicar = async (p: PosicionMarca) => {
        if (p === pos) return;
        const antes = pos; setPos(p); setGuardando(true);
        try { await updateSetting(AJUSTE_MARCA_POSICION, p); toast.success({ title: "Posición del logo guardada", description: ROTULO_POSICION[p] }); }
        catch (e: any) { setPos(antes); toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    return (
        <div className="rounded-[10px] border border-border bg-card p-5 max-w-xl space-y-5">
            <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-foreground">Logo en los clips y fotos que se mandan</div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">La foto de cada alerta y el clip exportado desde la grabación llevan el logo de Sildan. Las descargas de evidencia salen sin logo, tal cual las entrega el grabador.</p>
                </div>
                {cargando ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : <Switch checked={on} onCheckedChange={cambiar} disabled={guardando} aria-label="Logo en los clips" />}
            </div>

            <div className={cn("space-y-3 transition-opacity", !on && "opacity-50 pointer-events-none")}>
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85">
                    Posición en el cuadro
                    <span data-tooltip-id="tt-marca" data-tooltip-content="Es global: vale para todos los clips exportados y las fotos de alerta. Ej.: si la fecha del NVR está abajo a la derecha, conviene «Arriba a la derecha» para no taparla." className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span>
                    <span className="ml-auto text-[11.5px] font-normal text-muted-foreground">{ROTULO_POSICION[pos]}</span>
                </div>
                <div className="grid grid-cols-[1fr_132px] gap-4 items-center">
                    {/* Vista previa 16:9 con el logo donde va a salir */}
                    <div className="relative aspect-video rounded-[8px] border border-border overflow-hidden bg-[linear-gradient(135deg,#1f2a1f,#3a4a36_55%,#5b6b56)]">
                        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.35))]" />
                        <span className="absolute left-[3%] top-[4%] text-[9px] font-mono text-white/70">2026-10-11 19:25:21</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/${ARCHIVO_MARCA_AGUA}`} alt="" className={cn("absolute w-[18%] transition-all duration-300", LUGAR[pos])} />
                    </div>
                    {/* Selector 3x3 */}
                    <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-[8px] border border-border bg-muted/40 aspect-video">
                        {POSICIONES_MARCA.map((p) => (
                            <button key={p} type="button" onClick={() => ubicar(p)} disabled={guardando} aria-label={ROTULO_POSICION[p]}
                                data-tooltip-id="tt-marca" data-tooltip-content={ROTULO_POSICION[p]}
                                className={cn("rounded-[5px] grid place-items-center transition-colors border",
                                    pos === p ? "bg-[var(--accion)] border-[var(--accion)] text-white" : "bg-background border-border hover:bg-accent text-transparent hover:text-muted-foreground")}>
                                <Check size={11} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            {/* Intro animada */}
            <div className="pt-5 border-t border-border space-y-3">
                <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-bold text-foreground">Intro animada antes del video</div>
                        <p className="text-[12px] text-muted-foreground mt-0.5">Los clips que se descargan o se mandan por WhatsApp empiezan con una placa clara de 4 s: el logo en el centro, la descripción que escribe el operador y cámara, fecha, hora y matrícula. Después pasa al video.</p>
                    </div>
                    {cargando ? <Loader2 size={16} className="animate-spin text-muted-foreground" /> : <Switch checked={intro} onCheckedChange={cambiarIntro} disabled={guardando} aria-label="Intro animada" />}
                </div>
                <div className={cn("grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-4 transition-opacity", !intro && "opacity-50 pointer-events-none")}>
                    {/* Vista previa: la muestra real (video) o la animación aproximada */}
                    <div className="space-y-2">
                        {muestra ? (
                            <video key={muestra} src={muestra} autoPlay controls playsInline className="w-full aspect-video rounded-[8px] border border-border bg-black" />
                        ) : (
                            <button type="button" onClick={() => setVuelta((v) => v + 1)} data-tooltip-id="tt-marca" data-tooltip-content="Vista previa aproximada: tocá para repetir. «Ver la intro real» arma la de verdad."
                                className="relative w-full aspect-video rounded-[8px] overflow-hidden border border-border text-left"
                                style={{ background: `linear-gradient(135deg, #ffffff 0%, #f1f5f9 55%, color-mix(in oklab, ${color} 14%, white) 100%)` }}>
                                <style>{`@keyframes iLogo{0%{opacity:0;transform:translate(-50%,-50%) scale(.86)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}@keyframes iLinea{0%{width:0}100%{width:16%}}@keyframes iTxt{0%{opacity:0;transform:translate(-50%,8px)}100%{opacity:1;transform:translate(-50%,0)}}@keyframes iRec{0%,60%{opacity:1}61%,100%{opacity:.3}}@keyframes iBar{0%{width:0}100%{width:100%}}@keyframes iB1{0%{transform:translate(0,0)}100%{transform:translate(12%,0)}}`}</style>
                                <div key={vuelta} className="absolute inset-0">
                                    <span className="absolute -left-[20%] -top-[45%] w-[75%] aspect-square rounded-full opacity-50 blur-2xl" style={{ background: color, animation: "iB1 4s linear both" }} />
                                    <span className="absolute left-[60%] top-[40%] w-[75%] aspect-square rounded-full opacity-40 blur-2xl" style={{ background: color, animation: "iB1 4s linear reverse both" }} />
                                    <span className="absolute left-[3%] top-[6%] flex items-center gap-1.5 text-[8px] font-semibold tracking-wider text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500" style={{ animation: "iRec 1s infinite" }} /> REGISTRO DE VIDEO</span>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={hayLogoIntro ? `/api/clip/intro-logo?v=${logoV}` : `/${ARCHIVO_MARCA_AGUA}`} alt="" className="absolute left-1/2 top-[33%] max-w-[30%] max-h-[24%] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,.18)]" style={{ animation: "iLogo .75s .15s both cubic-bezier(.2,.8,.2,1)" }} />
                                    <span className="absolute left-1/2 top-[51%] h-[3px] -translate-x-1/2 rounded-full" style={{ background: color, animation: "iLinea .5s .75s both ease-out" }} />
                                    <span className="absolute left-1/2 top-[57%] text-[13px] font-semibold text-slate-900 whitespace-nowrap" style={{ animation: "iTxt .55s 1s both ease-out" }}>Descripción del clip</span>
                                    <span className="absolute left-1/2 top-[68%] text-[8.5px] text-slate-500 whitespace-nowrap tracking-wide" style={{ animation: "iTxt .5s 1.4s both ease-out" }}>CÁMARA P1 · 12/10/2026 09:41:09 · ABC1234</span>
                                    <span className="absolute left-0 bottom-0 h-[3px]" style={{ background: color, animation: "iBar 4s linear both" }} />
                                </div>
                            </button>
                        )}
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={verMuestra} disabled={armando}
                                className="h-8 px-3 rounded-lg bg-[var(--accion)] text-white text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
                                {armando ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Ver la intro real
                            </button>
                            {muestra && <button type="button" onClick={() => setMuestra(null)} className="h-8 px-3 rounded-lg border border-border text-[12px] hover:bg-accent">Volver a la animación</button>}
                        </div>
                    </div>
                    {/* Logo y color */}
                    <div className="space-y-4">
                        <div>
                            <div className="text-[12px] font-semibold text-foreground/85 mb-1.5 flex items-center gap-1.5"><ImageIcon size={13} /> Logo de la intro
                                <span data-tooltip-id="tt-marca" data-tooltip-content="Puede ser distinto del de la marca de agua: va grande en el centro sobre fondo claro. PNG con fondo transparente, ej. el logo a color de la empresa." className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help"><Info size={12.5} /></span></div>
                            <div className="rounded-[8px] border border-dashed border-border bg-white h-20 grid place-items-center overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={hayLogoIntro ? `/api/clip/intro-logo?v=${logoV}` : `/${ARCHIVO_MARCA_AGUA}`} alt="" className="max-h-16 max-w-[90%] object-contain" />
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1">{hayLogoIntro ? "Logo propio de la intro." : "Usa el logo de la marca de agua."}</p>
                            <div className="flex gap-1.5 mt-1.5">
                                <input ref={archivoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirLogo(f); }} />
                                <button type="button" onClick={() => archivoRef.current?.click()} disabled={subiendo}
                                    className="flex-1 h-8 rounded-lg border border-border text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-accent">{subiendo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir</button>
                                {hayLogoIntro && <button type="button" onClick={quitarLogo} data-tooltip-id="tt-marca" data-tooltip-content="Quitar: vuelve al logo de la marca de agua" className="h-8 w-8 grid place-items-center rounded-lg border border-border text-red-500 hover:bg-red-500/10"><Trash2 size={13} /></button>}
                            </div>
                        </div>
                        <div>
                            <div className="text-[12px] font-semibold text-foreground/85 mb-1.5 flex items-center gap-1.5"><Palette size={13} /> Color de acento</div>
                            <div className="flex flex-wrap gap-1.5">
                                {["#0ea5e9", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#0f172a"].map((c) => (
                                    <button key={c} type="button" onClick={() => elegirColor(c)} aria-label={c}
                                        className={cn("h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-background transition", color === c ? "ring-foreground" : "ring-transparent hover:ring-border")} style={{ background: c }} />
                                ))}
                                <label className="h-7 w-7 rounded-full border border-dashed border-border grid place-items-center cursor-pointer overflow-hidden relative" data-tooltip-id="tt-marca" data-tooltip-content="Otro color">
                                    <input type="color" value={color} onChange={(e) => elegirColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                    <Palette size={12} className="text-muted-foreground" />
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <Tooltip id="tt-marca" place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
        </div>
    );
}
