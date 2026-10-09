"use client";

import { useState } from "react";
import { Type, Video, Clock, Route, User, Car, PawPrint, Backpack, Shapes, ScanSearch, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/estados";
import { CajonSeccion } from "@/components/ui/cajon";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { CLASE_POR_NOMBRE } from "@/lib/vision-catalogo";
import type { Atributo } from "@/lib/vision";

/**
 * Una pista del registro de detecciones (ObjetoVisto): su tarjeta y su ficha. Las comparten
 * Detecciones y Buscar, para que un objeto se vea igual en las dos pantallas.
 */

/** Una pista vista hace menos de esto está "en curso" (el proceso la cierra a los 15 s sin verla). */
const EN_CURSO_MS = 20_000;

export type FilaObjeto = {
    id: string; deviceId: string | null; camara: string; clase: string; grupo: string; confianza: number;
    primeraVez: string; ultimaVez: string; cuadros: number; pista: number | null;
    recorte: string | null; foto: string | null; caja: [number, number, number, number] | null;
    atributos: Atributo[] | null; recorrido: [number, number, number][] | null;
    /** Empresa por rotulado: el texto leído en el vehículo y la empresa del catálogo, si coincide. */
    textos: { texto: string; confianza: number; tipo?: string; empresa?: { nombre: string; logo: string | null } }[] | null;
    empresa: { nombre: string; logo: string | null } | null;
};

export const img = (clave: string | null, w?: number) => (clave ? `/api/vision/imagen/${clave}${w ? `?w=${w}` : ""}` : "");
export const pct = (v: number) => `${Math.round(v * 100)} %`;
export const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { weekday: "short", day: "numeric", month: "short" });
export function duracion(a: string, b: string) {
    const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
    return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
export const nombreClase = (c: string) => CLASE_POR_NOMBRE[c]?.nombre || c;
export const ICONO_GRUPO: Record<string, LucideIcon> = { persona: User, vehiculo: Car, animal: PawPrint, objeto: Backpack };

export function AtributosCortos({ a, max = 2 }: { a: Atributo[] | null; max?: number }) {
    const claros = (a || []).filter((x) => !x.dudoso && !(x.tipo === "si_no" && x.valor === "no"));
    if (!claros.length) return null;
    return (
        <div className="flex flex-wrap gap-1">
            {claros.slice(0, max).map((x) => (
                <span key={x.id} className="inline-flex items-center h-[20px] px-1.5 rounded-full border border-border text-[10.5px]">
                    {x.tipo === "si_no" ? x.nombre.toLowerCase() : x.valor}
                </span>
            ))}
        </div>
    );
}

/** Una pista del registro: el mejor recorte, qué es, dónde y cuándo. `pie` agrega una línea (la relevancia en la búsqueda). */
export function TarjetaObjeto({ f, alAbrir, pie }: { f: FilaObjeto; alAbrir: () => void; pie?: React.ReactNode }) {
    const Ic = ICONO_GRUPO[f.grupo] || Shapes;
    const enCurso = Date.now() - new Date(f.ultimaVez).getTime() < EN_CURSO_MS;
    return (
        <button type="button" onClick={alAbrir} className="rounded-[10px] border border-border bg-card overflow-hidden text-left hover:border-[var(--accion)] transition-colors flex flex-col">
            <div className="relative aspect-[4/3] bg-black">
                {f.recorte && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img(f.recorte, 320)} alt={nombreClase(f.clase)} loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
                )}
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/65 text-white text-[11px] font-semibold">
                    <Ic size={11} /> {nombreClase(f.clase)}
                </span>
                <span className="absolute right-1.5 top-1.5 px-1.5 py-0.5 rounded-md bg-black/65 text-white text-[11px] font-bold tabular-nums">{pct(f.confianza)}</span>
                {enCurso && <span className="absolute left-1.5 bottom-1.5"><Chip tono="bien" pleno>en curso</Chip></span>}
                {/* Empresa por rotulado: el logo de la empresa del catálogo, abajo a la derecha. */}
                {f.empresa && (
                    <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white text-black text-[10.5px] font-bold max-w-[80%]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {f.empresa.logo ? <img src={f.empresa.logo} alt="" className="h-3.5 w-auto max-w-12 object-contain" /> : null}
                        <span className="truncate">{f.empresa.nombre}</span>
                    </span>
                )}
            </div>
            <div className="p-2 flex flex-col gap-1 flex-1">
                <div className="text-[12px] font-semibold truncate">{f.camara}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-1.5">
                    <Clock size={11} /> {hora(f.primeraVez)} · {duracion(f.primeraVez, f.ultimaVez)}
                </div>
                <AtributosCortos a={f.atributos} />
                {pie}
                {f.textos && f.textos.length > 0 && !f.empresa && (
                    <div className="text-[10.5px] text-muted-foreground truncate" title={f.textos.map((t) => t.texto).join(" · ")}>
                        <Type size={10} className="inline -mt-0.5 mr-1" />{f.textos.map((t) => t.texto).join(" · ")}
                    </div>
                )}
            </div>
        </button>
    );
}

/** La ficha de una pista: el cuadro con la caja y el recorrido, el rotulado, los atributos y la grabación. */
export function FichaObjeto({ f, alParecidos }: { f: FilaObjeto; alParecidos?: () => void }) {
    const [grabacion, setGrabacion] = useState(false);
    const caja = f.caja;
    const rec = f.recorrido || [];
    return (
        <>
            <CajonSeccion titulo="" compacta>
                <div className="relative rounded-md overflow-hidden bg-black">
                    {f.foto && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img(f.foto, 960)} alt="Cuadro del mejor momento" className="w-full h-auto block" />
                    )}
                    <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                        {rec.length > 1 && <polyline points={rec.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="var(--aviso)" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
                        {caja && <rect x={caja[0]} y={caja[1]} width={caja[2] - caja[0]} height={caja[3] - caja[1]} fill="none" stroke="var(--accion-en-oscuro)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                    </svg>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground tabular-nums">
                    <span>confianza <b className="text-foreground">{pct(f.confianza)}</b></span>
                    <span>{f.cuadros} {f.cuadros === 1 ? "cuadro" : "cuadros"}</span>
                    {f.pista != null && <span>pista #{f.pista}</span>}
                    <span className="inline-flex items-center gap-1"><Route size={12} /> {rec.length} puntos de recorrido</span>
                    {alParecidos && (
                        <Button variant="outline" size="sm" className="ml-auto" onClick={alParecidos}>
                            <ScanSearch size={13} /> Buscar parecidos
                        </Button>
                    )}
                    {f.deviceId && (
                        <Button variant="outline" size="sm" className={alParecidos ? "" : "ml-auto"} onClick={() => setGrabacion(true)}>
                            <Video size={13} /> Ver la grabación de ese momento
                        </Button>
                    )}
                </div>
                <p className="text-[11px] text-muted-foreground">La foto es la del cuadro con mejor confianza; la línea amarilla es por dónde pasó (el pie de la caja, cuadro a cuadro).</p>
            </CajonSeccion>
            {f.textos && (
                <CajonSeccion titulo="Rotulado" compacta ayuda="El texto que omni-vision leyó en el vehículo, en un cuadro del stream principal. Si coincide con una empresa del catálogo (nombre o alias), se marca.">
                    {f.textos.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Se buscó y no tenía texto legible.</p> : (
                        <div className="flex flex-wrap gap-1.5">
                            {f.textos.map((t, i) => (
                                <span key={i} className={cn("inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[12.5px]", t.empresa ? "chip-bien" : "border-border")}>
                                    <b>{t.texto}</b> <span className="text-[11px] opacity-70 tabular-nums">{pct(t.confianza)}</span>{t.empresa && <span className="text-[11px]">→ {t.empresa.nombre}</span>}
                                </span>
                            ))}
                        </div>
                    )}
                </CajonSeccion>
            )}
            <CajonSeccion titulo="Atributos" compacta ayuda="De SigLIP 2 sobre el recorte del mejor cuadro. Lo dudoso va entre signos de pregunta.">
                {!f.atributos?.length ? <p className="text-[12.5px] text-muted-foreground">Esta clase no tiene atributos, o el recorte era muy chico para describirlo.</p> : (
                    <div className="grid sm:grid-cols-2 gap-2">
                        {f.atributos.map((a) => (
                            <div key={a.id} className="rounded-md bg-muted px-3 py-2">
                                <div className="text-[11px] text-muted-foreground">{a.nombre}</div>
                                <div className="text-[14px] font-bold">{a.dudoso ? `¿${a.valor}?` : a.valor} <span className="text-[12px] font-normal text-muted-foreground tabular-nums">{pct(a.prob)}</span></div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">{a.opciones.map((o) => `${o.valor} ${pct(o.prob)}`).join(" · ")}</div>
                            </div>
                        ))}
                    </div>
                )}
            </CajonSeccion>
            {grabacion && f.deviceId && (
                <VerGrabacion deviceId={f.deviceId} nombre={f.camara} instanteMs={new Date(f.primeraVez).getTime()} onClose={() => setGrabacion(false)} />
            )}
        </>
    );
}
