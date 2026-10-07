"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Plus, Loader2, Bell, BellOff, Search, RotateCcw, Ban, ExternalLink, Info } from "lucide-react";
import Link from "next/link";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { getWatchlist, addWatch, deactivateWatch, reactivateWatch, type FilaVigilancia } from "@/app/actions/watchlist";
import { WATCH_CATEGORY_LIST, WATCH_EFECTOS, watchCatMeta, type WatchCategory } from "@/lib/watch-categories";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { resumirCamaras } from "@/lib/lista-negra";

/**
 * El atajo del monitor LPR a la lista de vigilancia, como cajón lateral (ui/cajon), igual que las
 * demás fichas de la aplicación. Escribe la MISMA lista que la pestaña de /admin/users (que es
 * donde se administra en serio); acá se carga rápido y se ve lo activo.
 *
 * Lo que cambió el 7/10 y por qué: la baja desactiva en vez de borrar (queda quién, cuándo y
 * por qué); si la matrícula ya está en otra categoría se pregunta antes de pisarla; y cada
 * categoría explica, al pasar el mouse, qué hace de verdad en la barrera, en las cámaras, en
 * el monitor y en los avisos — porque "lista negra" sin decir qué pasa en la barrera es una
 * promesa que el operador no puede comprobar.
 */

/** La explicación de una categoría, para el tooltip y para la pestaña. */
export function ExplicacionCategoria({ cat }: { cat: WatchCategory }) {
    const e = WATCH_EFECTOS[cat];
    const Fila = ({ k, v }: { k: string; v: string }) => (
        <div className="grid grid-cols-[72px_1fr] gap-2 text-[11px] leading-snug">
            <span className="font-bold uppercase tracking-wide text-muted-foreground">{k}</span>
            <span className="text-foreground/90">{v}</span>
        </div>
    );
    return (
        <div className="space-y-1.5">
            <Fila k="Barrera" v={e.barrera} />
            <Fila k="Cámaras" v={e.camaras} />
            <Fila k="Monitor" v={e.monitor} />
            <Fila k="Monitores" v={e.monitores} />
            <Fila k="Avisos" v={e.avisos} />
        </div>
    );
}

function avisarCamaras(camaras?: { ok: any[]; fallo: any[] }) {
    if (!camaras) return;
    const texto = resumirCamaras(camaras);
    if (camaras.fallo.length) toast.warning({ title: "Lectoras: alguna no respondió", description: texto });
    else toast.success({ title: "Lectoras actualizadas", description: texto });
}

export function WatchlistDialog({ onClose }: { onClose: () => void }) {
    const [rows, setRows] = useState<FilaVigilancia[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [plate, setPlate] = useState("");
    const [motivo, setMotivo] = useState("");
    const [category, setCategory] = useState<WatchCategory>("BLACKLISTED");
    const [notify, setNotify] = useState(true);
    const [query, setQuery] = useState("");
    const [verInactivas, setVerInactivas] = useState(false);
    const [conflicto, setConflicto] = useState<{ category: WatchCategory; label: string; motivo: string | null } | null>(null);

    const load = () => {
        setLoading(true); setError(null);
        getWatchlist().then((r) => setRows(r || [])).catch((e) => setError(e?.message || "No se pudo leer la lista")).finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    async function onAdd(force = false) {
        const p = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!p) return;
        setSaving(true);
        try {
            const r = await addWatch({ plate: p, label: motivo.trim(), motivo: motivo.trim() || undefined, category, notify, force });
            if (r.conflicto) { setConflicto(r.conflicto); return; }
            if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
            setConflicto(null); setPlate(""); setMotivo("");
            toast.success({ title: `${p} · ${watchCatMeta(category).label}`, description: category === "BLACKLISTED" ? "Toda lectura se registra DENEGADA desde ahora." : "Se destaca en el monitor." });
            avisarCamaras(r.camaras);
            load();
        } finally { setSaving(false); }
    }

    const visibles = useMemo(() => {
        const q = query.trim().toUpperCase();
        return rows.filter((r) => (verInactivas || r.active) && (!q ||
            r.plate.toUpperCase().includes(q) || (r.motivo || r.label || "").toUpperCase().includes(q) ||
            (r.userName || "").toUpperCase().includes(q) || watchCatMeta(r.category).label.toUpperCase().includes(q)));
    }, [rows, query, verInactivas]);
    const activas = rows.filter((r) => r.active).length;

    return (
        <Cajon open onOpenChange={(o) => { if (!o) onClose(); }}>
            <CajonContenido ancho="intermedio" titulo="Lista de vigilancia"
                descripcion="Una sola lista para la barrera, las cámaras, el monitor y el bot."
                encabezado={
                    <div className="flex items-center justify-between px-6 py-2">
                        <span className="text-[11px] text-muted-foreground tabular-nums">{activas} activa{activas === 1 ? "" : "s"}</span>
                        <Pista titulo="Administrar" texto="La misma lista, completa: motivo, quién la cargó, persona vinculada, inactivas y las que vienen por rol." lado="abajo">
                            <Link href="/admin/users?tab=vigilancia" className="h-8 px-2 rounded-lg hover:bg-accent text-[11px] font-semibold text-[var(--accion)] flex items-center gap-1"><ExternalLink size={13} /> Abrir en Usuarios</Link>
                        </Pista>
                    </div>
                }>
                <CajonSeccion titulo="Agregar" icono={ShieldAlert} ayuda="Pasá el mouse por cada categoría para ver exactamente qué hace en la barrera, las cámaras, el monitor y los avisos.">
                <div className="space-y-3">
                    <div className="flex gap-2">
                        <input value={plate} onChange={(e) => { setPlate(e.target.value.toUpperCase()); setConflicto(null); }} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} placeholder="MATRÍCULA"
                            className="w-32 shrink-0 bg-background border border-border rounded-[6px] px-3 h-9 text-sm font-bold uppercase tracking-wider tabular-nums outline-none focus:ring-1 focus:ring-[var(--accion)]" />
                        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} placeholder="Motivo (queda en el registro)"
                            className="flex-1 min-w-0 bg-background border border-border rounded-[6px] px-3 h-9 text-sm outline-none focus:ring-1 focus:ring-[var(--accion)]" />
                    </div>

                    {/* Cada categoría explica qué hace al pasar el mouse: el operador tiene que saber qué va a pasar en la barrera antes de apretar. */}
                    <div className="grid grid-cols-3 gap-1.5">
                        {WATCH_CATEGORY_LIST.map((cat) => (
                            <Pista key={cat.value} titulo={cat.label} texto={<ExplicacionCategoria cat={cat.value} />} ancho={340} lado="abajo">
                                <button onClick={() => { setCategory(cat.value); setConflicto(null); }}
                                    className={cn(
                                        "w-full h-9 rounded-full text-[10px] font-bold uppercase tracking-wide border transition flex items-center justify-center gap-1 text-center leading-tight px-1",
                                        category === cat.value ? cat.badge : "bg-background text-muted-foreground border-border hover:text-foreground"
                                    )}>{cat.label} <Info size={10} className="opacity-60" /></button>
                            </Pista>
                        ))}
                    </div>

                    {/* Lo que va a pasar, dicho antes de apretar */}
                    <p className="text-[11px] leading-snug text-muted-foreground">
                        <span className={cn("font-bold", watchCatMeta(category).text)}>{watchCatMeta(category).label}:</span> {WATCH_EFECTOS[category].barrera}
                    </p>

                    {conflicto && (
                        <div className="rounded-[6px] border border-[var(--aviso)] bg-[var(--aviso-suave)] p-3 text-[12px] space-y-2">
                            <p><span className="font-bold">{plate}</span> ya está activa como <span className="font-bold">{watchCatMeta(conflicto.category).label}</span>{conflicto.motivo || conflicto.label ? ` (${conflicto.motivo || conflicto.label})` : ""}. ¿Pasarla a {watchCatMeta(category).label}?</p>
                            <div className="flex gap-2">
                                <button onClick={() => onAdd(true)} disabled={saving} className="h-8 px-3 rounded-[6px] bg-[var(--accion)] text-white text-xs font-bold">Sí, cambiarla</button>
                                <button onClick={() => setConflicto(null)} className="h-8 px-3 rounded-[6px] border border-border text-xs font-bold">No</button>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <Pista titulo={notify ? "Avisa" : "En silencio"} texto="Con aviso, al detectarse manda Telegram y dispara la regla WATCHLIST del motor de notificaciones. En silencio sólo se ve en el monitor." lado="abajo">
                            <button onClick={() => setNotify((n) => !n)}
                                className={cn("h-9 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 border whitespace-nowrap", notify ? "bg-[var(--info-suave)] text-[var(--info)] border-border" : "bg-background text-muted-foreground border-border")}>
                                {notify ? <Bell size={13} /> : <BellOff size={13} />} {notify ? "Avisa" : "Silencio"}
                            </button>
                        </Pista>
                        <button onClick={() => onAdd()} disabled={saving || !plate.trim()}
                            className="flex-1 h-9 rounded-[6px] bg-[var(--accion)] hover:opacity-90 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar
                        </button>
                    </div>
                </div>

                </CajonSeccion>
                <CajonSeccion titulo="En la lista" icono={Search}>
                <div className="pb-2 flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar matrícula, motivo o persona…"
                            className="w-full bg-background border border-border rounded-[6px] pl-8 pr-3 h-8 text-xs outline-none focus:ring-1 focus:ring-[var(--accion)]" />
                    </div>
                    <button onClick={() => setVerInactivas((v) => !v)} className={cn("h-8 px-2 rounded-full border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap", verInactivas ? "bg-accent text-foreground border-border" : "bg-background text-muted-foreground border-border")}>
                        {verInactivas ? "Con inactivas" : "Sólo activas"}
                    </button>
                    
                </div>

                <div className="-mx-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
                    ) : error ? (
                        <div className="text-center py-8 text-sm space-y-2"><p className="text-foreground">No se pudo leer la lista: {error}</p><button onClick={load} className="h-8 px-3 rounded-[6px] border border-border text-xs font-bold">Reintentar</button></div>
                    ) : rows.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground text-sm">Sin matrículas en vigilancia</div>
                    ) : visibles.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground text-sm">{query ? `Ninguna coincide con “${query}”` : "Ninguna activa"}</div>
                    ) : (
                        <div className="divide-y divide-border">
                            {visibles.map((r) => {
                                const m = watchCatMeta(r.category);
                                return (
                                    <div key={r.id} className={cn("flex items-center gap-3 px-6 py-2.5", !r.active && "opacity-50")}>
                                        <span className="font-bold text-sm tracking-wider tabular-nums w-24 shrink-0">{r.plate}</span>
                                        <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap", m.badge)}>{m.label}</span>
                                        <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate" title={`${r.motivo || r.label || ""}${r.userName ? ` · ${r.userName}` : ""}${r.createdBy ? ` · ${r.createdBy}` : ""}`}>
                                            {r.motivo || r.label || "—"}{r.userName ? <span className="text-foreground/70"> · {r.userName}</span> : null}
                                        </span>
                                        {r.notify && r.active && <Bell size={12} className="text-[var(--info)] shrink-0" />}
                                        {r.active ? (
                                            <Pista titulo="Dar de baja" texto={r.category === "BLACKLISTED" ? "Deja de denegar; si tiene credencial vuelve a la lista blanca de las lectoras. Queda en el historial como inactiva." : "Deja de destacarse. Queda en el historial como inactiva."} lado="izquierda">
                                                <button onClick={async () => { const x = await deactivateWatch(r.id); if (!x.ok) toast.error({ title: "No se pudo dar de baja", description: x.error }); avisarCamaras(x.camaras); load(); }} className="p-1.5 rounded hover:bg-[var(--mal-suave)] text-[var(--mal)] shrink-0"><Ban size={14} /></button>
                                            </Pista>
                                        ) : (
                                            <Pista titulo="Volver a activar" texto="Misma categoría y motivo; si es lista negra vuelve a las lectoras." lado="izquierda">
                                                <button onClick={async () => { const x = await reactivateWatch(r.id); if (!x.ok) toast.error({ title: "No se pudo activar", description: x.error }); avisarCamaras(x.camaras); load(); }} className="p-1.5 rounded hover:bg-accent text-muted-foreground shrink-0"><RotateCcw size={14} /></button>
                                            </Pista>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}

export default WatchlistDialog;
