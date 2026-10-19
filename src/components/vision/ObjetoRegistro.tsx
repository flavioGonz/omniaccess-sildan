"use client";

import { Type, Clock, User, Car, PawPrint, Backpack, Shapes, type LucideIcon, Boxes } from "lucide-react";
import { nombrePropio } from "@/lib/nombres-propios";
import { Chip } from "@/components/ui/estados";
import { CLASE_POR_NOMBRE } from "@/lib/vision-catalogo";
import type { Atributo } from "@/lib/vision";

/**
 * Una pista del registro de detecciones (ObjetoVisto): su tarjeta y sus formatos. Las comparten
 * Detecciones y Buscar, para que un objeto se vea igual en las dos pantallas. El cajón de la
 * pista está en CajonPista.
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
export const nombreClase = (c: string) => nombrePropio(c) ?? CLASE_POR_NOMBRE[c]?.nombre ?? c;
export const ICONO_GRUPO: Record<string, LucideIcon> = { persona: User, vehiculo: Car, animal: PawPrint, objeto: Backpack, propio: Boxes };

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
