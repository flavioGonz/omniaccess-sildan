"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Info, Camera, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * OmniVision › Mapa de calor: por dónde pasa la gente (o los vehículos) en cada cámara.
 *
 * Fase 2 de las «próximas» del catálogo (19/10, Nico: «vamos por fase 2»). No corre nada nuevo:
 * suma los recorridos que ya guarda el registro de detecciones (ver /api/vision/calor). El mapa va
 * sobre el cuadro del mismo stream que analiza el worker, así las celdas caen donde se vio a la
 * gente.
 *
 * El color es UN tono (--aviso), de transparente a lleno, en escala logarítmica: con escala lineal
 * la vereda principal se come todo y el resto queda invisible. Se pinta como máscara de un bloque
 * del color del tema: el navegador agranda la grilla de 64×36 con suavizado, que es lo que le da
 * el aspecto de calor sin dibujar un difuminado a mano.
 */
type Respuesta = {
    camaras: { id: string; nombre: string; pistas: number }[]; camara: string | null;
    columnas: number; filas: number; celdas: number[]; max: number; pistas: number; quietas: number; recortado: boolean;
};

const RANGOS = [{ v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const GRUPOS = [{ v: "persona", r: "Personas" }, { v: "vehiculo", r: "Vehículos" }];
/** Cuánto se tapa la foto en la celda más transitada: más, y no se ve por dónde es. */
const OPACIDAD_MAX = 0.85;

export default function MapaDeCalor() {
    const [h, setH] = useState("24");
    const [grupo, setGrupo] = useState("persona");
    const [quietos, setQuietos] = useState("0");
    const [camara, setCamara] = useState<string>("");
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [vuelta, setVuelta] = useState(0);
    const [aspecto, setAspecto] = useState(16 / 9);
    const [punto, setPunto] = useState<{ x: number; y: number; n: number } | null>(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const q = new URLSearchParams({ h, grupo, quietos, ...(camara ? { camara } : {}) });
            const r = await fetch(`/api/vision/calor?${q}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
            if (j.camara && j.camara !== camara) setCamara(j.camara);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
        finally { setCargando(false); }
    }, [h, grupo, quietos, camara]);
    useEffect(() => { cargar(); }, [cargar]);

    // La grilla como máscara: blanco con la opacidad de cada celda (log), en un PNG chiquito.
    const mascara = useMemo(() => {
        if (!datos?.max || typeof document === "undefined") return null;
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
    }, [datos]);

    const sobre = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!datos) return;
        const b = e.currentTarget.getBoundingClientRect();
        const fx = (e.clientX - b.left) / b.width, fy = (e.clientY - b.top) / b.height;
        const i = Math.min(datos.filas - 1, Math.floor(fy * datos.filas)) * datos.columnas + Math.min(datos.columnas - 1, Math.floor(fx * datos.columnas));
        setPunto({ x: fx, y: fy, n: datos.celdas[i] || 0 });
    };

    const elegida = datos?.camaras.find((c) => c.id === datos.camara);
    const que = grupo === "persona" ? "personas" : "vehículos";

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-2.5 flex-wrap">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted shrink-0"><Flame size={16} /></span>
                <h1 className="text-[17px] font-bold leading-tight">Mapa de calor</h1>
                <Pista titulo="Qué es esto" ancho={340} texto="Por dónde pasaron las personas o los vehículos en la cámara, sacado de los recorridos del registro de detecciones. Cada uno suma una vez en cada lugar que pisó, así que más color es más gente pasando, no alguien parado mucho tiempo. No usa la GPU.">
                    <Info size={15} className="text-muted-foreground cursor-help" />
                </Pista>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <Select value={camara} onValueChange={(v) => { setCamara(v); setPunto(null); }} disabled={!datos?.camaras.length}>
                    <SelectTrigger className="h-[34px] w-[260px] text-[12.5px]"><Camera size={13} className="mr-1.5 text-muted-foreground" /><SelectValue placeholder="Cámara" /></SelectTrigger>
                    <SelectContent>
                        {(datos?.camaras || []).map((c) => (
                            <SelectItem key={c.id} value={c.id}><span className="flex items-center gap-2"><span className="truncate">{c.nombre}</span><span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{c.pistas.toLocaleString("es-UY")}</span></span></SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Filtros solido grupos={[
                    { clave: "g", titulo: "Qué", valor: grupo, alElegir: setGrupo, opciones: GRUPOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "q", titulo: "Quietos", valor: quietos, alElegir: setQuietos, opciones: [{ valor: "0", rotulo: "Sólo los que se mueven" }, { valor: "1", rotulo: "También los quietos" }] },
                ]} />
                <button type="button" onClick={() => { setVuelta((v) => v + 1); cargar(); }} disabled={cargando} aria-label="Actualizar"
                    className="ml-auto h-[34px] w-[34px] rounded-lg border border-border grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50">
                    <RefreshCw size={14} className={cn(cargando && "animate-spin")} />
                </button>
            </div>

            {!datos && error ? <ErrorEstado mensaje={error} alReintentar={cargar} />
                : !datos ? <Cargando texto="Sumando recorridos…" />
                : !datos.camara ? (
                    <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">
                        Ninguna cámara registró {que} en este rango. El mapa sale del registro de detecciones: la cámara tiene que estar en OmniVision.
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] items-start">
                        <div className="relative w-full overflow-hidden rounded-[10px] bg-black" style={{ aspectRatio: aspecto }}
                            onMouseMove={sobre} onMouseLeave={() => setPunto(null)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/vision/cuadro?camara=${encodeURIComponent(datos.camara)}&v=${vuelta}`} alt={`Cuadro de ${elegida?.nombre || "la cámara"}`}
                                className="absolute inset-0 h-full w-full object-fill"
                                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspecto(i.naturalWidth / i.naturalHeight); }} />
                            {mascara && (
                                <div className="absolute inset-0 pointer-events-none" aria-hidden="true"
                                    style={{ background: "var(--aviso)", WebkitMaskImage: `url(${mascara})`, maskImage: `url(${mascara})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }} />
                            )}
                            {punto && (
                                <div className="absolute pointer-events-none -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-[8px] bg-black/75 px-2 py-1 text-[11.5px] text-white whitespace-nowrap tabular-nums"
                                    style={{ left: `${punto.x * 100}%`, top: `${punto.y * 100}%` }}>
                                    {punto.n ? `${punto.n.toLocaleString("es-UY")} ${punto.n === 1 ? "pasó" : "pasaron"} por acá` : "nadie pasó por acá"}
                                </div>
                            )}
                            {cargando && <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">Actualizando…</div>}
                        </div>

                        <aside className="rounded-[10px] border border-border bg-card p-4 space-y-4">
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{elegida?.nombre}</div>
                                <div className="mt-1 flex items-baseline gap-1.5"><b className="text-[22px] tabular-nums leading-none">{datos.pistas.toLocaleString("es-UY")}</b><span className="text-[12px] text-muted-foreground">{que} con recorrido</span></div>
                                {datos.quietas > 0 && (
                                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                                        {quietos === "0" ? `${datos.quietas.toLocaleString("es-UY")} quietos fuera del mapa` : `incluye ${datos.quietas.toLocaleString("es-UY")} quietos`}
                                    </div>
                                )}
                            </div>
                            <div>
                                <div className="h-2.5 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--aviso) 10%, transparent), var(--aviso))" }} />
                                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums"><span>pocos</span><span>{datos.max.toLocaleString("es-UY")} en el lugar más pasado</span></div>
                            </div>
                            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                                Cada {grupo === "persona" ? "persona" : "vehículo"} suma una vez en cada lugar que pisó. La escala crece despacio: los lugares de poco paso también se ven.
                            </p>
                            {datos.recortado && <Chip tono="aviso">Se sumaron las 30.000 más nuevas</Chip>}
                        </aside>
                    </div>
                )}
            {datos && error && <div className="text-[12px] tono-mal">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
        </div>
    );
}
