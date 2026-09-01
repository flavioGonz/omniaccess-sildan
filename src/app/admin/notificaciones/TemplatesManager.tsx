"use client";

import { useEffect, useState, useCallback } from "react";
import { FileText, Plus, Save, Trash2, RefreshCw, Pencil, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getDispatchTemplates, saveDispatchTemplates } from "@/app/actions/queue";

type Tpl = { id: string; name: string; channel: string; body: string };

const CHANNELS = [
    { v: "all", l: "Todos", c: "#a855f7" },
    { v: "telegram", l: "Telegram", c: "#0ea5e9" },
    { v: "whatsapp", l: "WhatsApp", c: "#25D366" },
    { v: "email", l: "Email", c: "#f59e0b" },
];
const VARS = ["{device}", "{zone}", "{channel}", "{count}", "{threshold}", "{wait}", "{time}", "{date}"];
const uid = () => Math.random().toString(36).slice(2, 9);
const chMeta = (v: string) => CHANNELS.find(c => c.v === v) || CHANNELS[0];

export default function TemplatesManager() {
    const [tpls, setTpls] = useState<Tpl[]>([]);
    const [editing, setEditing] = useState<Tpl | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try { const t = await getDispatchTemplates(); setTpls((t as any) || []); }
        catch (e) { console.error(e); } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const persist = async (next: Tpl[]) => {
        setSaving(true);
        try { await saveDispatchTemplates(next as any); setTpls(next); }
        catch { toast.error("No se pudo guardar"); throw new Error("save"); }
        finally { setSaving(false); }
    };

    const startNew = () => setEditing({ id: uid(), name: "", channel: "all", body: "" });
    const save = async () => {
        if (!editing) return;
        if (!editing.name.trim() || !editing.body.trim()) { toast.error("Nombre y mensaje son obligatorios"); return; }
        const exists = tpls.some(t => t.id === editing.id);
        const next = exists ? tpls.map(t => t.id === editing.id ? editing : t) : [...tpls, editing];
        try { await persist(next); setEditing(null); toast.success("Plantilla guardada"); } catch {}
    };
    const del = async (id: string) => {
        try { await persist(tpls.filter(t => t.id !== id)); if (editing?.id === id) setEditing(null); toast.success("Plantilla eliminada"); } catch {}
    };
    const insertVar = (v: string) => editing && setEditing({ ...editing, body: (editing.body || "") + v });

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-fuchsia-500/10 text-fuchsia-400 flex items-center justify-center"><FileText size={16} /></div>
                    <div>
                        <div className="text-sm font-bold text-foreground">Plantillas de envío</div>
                        <div className="text-[10px] text-muted-foreground">Mensajes reutilizables con variables</div>
                    </div>
                </div>
                <button onClick={startNew} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-semibold transition">
                    <Plus size={13} /> Nueva
                </button>
            </div>

            {/* Editor */}
            {editing && (
                <div className="px-4 py-4 border-b border-border bg-muted/20 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-2">
                        <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                            placeholder="Nombre de la plantilla"
                            className="flex-1 bg-muted/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-fuchsia-500" />
                        <select value={editing.channel} onChange={e => setEditing({ ...editing, channel: e.target.value })}
                            className="bg-muted/60 border border-border rounded-lg px-2 py-2 text-xs text-foreground outline-none focus:border-fuchsia-500">
                            {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                        </select>
                    </div>
                    <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })}
                        rows={4} placeholder="Escribe el mensaje. Usa las variables de abajo, ej: Aforo {count} en {device} superó {threshold}."
                        className="w-full bg-muted/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-fuchsia-500 resize-y font-mono" />
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide mr-1">Variables:</span>
                        {VARS.map(v => (
                            <button key={v} onClick={() => insertVar(v)}
                                className="px-2 py-1 rounded-md bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20 text-[11px] font-mono hover:bg-fuchsia-500/20 transition">
                                {v}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                        <button onClick={save} disabled={saving}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold transition">
                            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                        </button>
                        <button onClick={() => setEditing(null)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted hover:bg-accent border border-border text-muted-foreground text-xs font-semibold transition">
                            <X size={13} /> Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
                {loading ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Cargando…</div>
                ) : tpls.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                        <FileText size={22} className="opacity-40" /> Sin plantillas. Creá una con "Nueva".
                    </div>
                ) : tpls.map(t => {
                    const m = chMeta(t.channel);
                    return (
                        <div key={t.id} className="px-4 py-3 flex items-start gap-3 group">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${m.c}1a`, color: m.c }}><Send size={14} /></div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground truncate">{t.name}</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase shrink-0" style={{ color: m.c, borderColor: `${m.c}40`, background: `${m.c}12` }}>{m.l}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 whitespace-pre-wrap break-words">{t.body}</div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                                <button onClick={() => setEditing({ ...t })} title="Editar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"><Pencil size={14} /></button>
                                <button onClick={() => del(t.id)} title="Eliminar" className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
