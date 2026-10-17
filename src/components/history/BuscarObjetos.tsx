"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Sparkles, Square, X } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Matricula } from "@/components/ui/celdas";
import { fechaHoraSeg } from "@/lib/fechas";
import { getAccessEvent } from "@/app/actions/history";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { SUGERENCIAS_VOCABULARIO } from "@/lib/vocabulario";

/**
 * Buscar un objeto por nombre en las FOTOS del historial (vocabulario abierto, OWLv2).
 *
 * El buscador de arriba encuentra lo que ya se anotó de cada lectura; esto vuelve a mirar las
 * fotos buscando lo que se escriba («carretilla», «escalera»), aunque nadie lo haya anotado.
 * Normalmente busca en el ÍNDICE (todas las fotos del rango en ~1 s; ver indice_vocab.py); lo
 * que el índice todavía no tiene se revisa foto por foto. Sin índice, todo foto por foto:
 *  · respeta el rango y las cámaras de los filtros (sin rango, las últimas 24 h);
 *  · va de a lotes y muestra lo que encuentra mientras avanza; se puede parar;
 *  · revisa como mucho TOPE fotos por búsqueda, las más recientes (y lo dice si hay más).
 */
const TOPE = 1000;
/** Lo que el índice todavía no tiene (lo último) se revisa solo si son pocas fotos; si no, a pedido. */
const PENDIENTES_AUTO = 150;
type EstadoIndice = { indice: { fotos: number; ultimo_ts: number | null; dias: Record<string, number>; mb: number; activa: boolean } | null; conf: { modo: string; vivo?: string; atras?: string; ventana?: string } };

type Hallazgo = { eventId: string; ts: string; camara: string | null; plate: string | null; foto: string | null; objetos: { nombre: string; confianza: number; caja_norm: [number, number, number, number] }[] };
type Consulta = { escrita: string; enviada: string; traducida: boolean };

/** Abre la ficha del evento elegido: se trae el evento y se dispara el diálogo de siempre. */
function AbrirFicha({ id, alCerrar }: { id: string; alCerrar: () => void }) {
    const [ev, setEv] = useState<any>(null);
    const boton = useRef<HTMLButtonElement>(null);
    const cerrar = useRef(alCerrar); cerrar.current = alCerrar;
    useEffect(() => { getAccessEvent(id).then(setEv).catch(() => cerrar.current()); }, [id]);
    useEffect(() => { if (ev) setTimeout(() => boton.current?.click(), 0); }, [ev]);
    if (!ev) return null;
    return <EventDetailsDialog event={ev} timeStatus={null}><button ref={boton} type="button" className="hidden" aria-hidden /></EventDetailsDialog>;
}

export function BuscarObjetos({ desde, hasta, camaras, alCerrar }: { desde: string; hasta: string; camaras: string[]; alCerrar: () => void }) {
    const [texto, setTexto] = useState("");
    const [buscando, setBuscando] = useState(false);
    const [progreso, setProgreso] = useState<{ revisadas: number; total: number | null } | null>(null);
    const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
    const [consultas, setConsultas] = useState<Consulta[]>([]);
    const [error, setError] = useState<string | null>(null);
    // Con un contador: tocar dos veces la misma foto tiene que volver a abrir su ficha.
    const [abierto, setAbierto] = useState<{ id: string; n: number } | null>(null);
    const parar = useRef(false);
    const campo = useRef<HTMLInputElement>(null);
    const [indice, setIndice] = useState<EstadoIndice | null>(null);
    const [modoBusqueda, setModoBusqueda] = useState<"indice" | "escanear" | null>(null);
    const [pendientes, setPendientes] = useState<{ n: number; despuesDe: string } | null>(null);
    const traerIndice = () => fetch("/api/vision/vocabulario/indice", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setIndice).catch(() => { });
    useEffect(() => { traerIndice(); const i = setInterval(traerIndice, 30_000); return () => clearInterval(i); }, []);
    useEffect(() => { campo.current?.focus(); }, []);
    // Al irse, se corta: no seguir pidiendo fotos sin nadie mirando.
    useEffect(() => () => { parar.current = true; }, []);

    const rango = desde || hasta
        ? `${desde ? new Date(`${desde}T00:00`).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" }) : "…"} – ${hasta ? new Date(`${hasta}T00:00`).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" }) : "hoy"}`
        : "últimas 24 h";

    /** Foto por foto (lento): todo el rango si no hay índice, o sólo lo posterior a `despuesDe`. */
    async function escanear(q: string, despuesDe: string | null, acumulado: number, totalPrevio: number | null) {
        let antesDe: string | null = null, revisadas = acumulado, total = totalPrevio;
        while (!parar.current) {
            const r: Response = await fetch("/api/vision/vocabulario/historial", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ q, modo: "escanear", desde: desde || undefined, hasta: hasta || undefined, camaras, antesDe, despuesDe }),
            });
            const j: any = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            if (j.total != null && !despuesDe) total = j.total;
            if (j.consultas) setConsultas(j.consultas);
            revisadas += j.revisadas || 0;
            setProgreso({ revisadas, total });
            if (j.hallazgos?.length) setHallazgos((h) => [...h, ...j.hallazgos]);
            if (!j.siguiente || revisadas >= TOPE) break;
            antesDe = j.siguiente;
        }
    }

    async function buscar() {
        const q = texto.trim();
        if (!q || buscando) return;
        parar.current = false;
        setBuscando(true); setError(null); setHallazgos([]); setConsultas([]); setPendientes(null); setProgreso({ revisadas: 0, total: null });
        try {
            // 1. El índice: todo el rango de una vez.
            const r: Response = await fetch("/api/vision/vocabulario/historial", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ q, desde: desde || undefined, hasta: hasta || undefined, camaras }),
            });
            const j: any = await r.json().catch(() => ({}));
            if (r.ok) {
                setModoBusqueda("indice");
                setConsultas(j.consultas || []);
                setHallazgos(j.hallazgos || []);
                setProgreso({ revisadas: j.revisadas || 0, total: j.total ?? null });
                // 2. Lo que el índice todavía no tiene (lo de los últimos minutos, o el día si indexa de noche).
                const faltan = Math.max(0, (j.total || 0) - (j.revisadas || 0));
                const vivo = indice?.conf?.vivo || null;
                if (faltan > 0 && vivo) {
                    if (faltan <= PENDIENTES_AUTO) await escanear(q, vivo, j.revisadas || 0, j.total ?? null);
                    else setPendientes({ n: faltan, despuesDe: vivo });
                }
            } else if (j?.sinIndice) {
                // Sin índice en este servidor: el camino lento, foto por foto.
                setModoBusqueda("escanear");
                await escanear(q, null, 0, null);
            } else {
                throw new Error(j?.error || `El servidor respondió ${r.status}`);
            }
        } catch (e: any) { setError(e?.message || "No se pudo buscar"); }
        finally { setBuscando(false); }
    }

    async function revisarPendientes() {
        if (!pendientes || buscando) return;
        parar.current = false; setBuscando(true); setError(null);
        const p = pendientes; setPendientes(null);
        try { await escanear(texto.trim(), p.despuesDe, progreso?.revisadas || 0, progreso?.total ?? null); }
        catch (e: any) { setError(e?.message || "No se pudo revisar"); }
        finally { setBuscando(false); }
    }

    async function cambiarModo(modo: string) {
        const r = await fetch("/api/vision/vocabulario/indice", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ modo }) }).catch(() => null);
        if (r?.ok) traerIndice();
    }

    const pct = progreso?.total ? Math.min(100, Math.round(progreso.revisadas / Math.min(progreso.total, TOPE) * 100)) : null;

    return (
        <div className="rounded-[10px] border border-border bg-card">
            <div className="p-3 flex items-center gap-2 flex-wrap border-b border-border">
                <form onSubmit={(e) => { e.preventDefault(); void buscar(); }} className="flex-1 min-w-[280px] flex items-center gap-2 h-10 px-3 rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-[var(--accion)]/30">
                    <Sparkles size={15} className="text-[var(--aviso)] shrink-0" />
                    <input ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} disabled={buscando}
                        placeholder="¿Qué objeto buscás en las fotos? carretilla, escalera, bolsa de basura…"
                        className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground" />
                </form>
                {buscando
                    ? <Button variant="outline" onClick={() => { parar.current = true; }}><Square size={13} /> Parar</Button>
                    : <Button onClick={() => void buscar()} disabled={!texto.trim()}><Search size={14} /> Buscar en las fotos</Button>}
                <button type="button" onClick={alCerrar} aria-label="Cerrar la búsqueda de objetos" className="h-9 w-9 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-accent"><X size={16} /></button>
            </div>

            <div className="px-3 py-2 text-[12px] text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>En las fotos de los accesos · {rango}{camaras.length ? ` · ${camaras.length === 1 ? camaras[0] : `${camaras.length} cámaras`}` : " · todas las cámaras"}.</span>
                <span>El rango y las cámaras son los de los filtros de abajo.</span>
                {!texto && !buscando && !progreso && (
                    <span className="flex items-center gap-1 flex-wrap">
                        {SUGERENCIAS_VOCABULARIO.slice(0, 5).map((x) => (
                            <button key={x} type="button" onClick={() => setTexto(x)} className="h-6 px-2 rounded-full border border-border text-[11px] font-semibold hover:text-foreground">{x}</button>
                        ))}
                    </span>
                )}
            </div>

            {(progreso || error) && (
                <div className="px-3 pb-3">
                    {error ? <p className="text-[12.5px] tono-mal">{error}</p> : progreso && (
                        <div className="flex items-center gap-3">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                <motion.div className="h-full rounded-full bg-[var(--aviso)]" animate={{ width: `${pct ?? 5}%` }} />
                            </div>
                            <span className="text-[12px] tabular-nums text-muted-foreground whitespace-nowrap">
                                {buscando && <Loader2 size={12} className="inline animate-spin mr-1" />}
                                {progreso.revisadas}{progreso.total != null ? ` de ${Math.min(progreso.total, TOPE)}` : ""} fotos · <b className="text-foreground">{hallazgos.length}</b> con {hallazgos.length === 1 ? "hallazgo" : "hallazgos"}
                            </span>
                        </div>
                    )}
                    {consultas.length > 0 && (
                        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                            Buscado: {consultas.map((c, i) => <span key={c.escrita}>{i > 0 && ", "}<span className="text-foreground">{c.escrita}</span>{c.traducida && ` (como «${c.enviada}»)`}</span>)}
                            {progreso?.total != null && progreso.total > TOPE && ` · hay ${progreso.total} fotos en el rango: se revisan las ${TOPE} más recientes, acotá el rango para ir más atrás.`}
                        </p>
                    )}
                    {!buscando && progreso && !error && hallazgos.length === 0 && progreso.revisadas > 0 && (
                        <p className="mt-2 text-[12.5px]">No apareció en ninguna de las {progreso.revisadas} fotos. Probá con otra palabra (o en inglés), o ampliá el rango.</p>
                    )}
                </div>
            )}

            {hallazgos.length > 0 && (
                <div className="p-3 pt-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                    {hallazgos.map((h) => (
                        <button key={h.eventId} type="button" onClick={() => setAbierto((a) => ({ id: h.eventId, n: (a?.n || 0) + 1 }))}
                            className="group text-left rounded-[10px] border border-border bg-background overflow-hidden hover:border-[var(--aviso)] transition-colors oa-aparecer">
                            <div className="relative aspect-video bg-black">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {h.foto && <img src={h.foto} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                                {h.objetos.map((o, i) => {
                                    const [x1, y1, x2, y2] = o.caja_norm;
                                    return <span key={i} className="absolute border-2 border-[var(--aviso)] rounded-[3px] pointer-events-none" style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }} />;
                                })}
                                <span className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                                    {[...new Map(h.objetos.map((o) => [o.nombre, o])).values()].slice(0, 2).map((o) => (
                                        <span key={o.nombre} className="h-5 px-1.5 rounded-md bg-[var(--aviso)] text-black text-[10.5px] font-bold tabular-nums grid place-items-center">{o.nombre} {Math.round(o.confianza * 100)} %</span>
                                    ))}
                                </span>
                            </div>
                            <div className="px-2.5 py-2 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {h.plate && !/^(unknown|NO_LEIDA)$/i.test(h.plate) && <Matricula p={h.plate} />}
                                    <span className={cn("text-[12px] font-semibold truncate", h.plate && "text-muted-foreground font-normal")}>{h.camara || "Cámara"}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{fechaHoraSeg(new Date(h.ts))}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
            {pendientes && !buscando && (
                <div className="px-3 pb-3 -mt-1 text-[12px] text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span>{pendientes.n} fotos del rango todavía no están en el índice (las más recientes).</span>
                    <Button size="sm" variant="outline" onClick={() => void revisarPendientes()}>Revisarlas una por una (lento)</Button>
                </div>
            )}
            {/* El índice: qué cubre y cómo se mantiene. */}
            {indice && (
                <div className="px-3 py-2 border-t border-border text-[11.5px] text-muted-foreground flex items-center gap-2 flex-wrap">
                    {indice.indice ? <>
                        <span>Índice: <b className="text-foreground tabular-nums">{indice.indice.fotos.toLocaleString("es-UY")}</b> fotos{Object.keys(indice.indice.dias).length ? ` desde el ${new Date(`${Object.keys(indice.indice.dias).sort()[0]}T12:00`).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" })}` : ""}</span>
                        {indice.indice.ultimo_ts && <span>· al día hasta las {new Date(indice.indice.ultimo_ts).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>}
                        {modoBusqueda === "indice" && progreso && <span>· búsqueda en el índice</span>}
                    </> : <span>Este servidor no tiene índice: se revisa foto por foto.</span>}
                    <span className="ml-auto flex items-center gap-1.5">
                        Indexar
                        <select value={indice.conf.modo} onChange={(e) => void cambiarModo(e.target.value)} className="h-7 rounded-md border border-border bg-background px-1.5 text-[11.5px] font-semibold"
                            title="Continuo: cada foto se indexa al llegar (el modelo queda en la GPU). De noche: sólo en la ventana 02:00–06:00. Apagado: no indexa más.">
                            <option value="continuo">siempre</option>
                            <option value="noche">de noche</option>
                            <option value="apagado">no</option>
                        </select>
                    </span>
                </div>
            )}
            {abierto && <AbrirFicha key={abierto.n} id={abierto.id} alCerrar={() => setAbierto(null)} />}
        </div>
    );
}
