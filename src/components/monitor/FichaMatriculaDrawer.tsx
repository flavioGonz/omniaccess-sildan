"use client";

import { useEffect, useState } from "react";
import { Cajon, CajonContenido, CajonCerrar } from "@/components/ui/cajon";
import { getFichaMatricula, type FichaMatricula, type PasadaFicha, type DeteccionRelacionada } from "@/app/actions/history";
import { getImagePath } from "@/lib/image-path";
import { rotuloLectura } from "@/lib/lectura-metodo";
import { cn } from "@/lib/utils";
import { LogIn, LogOut, ShieldAlert, Clock, Camera, Home, CheckCircle2, Ban, Car, Activity, X, Search } from "lucide-react";

/**
 * El cajón de Investigar — la ficha de UNA matrícula, sin salir del monitor.
 *
 * Antes «Investigar» llevaba al módulo de Historial de acceso con un ?search=: se perdía el
 * contexto del monitor y se caía en una tabla general. Ahora abre esta ficha: la última captura
 * arriba, a sangre (sin marco), y debajo el recorrido del auto como un grafo tipo git —cada pasada
 * un nodo sobre un riel, de la más nueva a la más vieja—, con las detecciones de analítica que las
 * mismas cámaras vieron mientras el auto estuvo. Los datos salen de getFichaMatricula (una llamada).
 *
 * La captura sigue siendo el producto: la foto manda, el grafo es el andamiaje para leerla.
 */

function hace(iso: string): string {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `hace ${s}s`;
    if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
    return `hace ${Math.floor(s / 86400)}d`;
}
function cuando(iso: string): string {
    return new Date(iso).toLocaleString("es-UY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
/** El tiempo entre dos pasadas (nodo → nodo anterior): cuánto estuvo afuera/adentro entre ellas. */
function lapso(aIso: string, bIso: string): string {
    const ms = new Date(aIso).getTime() - new Date(bIso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60} min`;
    return `${Math.floor(h / 24)} d ${h % 24} h`;
}

function Thumb({ path, w = 200, className }: { path: string | null; w?: number; className?: string }) {
    const src = getImagePath(path);
    if (!src) return <div className={cn("bg-muted flex items-center justify-center", className)}><Car size={16} className="text-muted-foreground/40" /></div>;
    const url = `${src}${src.includes("?") ? "&" : "?"}w=${w}`;
    return <img src={url} alt="" loading="lazy" decoding="async" className={cn("object-cover", className)} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />;
}

/** El radar animado mientras se arma la ficha: barrido + anillos, en el azul de acción. */
function BuscandoRadar({ plate }: { plate: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
            <svg viewBox="0 0 120 120" className="w-28 h-28" aria-hidden>
                <defs>
                    <radialGradient id="rg" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="var(--accion)" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="var(--accion)" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="var(--accion)" stopOpacity="0" />
                        <stop offset="100%" stopColor="var(--accion)" stopOpacity="0.9" />
                    </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="1.5" />
                <circle cx="60" cy="60" r="34" fill="none" stroke="var(--border)" strokeWidth="1" />
                <circle cx="60" cy="60" r="16" fill="none" stroke="var(--border)" strokeWidth="1" />
                <circle cx="60" cy="60" r="52" fill="url(#rg)" className="ficha-radar-pulso" />
                {/* El barrido, girando */}
                <g className="ficha-radar-barrido" style={{ transformOrigin: "60px 60px" }}>
                    <path d="M60 60 L60 8 A52 52 0 0 1 104 36 Z" fill="url(#bar)" opacity="0.5" />
                    <line x1="60" y1="60" x2="60" y2="8" stroke="var(--accion)" strokeWidth="2" />
                </g>
                <circle cx="60" cy="60" r="3" fill="var(--accion)" />
            </svg>
            <div>
                <p className="text-[13px] text-muted-foreground">Investigando</p>
                <p className="font-mono text-xl font-bold tracking-[0.2em] text-foreground mt-0.5">{plate}</p>
            </div>
        </div>
    );
}

const ICONO_DET: Record<string, typeof Activity> = { LINECROSS: Activity, INTRUSION: ShieldAlert, REGION_ENTER: Activity, REGION_EXIT: Activity };

export function FichaMatriculaDrawer({ plate, abierto, onCerrar }: { plate: string | null; abierto: boolean; onCerrar: () => void }) {
    const [data, setData] = useState<FichaMatricula | null>(null);
    const [cargando, setCargando] = useState(false);

    useEffect(() => {
        if (!abierto || !plate) return;
        let alive = true;
        setCargando(true); setData(null);
        getFichaMatricula(plate).then((d) => { if (alive) { setData(d); setCargando(false); } }).catch(() => { if (alive) setCargando(false); });
        return () => { alive = false; };
    }, [abierto, plate]);

    const hero = data?.pasadas[0] || null;

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
            <CajonContenido ancho="medio" sinCabecera titulo={`Investigar ${plate || ""}`} descripcion="Recorrido y detecciones de la matrícula" className="p-0">
                {/* Cerrar flotante sobre la captura, para que la foto llegue al borde (sin marco). */}
                <CajonCerrar className="absolute top-3 right-3 z-30 w-9 h-9 rounded-full grid place-items-center bg-black/55 text-white/90 ring-1 ring-white/20 backdrop-blur-md hover:bg-black/75 transition-colors" aria-label="Cerrar">
                    <X size={18} />
                </CajonCerrar>

                {cargando || !data ? (
                    <BuscandoRadar plate={plate || ""} />
                ) : (
                    <div className="ficha-entra">
                        {/* ── La última captura, a sangre ─────────────────────────────── */}
                        <div className="relative w-full aspect-video bg-black">
                            {hero ? <Thumb path={hero.img} w={960} className="w-full h-full" /> : <div className="w-full h-full grid place-items-center text-muted-foreground"><Camera size={28} className="opacity-40" /></div>}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-5 pb-4 pt-16">
                                <div className="flex items-end justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="font-mono text-[clamp(26px,4vw,44px)] font-bold tracking-[0.12em] text-white leading-none drop-shadow">{data.plate}</div>
                                        {(data.usuario || data.watch) && (
                                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                                {data.usuario && <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white"><Home size={13} className="text-white/70" />{data.usuario.unit ? `Lote ${data.usuario.unit} · ` : ""}{data.usuario.name}</span>}
                                                {data.watch && <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md bg-[var(--mal-suave)] text-[var(--mal-texto)]"><ShieldAlert size={11} />{data.watch.category}</span>}
                                            </div>
                                        )}
                                    </div>
                                    {hero && <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/55 ring-1 ring-white/15 text-white text-[12px] font-bold backdrop-blur-md"><Clock size={12} className="text-white/70" />{hace(hero.timestamp)}</span>}
                                </div>
                            </div>
                        </div>
                        {data.watch?.motivo && <div className="px-5 py-2.5 bg-[var(--mal-suave)] text-[var(--mal-texto)] text-[12.5px] font-semibold flex items-center gap-2"><ShieldAlert size={14} className="shrink-0" />{data.watch.motivo}</div>}

                        {/* ── Resumen en cifras ───────────────────────────────────────── */}
                        <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
                            {([["Pasadas", data.total, ""], ["Entradas", data.entries, "tono-bien"], ["Salidas", data.exits, "text-orange-500"], ["Denegadas", data.denies, data.denies ? "tono-mal" : ""]] as [string, number, string][]).map(([r, n, tono]) => (
                                <div key={r} className="px-3 py-3 text-center">
                                    <p className={cn("text-2xl font-bold tabular-nums leading-none", n > 0 && tono)}>{n}</p>
                                    <p className="text-[10.5px] text-muted-foreground mt-1 uppercase tracking-wide">{r}</p>
                                </div>
                            ))}
                        </div>

                        {/* ── El recorrido, tipo git ──────────────────────────────────── */}
                        <div className="px-5 py-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Activity size={15} className="text-[var(--accion)]" />
                                <h3 className="text-[13px] font-bold">Recorrido</h3>
                                <span className="text-[11px] text-muted-foreground">últimos {Math.min(30, 30)} días · {data.total} pasada{data.total === 1 ? "" : "s"}</span>
                            </div>
                            {data.pasadas.length === 0 ? (
                                <p className="text-[12.5px] text-muted-foreground py-6 text-center">Sin pasadas registradas en la ventana.</p>
                            ) : (
                                <ol className="relative">
                                    {/* El riel del grafo */}
                                    <span className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-[var(--accion)]/60 via-border to-border" aria-hidden />
                                    {data.pasadas.map((p, i) => {
                                        const entra = p.direction === "ENTRY";
                                        const ok = p.decision === "GRANT";
                                        const sig = data.pasadas[i + 1];
                                        return (
                                            <li key={p.id} className="ficha-fila relative pl-8 pb-3 last:pb-0" style={{ animationDelay: `${Math.min(i * 45, 500)}ms` }}>
                                                {/* El nodo (commit) */}
                                                <span className={cn("absolute left-[4px] top-1.5 w-[15px] h-[15px] rounded-full ring-2 ring-background grid place-items-center", entra ? "bg-emerald-500" : "bg-orange-500")}>
                                                    {entra ? <LogIn size={9} className="text-white" /> : <LogOut size={9} className="text-white" />}
                                                </span>
                                                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-2.5 py-2">
                                                    <div className="w-16 h-12 rounded-md overflow-hidden shrink-0 bg-muted"><Thumb path={p.img} w={160} className="w-full h-full" /></div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn("text-[12px] font-bold", entra ? "tono-bien" : "text-orange-500")}>{entra ? "Entrada" : "Salida"}</span>
                                                            <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded", ok ? "chip-bien" : "tono-mal")}>{ok ? <CheckCircle2 size={10} /> : <Ban size={10} />}{ok ? "OK" : "Denegada"}</span>
                                                        </div>
                                                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{p.deviceName || "Cámara"} · {cuando(p.timestamp)}</div>
                                                        <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground mt-0.5">
                                                            <span>{hace(p.timestamp)}</span>
                                                            {rotuloLectura(p.details) && <span className="tabular-nums opacity-80">· {rotuloLectura(p.details)}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* El lapso hasta la pasada anterior, sobre el riel */}
                                                {sig && <div className="pl-0 pt-1.5 pb-0.5 text-[10px] text-muted-foreground/80 tabular-nums flex items-center gap-1"><Clock size={9} />{lapso(p.timestamp, sig.timestamp)} antes</div>}
                                            </li>
                                        );
                                    })}
                                </ol>
                            )}
                        </div>

                        {/* ── Detecciones relacionadas ────────────────────────────────── */}
                        {data.detecciones.length > 0 && (
                            <div className="px-5 py-4 border-t border-border">
                                <div className="flex items-center gap-2 mb-3">
                                    <Activity size={15} className="text-[var(--accion)]" />
                                    <h3 className="text-[13px] font-bold">Detecciones relacionadas</h3>
                                    <span className="text-[11px] text-muted-foreground">en las mismas cámaras</span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {data.detecciones.map((d) => {
                                        const I = ICONO_DET[d.type] || Activity;
                                        return (
                                            <div key={d.id} className="rounded-lg border border-border bg-card overflow-hidden">
                                                <div className="relative aspect-video bg-muted"><Thumb path={d.snapshotPath} w={220} className="w-full h-full" />
                                                    <span className="absolute top-1 left-1 inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white backdrop-blur-sm"><I size={9} />{d.label || d.type}</span>
                                                </div>
                                                <div className="px-2 py-1.5 text-[10px] text-muted-foreground truncate">{d.deviceName || "Cámara"} · {hace(d.timestamp)}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </CajonContenido>
        </Cajon>
    );
}
