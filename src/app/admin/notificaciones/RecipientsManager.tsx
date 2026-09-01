"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, Plus, Save, Trash2, RefreshCw, X, Pencil, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getDispatchRecipients, saveDispatchRecipients, getWhatsAppSeenGroups } from "@/app/actions/queue";

type R = { id: string; name: string; channel: string; address: string; enabled: boolean };
const CHANNELS = [
    { v: "telegram", l: "Telegram", c: "#0ea5e9" },
    { v: "whatsapp", l: "WhatsApp", c: "#25D366" },
    { v: "email", l: "Email", c: "#f59e0b" },
];
const uid = () => Math.random().toString(36).slice(2, 9);
const chMeta = (v: string) => CHANNELS.find(c => c.v === v) || CHANNELS[0];
const ph = (ch: string) => ch === "whatsapp" ? "59899123456 o grupo (...@g.us)" : ch === "email" ? "correo@empresa.com" : "-100123456789 (chat id)";

export default function RecipientsManager() {
    const [list, setList] = useState<R[]>([]);
    const [editing, setEditing] = useState<R | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [waGroups, setWaGroups] = useState<{ id: string; name: string }[]>([]);

    const load = useCallback(async () => {
        try { const r = await getDispatchRecipients(); setList((r as any) || []); }
        catch (e) { console.error(e); } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { getWhatsAppSeenGroups().then(g => setWaGroups((g as any) || [])).catch(() => {}); }, []);

    const persist = async (next: R[]) => {
        setSaving(true);
        try { await saveDispatchRecipients(next as any); setList(next); }
        catch { toast.error("No se pudo guardar"); throw new Error("x"); }
        finally { setSaving(false); }
    };
    const startNew = () => setEditing({ id: uid(), name: "", channel: "whatsapp", address: "", enabled: true });
    const save = async () => {
        if (!editing) return;
        if (!editing.name.trim() || !editing.address.trim()) { toast.error("Nombre y dirección obligatorios"); return; }
        const exists = list.some(r => r.id === editing.id);
        const next = exists ? list.map(r => r.id === editing.id ? editing : r) : [...list, editing];
        try { await persist(next); setEditing(null); toast.success("Destinatario guardado"); } catch {}
    };
    const del = async (id: string) => { try { await persist(list.filter(r => r.id !== id)); if (editing?.id === id) setEditing(null); toast.success("Eliminado"); } catch {} };
    const toggle = async (id: string) => { try { await persist(list.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r)); } catch {} };

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center"><Users size={16} /></div>
                    <div>
                        <div className="text-sm font-bold text-foreground">Destinatarios</div>
                        <div className="text-[10px] text-muted-foreground">Quién recibe las notificaciones de aforo</div>
                    </div>
                </div>
                <button onClick={startNew} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition">
                    <Plus size={13} /> Nuevo
                </button>
            </div>

            {editing && (
                <div className="px-4 py-4 border-b border-border bg-muted/20 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Nombre (ej: Supervisor)"
                            className="bg-muted/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-sky-500" />
                        <select value={editing.channel} onChange={e => setEditing({ ...editing, channel: e.target.value })}
                            className="bg-muted/60 border border-border rounded-lg px-2 py-2 text-sm text-foreground outline-none focus:border-sky-500">
                            {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                        </select>
                    </div>
                    <input value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} placeholder={ph(editing.channel)}
                        list={editing.channel === "whatsapp" ? "wa-groups-dl" : undefined}
                        className="w-full bg-muted/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-sky-500 font-mono" />
                    {editing.channel === "whatsapp" && (
                        <>
                            <datalist id="wa-groups-dl">{waGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</datalist>
                            <p className="text-[10px] text-muted-foreground -mt-1 flex items-center gap-1"><Users size={11} /> Para un <b>grupo</b>, pegá su ID terminado en <code className="font-mono text-sky-400">@g.us</code>. Los grupos que le escriban al bot aparecen como sugerencias.</p>
                        </>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold transition">
                            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                        </button>
                        <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground text-xs font-semibold transition">
                            <X size={13} /> Cancelar
                        </button>
                    </div>
                </div>
            )}

            <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
                {loading ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Cargando…</div>
                ) : list.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                        <Users size={22} className="opacity-40" /> Sin destinatarios. Agregá uno con "Nuevo".
                    </div>
                ) : list.map(r => {
                    const m = chMeta(r.channel);
                    return (
                        <div key={r.id} className="px-4 py-3 flex items-center gap-3 group">
                            <button onClick={() => toggle(r.id)} title={r.enabled ? "Activo" : "Inactivo"}
                                className={cn("w-9 h-5 rounded-full relative transition shrink-0", r.enabled ? "bg-emerald-500" : "bg-muted-foreground/30")}>
                                <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", r.enabled && "translate-x-4")} />
                            </button>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${m.c}1a`, color: m.c }}><Send size={14} /></div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground truncate">{r.name}</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase shrink-0" style={{ color: m.c, borderColor: `${m.c}40`, background: `${m.c}12` }}>{m.l}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground font-mono truncate">{r.address}</div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                                <button onClick={() => setEditing({ ...r })} title="Editar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"><Pencil size={14} /></button>
                                <button onClick={() => del(r.id)} title="Eliminar" className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
