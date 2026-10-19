"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Users, LogIn, LogOut, TrendingUp, Clock, BellRing, SlidersHorizontal, Settings2, CalendarClock } from "lucide-react";
import { Cajon, CajonContenido, CajonCerrar } from "@/components/ui/cajon";
import { VivoConPlay } from "@/components/queue/VivoConPlay";
import { CajonContadorFila } from "@/components/devices/CajonContadorFila";
import { getFichaFila } from "@/app/actions/queue";
import { nombreStreamFila } from "@/lib/stream-fila";
import { hace, hora } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * La ficha de una fila (HB, 19/10): la cámara (foto, vivo a pedido), cómo está ahora, lo de hoy
 * en números y dos gráficas por separado — aforo (máximo y promedio) y flujo (entradas y
 * salidas). Van separadas a propósito: el aforo es gente en la fila en un momento; las entradas y
 * salidas son cruces contados. En una misma escala, una aplasta a la otra.
 */

export type ResumenFila = Awaited<ReturnType<typeof import("@/app/actions/queue").getResumenFilas>>[number];

type Rango = "hoy" | "7d" | "30d";
const RANGOS: { v: Rango; r: string }[] = [{ v: "hoy", r: "Hoy" }, { v: "7d", r: "7 días" }, { v: "30d", r: "30 días" }];
/** Desde qué fracción del límite la fila está «cargada». */
const UMBRAL_AVISO = 0.7;
type Tono = "bien" | "aviso" | "mal" | "quieto";
export const tonoFila = (a: number | null, l: number): Tono => (a == null ? "quieto" : a >= l ? "mal" : a >= l * UMBRAL_AVISO ? "aviso" : "bien");
export const ROTULO_TONO: Record<Tono, string> = { bien: "Fluida", aviso: "Cargada", mal: "Llena", quieto: "Sin datos" };

export function CajonFila({ fila, open, onOpenChange }: { fila: ResumenFila | null; open: boolean; onOpenChange: (v: boolean) => void }) {
    const [rango, setRango] = useState<Rango>("hoy");
    const [ficha, setFicha] = useState<Awaited<ReturnType<typeof getFichaFila>> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editar, setEditar] = useState(false);

    useEffect(() => { if (open) setRango("hoy"); }, [open, fila?.id]);
    useEffect(() => {
        if (!open || !fila) return;
        setFicha(null); setError(null);
        getFichaFila(fila.id, rango).then(setFicha).catch((e) => setError(e?.message || "No se pudieron leer los datos"));
    }, [open, fila, rango]);

    if (!fila) return null;
    const t = tonoFila(fila.aforo, fila.limite);
    const chip = "inline-flex items-center gap-1 h-6 px-2 rounded-md bg-black/45 backdrop-blur-md text-white text-[10.5px] font-bold ring-1 ring-white/10";

    return (
        <>
            <Cajon open={open} onOpenChange={onOpenChange}>
                <CajonContenido ancho="intermedio" titulo={fila.nombre} descripcion="Ficha de la fila" tituloOculto sinCabecera>
                    {/* Cabecera: la cámara a sangre, con foto y vivo a pedido */}
                    <div className="sticky top-0 z-20">
                        <div className="relative w-full overflow-hidden bg-black aspect-video">
                            <VivoConPlay deviceId={fila.id}>
                                <video src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(nombreStreamFila(fila.ip))}`} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
                            </VivoConPlay>
                            <span className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
                            <div className="absolute left-5 top-4 right-4 flex items-start gap-3 z-30">
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-[19px] font-bold text-white leading-tight truncate drop-shadow">{fila.nombre}</h2>
                                    <p className="text-[12px] text-white/75 truncate drop-shadow">{fila.ubicacion || fila.ip}</p>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <span className={cn(chip, t === "mal" ? "!bg-red-600/85" : t === "aviso" ? "!bg-amber-500/90 !text-black" : t === "bien" ? "!bg-emerald-600/80" : "")}>
                                            <Users size={12} /> {fila.aforo ?? "—"} / {fila.limite} · {ROTULO_TONO[t]}
                                        </span>
                                        {fila.ultimoDato && <span className={chip}><Clock size={11} /> {hace(fila.ultimoDato)}</span>}
                                    </div>
                                </div>
                                <CajonCerrar className="shrink-0 h-9 w-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md text-white grid place-items-center ring-1 ring-white/15 transition-colors" aria-label="Cerrar"><X size={17} /></CajonCerrar>
                            </div>
                        </div>
                    </div>

                    {/* Hoy en números */}
                    <div className="grid grid-cols-4 border-b border-border">
                        <Numero icono={LogIn} rotulo="Entradas hoy" valor={fila.entradasHoy} />
                        <Numero icono={LogOut} rotulo="Salidas hoy" valor={fila.salidasHoy} />
                        <Numero icono={TrendingUp} rotulo="Pico hoy" valor={fila.picoHoy} pie={fila.picoHoyA ? hora(fila.picoHoyA) : undefined} />
                        <Numero icono={BellRing} rotulo="Se llenó" valor={fila.llenasHoy} pie={fila.esperaMin != null ? `espera ~${fila.esperaMin} min` : undefined} tono={fila.llenasHoy > 0 ? "tono-mal" : undefined} />
                    </div>

                    {/* Analíticas */}
                    <section className="px-6 py-5 space-y-5">
                        <div className="flex items-center gap-2">
                            <h3 className="text-[15px] font-semibold">Analíticas</h3>
                            <div className="ml-auto inline-flex items-center gap-0.5 p-0.5 rounded-full bg-muted border border-border">
                                {RANGOS.map((r) => (
                                    <button key={r.v} onClick={() => setRango(r.v)} className={cn("h-7 px-3 rounded-full text-[12px] font-semibold transition-colors", rango === r.v ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground")}>{r.r}</button>
                                ))}
                            </div>
                        </div>
                        {error ? <div className="text-[13px] tono-mal">{error}</div> : !ficha ? <div className="h-[340px] rounded-[10px] bg-muted animate-pulse" /> : (
                            <>
                                <Grafica titulo="Aforo" pie={`Pico ${ficha.pico} · límite ${fila.limite}`} buckets={ficha.buckets}
                                    series={[{ clave: "max", rotulo: "Máximo", clase: "fill-[var(--quieto)]" }, { clave: "prom", rotulo: "Promedio", clase: "fill-[var(--info)]" }]} limite={fila.limite} />
                                <Grafica titulo="Entradas y salidas" pie={`${ficha.totalEntradas} entradas · ${ficha.totalSalidas} salidas`} buckets={ficha.buckets}
                                    series={[{ clave: "entradas", rotulo: "Entradas", clase: "fill-[var(--bien)]" }, { clave: "salidas", rotulo: "Salidas", clase: "fill-[var(--aviso)]" }]} />
                            </>
                        )}
                    </section>

                    {/* Atajos */}
                    <section className="px-6 pb-6 flex flex-wrap gap-2">
                        <button onClick={() => setEditar(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[6px] border border-border text-[12.5px] font-semibold hover:bg-accent"><Settings2 size={14} /> Cámara y límite</button>
                        <Link href={`/admin/calibracion-aforo?device=${fila.id}`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[6px] border border-border text-[12.5px] font-semibold hover:bg-accent"><SlidersHorizontal size={14} /> Zona y rebote</Link>
                        <Link href="/admin/horarios-filas" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[6px] border border-border text-[12.5px] font-semibold hover:bg-accent"><CalendarClock size={14} /> Horarios</Link>
                    </section>
                </CajonContenido>
            </Cajon>
            <CajonContadorFila device={editar ? fila.equipo : null}
                open={editar} onOpenChange={setEditar} onSuccess={() => { }} />
        </>
    );
}

function Numero({ icono: I, rotulo, valor, pie, tono }: { icono: any; rotulo: string; valor: number; pie?: string; tono?: string }) {
    return (
        <div className="px-5 py-4 border-r border-border last:border-r-0">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><I size={13} /> {rotulo}</div>
            <div className={cn("text-[24px] font-bold tabular-nums leading-tight mt-1", tono)}>{valor}</div>
            {pie && <div className="text-[11px] text-muted-foreground">{pie}</div>}
        </div>
    );
}

/**
 * Barras agrupadas en SVG, con los colores de estado del tema (nada de hex). Crecen al aparecer,
 * como la gráfica del Monitor, y al pasar el mouse muestran el valor de cada barra.
 */
function Grafica({ titulo, pie, buckets, series, limite }: {
    titulo: string; pie?: string; buckets: any[];
    series: { clave: string; rotulo: string; clase: string }[]; limite?: number;
}) {
    const [listo, setListo] = useState(false);
    const [sobre, setSobre] = useState<number | null>(null);
    useEffect(() => { setListo(false); const t = setTimeout(() => setListo(true), 40); return () => clearTimeout(t); }, [buckets]);
    const W = 640, H = 150, IZQ = 26, ABAJO = 18;
    const max = Math.max(1, limite ?? 0, ...buckets.flatMap((b) => series.map((s) => b[s.clave] || 0)));
    const anchoGrupo = (W - IZQ) / Math.max(1, buckets.length);
    const anchoBarra = Math.max(2, (anchoGrupo * 0.72) / series.length);
    const y = (v: number) => (H - ABAJO) * (1 - v / max);
    const cadaEtiqueta = Math.ceil(buckets.length / 12);
    return (
        <div className="rounded-[10px] border border-border p-4">
            <div className="flex items-center gap-3 mb-2">
                <span className="text-[13px] font-semibold">{titulo}</span>
                <span className="flex items-center gap-3 ml-auto text-[11px] text-muted-foreground">
                    {series.map((s) => <span key={s.clave} className="inline-flex items-center gap-1"><svg width="8" height="8"><rect width="8" height="8" rx="2" className={s.clase} /></svg>{s.rotulo}</span>)}
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseLeave={() => setSobre(null)}>
                {[0.5, 1].map((f) => <line key={f} x1={IZQ} x2={W} y1={y(max * f)} y2={y(max * f)} className="stroke-border" strokeDasharray="3 3" />)}
                <text x={IZQ - 4} y={y(max) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{max}</text>
                {limite != null && limite <= max && <line x1={IZQ} x2={W} y1={y(limite)} y2={y(limite)} className="stroke-[var(--mal)]" strokeWidth={1} strokeDasharray="5 3" />}
                {buckets.map((b, i) => {
                    const x0 = IZQ + i * anchoGrupo + (anchoGrupo - anchoBarra * series.length) / 2;
                    return (
                        <g key={i} onMouseEnter={() => setSobre(i)}>
                            <rect x={IZQ + i * anchoGrupo} y={0} width={anchoGrupo} height={H - ABAJO} className={cn("fill-transparent", sobre === i && "fill-[color-mix(in_oklab,var(--foreground)_6%,transparent)]")} />
                            {series.map((s, k) => {
                                const v = b[s.clave] || 0;
                                const alto = listo ? (H - ABAJO) - y(v) : 0;
                                return <rect key={s.clave} x={x0 + k * anchoBarra} y={(H - ABAJO) - alto} width={anchoBarra - 1} height={alto} rx={1.5} className={s.clase}
                                    style={{ transition: `height 600ms ease ${i * 12}ms, y 600ms ease ${i * 12}ms` }} />;
                            })}
                            {i % cadaEtiqueta === 0 && <text x={IZQ + i * anchoGrupo + anchoGrupo / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">{b.label}</text>}
                        </g>
                    );
                })}
            </svg>
            <div className="flex items-center text-[11px] text-muted-foreground mt-1 min-h-[16px]">
                {sobre != null ? <span className="tabular-nums"><b className="text-foreground">{buckets[sobre].label}</b> · {series.map((s) => `${s.rotulo} ${buckets[sobre][s.clave]}`).join(" · ")}</span> : <span>{pie}</span>}
            </div>
        </div>
    );
}
