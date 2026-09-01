"use client";

import { useEffect, useState, useCallback } from "react";
import { Smartphone, RefreshCw, Trash2, Pencil, Check, X, Send, Globe, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getPushSubscribers, deletePushSubscriber, togglePushSubscriber, renamePushSubscriber } from "@/app/actions/pwa-subs";

type S = { id: string; host: string; browser: string; os: string; label: string; createdAt: string | null; enabled: boolean };

export default function SubscribersManager() {
    const [list, setList] = useState<S[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        try { setList((await getPushSubscribers()) as any); } catch (e) { console.error(e); } finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const toggle = async (id: string) => { await togglePushSubscriber(id); load(); };
    const del = async (id: string) => { await deletePushSubscriber(id); toast.success("Suscriptor eliminado"); load(); };
    const saveLabel = async (id: string) => { await renamePushSubscriber(id, draft.trim()); setEditing(null); load(); };
    const test = async (id: string) => {
        setBusy(id);
        try {
            const r = await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.sent) toast.success("Notificación de prueba enviada"); else toast.error("No se pudo enviar (¿suscripción expirada?)");
        } catch { toast.error("Error de conexión"); } finally { setBusy(null); }
    };

    const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center"><Smartphone size={16} /></div>
                    <div>
                        <div className="text-sm font-bold text-foreground">Suscriptores PWA</div>
                        <div className="text-[10px] text-muted-foreground">Dispositivos suscritos a notificaciones push · {list.length}</div>
                    </div>
                </div>
                <button onClick={load} className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
            </div>
            <div className="divide-y divide-border max-h-[440px] overflow-y-auto">
                {loading ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Cargando…</div>
                ) : list.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2"><BellOff size={22} className="opacity-40" /> Sin suscriptores. Abrí la PWA de Filas y activá las notificaciones push desde Ajustes.</div>
                ) : list.map((s) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3 group">
                        <button onClick={() => toggle(s.id)} title={s.enabled ? "Activo" : "Silenciado"}
                            className={cn("w-9 h-5 rounded-full relative transition shrink-0", s.enabled ? "bg-emerald-500" : "bg-muted-foreground/30")}>
                            <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", s.enabled && "translate-x-4")} />
                        </button>
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0"><Smartphone size={15} /></div>
                        <div className="min-w-0 flex-1">
                            {editing === s.id ? (
                                <div className="flex items-center gap-1.5">
                                    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Etiqueta (ej: iPhone supervisor)"
                                        className="bg-muted/60 border border-border rounded-md px-2 py-1 text-xs text-foreground outline-none focus:border-indigo-500 flex-1" />
                                    <button onClick={() => saveLabel(s.id)} className="p-1 rounded text-emerald-400 hover:bg-emerald-500/10"><Check size={14} /></button>
                                    <button onClick={() => setEditing(null)} className="p-1 rounded text-muted-foreground hover:bg-accent"><X size={14} /></button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-foreground truncate">{s.label || `${s.browser}${s.os ? " · " + s.os : ""}`}</span>
                                        {!s.enabled && <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-bold uppercase">silenciado</span>}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                                        <span className="inline-flex items-center gap-1"><Globe size={10} /> {s.host || "—"}</span>
                                        <span>· {s.browser}{s.os ? " / " + s.os : ""}</span>
                                        <span>· alta {fmt(s.createdAt)}</span>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                            <button onClick={() => test(s.id)} disabled={busy === s.id} title="Enviar prueba" className="p-1.5 rounded-lg hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-400 transition">{busy === s.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}</button>
                            <button onClick={() => { setEditing(s.id); setDraft(s.label); }} title="Etiquetar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition"><Pencil size={14} /></button>
                            <button onClick={() => del(s.id)} title="Eliminar" className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition"><Trash2 size={14} /></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
