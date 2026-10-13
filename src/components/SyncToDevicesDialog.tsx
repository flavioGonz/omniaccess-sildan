"use client";

import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Loader2, Camera, CheckCircle2, XCircle, Server, Database, Plus, Trash2,
    ShieldCheck, RefreshCw, Lock, Wifi, WifiOff, ArrowRight, ListChecks, Zap, Info,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { getSyncPlan, acquireSyncLock, releaseSyncLock, touchSyncLock, syncDeviceIncremental, syncDeviceFull } from "@/app/actions/lpr-sync";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props { onSuccess: () => void; }
type Step = "analyzing" | "plan" | "running" | "done" | "blocked";
type Mode = "incremental" | "full";
type Prog = { status: "pending" | "running" | "done" | "error"; added?: number; removed?: number; addFail?: number; remFail?: number; error?: string };

export function SyncToDevicesDialog({ onSuccess }: Props) {
    const [open, setOpen] = useState(false);
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
        } catch { toast.error({ title: "No se pudo analizar los dispositivos" }); setStep("plan"); }
    }, []);

    const start = () => { setOpen(true); analyze(); };

    const close = () => {
        if (runningRef.current) return; // no cerrar durante la sincronización
        setOpen(false); setStep("analyzing"); setPlan(null); setProg({}); setLockBy("");
    };

    const run = async () => {
        const lock = await acquireSyncLock();
        if (!lock.ok) { setLockBy(lock.by || "otro administrador"); setStep("blocked"); return; }
        runningRef.current = true;
        setStep("running");
        const devices = (plan?.devices || []).filter((d: any) => d.online);
        const init: Record<string, Prog> = {};
        for (const d of devices) init[d.id] = { status: "pending" };
        setProg(init);
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

    // Totales del plan
    const online = (plan?.devices || []).filter((d: any) => d.online);
    const offline = (plan?.devices || []).filter((d: any) => !d.online);
    const totAdd = online.reduce((a: number, d: any) => a + d.toAdd, 0);
    const totRemove = online.reduce((a: number, d: any) => a + d.toRemove, 0);

    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={start}
                        className="bg-indigo-600/10 border-indigo-600/20 text-indigo-400 hover:bg-indigo-600/20 h-8 w-8">
                        <Camera size={16} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent><p>Sincronizar matrículas a las cámaras LPR</p></TooltipContent>
            </Tooltip>

            <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
                <DialogContent className="max-w-2xl bg-card border border-border p-0 overflow-hidden gap-0">
                    <DialogHeader className="p-5 border-b border-border">
                        <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2.5">
                            <div className="p-2 bg-indigo-600/10 rounded-lg border border-indigo-600/20"><Camera className="text-indigo-400" size={18} /></div>
                            Sincronizar matrículas a las cámaras
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Compara la base con lo que cada cámara ya tiene y aplica sólo las diferencias.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Pasos */}
                    <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/30 text-[10px] font-bold uppercase tracking-wider">
                        {[
                            { k: "analyze", label: "Analizar", icon: ListChecks, active: step === "analyzing" || step === "plan", done: step === "running" || step === "done" },
                            { k: "confirm", label: "Confirmar", icon: ShieldCheck, active: step === "plan", done: step === "running" || step === "done" },
                            { k: "sync", label: "Sincronizar", icon: RefreshCw, active: step === "running", done: step === "done" },
                            { k: "done", label: "Listo", icon: CheckCircle2, active: step === "done", done: step === "done" },
                        ].map((s, i) => (
                            <div key={s.k} className="flex items-center gap-2">
                                {i > 0 && <div className="w-4 h-px bg-border" />}
                                <span className={cn("flex items-center gap-1.5", s.done ? "text-emerald-400" : s.active ? "text-indigo-400" : "text-muted-foreground/50")}>
                                    <s.icon size={13} /> {s.label}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="p-5">
                        {/* BLOQUEADO por otro admin */}
                        {step === "blocked" && (
                            <div className="text-center py-8">
                                <div className="inline-flex p-3 rounded-full bg-amber-500/10 border border-amber-500/30 mb-3"><Lock className="text-amber-400" size={26} /></div>
                                <p className="text-sm font-bold text-foreground">Hay una sincronización en curso</p>
                                <p className="text-xs text-muted-foreground mt-1">Iniciada por <span className="font-bold text-amber-400">{lockBy}</span>. Esperá a que termine para no pisar el proceso.</p>
                                <div className="flex justify-center gap-2 mt-5">
                                    <Button variant="ghost" onClick={close}>Cerrar</Button>
                                    <Button onClick={analyze} className="bg-indigo-600 hover:bg-indigo-500 text-white"><RefreshCw size={14} className="mr-2" /> Reintentar</Button>
                                </div>
                            </div>
                        )}

                        {/* ANALIZANDO */}
                        {step === "analyzing" && (
                            <div className="text-center py-10">
                                <Loader2 className="animate-spin mx-auto text-indigo-400 mb-3" size={28} />
                                <p className="text-sm font-bold text-foreground">Leyendo las cámaras…</p>
                                <p className="text-xs text-muted-foreground mt-1">Contando las matrículas cargadas en cada dispositivo LPR.</p>
                            </div>
                        )}

                        {/* PLAN */}
                        {step === "plan" && plan && (
                            <div className="space-y-4">
                                {/* Resumen superior */}
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                                        <Database size={15} className="mx-auto text-blue-400 mb-1" />
                                        <p className="text-lg font-bold text-foreground leading-none tabular-nums">{plan.dbCount}</p>
                                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-1">En base</p>
                                    </div>
                                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-center">
                                        <Plus size={15} className="mx-auto text-emerald-400 mb-1" />
                                        <p className="text-lg font-bold text-emerald-400 leading-none tabular-nums">{totAdd}</p>
                                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-1">A agregar</p>
                                    </div>
                                    <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-center">
                                        <Trash2 size={15} className="mx-auto text-red-400 mb-1" />
                                        <p className="text-lg font-bold text-red-400 leading-none tabular-nums">{totRemove}</p>
                                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-1">A quitar</p>
                                    </div>
                                </div>

                                {/* Tabla por dispositivo */}
                                <div className="border border-border rounded-lg overflow-hidden">
                                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 bg-muted/40 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                                        <span>Cámara</span><span className="text-center w-14">Tiene</span><span className="text-center w-12">+Agr</span><span className="text-center w-12">−Quit</span>
                                    </div>
                                    <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-border">
                                        {plan.devices.map((d: any) => (
                                            <div key={d.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 items-center text-xs">
                                                <div className="min-w-0 flex items-center gap-2">
                                                    {d.online ? <Wifi size={13} className="text-emerald-400 shrink-0" /> : <WifiOff size={13} className="text-red-400 shrink-0" />}
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-foreground truncate">{d.name}</p>
                                                        <p className="text-[9px] text-muted-foreground font-mono">{d.ip}{d.direction ? ` · ${d.direction === "EXIT" ? "Salida" : "Entrada"}` : ""}</p>
                                                    </div>
                                                </div>
                                                {d.online ? (
                                                    <>
                                                        <span className="text-center w-14 font-mono tabular-nums text-muted-foreground">{d.currentCount}</span>
                                                        <span className={cn("text-center w-12 font-mono tabular-nums font-bold", d.toAdd ? "text-emerald-400" : "text-muted-foreground/40")}>{d.toAdd || "—"}</span>
                                                        <span className={cn("text-center w-12 font-mono tabular-nums font-bold", d.toRemove ? "text-red-400" : "text-muted-foreground/40")}>{d.toRemove || "—"}</span>
                                                    </>
                                                ) : (
                                                    <span className="col-span-3 text-right text-[10px] text-red-400 truncate">Sin conexión</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                {offline.length > 0 && <p className="text-[10px] text-amber-400 flex items-center gap-1.5"><Info size={11} /> {offline.length} cámara(s) sin conexión — se omiten en esta sincronización.</p>}

                                {/* Modo */}
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setMode("incremental")}
                                        className={cn("text-left rounded-lg border p-3 transition", mode === "incremental" ? "border-indigo-500/60 bg-indigo-500/10" : "border-border hover:bg-accent")}>
                                        <div className="flex items-center gap-1.5 mb-1"><Zap size={14} className="text-indigo-400" /><span className="text-xs font-bold text-foreground">Incremental</span><span className="text-[8px] font-bold uppercase bg-emerald-500/15 text-emerald-400 px-1 py-0.5 rounded">Recomendado</span></div>
                                        <p className="text-[10px] text-muted-foreground leading-snug">Sólo aplica las diferencias. Las cámaras nunca quedan sin lista.</p>
                                    </button>
                                    <button onClick={() => setMode("full")}
                                        className={cn("text-left rounded-lg border p-3 transition", mode === "full" ? "border-red-500/60 bg-red-500/10" : "border-border hover:bg-accent")}>
                                        <div className="flex items-center gap-1.5 mb-1"><RefreshCw size={14} className="text-red-400" /><span className="text-xs font-bold text-foreground">Reemplazo total</span></div>
                                        <p className="text-[10px] text-muted-foreground leading-snug">Borra la lista de cada cámara y recarga todo. Sólo para reparar.</p>
                                    </button>
                                </div>

                                <div className="flex justify-between items-center pt-3 border-t border-border">
                                    <Button variant="ghost" size="sm" onClick={analyze}><RefreshCw size={13} className="mr-1.5" /> Re-analizar</Button>
                                    <div className="flex gap-2">
                                        <Button variant="ghost" onClick={close}>Cancelar</Button>
                                        <Button onClick={run} disabled={online.length === 0 || (mode === "incremental" && totAdd === 0 && totRemove === 0)}
                                            className={cn("text-white", mode === "full" ? "bg-red-600 hover:bg-red-500" : "bg-indigo-600 hover:bg-indigo-500")}>
                                            {mode === "full" ? <RefreshCw size={14} className="mr-2" /> : <Zap size={14} className="mr-2" />}
                                            {mode === "incremental" && totAdd === 0 && totRemove === 0 ? "Nada que sincronizar" : `Sincronizar ${online.length} cámara(s)`}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* EJECUTANDO / RESULTADO */}
                        {(step === "running" || step === "done") && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm">
                                    {step === "running" ? <><Loader2 size={16} className="animate-spin text-indigo-400" /> <span className="font-bold text-foreground">Sincronizando…</span></>
                                        : <><CheckCircle2 size={16} className="text-emerald-400" /> <span className="font-bold text-foreground">Sincronización finalizada</span></>}
                                    <span className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-muted text-muted-foreground">{mode === "full" ? "Reemplazo total" : "Incremental"}</span>
                                </div>
                                <div className="border border-border rounded-lg divide-y divide-border max-h-72 overflow-y-auto custom-scrollbar">
                                    {online.map((d: any) => {
                                        const p = prog[d.id] || { status: "pending" };
                                        return (
                                            <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                                                <div className="shrink-0">
                                                    {p.status === "pending" && <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />}
                                                    {p.status === "running" && <Loader2 size={16} className="animate-spin text-indigo-400" />}
                                                    {p.status === "done" && <CheckCircle2 size={16} className="text-emerald-400" />}
                                                    {p.status === "error" && <XCircle size={16} className="text-red-400" />}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-medium text-foreground truncate">{d.name} <span className="text-[9px] text-muted-foreground font-mono">{d.ip}</span></p>
                                                    {p.status === "error" && <p className="text-[10px] text-red-400 truncate">{p.error}</p>}
                                                    {p.status === "done" && (
                                                        <p className="text-[10px] text-muted-foreground flex items-center gap-2">
                                                            {!!p.added && <span className="text-emerald-400">+{p.added} agregadas</span>}
                                                            {!!p.removed && <span className="text-red-400">−{p.removed} quitadas</span>}
                                                            {!p.added && !p.removed && <span>sin cambios</span>}
                                                            {(!!p.addFail || !!p.remFail) && <span className="text-amber-400">({(p.addFail || 0) + (p.remFail || 0)} fallidas)</span>}
                                                        </p>
                                                    )}
                                                    {p.status === "running" && <p className="text-[10px] text-indigo-300">aplicando cambios…</p>}
                                                    {p.status === "pending" && <p className="text-[10px] text-muted-foreground/60">en cola</p>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {step === "done" && (
                                    <div className="flex justify-end pt-2">
                                        <Button onClick={close} className="bg-indigo-600 hover:bg-indigo-500 text-white">Cerrar</Button>
                                    </div>
                                )}
                                {step === "running" && (
                                    <p className="text-[10px] text-muted-foreground text-center">No cierres esta ventana. Otros administradores no podrán iniciar una sincronización hasta que termine.</p>
                                )}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
