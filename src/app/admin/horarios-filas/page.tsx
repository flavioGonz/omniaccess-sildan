"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Calendar, Clock, Plus, Trash2, Pencil, RotateCcw, Power,
    Store, X, Check, Loader2, CalendarClock, Repeat, AlertTriangle,
} from "lucide-react";
import {
    getQueueSchedules, createQueueSchedule, updateQueueSchedule,
    deleteQueueSchedule, runQueueReset,
} from "@/app/actions/queue-schedules";
import { getDevices } from "@/app/actions/devices";

type Schedule = {
    id: string;
    name: string;
    deviceId: string | null;
    daysOfWeek: string;
    openTime: string;
    closeTime: string;
    resetOnOpen: boolean;
    enabled: boolean;
    lastResetAt: string | Date | null;
    createdAt: string | Date;
    updatedAt: string | Date;
};

const DAYS = [
    { n: 1, short: "Lun", long: "Lunes" },
    { n: 2, short: "Mar", long: "Martes" },
    { n: 3, short: "Mié", long: "Miércoles" },
    { n: 4, short: "Jue", long: "Jueves" },
    { n: 5, short: "Vie", long: "Viernes" },
    { n: 6, short: "Sáb", long: "Sábado" },
    { n: 7, short: "Dom", long: "Domingo" },
];

const HOUR_START = 6;  // grid starts 06:00
const HOUR_END = 24;   // grid ends 24:00

function toMin(hhmm: string): number {
    const [h, m] = (hhmm || "0:0").split(":").map((x) => parseInt(x, 10));
    return (h || 0) * 60 + (m || 0);
}
function todayDow(): number {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
}
function fmtAgo(d: string | Date | null): string {
    if (!d) return "nunca";
    const t = new Date(d).getTime();
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "hace instantes";
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const days = Math.floor(h / 24);
    return `hace ${days} d`;
}

const PALETTE = [
    "#8b5cf6", "#06b6d4", "#f59e0b", "#ec4899", "#10b981", "#ef4444", "#6366f1",
];

export default function HorariosFilasPage() {
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [devices, setDevices] = useState<{ id: string; name: string; deviceType?: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Schedule | null>(null);
    const [resetting, setResetting] = useState(false);
    const [resetMsg, setResetMsg] = useState<string | null>(null);
    const [confirmDel, setConfirmDel] = useState<Schedule | null>(null);

    const load = useCallback(async () => {
        try {
            const [s, d] = await Promise.all([getQueueSchedules(), getDevices()]);
            setSchedules(s as any);
            setDevices((d as any[]).filter((x) => x.deviceType === "QUEUE_COUNTER"));
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const colorFor = useCallback(
        (id: string) => {
            const idx = schedules.findIndex((s) => s.id === id);
            return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
        },
        [schedules]
    );

    const handleResetNow = async () => {
        setResetting(true);
        setResetMsg(null);
        try {
            const r = await runQueueReset(null);
            setResetMsg(`Contadores reseteados (${(r as any)?.reset ?? 0} dispositivo/s)`);
            setTimeout(() => setResetMsg(null), 4000);
        } catch (e: any) {
            setResetMsg("Error al resetear: " + (e?.message || "desconocido"));
        } finally {
            setResetting(false);
        }
    };

    const toggleEnabled = async (s: Schedule) => {
        await updateQueueSchedule(s.id, { enabled: !s.enabled });
        load();
    };

    const doDelete = async (s: Schedule) => {
        await deleteQueueSchedule(s.id);
        setConfirmDel(null);
        load();
    };

    const deviceName = (id: string | null) =>
        id ? (devices.find((d) => d.id === id)?.name || "Dispositivo") : "Todas las filas";

    return (
        <div className="min-h-screen bg-background text-foreground p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-900/40">
                        <CalendarClock size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Horarios de Filas</h1>
                        <p className="text-xs text-muted-foreground">
                            Programación de apertura y reseteo automático de contadores
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleResetNow}
                        disabled={resetting}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-muted hover:bg-accent border border-border text-sm font-medium transition disabled:opacity-50"
                    >
                        {resetting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                        Reset ahora
                    </button>
                    <button
                        onClick={() => { setEditing(null); setModalOpen(true); }}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-semibold transition shadow-lg shadow-violet-900/30"
                    >
                        <Plus size={16} /> Nuevo horario
                    </button>
                </div>
            </div>

            {resetMsg && (
                <div className="mb-4 px-4 py-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-sm flex items-center gap-2">
                    <Check size={15} /> {resetMsg}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
                {/* Calendar grid */}
                <div className="bg-card/60 border border-border rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-foreground/80">
                        <Calendar size={16} className="text-violet-400" /> Vista semanal
                    </div>
                    <WeekGrid schedules={schedules} colorFor={colorFor} />
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        {schedules.filter((s) => s.enabled).map((s) => (
                            <div key={s.id} className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-sm" style={{ background: colorFor(s.id) }} />
                                {s.name}
                            </div>
                        ))}
                        {schedules.filter((s) => s.enabled).length === 0 && (
                            <span>No hay horarios activos.</span>
                        )}
                    </div>
                </div>

                {/* Sidebar list */}
                <div className="bg-card/60 border border-border rounded-2xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-foreground/80">
                        <Clock size={16} className="text-violet-400" /> Horarios creados
                        <span className="ml-auto text-xs text-muted-foreground">{schedules.length}</span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    ) : schedules.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                            <CalendarClock size={32} className="mb-2 opacity-40" />
                            <p className="text-sm">Aún no hay horarios.</p>
                            <p className="text-xs mt-1">Crea uno para automatizar el reseteo.</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 230px)" }}>
                            {schedules.map((s) => {
                                const days = s.daysOfWeek.split(",").map((x) => parseInt(x, 10));
                                const isToday = days.includes(todayDow());
                                return (
                                    <div
                                        key={s.id}
                                        className={`rounded-xl border p-3 transition ${s.enabled ? "bg-muted/50 border-border" : "bg-card/40 border-border opacity-60"}`}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: colorFor(s.id) }} />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-sm truncate">{s.name}</p>
                                                    {isToday && s.enabled && (
                                                        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-600/30 text-violet-300">Hoy</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
                                                    <Store size={11} /> {deviceName(s.deviceId)}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                                                    <Clock size={11} /> {s.openTime} – {s.closeTime}
                                                </div>
                                                <div className="flex flex-wrap gap-1 mt-1.5">
                                                    {DAYS.map((d) => (
                                                        <span
                                                            key={d.n}
                                                            className={`text-[9px] w-5 h-5 flex items-center justify-center rounded ${days.includes(d.n) ? "bg-violet-600/40 text-violet-200" : "bg-muted text-muted-foreground"}`}
                                                        >
                                                            {d.short[0]}
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-2">
                                                    {s.resetOnOpen && (
                                                        <span className="flex items-center gap-1 text-emerald-400/80">
                                                            <Repeat size={10} /> auto-reset
                                                        </span>
                                                    )}
                                                    <span>Último: {fmtAgo(s.lastResetAt)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border">
                                            <button
                                                onClick={() => toggleEnabled(s)}
                                                title={s.enabled ? "Desactivar" : "Activar"}
                                                className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition ${s.enabled ? "text-emerald-400 hover:bg-emerald-950/40" : "text-muted-foreground hover:bg-accent"}`}
                                            >
                                                <Power size={12} /> {s.enabled ? "Activo" : "Inactivo"}
                                            </button>
                                            <div className="ml-auto flex items-center gap-1">
                                                <button
                                                    onClick={() => { setEditing(s); setModalOpen(true); }}
                                                    className="p-1.5 rounded-md text-muted-foreground hover:text-violet-300 hover:bg-accent transition"
                                                    title="Editar"
                                                >
                                                    <Pencil size={13} />
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDel(s)}
                                                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-accent transition"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {modalOpen && (
                <ScheduleModal
                    schedule={editing}
                    devices={devices}
                    onClose={() => setModalOpen(false)}
                    onSaved={() => { setModalOpen(false); load(); }}
                />
            )}

            {confirmDel && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-card border border-border rounded-2xl p-5 max-w-sm w-full">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-red-950/60 flex items-center justify-center">
                                <AlertTriangle size={18} className="text-red-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold">Eliminar horario</h3>
                                <p className="text-xs text-muted-foreground">"{confirmDel.name}"</p>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">
                            Esta acción no se puede deshacer. El reseteo automático asociado dejará de ejecutarse.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setConfirmDel(null)} className="px-3 py-2 rounded-lg bg-muted hover:bg-accent text-sm">Cancelar</button>
                            <button onClick={() => doDelete(confirmDel)} className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold">Eliminar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function WeekGrid({ schedules, colorFor }: { schedules: Schedule[]; colorFor: (id: string) => string }) {
    const hours: number[] = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) hours.push(h);
    const totalMin = (HOUR_END - HOUR_START) * 60;
    const active = schedules.filter((s) => s.enabled);

    return (
        <div className="flex gap-1.5">
            {/* hour axis */}
            <div className="flex flex-col text-[9px] text-muted-foreground pt-6 w-9 shrink-0">
                {hours.map((h) => (
                    <div key={h} style={{ height: `${100 / hours.length}%` }} className="relative">
                        <span className="absolute -top-1.5 right-1">{String(h).padStart(2, "0")}h</span>
                    </div>
                ))}
            </div>
            {/* day columns */}
            <div className="grid grid-cols-7 gap-1.5 flex-1" style={{ minHeight: 340 }}>
                {DAYS.map((d) => {
                    const isToday = d.n === todayDow();
                    return (
                        <div key={d.n} className="flex flex-col">
                            <div className={`text-center text-[11px] font-semibold pb-1.5 mb-1 ${isToday ? "text-violet-300" : "text-muted-foreground"}`}>
                                {d.short}
                            </div>
                            <div className={`relative flex-1 rounded-lg overflow-hidden ${isToday ? "bg-violet-950/20 ring-1 ring-violet-800/40" : "bg-muted/30"}`}>
                                {/* hour gridlines */}
                                {hours.slice(1).map((h, i) => (
                                    <div key={h} className="absolute left-0 right-0 border-t border-border/40" style={{ top: `${((i + 1) / hours.length) * 100}%` }} />
                                ))}
                                {/* schedule blocks */}
                                {active.filter((s) => s.daysOfWeek.split(",").map((x) => parseInt(x, 10)).includes(d.n)).map((s) => {
                                    const start = Math.max(toMin(s.openTime) - HOUR_START * 60, 0);
                                    const end = Math.min(toMin(s.closeTime) - HOUR_START * 60, totalMin);
                                    const top = (start / totalMin) * 100;
                                    const height = Math.max(((end - start) / totalMin) * 100, 2);
                                    const c = colorFor(s.id);
                                    return (
                                        <div
                                            key={s.id}
                                            title={`${s.name} · ${s.openTime}-${s.closeTime}`}
                                            className="absolute left-0.5 right-0.5 rounded-md overflow-hidden"
                                            style={{ top: `${top}%`, height: `${height}%`, background: `${c}33`, borderLeft: `3px solid ${c}` }}
                                        >
                                            <div className="px-1 pt-0.5 text-[8px] font-semibold leading-tight truncate" style={{ color: c }}>
                                                {s.openTime}
                                            </div>
                                            {s.resetOnOpen && (
                                                <Repeat size={8} className="absolute top-0.5 right-0.5" style={{ color: c }} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ScheduleModal({
    schedule, devices, onClose, onSaved,
}: {
    schedule: Schedule | null;
    devices: { id: string; name: string }[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [name, setName] = useState(schedule?.name || "");
    const [deviceId, setDeviceId] = useState<string>(schedule?.deviceId || "");
    const [days, setDays] = useState<number[]>(
        schedule ? schedule.daysOfWeek.split(",").map((x) => parseInt(x, 10)).filter(Boolean) : [1, 2, 3, 4, 5, 6]
    );
    const [openTime, setOpenTime] = useState(schedule?.openTime || "08:00");
    const [closeTime, setCloseTime] = useState(schedule?.closeTime || "20:00");
    const [resetOnOpen, setResetOnOpen] = useState(schedule?.resetOnOpen ?? true);
    const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const toggleDay = (n: number) =>
        setDays((prev) => (prev.includes(n) ? prev.filter((d) => d !== n) : [...prev, n].sort()));

    const save = async () => {
        if (!name.trim()) { setErr("El nombre es obligatorio."); return; }
        if (days.length === 0) { setErr("Selecciona al menos un día."); return; }
        setSaving(true); setErr(null);
        try {
            const payload = {
                name: name.trim(),
                deviceId: deviceId || null,
                daysOfWeek: days.join(","),
                openTime, closeTime, resetOnOpen, enabled,
            };
            if (schedule) await updateQueueSchedule(schedule.id, payload);
            else await createQueueSchedule(payload);
            onSaved();
        } catch (e: any) {
            setErr(e?.message || "Error al guardar");
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
                    <h3 className="font-semibold flex items-center gap-2">
                        <CalendarClock size={17} className="text-violet-400" />
                        {schedule ? "Editar horario" : "Nuevo horario"}
                    </h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                        <X size={17} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Nombre</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej: Apertura sucursal centro"
                            className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:border-violet-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Dispositivo</label>
                        <select
                            value={deviceId}
                            onChange={(e) => setDeviceId(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:border-violet-500 outline-none"
                        >
                            <option value="">Todas las filas (QUEUE_COUNTER)</option>
                            {devices.map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Días de la semana</label>
                        <div className="flex flex-wrap gap-1.5">
                            {DAYS.map((d) => (
                                <button
                                    key={d.n}
                                    onClick={() => toggleDay(d.n)}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${days.includes(d.n) ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground hover:bg-accent"}`}
                                >
                                    {d.short}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Apertura</label>
                            <input
                                type="time"
                                value={openTime}
                                onChange={(e) => setOpenTime(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:border-violet-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Cierre</label>
                            <input
                                type="time"
                                value={closeTime}
                                onChange={(e) => setCloseTime(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm focus:border-violet-500 outline-none"
                            />
                        </div>
                    </div>

                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border cursor-pointer">
                        <div className="flex items-center gap-2">
                            <Repeat size={15} className="text-emerald-400" />
                            <div>
                                <p className="text-sm font-medium">Reseteo automático</p>
                                <p className="text-[11px] text-muted-foreground">Pone los contadores en 0 al abrir</p>
                            </div>
                        </div>
                        <input type="checkbox" checked={resetOnOpen} onChange={(e) => setResetOnOpen(e.target.checked)} className="w-4 h-4 accent-violet-600" />
                    </label>

                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border cursor-pointer">
                        <div className="flex items-center gap-2">
                            <Power size={15} className="text-violet-400" />
                            <p className="text-sm font-medium">Horario activo</p>
                        </div>
                        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 accent-violet-600" />
                    </label>

                    {err && (
                        <div className="px-3 py-2 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-center gap-1.5">
                            <AlertTriangle size={13} /> {err}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-border sticky bottom-0 bg-card">
                    <button onClick={onClose} className="px-3.5 py-2 rounded-lg bg-muted hover:bg-accent text-sm">Cancelar</button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-semibold disabled:opacity-50"
                    >
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                        {schedule ? "Guardar cambios" : "Crear horario"}
                    </button>
                </div>
            </div>
        </div>
    );
}
