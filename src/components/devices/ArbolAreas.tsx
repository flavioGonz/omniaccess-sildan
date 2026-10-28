"use client";
import { createPortal } from "react-dom";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import {
    ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Trash2, Layers, Inbox, Car, Radar, HardDrive, Cpu,
    Eye, EyeOff, ChevronsDownUp, ChevronsUpDown, GripVertical, Check, X, Palette, MousePointerClick, PanelLeftClose, PanelLeftOpen,
    Power, PowerOff, Loader2, ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
/** Igual que en lib/apagado (no se importa de ahí: ese archivo usa la base y esto corre en el navegador). */
const APAGADO_SIN_AREA = "__sin_area";
import { sileo as toast } from "sileo";
import { crearArea, editarArea, borrarArea, moverArea, asignarEquipos, apagarGrupo, type Area, type EstadoAreas } from "@/app/actions/areas";

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
/** `tipoActual` cuando no hay un tipo elegido: el árbol cuenta todos los equipos. */
export const TODOS_LOS_TIPOS = "*";

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
    /** Lo que se está por apagar o prender (área, «Sin área» o tipo), esperando la confirmación. */
    const [pidiendo, setPidiendo] = useState<{ clave: string; titulo: string; apagar: boolean } | null>(null);
    const [aplicando, setAplicando] = useState(false);
    const apagadas = useMemo(() => new Set(estado.apagadas || []), [estado.apagadas]);
    /** El área de arriba que está apagada (si la hay): las de abajo quedan apagadas con ella. */
    const apagadaPorArriba = (areaId: string): Area | null => {
        let cur = estado.areas.find((x) => x.id === areaId)?.padre;
        for (let i = 0; cur && i < 100; i++) { if (apagadas.has(cur)) return estado.areas.find((x) => x.id === cur) || null; cur = estado.areas.find((x) => x.id === cur)?.padre; }
        return null;
    };
    const esVista = (d: any, t: string) => d.deviceType === t || (t === "LPR_CAMERA" && d.deviceType === "LPR_INTERIOR" && !!d.trackAcceso);
    const afectados = (clave: string): any[] => clave.startsWith("tipo:") ? devices.filter((d) => esVista(d, clave.slice(5))) : devices.filter((d) => enArea(estado, d.id, clave === APAGADO_SIN_AREA ? SIN_AREA : clave));
    const confirmar = async () => {
        if (!pidiendo) return;
        setAplicando(true);
        try {
            const r = await apagarGrupo(pidiendo.clave, pidiendo.apagar);
            const { resumen, ...e } = r;
            setEstado(e);
            toast.success({ title: pidiendo.apagar ? `«${pidiendo.titulo}» apagada` : `«${pidiendo.titulo}» activa de nuevo`, description: `${resumen.cambiaron} ${resumen.cambiaron === 1 ? "equipo" : "equipos"} ${pidiendo.apagar ? "dejaron de consumirse" : "vuelven a consumirse"}` });
            setPidiendo(null);
        } catch (er: any) { toast.error({ title: "No se pudo", description: er?.message }); }
        finally { setAplicando(false); }
    };

    useEffect(() => { try { const v = JSON.parse(localStorage.getItem("areas.abiertas") || "[]"); setAbiertas(new Set(v)); setVerEquipos(localStorage.getItem("areas.verEquipos") !== "0"); } catch { } }, []);
    const guardarAbiertas = (s: Set<string>) => { setAbiertas(s); try { localStorage.setItem("areas.abiertas", JSON.stringify([...s])); } catch { } };
    const alternar = (id: string) => { const s = new Set(abiertas); s.has(id) ? s.delete(id) : s.add(id); guardarAbiertas(s); };

    const visibles = useMemo(() => devices.filter((d) => tiposVisibles.includes(d.deviceType)), [devices, tiposVisibles]);
    const hijas = (padre: string | null) => estado.areas.filter((a) => a.padre === padre).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
    const equiposDe = (areaId: string) => visibles.filter((d) => estado.equipos[d.id] === areaId).sort((a, b) => a.name.localeCompare(b.name));
    const sinArea = visibles.filter((d) => enArea(estado, d.id, SIN_AREA));
    /** ¿El equipo entra en el tipo elegido? Sin tipo elegido (TODOS_LOS_TIPOS), todos. */
    const deTipo = (d: any) => tipoActual === TODOS_LOS_TIPOS || d.deviceType === tipoActual;
    const contar = (areaId: string) => visibles.filter((d) => deTipo(d) && enArea(estado, d.id, areaId)).length;

    const ejecutar = async (p: Promise<EstadoAreas>, ok?: string) => {
        try { const e = await p; setEstado(e); if (ok) toast.success({ title: ok }); }
        catch (e: any) {
            // Pantalla abierta desde antes de un despliegue: la acción ya no existe en el servidor.
            // Decirlo y recargar, en vez de un «No se pudo» que no explica nada (22/10).
            if (/Failed to find Server Action|older or newer deployment|was not found on the server/i.test(String(e?.message))) {
                toast.error({ title: "Hay una versión nueva del panel", description: "Recargando la página: volvé a arrastrarlo." });
                setTimeout(() => window.location.reload(), 1200);
                return;
            }
            toast.error({ title: "No se pudo", description: e?.message });
        }
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
        const arriba = apagadaPorArriba(a.id);
        const apagada = apagadas.has(a.id) || !!arriba;
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
                    {abierta ? <FolderOpen size={15} style={{ color: apagada ? undefined : a.color }} className={cn("shrink-0", apagada && "text-muted-foreground/60")} /> : <Folder size={15} style={{ color: apagada ? undefined : a.color }} className={cn("shrink-0", apagada && "text-muted-foreground/60")} fill={apagada ? "none" : a.color} fillOpacity={0.18} />}
                    {editando === a.id ? (
                        <NombreEditable inicial={a.nombre} onListo={(n) => { setEditando(null); if (n && n !== a.nombre) ejecutar(editarArea(a.id, { nombre: n })); }} />
                    ) : (
                        <span className={cn("flex-1 min-w-0 truncate text-[12.5px] font-semibold", apagada && "text-muted-foreground")} onDoubleClick={(e) => { e.stopPropagation(); setEditando(a.id); }}>{a.nombre}</span>
                    )}
                    {/* Cuentas de los equipos gestionadas desde esta área (openspec usuarios-de-equipos). */}
                    {editando !== a.id && a.cuentas?.gestionada && <ShieldCheck size={12} className="tono-bien shrink-0" aria-label="Cuentas gestionadas" />}
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
                            <MiniInterruptor prendido={!apagada} bloqueado={!!arriba}
                                titulo={arriba ? `Apagada con «${arriba.nombre}»: se reactiva desde ahí` : apagada ? `Apagada: OmniAccess no consume sus equipos. Tocá para reactivarla.` : `Apagar «${a.nombre}»: OmniAccess deja de consumir sus equipos`}
                                onClick={() => setPidiendo({ clave: a.id, titulo: a.nombre, apagar: !apagadas.has(a.id) })} />
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
        const h = health[d.id]; const mal = !h?.apagado && (!!alertasDe[d.id]?.length || h?.reachable === false);
        return (
            <div draggable onDragStart={(ev) => { ev.stopPropagation(); arrastrarEquipos(ev, [d.id], d.name); }}
                onClick={() => onAbrirEquipo?.(d)}
                data-tooltip-id="tt-equipo" data-equipo-id={d.id} data-equipo-nombre={d.name} data-equipo-tipo={ICONO_TIPO[d.deviceType]?.t || d.deviceType}
                data-equipo-ip={d.ip || ""} data-equipo-foto={SIN_FOTO.has(d.deviceType) ? undefined : "1"}
                className={cn("group flex items-center gap-1.5 h-7 pr-2 rounded-md cursor-grab active:cursor-grabbing hover:bg-accent/60", (!deTipo(d) || h?.apagado) && "opacity-60")}
                style={{ paddingLeft: 26 + nivel * 14 }}>
                <GripVertical size={11} className="text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 -ml-3.5" />
                <IconoTipo tipo={d.deviceType} size={12.5} className="shrink-0" />
                <span className={cn("flex-1 min-w-0 truncate text-[12px]", mal ? "text-red-500 font-semibold" : "text-foreground/85")}>{d.name}</span>
                {h?.apagado ? <PowerOff size={10} className="text-muted-foreground shrink-0" /> : <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", h ? (h.reachable ? "bg-emerald-500" : "bg-red-500") : "bg-muted-foreground/30")} />}
            </div>
        );
    };

    const raiz = (id: string, I: any, titulo: string, cuenta: number, ayuda: string, claveApagado?: string): React.ReactNode => {
        const z = sobre?.id === id;
        const apagada = !!claveApagado && apagadas.has(claveApagado);
        return (
            <div {...props(id, false)} onClick={() => onSeleccion(id)} data-tooltip-id="tt-areas" data-tooltip-content={ayuda}
                className={cn("flex items-center gap-2 h-8 px-2.5 rounded-lg cursor-pointer select-none transition-colors",
                    seleccion === id ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)]" : "hover:bg-accent/70",
                    z && "ring-2 ring-[var(--accion)]")}>
                <I size={15} className="text-muted-foreground shrink-0" />
                <span className={cn("flex-1 text-[12.5px] font-semibold", apagada && "text-muted-foreground")}>{titulo}</span>
                <span className="min-w-[22px] h-[18px] px-1.5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground grid place-items-center tabular-nums">{cuenta}</span>
                {claveApagado && <MiniInterruptor prendido={!apagada} titulo={apagada ? `Apagado: OmniAccess no consume estos equipos. Tocá para reactivar.` : `Apagar «${titulo}»: OmniAccess deja de consumir estos equipos`}
                    onClick={() => setPidiendo({ clave: claveApagado, titulo, apagar: !apagada })} />}
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
                    <div key={t.tipo} role="button" tabIndex={0} onClick={() => onTipo?.(t.tipo)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTipo?.(t.tipo); } }}
                        className={cn("w-full flex items-center gap-2.5 h-10 px-2.5 rounded-lg border transition-all text-left cursor-pointer", apagadas.has(`tipo:${t.tipo}`) && "opacity-70",
                            activo ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)] shadow-sm" : "border-transparent hover:bg-accent/70")}>
                        <span className={cn("h-7 w-7 rounded-md grid place-items-center", activo ? "bg-background shadow-sm" : "bg-muted/60")}><IconoTipo tipo={t.tipo} size={15} /></span>
                        <span className={cn("flex-1 text-[12.5px]", activo ? "font-bold" : "font-semibold text-foreground/85")}>{t.rotulo}</span>
                        {!!t.alertas && <span className="h-[18px] px-1.5 rounded-full bg-red-500/15 text-red-500 text-[10px] font-bold grid place-items-center tabular-nums" data-tooltip-id="tt-areas" data-tooltip-content={`${t.alertas} con alertas`}>{t.alertas}</span>}
                        <span className={cn("min-w-[24px] h-[20px] px-1.5 rounded-full text-[10.5px] font-bold grid place-items-center tabular-nums", activo ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}>{t.cuenta}</span>
                        <MiniInterruptor prendido={!apagadas.has(`tipo:${t.tipo}`)}
                            titulo={apagadas.has(`tipo:${t.tipo}`) ? `Apagadas: OmniAccess no consume las ${t.rotulo.toLowerCase()}. Tocá para reactivar.` : `Apagar todas las ${t.rotulo.toLowerCase()}`}
                            onClick={() => setPidiendo({ clave: `tipo:${t.tipo}`, titulo: t.rotulo, apagar: !apagadas.has(`tipo:${t.tipo}`) })} />
                    </div>
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
                {raiz(TODAS, Layers, "Todas", visibles.filter(deTipo).length, "Todos los equipos. Soltá un área acá para llevarla a la raíz.")}
                {raices.map((a) => <Fragment key={a.id}>{fila(a, 0)}</Fragment>)}
                {estado.areas.length === 0 && (
                    <div className="mx-1 my-2 rounded-lg border border-dashed border-border p-3 text-center space-y-1.5">
                        <MousePointerClick size={18} className="mx-auto text-muted-foreground" />
                        <p className="text-[11.5px] text-muted-foreground leading-snug">Creá áreas (Portería, Perímetro Norte…) y arrastrá los equipos desde la tabla para agruparlos.</p>
                    </div>
                )}
                <div className="pt-1 mt-1 border-t border-border/50">
                    {raiz(SIN_AREA, Inbox, "Sin área", sinArea.filter(deTipo).length, "Equipos que todavía no están en ningún área. Soltá un equipo acá para sacarlo de su área.", APAGADO_SIN_AREA)}
                    {verEquipos && seleccion === SIN_AREA && sinArea.slice(0, 200).map((d) => <Fragment key={d.id}>{hoja(d, 0)}</Fragment>)}
                </div>
            </div>
            {filtros}
            <div className="px-3 py-2 border-t border-border/60 text-[10.5px] text-muted-foreground flex items-center gap-1.5"><GripVertical size={12} /> Arrastrá equipos y áreas para reorganizar</div>
            <ModalApagado pedido={pidiendo} equipos={pidiendo ? afectados(pidiendo.clave) : []} aplicando={aplicando} onConfirmar={confirmar} onCancelar={() => !aplicando && setPidiendo(null)} />
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
    return createPortal(<>
        <Tooltip id="tt-areas" place="right" positionStrategy="fixed" className="!max-w-[260px] !text-[12px] !rounded-lg !z-[9999]" />
        {/*
          * Un equipo del árbol, con su mini foto (22/10, Nico: «al pasar el mouse encima de un canal, debe
          * mostrar una mini foto»). Es la del momento (go2rtc, cada minuto como mucho: la URL cambia con
          * el minuto); un NVR o una central no tienen imagen y muestran sólo el texto. Si la cámara no
          * contesta, la foto no aparece y se dice.
          */}
        <Tooltip id="tt-equipo" place="right" positionStrategy="fixed" delayShow={180} className="!p-0 !rounded-lg !z-[9999] !opacity-100 overflow-hidden"
            render={({ activeAnchor }) => {
                const a = activeAnchor as HTMLElement | null;
                if (!a) return null;
                const id = a.dataset.equipoId, conFoto = a.dataset.equipoFoto === "1";
                return (
                    <div className="w-[260px] text-[12px]">
                        {conFoto && id && <FotoTooltip key={id} id={id} />}
                        <div className="px-3 py-2 leading-snug">
                            <div className="font-semibold truncate">{a.dataset.equipoNombre}</div>
                            <div className="opacity-75 tabular-nums">{a.dataset.equipoTipo}{a.dataset.equipoIp ? ` · ${a.dataset.equipoIp}` : ""}</div>
                            <div className="opacity-60 text-[11px] mt-0.5">Arrastralo a otra área; clic para editar.</div>
                        </div>
                    </div>
                );
            }} />
    </>, document.body);
}

/** Los tipos que no tienen una imagen que mostrar. */
const SIN_FOTO = new Set(["NVR", "ALARM_HUB", "QUEUE_COUNTER"]);

function FotoTooltip({ id }: { id: string }) {
    const [estado, setEstado] = useState<"cargando" | "ok" | "sin">("cargando");
    const minuto = Math.floor(Date.now() / 60_000);
    return (
        <div className="relative w-full aspect-video bg-black/80 grid place-items-center">
            {estado !== "sin" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={id} src={`/api/snapshot/${id}?w=320&t=${minuto}`} alt="" onLoad={() => setEstado("ok")} onError={() => setEstado("sin")}
                    className={cn("absolute inset-0 w-full h-full object-cover transition-opacity duration-200", estado === "ok" ? "opacity-100" : "opacity-0")} />
            )}
            {estado === "cargando" && <span className="text-[11px] text-white/60">Trayendo la imagen…</span>}
            {estado === "sin" && <span className="text-[11px] text-white/60">La cámara no devolvió imagen</span>}
        </div>
    );
}

/**
 * El interruptor chico de un área (o «Sin área», o un tipo): prendida = OmniAccess consume sus
 * equipos. No cambia nada al tocarlo: abre la confirmación (ModalApagado).
 */
function MiniInterruptor({ prendido, onClick, titulo, bloqueado }: { prendido: boolean; onClick: () => void; titulo: string; bloqueado?: boolean }) {
    return (
        <button type="button" role="switch" aria-checked={prendido} aria-label={titulo} disabled={bloqueado}
            onClick={(e) => { e.stopPropagation(); if (!bloqueado) onClick(); }}
            data-tooltip-id="tt-areas" data-tooltip-content={titulo}
            className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                prendido ? "bg-[var(--bien)]" : "bg-muted-foreground/35")}>
            <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all", prendido ? "left-[14px]" : "left-0.5")} />
        </button>
    );
}

const PLURAL_TIPO: Record<string, [string, string]> = { CAMERA: ["cámara de intrusión", "cámaras de intrusión"], LPR_CAMERA: ["cámara LPR", "cámaras LPR"], NVR: ["NVR", "NVR"] };

/** Lo que pasa al apagar o reactivar, dicho antes de hacerlo, con cuántos equipos y de qué tipo. */
function ModalApagado({ pedido, equipos, aplicando, onConfirmar, onCancelar }: {
    pedido: { clave: string; titulo: string; apagar: boolean } | null; equipos: any[]; aplicando: boolean; onConfirmar: () => void; onCancelar: () => void;
}) {
    const porTipo = new Map<string, number>();
    for (const d of equipos) { const t = d.deviceType === "LPR_INTERIOR" ? "LPR_CAMERA" : d.deviceType; porTipo.set(t, (porTipo.get(t) || 0) + 1); }
    const apagar = !!pedido?.apagar;
    const hayNvr = (porTipo.get("NVR") || 0) > 0;
    const PARA = apagar ? [
        "Su video en vivo: se cierran sus streams y go2rtc deja de conectarse a las cámaras.",
        "OmniVision no las analiza: ni detecciones, ni reglas, ni búsqueda.",
        "omni-lpr no lee sus matrículas.",
        "No se les consulta la salud ni se sondean sus eventos.",
    ] : [
        "Se vuelve a registrar su video en vivo.",
        "OmniVision y omni-lpr las vuelven a mirar (si estaban elegidas).",
        "Vuelve la consulta de salud y el sondeo de eventos.",
    ];
    const QUEDA = [
        "No se borra nada: equipos, reglas, calibraciones y áreas quedan como están.",
        "Las cámaras y el NVR siguen grabando como siempre: los clips de la grabación siguen disponibles.",
        "Las alarmas que una cámara mande por su cuenta pueden seguir llegando al receptor.",
        ...(hayNvr ? ["Un NVR apagado no se consulta (salud, canales); sus grabaciones siguen sirviendo para los clips."] : []),
    ];
    return (
        <Dialog open={!!pedido} onOpenChange={(o) => { if (!o) onCancelar(); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-[460px] p-0 gap-0 overflow-hidden rounded-[14px]">
                <div className="px-6 pt-6 pb-4 flex items-start gap-3.5">
                    <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full", apagar ? "bg-[color-mix(in_oklab,var(--mal)_14%,transparent)] tono-mal" : "bg-[color-mix(in_oklab,var(--bien)_14%,transparent)] tono-bien")}>
                        {apagar ? <PowerOff size={20} /> : <Power size={20} />}
                    </span>
                    <div className="min-w-0">
                        <DialogTitle className="text-[17px] font-bold leading-tight">{apagar ? "Apagar" : "Reactivar"} «{pedido?.titulo}»</DialogTitle>
                        <DialogDescription className="text-[12.5px] text-muted-foreground mt-1">
                            {equipos.length ? <>{equipos.length} {equipos.length === 1 ? "equipo" : "equipos"}: {[...porTipo.entries()].map(([t, n]) => `${n} ${(PLURAL_TIPO[t] || [t, t])[n === 1 ? 0 : 1]}`).join(" · ")}</> : "Hoy no tiene equipos; los que se agreguen quedan " + (apagar ? "apagados." : "activos.")}
                        </DialogDescription>
                    </div>
                </div>
                {equipos.length > 0 && (
                    <div className="px-6 pb-3 flex flex-wrap gap-1.5">
                        {equipos.slice(0, 8).map((d) => <span key={d.id} className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-muted text-[11px] font-semibold max-w-[200px]"><IconoTipo tipo={d.deviceType === "LPR_INTERIOR" ? "LPR_CAMERA" : d.deviceType} size={11} /><span className="truncate">{d.name}</span></span>)}
                        {equipos.length > 8 && <span className="inline-flex items-center h-6 px-2 rounded-full bg-muted text-[11px] text-muted-foreground">y {equipos.length - 8} más</span>}
                    </div>
                )}
                <div className="px-6 py-4 space-y-4 border-t border-border bg-card/40">
                    <div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">{apagar ? "OmniAccess deja de" : "OmniAccess vuelve a"}</div>
                        <ul className="space-y-1.5">{PARA.map((t) => <li key={t} className="flex gap-2 text-[12.5px] leading-snug"><span className={cn("mt-[0.45em] h-1.5 w-1.5 rounded-full shrink-0", apagar ? "bg-[var(--mal)]" : "bg-[var(--bien)]")} />{t}</li>)}</ul>
                    </div>
                    {apagar && (
                        <div>
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Lo que no cambia</div>
                            <ul className="space-y-1.5">{QUEDA.map((t) => <li key={t} className="flex gap-2 text-[12.5px] leading-snug text-muted-foreground"><Check size={13} className="mt-0.5 shrink-0" />{t}</li>)}</ul>
                        </div>
                    )}
                    {apagar && <p className="text-[12px] text-muted-foreground">Se reactiva cuando quieras con el mismo interruptor.</p>}
                </div>
                <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
                    <button type="button" onClick={onCancelar} disabled={aplicando} className="h-9 px-3.5 rounded-[6px] text-[12.5px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">Cancelar</button>
                    <button type="button" onClick={onConfirmar} disabled={aplicando}
                        className={cn("h-9 px-4 rounded-[6px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60", apagar ? "pleno-mal hover:brightness-110" : "bg-[var(--accion)] text-white hover:brightness-110")}>
                        {aplicando ? <Loader2 size={14} className="animate-spin" /> : apagar ? <PowerOff size={14} /> : <Power size={14} />}
                        {apagar ? `Apagar ${equipos.length || ""} ${equipos.length === 1 ? "equipo" : "equipos"}`.replace("  ", " ") : `Reactivar ${equipos.length || ""} ${equipos.length === 1 ? "equipo" : "equipos"}`.replace("  ", " ")}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
