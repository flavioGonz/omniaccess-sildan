"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Bell, BellOff, ChevronRight, Loader2, Plus, RotateCcw, Search, ShieldAlert, ShieldX, Siren, Cctv, Star, X } from "lucide-react";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import { useFuncion } from "@/lib/funciones-cliente";
import Link from "next/link";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { getWatchlist, addWatch, deactivateWatch, reactivateWatch, type FilaVigilancia } from "@/app/actions/watchlist";
import { WATCH_CATEGORY_LIST, WATCH_EFECTOS, watchCatMeta, type WatchCategory } from "@/lib/watch-categories";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
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

    // Sin «En búsqueda» (función de LPR, apagada en San Nicolás) queda sólo la lista negra.
    const busquedaOn = useFuncion("LPR_BUSQUEDA");
    const categorias = WATCH_CATEGORY_LIST.filter((c) => busquedaOn || c.value !== "SEARCH");
    useEffect(() => { if (!busquedaOn && category === "SEARCH") setCategory("BLACKLISTED"); }, [busquedaOn, category]);
    const visibles = useMemo(() => {
        const q = query.trim().toUpperCase();
        return rows.filter((r) => (busquedaOn || r.category !== "SEARCH") && (verInactivas || r.active) && (!q ||
            r.plate.toUpperCase().includes(q) || (r.motivo || r.label || "").toUpperCase().includes(q) ||
            (r.userName || "").toUpperCase().includes(q) || watchCatMeta(r.category).label.toUpperCase().includes(q)));
    }, [rows, query, verInactivas, busquedaOn]);
    const activas = rows.filter((r) => r.active && (busquedaOn || r.category !== "SEARCH")).length;
    const meta = watchCatMeta(category);
    const negra = category === "BLACKLISTED";

    /*
     * El cajón entero en rojo, con letra blanca (20/10, Nico: «fondo rojo, letras estilizadas
     * blancas, iconografía, react-tooltip; debe indicar en texto qué hace exactamente»). Es la
     * única pantalla que existe para negarle el paso a alguien: tiene que verse como lo que es.
     * Lo que dice arriba es lo que el sistema HACE (WATCH_EFECTOS), no lo que uno desearía.
     */
    const TT = "tt-lista-negra";
    const efectos = [
        { Ic: ShieldX, t: "Barrera", d: WATCH_EFECTOS.BLACKLISTED.barrera },
        { Ic: Cctv, t: "Lectoras LPR", d: WATCH_EFECTOS.BLACKLISTED.camaras },
        { Ic: Siren, t: "Monitor", d: "Cada vez que una cámara la lee salta como alerta crítica, en rojo y con sonido, hasta que alguien decida si es real." },
        { Ic: Bell, t: "Avisos", d: "Con «Avisa» prendido, además se manda a la guardia por Telegram y dispara las reglas de Notificaciones (WATCHLIST)." },
    ];
    const campo = "w-full h-10 rounded-[8px] bg-white/12 border border-white/20 text-white placeholder:text-white/55 px-3 text-[13px] outline-none focus:border-white focus:bg-white/18";

    return (
        <>
            <Cajon open={!abierta} onOpenChange={(o) => { if (!o && !abierta) onClose(); }}>
                <CajonContenido ancho="intermedio" titulo="Lista negra" sinCabecera
                    descripcion="Cargar una matrícula para que la barrera la deniegue siempre y salte como alerta."
                    className="!bg-[var(--mal)] text-white !border-l-0">
                    <Tooltip id={TT} place="bottom" positionStrategy="fixed" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />

                    {/* ── Qué es esto ── */}
                    <header className="px-6 pt-6 pb-5 border-b border-white/15">
                        <div className="flex items-start gap-3">
                            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 shrink-0"><Ban size={22} /></span>
                            <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/75">Alerta máxima</div>
                                <h2 className="text-[24px] font-extrabold leading-none tracking-[-0.02em] mt-1">Lista negra</h2>
                            </div>
                            <span className="h-7 px-2.5 rounded-full bg-white/15 text-[12px] font-bold tabular-nums inline-flex items-center shrink-0"
                                data-tooltip-id={TT} data-tooltip-content="Matrículas activas en la lista negra">{activas} activa{activas === 1 ? "" : "s"}</span>
                            <button type="button" onClick={onClose} aria-label="Cerrar" className="h-8 w-8 rounded-full grid place-items-center hover:bg-white/15 shrink-0"><X size={17} /></button>
                        </div>
                        <p className="mt-4 text-[13.5px] leading-relaxed text-white/95">
                            Acá se carga una matrícula para <b>negarle el paso</b>. Desde que se agrega, en cada lectura:
                        </p>
                        <ul className="mt-3 space-y-2">
                            {efectos.map(({ Ic, t, d }) => (
                                <li key={t} className="flex items-start gap-2.5 text-[12.5px] leading-snug">
                                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 shrink-0 mt-px"><Ic size={13} /></span>
                                    <span><b className="font-bold">{t}.</b> <span className="text-white/90">{d}</span></span>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-3 text-[11.5px] text-white/75 leading-snug">
                            Es la carga rápida del monitor. La ficha completa (nombre, foto, varias matrículas, dónde se la vio) está en{" "}
                            <Link href="/admin/users?tab=listanegra" className="font-bold underline underline-offset-2 hover:text-white">Usuarios → Lista negra</Link>.
                        </p>
                    </header>

                    {/* ── Agregar ── */}
                    <section className="px-6 py-5 space-y-3 border-b border-white/15">
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/75 inline-flex items-center gap-1.5"><Plus size={12} /> Agregar una matrícula</div>
                        <div className="flex items-center gap-3">
                            <label className="relative">
                                <span className="sr-only">Matrícula</span>
                                <input value={plate} onChange={(e) => { setPlate(e.target.value.toUpperCase()); setConflicto(null); }}
                                    onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} placeholder="ABC1234" maxLength={10}
                                    className="w-40 h-12 rounded-[8px] border-2 border-neutral-900 bg-white text-neutral-900 text-center text-[19px] font-extrabold tracking-[0.16em] uppercase tabular-nums outline-none placeholder:text-neutral-300 focus:ring-4 focus:ring-white/40" />
                            </label>
                            <p className="text-[12px] text-white/85 leading-snug">Como la lee la cámara: sin espacios ni guiones.</p>
                        </div>

                        {categorias.length > 1 && (
                            <div className="grid grid-cols-2 gap-2">
                                {categorias.map((cat) => {
                                    const Ic = ICONO_CATEGORIA[cat.value];
                                    const sel = category === cat.value;
                                    return (
                                        <button key={cat.value} type="button" onClick={() => { setCategory(cat.value); setConflicto(null); }} aria-pressed={sel}
                                            data-tooltip-id={TT} data-tooltip-content={WATCH_EFECTOS[cat.value].barrera}
                                            className={cn("w-full rounded-[10px] border p-2.5 text-left transition-colors", sel ? "bg-white text-[var(--mal)] border-white" : "border-white/25 hover:bg-white/10")}>
                                            <span className="flex items-center gap-1.5 text-[12.5px] font-bold"><Ic size={14} /> {NIVELES[cat.value as "BLACKLISTED" | "SEARCH"]?.titulo || cat.label}</span>
                                            <span className={cn("block text-[11px] mt-0.5 leading-snug", sel ? "opacity-80" : "text-white/75")}>{NIVELES[cat.value as "BLACKLISTED" | "SEARCH"]?.resumen}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
                            autoFocus={!!plateInicial} placeholder={MOTIVO_PISTA[category]} className={campo} />

                        {conflicto && (
                            <div className="rounded-[10px] bg-black/25 p-3 text-[12px] space-y-2">
                                <p><b>{plate}</b> ya está activa como <b>{watchCatMeta(conflicto.category).label}</b>{conflicto.motivo || conflicto.label ? ` (${conflicto.motivo || conflicto.label})` : ""}. ¿Pasarla a {meta.label}?</p>
                                <div className="flex gap-2">
                                    <button onClick={() => onAdd(true)} disabled={saving} className="h-8 px-3 rounded-[6px] bg-white text-[var(--mal)] text-[12px] font-bold">Sí, cambiarla</button>
                                    <button onClick={() => setConflicto(null)} className="h-8 px-3 rounded-[6px] border border-white/40 text-[12px] font-bold">No</button>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <button onClick={() => setNotify((n) => !n)} aria-pressed={notify}
                                data-tooltip-id={TT} data-tooltip-content={notify ? "Avisa: al leerla manda Telegram a la guardia y dispara las reglas de Notificaciones. Tocá para que sólo se vea en el monitor." : "En silencio: sólo se ve en el monitor. Tocá para que también avise por Telegram y Notificaciones."}
                                className={cn("h-11 px-3.5 rounded-full text-[12.5px] font-bold flex items-center gap-1.5 whitespace-nowrap border transition-colors", notify ? "bg-white/20 border-white/40" : "border-white/25 text-white/70")}>
                                {notify ? <Bell size={14} /> : <BellOff size={14} />} {notify ? "Avisa" : "Silencio"}
                            </button>
                            <button onClick={() => onAdd()} disabled={saving || !plate.trim()}
                                className="flex-1 h-11 rounded-[8px] bg-white text-[var(--mal)] text-[14px] font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-white/90">
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />} {negra ? "Cargar en la lista negra" : "Cargar en búsqueda"}
                            </button>
                        </div>
                    </section>

                    {/* ── En la lista ── */}
                    <section className="pt-5 pb-6">
                        <div className="px-6 flex items-center justify-between gap-2">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/75 inline-flex items-center gap-1.5"><ShieldAlert size={12} /> En la lista</div>
                            <span className="text-[11px] text-white/70">Tocá una para abrir su expediente</span>
                        </div>
                        <div className="px-6 mt-3 flex items-center gap-2">
                            <div className="relative flex-1 min-w-0">
                                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
                                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar matrícula, motivo o persona…" className={cn(campo, "pl-8 h-9")} />
                            </div>
                            <button onClick={() => setVerInactivas((v) => !v)} aria-pressed={verInactivas}
                                data-tooltip-id={TT} data-tooltip-content="Mostrar también las dadas de baja (siguen en el expediente)"
                                className={cn("h-9 px-3 rounded-full border text-[11.5px] font-semibold whitespace-nowrap transition-colors", verInactivas ? "bg-white text-[var(--mal)] border-white" : "border-white/30 text-white/80 hover:bg-white/10")}>
                                Con inactivas
                            </button>
                        </div>

                        <div className="mt-3">
                            {loading ? (
                                <div className="flex items-center justify-center py-8 text-white/80 gap-2 text-[12.5px]"><Loader2 size={15} className="animate-spin" /> Cargando…</div>
                            ) : error ? (
                                <div className="text-center py-8 text-[12.5px] space-y-2"><p>No se pudo leer la lista: {error}</p><button onClick={load} className="font-bold underline">Reintentar</button></div>
                            ) : visibles.length === 0 ? (
                                <div className="text-center py-10 text-white/75 text-[12.5px]">{rows.length === 0 ? "Todavía no hay matrículas en la lista negra" : query ? `Ninguna coincide con «${query}»` : "Ninguna activa"}</div>
                            ) : (
                                <div className="divide-y divide-white/10 border-y border-white/10">
                                    {visibles.map((r) => {
                                        const busqueda = r.category === "SEARCH";
                                        return (
                                            <div key={r.id} role="button" tabIndex={0} onClick={() => setAbierta(r)} onKeyDown={(e) => { if (e.key === "Enter") setAbierta(r); }}
                                                className={cn("group flex items-center gap-3 px-6 py-3 cursor-pointer bg-black/0 hover:bg-black/15 transition-colors", !r.active && "opacity-55")}>
                                                <Placa p={r.plate} />
                                                <div className="min-w-0 flex-1">
                                                    {busqueda && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 text-[10.5px] font-bold mb-1"><Search size={11} /> En búsqueda</span>}
                                                    <p className="text-[13px] font-semibold truncate">
                                                        {r.motivo || r.label || <span className="italic font-normal text-white/70">Sin motivo</span>}
                                                        {r.userName ? <span className="text-white/70 font-normal"> · {r.userName}</span> : null}
                                                    </p>
                                                    {!r.active && <p className="text-[11px] text-white/70">Dada de baja</p>}
                                                </div>
                                                {r.notify && r.active && <span data-tooltip-id={TT} data-tooltip-content="Avisa al detectarla (Telegram y Notificaciones)"><Bell size={14} className="text-white/85 shrink-0" /></span>}
                                                <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                                                    {r.active ? (
                                                        <button onClick={async () => { const x = await deactivateWatch(r.id); if (!x.ok) toast.error({ title: "No se pudo dar de baja", description: x.error }); avisarCamaras(x.camaras); load(); }}
                                                            data-tooltip-id={TT} data-tooltip-content={r.category === "BLACKLISTED" ? "Dar de baja: deja de denegar; si tiene credencial vuelve a la lista blanca de las lectoras. Queda en el expediente." : "Dar de baja: deja de avisar. Queda en el expediente."}
                                                            aria-label="Dar de baja" className="h-8 w-8 rounded-full grid place-items-center hover:bg-white/15"><Ban size={15} /></button>
                                                    ) : (
                                                        <button onClick={async () => { const x = await reactivateWatch(r.id); if (!x.ok) toast.error({ title: "No se pudo activar", description: x.error }); avisarCamaras(x.camaras); load(); }}
                                                            data-tooltip-id={TT} data-tooltip-content="Volver a activar: mismo motivo; vuelve a la lista negra de las lectoras."
                                                            aria-label="Volver a activar" className="h-8 w-8 rounded-full grid place-items-center hover:bg-white/15"><RotateCcw size={15} /></button>
                                                    )}
                                                </span>
                                                <ChevronRight size={16} className="text-white/70 group-hover:text-white shrink-0" />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>
                </CajonContenido>
            </Cajon>
            {/* El expediente reemplaza al cajón de la lista y al cerrarlo se vuelve a la lista. */}
            <FichaVigilancia fila={abierta} alCerrar={() => setAbierta(null)} alCambiar={load} />
        </>
    );
}

export default WatchlistDialog;
