"use client";

import { useEffect, useState } from "react";
import { X, ShieldAlert, Plus, Trash2, Loader2, Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getWatchlist, addWatch, deleteWatch, updateWatch } from "@/app/actions/watchlist";
import { WATCH_CATEGORY_LIST, watchCatMeta } from "@/lib/watch-categories";

export function WatchlistDialog({ onClose }: { onClose: () => void }) {
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [plate, setPlate] = useState("");
    const [label, setLabel] = useState("");
    const [category, setCategory] = useState("BLACKLISTED");
    const [notify, setNotify] = useState(true);

    const load = () => { setLoading(true); getWatchlist().then((r) => setRows(r || [])).catch(() => { }).finally(() => setLoading(false)); };
    useEffect(() => { load(); }, []);

    async function onAdd() {
        const p = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!p) return;
        setSaving(true);
        await addWatch({ plate: p, label: label.trim(), category, notify });
        setPlate(""); setLabel("");
        setSaving(false);
        load();
    }

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={onClose}>
            <div className="relative w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20"><ShieldAlert size={16} className="text-red-400" /></div>
                        <div>
                            <h3 className="text-sm font-bold text-foreground">Lista de vigilancia</h3>
                            <p className="text-[10px] text-muted-foreground">Matrículas que resaltan y suenan al detectarse</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-accent text-muted-foreground flex items-center justify-center"><X size={16} /></button>
                </div>

                {/* alta */}
                <div className="p-4 border-b border-border space-y-2.5">
                    <div className="flex gap-2">
                        <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="MATRÍCULA"
                            className="w-36 bg-background border border-border rounded-lg px-3 h-9 text-sm font-mono font-bold uppercase tracking-wider outline-none focus:ring-1 focus:ring-red-500/30" />
                        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Motivo / nota (opcional)"
                            className="flex-1 bg-background border border-border rounded-lg px-3 h-9 text-sm outline-none focus:ring-1 focus:ring-red-500/30" />
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                            {WATCH_CATEGORY_LIST.map((cat) => (
                                <button key={cat.value} onClick={() => setCategory(cat.value)}
                                    className={cn("px-2.5 h-7 rounded-md text-[10px] font-bold uppercase tracking-wide border transition", category === cat.value ? cat.badge : "bg-background text-muted-foreground border-border hover:text-foreground")}>{cat.label}</button>
                            ))}
                        </div>
                        <button onClick={() => setNotify((n) => !n)} title="Avisar por Telegram" className={cn("h-7 px-2 rounded-md text-[10px] font-bold flex items-center gap-1 border", notify ? "bg-blue-500/10 text-blue-400 border-blue-500/25" : "bg-background text-muted-foreground border-border")}>
                            {notify ? <Bell size={12} /> : <BellOff size={12} />} {notify ? "Avisa" : "Silencio"}
                        </button>
                        <div className="flex-1" />
                        <button onClick={onAdd} disabled={saving || !plate.trim()} className="h-8 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar
                        </button>
                    </div>
                </div>

                {/* lista */}
                <div className="max-h-[45vh] overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
                    ) : rows.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground text-sm">Sin matrículas en vigilancia</div>
                    ) : (
                        <div className="divide-y divide-border">
                            {rows.map((r) => (
                                <div key={r.id} className={cn("flex items-center gap-3 px-4 py-2.5", !r.active && "opacity-50")}>
                                    <span className="font-mono font-bold text-sm tracking-wider w-24">{r.plate}</span>
                                    <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded border", watchCatMeta(r.category).badge)}>{watchCatMeta(r.category).label}</span>
                                    <span className="text-xs text-muted-foreground flex-1 truncate">{r.label || "—"}</span>
                                    {r.notify && <Bell size={12} className="text-blue-400 shrink-0" />}
                                    <button onClick={async () => { await updateWatch(r.id, { active: !r.active }); load(); }} title={r.active ? "Desactivar" : "Activar"} className="text-[10px] font-bold px-2 py-1 rounded hover:bg-accent text-muted-foreground">{r.active ? "ON" : "OFF"}</button>
                                    <button onClick={async () => { await deleteWatch(r.id); load(); }} title="Eliminar" className="p-1.5 rounded hover:bg-red-500/10 text-red-400"><Trash2 size={14} /></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default WatchlistDialog;
