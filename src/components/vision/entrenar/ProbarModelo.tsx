"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Eye, ImageUp, Loader2, Radio, ScanSearch, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Filtros } from "@/components/ui/filtros";
import { ElegirCamara } from "@/components/devices/ElegirCamara";
import { useAreas } from "@/lib/use-areas";
import { esPropia } from "@/lib/nombres-propios";

/**
 * Probar el modelo (17/10, Nico: «que pueda ver la silueta o recuadro de detección; que se pueda
 * ver en vivo también cómo detecta el contenedor»).
 *
 * Antes, la única forma de ver qué marcaba el modelo era activarlo y esperar a que aparecieran
 * cosas en el registro — y así salieron 532 «contenedor prendido fuego» en LPR Salida antes de
 * que alguien lo viera. Esto lo muestra ANTES de confiar en él: una foto subida, un cuadro de una
 * cámara, o la cámara en vivo, con el recuadro de cada clase propia y su confianza.
 *
 * Prueba el modelo EN USO (el que corre omni-vision), con el umbral que se midió al entrenar: lo
 * que se ve acá es lo que pasaría en las cámaras. Los objetos de fábrica (personas, autos) se
 * pueden sumar para ver con qué se confunde.
 */

type Obj = { clase: string; nombre: string; confianza: number; caja: [number, number, number, number] };
type Resultado = { imagen: string; ancho: number; alto: number; objetos: Obj[]; ms?: number; instante?: string; camara?: { name: string } };

/** Colores sobre foto (no son tonos de estado): uno por clase propia, en el orden de las clases. */
const COLORES = ["#22d3ee", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#facc15"];
const COLOR_FABRICA = "#e2e8f0";
/** El vivo se corta solo: es una sesión RTSP más sobre la cámara y la GPU ocupada. */
const VIVO_MAX_MS = 10 * 60_000;
const VIVO_PAUSA_MS = 250;

export function ProbarModelo({ camaras, clases, activo }: {
    camaras: { id: string; name: string }[];
    clases: { id: string; nombre: string }[];
    /** El modelo en uso: sus clases, o null si no hay ninguno. */
    activo: { clases: { id: string; nombre: string }[] } | null;
}) {
    const [fuente, setFuente] = useState<"camara" | "foto">("camara");
    const [camara, setCamara] = useState("");
    const [fabrica, setFabrica] = useState(false);
    const [res, setRes] = useState<Resultado | null>(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [vivo, setVivo] = useState<{ cuadros: number; desde: number } | null>(null);
    const parar = useRef(false);
    const archivo = useRef<HTMLInputElement>(null);

    useEffect(() => { if (!camara && camaras.length) setCamara(camaras[0].id); }, [camaras, camara]);
    const { areas, equipoArea } = useAreas();
    // Al irse de la pantalla el vivo se corta: si no, seguiría pidiendo cuadros sin nadie mirando.
    useEffect(() => () => { parar.current = true; }, []);

    const colorDe = (clase: string) => {
        if (!esPropia(clase)) return COLOR_FABRICA;
        const k = clases.findIndex((c) => `propio:${c.id}` === clase);
        return COLORES[(k < 0 ? 0 : k) % COLORES.length];
    };

    async function unaCamara(id: string): Promise<Resultado> {
        const r = await fetch(`/api/vision/probar?camara=${encodeURIComponent(id)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
        return j;
    }
    async function mirar() {
        if (!camara) return;
        setCargando(true); setError(null);
        try { setRes(await unaCamara(camara)); } catch (e: any) { setError(e?.message || "No se pudo mirar"); }
        finally { setCargando(false); }
    }
    async function alternarVivo() {
        if (vivo) { parar.current = true; return; }
        if (!camara) return;
        parar.current = false; setError(null);
        const desde = Date.now(); let cuadros = 0;
        setVivo({ cuadros, desde });
        while (!parar.current && Date.now() - desde < VIVO_MAX_MS) {
            try { const r = await unaCamara(camara); if (parar.current) break; setRes(r); setError(null); cuadros++; setVivo({ cuadros, desde }); }
            // Un cuadro que falla no corta el vivo (la cámara pudo tardar): se dice y se sigue.
            catch (e: any) { setError(e?.message || "Un cuadro falló"); await new Promise((x) => setTimeout(x, 1500)); }
            await new Promise((x) => setTimeout(x, VIVO_PAUSA_MS));
        }
        setVivo(null);
    }
    async function subir(f: File | undefined) {
        if (!f) return;
        parar.current = true;
        setCargando(true); setError(null);
        try {
            const r = await fetch("/api/vision/objetos/probar", { method: "POST", headers: { "content-type": f.type || "image/jpeg" }, body: f });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setRes(j);
        } catch (e: any) { setError(e?.message || "No se pudo probar"); }
        finally { setCargando(false); if (archivo.current) archivo.current.value = ""; }
    }

    const objetos = (res?.objetos || []).filter((o) => fabrica || esPropia(o.clase));
    const propios = (res?.objetos || []).filter((o) => esPropia(o.clase));
    const ocultos = (res?.objetos || []).length - objetos.length;
    const porClase = new Map<string, { nombre: string; n: number; max: number }>();
    for (const o of propios) {
        const p = porClase.get(o.clase) || { nombre: o.nombre, n: 0, max: 0 };
        p.n++; p.max = Math.max(p.max, o.confianza); porClase.set(o.clase, p);
    }

    return (
        <div className="rounded-[10px] border border-border bg-card overflow-hidden">
            {!activo && (
                <div className="flex items-start gap-2 px-4 py-2.5 border-b border-border text-[12.5px] chip-aviso">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>No hay un modelo en uso: los recuadros de tus clases no van a aparecer, sólo lo de fábrica. Tocá <b>Usar</b> en un entrenamiento de arriba para probarlo.</span>
                </div>
            )}
            <div className="px-4 py-3 flex items-center gap-2 flex-wrap border-b border-border">
                <Filtros grupos={[{ clave: "fuente", valor: fuente, alElegir: (v) => { parar.current = true; setFuente(v as any); },
                    opciones: [{ valor: "camara", rotulo: "Cámara", icono: Camera }, { valor: "foto", rotulo: "Foto", icono: ImageUp }] }]} />
                {fuente === "camara" ? (
                    <>
                        {/* Con buscador y por área, como el resto (punto 6, 21/10). Quieto mientras corre el vivo. */}
                        <div className={cn(vivo && "pointer-events-none opacity-50")}>
                            <ElegirCamara valor={camara || null} alElegir={(id) => { if (!id) return; parar.current = true; setCamara(id); }} alinear="start" className="h-[34px] max-w-[240px]"
                                areas={areas} camaras={camaras.map((c) => ({ id: c.id, nombre: c.name, areaId: equipoArea[c.id] || null }))} />
                        </div>
                        <Button size="sm" variant="outline" onClick={mirar} disabled={!camara || cargando || !!vivo}>
                            {cargando ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />} Mirar ahora
                        </Button>
                        <Button size="sm" onClick={alternarVivo} disabled={!camara} className={cn(vivo && "pleno-mal hover:brightness-110")}>
                            <Radio size={14} className={cn(vivo && "animate-pulse")} /> {vivo ? "Parar el vivo" : "En vivo"}
                        </Button>
                        {vivo && <span className="text-[11.5px] text-muted-foreground tabular-nums">{vivo.cuadros} cuadros</span>}
                    </>
                ) : (
                    <>
                        <input ref={archivo} type="file" accept="image/*" className="hidden" onChange={(e) => subir(e.target.files?.[0])} />
                        <Button size="sm" onClick={() => archivo.current?.click()} disabled={cargando}>
                            {cargando ? <Loader2 size={14} className="animate-spin" /> : <ImageUp size={14} />} Elegir una foto
                        </Button>
                        <span className="text-[11.5px] text-muted-foreground">No se guarda: es sólo para ver qué marca.</span>
                    </>
                )}
                <button type="button" onClick={() => setFabrica((x) => !x)} aria-pressed={fabrica}
                    className={cn("ml-auto h-[34px] px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
                        fabrica ? "bg-[var(--accion)] text-white" : "bg-muted/60 text-muted-foreground hover:text-foreground")}
                    title="Sumar lo que el detector ya conoce (personas, autos…): sirve para ver con qué se confunde tu clase">
                    <Eye size={14} /> También lo de fábrica
                </button>
            </div>

            <div
                onDragOver={(e) => { if (fuente === "foto") e.preventDefault(); }}
                onDrop={(e) => { if (fuente !== "foto") return; e.preventDefault(); subir(e.dataTransfer.files?.[0]); }}
                className="relative bg-black" style={{ aspectRatio: res ? `${res.ancho} / ${res.alto}` : "16 / 9" }}>
                {res ? (
                    <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={res.imagen} alt="" className="absolute inset-0 w-full h-full object-contain" />
                        {/* Mismo viewBox que la foto y el mismo ajuste: cada recuadro cae sobre su objeto sin medir nada en pantalla. */}
                        <svg viewBox={`0 0 ${res.ancho} ${res.alto}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none">
                            {objetos.map((o, i) => {
                                const [x1, y1, x2, y2] = o.caja; const c = colorDe(o.clase); const propio = esPropia(o.clase);
                                const fs = Math.max(12, res.ancho / 70);
                                const texto = `${o.nombre} ${Math.round(o.confianza * 100)} %`;
                                return (
                                    <g key={i}>
                                        <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill={propio ? `${c}22` : "none"} stroke={c} strokeWidth={propio ? res.ancho / 380 : res.ancho / 900}
                                            strokeDasharray={propio ? undefined : `${res.ancho / 150} ${res.ancho / 220}`} rx={res.ancho / 400} />
                                        <rect x={x1} y={Math.max(0, y1 - fs * 1.5)} width={texto.length * fs * 0.58 + fs * 0.8} height={fs * 1.45} fill={c} rx={fs * 0.25} />
                                        <text x={x1 + fs * 0.4} y={Math.max(0, y1 - fs * 1.5) + fs * 1.06} fontSize={fs} fontWeight={700} fill="#0b0f17" fontFamily="Outfit, sans-serif">{texto}</text>
                                    </g>
                                );
                            })}
                        </svg>
                        {vivo && <span className="absolute top-2.5 left-2.5 h-6 px-2 rounded-full bg-black/60 text-white text-[11px] font-bold inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> EN VIVO</span>}
                    </>
                ) : (
                    <div className="absolute inset-0 grid place-items-center text-center text-white/45 text-[12.5px] px-6">
                        {cargando ? <Loader2 className="animate-spin" /> : fuente === "foto"
                            ? <span><ImageUp className="mx-auto mb-2 opacity-60" />Soltá una foto acá, o elegila arriba: se ve qué marca el modelo, con su recuadro.</span>
                            : <span><Camera className="mx-auto mb-2 opacity-60" />Elegí la cámara donde está el objeto y tocá «Mirar ahora» o «En vivo».</span>}
                    </div>
                )}
            </div>

            <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap text-[12px] min-h-[42px]">
                {error && <span className="tono-mal">{error}</span>}
                {!error && res && (porClase.size ? [...porClase.entries()].map(([k, p]) => (
                    <span key={k} className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-2 rounded-full bg-muted/60 font-semibold">
                        <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: colorDe(k) }} />
                        {p.nombre} <span className="tabular-nums text-muted-foreground">×{p.n} · hasta {Math.round(p.max * 100)} %</span>
                    </span>
                )) : <span className="text-muted-foreground">{activo ? "El modelo no marcó ninguna de tus clases en esta imagen." : "Sin modelo en uso: nada propio para marcar."}</span>)}
                {!error && res && ocultos > 0 && !fabrica && <span className="text-muted-foreground">· {ocultos} de fábrica ocultos</span>}
                {!error && res?.ms != null && <span className="ml-auto text-muted-foreground tabular-nums">{Math.round(res.ms)} ms{res.camara?.name ? ` · ${res.camara.name}` : ""}</span>}
            </div>
        </div>
    );
}
