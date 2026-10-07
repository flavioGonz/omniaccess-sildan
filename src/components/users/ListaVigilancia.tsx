"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldAlert, Plus, Loader2, Bell, BellOff, Ban, RotateCcw, Pencil, Check, X, User as UserIco, Camera, Monitor, MessageSquare, DoorClosed } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Matricula, Momento, Nada } from "@/components/ui/celdas";
import { Filtros } from "@/components/ui/filtros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    getWatchlist, getNegrasPorRol, addWatch, updateWatch, deactivateWatch, reactivateWatch,
    marcarPersonaEnListaNegra, type FilaVigilancia,
} from "@/app/actions/watchlist";
import { WATCH_CATEGORY_LIST, WATCH_EFECTOS, watchCatMeta, type WatchCategory } from "@/lib/watch-categories";
import { resumirCamaras } from "@/lib/lista-negra";
import { ExplicacionCategoria } from "@/components/WatchlistDialog";

/**
 * La pestaña "Lista de vigilancia" de /admin/users: el lugar donde se administra la lista
 * entera. El diálogo del monitor, la ficha del evento y el bot son atajos a esta misma lista.
 *
 * Tiene, además de la tabla, el bloque "Qué hace esta lista": el operador tiene que saber qué
 * va a pasar en la barrera, en las cámaras, en el monitor y en WhatsApp antes de cargar a
 * alguien. Lo que dice ese bloque es lo que el sistema hace (lib/watch-categories →
 * WATCH_EFECTOS); si cambia el comportamiento, cambia el texto en el mismo commit.
 */

type Persona = { id: string; name: string; unit?: { name?: string | null } | null; credentials?: { type: string; value: string }[] };
type Fila = FilaVigilancia | { id: string; plate: string; category: "BLACKLISTED"; label: string; motivo: null; color: null; notify: true; active: true; createdAt: null; updatedAt: null; deactivatedAt: null; createdBy: null; userId: string; userName: string; unidad: string | null; origen: "rol" };

function avisarCamaras(camaras?: { ok: any[]; fallo: any[] }) {
    if (!camaras) return;
    const texto = resumirCamaras(camaras);
    if (camaras.fallo.length) toast.warning({ title: "Lectoras: alguna no respondió", description: texto });
    else toast.success({ title: "Lectoras actualizadas", description: texto });
}

/** El bloque de explicación: cuatro columnas (barrera, cámaras, monitor, avisos) por categoría. */
function QueHaceEstaLista() {
    const [abierta, setAbierta] = useState<WatchCategory>("BLACKLISTED");
    const e = WATCH_EFECTOS[abierta];
    const Celda = ({ icono: Ic, titulo, texto }: { icono: any; titulo: string; texto: string }) => (
        <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Ic size={12} /> {titulo}</div>
            <p className="mt-1 text-[12px] leading-snug text-foreground/90">{texto}</p>
        </div>
    );
    return (
        <section className="rounded-[10px] border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-sm font-bold text-foreground">Qué hace esta lista</h2>
                    <p className="text-[12px] text-muted-foreground">Una sola lista por matrícula. Lo que se carga acá, en el monitor, en la ficha de un evento o por el bot es lo mismo, y esto es exactamente lo que pasa con cada categoría.</p>
                </div>
                <div className="flex gap-1.5">
                    {WATCH_CATEGORY_LIST.map((c) => (
                        <button key={c.value} onClick={() => setAbierta(c.value)}
                            className={cn("h-8 px-3 rounded-full border text-[10px] font-bold uppercase tracking-wide", abierta === c.value ? c.badge : "bg-background text-muted-foreground border-border hover:text-foreground")}>
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                <Celda icono={DoorClosed} titulo="En la barrera" texto={e.barrera} />
                <Celda icono={Camera} titulo="En las lectoras" texto={e.camaras} />
                <Celda icono={Monitor} titulo="En el monitor" texto={e.monitor} />
                <Celda icono={MessageSquare} titulo="En los avisos" texto={e.avisos} />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
                Una <b>persona</b> marcada en lista negra desde su ficha arrastra <b>todas</b> sus matrículas, y las nuevas que se le carguen después. Dar de baja no borra: la entrada queda inactiva, con quién y cuándo. Las marcadas <b>por rol</b> vienen del módulo facial y se sacan desde allí.
            </p>
        </section>
    );
}

export function ListaVigilancia({ personas }: { personas: Persona[] }) {
    const [filas, setFilas] = useState<FilaVigilancia[]>([]);
    const [porRol, setPorRol] = useState<Awaited<ReturnType<typeof getNegrasPorRol>>>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const [filtroCat, setFiltroCat] = useState("todas");
    const [filtroEstado, setFiltroEstado] = useState("activas");

    // alta
    const [modoAlta, setModoAlta] = useState<"matricula" | "persona">("matricula");
    const [plate, setPlate] = useState("");
    const [personaId, setPersonaId] = useState("");
    const [motivo, setMotivo] = useState("");
    const [category, setCategory] = useState<WatchCategory>("BLACKLISTED");
    const [notify, setNotify] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [conflicto, setConflicto] = useState<string | null>(null);

    // edición en línea
    const [editando, setEditando] = useState<string | null>(null);
    const [editMotivo, setEditMotivo] = useState("");
    const [editCat, setEditCat] = useState<WatchCategory>("BLACKLISTED");

    const cargar = useCallback(() => {
        setCargando(true); setError(null);
        Promise.all([getWatchlist(), getNegrasPorRol()])
            .then(([w, r]) => { setFilas(w); setPorRol(r); })
            .catch((e) => setError(e?.message || "No se pudo leer la lista"))
            .finally(() => setCargando(false));
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const todas: Fila[] = useMemo(() => [
        ...filas,
        ...porRol.map((r) => ({ id: `rol-${r.plate}`, plate: r.plate, category: "BLACKLISTED" as const, label: r.userName, motivo: null, color: null, notify: true as const, active: true as const, createdAt: null, updatedAt: null, deactivatedAt: null, createdBy: null, userId: r.userId, userName: r.userName, unidad: r.unidad, origen: "rol" as const })),
    ], [filas, porRol]);

    const visibles = useMemo(() => {
        const q = busqueda.trim().toUpperCase();
        return todas.filter((f) =>
            (filtroEstado === "todas" || (filtroEstado === "activas" ? f.active : !f.active)) &&
            (filtroCat === "todas" || f.category === filtroCat) &&
            (!q || f.plate.includes(q) || (f.motivo || f.label || "").toUpperCase().includes(q) || (f.userName || "").toUpperCase().includes(q) || (f.createdBy || "").toUpperCase().includes(q)));
    }, [todas, busqueda, filtroCat, filtroEstado]);

    const personasConChapa = useMemo(() => personas.filter((p) => (p.credentials || []).some((c) => c.type === "PLATE")), [personas]);

    async function alta(force = false) {
        setGuardando(true); setConflicto(null);
        try {
            if (modoAlta === "persona") {
                if (!personaId) return;
                const r: any = await marcarPersonaEnListaNegra(personaId, motivo.trim(), force);
                if (r.conflicto && !force) { setConflicto(r.error); return; }
                if (!r.ok) { toast.error({ title: "No se pudo marcar", description: r.error }); return; }
                toast.success({ title: "Persona en lista negra", description: `${r.plates.length} matrícula${r.plates.length === 1 ? "" : "s"}: ${r.plates.join(", ")}. Toda lectura se registra DENEGADA.` });
                avisarCamaras(r.camaras);
            } else {
                const p = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
                if (!p) return;
                const r = await addWatch({ plate: p, category, motivo: motivo.trim() || undefined, label: motivo.trim(), notify, force });
                if (r.conflicto) { setConflicto(`${p} ya está activa como ${watchCatMeta(r.conflicto.category).label}${r.conflicto.motivo ? ` (${r.conflicto.motivo})` : ""}.`); return; }
                if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
                toast.success({ title: `${p} · ${watchCatMeta(category).label}`, description: WATCH_EFECTOS[category].barrera });
                avisarCamaras(r.camaras);
            }
            setPlate(""); setMotivo(""); setPersonaId("");
            cargar();
        } finally { setGuardando(false); }
    }

    async function guardarEdicion(f: FilaVigilancia) {
        const r = await updateWatch(f.id, { motivo: editMotivo.trim() || null, label: editMotivo.trim(), category: editCat });
        if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
        avisarCamaras(r.camaras); setEditando(null); cargar();
    }

    const columnas: ColumnaTabla<Fila>[] = [
        { clave: "plate", titulo: "Matrícula", ancho: 120, valor: (f) => f.plate, celda: (f) => <Matricula p={f.plate} className={!f.active ? "opacity-50" : ""} /> },
        {
            clave: "category", titulo: "Categoría", ancho: 150, valor: (f) => watchCatMeta(f.category).label,
            celda: (f) => editando === f.id ? (
                <Select value={editCat} onValueChange={(v) => setEditCat(v as WatchCategory)}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{WATCH_CATEGORY_LIST.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
            ) : (
                <Pista titulo={watchCatMeta(f.category).label} texto={<ExplicacionCategoria cat={f.category} />} ancho={340}>
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider", watchCatMeta(f.category).badge, !f.active && "opacity-50")}>{watchCatMeta(f.category).label}</span>
                </Pista>
            ),
        },
        {
            clave: "motivo", titulo: "Motivo", valor: (f) => f.motivo || f.label || "",
            celda: (f) => editando === f.id
                ? <Input value={editMotivo} onChange={(e) => setEditMotivo(e.target.value)} className="h-7 text-[12px]" autoFocus onKeyDown={(e) => { if (e.key === "Enter" && f.origen !== "rol") guardarEdicion(f as FilaVigilancia); if (e.key === "Escape") setEditando(null); }} />
                : (f.motivo || f.label) ? <span className="text-[12px]">{f.motivo || f.label}</span> : <Nada />,
        },
        {
            clave: "persona", titulo: "Persona", ayuda: "A quién está vinculada. Si tiene persona, desmarcarla desde su ficha la saca.", valor: (f) => f.userName || "",
            celda: (f) => f.userName
                ? <span className="inline-flex items-center gap-1.5 text-[12px]"><UserIco size={12} className="text-muted-foreground" /> {f.userName}{f.unidad ? <span className="text-muted-foreground"> · {f.unidad}</span> : null}</span>
                : <Nada />,
        },
        {
            clave: "origen", titulo: "Origen", ancho: 110, valor: (f) => f.origen,
            celda: (f) => f.origen === "rol"
                ? <Pista titulo="Por rol" texto="El dueño tiene rol 'Lista negra' (módulo facial). No tiene entrada propia; se saca desde ese módulo."><span><Estado tono="aviso">por rol</Estado></span></Pista>
                : f.origen === "persona" ? <Estado tono="neutro">persona</Estado> : <Estado tono="neutro">matrícula</Estado>,
        },
        { clave: "createdBy", titulo: "Cargó", ancho: 140, valor: (f) => f.createdBy || "", celda: (f) => f.createdBy ? <span className="text-[12px] text-muted-foreground truncate block max-w-[130px]" title={f.createdBy}>{f.createdBy}</span> : <Nada /> },
        { clave: "createdAt", titulo: "Desde", ancho: 110, valor: (f) => f.createdAt ? new Date(f.createdAt).toISOString() : "", celda: (f) => f.createdAt ? <Momento t={f.createdAt} /> : <Nada /> },
        {
            clave: "estado", titulo: "Estado", ancho: 120, valor: (f) => f.active ? "activa" : "inactiva",
            celda: (f) => f.active
                ? <Estado tono={f.category === "BLACKLISTED" ? "mal" : "info"}>activa</Estado>
                : <Pista titulo="Inactiva" texto={f.deactivatedAt ? `Dada de baja el ${new Date(f.deactivatedAt).toLocaleString("es-UY")}` : "Dada de baja"}><span><Estado tono="quieto">inactiva</Estado></span></Pista>,
        },
        {
            clave: "acciones", titulo: "", ancho: 120, auxiliar: true,
            celda: (f) => {
                if (f.origen === "rol") return null;
                const fila = f as FilaVigilancia;
                if (editando === f.id) return (
                    <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => guardarEdicion(fila)} className="p-1.5 rounded hover:bg-accent text-[var(--bien)]"><Check size={14} /></button>
                        <button onClick={() => setEditando(null)} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><X size={14} /></button>
                    </div>
                );
                return (
                    <div className="flex items-center gap-1 justify-end">
                        {f.active && <span title={f.notify ? "Avisa" : "En silencio"} className="p-1.5 text-muted-foreground">{f.notify ? <Bell size={13} className="text-[var(--info)]" /> : <BellOff size={13} />}</span>}
                        <Pista titulo="Editar" texto="Motivo y categoría."><button onClick={() => { setEditando(f.id); setEditMotivo(f.motivo || f.label || ""); setEditCat(f.category); }} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil size={14} /></button></Pista>
                        {f.active ? (
                            <Pista titulo="Dar de baja" texto={f.category === "BLACKLISTED" ? "Deja de denegar; si tiene credencial vuelve a la lista blanca de las lectoras. Queda como inactiva." : "Deja de destacarse. Queda como inactiva."} lado="izquierda">
                                <button onClick={async () => { const r = await deactivateWatch(fila.id); if (!r.ok) toast.error({ title: "No se pudo dar de baja", description: r.error }); avisarCamaras(r.camaras); cargar(); }} className="p-1.5 rounded hover:bg-[var(--mal-suave)] text-[var(--mal)]"><Ban size={14} /></button>
                            </Pista>
                        ) : (
                            <Pista titulo="Volver a activar" texto="Misma categoría y motivo; si es lista negra vuelve a las lectoras." lado="izquierda">
                                <button onClick={async () => { const r = await reactivateWatch(fila.id); if (!r.ok) toast.error({ title: "No se pudo activar", description: r.error }); avisarCamaras(r.camaras); cargar(); }} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><RotateCcw size={14} /></button>
                            </Pista>
                        )}
                    </div>
                );
            },
        },
    ];

    const activas = todas.filter((f) => f.active).length;
    const negras = todas.filter((f) => f.active && f.category === "BLACKLISTED").length;

    return (
        <div className="flex flex-col gap-4 h-full min-h-0">
            <QueHaceEstaLista />

            {/* Alta: por matrícula suelta o por persona (todas sus matrículas) */}
            <section className="rounded-[10px] border border-border bg-card p-4">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex rounded-full border border-border p-0.5 bg-background">
                        {([["matricula", "Una matrícula"], ["persona", "Una persona"]] as const).map(([k, l]) => (
                            <button key={k} onClick={() => { setModoAlta(k); setConflicto(null); if (k === "persona") setCategory("BLACKLISTED"); }} className={cn("h-8 px-3 rounded-full text-[11px] font-bold", modoAlta === k ? "bg-accent text-foreground" : "text-muted-foreground")}>{l}</button>
                        ))}
                    </div>
                    {modoAlta === "matricula" ? (
                        <Input value={plate} onChange={(e) => { setPlate(e.target.value.toUpperCase()); setConflicto(null); }} placeholder="MATRÍCULA" className="w-36 h-9 font-bold uppercase tracking-wider tabular-nums" onKeyDown={(e) => { if (e.key === "Enter") alta(); }} />
                    ) : (
                        <Select value={personaId} onValueChange={(v) => { setPersonaId(v); setConflicto(null); }}>
                            <SelectTrigger className="w-72 h-9"><SelectValue placeholder="Elegir persona con matrículas…" /></SelectTrigger>
                            <SelectContent>
                                {personasConChapa.length === 0 && <div className="px-3 py-2 text-[12px] text-muted-foreground">Ninguna persona tiene matrículas cargadas.</div>}
                                {personasConChapa.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.unit?.name ? ` · ${p.unit.name}` : ""} ({(p.credentials || []).filter((c) => c.type === "PLATE").map((c) => c.value).join(", ")})</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                    <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (queda en el registro)" className="flex-1 min-w-[200px] h-9" onKeyDown={(e) => { if (e.key === "Enter") alta(); }} />
                    {modoAlta === "matricula" && (
                        <div className="flex gap-1.5">
                            {WATCH_CATEGORY_LIST.map((c) => (
                                <Pista key={c.value} titulo={c.label} texto={<ExplicacionCategoria cat={c.value} />} ancho={340} lado="abajo">
                                    <button onClick={() => { setCategory(c.value); setConflicto(null); }} className={cn("h-9 px-3 rounded-full border text-[10px] font-bold uppercase tracking-wide", category === c.value ? c.badge : "bg-background text-muted-foreground border-border hover:text-foreground")}>{c.label}</button>
                                </Pista>
                            ))}
                        </div>
                    )}
                    <Pista titulo={notify ? "Avisa" : "En silencio"} texto="Con aviso, al detectarse manda Telegram y dispara la regla WATCHLIST del motor de notificaciones. En silencio sólo se ve en el monitor." lado="abajo">
                        <button onClick={() => setNotify((n) => !n)} className={cn("h-9 px-3 rounded-full border text-[11px] font-bold flex items-center gap-1.5", notify ? "bg-[var(--info-suave)] text-[var(--info)] border-border" : "bg-background text-muted-foreground border-border")}>{notify ? <Bell size={13} /> : <BellOff size={13} />} {notify ? "Avisa" : "Silencio"}</button>
                    </Pista>
                    <Button onClick={() => alta()} disabled={guardando || (modoAlta === "matricula" ? !plate.trim() : !personaId)} className="h-9">
                        {guardando ? <Loader2 size={14} className="animate-spin mr-1" /> : <Plus size={14} className="mr-1" />} {modoAlta === "persona" ? "Marcar en lista negra" : "Agregar"}
                    </Button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                    <span className={cn("font-bold", watchCatMeta(modoAlta === "persona" ? "BLACKLISTED" : category).text)}>{watchCatMeta(modoAlta === "persona" ? "BLACKLISTED" : category).label}:</span> {WATCH_EFECTOS[modoAlta === "persona" ? "BLACKLISTED" : category].barrera}
                </p>
                {conflicto && (
                    <div className="mt-3 rounded-[6px] border border-[var(--aviso)] bg-[var(--aviso-suave)] p-3 text-[12px] flex flex-wrap items-center gap-2">
                        <span className="flex-1">{conflicto} ¿Pasarla a {watchCatMeta(modoAlta === "persona" ? "BLACKLISTED" : category).label}?</span>
                        <Button size="sm" onClick={() => alta(true)} disabled={guardando}>Sí, cambiarla</Button>
                        <Button size="sm" variant="outline" onClick={() => setConflicto(null)}>No</Button>
                    </div>
                )}
            </section>

            <div className="flex-1 min-h-0">
                <Tabla<Fila>
                    filas={visibles}
                    clave={(f) => f.id}
                    columnas={columnas}
                    cargando={cargando}
                    error={error}
                    alReintentar={cargar}
                    vacio={{ icono: ShieldAlert, titulo: busqueda || filtroCat !== "todas" || filtroEstado !== "activas" ? "Ninguna coincide" : "Sin matrículas vigiladas", ayuda: "Lo que se cargue acá, en el monitor o por el bot aparece en esta tabla." }}
                    barra={
                        <Filtros
                            busqueda={busqueda} alBuscar={setBusqueda} placeholder="Matrícula, motivo, persona o quién cargó"
                            grupos={[
                                { clave: "cat", titulo: "Categoría", valor: filtroCat, alElegir: setFiltroCat, opciones: [{ valor: "todas", rotulo: "Todas" }, ...WATCH_CATEGORY_LIST.map((c) => ({ valor: c.value, rotulo: c.label }))] },
                                { clave: "estado", titulo: "Estado", valor: filtroEstado, alElegir: setFiltroEstado, opciones: [{ valor: "activas", rotulo: "Activas" }, { valor: "inactivas", rotulo: "Inactivas" }, { valor: "todas", rotulo: "Todas" }] },
                            ]}
                            acciones={<span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{activas} activa{activas === 1 ? "" : "s"} · {negras} en lista negra</span>}
                        />
                    }
                />
            </div>
        </div>
    );
}
