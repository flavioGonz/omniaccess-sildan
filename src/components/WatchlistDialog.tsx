"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Bell, BellOff, ChevronRight, ExternalLink, Loader2, Plus, RotateCcw, Search, ShieldAlert, Star } from "lucide-react";
import Link from "next/link";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { getWatchlist, addWatch, deactivateWatch, reactivateWatch, type FilaVigilancia } from "@/app/actions/watchlist";
import { WATCH_CATEGORY_LIST, WATCH_EFECTOS, watchCatMeta, type WatchCategory } from "@/lib/watch-categories";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { FichaVigilancia } from "@/components/users/FichaVigilancia";
import { resumirCamaras } from "@/lib/lista-negra";
import { NIVELES } from "@/lib/padron";

/**
 * El atajo del monitor LPR a la lista de vigilancia, como cajón lateral. Escribe la MISMA
 * lista que la pestaña de /admin/users (donde se administra en serio); acá se carga rápido y
 * se ve lo activo.
 *
 * Lo del 8/10, pedido al usarlo:
 *  - La matrícula se ve como una matrícula (placa), no como un texto en negrita.
 *  - Cada categoría con su ícono y su tono: lista negra en rojo con prohibido, VIP en verde
 *    con estrella (es PERMITIDO: el violeta no decía nada), en búsqueda en ámbar con lupa.
 *  - En búsqueda, el motivo es lo importante —qué se busca y por qué— y es lo que se muestra
 *    en la captura del monitor cuando la cámara la lee: se pide así desde la carga.
 *  - Ninguna marca: «lectoras LPR», no el fabricante.
 *  - Cada fila abre el expediente (FichaVigilancia): desde cuándo, quién, dónde se la vio,
 *    qué decidió la barrera, las capturas, y desde ahí se edita o se da de baja.
 */

export const ICONO_CATEGORIA: Record<WatchCategory, React.ComponentType<{ size?: number; className?: string }>> = {
    BLACKLISTED: Ban,
    WHITELISTED: Star,
    SEARCH: Search,
};

/** Lo que se le pide al motivo según la categoría: en búsqueda es el dato que sale en la captura. */
const MOTIVO_PISTA: Record<WatchCategory, string> = {
    BLACKLISTED: "Por qué se le niega el paso (ej. «Robo en Lote 12, denuncia 4512»)",
    WHITELISTED: "Quién es (ej. «Escribano de la administración»)",
    SEARCH: "Qué se busca y por qué (ej. «Taxi denunciado por un vecino»): sale en la captura",
};

/** La explicación de una categoría, para el tooltip y para la pestaña. */
export function ExplicacionCategoria({ cat }: { cat: WatchCategory }) {
    const e = WATCH_EFECTOS[cat];
    const Fila = ({ k, v }: { k: string; v: string }) => (
        <div className="grid grid-cols-[72px_1fr] gap-2 text-[11px] leading-snug">
            <span className="font-bold text-muted-foreground">{k}</span>
            <span className="text-foreground/90">{v}</span>
        </div>
    );
    return (
        <div className="space-y-1.5">
            <Fila k="Barrera" v={e.barrera} />
            <Fila k="Lectoras" v={e.camaras} />
            <Fila k="Monitor" v={e.monitor} />
            <Fila k="Monitores" v={e.monitores} />
            <Fila k="Avisos" v={e.avisos} />
        </div>
    );
}

/** Una matrícula dibujada como placa: fondo claro, borde, letras espaciadas. Igual en tema claro y oscuro. */
export function Placa({ p, grande, className }: { p: string; grande?: boolean; className?: string }) {
    return (
        <span className={cn("inline-flex items-center rounded-[6px] border-2 border-neutral-800 bg-white text-neutral-900 font-bold tabular-nums uppercase leading-none",
            grande ? "px-3 py-1.5 text-[17px] tracking-[0.16em]" : "px-2 py-1 text-[12.5px] tracking-[0.12em]", className)}>
            {p}
        </span>
    );
}

function avisarCamaras(camaras?: { ok: any[]; fallo: any[] }) {
    if (!camaras) return;
    const texto = resumirCamaras(camaras);
    if (camaras.fallo.length) toast.warning({ title: "Lectoras LPR: alguna no respondió", description: texto });
    else toast.success({ title: "Lectoras LPR actualizadas", description: texto });
}

export function WatchlistDialog({ onClose, plateInicial }: {
    onClose: () => void;
    /** Viene del «Registrar» del monitor: la matrícula ya escrita, sólo falta el motivo y la categoría. */
    plateInicial?: string;
}) {
    const [rows, setRows] = useState<FilaVigilancia[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [plate, setPlate] = useState(plateInicial || "");
    const [motivo, setMotivo] = useState("");
    const [category, setCategory] = useState<WatchCategory>("BLACKLISTED");
    const [notify, setNotify] = useState(true);
    const [query, setQuery] = useState("");
    const [verInactivas, setVerInactivas] = useState(false);
    const [conflicto, setConflicto] = useState<{ category: WatchCategory; label: string; motivo: string | null } | null>(null);
    const [abierta, setAbierta] = useState<FilaVigilancia | null>(null);

    const load = () => {
        setLoading(true); setError(null);
        getWatchlist().then((r) => setRows(r || [])).catch((e) => setError(e?.message || "No se pudo leer la lista")).finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    async function onAdd(force = false) {
        const p = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!p) return;
        if (category === "SEARCH" && !motivo.trim()) { toast.warning({ title: "Falta el motivo", description: "En búsqueda, el motivo es lo que ve el guardia en la captura: qué se busca y por qué." }); return; }
        setSaving(true);
        try {
            const r = await addWatch({ plate: p, label: motivo.trim(), motivo: motivo.trim() || undefined, category, notify, force });
            if (r.conflicto) { setConflicto(r.conflicto); return; }
            if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
            setConflicto(null); setPlate(""); setMotivo("");
            toast.success({ title: `${p} · ${watchCatMeta(category).label}`, description: category === "BLACKLISTED" ? "Toda lectura se registra DENEGADA desde ahora." : category === "SEARCH" ? "Cada vez que pase, la captura muestra el motivo." : "Se destaca en el monitor como autorizada." });
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
    const meta = watchCatMeta(category);

    return (
        <>
            <Cajon open={!abierta} onOpenChange={(o) => { if (!o && !abierta) onClose(); }}>
                <CajonContenido ancho="intermedio" titulo="Lista negra"
                    descripcion="Carga rápida. Las fichas completas (nombre, foto, varias matrículas) están en Usuarios → Lista negra."
                    encabezado={
                        <div className="flex items-center justify-between px-6 py-2">
                            <span className="text-[11.5px] text-muted-foreground tabular-nums">{activas} activa{activas === 1 ? "" : "s"}</span>
                            <Pista titulo="Administrar" texto="La misma lista, como fichas: nombre (o sin identificar), foto, varias matrículas, dónde se la vio, y las dadas de baja." lado="abajo">
                                <Link href="/admin/users?tab=listanegra" className="h-8 px-2 rounded-md hover:bg-accent text-[12px] font-semibold tono-accion flex items-center gap-1"><ExternalLink size={13} /> Abrir la pestaña Lista negra</Link>
                            </Pista>
                        </div>
                    }>
                    <CajonSeccion titulo="Agregar" icono={ShieldAlert}>
                        {/* La matrícula como placa, editable */}
                        <div className="flex items-center gap-3">
                            <label className="relative">
                                <span className="sr-only">Matrícula</span>
                                <input value={plate} onChange={(e) => { setPlate(e.target.value.toUpperCase()); setConflicto(null); }}
                                    onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} placeholder="ABC1234" maxLength={10}
                                    className="w-40 h-11 rounded-[6px] border-2 border-neutral-800 bg-white text-neutral-900 text-center text-[17px] font-bold tracking-[0.16em] uppercase tabular-nums outline-none placeholder:text-neutral-300 focus:ring-2 focus:ring-[var(--accion)]" />
                            </label>
                            <p className="text-[12px] text-muted-foreground leading-snug">Como la lee la cámara: sin espacios ni guiones.</p>
                        </div>

                        {/* El nivel: dos tarjetas con ícono, tono y qué hacen (VIP ya no es una lista: es una marca de la persona) */}
                        <div className="grid grid-cols-2 gap-2">
                            {WATCH_CATEGORY_LIST.map((cat) => {
                                const Ic = ICONO_CATEGORIA[cat.value];
                                const sel = category === cat.value;
                                const m = watchCatMeta(cat.value);
                                return (
                                    <Pista key={cat.value} titulo={cat.label} texto={<ExplicacionCategoria cat={cat.value} />} ancho={340} lado="abajo">
                                        <button type="button" onClick={() => { setCategory(cat.value); setConflicto(null); }} aria-pressed={sel}
                                            className={cn("w-full rounded-[10px] border p-2.5 text-left transition-colors",
                                                sel ? m.badge : "border-border hover:bg-accent")}>
                                            <span className="flex items-center gap-1.5 text-[12.5px] font-bold"><Ic size={14} className={sel ? "" : m.text} /> {NIVELES[cat.value as "BLACKLISTED" | "SEARCH"]?.titulo || cat.label}</span>
                                            <span className={cn("block text-[11px] mt-0.5 leading-snug", sel ? "opacity-90" : "text-muted-foreground")}>
                                                {NIVELES[cat.value as "BLACKLISTED" | "SEARCH"]?.resumen}
                                            </span>
                                        </button>
                                    </Pista>
                                );
                            })}
                        </div>

                        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
                            autoFocus={!!plateInicial} placeholder={MOTIVO_PISTA[category]}
                            className="w-full bg-background border border-border rounded-[6px] px-3 h-10 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accion)]" />

                        <p className="text-[11.5px] leading-snug text-muted-foreground">
                            <span className={cn("font-bold", meta.text)}>{meta.label}:</span> {WATCH_EFECTOS[category].barrera}
                        </p>

                        {conflicto && (
                            <div className="rounded-[10px] border chip-aviso p-3 text-[12px] space-y-2">
                                <p><b>{plate}</b> ya está activa como <b>{watchCatMeta(conflicto.category).label}</b>{conflicto.motivo || conflicto.label ? ` (${conflicto.motivo || conflicto.label})` : ""}. ¿Pasarla a {meta.label}?</p>
                                <div className="flex gap-2">
                                    <button onClick={() => onAdd(true)} disabled={saving} className="accion h-8 px-3 rounded-[6px] text-[12px] font-bold">Sí, cambiarla</button>
                                    <button onClick={() => setConflicto(null)} className="h-8 px-3 rounded-[6px] border border-border text-[12px] font-bold">No</button>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <Pista titulo={notify ? "Avisa" : "En silencio"} texto="Con aviso, al detectarla manda Telegram y dispara la regla WATCHLIST de las notificaciones. En silencio sólo se ve en el monitor." lado="abajo">
                                <button onClick={() => setNotify((n) => !n)} aria-pressed={notify}
                                    className={cn("h-10 px-3 rounded-full text-[12px] font-bold flex items-center gap-1.5 border whitespace-nowrap", notify ? "chip-info" : "bg-background text-muted-foreground border-border")}>
                                    {notify ? <Bell size={13} /> : <BellOff size={13} />} {notify ? "Avisa" : "Silencio"}
                                </button>
                            </Pista>
                            <button onClick={() => onAdd()} disabled={saving || !plate.trim()}
                                className="accion flex-1 h-10 rounded-[6px] text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar
                            </button>
                        </div>
                    </CajonSeccion>

                    <CajonSeccion titulo="En la lista" icono={Search} ayuda="Tocá una para abrir su expediente: desde cuándo, quién la cargó, dónde se la vio y qué decidió la barrera.">
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1 min-w-0">
                                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar matrícula, motivo o persona…"
                                    className="w-full bg-background border border-border rounded-[6px] pl-8 pr-3 h-9 text-[12.5px] outline-none focus:ring-2 focus:ring-[var(--accion)]" />
                            </div>
                            <button onClick={() => setVerInactivas((v) => !v)} aria-pressed={verInactivas}
                                className={cn("h-9 px-3 rounded-full border text-[11.5px] font-semibold whitespace-nowrap transition-colors", verInactivas ? "border-[var(--accion)] tono-accion" : "border-border text-muted-foreground hover:bg-accent")}>
                                Con inactivas
                            </button>
                        </div>

                        <div className="-mx-6">
                            {loading ? (
                                <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-[12.5px]"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
                            ) : error ? (
                                <div className="text-center py-8 text-[12.5px] space-y-2"><p>No se pudo leer la lista: {error}</p><button onClick={load} className="tono-accion font-semibold">Reintentar</button></div>
                            ) : visibles.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground text-[12.5px]">{rows.length === 0 ? "Sin matrículas en vigilancia" : query ? `Ninguna coincide con «${query}»` : "Ninguna activa"}</div>
                            ) : (
                                <div className="divide-y divide-border border-y border-border">
                                    {visibles.map((r) => {
                                        const m = watchCatMeta(r.category);
                                        const Ic = ICONO_CATEGORIA[(r.category as WatchCategory)] || Search;
                                        const busqueda = r.category === "SEARCH";
                                        return (
                                            <div key={r.id} role="button" tabIndex={0} onClick={() => setAbierta(r)} onKeyDown={(e) => { if (e.key === "Enter") setAbierta(r); }}
                                                className={cn("group flex items-center gap-3 px-6 py-3 cursor-pointer hover:bg-accent transition-colors", !r.active && "opacity-50")}>
                                                <Placa p={r.plate} />
                                                <div className="min-w-0 flex-1">
                                                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-bold", m.badge)}><Ic size={11} /> {m.label}</span>
                                                    <p className={cn("text-[12.5px] mt-1 truncate", busqueda ? "text-foreground font-semibold" : "text-muted-foreground")}>
                                                        {r.motivo || r.label || <span className="italic">Sin motivo</span>}
                                                        {r.userName ? <span className="text-muted-foreground font-normal"> · {r.userName}</span> : null}
                                                    </p>
                                                </div>
                                                {r.notify && r.active && <Pista texto="Avisa al detectarla"><Bell size={13} className="tono-info shrink-0" /></Pista>}
                                                <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                                                    {r.active ? (
                                                        <Pista titulo="Dar de baja" texto={r.category === "BLACKLISTED" ? "Deja de denegar; si tiene credencial vuelve a la lista blanca de las lectoras. Queda en el expediente como inactiva." : "Deja de destacarse. Queda en el expediente como inactiva."} lado="izquierda">
                                                            <button onClick={async () => { const x = await deactivateWatch(r.id); if (!x.ok) toast.error({ title: "No se pudo dar de baja", description: x.error }); avisarCamaras(x.camaras); load(); }} className="p-1.5 rounded-md hover:bg-[var(--mal-suave)] tono-mal"><Ban size={14} /></button>
                                                        </Pista>
                                                    ) : (
                                                        <Pista titulo="Volver a activar" texto="Misma categoría y motivo; si es lista negra vuelve a las lectoras." lado="izquierda">
                                                            <button onClick={async () => { const x = await reactivateWatch(r.id); if (!x.ok) toast.error({ title: "No se pudo activar", description: x.error }); avisarCamaras(x.camaras); load(); }} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"><RotateCcw size={14} /></button>
                                                        </Pista>
                                                    )}
                                                </span>
                                                <ChevronRight size={15} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </CajonSeccion>
                </CajonContenido>
            </Cajon>
            {/* El expediente reemplaza al cajón de la lista y al cerrarlo se vuelve a la lista. */}
            <FichaVigilancia fila={abierta} alCerrar={() => setAbierta(null)} alCambiar={load} />
        </>
    );
}

export default WatchlistDialog;
