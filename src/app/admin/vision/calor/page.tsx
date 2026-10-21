"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Info, RefreshCw, Camera, Footprints, Map as MapaIcono } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { ModalEscena, BloquePanel, CifraPanel } from "@/components/vision/ModalEscena";

/**
 * OmniVision › Mapa de calor: por dónde pasa la gente (o los vehículos) en cada cámara.
 *
 * Fase 2 de las «próximas» del catálogo (19/10). No corre nada nuevo: suma los recorridos que ya
 * guarda el registro de detecciones (ver /api/vision/calor). El mapa va sobre el cuadro del mismo
 * stream que analiza el worker, así las celdas caen donde se vio a la gente.
 *
 * 21/10, Nico: «más profesional, premium; la cámara se ve muy grande; deben ser tablas…». La
 * pantalla es una tabla de cámaras con cuánto se movió en cada una, y el mapa grande se abre en la
 * ventana de escena (ModalEscena), con los filtros a mano.
 *
 * El color es UN tono (--aviso), de transparente a lleno, en escala logarítmica: con escala lineal
 * la vereda principal se come todo y el resto queda invisible. Se pinta como máscara de un bloque
 * del color del tema: el navegador agranda la grilla de 64×36 con suavizado.
 */
type Respuesta = {
    camaras: { id: string; nombre: string; pistas: number }[]; camara: string | null;
    columnas: number; filas: number; celdas: number[]; max: number; pistas: number; quietas: number; recortado: boolean;
};
type CamaraCalor = Respuesta["camaras"][number];

const RANGOS = [{ v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const GRUPOS = [{ v: "persona", r: "Personas" }, { v: "vehiculo", r: "Vehículos" }];
const QUIETOS = [{ v: "0", r: "Sólo los que se mueven" }, { v: "1", r: "También los quietos" }];
/** Cuánto se tapa la foto en la celda más transitada: más, y no se ve por dónde es. */
const OPACIDAD_MAX = 0.85;

async function pedir(q: Record<string, string>): Promise<Respuesta> {
    const r = await fetch(`/api/vision/calor?${new URLSearchParams(q)}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
    return j;
}

export default function MapaDeCalor() {
    const [h, setH] = useState("24");
    const [grupo, setGrupo] = useState("persona");
    const [quietos, setQuietos] = useState("0");
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [abierta, setAbierta] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setDatos(await pedir({ h, grupo, quietos })); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo leer"); }
        finally { setCargando(false); }
    }, [h, grupo, quietos]);
    useEffect(() => { cargar(); }, [cargar]);

    const que = grupo === "persona" ? "personas" : "vehículos";
    const camaras = useMemo(() => [...(datos?.camaras || [])].sort((a, b) => b.pistas - a.pistas), [datos]);
    const max = Math.max(1, ...camaras.map((c) => c.pistas));
    const total = camaras.reduce((s, c) => s + c.pistas, 0);

    const columnas = useMemo<ColumnaTabla<CamaraCalor>[]>(() => [
        { clave: "vista", titulo: "", ancho: 132, auxiliar: true, celda: (c) => <MiniCuadro id={c.id} /> },
        { clave: "camara", titulo: "Cámara", valor: (c) => c.nombre, celda: (c) => <span className="text-[13px] font-semibold">{c.nombre}</span> },
        { clave: "pistas", titulo: `Recorridos de ${que}`, ancho: 300, ordenable: true, valor: (c) => c.pistas, celda: (c) => (
            <div className="flex items-center gap-3">
                <span className="flex-1 h-2 rounded-full bg-muted overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${(c.pistas / max) * 100}%`, background: "var(--aviso)" }} /></span>
                <span className="w-16 text-right tabular-nums text-[12.5px] font-semibold">{c.pistas.toLocaleString("es-UY")}</span>
            </div>) },
        { clave: "parte", titulo: "Del total", ancho: 90, alinear: "der", valor: (c) => (total ? c.pistas / total : 0), celda: (c) => <span className="tabular-nums text-[12.5px] text-muted-foreground">{total ? Math.round((c.pistas / total) * 100) : 0} %</span> },
        { clave: "abrir", titulo: "", ancho: 120, auxiliar: true, alinear: "der", celda: () => (
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] whitespace-nowrap text-[12px] font-semibold text-[var(--accion)] group-hover:bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"><MapaIcono size={13} /> Ver mapa</span>) },
    ], [que, max, total]);

    return (
        <div className="px-6 lg:px-8 py-5 max-w-[1500px] mx-auto space-y-5">
            <header className="flex flex-wrap items-start gap-4">
                <span className="w-11 h-11 rounded-[10px] grid place-items-center bg-muted shrink-0"><Flame size={20} className="text-[var(--aviso)]" /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[20px] font-bold tracking-[-0.015em] leading-tight flex items-center gap-2">
                        Mapa de calor
                        <Pista titulo="Qué es esto" ancho={340} texto="Por dónde pasaron las personas o los vehículos en la cámara, sacado de los recorridos del registro de detecciones. Cada uno suma una vez en cada lugar que pisó: más color es más gente pasando, no alguien parado mucho tiempo. No usa la GPU.">
                            <Info size={15} className="text-muted-foreground cursor-help" />
                        </Pista>
                    </h1>
                    <p className="text-[13px] text-muted-foreground mt-0.5">Cuánto se movió en cada cámara. Tocá una para ver el mapa sobre su cuadro.</p>
                </div>
            </header>

            <section className="grid grid-cols-3 rounded-[10px] bg-muted/50 divide-x divide-border overflow-hidden max-w-[720px]">
                <div className="px-4 py-3"><div className="text-[22px] font-bold tabular-nums leading-none">{camaras.length}</div><div className="mt-1 text-[11.5px] text-muted-foreground">cámaras con {que}</div></div>
                <div className="px-4 py-3"><div className="text-[22px] font-bold tabular-nums leading-none">{total.toLocaleString("es-UY")}</div><div className="mt-1 text-[11.5px] text-muted-foreground">recorridos</div></div>
                <div className="px-4 py-3"><div className="text-[22px] font-bold tabular-nums leading-none truncate">{camaras[0]?.nombre || "—"}</div><div className="mt-1 text-[11.5px] text-muted-foreground">la más transitada</div></div>
            </section>

            <div className="flex items-center gap-2 flex-wrap">
                <Filtros solido grupos={[
                    { clave: "g", titulo: "Qué", valor: grupo, alElegir: setGrupo, opciones: GRUPOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "q", titulo: "Quietos", valor: quietos, alElegir: setQuietos, opciones: QUIETOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                ]} />
                <button type="button" onClick={cargar} disabled={cargando} aria-label="Actualizar"
                    className="ml-auto h-[34px] w-[34px] rounded-[6px] border border-border grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50">
                    <RefreshCw size={14} className={cn(cargando && "animate-spin")} />
                </button>
            </div>

            {!datos && error ? <ErrorEstado mensaje={error} alReintentar={cargar} />
                : !datos ? <Cargando texto="Sumando recorridos…" />
                : (
                    <Tabla<CamaraCalor> id="calor-camaras" filas={camaras} clave={(c) => c.id} columnas={columnas} controles={false}
                        alClickFila={(c) => setAbierta(c.id)} filaActiva={(c) => c.id === abierta}
                        vacio={{ icono: Footprints, titulo: `Ninguna cámara registró ${que} en este rango`, ayuda: "El mapa sale del registro de detecciones: la cámara tiene que estar en OmniVision." }} />
                )}
            {datos && error && <div className="text-[12px] tono-mal">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}

            {abierta && (
                <ModalCalor key={abierta} camara={camaras.find((c) => c.id === abierta) || { id: abierta, nombre: "Cámara", pistas: 0 }}
                    h={h} setH={setH} grupo={grupo} setGrupo={setGrupo} quietos={quietos} setQuietos={setQuietos} alCerrar={() => setAbierta(null)} />
            )}
        </div>
    );
}

function MiniCuadro({ id }: { id: string }) {
    const [mal, setMal] = useState(false);
    return (
        <span className="relative block w-[116px] aspect-video rounded-[6px] overflow-hidden bg-black shadow-[0_3px_22px_rgba(0,0,0,0.22)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!mal ? <img src={`/api/vision/cuadro?camara=${encodeURIComponent(id)}`} alt="" loading="lazy" onError={() => setMal(true)} className="absolute inset-0 w-full h-full object-cover" />
                : <Camera size={16} className="absolute inset-0 m-auto text-white/30" />}
        </span>
    );
}

/** Un selector de la ventana oscura: las opciones en píldoras, la elegida en blanco. */
function Opciones({ valor, opciones, alElegir }: { valor: string; opciones: { v: string; r: string }[]; alElegir: (v: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1 rounded-[8px] bg-white/[0.05] p-1">
            {opciones.map((o) => (
                <button key={o.v} type="button" onClick={() => alElegir(o.v)} aria-pressed={valor === o.v}
                    className={cn("h-7 px-2.5 rounded-[6px] text-[12px] font-semibold transition-colors", valor === o.v ? "bg-white text-black" : "text-white/65 hover:text-white")}>{o.r}</button>
            ))}
        </div>
    );
}

function ModalCalor({ camara, h, setH, grupo, setGrupo, quietos, setQuietos, alCerrar }: {
    camara: CamaraCalor; h: string; setH: (v: string) => void; grupo: string; setGrupo: (v: string) => void; quietos: string; setQuietos: (v: string) => void; alCerrar: () => void;
}) {
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [aspecto, setAspecto] = useState(16 / 9);
    const [punto, setPunto] = useState<{ x: number; y: number; n: number } | null>(null);
    const [vuelta, setVuelta] = useState(0);
    useEffect(() => {
        let vivo = true;
        setCargando(true);
        pedir({ h, grupo, quietos, camara: camara.id }).then((d) => { if (vivo) { setDatos(d); setError(null); } })
            .catch((e) => { if (vivo) setError(e?.message || "No se pudo leer"); }).finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [h, grupo, quietos, camara.id, vuelta]);

    // La grilla como máscara: blanco con la opacidad de cada celda (log), en un PNG chiquito.
    const mascara = useMemo(() => {
        if (!datos?.max || datos.camara !== camara.id || typeof document === "undefined") return null;
        const c = document.createElement("canvas");
        c.width = datos.columnas; c.height = datos.filas;
        const ctx = c.getContext("2d"); if (!ctx) return null;
        const img = ctx.createImageData(datos.columnas, datos.filas);
        const tope = Math.log1p(datos.max);
        datos.celdas.forEach((n, i) => {
            img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
            img.data[i * 4 + 3] = n ? Math.round(255 * OPACIDAD_MAX * (0.12 + 0.88 * (Math.log1p(n) / tope))) : 0;
        });
        ctx.putImageData(img, 0, 0);
        return c.toDataURL("image/png");
    }, [datos, camara.id]);

    const sobre = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!datos) return;
        const b = e.currentTarget.getBoundingClientRect();
        const fx = (e.clientX - b.left) / b.width, fy = (e.clientY - b.top) / b.height;
        const i = Math.min(datos.filas - 1, Math.floor(fy * datos.filas)) * datos.columnas + Math.min(datos.columnas - 1, Math.floor(fx * datos.columnas));
        setPunto({ x: fx, y: fy, n: datos.celdas[i] || 0 });
    };
    const que = grupo === "persona" ? "personas" : "vehículos";

    return (
        <ModalEscena abierto alCerrar={alCerrar} titulo={camara.nombre} subtitulo={`Por dónde pasaron ${que} · ${RANGOS.find((r) => r.v === h)?.r}`} aspecto={aspecto}
            chips={cargando ? <Chip tono="quieto" icono={RefreshCw}>Actualizando</Chip> : undefined}
            escena={
                <div className="absolute inset-0" onMouseMove={sobre} onMouseLeave={() => setPunto(null)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/vision/cuadro?camara=${encodeURIComponent(camara.id)}&v=${vuelta}`} alt={`Cuadro de ${camara.nombre}`} className="absolute inset-0 h-full w-full object-fill"
                        onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspecto(i.naturalWidth / i.naturalHeight); }} />
                    {mascara && (
                        <div className="absolute inset-0 pointer-events-none transition-opacity duration-300" aria-hidden="true"
                            style={{ background: "var(--aviso)", WebkitMaskImage: `url(${mascara})`, maskImage: `url(${mascara})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }} />
                    )}
                    {punto && (
                        <div className="absolute pointer-events-none -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-[8px] bg-black/80 px-2 py-1 text-[11.5px] text-white whitespace-nowrap tabular-nums"
                            style={{ left: `${punto.x * 100}%`, top: `${punto.y * 100}%` }}>
                            {punto.n ? `${punto.n.toLocaleString("es-UY")} ${punto.n === 1 ? "pasó" : "pasaron"} por acá` : "nadie pasó por acá"}
                        </div>
                    )}
                </div>
            }
            sobreEscena={<div className="flex items-center gap-3 text-[12px] text-white/70">
                <span>Pasá el mouse para ver cuántos pasaron por cada lugar.</span>
                <button type="button" onClick={() => setVuelta((v) => v + 1)} className="ml-auto shrink-0 inline-flex items-center gap-1 text-white/80 hover:text-white"><RefreshCw size={12} /> Otro cuadro</button>
            </div>}
            panel={<>
                <BloquePanel rotulo="En este rango">
                    <div className="grid grid-cols-2 gap-2">
                        <CifraPanel n={datos ? datos.pistas.toLocaleString("es-UY") : "—"} rotulo={`${que} con recorrido`} />
                        <CifraPanel n={datos ? datos.max.toLocaleString("es-UY") : "—"} rotulo="en el lugar más pasado" tono="var(--aviso)" />
                    </div>
                    {datos && datos.quietas > 0 && <p className="mt-2 text-[11.5px] text-white/55">{quietos === "0" ? `${datos.quietas.toLocaleString("es-UY")} quietos quedan fuera del mapa.` : `Incluye ${datos.quietas.toLocaleString("es-UY")} quietos.`}</p>}
                    {datos?.recortado && <p className="mt-1 text-[11.5px] text-[var(--aviso)]">Se sumaron las 30.000 más nuevas.</p>}
                    {error && <p className="mt-2 text-[11.5px] text-[var(--mal)]">No se pudo leer: {error}</p>}
                </BloquePanel>
                <BloquePanel rotulo="Qué"><Opciones valor={grupo} opciones={GRUPOS} alElegir={setGrupo} /></BloquePanel>
                <BloquePanel rotulo="Rango"><Opciones valor={h} opciones={RANGOS} alElegir={setH} /></BloquePanel>
                <BloquePanel rotulo="Quietos"><Opciones valor={quietos} opciones={QUIETOS} alElegir={setQuietos} /></BloquePanel>
                <BloquePanel rotulo="Escala">
                    <div className="h-2.5 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--aviso) 10%, transparent), var(--aviso))" }} />
                    <div className="mt-1 flex justify-between text-[11px] text-white/55 tabular-nums"><span>pocos</span><span>muchos</span></div>
                    <p className="mt-2 text-[11.5px] text-white/55 leading-relaxed">Cada {grupo === "persona" ? "persona" : "vehículo"} suma una vez en cada lugar que pisó. La escala crece despacio: los lugares de poco paso también se ven.</p>
                </BloquePanel>
            </>} />
    );
}
