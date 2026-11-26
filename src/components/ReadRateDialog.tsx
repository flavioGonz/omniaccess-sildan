"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, ScanLine, TrendingUp, AlertTriangle, RotateCw, Waypoints, Download, ChevronDown, Sparkles, LogIn, LogOut, Moon, Sun, Lightbulb } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { cn } from "@/lib/utils";
import { TASA_AVISO, TASA_BIEN, horaTxt, type Hora } from "@/lib/tasa-lectura";
import type { CamaraTasa, GrupoTasa, Tasas } from "@/lib/tasa-lectura-servidor";

/**
 * Cuánto está leyendo el sistema, y dónde no (rehecho el 26/11).
 *
 * Nico: «cambiar lo de seguimiento por las cámaras LPR interiores —las que ve OmniVision y las ANPR
 * también—; este medidor debe ser más pro: exportar la tasa claramente para ver qué cámara está
 * capturando mal, sugerir correcciones, las horas de fallos más habituales».
 *
 * Dos pestañas porque son dos denominadores (no se suman en un promedio que no significaría nada):
 *  · Accesos — capturas del ANPR de las LPR de entrada y salida, y cuántas rescató OmniVision.
 *  · Interiores — lo que lee OmniVision (ráfagas con lectura) y las LPR de sentido Interior con ANPR.
 * Cada cámara se abre y muestra su tasa hora por hora, día contra noche, sus horas peores y qué
 * conviene corregir (lib/tasa-lectura). Todo sale también en Excel.
 */
const RANGOS = [{ d: 1, l: "Hoy" }, { d: 7, l: "7 días" }, { d: 30, l: "30 días" }];
type Pestana = "accesos" | "interiores";

const tonoTexto = (r: number | null) => (r == null ? "text-muted-foreground" : r >= TASA_BIEN ? "tono-bien" : r >= TASA_AVISO ? "tono-aviso" : "tono-mal");
const tonoBarra = (r: number | null) => (r == null ? "" : r >= TASA_BIEN ? "pleno-bien" : r >= TASA_AVISO ? "pleno-aviso" : "pleno-mal");
const p1 = (r: number | null | undefined) => (r == null ? "—" : `${r}%`);

function Cifra({ rotulo, valor, tono, ayuda }: { rotulo: string; valor: React.ReactNode; tono?: string; ayuda?: string }) {
    return (
        <div className="rounded-[10px] border border-border bg-background/60 p-3" title={ayuda}>
            <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-[0.14em]">{rotulo}</p>
            <p className={cn("text-[22px] font-bold tabular-nums leading-tight", tono || "text-foreground")}>{valor}</p>
        </div>
    );
}

/** Las 24 horas en una tira: cada celda, el color de su tasa (gris si hubo pocos intentos). */
function TiraHoras({ horas, alto = 22 }: { horas: Hora[]; alto?: number }) {
    return (
        <div>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                {horas.map((h) => (
                    <div key={h.hour} title={`${horaTxt(h.hour)} · ${h.ratePct != null ? `${h.ratePct}%` : "sin datos"} · ${h.read}/${h.total}`}
                        className={cn("rounded-[3px]", h.total >= 5 ? tonoBarra(h.ratePct) : h.total ? "bg-muted-foreground/25" : "bg-muted")} style={{ height: alto, opacity: h.total >= 5 ? 1 : 0.6 }} />
                ))}
            </div>
            <div className="mt-0.5 flex justify-between text-[8.5px] text-muted-foreground tabular-nums"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </div>
    );
}

function FilaCamara({ c, abierta, alAbrir }: { c: CamaraTasa; abierta: boolean; alAbrir: () => void }) {
    const Ico = c.metodo === "omnivision" ? Sparkles : c.direction === "EXIT" ? LogOut : c.direction === "INTERIOR" ? Waypoints : LogIn;
    const grave = c.sugerencias.find((s) => s.gravedad !== "info");
    return (
        <div className={cn("rounded-[10px] border transition-colors", abierta ? "border-[var(--accion)]/40 bg-background/60" : "border-border")}>
            <button type="button" onClick={alAbrir} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-muted"><Ico size={15} className={c.metodo === "omnivision" ? "text-[var(--accion)]" : "text-muted-foreground"} /></span>
                <span className="min-w-0 w-44 shrink-0">
                    <span className="block truncate text-[13px] font-semibold">{c.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{c.metodo === "omnivision" ? "OmniVision" : "ANPR de la cámara"} · {c.read}/{c.total}</span>
                </span>
                <span className="flex-1 min-w-0 hidden sm:block"><TiraHoras horas={c.horas} alto={14} /></span>
                <span className={cn("w-14 text-right text-[15px] font-bold tabular-nums", tonoTexto(c.ratePct))}>{p1(c.ratePct)}</span>
                {grave ? <span className={cn("hidden md:inline-flex w-36 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold truncate", grave.gravedad === "mal" ? "chip-mal" : "chip-aviso")}><AlertTriangle size={11} className="shrink-0" /><span className="truncate">{grave.titulo}</span></span> : <span className="hidden md:block w-36" />}
                <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", abierta && "rotate-180")} />
            </button>
            {abierta && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                    <TiraHoras horas={c.horas} alto={26} />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Cifra rotulo="De día" valor={<span className="inline-flex items-center gap-1"><Sun size={14} className="text-amber-500" />{p1(c.dia)}</span>} tono={tonoTexto(c.dia)} />
                        <Cifra rotulo="De noche" valor={<span className="inline-flex items-center gap-1"><Moon size={14} className="text-indigo-400" />{p1(c.noche)}</span>} tono={tonoTexto(c.noche)} />
                        {c.metodo === "anpr"
                            ? <Cifra rotulo="Rescató OmniVision" valor={c.recuperadas ?? 0} ayuda="De las que la cámara no leyó, cuántas leyó OmniVision después." />
                            : <Cifra rotulo="Por escena" valor={p1(c.minutosEscenaPct)} tono={(c.minutosEscenaPct ?? 0) >= 30 ? "tono-mal" : undefined} ayuda="Parte del tiempo que disparó por cambio de imagen (respaldo) en vez de por aviso de la cámara." />}
                        {c.metodo === "anpr"
                            ? <Cifra rotulo="Sin leer" valor={c.unread} tono={c.unread ? "tono-mal" : undefined} />
                            : <Cifra rotulo="Chapas distintas" valor={c.lecturasUnicas ?? 0} ayuda="Matrículas distintas que leyó en el período." />}
                    </div>
                    {c.metodo === "omnivision" && (
                        <p className="text-[11px] text-muted-foreground">Fuera de zona: <b className="text-foreground">{c.fueraDeLinea ?? 0}</b> · sin cuota: <b className="text-foreground">{c.frenados ?? 0}</b> · sin lectura confiable: <b className="text-foreground">{c.descartes ?? 0}</b> · reconexiones: <b className="text-foreground">{c.reconexiones ?? 0}</b></p>
                    )}
                    {c.peores.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                            <span className="font-semibold text-muted-foreground">Horas con más fallas:</span>
                            {c.peores.map((h) => <span key={h.hour} className={cn("rounded-full px-2 py-0.5 font-bold tabular-nums", h.ratePct != null && h.ratePct < TASA_AVISO ? "chip-mal" : "chip-aviso")}>{horaTxt(h.hour)} · {p1(h.ratePct)}</span>)}
                        </div>
                    )}
                    {c.sugerencias.length > 0 && (
                        <ul className="space-y-1.5">
                            {c.sugerencias.map((s, i) => (
                                <li key={i} className={cn("flex items-start gap-2 rounded-[8px] px-2.5 py-2 text-[12px]", s.gravedad === "mal" ? "bg-[color-mix(in_oklab,var(--mal)_8%,transparent)]" : s.gravedad === "aviso" ? "bg-[color-mix(in_oklab,var(--aviso)_9%,transparent)]" : "bg-muted/60")}>
                                    <Lightbulb size={14} className={cn("mt-0.5 shrink-0", s.gravedad === "mal" ? "tono-mal" : s.gravedad === "aviso" ? "tono-aviso" : "text-muted-foreground")} />
                                    <span><b>{s.titulo}.</b> <span className="text-muted-foreground">{s.detalle}</span></span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function Grupo({ g, pestana }: { g: GrupoTasa; pestana: Pestana }) {
    const [abierta, setAbierta] = useState<string | null>(null);
    const peoresGlobal = useMemo(() => g.perHour.filter((h) => h.total >= 5 && h.ratePct != null).sort((a, b) => a.ratePct! - b.ratePct!).slice(0, 3), [g]);
    const conProblemas = g.camaras.filter((c) => c.sugerencias.some((s) => s.gravedad === "mal")).length;
    if (!g.hayDatos) return (
        <div className="py-12 text-center space-y-2">
            {pestana === "interiores" ? <Waypoints size={20} className="mx-auto text-muted-foreground" /> : <ScanLine size={20} className="mx-auto text-muted-foreground" />}
            <p className="text-[13px] font-semibold">{pestana === "interiores" ? "Todavía no hay lecturas de interiores" : "Sin capturas en el rango"}</p>
            <p className="text-[11.5px] text-muted-foreground max-w-md mx-auto">{pestana === "interiores" ? "Aparecen las cámaras que lee OmniVision y las LPR con sentido Interior, apenas den sus primeras muestras." : "Probá con un rango más largo."}</p>
        </div>
    );
    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Cifra rotulo="Tasa global" valor={p1(g.overall.ratePct)} tono={tonoTexto(g.overall.ratePct)} />
                <Cifra rotulo={pestana === "interiores" ? "Intentos" : "Capturas"} valor={g.overall.total.toLocaleString("es-UY")} />
                <Cifra rotulo="Leídas" valor={g.overall.read.toLocaleString("es-UY")} tono="tono-bien" />
                <Cifra rotulo="Cámaras a corregir" valor={conProblemas} tono={conProblemas ? "tono-mal" : "tono-bien"} />
            </div>
            <div>
                <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><TrendingUp size={12} /> Por hora del día, todas juntas
                    {peoresGlobal.length > 0 && <span className="ml-auto font-normal">peores: {peoresGlobal.map((h) => `${horaTxt(h.hour)} (${p1(h.ratePct)})`).join(" · ")}</span>}
                </p>
                <TiraHoras horas={g.perHour} alto={34} />
            </div>
            <div>
                <p className="mb-2 text-[11.5px] font-semibold text-muted-foreground">Por cámara <span className="font-normal opacity-80">· peor primero · tocá una para ver qué corregir</span></p>
                <div className="space-y-1.5">
                    {g.camaras.map((c) => { const k = `${c.metodo}:${c.deviceId}`; return <FilaCamara key={k} c={c} abierta={abierta === k} alAbrir={() => setAbierta(abierta === k ? null : k)} />; })}
                </div>
            </div>
        </div>
    );
}

export function ReadRateDialog({ onClose }: { onClose: () => void }) {
    const [days, setDays] = useState(7);
    const [pestana, setPestana] = useState<Pestana>("accesos");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<Tasas | null>(null);

    const cargar = useCallback(() => {
        let vivo = true;
        setLoading(true); setError(null);
        fetch(`/api/lpr/read-rate?days=${days}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(j?.error || `el servidor respondió ${r.status}`); return j as Tasas; })
            .then((j) => { if (vivo) setData(j); })
            // El error se muestra: «no pude preguntar» y «no pasó nada» no pueden verse igual.
            .catch((e) => { if (vivo) { setData(null); setError(e?.message || "no se pudo consultar"); } })
            .finally(() => { if (vivo) setLoading(false); });
        return () => { vivo = false; };
    }, [days]);
    useEffect(() => { let soltar: (() => void) | undefined; const t = setTimeout(() => { soltar = cargar(); }, 0); return () => { clearTimeout(t); soltar?.(); }; }, [cargar]);

    const g = data ? (pestana === "accesos" ? data.accesos : data.interiores) : null;
    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={onClose}>
            <div className="relative w-full max-w-4xl rounded-[14px] bg-card border border-border sombra-flotante overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-border">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="p-2 rounded-[8px] chip-info"><ScanLine size={16} /></div>
                        <div className="min-w-0">
                            <h3 className="text-[14px] font-bold">Tasa de lectura</h3>
                            <p className="text-[11px] text-muted-foreground truncate">{pestana === "accesos" ? "Capturas del ANPR de entradas y salidas, leídas vs. no reconocidas" : "Lo que lee OmniVision y las LPR interiores con ANPR"}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-0.5 rounded-[8px] border border-border bg-background/60 p-0.5">
                        {RANGOS.map((r) => <button key={r.d} onClick={() => setDays(r.d)} className={cn("h-7 px-2.5 rounded-[6px] text-[11px] font-bold", days === r.d ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>{r.l}</button>)}
                    </div>
                    <a href={`/api/lpr/read-rate/export?days=${days}`} className="h-8 px-3 rounded-[6px] bg-[var(--accion)] text-white text-[12px] font-semibold inline-flex items-center gap-1.5 hover:opacity-90" title="Resumen por cámara, tasa hora por hora y la lista de correcciones">
                        <Download size={14} /> Excel
                    </a>
                    <button onClick={onClose} className="h-8 w-8 rounded-[6px] hover:bg-accent text-muted-foreground grid place-items-center" aria-label="Cerrar"><X size={16} /></button>
                </div>

                <div className="flex items-center gap-1 px-5 pt-3">
                    {([["accesos", "Accesos (ANPR)", ScanLine, data?.accesos.camaras.length], ["interiores", "LPR interiores", Waypoints, data?.interiores.camaras.length]] as const).map(([k, rot, I, n]) => (
                        <button key={k} onClick={() => setPestana(k)} className={cn("h-8 px-3 rounded-[6px] text-[12px] font-semibold inline-flex items-center gap-1.5", pestana === k ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-accent")}>
                            <I size={13} /> {rot}{n != null && <span className="tabular-nums text-[10.5px] opacity-70">{n}</span>}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 size={16} className="animate-spin" /> Calculando…</div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-14 gap-3 px-6 text-center">
                        <AlertTriangle size={20} className="tono-mal" />
                        <p className="text-[12.5px] font-semibold">No se pudo calcular la tasa</p>
                        <p className="text-[11.5px] text-muted-foreground max-w-sm">{error}</p>
                        <button onClick={cargar} className="h-8 px-3 rounded-[6px] bg-[var(--accion)] text-white text-[12px] font-semibold inline-flex items-center gap-1.5"><RotateCw size={13} /> Reintentar</button>
                    </div>
                ) : g ? (
                    <div className="p-5 max-h-[74vh] overflow-y-auto">
                        <Grupo key={pestana + days} g={g} pestana={pestana} />
                        <p className="mt-5 text-[10.5px] text-muted-foreground">
                            Verde ≥{TASA_BIEN}% · ámbar {TASA_AVISO}–{TASA_BIEN}% · rojo &lt;{TASA_AVISO}%. Las horas con menos de 5 intentos van en gris: no se juzgan.{" "}
                            {pestana === "interiores" ? "En OmniVision el intento es la ráfaga: una cámara que dispara por escena abre muchas sin auto, y eso baja la tasa sin que el lector falle." : "Una captura sin vehículo (disparo de noche, sombra) no cuenta."}
                        </p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export default ReadRateDialog;
