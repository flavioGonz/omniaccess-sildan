"use client";
import { createPortal } from "react-dom";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import {
    ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Trash2, Layers, Inbox, Car, Radar, HardDrive, Cpu,
    Eye, EyeOff, ChevronsDownUp, ChevronsUpDown, GripVertical, Check, X, Palette, MousePointerClick, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { crearArea, editarArea, borrarArea, moverArea, asignarEquipos, type Area, type EstadoAreas } from "@/app/actions/areas";

/**
 * Árbol de áreas para agrupar equipos. Todo por arrastrar y soltar:
 *  - un equipo (desde la tabla o desde el árbol) sobre un área → queda en esa área;
 *  - un equipo sobre «Sin área» → sale de toda área;
 *  - un área sobre otra → pasa a ser sub-área; sobre el borde superior/inferior → se reordena;
 *  - un área sobre «Todas» → vuelve a la raíz.
 * Elegir un nodo filtra la tabla (el área y todas sus sub-áreas).
 */

export const MIME_EQUIPOS = "application/x-omni-equipos";
const MIME_AREA = "application/x-omni-area";
export const SIN_AREA = "__sin__";
export const TODAS = "__todas__";
const COLORES = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6"];

export const ICONO_TIPO: Record<string, { I: any; c: string; t: string }> = {
    LPR_CAMERA: { I: Car, c: "text-amber-500", t: "Cámara LPR" },
    CAMERA: { I: Radar, c: "text-red-500", t: "Cámara de intrusión" },
    NVR: { I: HardDrive, c: "text-sky-500", t: "NVR" },
};
export function IconoTipo({ tipo, size = 13, className }: { tipo: string; size?: number; className?: string }) {
    const m = ICONO_TIPO[tipo] || { I: Cpu, c: "text-muted-foreground", t: tipo };
    return <m.I size={size} className={cn(m.c, className)} />;
}

/** Arranca el arrastre de uno o más equipos, con una «pastilla» como imagen de arrastre. */
export function arrastrarEquipos(e: React.DragEvent, ids: string[], etiqueta: string) {
    e.dataTransfer.setData(MIME_EQUIPOS, JSON.stringify(ids));
    e.dataTransfer.setData("text/plain", etiqueta);
    e.dataTransfer.effectAllowed = "move";
    try {
        const p = document.createElement("div");
        p.textContent = ids.length > 1 ? `${ids.length} equipos` : etiqueta;
        p.style.cssText = "position:fixed;top:-100px;left:-100px;padding:6px 12px;border-radius:999px;background:#4f46e5;color:#fff;font:600 12px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35);white-space:nowrap";
        document.body.appendChild(p);
        e.dataTransfer.setDragImage(p, 12, 14);
        setTimeout(() => p.remove(), 0);
    } catch { }
}

/** ¿El equipo está en `areaId` o en alguna de sus sub-áreas? */
export function enArea(estado: EstadoAreas, deviceId: string, areaId: string): boolean {
    if (areaId === TODAS) return true;
    const a = estado.equipos[deviceId];
    if (areaId === SIN_AREA) return !a || !estado.areas.some((x) => x.id === a);
    let cur: string | null | undefined = a;
    for (let i = 0; cur && i < 100; i++) { if (cur === areaId) return true; cur = estado.areas.find((x) => x.id === cur)?.padre; }
    return false;
}

type Zona = "antes" | "dentro" | "despues";

export function ArbolAreas({ estado, setEstado, devices, tiposVisibles, tipoActual, seleccion, onSeleccion, onAbrirEquipo, health = {}, alertasDe = {}, tipos = [], onTipo, colapsado = false, onColapsar }: {
    estado: EstadoAreas; setEstado: (e: EstadoAreas) => void; devices: any[]; tiposVisibles: string[]; tipoActual: string;
    seleccion: string; onSeleccion: (id: string) => void; onAbrirEquipo?: (d: any) => void; health?: Record<string, any>; alertasDe?: Record<string, any[]>;
    /** Filtros por tipo de equipo (debajo de las áreas). */
    tipos?: { tipo: string; rotulo: string; cuenta: number; alertas?: number }[]; onTipo?: (t: string) => void;
    colapsado?: boolean; onColapsar?: (v: boolean) => void;
}) {
    const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
    const [verEquipos, setVerEquipos] = useState(true);
    const [editando, setEditando] = useState<string | null>(null);
    const [borrando, setBorrando] = useState<string | null>(null);
    const [paleta, setPaleta] = useState<string | null>(null);
    const [sobre, setSobre] = useState<{ id: string; zona: Zona } | null>(null);
    const arrastrandoArea = useRef<string | null>(null);

    useEffect(() => { try { const v = JSON.parse(localStorage.getItem("areas.abiertas") || "[]"); setAbiertas(new Set(v)); setVerEquipos(localStorage.getItem("areas.verEquipos") !== "0"); } catch { } }, []);
    const guardarAbiertas = (s: Set<string>) => { setAbiertas(s); try { localStorage.setItem("areas.abiertas", JSON.stringify([...s])); } catch { } };
    const alternar = (id: string) => { const s = new Set(abiertas); s.has(id) ? s.delete(id) : s.add(id); guardarAbiertas(s); };

    const visibles = useMemo(() => devices.filter((d) => tiposVisibles.includes(d.deviceType)), [devices, tiposVisibles]);
    const hijas = (padre: string | null) => estado.areas.filter((a) => a.padre === padre).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
    const equiposDe = (areaId: string) => visibles.filter((d) => estado.equipos[d.id] === areaId).sort((a, b) => a.name.localeCompare(b.name));
    const sinArea = visibles.filter((d) => enArea(estado, d.id, SIN_AREA));
    const contar = (areaId: string) => visibles.filter((d) => d.deviceType === tipoActual && enArea(estado, d.id, areaId)).length;

    const ejecutar = async (p: Promise<EstadoAreas>, ok?: string) => {
        try { const e = await p; setEstado(e); if (ok) toast.success({ title: ok }); }
        catch (e: any) { toast.error({ title: "No se pudo", description: e?.message }); }
    };
    const nueva = async (padre: string | null) => {
        try {
            const e = await crearArea(padre ? "Nueva sub-área" : "Nueva área", padre);
            setEstado(e);
            const creada = e.areas[e.areas.length - 1];
            if (padre) guardarAbiertas(new Set([...abiertas, padre]));
            setEditando(creada.id);
        } catch (er: any) { toast.error({ title: "No se pudo crear", description: er?.message }); }
    };

    const zonaDe = (ev: React.DragEvent, esArea: boolean): Zona => {
        if (!esArea || !arrastrandoArea.current) return "dentro";
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        const y = ev.clientY - r.top;
        return y < r.height * 0.28 ? "antes" : y > r.height * 0.72 ? "despues" : "dentro";
    };
    const aceptar = (ev: React.DragEvent) => ev.dataTransfer.types.includes(MIME_EQUIPOS) || ev.dataTransfer.types.includes(MIME_AREA);

    const soltar = async (ev: React.DragEvent, destino: string) => {
        ev.preventDefault();
        const zona = sobre?.zona || "dentro";
        setSobre(null);
        const eqs = ev.dataTransfer.getData(MIME_EQUIPOS);
        const area = ev.dataTransfer.getData(MIME_AREA);
        arrastrandoArea.current = null;
        if (eqs) {
            const ids: string[] = JSON.parse(eqs);
            const dest = destino === SIN_AREA || destino === TODAS ? null : destino;
            const nombre = dest ? estado.areas.find((a) => a.id === dest)?.nombre : null;
            await ejecutar(asignarEquipos(ids, dest), dest ? `${ids.length > 1 ? `${ids.length} equipos` : "Equipo"} en «${nombre}»` : "Equipo sin área");
            if (dest) guardarAbiertas(new Set([...abiertas, dest]));
            return;
        }
        if (area && area !== destino) {
            if (destino === TODAS || destino === SIN_AREA) { await ejecutar(moverArea(area, null)); return; }
            const d = estado.areas.find((a) => a.id === destino);
            if (!d) return;
            if (zona === "dentro") { await ejecutar(moverArea(area, destino)); guardarAbiertas(new Set([...abiertas, destino])); }
            else {
                const herm = hijas(d.padre).filter((h) => h.id !== area);
                const i = herm.findIndex((h) => h.id === destino);
                await ejecutar(moverArea(area, d.padre, zona === "antes" ? i : i + 1));
            }
        }
    };

    const props = (id: string, esArea: boolean) => ({
        onDragOver: (ev: React.DragEvent) => { if (!aceptar(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; const z = zonaDe(ev, esArea); if (sobre?.id !== id || sobre.zona !== z) setSobre({ id, zona: z }); },
        onDragLeave: (ev: React.DragEvent) => { if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) setSobre((s) => (s?.id === id ? null : s)); },
        onDrop: (ev: React.DragEvent) => soltar(ev, id),
    });

    const fila = (a: Area, nivel: number): React.ReactNode => {
        const sub = hijas(a.id);
        const eqs = verEquipos ? equiposDe(a.id) : [];
        const abierta = abiertas.has(a.id);
        const tieneHijos = sub.length > 0 || eqs.length > 0;
        const sel = seleccion === a.id;
        const z = sobre?.id === a.id ? sobre.zona : null;
        return (
            <div>
                <div {...props(a.id, true)}
                    draggable={editando !== a.id}
                    onDragStart={(ev) => { arrastrandoArea.current = a.id; ev.dataTransfer.setData(MIME_AREA, a.id); ev.dataTransfer.effectAllowed = "move"; ev.stopPropagation(); }}
                    onDragEnd={() => { arrastrandoArea.current = null; setSobre(null); }}
                    onClick={() => onSeleccion(a.id)}
                    className={cn("group relative flex items-center gap-1.5 h-8 pr-1.5 rounded-lg cursor-pointer select-none transition-colors",
                        sel ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-foreground" : "hover:bg-accent/70 text-foreground/90",
                        z === "dentro" && "ring-2 ring-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]")}
                    style={{ paddingLeft: 6 + nivel * 14 }}>
                    {z === "antes" && <span className="absolute left-2 right-2 -top-px h-0.5 rounded bg-[var(--accion)]" />}
                    {z === "despues" && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded bg-[var(--accion)]" />}
                    <button type="button" onClick={(e) => { e.stopPropagation(); alternar(a.id); }} className={cn("h-5 w-5 grid place-items-center rounded text-muted-foreground hover:text-foreground", !tieneHijos && "invisible")}>
                        <ChevronRight size={13} className={cn("transition-transform duration-200", abierta && "rotate-90")} />
                    </button>
                    {abierta ? <FolderOpen size={15} style={{ color: a.color }} className="shrink-0" /> : <Folder size={15} style={{ color: a.color }} className="shrink-0" fill={a.color} fillOpacity={0.18} />}
                    {editando === a.id ? (
                        <NombreEditable inicial={a.nombre} onListo={(n) => { setEditando(null); if (n && n !== a.nombre) ejecutar(editarArea(a.id, { nombre: n })); }} />
                    ) : (
                        <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold" onDoubleClick={(e) => { e.stopPropagation(); setEditando(a.id); }}>{a.nombre}</span>
                    )}
                    {borrando === a.id ? (
                        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10.5px] text-red-500 font-semibold">¿Borrar?</span>
                            <button type="button" onClick={() => { setBorrando(null); ejecutar(borrarArea(a.id), "Área borrada: sus equipos pasaron al área de arriba"); if (seleccion === a.id) onSeleccion(TODAS); }} className="h-6 w-6 grid place-items-center rounded bg-red-500 text-white"><Check size={12} /></button>
                            <button type="button" onClick={() => setBorrando(null)} className="h-6 w-6 grid place-items-center rounded hover:bg-accent"><X size={12} /></button>
                        </span>
                    ) : (
                        <>
                            <span className="hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                <button type="button" onClick={() => nueva(a.id)} data-tooltip-id="tt-areas" data-tooltip-content="Nueva sub-área" className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-background"><FolderPlus size={12.5} /></button>
                                <button type="button" onClick={() => setEditando(a.id)} data-tooltip-id="tt-areas" data-tooltip-content="Renombrar (o doble clic)" className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-background"><Pencil size={12} /></button>
                                <button type="button" onClick={() => setPaleta(paleta === a.id ? null : a.id)} data-tooltip-id="tt-areas" data-tooltip-content="Color" className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-background"><Palette size={12} /></button>
                                <button type="button" onClick={() => setBorrando(a.id)} data-tooltip-id="tt-areas" data-tooltip-content="Borrar el área (los equipos no se borran: suben al área de arriba)" className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-red-500 hover:bg-background"><Trash2 size={12} /></button>
                            </span>
                            <span className="min-w-[22px] h-[18px] px-1.5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground grid place-items-center tabular-nums group-hover:hidden">{contar(a.id)}</span>
                        </>
                    )}
                </div>
                <AnimatePresence initial={false}>
                    {paleta === a.id && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="flex gap-1.5 py-1.5" style={{ paddingLeft: 30 + nivel * 14 }}>
                                {COLORES.map((c) => <button key={c} type="button" onClick={() => { setPaleta(null); ejecutar(editarArea(a.id, { color: c })); }} className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-background", a.color === c && "ring-2 ring-foreground/40")} style={{ background: c }} />)}
                            </div>
                        </motion.div>
                    )}
                    {abierta && tieneHijos && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden relative">
                            <span className="absolute top-0 bottom-1 w-px bg-border" style={{ left: 15 + nivel * 14 }} />
                            {sub.map((h) => <Fragment key={h.id}>{fila(h, nivel + 1)}</Fragment>)}
                            {eqs.map((d) => <Fragment key={d.id}>{hoja(d, nivel + 1)}</Fragment>)}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        );
    };

    const hoja = (d: any, nivel: number): React.ReactNode => {
        const h = health[d.id]; const mal = !!alertasDe[d.id]?.length || h?.reachable === false;
        return (
            <div draggable onDragStart={(ev) => { ev.stopPropagation(); arrastrarEquipos(ev, [d.id], d.name); }}
                onClick={() => onAbrirEquipo?.(d)}
                data-tooltip-id="tt-areas" data-tooltip-content={`${ICONO_TIPO[d.deviceType]?.t || d.deviceType} · ${d.ip}. Arrastralo a otra área; clic para editar.`}
                className={cn("group flex items-center gap-1.5 h-7 pr-2 rounded-md cursor-grab active:cursor-grabbing hover:bg-accent/60", d.deviceType !== tipoActual && "opacity-60")}
                style={{ paddingLeft: 26 + nivel * 14 }}>
                <GripVertical size={11} className="text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 -ml-3.5" />
                <IconoTipo tipo={d.deviceType} size={12.5} className="shrink-0" />
                <span className={cn("flex-1 min-w-0 truncate text-[12px]", mal ? "text-red-500 font-semibold" : "text-foreground/85")}>{d.name}</span>
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", h ? (h.reachable ? "bg-emerald-500" : "bg-red-500") : "bg-muted-foreground/30")} />
            </div>
        );
    };

    const raiz = (id: string, I: any, titulo: string, cuenta: number, ayuda: string): React.ReactNode => {
        const z = sobre?.id === id;
        return (
            <div {...props(id, false)} onClick={() => onSeleccion(id)} data-tooltip-id="tt-areas" data-tooltip-content={ayuda}
                className={cn("flex items-center gap-2 h-8 px-2.5 rounded-lg cursor-pointer select-none transition-colors",
                    seleccion === id ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)]" : "hover:bg-accent/70",
                    z && "ring-2 ring-[var(--accion)]")}>
                <I size={15} className="text-muted-foreground shrink-0" />
                <span className="flex-1 text-[12.5px] font-semibold">{titulo}</span>
                <span className="min-w-[22px] h-[18px] px-1.5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground grid place-items-center tabular-nums">{cuenta}</span>
            </div>
        );
    };

    const raices = hijas(null);
    const todasAbiertas = estado.areas.length > 0 && estado.areas.every((a) => abiertas.has(a.id));
    const filtros = tipos.length > 0 && (
        <div className="p-2 border-t border-border/60 space-y-1">
            <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Tipo de equipo</div>
            {tipos.map((t) => {
                const activo = t.tipo === tipoActual; const m = ICONO_TIPO[t.tipo];
                return (
                    <button key={t.tipo} type="button" onClick={() => onTipo?.(t.tipo)}
                        className={cn("w-full flex items-center gap-2.5 h-10 px-2.5 rounded-lg border transition-all text-left",
                            activo ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)] shadow-sm" : "border-transparent hover:bg-accent/70")}>
                        <span className={cn("h-7 w-7 rounded-md grid place-items-center", activo ? "bg-background shadow-sm" : "bg-muted/60")}><IconoTipo tipo={t.tipo} size={15} /></span>
                        <span className={cn("flex-1 text-[12.5px]", activo ? "font-bold" : "font-semibold text-foreground/85")}>{t.rotulo}</span>
                        {!!t.alertas && <span className="h-[18px] px-1.5 rounded-full bg-red-500/15 text-red-500 text-[10px] font-bold grid place-items-center tabular-nums" data-tooltip-id="tt-areas" data-tooltip-content={`${t.alertas} con alertas`}>{t.alertas}</span>}
                        <span className={cn("min-w-[24px] h-[20px] px-1.5 rounded-full text-[10.5px] font-bold grid place-items-center tabular-nums", activo ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}>{t.cuenta}</span>
                    </button>
                );
            })}
        </div>
    );

    if (colapsado) return (
        <aside className="w-[52px] shrink-0 rounded-xl border border-border/60 bg-card/50 flex flex-col items-center py-2 gap-1 sticky top-4">
            <button type="button" onClick={() => onColapsar?.(false)} data-tooltip-id="tt-areas" data-tooltip-content="Mostrar áreas y filtros"
                className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"><PanelLeftOpen size={17} /></button>
            <span className="w-6 h-px bg-border my-1" />
            {tipos.map((t) => (
                <button key={t.tipo} type="button" onClick={() => onTipo?.(t.tipo)} data-tooltip-id="tt-areas" data-tooltip-content={`${t.rotulo} (${t.cuenta})`}
                    className={cn("relative h-9 w-9 grid place-items-center rounded-lg transition-colors", t.tipo === tipoActual ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] ring-1 ring-[var(--accion)]" : "hover:bg-accent")}>
                    <IconoTipo tipo={t.tipo} size={16} />
                    {!!t.alertas && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />}
                </button>
            ))}
            <span className="w-6 h-px bg-border my-1" />
            {estado.areas.filter((a) => !a.padre).sort((a, b) => a.orden - b.orden).slice(0, 12).map((a) => (
                <button key={a.id} type="button" onClick={() => onSeleccion(seleccion === a.id ? TODAS : a.id)} data-tooltip-id="tt-areas" data-tooltip-content={a.nombre}
                    className={cn("h-8 w-8 grid place-items-center rounded-lg", seleccion === a.id ? "bg-accent ring-1 ring-border" : "hover:bg-accent/70")}>
                    <Folder size={15} style={{ color: a.color }} fill={a.color} fillOpacity={0.2} />
                </button>
            ))}
            <TooltipAreas />
        </aside>
    );

    return (
        <aside className="w-[272px] shrink-0 rounded-xl border border-border/60 bg-card/50 flex flex-col max-h-[calc(100vh-190px)] sticky top-4">
            <div className="flex items-center gap-1 px-3 h-11 border-b border-border/60">
                <Layers size={15} className="text-indigo-400" />
                <span className="text-[13px] font-bold flex-1">Áreas</span>
                <button type="button" onClick={() => { const v = !verEquipos; setVerEquipos(v); try { localStorage.setItem("areas.verEquipos", v ? "1" : "0"); } catch { } }}
                    data-tooltip-id="tt-areas" data-tooltip-content={verEquipos ? "Ocultar los equipos dentro del árbol" : "Mostrar los equipos dentro del árbol"}
                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">{verEquipos ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <button type="button" onClick={() => guardarAbiertas(todasAbiertas ? new Set() : new Set(estado.areas.map((a) => a.id)))}
                    data-tooltip-id="tt-areas" data-tooltip-content={todasAbiertas ? "Plegar todo" : "Desplegar todo"}
                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">{todasAbiertas ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}</button>
                <button type="button" onClick={() => onColapsar?.(true)} data-tooltip-id="tt-areas" data-tooltip-content="Contraer el panel para darle más lugar a la tabla"
                    className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><PanelLeftClose size={14} /></button>
                <button type="button" onClick={() => nueva(null)} data-tooltip-id="tt-areas" data-tooltip-content="Nueva área. Ej.: «Portería», «Perímetro Norte», «Club House»."
                    className="h-7 px-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold inline-flex items-center gap-1"><FolderPlus size={13} /> Nueva</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
                {raiz(TODAS, Layers, "Todas", visibles.filter((d) => d.deviceType === tipoActual).length, "Todos los equipos. Soltá un área acá para llevarla a la raíz.")}
                {raices.map((a) => <Fragment key={a.id}>{fila(a, 0)}</Fragment>)}
                {estado.areas.length === 0 && (
                    <div className="mx-1 my-2 rounded-lg border border-dashed border-border p-3 text-center space-y-1.5">
                        <MousePointerClick size={18} className="mx-auto text-muted-foreground" />
                        <p className="text-[11.5px] text-muted-foreground leading-snug">Creá áreas (Portería, Perímetro Norte…) y arrastrá los equipos desde la tabla para agruparlos.</p>
                    </div>
                )}
                <div className="pt-1 mt-1 border-t border-border/50">
                    {raiz(SIN_AREA, Inbox, "Sin área", sinArea.filter((d) => d.deviceType === tipoActual).length, "Equipos que todavía no están en ningún área. Soltá un equipo acá para sacarlo de su área.")}
                    {verEquipos && seleccion === SIN_AREA && sinArea.slice(0, 200).map((d) => <Fragment key={d.id}>{hoja(d, 0)}</Fragment>)}
                </div>
            </div>
            {filtros}
            <div className="px-3 py-2 border-t border-border/60 text-[10.5px] text-muted-foreground flex items-center gap-1.5"><GripVertical size={12} /> Arrastrá equipos y áreas para reorganizar</div>
            <TooltipAreas />
        </aside>
    );
}

function NombreEditable({ inicial, onListo }: { inicial: string; onListo: (n: string | null) => void }) {
    const [v, setV] = useState(inicial);
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
    return (
        <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") onListo(v.trim()); if (e.key === "Escape") onListo(null); }}
            onBlur={() => onListo(v.trim())}
            className="flex-1 min-w-0 h-6 rounded-md border border-[var(--accion)] bg-background px-1.5 text-[12.5px] font-semibold outline-none" />
    );
}


/**
 * El tooltip del árbol va al <body>: el panel de áreas es sticky y arma su propio contexto de
 * apilado, así que montado adentro quedaba por detrás de la tabla de la derecha.
 */
function TooltipAreas() {
    const [listo, setListo] = useState(false);
    useEffect(() => setListo(true), []);
    if (!listo) return null;
    return createPortal(<Tooltip id="tt-areas" place="right" positionStrategy="fixed" className="!max-w-[260px] !text-[12px] !rounded-lg !z-[9999]" />, document.body);
}
