"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LiveModal } from "@/components/intrusion/LiveModal";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import {
    Car, Radar, Ban, Loader2, Link2, LogIn, LogOut, Download, Search, Network, ImageOff, Layers,
    Sparkles, Users, X, HardDrive, ScanEye, AlertTriangle, Play, Info,
} from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { canalesParaImportar, importarCanalesClasificados, type CanalParaImportar, type RolImport } from "@/app/actions/nvr";
import { IconoTipo, ICONO_TIPO } from "@/components/devices/ArbolAreas";

/**
 * Importar las cámaras de un NVR clasificando cada una antes de crearla: LPR (entrada o
 * salida), intrusión o ninguna. Cada canal se ve con su foto (pedida al NVR), su marca real y
 * su protocolo. Las que ya existen sólo se vinculan a su grabación (y se les corrige la marca).
 */
type Filtro = "todas" | "nuevas" | "existentes";
const TT = "tt-imp";
const tip = (t: string) => ({ "data-tooltip-id": TT, "data-tooltip-content": t });

function Miniatura({ nvrId, ch, onAmpliar }: { nvrId: string; ch: number; onAmpliar: () => void }) {
    const [estado, setEstado] = useState<"cargando" | "ok" | "error">("cargando");
    return (
        <button type="button" onClick={onAmpliar} data-tooltip-id="tt-imp" data-tooltip-content="Ver en vivo y grabación"
            className="group relative w-[136px] h-[76px] shrink-0 rounded-lg overflow-hidden bg-neutral-900 border border-border/60">
            {estado === "cargando" && <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-neutral-800 to-neutral-900" />}
            {estado === "error" ? (
                <span className="absolute inset-0 grid place-items-center text-neutral-500">
                    <span className="flex flex-col items-center gap-1"><ImageOff size={18} /><span className="text-[9px] font-semibold">Sin vista previa</span></span>
                </span>
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/nvr/snapshot?nvr=${nvrId}&ch=${ch}&w=272`} alt="" loading="lazy"
                    onLoad={() => setEstado("ok")} onError={() => setEstado("error")}
                    className={cn("w-full h-full object-cover transition-transform duration-300 group-hover:scale-105", estado !== "ok" && "opacity-0")} />
            )}
            <span className="absolute left-1 top-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9.5px] font-bold font-mono">D{ch}</span>
            <span className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30"><span className="h-8 w-8 rounded-full bg-white/90 text-black grid place-items-center shadow"><Play size={14} className="ml-0.5" /></span></span>
        </button>
    );
}

function Marca({ c }: { c: CanalParaImportar }) {
    const cls = c.marca === "HIKVISION" ? "bg-red-500/10 text-red-500 border-red-500/25" : c.marca === "DAHUA" ? "bg-sky-500/10 text-sky-500 border-sky-500/25" : "bg-muted text-muted-foreground border-border";
    return <span className={cn("px-1.5 py-px rounded text-[9px] font-bold uppercase border", cls)} {...tip(`Fabricante de la cámara según el NVR${c.protocolo ? ` (protocolo ${c.protocolo})` : ""}. Un NVR puede grabar cámaras de otras marcas.`)}>{c.marca === "OTRA" ? "Otra marca" : c.marca}</span>;
}

export function ImportarCanalesNvr({ nvr, groups = [], open, onOpenChange, onListo }: { nvr: { id: string; name: string; ip?: string; brand?: string } | null; groups?: any[]; open: boolean; onOpenChange: (v: boolean) => void; onListo: () => void }) {
    const [canales, setCanales] = useState<CanalParaImportar[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState("");
    const [eleccion, setEleccion] = useState<Record<number, { rol: RolImport; direction: "ENTRY" | "EXIT" }>>({});
    const [grupo, setGrupo] = useState("none");
    const [importando, setImportando] = useState(false);
    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [q, setQ] = useState("");
    const [vivo, setVivo] = useState<any>(null);
    // La foto abre el visor universal (vivo + grabación). Si el canal ya es un equipo se usa ése;
    // si no, se registra un vivo temporal del canal en go2rtc.
    const abrirVivo = async (c: CanalParaImportar) => {
        if (!nvr) return;
        if (c.existente) { setVivo({ id: c.existente.id, name: c.existente.name, brand: c.marca, ip: c.ip || "", nvrName: nvr.name, nvrId: nvr.id, ch: c.channel, alarmOk: false }); return; }
        try {
            const r = await fetch("/api/nvr/canal-vivo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nvr: nvr.id, ch: c.channel }) }).then((x) => x.json());
            if (!r?.ok) { toast.error({ title: "No se pudo abrir el vivo", description: r?.error }); return; }
            setVivo({ id: r.id, name: `D${c.channel} · ${c.name}`, brand: c.marca, ip: c.ip || "", nvrName: nvr.name, nvrId: nvr.id, ch: c.channel, alarmOk: false });
        } catch (e: any) { toast.error({ title: "No se pudo abrir el vivo", description: e?.message }); }
    };

    const leer = () => {
        if (!nvr) return;
        setCargando(true); setError(""); setCanales([]);
        canalesParaImportar(nvr.id).then((r) => {
            if (!r.ok) { setError(r.error || "No se pudieron leer los canales"); return; }
            setCanales(r.canales);
            setEleccion(Object.fromEntries(r.canales.map((c) => [c.channel, { rol: c.existente || c.sensorDe || !c.ip ? "omitir" : c.sugerido.rol, direction: c.sugerido.direction }])));
            setFiltro(r.canales.some((c) => !c.existente && c.ip && !c.sensorDe) ? "nuevas" : "todas");
        }).catch((e) => setError(e?.message || "Error")).finally(() => setCargando(false));
    };
    useEffect(() => { if (open && nvr) { setQ(""); leer(); } }, [open, nvr]); // eslint-disable-line react-hooks/exhaustive-deps

    const esNueva = (c: CanalParaImportar) => !c.existente && !!c.ip && !c.sensorDe;
    const nuevas = canales.filter(esNueva);
    const existentes = canales.filter((c) => c.existente);
    const resumen = useMemo(() => ({
        lpr: nuevas.filter((c) => eleccion[c.channel]?.rol === "lpr").length,
        intr: nuevas.filter((c) => eleccion[c.channel]?.rol === "intrusion").length,
        corregir: existentes.filter((c) => c.existente && c.existente.marca !== c.marca && c.marca !== "OTRA").length,
    }), [eleccion, canales]); // eslint-disable-line react-hooks/exhaustive-deps
    const set = (ch: number, cambios: Partial<{ rol: RolImport; direction: "ENTRY" | "EXIT" }>) => setEleccion((p) => ({ ...p, [ch]: { ...p[ch], ...cambios } }));
    const todasNuevasComo = (rol: RolImport) => setEleccion((p) => { const n = { ...p }; for (const c of nuevas) n[c.channel] = { ...n[c.channel], rol }; return n; });

    const visibles = useMemo(() => {
        const t = q.trim().toLowerCase();
        return canales.filter((c) => (filtro === "todas" || (filtro === "nuevas" ? esNueva(c) : !!c.existente))
            && (!t || c.name.toLowerCase().includes(t) || (c.ip || "").includes(t) || (c.model || "").toLowerCase().includes(t) || String(c.channel) === t.replace(/^d/, "")));
    }, [canales, filtro, q]); // eslint-disable-line react-hooks/exhaustive-deps

    const importar = async () => {
        if (!nvr) return;
        setImportando(true);
        try {
            const pedidos = canales.filter((c) => c.existente || (esNueva(c) && eleccion[c.channel]?.rol !== "omitir"))
                .map((c) => ({ channel: c.channel, rol: (c.existente ? "intrusion" : eleccion[c.channel]?.rol || "omitir") as RolImport, direction: eleccion[c.channel]?.direction, groupId: grupo }));
            const r = await importarCanalesClasificados(nvr.id, pedidos);
            if (!r.ok) { toast.error({ title: "No se pudo importar", description: r.error }); return; }
            toast.success({ title: `Importación lista: ${r.creadas} nueva${r.creadas !== 1 ? "s" : ""}`, description: `${r.mapeadas} ya existían y quedaron vinculadas a su grabación. La retención de cada una se calcula sola en segundo plano.` });
            onListo(); onOpenChange(false);
        } finally { setImportando(false); }
    };

    const fichas: { k: Filtro; t: string; n: number; I: any; c: string; ayuda: string }[] = [
        { k: "todas", t: "Canales", n: canales.length, I: Layers, c: "text-foreground", ayuda: "Todos los canales con cámara que tiene el NVR." },
        { k: "nuevas", t: "Para importar", n: nuevas.length, I: Sparkles, c: "text-indigo-500", ayuda: "Cámaras que todavía no existen en OmniAccess: elegí qué es cada una." },
        { k: "existentes", t: "Ya existen", n: existentes.length, I: Link2, c: "text-emerald-500", ayuda: "Ya están dadas de alta: sólo se les vincula este canal como su grabación." },
    ];

    return (
        <Cajon open={open} onOpenChange={(v) => !importando && onOpenChange(v)}>
            <CajonContenido ancho="medio" titulo={`Importar cámaras de ${nvr?.name || "NVR"}`}
                descripcion="Elegí qué es cada cámara antes de crearla. Las que ya existen sólo se vinculan a su grabación."
                encabezado={
                    <div className="px-6 py-3 space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            {fichas.map((f) => (
                                <button key={f.k} type="button" onClick={() => setFiltro(f.k)} {...tip(f.ayuda)}
                                    className={cn("rounded-xl border px-3 py-2 flex items-center gap-3 text-left transition-all",
                                        filtro === f.k ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)] ring-1 ring-[var(--accion)]" : "border-border bg-card/50 hover:bg-accent/50")}>
                                    <span className={cn("w-8 h-8 rounded-lg bg-muted/70 grid place-items-center", f.c)}><f.I size={15} /></span>
                                    <span>
                                        <span className="block text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{f.t}</span>
                                        <span className="block text-[17px] font-bold tabular-nums leading-tight">{cargando ? "—" : f.n}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative flex-1 min-w-[220px]">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, IP, modelo o canal (D12)…"
                                    className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-8 text-[12.5px] outline-none focus:border-[var(--accion)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_20%,transparent)]" />
                                {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 grid place-items-center rounded text-muted-foreground hover:bg-accent"><X size={12} /></button>}
                            </div>
                            {nuevas.length > 0 && (
                                <div className="flex items-center gap-1 rounded-lg border border-border bg-card/50 p-0.5" {...tip("Marca de una vez todas las cámaras nuevas. Después podés cambiar una por una.")}>
                                    <span className="px-2 text-[11px] text-muted-foreground font-semibold">Nuevas como</span>
                                    {([["lpr", "LPR", Car, "hover:text-amber-500"], ["intrusion", "Intrusión", Radar, "hover:text-red-500"], ["omitir", "Ninguna", Ban, ""]] as const).map(([v, t, I, h]) => (
                                        <button key={v} type="button" onClick={() => todasNuevasComo(v)} className={cn("h-7 px-2 rounded-md text-[11px] font-bold inline-flex items-center gap-1 text-muted-foreground hover:bg-accent", h)}><I size={12} /> {t}</button>
                                    ))}
                                </div>
                            )}
                            {resumen.lpr > 0 && (
                                <label className="flex items-center gap-1.5 rounded-lg border border-border bg-card/50 h-9 px-2" {...tip("Grupo de acceso de las cámaras LPR nuevas: quiénes pasan por ellas. Ej.: «Residentes + Proveedores».")}>
                                    <Users size={13} className="text-muted-foreground" />
                                    <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="h-7 bg-transparent text-[12px] outline-none">
                                        <option value="none">Sin grupo</option>
                                        {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                    </select>
                                </label>
                            )}
                        </div>
                    </div>
                }
                pie={<div className="flex items-center gap-3 w-full">
                    <div className="flex-1 flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold"><Car size={12} /> {resumen.lpr} LPR</span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 text-red-500 font-semibold"><Radar size={12} /> {resumen.intr} intrusión</span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold"><Link2 size={12} /> {existentes.length} se vinculan</span>
                        {resumen.corregir > 0 && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 font-semibold" {...tip("Están guardadas con otra marca: al importar se corrige.")}><AlertTriangle size={12} /> {resumen.corregir} marca a corregir</span>}
                    </div>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importando}>Cancelar</Button>
                    <Button onClick={importar} disabled={importando || cargando || !canales.length} className="gap-1.5">{importando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Importar {resumen.lpr + resumen.intr > 0 ? `${resumen.lpr + resumen.intr} nuevas` : "y vincular"}</Button>
                </div>}>

                <div className="px-6 py-4">
                    {cargando && (
                        <div className="space-y-2">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-4 rounded-xl border border-border/60 p-2.5 animate-pulse">
                                    <span className="w-[136px] h-[76px] rounded-lg bg-muted" /><span className="flex-1 space-y-2"><span className="block h-3.5 w-1/3 rounded bg-muted" /><span className="block h-3 w-1/4 rounded bg-muted/70" /></span>
                                </div>
                            ))}
                            <p className="text-center text-[12px] text-muted-foreground flex items-center justify-center gap-2 pt-2"><Loader2 size={14} className="animate-spin" /> Leyendo los canales del NVR…</p>
                        </div>
                    )}
                    {error && (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500 flex items-start gap-2">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <div className="flex-1">{error}</div>
                            <Button size="sm" variant="outline" onClick={leer}>Reintentar</Button>
                        </div>
                    )}
                    {!cargando && !error && canales.length > 0 && visibles.length === 0 && (
                        <div className="py-12 text-center text-[13px] text-muted-foreground space-y-1"><ScanEye size={22} className="mx-auto opacity-50" /><p>Ningún canal coincide con el filtro.</p></div>
                    )}
                    {!cargando && (
                        <div className="space-y-2">
                            <AnimatePresence initial={false}>
                                {visibles.map((c) => {
                                    const e = eleccion[c.channel];
                                    const nueva = esNueva(c);
                                    return (
                                        <motion.div key={c.channel} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                            className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-2.5 transition-colors",
                                                c.existente ? "border-emerald-500/20 bg-emerald-500/[0.03]" : nueva && e?.rol === "lpr" ? "border-amber-500/30 bg-amber-500/[0.04]" : nueva && e?.rol === "intrusion" ? "border-red-500/25 bg-red-500/[0.03]" : "border-border/70 bg-card/40")}>
                                            {nvr && <Miniatura nvrId={nvr.id} ch={c.channel} onAmpliar={() => abrirVivo(c)} />}
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="font-bold text-[13.5px] truncate">{c.name}</span>
                                                    {c.model && <span className="text-[10.5px] text-muted-foreground font-mono truncate">{c.model}</span>}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                                    <span className="inline-flex items-center gap-1 font-mono"><Network size={11} /> {c.ip || "sin IP"}</span>
                                                    <span className="text-border">|</span>
                                                    <Marca c={c} />
                                                    {c.protocolo && <span className="text-[10.5px]">{c.protocolo}</span>}
                                                    {c.sensorDe && <span className="px-1.5 py-px rounded text-[9px] font-bold uppercase bg-violet-500/10 text-violet-500 border border-violet-500/25" {...tip(`Misma IP que D${c.sensorDe}: otro sensor de la misma cámara (térmico + visible). No se crea aparte.`)}>2.º sensor de D{c.sensorDe}</span>}
                                                </div>
                                            </div>
                                            <div className="shrink-0 flex justify-end">
                                                {c.existente ? (
                                                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-1.5 max-w-full" {...tip(`Ya existe como «${c.existente.name}». Sólo se le vincula este canal como su grabación.${c.existente.marca !== c.marca && c.marca !== "OTRA" ? ` Su marca (${c.existente.marca}) se corrige a ${c.marca}.` : ""}`)}>
                                                        <IconoTipo tipo={c.existente.tipo} size={14} />
                                                        <span className="min-w-0">
                                                            <span className="block text-[11px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Link2 size={11} /> Ya existe · se vincula</span>
                                                            <span className="block text-[10.5px] text-muted-foreground truncate max-w-[220px]">{c.existente.name} · {ICONO_TIPO[c.existente.tipo]?.t || c.existente.tipo}</span>
                                                        </span>
                                                    </div>
                                                ) : !nueva ? (
                                                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Info size={12} /> {c.sensorDe ? `Se graba con D${c.sensorDe}` : "Sin IP: no se puede importar"}</span>
                                                ) : (
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="inline-flex rounded-lg bg-muted/60 p-0.5" {...tip(`Sugerido: ${c.sugerido.rol === "lpr" ? "LPR" : "intrusión"} (${c.sugerido.por}).`)}>
                                                            {([["lpr", "LPR", Car], ["intrusion", "Intrusión", Radar], ["omitir", "No", Ban]] as const).map(([v, t, I]) => (
                                                                <button key={v} type="button" onClick={() => set(c.channel, { rol: v })}
                                                                    className={cn("h-8 px-2.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 transition-colors",
                                                                        e?.rol === v ? (v === "lpr" ? "bg-amber-500 text-black shadow-sm" : v === "intrusion" ? "bg-red-500 text-white shadow-sm" : "bg-neutral-600 text-white") : "text-muted-foreground hover:text-foreground")}>
                                                                    <I size={13} /> {t}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        {e?.rol === "lpr" && (
                                                            <div className="inline-flex rounded-lg bg-muted/60 p-0.5">
                                                                {([["ENTRY", "Entrada", LogIn], ["EXIT", "Salida", LogOut]] as const).map(([v, t, I]) => (
                                                                    <button key={v} type="button" onClick={() => set(c.channel, { direction: v })} {...tip(t)}
                                                                        className={cn("h-8 w-8 rounded-md grid place-items-center", e.direction === v ? (v === "ENTRY" ? "bg-emerald-500 text-white" : "bg-orange-500 text-white") : "text-muted-foreground hover:text-foreground")}>
                                                                        <I size={14} />
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    )}
                </div>

                {vivo && typeof document !== "undefined" && createPortal(
                    <div className="fixed inset-0 z-[3300] pointer-events-auto"><LiveModal cam={vivo} initialTab="live" onClose={() => setVivo(null)} /></div>, document.body)}
                <Tooltip id={TT} place="top" className="!max-w-[300px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
