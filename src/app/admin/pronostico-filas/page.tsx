"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert, CircleCheck, ShieldCheck, Hourglass, CalendarClock, Flame, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPronosticoFilas } from "@/app/actions/pronostico-filas";
import type { Pronostico } from "@/lib/filas/medidas";
import { cn } from "@/lib/utils";

/**
 * Pronóstico de las filas (HB, 20/10 — hoja de ruta frente a Xovis/V-Count).
 *
 * Tres preguntas, en el orden en que las hace el jefe de servicio:
 *   1. ¿Se me va a llenar en un rato? — el aviso anticipado, arriba de todo.
 *   2. ¿Cómo viene hoy contra un día normal? — la curva de hoy sobre la típica de este día.
 *   3. ¿Cuándo tengo que reforzar? — la semana típica en un mapa y las franjas que suelen llenarse.
 * Y al lado, sin esconderlo, qué tan confiable es el dato: un pronóstico hecho sobre un conteo que
 * parpadea o que no cuadra tiene que decirlo.
 */

const DIAS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const TRAMO_MIN = 15;
const hhmm = (k: number) => `${String(Math.floor((k * TRAMO_MIN) / 60)).padStart(2, "0")}:${String((k * TRAMO_MIN) % 60).padStart(2, "0")}`;
/** Margen, en tramos, alrededor de las horas con datos (para no dibujar la noche vacía). */
const MARGEN_TRAMOS = 2;
const REFRESCO_MS = 60_000;

export default function PronosticoFilasPage() {
    const [datos, setDatos] = useState<Pronostico[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [elegida, setElegida] = useState<string>("");

    const cargar = useCallback(async () => {
        try { setDatos(await getPronosticoFilas()); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo calcular el pronóstico"); }
    }, []);
    useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);

    const p = useMemo(() => (datos || []).find((d) => d.deviceId === elegida) || (datos || [])[0] || null, [datos, elegida]);

    return (
        <div className="p-6 space-y-5 max-w-[1680px] mx-auto">
            <div className="flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Pronóstico</h1>
                    <p className="text-[13px] text-muted-foreground">Cómo viene hoy contra un día típico, cuándo se va a llenar y cuándo conviene reforzar.</p>
                </div>
                {(datos?.length || 0) > 1 && (
                    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
                        {datos!.map((d) => (
                            <button key={d.deviceId} type="button" onClick={() => setElegida(d.deviceId)}
                                className={cn("rounded-full px-3 py-1 text-[12px] font-semibold", p?.deviceId === d.deviceId ? "bg-[var(--accion)] text-[var(--accion-texto)]" : "text-muted-foreground hover:text-foreground")}>{d.fila}</button>
                        ))}
                    </div>
                )}
                <Button variant="ghost" size="sm" onClick={cargar} title="Actualizar"><RefreshCw size={14} /></Button>
            </div>

            {error && (
                <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-center gap-3 text-[13px]">
                    <TriangleAlert size={16} className="tono-mal" /> <span className="flex-1">{error}</span>
                    <Button size="sm" variant="outline" onClick={cargar}>Reintentar</Button>
                </div>
            )}

            {!p ? (
                !error && <div className="grid gap-4">{[0, 1].map((i) => <div key={i} className="h-48 rounded-[14px] bg-muted animate-pulse" />)}</div>
            ) : (
                <>
                    <Anticipo p={p} />
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
                        <CurvaHoy p={p} />
                        <div className="space-y-4">
                            <TarjetaCalidad p={p} />
                            <TarjetaPermanencia p={p} />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
                        <MapaSemana p={p} />
                        <Franjas p={p} />
                    </div>
                </>
            )}
        </div>
    );
}

/* ── El aviso anticipado ─────────────────────────────────────────────────────── */

function Anticipo({ p }: { p: Pronostico }) {
    const lleno = p.ahora.aforo != null && p.ahora.aforo >= p.limite;
    const tono = lleno ? "mal" : p.seLlena ? "aviso" : "bien";
    const Icono = tono === "bien" ? CircleCheck : TriangleAlert;
    const titulo = lleno ? `${p.fila} está en su límite ahora` : p.seLlena ? `Se espera que ${p.fila} se llene a las ${p.seLlena.a}` : `Sin riesgo de que ${p.fila} se llene en la próxima hora`;
    const detalle = lleno ? `${p.ahora.aforo} personas, límite ${p.limite}.`
        : p.seLlena ? `En ~${p.seLlena.enMin} min, con unas ${Math.round(p.seLlena.aforoEsperado)} personas (límite ${p.limite}). Es el momento de reforzar.`
            : p.ahora.ajuste != null ? `Hoy viene ${p.ahora.ajuste > 1.05 ? `un ${Math.round((p.ahora.ajuste - 1) * 100)}% más cargado` : p.ahora.ajuste < 0.95 ? `un ${Math.round((1 - p.ahora.ajuste) * 100)}% más tranquilo` : "igual"} que un ${DIAS_LARGOS[diaHoy()]} típico.`
                : "Todavía no hay suficiente historia de este día para comparar.";
    return (
        <div className={cn("rounded-[14px] border px-5 py-4 flex items-start gap-3", `bg-[var(--${tono}-suave)]`, tono === "bien" ? "border-border" : `border-[var(--${tono})]/40`)}>
            <Icono size={20} className={cn("mt-0.5 shrink-0", `tono-${tono}`)} />
            <div>
                <div className="text-[15px] font-bold">{titulo}</div>
                <div className="text-[13px] text-muted-foreground">{detalle}</div>
            </div>
        </div>
    );
}
const DIAS_LARGOS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
function diaHoy() { const d = new Date(Date.now() - 3 * 3600_000).getUTCDay(); return d === 0 ? 7 : d; }

/* ── Hoy contra lo típico ───────────────────────────────────────────────────── */

function rangoConDatos(p: Pronostico): [number, number] {
    const con = (k: number) => p.hoy[k]?.tipico != null || p.hoy[k]?.real != null;
    let a = p.hoy.findIndex((_, k) => con(k)), b = -1;
    for (let k = p.hoy.length - 1; k >= 0; k--) if (con(k)) { b = k; break; }
    if (a < 0) return [Math.max(0, p.ahora.tramo - 16), Math.min(p.hoy.length - 1, p.ahora.tramo + 8)];
    return [Math.max(0, a - MARGEN_TRAMOS), Math.min(p.hoy.length - 1, Math.max(b, p.ahora.tramo) + MARGEN_TRAMOS)];
}

function CurvaHoy({ p }: { p: Pronostico }) {
    const [sobre, setSobre] = useState<number | null>(null);
    const [a, b] = rangoConDatos(p);
    const tramos = p.hoy.slice(a, b + 1);
    const W = 1000, H = 260, IZQ = 32, DER = 10, ARR = 14, ABA = 24;
    const N = Math.max(1, tramos.length);
    const max = Math.max(p.limite + 1, 4, ...tramos.map((t) => Math.max(t.real ?? 0, t.tipico ?? 0, t.ajustado ?? 0)));
    const x = (i: number) => IZQ + (N > 1 ? i / (N - 1) : 0) * (W - IZQ - DER);
    const y = (v: number) => ARR + (1 - v / max) * (H - ARR - ABA);
    const base = y(0);
    const linea = (vals: (number | null)[]) => {
        let d = "", abierto = false;
        vals.forEach((v, i) => { if (v == null) { abierto = false; return; } d += `${abierto ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)} `; abierto = true; });
        return d;
    };
    const tipico = tramos.map((t) => t.tipico);
    const areaTipico = (() => {
        const pts = tipico.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean) as number[][];
        if (pts.length < 2) return "";
        return `M ${pts[0][0]} ${base} ` + pts.map((q) => `L ${q[0]} ${q[1]}`).join(" ") + ` L ${pts[pts.length - 1][0]} ${base} Z`;
    })();
    const iAhora = p.ahora.tramo - a;
    const s = sobre != null ? tramos[sobre] : null;
    const cada = Math.max(1, Math.round(N / 10));

    return (
        <div className="rounded-[14px] border border-border bg-card p-5 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-3">
                <h2 className="text-[15px] font-bold">Hoy contra un {DIAS_LARGOS[diaHoy()]} típico</h2>
                <div className="ml-auto flex items-center gap-4 text-[11.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-sm bg-foreground/15" />Típico</span>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[3px] w-3.5 rounded-full bg-[var(--accion)]" />Hoy</span>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[3px] w-3.5 rounded-full bg-[var(--accion)] opacity-50" />Lo que se espera</span>
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[3px] w-3.5 rounded-full bg-[var(--mal)]" />Límite {p.limite}</span>
                </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onPointerLeave={() => setSobre(null)}
                onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const fx = ((e.clientX - r.left) / r.width) * W; setSobre(Math.min(N - 1, Math.max(0, Math.round(((fx - IZQ) / (W - IZQ - DER)) * (N - 1))))); }}>
                {[0, 0.5, 1].map((g) => (
                    <g key={g}>
                        <line x1={IZQ} x2={W - DER} y1={ARR + g * (H - ARR - ABA)} y2={ARR + g * (H - ARR - ABA)} className="stroke-border" strokeDasharray={g === 1 ? undefined : "3 5"} />
                        <text x={IZQ - 6} y={ARR + g * (H - ARR - ABA) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{Math.round(max * (1 - g))}</text>
                    </g>
                ))}
                {areaTipico && <path d={areaTipico} className="fill-foreground/10" />}
                <line x1={IZQ} x2={W - DER} y1={y(p.limite)} y2={y(p.limite)} stroke="var(--mal)" strokeWidth={1.2} strokeDasharray="6 4" />
                <path d={linea(tramos.map((t) => t.ajustado))} fill="none" stroke="var(--accion)" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="5 4" />
                <path d={linea(tramos.map((t) => t.real))} fill="none" stroke="var(--accion)" strokeWidth={2.4} strokeLinejoin="round" />
                {iAhora >= 0 && iAhora < N && <line x1={x(iAhora)} x2={x(iAhora)} y1={ARR} y2={base} className="stroke-foreground/40" strokeDasharray="2 3" />}
                {tramos.map((t, i) => i % cada === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">{hhmm(t.tramo)}</text> : null)}
                {s && sobre != null && <line x1={x(sobre)} x2={x(sobre)} y1={ARR} y2={base} className="stroke-foreground/30" pointerEvents="none" />}
            </svg>
            <div className="mt-1 min-h-[18px] text-[12px] text-muted-foreground tabular-nums">
                {s ? <span><b className="text-foreground">{hhmm(s.tramo)}</b> · típico {s.tipico ?? "—"}{s.real != null ? ` · hoy ${s.real}` : ""}{s.ajustado != null ? ` · se espera ${s.ajustado}` : ""} personas en promedio</span>
                    : <span>Promedio de personas en la zona cada 15 min. Lo típico sale de las últimas 4 semanas del mismo día; lo esperado lo ajusta a cómo viene hoy.</span>}
            </div>
        </div>
    );
}

/* ── Calidad del dato y permanencia ─────────────────────────────────────────── */

function TarjetaCalidad({ p }: { p: Pronostico }) {
    const c = p.calidad;
    return (
        <div className="rounded-[14px] border border-border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2">
                <ShieldCheck size={16} className={`tono-${c.tono}`} />
                <h2 className="text-[15px] font-bold">Calidad del dato</h2>
                <span className={cn("ml-auto text-[11.5px] font-bold px-2 py-0.5 rounded-full border", `chip-${c.tono}`)}>{c.resumen}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                <Dato rotulo="Parpadeo del aforo" valor={c.parpadeoPct != null ? `${c.parpadeoPct}%` : "—"} />
                <Dato rotulo="Entradas / salidas" valor={`${c.entradas} / ${c.salidas}`} />
                <Dato rotulo="Con datos" valor={c.coberturaPct != null ? `${c.coberturaPct}%` : "—"} />
                <Dato rotulo="Validado a mano" valor={c.validadas ? `±1: ${c.dentroDeUnoPct}% (${c.validadas})` : "sin validar"} />
            </div>
            {!!c.motivos.length && <ul className="space-y-1 text-[12px] text-muted-foreground list-disc pl-4">{c.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
            <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild className="gap-1.5"><Link href="/admin/validar-conteo"><CheckCheck size={14} /> Validar conteo</Link></Button>
                <Button size="sm" variant="ghost" asChild><Link href="/admin/calibracion-aforo">Calibración</Link></Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Últimos 7 días.</p>
        </div>
    );
}

function TarjetaPermanencia({ p }: { p: Pronostico }) {
    const h = p.permanencia.hoy, s = p.permanencia.semana;
    return (
        <div className="rounded-[14px] border border-border bg-card p-5 space-y-3">
            <div className="flex items-center gap-2"><Hourglass size={16} className="text-muted-foreground" /><h2 className="text-[15px] font-bold">Permanencia media</h2></div>
            <div className="grid grid-cols-2 gap-2">
                <Grande rotulo="Hoy" valor={h.min != null ? `${h.min} min` : "—"} pie={h.gentePromedio != null ? `${h.gentePromedio} personas en promedio · ${h.salidasPorHora}/h` : ""} />
                <Grande rotulo="7 días" valor={s.min != null ? `${s.min} min` : "—"} pie={s.gentePromedio != null ? `${s.gentePromedio} personas · ${s.salidasPorHora}/h` : ""} />
            </div>
            <p className="text-[11px] text-muted-foreground">Cuánto está, en promedio, una persona en la zona: gente promedio ÷ salidas por minuto (ley de Little). Vale si las salidas se cuentan bien; ver Calidad del dato.</p>
        </div>
    );
}

function Dato({ rotulo, valor }: { rotulo: string; valor: string }) {
    return <div className="rounded-[10px] border border-border px-3 py-2"><div className="text-[11px] text-muted-foreground">{rotulo}</div><div className="font-semibold tabular-nums">{valor}</div></div>;
}
function Grande({ rotulo, valor, pie }: { rotulo: string; valor: string; pie?: string }) {
    return <div className="rounded-[10px] border border-border px-3 py-2.5"><div className="text-[11px] text-muted-foreground">{rotulo}</div><div className="text-[22px] font-bold tabular-nums leading-tight">{valor}</div>{pie && <div className="text-[11px] text-muted-foreground tabular-nums">{pie}</div>}</div>;
}

/* ── Semana típica ──────────────────────────────────────────────────────────── */

function MapaSemana({ p }: { p: Pronostico }) {
    const conDatos = p.semana.filter((s) => s.prom != null);
    const ks = conDatos.map((s) => s.tramo);
    const a = ks.length ? Math.max(0, Math.min(...ks) - 1) : 28, b = ks.length ? Math.min(95, Math.max(...ks) + 1) : 80;
    const cols = Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const [sobre, setSobre] = useState<{ dia: number; k: number } | null>(null);
    const celda = (dia: number, k: number) => p.semana[(dia - 1) * 96 + k];
    const s = sobre ? celda(sobre.dia, sobre.k) : null;
    return (
        <div className="rounded-[14px] border border-border bg-card p-5 min-w-0">
            <div className="flex items-center gap-2 mb-3"><CalendarClock size={16} className="text-muted-foreground" /><h2 className="text-[15px] font-bold">Semana típica</h2>
                <span className="ml-auto text-[11.5px] text-muted-foreground">Más intenso = más gente · borde rojo = suele llegar al límite</span></div>
            {!conDatos.length ? <p className="text-[12.5px] text-muted-foreground py-6 text-center">Todavía no hay historia suficiente.</p> : (
                <div className="overflow-x-auto">
                    <div className="grid gap-[2px] min-w-[640px]" style={{ gridTemplateColumns: `36px repeat(${cols.length}, minmax(0,1fr))` }} onPointerLeave={() => setSobre(null)}>
                        {[1, 2, 3, 4, 5, 6, 7].map((dia) => (
                            <div key={dia} className="contents">
                                <div className={cn("text-[11px] text-muted-foreground self-center", dia === diaHoy() && "text-foreground font-semibold")}>{DIAS[dia]}</div>
                                {cols.map((k) => {
                                    const c = celda(dia, k);
                                    const f = c.prom != null ? Math.min(1, c.prom / Math.max(1, p.limite)) : 0;
                                    return <div key={k} onPointerEnter={() => setSobre({ dia, k })}
                                        className={cn("h-6 rounded-[3px]", c.prom == null && "bg-muted/40", (c.sobrePct ?? 0) >= 34 && "ring-1 ring-[var(--mal)]")}
                                        style={c.prom != null ? { background: `color-mix(in oklab, var(--accion) ${Math.round(12 + f * 80)}%, transparent)` } : undefined} />;
                                })}
                            </div>
                        ))}
                        <div />
                        {cols.map((k) => <div key={k} className="text-[9.5px] text-muted-foreground tabular-nums text-center">{k % 4 === 0 ? hhmm(k).slice(0, 2) : ""}</div>)}
                    </div>
                </div>
            )}
            <div className="mt-2 min-h-[18px] text-[12px] text-muted-foreground tabular-nums">
                {s && sobre ? <span><b className="text-foreground">{DIAS_LARGOS[sobre.dia]} {hhmm(sobre.k)}</b> · {s.prom ?? "—"} personas en promedio · llega al límite el {s.sobrePct ?? 0}% de los días ({s.muestras} días medidos)</span> : <span>Promedio de las últimas 4 semanas, cada 15 min.</span>}
            </div>
        </div>
    );
}

function Franjas({ p }: { p: Pronostico }) {
    return (
        <div className="rounded-[14px] border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3"><Flame size={16} className="tono-aviso" /><h2 className="text-[15px] font-bold">Cuándo reforzar</h2></div>
            {!p.franjas.length ? (
                <p className="text-[12.5px] text-muted-foreground">No hay franjas que se llenen seguido (al menos 1 de cada 3 días) en las últimas 4 semanas.</p>
            ) : (
                <ul className="divide-y divide-border">
                    {p.franjas.map((f, i) => (
                        <li key={i} className="py-2.5 flex items-center gap-3">
                            <span className="w-10 text-[12px] font-semibold capitalize">{DIAS[f.dia]}</span>
                            <span className="tabular-nums text-[13px] font-semibold">{f.desde}–{f.hasta}</span>
                            <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums">{f.prom} personas</span>
                            <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full border chip-mal tabular-nums">{f.sobrePct}% de los días</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
