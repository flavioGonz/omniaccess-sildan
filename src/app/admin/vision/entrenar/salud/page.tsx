"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, Cpu, Gauge, Loader2, RefreshCcw, Snowflake, Thermometer, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, hora, horaSeg, hace } from "@/lib/fechas";

/**
 * Salud del equipo: cómo se comporta la GPU (y la CPU) del servidor, sobre todo al entrenar.
 *
 * El 11/10 el host se colgó sin dejar rastro, y la sospecha es térmica. Esta pantalla muestra lo
 * que mide el entrenador cada 5 s mientras entrena y cada minuto en reposo (scripts/salud-equipo.js):
 * temperatura de GPU y CPU, consumo, uso y memoria de la GPU, con las rayas donde el entrenador
 * congela el entrenamiento para que se enfríe y donde lo corta. Los tramos entrenando van
 * sombreados; los congelados, más fuerte. Un hueco en las líneas es tiempo sin muestras.
 */

type Punto = { ts: number; gt: number | null; ct: number | null; w: number | null; wMax: number | null; uso: number | null; mem: number | null; memTotal: number | null; estado: string; motivos: string[] };
type Limites = { gpu: { enfriar: number; reanudar: number; cortar: number }; cpu: { enfriar: number; reanudar: number; cortar: number }; enfriandoMaxMin: number; arrancarHasta: { gpu: number; cpu: number } };
type Datos = {
    horas: number; desde: number; hasta: number; limites: Limites | null; latido: string | null;
    ahora: { ts: string; estado: string; gpu: any; cpu: any; carga: number; ramLibreGB: number } | null;
    puntos: (Punto | null)[];
    entrenamientos: { id: string; estado: string; desde: string | null; hasta: string | null; error: string | null; fotos: number | null; modelo: string | null; salud: any }[];
    resumen: { muestras: number; gpuMax: number | null; cpuMax: number | null; wMax: number | null; segEntrenando: number; segEnfriando: number };
};

const RANGOS = [{ h: 1, r: "1 h" }, { h: 6, r: "6 h" }, { h: 24, r: "24 h" }, { h: 72, r: "3 días" }, { h: 168, r: "7 días" }];
/** Cada cuánto se refresca: el entrenador mide cada 5 s entrenando y cada minuto en reposo. */
const REFRESCO_MS = 20_000;
const COLOR = { gpu: "var(--grafico-1)", cpu: "var(--grafico-2)", w: "var(--grafico-4)", mem: "var(--grafico-3)" };

export default function SaludEquipo() {
    const [horas, setHoras] = useState(24);
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [cursor, setCursor] = useState<number | null>(null);

    const traer = useCallback(async () => {
        setCargando(true);
        try {
            const r = await fetch(`/api/vision/entrenar/salud?horas=${horas}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "sin respuesta"); }
        finally { setCargando(false); }
    }, [horas]);
    useEffect(() => { traer(); const iv = setInterval(traer, REFRESCO_MS); return () => clearInterval(iv); }, [traer]);

    const L = datos?.limites;
    const puntos = datos?.puntos || [];
    const reales = puntos.filter((p): p is Punto => !!p);
    const enCursor = cursor != null ? reales.reduce<Punto | null>((a, p) => (!a || Math.abs(p.ts - cursor) < Math.abs(a.ts - cursor) ? p : a), null) : null;
    const memTotal = reales.find((p) => p.memTotal)?.memTotal || null;
    const wTope = reales.find((p) => p.wMax)?.wMax || null;

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <Link href="/admin/vision/entrenar/objetos" aria-label="Volver" className="h-9 w-9 grid place-items-center rounded-[10px] border border-border hover:bg-accent"><ArrowLeft size={16} /></Link>
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><Activity size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Salud del equipo</h1>
                    <p className="text-[12.5px] text-muted-foreground leading-snug">Temperatura, consumo y uso de la GPU y temperatura de la CPU del servidor, medidos cada 5 s mientras se entrena y cada minuto en reposo. Con esto se ve si entrenar lo exige de más.</p>
                </div>
                <div className="flex items-center rounded-full border border-border p-0.5">
                    {RANGOS.map((r) => (
                        <button key={r.h} type="button" onClick={() => setHoras(r.h)} aria-pressed={horas === r.h}
                            className={cn("h-8 px-3 rounded-full text-[12.5px] font-semibold", horas === r.h ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{r.r}</button>
                    ))}
                </div>
                <button type="button" onClick={traer} aria-label="Actualizar" className="h-9 w-9 grid place-items-center rounded-[8px] border border-border hover:bg-accent">
                    {cargando ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                </button>
            </div>

            {error && <div className="rounded-[10px] border border-border bg-card px-4 py-3 text-[13px] flex items-center gap-3"><AlertTriangle size={16} className="tono-mal" /> No se pudo traer la salud del equipo: {error} <button type="button" onClick={traer} className="ml-auto text-[var(--accion)] font-semibold">Reintentar</button></div>}

            {/* Ahora */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-px rounded-[10px] border border-border bg-border overflow-hidden">
                <Cifra icono={Thermometer} rotulo="GPU" valor={datos?.ahora?.gpu?.t != null ? `${datos.ahora.gpu.t} °C` : "—"}
                    tono={tonoTemp(datos?.ahora?.gpu?.t, L?.gpu)} sub={L ? `congela en ${L.gpu.enfriar} · corta en ${L.gpu.cortar}` : undefined} />
                <Cifra icono={Cpu} rotulo="CPU (paquete)" valor={datos?.ahora?.cpu?.t != null ? `${Math.round(datos.ahora.cpu.t)} °C` : "—"}
                    tono={tonoTemp(datos?.ahora?.cpu?.t, L?.cpu)} sub={L ? `congela en ${L.cpu.enfriar} · corta en ${L.cpu.cortar}` : undefined} />
                <Cifra icono={Zap} rotulo="Consumo GPU" valor={datos?.ahora?.gpu?.w != null ? `${Math.round(datos.ahora.gpu.w)} W` : "—"} sub={datos?.ahora?.gpu?.wMax ? `tope ${datos.ahora.gpu.wMax} W` : undefined} />
                <Cifra icono={Gauge} rotulo="Uso · memoria GPU" valor={datos?.ahora?.gpu?.uso != null ? `${datos.ahora.gpu.uso} %` : "—"}
                    sub={datos?.ahora?.gpu?.mem != null ? `${(datos.ahora.gpu.mem / 1024).toFixed(1)} de ${((datos.ahora.gpu.memTotal || 0) / 1024).toFixed(1)} GB` : undefined} />
                <Cifra icono={datos?.ahora?.estado === "enfriando" ? Snowflake : Activity} rotulo="Estado"
                    valor={!datos?.ahora ? "Sin datos" : datos.ahora.estado === "entrenando" ? "Entrenando" : datos.ahora.estado === "enfriando" ? "Enfriando" : "En reposo"}
                    tono={datos?.ahora?.estado === "enfriando" ? "tono-info" : undefined}
                    sub={datos?.ahora ? `medido ${hace(datos.ahora.ts)}${datos.ahora.gpu?.motivos?.length ? ` · ${datos.ahora.gpu.motivos.join(", ")}` : ""}` : "el entrenador todavía no midió"} />
            </div>

            {/* Las curvas */}
            <section className="rounded-[10px] border border-border bg-card p-4 space-y-4">
                <div className="flex items-center gap-4 flex-wrap text-[12px] text-muted-foreground">
                    <span className="font-semibold text-foreground text-[13px]">Últimas {RANGOS.find((r) => r.h === horas)?.r}</span>
                    <span>{datos?.resumen.muestras ?? 0} muestras</span>
                    {datos?.resumen.segEntrenando ? <span>entrenando {duracion(datos.resumen.segEntrenando)}{datos.resumen.segEnfriando ? `, ${duracion(datos.resumen.segEnfriando)} congelado para enfriar` : ""}</span> : <span>sin entrenamientos en el rango</span>}
                    <span className="ml-auto flex items-center gap-3">
                        <Leyenda color="color-mix(in oklab, var(--accion) 14%, transparent)" cuadro>entrenando</Leyenda>
                        <Leyenda color="color-mix(in oklab, var(--info) 30%, transparent)" cuadro>congelado (enfriando)</Leyenda>
                    </span>
                </div>
                {!datos ? <div className="h-[420px] rounded-[8px] bg-muted animate-pulse" />
                    : !reales.length ? (
                        <div className="h-[200px] grid place-items-center text-center text-[13px] text-muted-foreground">
                            <span>Todavía no hay mediciones en este rango.<br />El entrenador mide desde que se actualizó (cada minuto en reposo, cada 5 s entrenando).</span>
                        </div>
                    ) : (<>
                        <Grafico titulo="Temperatura" unidad="°C" desde={datos.desde} hasta={datos.hasta} puntos={puntos} cursor={cursor} setCursor={setCursor}
                            series={[{ nombre: "GPU", color: COLOR.gpu, valor: (p) => p.gt }, { nombre: "CPU", color: COLOR.cpu, valor: (p) => p.ct }]}
                            dominio={[30, 100]}
                            rayas={L ? [
                                { v: L.gpu.enfriar, rotulo: `GPU congela ${L.gpu.enfriar}`, color: COLOR.gpu }, { v: L.gpu.cortar, rotulo: `GPU corta ${L.gpu.cortar}`, color: COLOR.gpu, fuerte: true },
                                { v: L.cpu.enfriar, rotulo: `CPU congela ${L.cpu.enfriar}`, color: COLOR.cpu }, { v: L.cpu.cortar, rotulo: `CPU corta ${L.cpu.cortar}`, color: COLOR.cpu, fuerte: true },
                            ] : []} />
                        <Grafico titulo="Consumo de la GPU" unidad="W" desde={datos.desde} hasta={datos.hasta} puntos={puntos} cursor={cursor} setCursor={setCursor}
                            series={[{ nombre: "Consumo", color: COLOR.w, valor: (p) => p.w }]} dominio={[0, Math.max(80, wTope || 0)]}
                            rayas={wTope ? [{ v: wTope, rotulo: `tope ${wTope} W`, color: COLOR.w }] : []} />
                        <Grafico titulo="Uso de la GPU" unidad="%" desde={datos.desde} hasta={datos.hasta} puntos={puntos} cursor={cursor} setCursor={setCursor}
                            series={[{ nombre: "Uso", color: COLOR.gpu, valor: (p) => p.uso }]} dominio={[0, 100]} rayas={[]} />
                        <Grafico titulo="Memoria de la GPU" unidad="GB" desde={datos.desde} hasta={datos.hasta} puntos={puntos} cursor={cursor} setCursor={setCursor}
                            series={[{ nombre: "Memoria", color: COLOR.mem, valor: (p) => (p.mem != null ? Math.round((p.mem / 1024) * 10) / 10 : null) }]}
                            dominio={[0, memTotal ? Math.ceil(memTotal / 1024) : 6]} rayas={memTotal ? [{ v: Math.round((memTotal / 1024) * 10) / 10, rotulo: "total", color: COLOR.mem }] : []} ejeX />
                        {enCursor && (
                            <p className="text-[12px] text-muted-foreground tabular-nums">
                                <b className="text-foreground">{fechaCorta(enCursor.ts)} {horaSeg(enCursor.ts)}</b> · {enCursor.estado}
                                {enCursor.motivos.length ? <span className="tono-aviso"> · reloj bajado por {enCursor.motivos.join(", ")}</span> : null}
                            </p>
                        )}
                    </>)}
            </section>

            {/* Los entrenamientos */}
            <section className="rounded-[10px] border border-border bg-card">
                <div className="px-4 py-3 border-b border-border text-[13px] font-semibold">Entrenamientos en el rango</div>
                {!datos?.entrenamientos.length ? <p className="px-4 py-4 text-[12.5px] text-muted-foreground">Ninguno.</p> : (
                    <table className="w-full text-[12.5px]">
                        <thead className="text-muted-foreground text-left">
                            <tr className="border-b border-border">
                                <th className="font-semibold px-4 py-2">Cuándo</th><th className="font-semibold px-2">Cómo terminó</th><th className="font-semibold px-2">Fotos</th>
                                <th className="font-semibold px-2 text-right">GPU máx.</th><th className="font-semibold px-2 text-right">CPU máx.</th><th className="font-semibold px-2 text-right">Consumo</th>
                                <th className="font-semibold px-2">Enfriado</th><th className="font-semibold px-4">Nota</th>
                            </tr>
                        </thead>
                        <tbody>
                            {datos.entrenamientos.map((t) => {
                                const s = t.salud;
                                return (
                                    <tr key={t.id} className="border-b border-border last:border-0 align-top">
                                        <td className="px-4 py-2 tabular-nums whitespace-nowrap">{t.desde ? `${fechaCorta(t.desde)} ${hora(t.desde)}` : "—"}{t.desde && t.hasta ? ` · ${duracion((Date.parse(t.hasta) - Date.parse(t.desde)) / 1000)}` : ""}</td>
                                        <td className={cn("px-2 py-2 font-semibold", t.estado === "LISTO" ? "tono-bien" : t.estado === "FALLO" ? "tono-mal" : "")}>{ESTADOS[t.estado] || t.estado}</td>
                                        <td className="px-2 py-2 tabular-nums">{t.fotos ?? "—"}</td>
                                        <td className={cn("px-2 py-2 text-right tabular-nums", tonoTemp(s?.max?.gpu, L?.gpu))}>{s?.max?.gpu != null ? `${s.max.gpu} °C` : "—"}</td>
                                        <td className={cn("px-2 py-2 text-right tabular-nums", tonoTemp(s?.max?.cpu, L?.cpu))}>{s?.max?.cpu != null ? `${Math.round(s.max.cpu)} °C` : "—"}</td>
                                        <td className="px-2 py-2 text-right tabular-nums">{s?.wPromedio != null ? `${s.wPromedio} W prom.` : "—"}{s?.max?.w != null ? <span className="block text-muted-foreground">{Math.round(s.max.w)} máx.</span> : null}</td>
                                        <td className="px-2 py-2 tabular-nums">{s ? (s.pausas ? `${s.pausas} ${s.pausas === 1 ? "vez" : "veces"} · ${duracion(s.enfriadoSeg)}` : "no hizo falta") : "—"}</td>
                                        <td className="px-4 py-2 text-muted-foreground">{s?.corte ? <span className="tono-mal">Cortado: {s.corte}</span> : !s ? "Antes de que se midiera la salud" : ""}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </section>

            {/* Cómo se cuida */}
            {L && (
                <section className="rounded-[10px] border border-border bg-card p-4 text-[12.5px] leading-relaxed space-y-1.5">
                    <div className="text-[13px] font-semibold mb-1">Cómo se cuida el equipo al entrenar</div>
                    <p>No se <b>arranca</b> si la GPU está sobre {L.arrancarHasta.gpu} °C o la CPU sobre {L.arrancarHasta.cpu} °C: queda en cola y espera.</p>
                    <p>Entrenando, si la GPU llega a <b>{L.gpu.enfriar} °C</b> o la CPU a <b>{L.cpu.enfriar} °C</b>, el entrenamiento se <b>congela</b> (no se pierde nada) hasta que bajen a {L.gpu.reanudar} y {L.cpu.reanudar} °C.</p>
                    <p>Se <b>corta</b> del todo si la GPU llega a {L.gpu.cortar} °C, la CPU a {L.cpu.cortar} °C, la GPU baja el reloj por temperatura o energía, o si congelado no se enfría en {L.enfriandoMaxMin} min.</p>
                    <p className="text-muted-foreground">Además: tope de 3 horas por entrenamiento, 4 núcleos y 6 GB de memoria para el contenedor. Lo de la GPU sale de su hoja (objetivo 83 °C, baja el reloj a 94 °C, se apaga a 97 °C). El vigilante del host (watchdog) no mira temperaturas: reinicia el equipo sólo si se cuelga del todo; estas mediciones quedan escritas en disco hasta el último momento para saber qué pasó.</p>
                </section>
            )}
        </div>
    );
}

const ESTADOS: Record<string, string> = { LISTO: "Listo", FALLO: "Falló", CANCELADO: "Cancelado", EN_COLA: "En cola", PREPARANDO: "Preparando", ENTRENANDO: "Entrenando", EXPORTANDO: "Exportando" };

function tonoTemp(t: number | null | undefined, l?: { enfriar: number; cortar: number }) {
    if (t == null || !l) return undefined;
    return t >= l.cortar ? "tono-mal" : t >= l.enfriar ? "tono-aviso" : undefined;
}
function duracion(seg: number) {
    const s = Math.round(seg);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

function Cifra({ icono: Ico, rotulo, valor, sub, tono }: { icono: any; rotulo: string; valor: string; sub?: string; tono?: string }) {
    return (
        <div className="bg-card px-4 py-3 min-w-0">
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><Ico size={13} /> {rotulo}</div>
            <div className={cn("text-[22px] font-bold tabular-nums tracking-[-0.01em] leading-tight", tono)}>{valor}</div>
            {sub && <div className="text-[11px] text-muted-foreground truncate" title={sub}>{sub}</div>}
        </div>
    );
}

function Leyenda({ color, cuadro, children }: { color: string; cuadro?: boolean; children: React.ReactNode }) {
    return <span className="inline-flex items-center gap-1.5"><span className={cuadro ? "w-3 h-3 rounded-[2px]" : "w-3 h-[2px]"} style={{ background: color }} />{children}</span>;
}

const ALTO = 120;

/**
 * Un gráfico de la serie de tiempo. Small multiples, uno por medida y cada uno con su eje: nada de
 * dos escalas en el mismo gráfico. El cursor es compartido: pasar el mouse por uno marca el mismo
 * instante en todos.
 */
function Grafico({ titulo, unidad, desde, hasta, puntos, series, dominio, rayas, cursor, setCursor, ejeX }: {
    titulo: string; unidad: string; desde: number; hasta: number; puntos: (Punto | null)[];
    series: { nombre: string; color: string; valor: (p: Punto) => number | null }[];
    dominio: [number, number]; rayas: { v: number; rotulo: string; color: string; fuerte?: boolean }[];
    cursor: number | null; setCursor: (t: number | null) => void; ejeX?: boolean;
}) {
    const caja = useRef<HTMLDivElement>(null);
    const reales = puntos.filter((p): p is Punto => !!p);
    // El dominio se estira si algo se pasa (un pico que se sale del gráfico es justo el que importa).
    const [y0, y1] = useMemo(() => {
        const vs = reales.flatMap((p) => series.map((s) => s.valor(p))).filter((v): v is number => v != null);
        return [Math.min(dominio[0], ...vs), Math.max(dominio[1], ...vs)];
    }, [reales, series, dominio]);
    const x = (ts: number) => ((ts - desde) / (hasta - desde)) * 1000;
    const y = (v: number) => ALTO - ((v - y0) / (y1 - y0 || 1)) * ALTO;
    const camino = (s: (typeof series)[number]) => {
        let d = "", abierto = false;
        for (const p of puntos) {
            const v = p ? s.valor(p) : null;
            if (!p || v == null) { abierto = false; continue; }
            d += `${abierto ? "L" : "M"}${x(p.ts).toFixed(1)},${y(v).toFixed(1)}`; abierto = true;
        }
        return d;
    };
    // Tramos entrenando y congelados, de puntos seguidos con el mismo estado.
    const franjas = useMemo(() => {
        const out: { a: number; b: number; estado: string }[] = [];
        for (const p of reales) {
            if (p.estado === "reposo") continue;
            const u = out[out.length - 1];
            if (u && u.estado === p.estado && p.ts - u.b < 5 * 60_000) u.b = p.ts; else out.push({ a: p.ts, b: p.ts, estado: p.estado });
        }
        return out;
    }, [reales]);
    const enCursor = cursor != null ? reales.reduce<Punto | null>((a, p) => (!a || Math.abs(p.ts - cursor) < Math.abs(a.ts - cursor) ? p : a), null) : null;
    const ticks = [y0, (y0 + y1) / 2, y1].map((v) => Math.round(v));
    const marcasX = useMemo(() => {
        const span = hasta - desde, paso = span <= 3_600_000 ? 10 * 60_000 : span <= 6 * 3_600_000 ? 3_600_000 : span <= 86_400_000 ? 4 * 3_600_000 : 86_400_000;
        const out: number[] = []; for (let t = Math.ceil(desde / paso) * paso; t <= hasta; t += paso) out.push(t); return out;
    }, [desde, hasta]);

    return (
        <div className="grid grid-cols-[150px_1fr] gap-3">
            <div className="pt-1">
                <div className="text-[12.5px] font-semibold">{titulo}</div>
                {series.length > 1 && <div className="mt-1 space-y-0.5 text-[11.5px] text-muted-foreground">{series.map((s) => <Leyenda key={s.nombre} color={s.color}>{s.nombre}</Leyenda>)}</div>}
                <div className="mt-1.5 text-[12px] tabular-nums">
                    {enCursor ? series.map((s) => { const v = s.valor(enCursor); return <div key={s.nombre}><span className="text-muted-foreground">{series.length > 1 ? `${s.nombre} ` : ""}</span><b>{v != null ? `${Math.round(v * 10) / 10} ${unidad}` : "—"}</b></div>; })
                        : <span className="text-muted-foreground text-[11px]">pasá el mouse</span>}
                </div>
            </div>
            <div>
                <div ref={caja} className="relative" style={{ height: ALTO }}
                    onMouseMove={(e) => { const r = caja.current!.getBoundingClientRect(); setCursor(desde + ((e.clientX - r.left) / r.width) * (hasta - desde)); }}
                    onMouseLeave={() => setCursor(null)}>
                    <svg viewBox={`0 0 1000 ${ALTO}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
                        {franjas.map((f, i) => (
                            <rect key={i} x={x(f.a)} y={0} width={Math.max(2, x(f.b) - x(f.a))} height={ALTO}
                                fill={f.estado === "enfriando" ? "color-mix(in oklab, var(--info) 30%, transparent)" : "color-mix(in oklab, var(--accion) 14%, transparent)"} />
                        ))}
                        {ticks.map((t) => <line key={t} x1={0} x2={1000} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
                        {rayas.filter((r) => r.v >= y0 && r.v <= y1).map((r) => (
                            <line key={r.rotulo} x1={0} x2={1000} y1={y(r.v)} y2={y(r.v)} stroke={r.color} strokeOpacity={r.fuerte ? 0.9 : 0.55}
                                strokeWidth={1} strokeDasharray={r.fuerte ? "6 3" : "2 4"} vectorEffect="non-scaling-stroke" />
                        ))}
                        {series.map((s) => <path key={s.nombre} d={camino(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
                        {enCursor && <line x1={x(enCursor.ts)} x2={x(enCursor.ts)} y1={0} y2={ALTO} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
                    </svg>
                    {/* Los números del eje y los rótulos de las rayas, en HTML: en el SVG estirado se deformarían. */}
                    {ticks.map((t) => <span key={t} className="absolute -left-1 -translate-x-full -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ top: `${(y(t) / ALTO) * 100}%` }}>{t}</span>)}
                    {rayas.filter((r) => r.v >= y0 && r.v <= y1).map((r) => (
                        <span key={r.rotulo} className="absolute right-1 -translate-y-full text-[9.5px] tabular-nums" style={{ top: `${(y(r.v) / ALTO) * 100}%`, color: r.color }}>{r.rotulo}</span>
                    ))}
                    {enCursor && series.map((s) => { const v = s.valor(enCursor); return v == null ? null : (
                        <span key={s.nombre} className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card pointer-events-none"
                            style={{ left: `${x(enCursor.ts) / 10}%`, top: `${(y(v) / ALTO) * 100}%`, background: s.color }} />); })}
                </div>
                {ejeX && (
                    <div className="relative h-5 mt-1">
                        {marcasX.map((t) => <span key={t} className="absolute -translate-x-1/2 text-[10px] text-muted-foreground tabular-nums" style={{ left: `${x(t) / 10}%` }}>{hasta - desde > 86_400_000 * 1.5 ? fechaCorta(t) : hora(t)}</span>)}
                    </div>
                )}
            </div>
        </div>
    );
}
