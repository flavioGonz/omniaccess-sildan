"use client";

import { useEffect, useState, useCallback } from "react";
import {
    CalendarClock, Plus, Trash2, Pencil, Save, X, ToggleLeft, ToggleRight, Clock, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    getReportSchedules, createReportSchedule, updateReportSchedule, deleteReportSchedule,
} from "@/app/actions/queue";

type Sched = {
    id: string; name: string; enabled: boolean; frequency: string; time: string;
    dayOfWeek: number; period: string; channel: string;
};
const DAYS = [{ v: 1, l: "Lun" }, { v: 2, l: "Mar" }, { v: 3, l: "Mié" }, { v: 4, l: "Jue" }, { v: 5, l: "Vie" }, { v: 6, l: "Sáb" }, { v: 7, l: "Dom" }];
const empty = { name: "", enabled: true, frequency: "daily", time: "22:00", dayOfWeek: 7, channel: "telegram" };

export default function SchedulesManager() {
    const [items, setItems] = useState<Sched[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<any>(empty);

    const load = useCallback(async () => {
        try { setItems(await getReportSchedules() as any); }
        catch (e) { console.error(e); } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const reset = () => { setForm(empty); setEditingId(null); setShowForm(false); };
    const edit = (s: Sched) => { setForm({ ...s }); setEditingId(s.id); setShowForm(true); };
    const save = async () => {
        if (!form.name.trim()) { toast.error("Nombre requerido"); return; }
        try {
            const payload = { ...form, dayOfWeek: Number(form.dayOfWeek) };
            if (editingId) { await updateReportSchedule(editingId, payload); toast.success("Horario actualizado"); }
            else { await createReportSchedule(payload); toast.success("Horario creado"); }
            reset(); load();
        } catch { toast.error("Error al guardar"); }
    };
    const remove = async (id: string) => { await deleteReportSchedule(id); toast.success("Horario eliminado"); load(); };
    const toggle = async (s: Sched) => { await updateReportSchedule(s.id, { enabled: !s.enabled }); load(); };

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <CalendarClock size={16} className="text-violet-400" />
                    <span className="text-sm font-bold text-foreground">Reportes programados</span>
                    <span className="text-[11px] text-muted-foreground">· {items.length}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={load} className="p-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground transition" title="Recargar">
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    </button>
                    <button onClick={() => { setForm(empty); setEditingId(null); setShowForm(true); }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition">
                        <Plus size={14} /> Nuevo
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="p-4 border-b border-border bg-foreground/[0.02] space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-foreground/70 md:col-span-2">
                            Nombre
                            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej. Resumen diario"
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                        </label>
                        <label className="text-xs font-medium text-foreground/70">
                            Frecuencia
                            <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500">
                                <option value="daily">Diario</option>
                                <option value="weekly">Semanal</option>
                            </select>
                        </label>
                        <label className="text-xs font-medium text-foreground/70">
                            Hora
                            <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })}
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500" />
                        </label>
                        {form.frequency === "weekly" && (
                            <label className="text-xs font-medium text-foreground/70">
                                Día
                                <select value={form.dayOfWeek} onChange={e => setForm({ ...form, dayOfWeek: e.target.value })}
                                    className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500">
                                    {DAYS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                                </select>
                            </label>
                        )}
                        <label className="text-xs font-medium text-foreground/70">
                            Canal
                            <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}
                                className="mt-1 w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-violet-500">
                                <option value="telegram">Telegram</option>
                                <option value="whatsapp">WhatsApp</option>
                                <option value="email">Email</option>
                            </select>
                        </label>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                        <button onClick={save} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition"><Save size={14} /> Guardar</button>
                        <button onClick={reset} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted hover:bg-accent text-foreground text-sm font-semibold transition"><X size={14} /> Cancelar</button>
                    </div>
                </div>
            )}

            <div className="divide-y divide-border">
                {items.length === 0 && !loading ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                        <CalendarClock size={22} className="opacity-40" /> Sin horarios. Crea uno para enviar reportes automáticamente.
                    </div>
                ) : items.map(s => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                        <button onClick={() => toggle(s)} title={s.enabled ? "Activo" : "Inactivo"} className="shrink-0">
                            {s.enabled ? <ToggleRight size={26} className="text-emerald-400" /> : <ToggleLeft size={26} className="text-muted-foreground" />}
                        </button>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-foreground truncate">{s.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono">{s.frequency === "weekly" ? "Semanal" : "Diario"}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                <span className="flex items-center gap-1"><Clock size={10} /> {s.time}{s.frequency === "weekly" ? ` · ${DAYS.find(d => d.v === s.dayOfWeek)?.l}` : ""}</span>
                                <span>→ {s.channel}</span>
                            </div>
                        </div>
                        <button onClick={() => edit(s)} className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"><Pencil size={14} /></button>
                        <button onClick={() => remove(s.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition"><Trash2 size={14} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}
