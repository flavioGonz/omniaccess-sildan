"use client";

import { useCallback, useEffect, useState } from "react";
import { X, ScanLine, Loader2, ArrowRightCircle, ArrowLeftCircle, TrendingUp, AlertTriangle, RotateCw, Radar } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cuánto está leyendo el sistema, y dónde no.
 *
 * ## Por qué hay dos pestañas y no un número
 *
 * Esta pantalla decía "Tasa de lectura ANPR" y mostraba una sola cifra, pero medía
 * únicamente las cámaras de barrera. Las de seguimiento no aparecían, y no por un filtro:
 * para ellas no existía el denominador. En la barrera la cámara dispara siempre y escribe
 * NO_LEIDA cuando no reconoce; en seguimiento una ráfaga seca no deja ninguna fila.
 *
 * Los dos denominadores son distintos —capturas por un lado, ráfagas por el otro— así que
 * van en dos pestañas y no sumados. Un promedio entre las dos no significaría nada, y un
 * número que no significa nada en una pantalla que se llama "tasa" es peor que no tenerlo.
 *
 * ## Qué se arregló de paso
 *
 * - Los colores salían de emerald/amber/red escritos a mano: no cambiaban con el tema y
 *   no eran los tonos del sistema.
 * - El pie decía "rojo <90%", que es lo mismo que dice del ámbar. El umbral es 75.
 * - El `catch` se tragaba el error: si la consulta fallaba, la pantalla mostraba una tasa
 *   de "—" con cero capturas, o sea exactamente lo mismo que un rango sin actividad. Dos
 *   situaciones opuestas —"no pude preguntar" y "no pasó nada"— que se veían igual.
 */

const RANGOS = [{ d: 1, l: "Hoy" }, { d: 7, l: "7 días" }, { d: 30, l: "30 días" }];

/**
 * Los dos umbrales de la escala.
 *
 * No son estética: por debajo de BIEN la cámara empieza a perder vehículos y por debajo de
 * AVISO ya no se puede confiar en el padrón de esa cámara. Están acá con nombre porque
 * aparecían tres veces escritos a mano y el pie de la pantalla contaba uno mal.
 */
const TASA_BIEN = 90;
const TASA_AVISO = 75;

const tonoTexto = (r: number | null) =>
    r == null ? "text-muted-foreground" : r >= TASA_BIEN ? "tono-bien" : r >= TASA_AVISO ? "tono-aviso" : "tono-mal";

const tonoBarra = (r: number | null) =>
    r == null ? "" : r >= TASA_BIEN ? "pleno-bien" : r >= TASA_AVISO ? "pleno-aviso" : "pleno-mal";

type Pestana = "barrera" | "seguimiento";

/** Una fila con nombre, barra y cifras. Igual en las dos pestañas, para que se lean igual. */
function Fila({ nombre, icono, tasa, detalle }: { nombre: string; icono?: React.ReactNode; tasa: number | null; detalle: React.ReactNode }) {
    return (
        <div className="flex items-center gap-3">
            <span className="w-40 shrink-0 flex items-center gap-1.5 text-xs font-semibold text-foreground truncate">
                {icono}
                <span className="truncate">{nombre}</span>
            </span>
            <div className="flex-1 h-4 rounded-full bg-background/70 border border-border/50 overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", tonoBarra(tasa))} style={{ width: `${tasa ?? 0}%`, background: tasa == null ? "var(--muted)" : undefined }} />
            </div>
            <span className={cn("w-12 text-right text-xs font-bold tabular-nums", tonoTexto(tasa))}>{tasa != null ? tasa + "%" : "—"}</span>
            <span className="w-28 text-right text-[10px] text-muted-foreground tabular-nums">{detalle}</span>
        </div>
    );
}

/** Un número grande con su rótulo. */
function Cifra({ rotulo, valor, tono }: { rotulo: string; valor: React.ReactNode; tono?: string }) {
    return (
        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
            <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide">{rotulo}</p>
            <p className={cn("text-2xl font-bold tabular-nums", tono || "text-foreground")}>{valor}</p>
        </div>
    );
}

export function ReadRateDialog({ onClose }: { onClose: () => void }) {
    const [days, setDays] = useState(7);
    const [pestana, setPestana] = useState<Pestana>("barrera");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any>(null);

    const cargar = useCallback(() => {
        let vivo = true;
        setLoading(true); setError(null);
        fetch(`/api/lpr/read-rate?days=${days}`, { cache: "no-store" })
            .then(async (r) => {
                const j = await r.json().catch(() => null);
                if (!r.ok || !j?.ok) throw new Error(j?.error || `el servidor respondió ${r.status}`);
                return j;
            })
            .then((j) => { if (vivo) setData(j); })
            // El error se muestra. Una tasa vacía por un fallo de consulta y una tasa vacía
            // porque no hubo capturas se ven igual, y son cosas opuestas: de una se espera,
            // de la otra se reintenta.
            .catch((e) => { if (vivo) { setData(null); setError(e?.message || "no se pudo consultar"); } })
            .finally(() => { if (vivo) setLoading(false); });
        return () => { vivo = false; };
    }, [days]);

    useEffect(() => cargar(), [cargar]);

    const overall = data?.overall;
    const perCamera: any[] = data?.perCamera || [];
    const perHour: any[] = data?.perHour || [];
    const seg = data?.seguimiento;
    const segCam: any[] = seg?.perCamera || [];
    const segHora: any[] = seg?.perHour || [];

    const enBarrera = pestana === "barrera";
    const horas = enBarrera ? perHour : segHora;

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={onClose}>
            <div className="relative w-full max-w-3xl rounded-2xl bg-card border border-border sombra-flotante overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg chip-info border"><ScanLine size={16} /></div>
                        <div>
                            <h3 className="text-sm font-bold text-foreground">Tasa de lectura</h3>
                            <p className="text-[10px] text-muted-foreground">
                                {enBarrera ? "Capturas de barrera leídas vs no reconocidas" : "Ráfagas del seguimiento que dieron una lectura"}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-0.5 bg-background/60 p-0.5 rounded-lg border border-border/60">
                            {RANGOS.map((r) => (
                                <button key={r.d} onClick={() => setDays(r.d)}
                                    className={cn("h-6 px-2 rounded-md text-[10px] font-bold", days === r.d ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                    {r.l}
                                </button>
                            ))}
                        </div>
                        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-accent text-muted-foreground flex items-center justify-center"><X size={16} /></button>
                    </div>
                </div>

                {/* Las dos mediciones. Separadas porque tienen denominadores distintos. */}
                <div className="flex items-center gap-1 px-5 pt-3">
                    <button onClick={() => setPestana("barrera")}
                        className={cn("h-7 px-3 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5", enBarrera ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-accent")}>
                        <ScanLine size={12} /> Barrera (ANPR)
                    </button>
                    <button onClick={() => setPestana("seguimiento")}
                        className={cn("h-7 px-3 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5", !enBarrera ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-accent")}>
                        <Radar size={12} /> Seguimiento
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 size={16} className="animate-spin" /> Calculando…</div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-14 gap-3 px-6 text-center">
                        <AlertTriangle size={20} className="tono-mal" />
                        <p className="text-xs text-foreground font-semibold">No se pudo calcular la tasa</p>
                        <p className="text-[11px] text-muted-foreground max-w-sm">{error}</p>
                        <button onClick={cargar} className="accion h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5">
                            <RotateCw size={13} /> Reintentar
                        </button>
                    </div>
                ) : (
                    <div className="p-5 space-y-5 max-h-[72vh] overflow-y-auto">
                        {enBarrera ? (
                            <>
                                <div className="grid grid-cols-4 gap-3">
                                    <Cifra rotulo="Tasa global" valor={overall?.ratePct != null ? overall.ratePct + "%" : "—"} tono={tonoTexto(overall?.ratePct ?? null)} />
                                    <Cifra rotulo="Capturas" valor={overall?.total ?? 0} />
                                    <Cifra rotulo="Leídas" valor={overall?.read ?? 0} tono="tono-bien" />
                                    <Cifra rotulo="No leídas" valor={overall?.unread ?? 0} tono="tono-mal" />
                                </div>

                                <div>
                                    <p className="text-[11px] font-semibold text-muted-foreground mb-2">Por cámara <span className="text-[9px] opacity-70">· peor primero</span></p>
                                    <div className="space-y-1.5">
                                        {perCamera.length === 0 && <p className="text-xs text-muted-foreground py-3">Sin capturas en el rango</p>}
                                        {perCamera.map((c) => (
                                            <Fila key={c.deviceId || c.name} nombre={c.name} tasa={c.ratePct}
                                                icono={c.direction === "ENTRY" ? <ArrowRightCircle size={12} className="tono-bien shrink-0" /> : c.direction === "EXIT" ? <ArrowLeftCircle size={12} className="tono-aviso shrink-0" /> : null}
                                                detalle={<>{c.read}/{c.total} <span className="tono-mal">({c.unread})</span></>} />
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : !seg?.hayDatos ? (
                            <div className="py-10 text-center space-y-2">
                                <Radar size={20} className="mx-auto text-muted-foreground" />
                                <p className="text-xs font-semibold text-foreground">Todavía no hay muestras de seguimiento</p>
                                <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
                                    La pasarela guarda una muestra por cámara y por minuto. Si acaba de desplegarse, el
                                    primer dato aparece dentro del minuto; si no hay cámaras de seguimiento dadas de alta,
                                    esta pestaña queda vacía a propósito.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-4 gap-3">
                                    <Cifra rotulo="Tasa global" valor={seg.overall.ratePct != null ? seg.overall.ratePct + "%" : "—"} tono={tonoTexto(seg.overall.ratePct)} />
                                    <Cifra rotulo="Ráfagas" valor={seg.overall.disparos} />
                                    <Cifra rotulo="Con lectura" valor={seg.overall.lecturas} tono="tono-bien" />
                                    <Cifra rotulo="Secas" valor={seg.overall.descartes} tono="tono-mal" />
                                </div>

                                <div>
                                    <p className="text-[11px] font-semibold text-muted-foreground mb-2">Por cámara <span className="text-[9px] opacity-70">· peor primero</span></p>
                                    <div className="space-y-1.5">
                                        {segCam.map((c) => (
                                            <Fila key={c.deviceId} nombre={c.name} tasa={c.ratePct}
                                                icono={<Radar size={12} className="text-muted-foreground shrink-0" />}
                                                detalle={<>{c.lecturas}/{c.disparos} <span className="tono-mal">({c.descartes})</span></>} />
                                        ))}
                                    </div>
                                </div>

                                {/* Los dos números que explican una tasa rara antes de salir a revisar la camara. */}
                                {(seg.overall.fueraDeLinea > 0 || seg.overall.frenados > 0) && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
                                            <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide">Fuera de zona</p>
                                            <p className="text-lg font-bold text-foreground tabular-nums">{seg.overall.fueraDeLinea}</p>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                Matrículas leídas bien y descartadas por caer afuera de la zona o la línea.
                                                No cuentan como fallo: son la decisión del calibrador.
                                            </p>
                                        </div>
                                        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
                                            <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide">Salteadas por cuota</p>
                                            <p className="text-lg font-bold text-foreground tabular-nums">{seg.overall.frenados}</p>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                Ráfagas que no se abrieron por el presupuesto de inferencias por minuto.
                                                Explican un conteo bajo con la tasa intacta.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {(enBarrera || seg?.hayDatos) && (
                            <div>
                                <p className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                                    <TrendingUp size={12} /> Tasa por hora del día <span className="text-[9px] opacity-70">· detecta degradación nocturna</span>
                                </p>
                                <div className="flex items-end gap-[3px] h-24 border-b border-border/50 pb-0">
                                    {horas.map((h: any) => {
                                        const base = enBarrera ? h.total : h.disparos;
                                        const parte = enBarrera ? h.read : h.lecturas;
                                        return (
                                            <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                                                <div className={cn("w-full rounded-t transition-all", tonoBarra(h.ratePct))}
                                                    style={{ height: `${base ? (h.ratePct ?? 0) : 0}%`, minHeight: base ? 2 : 0, opacity: base ? 1 : 0.25 }} />
                                                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover border border-border rounded px-1.5 py-1 text-[9px] whitespace-nowrap z-10 sombra-flotante">
                                                    {String(h.hour).padStart(2, "0")}h · {h.ratePct != null ? h.ratePct + "%" : "s/d"} · {parte}/{base}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex justify-between text-[8px] text-muted-foreground mt-1"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span></div>
                            </div>
                        )}

                        <p className="text-[10px] text-muted-foreground">
                            Verde ≥{TASA_BIEN}% · ámbar {TASA_AVISO}–{TASA_BIEN}% · rojo &lt;{TASA_AVISO}%.{" "}
                            {enBarrera
                                ? "Las cámaras y horas en rojo son candidatas a recalibrar (obturador y anti-brillo, desde el botón Calibrar)."
                                : "Acá el rojo se revisa en el calibrador de la cámara: casi siempre es la zona o la línea mal puestas, no el lector."}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ReadRateDialog;
