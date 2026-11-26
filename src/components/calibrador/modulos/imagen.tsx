"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sileo as toast } from "sileo";
import { Wand2, Timer, Signal, Layers, Sun, ShieldCheck, Moon, Focus, Car, Check, X, AlertTriangle, SquareDashed, Aperture, RefreshCw } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";
import type { Forma, Pt } from "@/components/calibrador/Lienzo";
import { BotonPanel, Seccion, Vacio, type Modulo } from "@/components/calibrador/piezas";

/**
 * Módulo «Imagen» del calibrador único (26/11): obturador, ganancia, anti-brillo, WDR, HLC,
 * filtro IR, foco y, en una LPR con ANPR, el modo vía y la región de captura. Es lo que era el
 * calibrador de imagen, con las mismas llamadas (/api/devices/camera-config, auto-calibrate y
 * anpr-region) y la misma regla: cada cambio se confirma y se ve en la imagen.
 *
 * Lo que cambia es el lugar: los controles pasan a una lista en el panel —cada uno con su valor,
 * qué hace y qué va a pasar— en vez de un riel de botones con la explicación al pasar el mouse; y
 * la región ANPR se ajusta sobre la escena con el mismo lienzo que todo lo demás.
 */
type Ctl = { key: string; label: string; icono: typeof Timer; detalle: string; valor: (c: Cfg) => string; activo?: (c: Cfg) => boolean; siguiente: (c: Cfg) => { param: string; value: unknown; human: string }; soloAnpr?: boolean };
type Cfg = Record<string, unknown> & { shutter?: string; gain?: number; overexpose?: boolean; wdr?: string; hlc?: boolean; ircut?: string; focusStyle?: string; anprRoad?: string };
type Region = { lanes: { points: { x: number; y: number }[] }[]; calib: { x: number; y: number }[] };

const OBTURADORES = ["1/250", "1/500", "1/1000"];
const CONTROLES: Ctl[] = [
    { key: "shutter", label: "Obturador", icono: Timer, detalle: "Cuánto se expone el sensor. Más lento entra más luz (mejor de noche); más rápido congela autos veloces pero oscurece. Para chapas, 1/500 a 1/1000.", valor: (c) => c.shutter || "—",
        siguiente: (c) => { const v = OBTURADORES[(OBTURADORES.indexOf(String(c.shutter)) + 1) % OBTURADORES.length] || "1/500"; return { param: "shutter", value: v, human: `Obturador → ${v}` }; } },
    { key: "gain", label: "Ganancia", icono: Signal, detalle: "Amplifica la señal del sensor. Sube el brillo de noche pero mete ruido que arruina la lectura. Tope recomendado: 40.", valor: (c) => String(c.gain ?? "—"),
        siguiente: (c) => { const v = (c.gain ?? 40) >= 40 ? 20 : 40; return { param: "gain", value: v, human: `Ganancia → ${v}` }; } },
    { key: "overexpose", label: "Anti-brillo", icono: ShieldCheck, detalle: "Evita que los faros quemen en blanco la chapa reflectiva. Clave de noche con el auto de frente.", valor: (c) => (c.overexpose ? "Prendido" : "Apagado"), activo: (c) => !!c.overexpose,
        siguiente: (c) => ({ param: "overexpose", value: !c.overexpose, human: `Anti-brillo → ${!c.overexpose ? "prendido" : "apagado"}` }) },
    { key: "wdr", label: "WDR", icono: Layers, detalle: "Equilibra zonas claras y oscuras. Para leer chapas de noche conviene apagado: mete artefactos.", valor: (c) => (c.wdr === "open" ? "Prendido" : "Apagado"), activo: (c) => c.wdr === "open",
        siguiente: (c) => ({ param: "wdr", value: c.wdr !== "open", human: `WDR → ${c.wdr !== "open" ? "prendido" : "apagado"}` }) },
    { key: "hlc", label: "HLC", icono: Sun, detalle: "Apaga los brillos muy fuertes (faros). Prenderlo sólo si un carril tiene reflejo que tapa la chapa.", valor: (c) => (c.hlc ? "Prendido" : "Apagado"), activo: (c) => !!c.hlc,
        siguiente: (c) => ({ param: "hlc", value: !c.hlc, human: `HLC → ${!c.hlc ? "prendido" : "apagado"}` }) },
    { key: "ircut", label: "Filtro IR", icono: Moon, detalle: "En «auto» la cámara pasa a infrarrojo cuando baja la luz: la chapa refleja el IR y se lee aunque la escena esté oscura.", valor: (c) => c.ircut || "—",
        siguiente: (c) => { const v = c.ircut === "auto" ? "night" : "auto"; return { param: "ircut", value: v, human: `Filtro IR → ${v}` }; } },
    { key: "focus", label: "Foco", icono: Focus, detalle: "«Semiautomático» reenfoca al cambiar día y noche sin perseguir cada auto; «manual» lo deja fijo donde quedó la chapa.", valor: (c) => (c.focusStyle || "—").replace("SEMIAUTOMATIC", "Semiautomático").replace("AUTOMATIC", "Automático").replace("MANUAL", "Manual"),
        siguiente: (c) => { const v = c.focusStyle === "SEMIAUTOMATIC" ? "MANUAL" : "SEMIAUTOMATIC"; return { param: "focus", value: v, human: `Foco → ${v === "MANUAL" ? "manual" : "semiautomático"}` }; } },
    { key: "anprRoad", label: "Modo vía", icono: Car, soloAnpr: true, detalle: "«entrance» asume que el auto frena en una barrera; «city» lee vehículos en movimiento (barrio sin barrera).", valor: (c) => c.anprRoad || "—",
        siguiente: (c) => { const v = c.anprRoad === "entrance" ? "city" : "entrance"; return { param: "anprRoad", value: v, human: `Modo vía → ${v}` }; } },
];
const COLOR_CARRIL = ["#f59e0b", "#22d3ee", "#a78bfa", "#34d399"];
// La región ANPR viene en 0..1000 con origen ABAJO-izquierda.
const aLienzo = (p: { x: number; y: number }): Pt => ({ x: p.x / 1000, y: 1 - p.y / 1000 });
const aCamara = (p: Pt) => ({ x: Math.round(p.x * 1000), y: Math.round((1 - p.y) * 1000) });

export function useImagen(deviceId: string, activo: boolean, anpr: boolean, alRefrescar: () => void): Modulo {
    const [cfg, setCfg] = useState<Cfg | null>(null);
    const [cargando, setCargando] = useState(false);
    const [ocupado, setOcupado] = useState<string | null>(null);
    const [confirmar, setConfirmar] = useState<string | null>(null);
    const [auto, setAuto] = useState<{ key: string; label: string; status: "pending" | "ok" | "fail"; error?: string }[] | null>(null);
    const [region, setRegion] = useState<Region | null>(null);
    const [regionOriginal, setRegionOriginal] = useState("");
    const [regionError, setRegionError] = useState<string | null>(null);
    const [seleccion, setSeleccion] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    const leer = useCallback(async () => {
        setCargando(true);
        try { const j = await fetch(`/api/devices/camera-config?deviceId=${deviceId}`, { cache: "no-store" }).then((r) => r.json()); if (j.ok) setCfg(j.config); else toast.error({ title: "No se pudo leer la imagen de la cámara", description: j.error }); }
        catch { toast.error({ title: "No se pudo leer la cámara" }); }
        finally { setCargando(false); }
        if (anpr) {
            try {
                const r = await fetch(`/api/devices/anpr-region?deviceId=${deviceId}`, { cache: "no-store" }); const j = await r.json();
                if (j.ok) { setRegion(j.region); setRegionOriginal(JSON.stringify(j.region)); setRegionError(null); }
                else setRegionError(/403|404|notSupport/i.test(`${r.status} ${j.error}`) ? "La cámara no deja leer su región ANPR." : j.error || "No se pudo leer la región.");
            } catch { setRegionError("No se pudo leer la región."); }
        }
    }, [deviceId, anpr]);
    useEffect(() => { if (!activo) return; const t = setTimeout(leer, 0); return () => clearTimeout(t); }, [activo, leer]);

    const aplicar = async (c: Ctl) => {
        if (!cfg) return;
        const a = c.siguiente(cfg);
        setConfirmar(null); setOcupado(c.key);
        try {
            const j = await fetch(`/api/devices/camera-config?deviceId=${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ param: a.param, value: a.value }) }).then((r) => r.json());
            if (j.ok) { toast.success({ title: a.human, description: "Aplicado en la cámara: mirá el efecto en la imagen." }); setTimeout(alRefrescar, 900); setTimeout(leer, 1300); }
            else toast.error({ title: "No se pudo aplicar", description: j.error });
        } catch { toast.error({ title: "No se pudo aplicar" }); }
        finally { setOcupado(null); }
    };

    const autoCalibrar = async () => {
        setConfirmar(null); setOcupado("auto");
        try {
            const sj = await fetch(`/api/devices/auto-calibrate?deviceId=${deviceId}`).then((r) => r.json());
            setAuto((sj.steps || []).map((s: { key: string; label: string }) => ({ ...s, status: "pending" as const })));
            const j = await fetch(`/api/devices/auto-calibrate?deviceId=${deviceId}`, { method: "POST" }).then((r) => r.json());
            for (const res of (j.results || []) as { key: string; ok: boolean; error?: string }[]) {
                await new Promise((r) => setTimeout(r, 380));
                setAuto((xs) => (xs || []).map((s) => (s.key === res.key ? { ...s, status: res.ok ? "ok" : "fail", error: res.error } : s)));
            }
            if (j.ok) toast.success({ title: `Perfil aplicado (${j.applied}/${j.total})` }); else toast.error({ title: "La auto-calibración falló" });
            alRefrescar(); setTimeout(leer, 1200);
        } catch { toast.error({ title: "La auto-calibración falló" }); }
        finally { setOcupado(null); }
    };

    const formas: Forma[] = useMemo(() => {
        if (!region) return [];
        const out: Forma[] = region.lanes.map((ln, i) => ({ id: `carril-${i}`, tipo: "linea" as const, puntos: ln.points.map(aLienzo), color: COLOR_CARRIL[i % 4], etiqueta: `Carril ${i + 1}` }));
        if (region.calib?.length >= 2) out.push({ id: "calib", tipo: "linea", puntos: region.calib.map(aLienzo), color: "#34d399", etiqueta: "Calibración", apagada: true });
        // La zona de lectura (entre los dos carriles), sólo para mirar.
        if (region.lanes.length >= 2 && region.lanes[0].points.length >= 2 && region.lanes[1].points.length >= 2) {
            const a = region.lanes[0].points.map(aLienzo), b = region.lanes[1].points.map(aLienzo);
            out.unshift({ id: "zona-anpr", tipo: "poligono", puntos: [a[0], a[1], b[1], b[0]], color: "#22d3ee", bloqueada: true });
        }
        return out;
    }, [region]);
    const alCambiar = (id: string, c: { puntos?: Pt[] }) => {
        if (!c.puntos) return;
        setRegion((r) => {
            if (!r) return r;
            const n: Region = structuredClone(r);
            if (id === "calib") n.calib = c.puntos!.map(aCamara);
            else { const i = Number(id.split("-")[1]); if (n.lanes[i]) n.lanes[i].points = c.puntos!.map(aCamara); }
            return n;
        });
    };
    const guardarRegion = async () => {
        if (!region) return;
        setGuardando(true);
        try {
            const j = await fetch(`/api/devices/anpr-region?deviceId=${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lanes: region.lanes, calib: region.calib }) }).then((r) => r.json());
            if (j.ok) { setRegionOriginal(JSON.stringify(region)); toast.success({ title: "Región ANPR guardada", description: "La cámara ya usa la nueva línea de captura." }); }
            else toast.error({ title: "No se guardó la región", description: j.error });
        } catch { toast.error({ title: "No se guardó la región" }); }
        finally { setGuardando(false); }
    };

    const controles = CONTROLES.filter((c) => anpr || !c.soloAnpr);
    const panel = (<>
        <Seccion titulo="Auto-calibración" icono={Wand2} ayuda="Aplica de una el perfil recomendado para leer chapas (obturador, ganancia, anti-brillo, WDR, IR). Cada paso se ve abajo.">
            <button type="button" onClick={() => (confirmar === "auto" ? autoCalibrar() : setConfirmar("auto"))} disabled={!!ocupado}
                className="flex w-full items-center gap-3 rounded-[10px] bg-gradient-to-br from-amber-500 to-orange-600 px-3.5 py-3 text-left text-black transition hover:brightness-110 disabled:opacity-50">
                {ocupado === "auto" ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold">{confirmar === "auto" ? "Tocá de nuevo para aplicar" : "Aplicar el perfil de lectura"}</span>
                    <span className="block text-[11px] font-semibold opacity-75">{anpr ? "Perfil ANPR barrio y noche" : "Perfil lectura de matrículas (OmniVision)"}</span>
                </span>
                {confirmar === "auto" && <span onClick={(e) => { e.stopPropagation(); setConfirmar(null); }} className="grid h-6 w-6 place-items-center rounded-full bg-black/15"><X size={12} /></span>}
            </button>
            {auto && (
                <div className="space-y-1">
                    {auto.map((s) => (
                        <div key={s.key} className="flex items-start gap-2 rounded-md bg-white/[0.04] px-2.5 py-1.5 text-[11.5px]">
                            {s.status === "ok" ? <Check size={13} className="mt-0.5 text-emerald-400" /> : s.status === "fail" ? <AlertTriangle size={13} className="mt-0.5 text-red-400" /> : <Loader2 size={13} className="mt-0.5 animate-spin text-white/40" />}
                            <span className="text-white/80">{s.label}{s.error && <span className="block text-red-300/80">{s.error}</span>}</span>
                        </div>
                    ))}
                </div>
            )}
        </Seccion>

        <Seccion titulo="Ajustes de la imagen" icono={Aperture} ayuda="Cada cambio se escribe en la cámara al confirmarlo y es reversible: el mismo botón lo vuelve atrás."
            accion={<button type="button" onClick={leer} title="Volver a leer la cámara" className="grid h-6 w-6 place-items-center rounded-md text-white/50 hover:bg-white/10 hover:text-white">{cargando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>}>
            {!cfg ? (cargando ? <div className="space-y-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-[10px] bg-white/[0.05]" />)}</div> : <Vacio>La cámara no devolvió su configuración de imagen.</Vacio>) : (
                <div className="space-y-1">
                    {controles.map((c) => {
                        const on = c.activo?.(cfg);
                        const sig = c.siguiente(cfg);
                        const abierto = confirmar === c.key;
                        return (
                            <div key={c.key} className={cn("rounded-[10px] border transition-colors", abierto ? "border-white/20 bg-white/[0.06]" : "border-transparent hover:bg-white/[0.04]")}>
                                <button type="button" onClick={() => setConfirmar(abierto ? null : c.key)} disabled={!!ocupado} className="flex w-full items-center gap-3 px-2.5 py-2 text-left">
                                    <span className={cn("grid h-8 w-8 place-items-center rounded-md", on ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.06] text-white/70")}>{ocupado === c.key ? <Loader2 size={15} className="animate-spin" /> : <c.icono size={15} />}</span>
                                    <span className="flex-1 text-[12.5px] font-semibold text-white">{c.label}</span>
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", on ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.06] text-white/70")}>{c.valor(cfg)}</span>
                                </button>
                                {abierto && (
                                    <div className="space-y-2 px-2.5 pb-2.5">
                                        <p className="text-[11.5px] leading-snug text-white/55">{c.detalle}</p>
                                        <div className="flex gap-1.5">
                                            <BotonPanel primario className="flex-1" onClick={() => aplicar(c)}><Check size={13} /> {sig.human}</BotonPanel>
                                            <BotonPanel onClick={() => setConfirmar(null)}>Cancelar</BotonPanel>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Seccion>

        {anpr && (
            <Seccion titulo="Región de captura ANPR" icono={SquareDashed} ayuda="Las líneas de cada carril y la de calibración de la cámara ANPR. Se ajustan arrastrando sus puntas sobre la escena.">
                {regionError ? <Vacio>{regionError}</Vacio> : !region ? <div className="h-10 animate-pulse rounded-[10px] bg-white/[0.05]" /> : (<>
                    <div className="flex flex-wrap gap-1.5">
                        {region.lanes.map((_, i) => <button key={i} type="button" onClick={() => setSeleccion(`carril-${i}`)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold", seleccion === `carril-${i}` ? "bg-white/15 text-white" : "bg-white/[0.05] text-white/70")}><span className="h-2 w-2 rounded-full" style={{ background: COLOR_CARRIL[i % 4] }} /> Carril {i + 1}</button>)}
                        {region.calib?.length >= 2 && <button type="button" onClick={() => setSeleccion("calib")} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold", seleccion === "calib" ? "bg-white/15 text-white" : "bg-white/[0.05] text-white/70")}><span className="h-2 w-2 rounded-full bg-emerald-400" /> Calibración</button>}
                    </div>
                    <p className="text-[11px] leading-snug text-white/50">Elegí una y arrastrá sus puntas. La franja celeste entre los carriles es donde la cámara busca la chapa.</p>
                </>)}
            </Seccion>
        )}
    </>);

    return {
        disponible: true, formas, seleccion, setSeleccion, herramienta: null, setHerramienta: () => { }, dock: [],
        alCrear: () => { }, alCambiar,
        panel, sucio: !!region && JSON.stringify(region) !== regionOriginal, guardando,
        guardar: anpr ? guardarRegion : undefined, revertir: () => { if (regionOriginal) setRegion(JSON.parse(regionOriginal)); }, rotuloGuardar: "Guardar región ANPR",
    };
}
