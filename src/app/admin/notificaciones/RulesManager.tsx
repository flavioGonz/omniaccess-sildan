"use client";

import { useEffect, useState, useCallback } from "react";
import {
    SlidersHorizontal, Plus, Trash2, Pencil, Save, X, Clock, Gauge,
    ToggleLeft, ToggleRight, Bell, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    getNotificationRules, createNotificationRule, updateNotificationRule, deleteNotificationRule,
    getQueueDevices,
} from "@/app/actions/queue";

type Rule = {
    id: string; name: string; enabled: boolean; deviceId: string | null; channelName: string | null;
    metric: string; operator: string; threshold: number; daysOfWeek: string; startTime: string;
    endTime: string; channels: string; minSeverity: string | null; cooldownSec: number; dedupe: boolean;
};
type Dev = { id: string; name: string };

const METRICS = [{ v: "aforo", l: "Aforo" }, { v: "entrada", l: "Entradas" }, { v: "salida", l: "Salidas" }];
const OPERATORS = [">=", ">", "==", "<="];
const ZONES = ["Aforo", "Entrada", "Salida"];
const CHANNEL_OPTS = [{ v: "telegram", l: "Telegram" }, { v: "whatsapp", l: "WhatsApp" }, { v: "email", l: "Email" }, { v: "webpush", l: "PWA / Push" }];
const DAYS = [{ v: "1", l: "L" }, { v: "2", l: "M" }, { v: "3", l: "X" }, { v: "4", l: "J" }, { v: "5", l: "V" }, { v: "6", l: "S" }, { v: "7", l: "D" }];

const empty = {
    name: "", enabled: true, deviceId: "", channelName: "", metric: "aforo", operator: ">=",
    threshold: 5, daysOfWeek: "1,2,3,4,5,6,7", startTime: "00:00", endTime: "23:59",
    channels: "telegram", minSeverity: "", cooldownSec: 60, dedupe: true,
};

export default function RulesManager() {
    const [rules, setRules] = useState<Rule[]>([]);
    const [devices, setDevices] = useState<Dev[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<any>(empty);

    const load = useCallback(async () => {
        try {
            const [r, d] = await Promise.all([getNotificationRules(), getQueueDevices()]);
            setRules(r as any); setDevices(d as any);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const reset = () => { setForm(empty); setEditingId(null); setShowForm(false); };
    const edit = (r: Rule) => {
        setForm({ ...r, deviceId: r.deviceId || "", channelName: r.channelName || "", minSeverity: r.minSeverity || "" });
        setEditingId(r.id); setShowForm(true);
    };
    const toggleDay = (d: string) => {
        const set = new Set(form.daysOfWeek.split(",").filter(Boolean));
        set.has(d) ? set.delete(d) : set.add(d);
        const ordered = DAYS.map(x => x.v).filter(x => set.has(x)).join(",");
        setForm({ ...form, daysOfWeek: ordered });
    };
    const toggleChannel = (c: string) => {
        const set = new Set(form.channels.split(",").filter(Boolean));
        set.has(c) ? set.delete(c) : set.add(c);
        setForm({ ...form, channels: CHANNEL_OPTS.map(x => x.v).filter(x => set.has(x)).join(",") });
    };

    const save = async () => {
        if (!form.name.trim()) { toast.error("Nombre requerido"); return; }
        if (!form.channels) { toast.error("Elige al menos un canal"); return; }
        try {
            const payload = { ...form, threshold: Number(form.threshold), cooldownSec: Number(form.cooldownSec) };
            if (editingId) { await updateNotificationRule(editingId, payload); toast.success("Regla actualizada"); }
            else { await createNotificationRule(payload); toast.success("Regla creada"); }
            reset(); load();
        } catch (e: any) { toast.error("Error al guardar"); }
    };
    const remove = async (id: string) => { await deleteNotificationRule(id); toast.success("Regla eliminada"); load(); };
    const toggleEnabled = async (r: Rule) => { await updateNotificationRule(r.id, { enabled: !r.enabled }); load(); };

    const devName = (id: string | null) => id ? (devices.find(d => d.id === id)?.name || "?") : "Todas las cámaras";

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal size={16} className="text-violet-400" />
                    <span className="text-sm font-bold text-foreground">Reglas de notificación</span>
                    <span className="text-[11px] text-muted-foreground">· {rules.length}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={load} className="p-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground transition" title="Recargar">
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    </button>
                    <button onClick={() => { setForm(empty); setEditingId(null); setShowForm(true); }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition">
                        <Plus size={14} /> Nueva regla
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="p-4 border-b border-border bg-foreground/[0.02] space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-foreground/70 md:col-span-2">
                            Nombre
                            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej. Aforo crítico recepción"
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                        </label>
                        <label className="text-xs font-medium text-foreground/70">
                            Cámara
                            <select value={form.deviceId} onChange={e => setForm({ ...form, deviceId: e.target.value })}
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500">
                                <option value="">Todas</option>
                                {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-medium text-foreground/70">
                            Zona / canal
                            <select value={form.channelName} onChange={e => setForm({ ...form, channelName: e.target.value })}
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500">
                                <option value="">Cualquiera</option>
                                {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-medium text-foreground/70">
                            Métrica
                            <select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })}
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500">
                                {METRICS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                            </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs font-medium text-foreground/70">
                                Operador
                                <select value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })}
                                    className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500">
                                    {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </label>
                            <label className="text-xs font-medium text-foreground/70">
                                Umbral
                                <input type="number" value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })}
                                    className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                            </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs font-medium text-foreground/70">
                                Desde
                                <input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })}
                                    className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                            </label>
                            <label className="text-xs font-medium text-foreground/70">
                                Hasta
                                <input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })}
                                    className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                            </label>
                        </div>
                        <label className="text-xs font-medium text-foreground/70">
                            Cooldown (segundos)
                            <input type="number" value={form.cooldownSec} onChange={e => setForm({ ...form, cooldownSec: e.target.value })}
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                        </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                        <div>
                            <div className="text-xs font-medium text-foreground/70 mb-1.5">Días</div>
                            <div className="flex gap-1">
                                {DAYS.map(d => {
                                    const on = form.daysOfWeek.split(",").includes(d.v);
                                    return <button key={d.v} type="button" onClick={() => toggleDay(d.v)}
                                        className={cn("w-8 h-8 rounded-md text-xs font-bold transition", on ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground")}>{d.l}</button>;
                                })}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs font-medium text-foreground/70 mb-1.5">Canales destino</div>
                            <div className="flex gap-1.5">
                                {CHANNEL_OPTS.map(c => {
                                    const on = form.channels.split(",").includes(c.v);
                                    return <button key={c.v} type="button" onClick={() => toggleChannel(c.v)}
                                        className={cn("px-3 h-8 rounded-md text-xs font-semibold transition border", on ? "bg-sky-600 text-white border-sky-500" : "bg-muted text-muted-foreground border-border hover:text-foreground")}>{c.l}</button>;
                                })}
                            </div>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium text-foreground/70 mt-4">
                            <input type="checkbox" checked={form.dedupe} onChange={e => setForm({ ...form, dedupe: e.target.checked })} />
                            Evitar duplicados (dedupe)
                        </label>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                        <button onClick={save} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition"><Save size={14} /> Guardar</button>
                        <button onClick={reset} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted hover:bg-accent text-foreground text-sm font-semibold transition"><X size={14} /> Cancelar</button>
                    </div>
                </div>
            )}

            <div className="divide-y divide-border">
                {rules.length === 0 && !loading ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                        <Bell size={22} className="opacity-40" /> Sin reglas. Crea una para empezar a notificar según criterios.
                    </div>
                ) : METRICS.map(group => {
                    const groupRules = rules.filter(r => (r.metric || "aforo") === group.v);
                    if (groupRules.length === 0) return null;
                    return (
                      <div key={group.v}>
                        <div className="px-4 py-1.5 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> {group.l} <span className="text-muted-foreground/60">({groupRules.length})</span>
                        </div>
                        {groupRules.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-t border-border/40">
                        <button onClick={() => toggleEnabled(r)} title={r.enabled ? "Activa" : "Inactiva"} className="shrink-0">
                            {r.enabled ? <ToggleRight size={26} className="text-emerald-400" /> : <ToggleLeft size={26} className="text-muted-foreground" />}
                        </button>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-foreground truncate">{r.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono">{r.metric} {r.operator} {r.threshold}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                                <span>{devName(r.deviceId)}{r.channelName ? ` · ${r.channelName}` : ""}</span>
                                <span className="flex items-center gap-1"><Clock size={10} /> {r.startTime}–{r.endTime} · {r.daysOfWeek.split(",").map(d => DAYS.find(x => x.v === d)?.l).join("")}</span>
                                <span className="flex items-center gap-1"><Gauge size={10} /> cooldown {r.cooldownSec}s</span>
                                <span>→ {r.channels}</span>
                            </div>
                        </div>
                        <button onClick={() => edit(r)} className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"><Pencil size={14} /></button>
                        <button onClick={() => remove(r.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition"><Trash2 size={14} /></button>
                    </div>
                        ))}
                      </div>
                    );
                })}
            </div>
        </div>
    );
}
