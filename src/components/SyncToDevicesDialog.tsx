"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import { Button } from "@/components/ui/button";
import {
    Loader2, Camera, CheckCircle2, XCircle, Database, Plus, Trash2, ShieldCheck, RefreshCw, Lock, Wifi, WifiOff,
    ListChecks, Zap, Info, Search, UserRound, Home, Check, X, Ban, LogIn, LogOut, Upload, ScanLine,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import {
    getSyncPlan, acquireSyncLock, releaseSyncLock, touchSyncLock, syncDeviceIncremental, syncDeviceFull,
    buscarUsuarioEnCamaras, sincronizarUsuario,
} from "@/app/actions/lpr-sync";
import { cn } from "@/lib/utils";

/**
 * Sincronizar matrículas a las cámaras LPR, en un cajón paso a paso:
 *   Analizar (qué tiene cada cámara) → Confirmar (diferencias y modo) → Sincronizar (cámara por
 *   cámara, a la vista) → Listo.
 * Pestaña «Buscar usuario»: nombre, matrícula o lote → en qué cámaras está cargada cada una de
 * sus matrículas, y cargarle sólo las que falten.
 */
type Step = "analyzing" | "plan" | "running" | "done" | "blocked";
type Mode = "incremental" | "full";
type Prog = { status: "pending" | "running" | "done" | "error"; added?: number; removed?: number; addFail?: number; remFail?: number; error?: string };
const TT = "tt-sync";
const tip = (t: string) => ({ "data-tooltip-id": TT, "data-tooltip-content": t });

export function SyncToDevicesDialog({ onSuccess, variante = "icono" }: { onSuccess: () => void; variante?: "icono" | "boton" }) {
    const [open, setOpen] = useState(false);
    const [pestana, setPestana] = useState<"todas" | "usuario">("todas");
    const [step, setStep] = useState<Step>("analyzing");
    const [plan, setPlan] = useState<any>(null);
    const [mode, setMode] = useState<Mode>("incremental");
    const [prog, setProg] = useState<Record<string, Prog>>({});
    const [lockBy, setLockBy] = useState<string>("");
    const runningRef = useRef(false);

    const analyze = useCallback(async () => {
        setStep("analyzing"); setPlan(null); setProg({});
        try {
            const p = await getSyncPlan();
            if (p.lock) { setLockBy(p.lock.by); setStep("blocked"); return; }
            setPlan(p); setStep("plan");
        } catch { toast.error({ title: "No se pudo analizar las cámaras" }); setStep("plan"); }
    }, []);

    const start = () => { setOpen(true); setPestana("todas"); analyze(); };
    const close = () => {
        if (runningRef.current) return;
        setOpen(false); setStep("analyzing"); setPlan(null); setProg({}); setLockBy("");
    };

    const run = async () => {
        const lock = await acquireSyncLock();
        if (!lock.ok) { setLockBy(lock.by || "otro administrador"); setStep("blocked"); return; }
        runningRef.current = true;
        setStep("running");
        const devices = (plan?.devices || []).filter((d: any) => d.online);
        setProg(Object.fromEntries(devices.map((d: any) => [d.id, { status: "pending" }])));
        try {
            for (const d of devices) {
                setProg((p) => ({ ...p, [d.id]: { status: "running" } }));
                await touchSyncLock().catch(() => { });
                const r = mode === "full" ? await syncDeviceFull(d.id) : await syncDeviceIncremental(d.id);
                setProg((p) => ({ ...p, [d.id]: r.ok ? { status: "done", added: r.added, removed: r.removed, addFail: r.addFail, remFail: r.remFail } : { status: "error", error: (r as any).error } }));
            }
        } finally {
            runningRef.current = false;
            await releaseSyncLock().catch(() => { });
            setStep("done");
            onSuccess();
        }
    };

    const online = (plan?.devices || []).filter((d: any) => d.online);
    const offline = (plan?.devices || []).filter((d: any) => !d.online);
    const totAdd = online.reduce((a: number, d: any) => a + d.toAdd, 0);
    const totRemove = online.reduce((a: number, d: any) => a + d.toRemove, 0);
    const hechos = Object.values(prog).filter((p) => p.status === "done" || p.status === "error").length;
    const pct = online.length ? Math.round((hechos / online.length) * 100) : 0;

    const PASOS = [
        { k: "analizar", t: "Analizar", I: ListChecks, activo: step === "analyzing", hecho: step !== "analyzing" && step !== "blocked" },
        { k: "confirmar", t: "Confirmar", I: ShieldCheck, activo: step === "plan", hecho: step === "running" || step === "done" },
        { k: "sincronizar", t: "Sincronizar", I: RefreshCw, activo: step === "running", hecho: step === "done" },
        { k: "listo", t: "Listo", I: CheckCircle2, activo: step === "done", hecho: step === "done" },
    ];

    return (
        <>
            {variante === "icono" ? (
                <Button variant="outline" size="icon" onClick={start} {...tip("Sincronizar matrículas a las cámaras LPR")}
                    className="bg-indigo-600/10 border-indigo-600/20 text-indigo-400 hover:bg-indigo-600/20 h-8 w-8">
                    <Camera size={16} />
                </Button>
            ) : (
                <button onClick={start} {...tip("Sincronizar matrículas en masa: compara la base con lo que tiene cada cámara LPR y aplica sólo las diferencias, paso a paso. También podés buscar un usuario y ver en qué cámaras está.")}
                    className="h-10 w-10 rounded-xl grid place-items-center border border-indigo-500/30 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 transition-colors">
                    <Upload size={17} />
                </button>
            )}

            <Cajon open={open} onOpenChange={(o) => { if (!o) close(); }}>
                <CajonContenido ancho="medio" titulo="Sincronizar matrículas a las cámaras" descripcion="Compara la base con lo que cada cámara LPR ya tiene y aplica sólo las diferencias."
                    encabezado={
                        <div className="px-6 py-3 space-y-3">
                            <div className="inline-flex w-full rounded-xl bg-muted/50 p-1">
                                {([["todas", "Todas las cámaras", RefreshCw], ["usuario", "Buscar un usuario", Search]] as const).map(([k, t, I]) => (
                                    <button key={k} type="button" onClick={() => !runningRef.current && setPestana(k)}
                                        className={cn("flex-1 h-8 rounded-lg text-[12px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors", pestana === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                        <I size={13} /> {t}
                                    </button>
                                ))}
                            </div>
                            {pestana === "todas" && (
                                <div className="flex items-center">
                                    {PASOS.map((s, i) => (
                                        <div key={s.k} className="flex items-center flex-1 last:flex-none">
                                            <span className={cn("flex items-center gap-1.5 text-[11px] font-bold transition-colors", s.hecho ? "text-emerald-500" : s.activo ? "text-indigo-500" : "text-muted-foreground/50")}>
                                                <span className={cn("h-7 w-7 rounded-full grid place-items-center border-2 transition-all", s.hecho ? "bg-emerald-500 border-emerald-500 text-white" : s.activo ? "border-indigo-500 bg-indigo-500/10" : "border-border")}>
                                                    {s.hecho ? <Check size={13} /> : s.activo && (s.k === "analizar" || s.k === "sincronizar") ? <Loader2 size={13} className="animate-spin" /> : <s.I size={13} />}
                                                </span>
                                                <span className="hidden sm:inline">{s.t}</span>
                                            </span>
                                            {i < PASOS.length - 1 && <span className="flex-1 h-0.5 mx-2 rounded bg-border overflow-hidden"><motion.span className="block h-full bg-emerald-500" initial={false} animate={{ width: s.hecho ? "100%" : "0%" }} transition={{ duration: 0.4 }} /></span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    }
                    pie={pestana === "todas" ? (
                        <div className="flex items-center gap-2 w-full">
                            {step === "plan" && <Button variant="ghost" size="sm" onClick={analyze}><RefreshCw size={13} className="mr-1.5" /> Re-analizar</Button>}
                            <span className="flex-1 text-[12px] text-muted-foreground">{step === "running" ? "No cierres el cajón: otros administradores no pueden sincronizar hasta que termine." : ""}</span>
                            {step !== "running" && <Button variant="outline" onClick={close}>{step === "done" ? "Cerrar" : "Cancelar"}</Button>}
                            {step === "plan" && (
                                <Button onClick={run} disabled={online.length === 0 || (mode === "incremental" && totAdd === 0 && totRemove === 0)}
                                    className={cn("text-white gap-1.5", mode === "full" ? "bg-red-600 hover:bg-red-500" : "bg-indigo-600 hover:bg-indigo-500")}>
                                    {mode === "full" ? <RefreshCw size={14} /> : <Zap size={14} />}
                                    {mode === "incremental" && totAdd === 0 && totRemove === 0 ? "Nada que sincronizar" : `Sincronizar ${online.length} cámara${online.length !== 1 ? "s" : ""}`}
                                </Button>
                            )}
                        </div>
                    ) : <div className="flex justify-end w-full"><Button variant="outline" onClick={close}>Cerrar</Button></div>}>

                    {pestana === "usuario" ? <BuscarUsuario /> : (
                        <div className="px-6 py-5">
                            <AnimatePresence mode="wait">
                                {step === "blocked" && (
                                    <motion.div key="b" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-center py-10">
                                        <div className="inline-flex p-3 rounded-full bg-amber-500/10 border border-amber-500/30 mb-3"><Lock className="text-amber-500" size={26} /></div>
                                        <p className="text-sm font-bold">Hay una sincronización en curso</p>
                                        <p className="text-xs text-muted-foreground mt-1">Iniciada por <b className="text-amber-500">{lockBy}</b>. Esperá a que termine para no pisar el proceso.</p>
                                        <Button onClick={analyze} className="mt-5 gap-1.5"><RefreshCw size={14} /> Reintentar</Button>
                                    </motion.div>
                                )}
                                {step === "analyzing" && (
                                    <motion.div key="a" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="py-12 flex flex-col items-center gap-3">
                                        <div className="relative h-16 w-16">
                                            <span className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
                                            <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
                                            <ScanLine size={24} className="absolute inset-0 m-auto text-indigo-500" />
                                        </div>
                                        <p className="text-sm font-bold">Leyendo las cámaras…</p>
                                        <p className="text-xs text-muted-foreground">Contando las matrículas cargadas en cada cámara LPR y comparándolas con la base.</p>
                                    </motion.div>
                                )}
                                {step === "plan" && plan && (
                                    <motion.div key="p" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                        <div className="grid grid-cols-3 gap-2">
                                            {[[Database, "En la base", plan.dbCount, "text-sky-500", "border-border"], [Plus, "A agregar", totAdd, "text-emerald-500", "border-emerald-500/25"], [Trash2, "A quitar", totRemove, "text-red-500", "border-red-500/25"]].map(([I, t, n, c, b]: any) => (
                                                <div key={t} className={cn("rounded-xl border bg-card/50 p-3 flex items-center gap-3", b)}>
                                                    <span className={cn("w-9 h-9 rounded-lg bg-muted/60 grid place-items-center", c)}><I size={16} /></span>
                                                    <span><span className="block text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{t}</span><span className={cn("block text-[18px] font-bold tabular-nums leading-tight", c)}>{n}</span></span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="border border-border rounded-xl overflow-hidden">
                                            <div className="grid grid-cols-[1fr_64px_56px_56px] gap-2 px-3 py-2 bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                <span>Cámara</span><span className="text-center">Tiene</span><span className="text-center">+Agr</span><span className="text-center">−Quit</span>
                                            </div>
                                            <div className="max-h-64 overflow-y-auto divide-y divide-border">
                                                {plan.devices.map((d: any) => (
                                                    <div key={d.id} className="grid grid-cols-[1fr_64px_56px_56px] gap-2 px-3 py-2 items-center text-xs">
                                                        <div className="min-w-0 flex items-center gap-2">
                                                            {d.online ? <Wifi size={13} className="text-emerald-500 shrink-0" /> : <WifiOff size={13} className="text-red-500 shrink-0" />}
                                                            <div className="min-w-0"><p className="font-semibold truncate">{d.name}</p><p className="text-[10px] text-muted-foreground font-mono">{d.ip}{d.direction ? ` · ${d.direction === "EXIT" ? "Salida" : "Entrada"}` : ""}</p></div>
                                                        </div>
                                                        {d.online ? (<>
                                                            <span className="text-center font-mono tabular-nums text-muted-foreground">{d.currentCount}</span>
                                                            <span className={cn("text-center font-mono tabular-nums font-bold", d.toAdd ? "text-emerald-500" : "text-muted-foreground/40")}>{d.toAdd || "—"}</span>
                                                            <span className={cn("text-center font-mono tabular-nums font-bold", d.toRemove ? "text-red-500" : "text-muted-foreground/40")}>{d.toRemove || "—"}</span>
                                                        </>) : <span className="col-span-3 text-right text-[11px] text-red-500">Sin conexión</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        {offline.length > 0 && <p className="text-[11px] text-amber-500 flex items-center gap-1.5"><Info size={12} /> {offline.length} cámara{offline.length !== 1 ? "s" : ""} sin conexión: se omiten esta vez.</p>}
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={() => setMode("incremental")} className={cn("text-left rounded-xl border p-3 transition", mode === "incremental" ? "border-indigo-500/60 bg-indigo-500/10 ring-1 ring-indigo-500/40" : "border-border hover:bg-accent")}>
                                                <div className="flex items-center gap-1.5 mb-1"><Zap size={14} className="text-indigo-500" /><span className="text-xs font-bold">Incremental</span><span className="text-[9px] font-bold uppercase bg-emerald-500/15 text-emerald-500 px-1.5 py-0.5 rounded">Recomendado</span></div>
                                                <p className="text-[11px] text-muted-foreground leading-snug">Sólo aplica las diferencias. Las cámaras nunca quedan sin lista.</p>
                                            </button>
                                            <button onClick={() => setMode("full")} className={cn("text-left rounded-xl border p-3 transition", mode === "full" ? "border-red-500/60 bg-red-500/10 ring-1 ring-red-500/40" : "border-border hover:bg-accent")}>
                                                <div className="flex items-center gap-1.5 mb-1"><RefreshCw size={14} className="text-red-500" /><span className="text-xs font-bold">Reemplazo total</span></div>
                                                <p className="text-[11px] text-muted-foreground leading-snug">Borra la lista de cada cámara y recarga todo. Sólo para reparar.</p>
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                                {(step === "running" || step === "done") && (
                                    <motion.div key="r" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                        <div className="space-y-1.5">
                                            <div className="flex items-center gap-2 text-sm">
                                                {step === "running" ? <><Loader2 size={16} className="animate-spin text-indigo-500" /> <b>Sincronizando…</b></> : <><CheckCircle2 size={16} className="text-emerald-500" /> <b>Sincronización finalizada</b></>}
                                                <span className="ml-auto text-[11px] font-bold tabular-nums text-muted-foreground">{hechos}/{online.length} · {pct}%</span>
                                            </div>
                                            <div className="h-2 rounded-full bg-muted overflow-hidden"><motion.div className={cn("h-full", step === "done" ? "bg-emerald-500" : "bg-indigo-500")} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.35 }} /></div>
                                        </div>
                                        <div className="border border-border rounded-xl divide-y divide-border max-h-80 overflow-y-auto">
                                            {online.map((d: any) => {
                                                const p = prog[d.id] || { status: "pending" };
                                                return (
                                                    <motion.div key={d.id} layout className={cn("flex items-center gap-3 px-3 py-2.5 transition-colors", p.status === "running" && "bg-indigo-500/5")}>
                                                        <span className="shrink-0">
                                                            {p.status === "pending" && <span className="block w-5 h-5 rounded-full border-2 border-dashed border-muted-foreground/30" />}
                                                            {p.status === "running" && <Loader2 size={18} className="animate-spin text-indigo-500" />}
                                                            {p.status === "done" && <CheckCircle2 size={18} className="text-emerald-500" />}
                                                            {p.status === "error" && <XCircle size={18} className="text-red-500" />}
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-semibold truncate">{d.name} <span className="text-[10px] text-muted-foreground font-mono font-normal">{d.ip}</span></p>
                                                            {p.status === "error" && <p className="text-[11px] text-red-500 truncate">{p.error}</p>}
                                                            {p.status === "done" && (
                                                                <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                                                                    {!!p.added && <span className="text-emerald-500">+{p.added} agregadas</span>}
                                                                    {!!p.removed && <span className="text-red-500">−{p.removed} quitadas</span>}
                                                                    {!p.added && !p.removed && <span>sin cambios</span>}
                                                                    {(!!p.addFail || !!p.remFail) && <span className="text-amber-500">({(p.addFail || 0) + (p.remFail || 0)} fallidas)</span>}
                                                                </p>
                                                            )}
                                                            {p.status === "running" && <p className="text-[11px] text-indigo-500">aplicando cambios…</p>}
                                                            {p.status === "pending" && <p className="text-[11px] text-muted-foreground/60">en cola</p>}
                                                        </div>
                                                    </motion.div>
                                                );
                                            })}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                    <Tooltip id={TT} place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
                </CajonContenido>
            </Cajon>
        </>
    );
}

/** Buscar un usuario y ver en qué cámaras está cada una de sus matrículas. */
function BuscarUsuario() {
    const [q, setQ] = useState("");
    const [buscando, setBuscando] = useState(false);
    const [res, setRes] = useState<any>(null);
    const [cargando, setCargando] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { ref.current?.focus(); }, []);

    const buscar = async (t = q) => {
        if (t.trim().length < 2) return;
        setBuscando(true);
        try { const r = await buscarUsuarioEnCamaras(t); if (!r.ok) toast.error({ title: "No se pudo buscar", description: (r as any).error }); else setRes(r); }
        finally { setBuscando(false); }
    };
    const cargar = async (u: any) => {
        setCargando(u.id);
        try {
            const r = await sincronizarUsuario(u.id);
            if (!r.ok) { toast.error({ title: "No se pudo", description: (r as any).error }); return; }
            const n = r.resultados.reduce((a, x) => a + x.agregadas, 0); const fallas = r.resultados.filter((x) => x.error).length;
            if (fallas) toast.error({ title: `${n} matrícula${n !== 1 ? "s" : ""} cargada${n !== 1 ? "s" : ""}, ${fallas} cámara${fallas !== 1 ? "s" : ""} sin respuesta` });
            else toast.success({ title: n ? `${n} matrícula${n !== 1 ? "s" : ""} cargada${n !== 1 ? "s" : ""} en las cámaras` : "Ya estaba todo cargado", description: u.name });
            await buscar();
        } finally { setCargando(null); }
    };

    const Estado = ({ e }: { e: string }) => e === "whiteList" ? <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold"><Check size={12} /> Cargada</span>
        : e === "blackList" ? <span className="inline-flex items-center gap-1 text-red-500 font-semibold"><Ban size={12} /> Lista negra</span>
            : e === "falta" ? <span className="inline-flex items-center gap-1 text-amber-500 font-semibold"><X size={12} /> Falta</span>
                : <span className="inline-flex items-center gap-1 text-muted-foreground"><WifiOff size={12} /> Sin respuesta</span>;

    return (
        <div className="px-6 py-5 space-y-4">
            <form onSubmit={(e) => { e.preventDefault(); buscar(); }} className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, matrícula o lote. Ej.: Pérez, SCK2453, G18"
                    className="h-11 w-full rounded-xl border border-border bg-background pl-11 pr-28 text-[13.5px] outline-none focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-500/10" />
                <Button type="submit" size="sm" disabled={buscando || q.trim().length < 2} className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 gap-1.5">{buscando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar</Button>
            </form>
            {!res && !buscando && <div className="py-10 text-center text-[12.5px] text-muted-foreground space-y-2"><UserRound size={26} className="mx-auto opacity-40" /><p>Buscá un usuario para ver, cámara por cámara, si sus matrículas están cargadas.</p></div>}
            {buscando && <div className="py-10 grid place-items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 size={22} className="animate-spin text-indigo-500" /> Consultando cada cámara…</div>}
            {res && !buscando && res.usuarios.length === 0 && <p className="py-8 text-center text-[12.5px] text-muted-foreground">Nadie coincide con «{q}».</p>}
            {res && !buscando && res.usuarios.map((u: any) => {
                const faltan = u.plates.reduce((a: number, p: any) => a + Object.values(p.camaras).filter((e) => e === "falta").length, 0);
                return (
                    <motion.div key={u.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card/50 overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
                            <span className="h-9 w-9 rounded-full bg-indigo-500/10 text-indigo-500 grid place-items-center"><UserRound size={17} /></span>
                            <div className="min-w-0 flex-1">
                                <p className="font-bold text-[13.5px] truncate">{u.name}</p>
                                <p className="text-[11px] text-muted-foreground flex items-center gap-2">{u.lote && <span className="inline-flex items-center gap-1"><Home size={11} /> {u.lote}</span>}<span>{u.plates.length} matrícula{u.plates.length !== 1 ? "s" : ""}</span></p>
                            </div>
                            {faltan > 0 ? (
                                <Button size="sm" onClick={() => cargar(u)} disabled={cargando === u.id} className="gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white" {...tip("Carga en la lista blanca de cada cámara LPR las matrículas de este usuario que falten. No toca las demás.")}>
                                    {cargando === u.id ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Cargar {faltan} faltante{faltan !== 1 ? "s" : ""}
                                </Button>
                            ) : u.plates.length ? <span className="text-[11px] font-bold text-emerald-500 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Al día</span> : <span className="text-[11px] text-muted-foreground">Sin matrículas</span>}
                        </div>
                        {u.plates.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-[11.5px]">
                                    <thead><tr className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30">
                                        <th className="text-left py-2 pl-4 font-semibold">Cámara</th>
                                        {u.plates.map((p: any) => <th key={p.value} className="text-left font-semibold font-mono px-2">{p.value}</th>)}
                                    </tr></thead>
                                    <tbody>
                                        {res.camaras.map((c: any) => (
                                            <tr key={c.id} className="border-t border-border/50">
                                                <td className="py-1.5 pl-4"><span className="inline-flex items-center gap-1.5">{c.direction === "EXIT" ? <LogOut size={12} className="text-orange-500" /> : <LogIn size={12} className="text-emerald-500" />}<span className="truncate max-w-[200px]">{c.name}</span></span></td>
                                                {u.plates.map((p: any) => <td key={p.value} className="px-2"><Estado e={p.camaras[c.id]} /></td>)}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </motion.div>
                );
            })}
        </div>
    );
}
