"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Tooltip } from "react-tooltip";
import {
    Building2, Home, MapPin, Info, Users, Car, LayoutGrid, Hash, Layers, UserCircle, Phone, Mail, Building, Loader2, Save,
    Plus, X, ExternalLink, Search, ScanFace, IdCard, UserPlus, Wand2, Pencil, Navigation, Check,
} from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Campo, Bloque, Etiqueta, Heroe, chipHeroe } from "@/components/ui/cajon-campos";
import { createUnit, updateUnit, bulkCreateSubUnits, assignUserToUnit, unassignUserFromUnit } from "@/app/actions/units";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

const LocationPicker = dynamic(() => import("@/components/LocationPicker"), { ssr: false, loading: () => <div className="h-64 w-full bg-muted animate-pulse rounded-xl" /> });

/**
 * Unidad (lote, casa, edificio o barrio) en un cajón, para dar de alta y para editar. Arriba la
 * cabecera con el nombre y lo que tiene (personas, matrículas, sub-unidades); abajo pestañas:
 * datos, ubicación, residentes (vincular y desvincular sin otro modal), vehículos y, en un barrio
 * o edificio, sus sub-unidades con la generación masiva.
 */
const TT = "tt-unidad";
type Pestana = "general" | "ubicacion" | "residentes" | "vehiculos" | "unidades";
const TIPOS = [
    { id: "CASA", I: Home, t: "Lote / casa", d: "Una vivienda: lote del barrio o casa individual." },
    { id: "BARRIO", I: MapPin, t: "Barrio", d: "Agrupa lotes. Se le cargan sub-unidades." },
    { id: "EDIFICIO", I: Building2, t: "Edificio", d: "Torre con pisos y departamentos." },
] as const;
const VACIO = { name: "", type: "CASA", floors: "", lot: "", houseNumber: "", address: "", adminPhone: "", contactName: "", contactEmail: "", deviceCount: "2", deviceType: "BOTH", coordinates: "-34.6037, -58.3816", parentId: "" };

export function CajonUnidad({ open, onOpenChange, unidad, padreId, unidades, disponibles, onListo, onNuevaHija }: {
    open: boolean; onOpenChange: (v: boolean) => void;
    /** null = alta. */
    unidad: any | null;
    /** En un alta: de qué barrio/edificio cuelga. */
    padreId?: string | null;
    unidades: any[]; disponibles: any[];
    onListo: () => void;
    onNuevaHija: (padreId: string) => void;
}) {
    const esAlta = !unidad;
    const [f, setF] = useState<typeof VACIO>(VACIO);
    const [tab, setTab] = useState<Pestana>("general");
    const [guardando, setGuardando] = useState(false);
    const [vinculando, setVinculando] = useState(false);
    const [qPersona, setQPersona] = useState("");
    const [patron, setPatron] = useState("A-Z, 13");
    const [generando, setGenerando] = useState(false);
    const set = (k: keyof typeof VACIO) => (v: string) => setF((x) => ({ ...x, [k]: v }));

    useEffect(() => {
        if (!open) return;
        setTab("general"); setVinculando(false); setQPersona("");
        setF(unidad ? {
            name: unidad.name || "", type: unidad.type || "CASA", floors: unidad.floors?.toString() || "", lot: unidad.lot || "", houseNumber: unidad.houseNumber || "",
            address: unidad.address || "", adminPhone: unidad.adminPhone || "", contactName: unidad.contactName || "", contactEmail: unidad.contactEmail || "",
            deviceCount: unidad.deviceCount?.toString() || "2", deviceType: unidad.deviceType || "BOTH", coordinates: unidad.coordinates || VACIO.coordinates, parentId: unidad.parentId || "",
        } : { ...VACIO, parentId: padreId || "", type: padreId ? "CASA" : "CASA" });
    }, [open, unidad?.id, padreId]); // eslint-disable-line react-hooks/exhaustive-deps

    const personas: any[] = unidad?.users || [];
    const matriculas = useMemo(() => personas.flatMap((u) => [
        ...(u.vehicles || []).map((v: any) => ({ plate: v.plate, quien: u.name })),
        ...(u.credentials || []).filter((c: any) => c.type === "PLATE").map((c: any) => ({ plate: c.value, quien: u.name })),
    ]).filter((m, i, a) => m.plate && a.findIndex((x) => x.plate === m.plate) === i), [personas]);
    const hijas: any[] = unidad?.children || [];
    const esComplejo = f.type === "BARRIO" || f.type === "EDIFICIO";
    const padre = unidades.find((u) => u.id === (f.parentId || padreId));
    const complejos = unidades.filter((u) => !u.parentId && (u.type === "BARRIO" || u.type === "EDIFICIO") && u.id !== unidad?.id);

    const guardar = async () => {
        if (!f.name.trim()) { toast.error({ title: "Falta el nombre" }); setTab("general"); return; }
        setGuardando(true);
        try {
            const p = new FormData(); Object.entries(f).forEach(([k, v]) => p.append(k, v));
            if (unidad) await updateUnit(unidad.id, p); else await createUnit(p);
            toast.success({ title: esAlta ? "Unidad creada" : "Unidad guardada", description: f.name });
            onOpenChange(false); onListo();
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };
    const vincular = async (u: any) => {
        await assignUserToUnit(u.id, unidad.id);
        toast.success({ title: `${u.name} vinculado`, description: f.name }); setVinculando(false); setQPersona(""); onListo();
    };
    const desvincular = async (u: any) => { await unassignUserFromUnit(u.id); toast.success({ title: `${u.name} desvinculado` }); onListo(); };
    const generar = async () => {
        if (!unidad) return; setGenerando(true);
        try { await bulkCreateSubUnits(unidad.id, patron); toast.success({ title: "Sub-unidades generadas", description: patron }); onListo(); }
        catch { toast.error({ title: "No se pudo generar" }); } finally { setGenerando(false); }
    };

    const pestanas: { id: Pestana; I: any; t: string; n?: number }[] = [
        { id: "general", I: Info, t: "Datos" },
        { id: "ubicacion", I: MapPin, t: "Ubicación" },
        ...(!esAlta ? [{ id: "residentes" as Pestana, I: Users, t: "Residentes", n: personas.length }, { id: "vehiculos" as Pestana, I: Car, t: "Vehículos", n: matriculas.length }] : []),
        ...(!esAlta && esComplejo ? [{ id: "unidades" as Pestana, I: LayoutGrid, t: "Sub-unidades", n: hijas.length }] : []),
    ];
    const libres = disponibles.filter((u) => !qPersona || `${u.name} ${u.email || ""} ${u.phone || ""}`.toLowerCase().includes(qPersona.toLowerCase())).slice(0, 80);
    const Icono = f.type === "BARRIO" ? MapPin : f.type === "EDIFICIO" ? Building2 : Home;

    return (
        <Cajon open={open} onOpenChange={(v) => !guardando && onOpenChange(v)}>
            <CajonContenido ancho="intermedio" tituloOculto titulo={esAlta ? "Nueva unidad" : `Unidad ${f.name}`} descripcion="Datos, ubicación, residentes y vehículos de la unidad"
                pie={<div className="flex items-center gap-2 w-full">
                    <span className="flex-1 text-[12px] text-muted-foreground truncate">{padre ? `Pertenece a ${padre.name}` : esComplejo ? "Unidad principal" : ""}</span>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando} className="gap-1.5">{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {esAlta ? "Crear unidad" : "Guardar"}</Button>
                </div>}>
                <Heroe titulo={f.name || (esAlta ? "Nueva unidad" : "Unidad")} subtitulo={[f.lot && `Lote ${f.lot}`, f.houseNumber && `N° ${f.houseNumber}`, padre?.name].filter(Boolean).join(" · ") || (esAlta ? "Completá los datos" : TIPOS.find((t) => t.id === f.type)?.t)}
                    fondo="bg-[radial-gradient(120%_120%_at_0%_0%,#1e3a8a_0%,#0b1430_55%,#000_100%)]"
                    chips={<>
                        <span className={chipHeroe}><Icono size={11} /> {TIPOS.find((t) => t.id === f.type)?.t}</span>
                        {!esAlta && <span className={cn(chipHeroe, personas.length ? "!bg-emerald-600/80" : "")}>{personas.length ? "Ocupada" : "Vacante"}</span>}
                    </>}>
                    {!esAlta && (
                        <div className="grid grid-cols-3 gap-2 mt-1">
                            {[["Personas", personas.length], ["Matrículas", matriculas.length], [esComplejo ? "Sub-unidades" : "Vehículos", esComplejo ? hijas.length : matriculas.length]].map(([t, n]) => (
                                <div key={t as string} className="rounded-xl bg-white/10 ring-1 ring-white/10 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.14em] text-white/60">{t}</div><div className="text-[22px] font-black tabular-nums">{n}</div></div>
                            ))}
                        </div>
                    )}
                </Heroe>

                {/* Pestañas */}
                <div className="px-6 pt-1 pb-2 border-b border-border flex gap-1 overflow-x-auto">
                    {pestanas.map((p) => (
                        <button key={p.id} type="button" onClick={() => setTab(p.id)}
                            className={cn("h-9 px-3 rounded-lg text-[12.5px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors",
                                tab === p.id ? "bg-[var(--accion)] text-white" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                            <p.I size={14} /> {p.t}{p.n != null && <span className={cn("text-[10.5px] px-1.5 rounded-full tabular-nums", tab === p.id ? "bg-white/20" : "bg-muted")}>{p.n}</span>}
                        </button>
                    ))}
                </div>

                {tab === "general" && (<>
                    {esAlta && (
                        <Bloque titulo="Tipo" icono={Layers} tt={TT} ayuda="Qué es. Un lote del barrio es «Lote / casa» y se lo cuelga del barrio.">
                            <div className="grid grid-cols-3 gap-2">
                                {TIPOS.map((t) => (
                                    <button key={t.id} type="button" onClick={() => set("type")(t.id)}
                                        className={cn("relative rounded-xl border p-3 text-left transition-colors", f.type === t.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)] ring-1 ring-[var(--accion)]" : "border-border hover:bg-accent/50")}>
                                        {f.type === t.id && <span className="absolute top-2 right-2 grid h-5 w-5 place-items-center rounded-full bg-[var(--accion)] text-white"><Check size={12} /></span>}
                                        <t.I size={20} className="text-[var(--accion)]" />
                                        <div className="mt-1.5 text-[13px] font-bold">{t.t}</div>
                                        <div className="text-[11px] text-muted-foreground leading-snug">{t.d}</div>
                                    </button>
                                ))}
                            </div>
                        </Bloque>
                    )}
                    <Bloque titulo="Identificación" icono={Hash} tt={TT}>
                        <Campo etiqueta="Nombre" icono={Building} value={f.name} onChange={set("name")} placeholder="G18, Lote 45, Torre B…" autoFocus={esAlta} tt={TT}
                            ayuda="Cómo se la nombra en el barrio y en el monitor. Ej.: «G18» o «Torre B - 4A»." />
                        <div className="grid grid-cols-2 gap-3">
                            <Campo etiqueta="Lote / parcela" icono={Hash} value={f.lot} onChange={set("lot")} placeholder="A-45" mono tt={TT} ayuda="Opcional. Ej.: A-45." />
                            <Campo etiqueta="N° casa / puerta" icono={Home} value={f.houseNumber} onChange={set("houseNumber")} placeholder="154" tt={TT} ayuda="Opcional. Ej.: 154." />
                        </div>
                        {f.type === "EDIFICIO" && <Campo etiqueta="Pisos" icono={Layers} tipo="number" value={f.floors} onChange={set("floors")} placeholder="10" tt={TT} />}
                        {f.type === "CASA" && complejos.length > 0 && (
                            <label className="block">
                                <Etiqueta texto="Pertenece a" ayuda="El barrio o edificio del que forma parte. Vacío = unidad suelta." tt={TT} />
                                <span className="relative block">
                                    <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                    <select value={f.parentId} onChange={(e) => set("parentId")(e.target.value)}
                                        className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-[var(--accion)]">
                                        <option value="">Ninguno</option>
                                        {complejos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </span>
                            </label>
                        )}
                    </Bloque>
                    <Bloque titulo="Contacto" icono={UserCircle} tt={TT} ayuda="Propietario o administración. Lo usa la guardia para avisar.">
                        <Campo etiqueta="Persona de contacto" icono={UserCircle} value={f.contactName} onChange={set("contactName")} placeholder="Nombre y apellido" tt={TT} />
                        <div className="grid grid-cols-2 gap-3">
                            <Campo etiqueta="Teléfono / WhatsApp" icono={Phone} value={f.adminPhone} onChange={set("adminPhone")} placeholder="+598 99 123 456" tt={TT} ayuda="Con código de país. Ej.: +598 99 123 456." />
                            <Campo etiqueta="Email" icono={Mail} tipo="email" value={f.contactEmail} onChange={set("contactEmail")} placeholder="nombre@correo.com" tt={TT} />
                        </div>
                    </Bloque>
                </>)}

                {tab === "ubicacion" && (
                    <Bloque titulo="Ubicación" icono={Navigation} tt={TT} ayuda="Dirección escrita y el punto en el mapa (tocá el mapa para moverlo).">
                        <Campo etiqueta="Dirección" icono={MapPin} value={f.address} onChange={set("address")} placeholder="Calle, número, ciudad" tt={TT} />
                        <div className="rounded-xl overflow-hidden border border-border h-[360px]">
                            <LocationPicker coords={f.coordinates} onChange={set("coordinates")} fullScreen />
                        </div>
                        <p className="text-[11px] text-muted-foreground font-mono">{f.coordinates}</p>
                    </Bloque>
                )}

                {tab === "residentes" && unidad && (
                    <Bloque titulo="Residentes" icono={Users} tt={TT} ayuda="Quiénes viven acá. Sus matrículas y tags pasan con los permisos de la unidad."
                        accion={!vinculando && <Button size="sm" onClick={() => setVinculando(true)} className="h-8 gap-1.5"><UserPlus size={14} /> Vincular</Button>}>
                        {vinculando && (
                            <div className="rounded-xl border border-[var(--accion)]/50 overflow-hidden">
                                <div className="flex items-center gap-2 p-2 border-b border-border bg-card/50">
                                    <span className="relative flex-1">
                                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <input autoFocus value={qPersona} onChange={(e) => setQPersona(e.target.value)} placeholder="Buscar persona sin unidad. Ej.: Pérez"
                                            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-[12.5px] outline-none focus:border-[var(--accion)]" />
                                    </span>
                                    <button type="button" onClick={() => setVinculando(false)} className="h-8 w-8 grid place-items-center rounded-md hover:bg-accent"><X size={15} /></button>
                                </div>
                                <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
                                    {libres.length === 0 && <p className="p-4 text-center text-[12px] text-muted-foreground">No hay personas sin unidad{qPersona ? " con ese nombre" : ""}.</p>}
                                    {libres.map((u) => (
                                        <button key={u.id} type="button" onClick={() => vincular(u)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/50">
                                            <Avatar nombre={u.name} />
                                            <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold truncate">{u.name}</span><span className="block text-[11px] text-muted-foreground truncate">{[u.phone, u.email].filter(Boolean).join(" · ") || "—"}</span></span>
                                            <Plus size={15} className="text-[var(--accion)]" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="rounded-xl border border-border divide-y divide-border/50 overflow-hidden">
                            {personas.length === 0 && <p className="p-6 text-center text-[12.5px] text-muted-foreground">Sin residentes vinculados.</p>}
                            {personas.map((u) => (
                                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                                    <Avatar nombre={u.name} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[13px] font-semibold truncate">{u.name}</span>
                                            {u.credentials?.some((c: any) => c.type === "FACE") && <ScanFace size={12} className="text-emerald-500" />}
                                            {u.credentials?.some((c: any) => c.type === "TAG") && <IdCard size={12} className="text-amber-500" />}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                            <span className="text-[10.5px] text-muted-foreground uppercase">{u.role}</span>
                                            {(u.vehicles || []).map((v: any) => <span key={v.plate} className="text-[10px] font-mono font-bold text-blue-500 bg-blue-500/10 px-1.5 rounded">{v.plate}</span>)}
                                        </div>
                                    </div>
                                    <button type="button" onClick={() => window.open(`/admin/users?q=${encodeURIComponent(u.name)}`, "_blank")} data-tooltip-id={TT} data-tooltip-content="Abrir su ficha" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><ExternalLink size={14} /></button>
                                    <button type="button" onClick={() => desvincular(u)} data-tooltip-id={TT} data-tooltip-content="Desvincular de esta unidad" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10"><X size={14} /></button>
                                </div>
                            ))}
                        </div>
                    </Bloque>
                )}

                {tab === "vehiculos" && (
                    <Bloque titulo="Vehículos" icono={Car} tt={TT} ayuda="Las matrículas de los residentes de la unidad. Se cargan desde la ficha de cada persona.">
                        {matriculas.length === 0 ? <p className="p-6 text-center text-[12.5px] text-muted-foreground rounded-xl border border-dashed border-border">Sin matrículas registradas.</p> : (
                            <div className="grid grid-cols-2 gap-2">
                                {matriculas.map((m) => (
                                    <div key={m.plate} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                                        <span className="px-2 py-1 rounded-md bg-white text-black font-mono font-black tracking-[0.12em] text-[14px] border-t-[3px] border-blue-700 shadow-sm">{m.plate}</span>
                                        <span className="text-[11.5px] text-muted-foreground truncate">{m.quien}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Bloque>
                )}

                {tab === "unidades" && unidad && (<>
                    <Bloque titulo="Generación masiva" icono={Wand2} tt={TT} ayuda="Crea varias sub-unidades de una vez. «A-Z, 13» genera de A01 a Z13.">
                        <div className="flex items-end gap-2">
                            <Campo etiqueta="Patrón" icono={Wand2} value={patron} onChange={setPatron} placeholder="A-Z, 13" mono mayus className="flex-1" tt={TT} />
                            <Button onClick={generar} disabled={generando} className="h-10 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white">{generando ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />} Generar</Button>
                        </div>
                    </Bloque>
                    <Bloque titulo="Sub-unidades" icono={LayoutGrid} tt={TT}
                        accion={<Button size="sm" variant="outline" onClick={() => onNuevaHija(unidad.id)} className="h-8 gap-1.5"><Plus size={14} /> Nueva</Button>}>
                        <div className="rounded-xl border border-border divide-y divide-border/50 overflow-hidden max-h-[420px] overflow-y-auto">
                            {hijas.length === 0 && <p className="p-6 text-center text-[12.5px] text-muted-foreground">Sin sub-unidades.</p>}
                            {hijas.map((h) => (
                                <div key={h.id} className="flex items-center gap-3 px-3 py-2">
                                    <span className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-500 grid place-items-center"><Home size={14} /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-[13px] font-semibold truncate">{h.name}</span>
                                        <span className="block text-[11px] text-muted-foreground truncate">{[h.lot && `Lote ${h.lot}`, h.houseNumber && `N° ${h.houseNumber}`].filter(Boolean).join(" · ") || "—"}</span>
                                    </span>
                                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md", h.users?.length ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground")}>{h.users?.length ? `${h.users.length} pers.` : "Libre"}</span>
                                </div>
                            ))}
                        </div>
                    </Bloque>
                </>)}
                <Tooltip id={TT} place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}

function Avatar({ nombre }: { nombre: string }) {
    return <span className="h-8 w-8 shrink-0 rounded-full bg-indigo-500/10 text-indigo-500 grid place-items-center text-[11.5px] font-bold">{String(nombre || "?").split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}</span>;
}
