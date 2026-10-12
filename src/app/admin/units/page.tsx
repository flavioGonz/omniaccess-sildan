"use client";

import { useEffect, useMemo, useState } from "react";
import { Tooltip as ReactTooltip } from "react-tooltip";
import { Building2, Home, MapPin, Pencil, Trash2, Plus, Search, Phone, X, Users, Loader2 } from "lucide-react";
import { getUnitsWithDetails, deleteUnit, getAvailableUsers } from "@/app/actions/units";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { CajonUnidad } from "@/components/units/CajonUnidad";
import { cn } from "@/lib/utils";

/**
 * Unidades (lotes, casas, edificios, barrios). Mismo criterio que el resto de las tablas:
 * encabezado de una fila (título, buscador al centro, filtro y Agregar), tabla compacta sin
 * sombras, acciones como íconos con tooltip y la fila entera abre el cajón de la unidad.
 */
type Categoria = "units" | "complexes" | "all";
const TT = "tt-unidades";

export default function UnitsPage() {
    const [units, setUnits] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [cat, setCat] = useState<Categoria>("units");
    const [disponibles, setDisponibles] = useState<any[]>([]);
    const [cajon, setCajon] = useState<{ abierto: boolean; id: string | null; padre: string | null }>({ abierto: false, id: null, padre: null });

    const cargar = async () => {
        setLoading(true);
        try {
            const [u, d] = await Promise.all([getUnitsWithDetails(), getAvailableUsers()]);
            setUnits(u as any[]); setDisponibles(d as any[]);
        } finally { setLoading(false); }
    };
    useEffect(() => { cargar(); }, []);

    const porId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
    const filtradas = useMemo(() => {
        const t = q.trim().toLowerCase();
        return units.filter((u) => {
            if (t && ![u.name, u.lot, u.houseNumber, u.contactName, u.adminPhone, ...(u.users || []).map((x: any) => x.name), ...(u.users || []).flatMap((x: any) => (x.vehicles || []).map((v: any) => v.plate))]
                .some((v) => String(v || "").toLowerCase().includes(t))) return false;
            if (cat === "units") return u.parentId !== null || u.type === "CASA";
            if (cat === "complexes") return u.parentId === null && (u.type === "BARRIO" || u.type === "EDIFICIO");
            return true;
        });
    }, [units, q, cat]);
    const cuenta = { units: units.filter((u) => u.parentId !== null || u.type === "CASA").length, complexes: units.filter((u) => u.parentId === null && (u.type === "BARRIO" || u.type === "EDIFICIO")).length, all: units.length };
    const ocupadas = filtradas.filter((u) => u.users?.length).length;

    const abrir = (id: string | null, padre: string | null = null) => setCajon({ abierto: true, id, padre });
    const unidadAbierta = cajon.id ? porId.get(cajon.id) || null : null;

    return (
        <div className="p-5 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
            {/* Encabezado: título · buscador al centro · filtro y alta */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(320px,560px)_1fr] items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-blue-500/10 border border-blue-500/30 grid place-items-center"><Building2 className="w-5 h-5 text-blue-500" /></div>
                    <div className="min-w-0">
                        <h1 className="text-[20px] font-bold leading-tight">Unidades</h1>
                        <p className="text-[12px] text-muted-foreground">{filtradas.length} unidades · {ocupadas} ocupadas</p>
                    </div>
                </div>
                <div className="relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground group-focus-within:text-blue-500 transition-colors" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")}
                        placeholder="Buscar lote, casa, residente, contacto o matrícula…"
                        className="w-full h-11 rounded-xl border border-border bg-card pl-11 pr-10 text-[14px] outline-none shadow-sm transition-all placeholder:text-muted-foreground/70 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15" />
                    {q && <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-lg hover:bg-accent text-muted-foreground"><X size={15} /></button>}
                </div>
                <div className="flex items-center gap-2 lg:justify-end">
                    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
                        {([["units", "Lotes y casas", Home], ["complexes", "Barrios y edificios", MapPin], ["all", "Todo", Building2]] as const).map(([v, l, I]) => (
                            <button key={v} onClick={() => setCat(v)}
                                className={cn("h-8 px-2.5 rounded-md text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap", cat === v ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                                <I size={13} /> {l} <span className={cn("text-[10.5px] tabular-nums", cat === v ? "text-white/80" : "text-muted-foreground/70")}>{cuenta[v]}</span>
                            </button>
                        ))}
                    </div>
                    <button onClick={() => abrir(null)} className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors"><Plus size={16} /> Agregar</button>
                </div>
            </div>

            {/* Tabla */}
            <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                <div className="overflow-x-auto max-h-[calc(100vh-190px)] overflow-y-auto">
                    <table className="w-full text-left">
                        <thead className="sticky top-0 z-10 bg-card">
                            <tr className="border-b border-border/60">
                                {["Unidad", "Pertenece a", "Estado", "Residentes y matrículas", "Contacto", ""].map((h, i) => (
                                    <th key={i} className={cn("px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold", i === 5 && "text-right")}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading && units.length === 0 && (
                                <tr><td colSpan={6} className="py-16 text-center text-muted-foreground"><Loader2 className="mx-auto animate-spin" size={20} /></td></tr>
                            )}
                            {!loading && filtradas.length === 0 && (
                                <tr><td colSpan={6} className="py-16 text-center text-muted-foreground"><Building2 size={28} className="mx-auto mb-2 opacity-30" /><p className="text-sm">No se encontraron unidades</p></td></tr>
                            )}
                            {filtradas.map((u) => {
                                const pers = u.users || [];
                                const placas = pers.flatMap((p: any) => (p.vehicles || []).map((v: any) => v.plate));
                                const Icono = u.type === "BARRIO" ? MapPin : u.type === "EDIFICIO" ? Building2 : Home;
                                const padre = u.parentId ? porId.get(u.parentId) : null;
                                return (
                                    <tr key={u.id} onClick={(e) => { if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("button")) return; abrir(u.id); }}
                                        className="border-b border-border/50 last:border-0 hover:bg-foreground/[0.04] transition-colors cursor-pointer">
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-3">
                                                <span className={cn("h-8 w-8 shrink-0 rounded-lg grid place-items-center", u.parentId || u.type === "CASA" ? "bg-blue-500/10 text-blue-500" : "bg-violet-500/10 text-violet-500")}><Icono size={15} /></span>
                                                <div className="min-w-0">
                                                    <p className="text-[13px] font-semibold truncate">{u.name}</p>
                                                    <p className="text-[11px] text-muted-foreground truncate">{[u.lot && `Lote ${u.lot}`, u.houseNumber && `N° ${u.houseNumber}`].filter(Boolean).join(" · ") || (u.type === "CASA" ? "Lote / casa" : u.type === "BARRIO" ? `Barrio · ${u.children?.length || 0} sub-unidades` : `Edificio · ${u.children?.length || 0} sub-unidades`)}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-[12px] text-muted-foreground">{padre ? padre.name : <span className="text-muted-foreground/50">—</span>}</td>
                                        <td className="px-3 py-2">
                                            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border", pers.length ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-muted text-muted-foreground border-border")}>
                                                {pers.length ? <><Users size={10} /> Ocupada · {pers.length}</> : "Vacante"}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            {pers.length ? (
                                                <div className="min-w-0">
                                                    <p className="text-[12.5px] truncate max-w-[280px]">{pers.slice(0, 2).map((p: any) => p.name).join(", ")}{pers.length > 2 ? ` y ${pers.length - 2} más` : ""}</p>
                                                    {placas.length > 0 && (
                                                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                            {placas.slice(0, 4).map((p: string) => <span key={p} className="text-[10px] font-mono font-bold text-blue-500 bg-blue-500/10 px-1.5 rounded">{p}</span>)}
                                                            {placas.length > 4 && <span className="text-[10px] text-muted-foreground">+{placas.length - 4}</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : <span className="text-[12px] text-muted-foreground/60">{u.contactName || "Sin residentes"}</span>}
                                        </td>
                                        <td className="px-3 py-2">
                                            {u.adminPhone || u.contactName ? (
                                                <div className="min-w-0">
                                                    {u.contactName && <p className="text-[12px] truncate max-w-[180px]">{u.contactName}</p>}
                                                    {u.adminPhone && <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Phone size={10} /> {u.adminPhone}</p>}
                                                </div>
                                            ) : <span className="text-muted-foreground/50 text-xs">—</span>}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="inline-flex items-center gap-0.5">
                                                <button onClick={() => abrir(u.id)} data-tooltip-id={TT} data-tooltip-content="Editar unidad" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><Pencil size={14} /></button>
                                                <span onClick={(e) => e.stopPropagation()}>
                                                    <DeleteConfirmDialog id={u.id} title={u.name} onDelete={deleteUnit} onSuccess={cargar}>
                                                        <button data-tooltip-id={TT} data-tooltip-content="Eliminar unidad" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10"><Trash2 size={14} /></button>
                                                    </DeleteConfirmDialog>
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <CajonUnidad open={cajon.abierto} onOpenChange={(v) => setCajon((c) => ({ ...c, abierto: v }))}
                unidad={unidadAbierta} padreId={cajon.padre} unidades={units} disponibles={disponibles}
                onListo={cargar} onNuevaHija={(padre) => abrir(null, padre)} />
            <ReactTooltip id={TT} place="top" className="!max-w-[260px] !text-[12px] !rounded-lg !z-[60]" />
        </div>
    );
}
