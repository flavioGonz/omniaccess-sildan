"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Eye, Settings2, Crosshair, Wand2, Inbox, Layers, GripVertical, Activity, PowerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { esLprDeAcceso } from "@/lib/modo-camara";
import { IconoTipo, ICONO_TIPO, arrastrarEquipos, SIN_AREA } from "@/components/devices/ArbolAreas";
import { AlertasFila, claseNombreConAlerta, type AlertaEquipo } from "@/components/devices/AlertasFila";
import { CeldaGrabacion } from "@/components/devices/CeldaGrabacion";
import type { EstadoAreas, Area } from "@/app/actions/areas";
import type { FilaGrabacion } from "@/app/actions/grabaciones";
import { PanelCuentas } from "@/components/devices/usuarios/PanelCuentas";
import { useFuncion } from "@/lib/funciones-cliente";
import { ramaDe } from "@/lib/usuarios-equipo/areas";

/**
 * Lo que hay en un área, a la derecha del árbol: todos sus equipos (de todos los tipos), con
 * sus sub-áreas como grupos plegables. Se llega eligiendo una carpeta en el árbol.
 */
export function VistaArea({ estado, areaId, devices, busqueda = "", health = {}, alertasDe = {}, grab = {}, detectando, calculando,
    onDetectar, onRetencion, onEditar, onVivo, onCalibrar, onCalibrarIntrusion, onSalud, onElegirArea }: {
    estado: EstadoAreas; areaId: string; devices: any[]; busqueda?: string; health?: Record<string, any>; alertasDe?: Record<string, AlertaEquipo[]>;
    grab?: Record<string, FilaGrabacion>; detectando?: string | null; calculando?: string | null;
    onDetectar: (ids: string[]) => void; onRetencion: (id: string) => void; onEditar: (d: any) => void; onVivo?: (d: any) => void;
    onCalibrar: (d: any) => void; onSalud: (d: any) => void; onElegirArea: (id: string) => void;
    /** La analítica de intrusión de una cámara que además lee matrículas (LPR_INTERIOR): la misma cámara puede vigilar un perímetro. */
    onCalibrarIntrusion?: (d: any) => void;
}) {
    const [tipo, setTipo] = useState<string>("todos");
    const [cerrados, setCerrados] = useState<Set<string>>(new Set());
    const area = estado.areas.find((a) => a.id === areaId) || null;
    const hijas = (p: string | null) => estado.areas.filter((a) => a.padre === p).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
    const q = busqueda.trim().toLowerCase();
    const pasa = (d: any) => (tipo === "todos" || d.deviceType === tipo) && (!q || d.name.toLowerCase().includes(q) || (d.ip || "").includes(q) || (d.location || "").toLowerCase().includes(q));
    const directos = (id: string) => devices.filter((d) => (id === SIN_AREA ? !estado.equipos[d.id] || !estado.areas.some((a) => a.id === estado.equipos[d.id]) : estado.equipos[d.id] === id)).filter(pasa).sort((a, b) => a.name.localeCompare(b.name));
    const todos = (id: string): any[] => [...directos(id), ...(id === SIN_AREA ? [] : hijas(id).flatMap((h) => todos(h.id)))];

    // Camino (migas) hasta el área
    const camino: Area[] = [];
    for (let cur = area, i = 0; cur && i < 50; i++) { camino.unshift(cur); cur = estado.areas.find((a) => a.id === cur!.padre) || null; }

    const lista = todos(areaId);
    /* Las cuentas del área (openspec usuarios-de-equipos): todos los equipos de su rama, sin el filtro de
       tipo ni la búsqueda, que son de la lista de abajo. */
    const usuariosOn = useFuncion("EQUIPOS_USUARIOS");
    const idsRama = useMemo(() => {
        if (areaId === SIN_AREA) return devices.filter((d) => !estado.equipos[d.id] || !estado.areas.some((a) => a.id === estado.equipos[d.id])).map((d) => d.id);
        const rama = ramaDe(estado, areaId);
        return devices.filter((d) => rama.has(estado.equipos[d.id])).map((d) => d.id);
    }, [estado, areaId, devices]);
    const porTipo = useMemo(() => {
        const base = (function sinFiltro(id: string): any[] {
            const dir = devices.filter((d) => (id === SIN_AREA ? !estado.equipos[d.id] || !estado.areas.some((a) => a.id === estado.equipos[d.id]) : estado.equipos[d.id] === id));
            return [...dir, ...(id === SIN_AREA ? [] : hijas(id).flatMap((h) => sinFiltro(h.id)))];
        })(areaId);
        const m: Record<string, number> = {};
        for (const d of base) m[d.deviceType] = (m[d.deviceType] || 0) + 1;
        return { m, total: base.length, alertas: base.filter((d) => alertasDe[d.id]?.length).length, off: base.filter((d) => health[d.id]?.reachable === false).length };
    }, [estado, areaId, devices, alertasDe, health]); // eslint-disable-line react-hooks/exhaustive-deps

    const fila = (d: any) => {
        const h = health[d.id];
        const on = h ? h.reachable : null;
        return (
            /* Un div común y no motion.div (22/10, Nico: «el drag and drop no funciona más para colocar
               dispositivos en áreas»): framer-motion se queda con onDragStart para su propio gesto de
               arrastre y no se lo pasa al elemento, así que el arrastre nativo salía sin el equipo
               adentro y el árbol de áreas no lo aceptaba. Lo único que se pierde es la animación de
               reacomodo de la fila. */
            <div key={d.id} draggable onDragStart={(e) => arrastrarEquipos(e, [d.id], d.name)} onClick={(e: React.MouseEvent) => { const t = e.target as HTMLElement; if (!(e.currentTarget as HTMLElement).contains(t) || t.closest('button,a,input,select,textarea,label,[role="menuitem"],[data-no-fila]')) return; onEditar(d); }}
                className={cn("group grid grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1.3fr)_78px_auto] items-center gap-3 px-3 py-2 border-t border-border/50 hover:bg-foreground/[0.03] cursor-pointer", alertasDe[d.id] && "bg-red-500/[0.035]")}>
                <div className="flex items-center gap-2.5 min-w-0">
                    <GripVertical size={12} className="text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 -ml-1" />
                    {d.deviceType === "NVR" ? (
                        <span className="w-14 h-9 rounded-md bg-sky-500/10 grid place-items-center shrink-0"><IconoTipo tipo="NVR" size={16} /></span>
                    ) : (
                        <span className="relative shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${d.id}?w=160`} alt="" loading="lazy" className="w-14 h-9 rounded-md object-cover bg-black border border-border/40" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                            <span className={cn("absolute -top-1 -left-1 h-4 w-4 rounded grid place-items-center ring-2 ring-background", d.deviceType === "LPR_CAMERA" ? "bg-amber-500 text-black" : d.deviceType === "CAMERA" ? "bg-red-500 text-white" : "bg-muted")}><IconoTipo tipo={d.deviceType} size={9} className="!text-current" /></span>
                        </span>
                    )}
                    <div className="min-w-0">
                        <p className={cn("text-[12.5px] font-semibold truncate", claseNombreConAlerta(alertasDe[d.id]))} data-tooltip-id="tt-grab" data-tooltip-content={`${d.name} · ${ICONO_TIPO[d.deviceType]?.t || d.deviceType}`}>{d.name}</p>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="uppercase font-bold">{String(d.brand || "").slice(0, 3)}</span>
                            {d.deviceType === "LPR_CAMERA" && d.direction && <span className={cn("px-1 rounded font-bold", d.direction === "EXIT" ? "bg-orange-500/15 text-orange-500" : "bg-emerald-500/15 text-emerald-500")}>{d.direction === "EXIT" ? "SAL" : "ENT"}</span>}
                        </div>
                        <AlertasFila alertas={alertasDe[d.id]} onVer={() => onSalud(d)} />
                    </div>
                </div>
                <span className="text-[11.5px] font-mono text-muted-foreground truncate">{d.ip}</span>
                <div className="min-w-0">
                    {d.deviceType === "NVR" ? <span className="text-[11px] text-muted-foreground">—</span> :
                        <CeldaGrabacion g={grab[d.id]} detectando={detectando === d.id || detectando === "__todas__"} calculando={calculando === d.id} onDetectar={() => onDetectar([d.id])} onRetencion={() => onRetencion(d.id)} />}
                </div>
                {h?.apagado ? <span className="h-6 px-2 rounded-md text-[9.5px] font-bold uppercase inline-flex items-center gap-1 border w-fit text-muted-foreground border-border bg-muted/40" data-tooltip-id="tt-grab" data-tooltip-content="Su área está apagada: OmniAccess no la consume (sin vivo, análisis ni consultas). Se reactiva desde el árbol de áreas."><PowerOff size={10} /> Apagado</span> : <span className={cn("h-6 px-2 rounded-md text-[9.5px] font-bold uppercase inline-flex items-center gap-1 border w-fit",
                    on === null ? "text-muted-foreground border-border" : on ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25" : "bg-red-500/10 text-red-500 border-red-500/25")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", on === null ? "bg-muted-foreground/40" : on ? "bg-emerald-500" : "bg-red-500")} />{on === null ? "…" : on ? "On" : "Off"}
                </span>}
                <div className="flex items-center justify-end gap-0.5">
                    {/* Las de lectura OmniVision (LPR_INTERIOR + acceso) también se calibran: imagen, sin ANPR. */}
                    {(d.deviceType === "CAMERA" || (esLprDeAcceso(d) && d.brand === "HIKVISION")) && (
                        <button onClick={() => onCalibrar(d)} data-tooltip-id="tt-grab" data-tooltip-content={d.deviceType === "CAMERA" ? "Calibrar intrusión" : d.deviceType === "LPR_INTERIOR" ? "Calibrar imagen (lectura OmniVision)" : "Calibrar ANPR"} className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10">{d.deviceType === "CAMERA" ? <Crosshair size={14} /> : <Wand2 size={14} />}</button>
                    )}
                    {d.deviceType === "LPR_INTERIOR" && onCalibrarIntrusion && (d.brand === "HIKVISION" || d.brand === "DAHUA") && (
                        <button onClick={() => onCalibrarIntrusion(d)} data-tooltip-id="tt-grab" data-tooltip-content="Calibrar intrusión (analítica de la cámara)" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10"><Crosshair size={14} /></button>
                    )}
                    <button onClick={() => onSalud(d)} data-tooltip-id="tt-grab" data-tooltip-content="Historial de salud" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><Activity size={14} /></button>
                    <button onClick={() => onEditar(d)} data-tooltip-id="tt-grab" data-tooltip-content="Editar" className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><Settings2 size={14} /></button>
                </div>
            </div>
        );
    };

    const grupo = (a: Area, nivel: number): React.ReactNode => {
        const cnt = todos(a.id).length;
        if (!cnt) return null;
        const abierto = !cerrados.has(a.id);
        const dir = directos(a.id);
        return (
            <div key={a.id} className="border-t border-border/60">
                <div className="flex items-center gap-2 px-3 h-9 bg-muted/30 hover:bg-muted/50 cursor-pointer select-none" style={{ paddingLeft: 12 + nivel * 16 }}
                    onClick={() => setCerrados((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}>
                    <ChevronRight size={13} className={cn("text-muted-foreground transition-transform", abierto && "rotate-90")} />
                    {abierto ? <FolderOpen size={14} style={{ color: a.color }} /> : <Folder size={14} style={{ color: a.color }} fill={a.color} fillOpacity={0.2} />}
                    <span className="text-[12px] font-bold">{a.nombre}</span>
                    <span className="h-[17px] px-1.5 rounded-full bg-background text-[10px] font-bold text-muted-foreground grid place-items-center tabular-nums">{cnt}</span>
                    <button onClick={(e) => { e.stopPropagation(); onElegirArea(a.id); }} className="ml-auto text-[10.5px] font-semibold text-muted-foreground hover:text-[var(--accion)]">Abrir</button>
                </div>
                {abierto && (<>{dir.map(fila)}{hijas(a.id).map((h) => grupo(h, nivel + 1))}</>)}
            </div>
        );
    };

    const sinArea = areaId === SIN_AREA;
    return (
        <div className="space-y-4">
        {usuariosOn && <PanelCuentas estado={estado} areaId={areaId === SIN_AREA ? null : areaId} deviceIds={idsRama}
            onAbrirEquipo={(id) => { const d = devices.find((x) => x.id === id); if (d) onEditar(d); }} />}
        <div className="rounded-xl border border-border/60 bg-background/50 overflow-hidden">
            {/* Encabezado del área */}
            <div className="px-4 py-3 border-b border-border/60 bg-card/50 space-y-2.5">
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground flex-wrap">
                    <button onClick={() => onElegirArea("__todas__")} className="inline-flex items-center gap-1 hover:text-foreground"><Layers size={12} /> Todas</button>
                    {sinArea ? <><ChevronRight size={12} /><span className="font-bold text-foreground inline-flex items-center gap-1"><Inbox size={12} /> Sin área</span></> :
                        camino.map((c, i) => (
                            <span key={c.id} className="inline-flex items-center gap-1.5">
                                <ChevronRight size={12} />
                                <button onClick={() => onElegirArea(c.id)} className={cn("inline-flex items-center gap-1 hover:text-foreground", i === camino.length - 1 && "font-bold text-foreground")}>
                                    <Folder size={12} style={{ color: c.color }} fill={c.color} fillOpacity={0.25} /> {c.nombre}
                                </button>
                            </span>
                        ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {[["todos", "Todos", porTipo.total], ...Object.entries(porTipo.m).map(([t, n]) => [t, ICONO_TIPO[t]?.t || t, n])].map(([t, rot, n]: any) => (
                        <button key={t} onClick={() => setTipo(t)}
                            className={cn("h-8 px-3 rounded-lg text-[11.5px] font-bold inline-flex items-center gap-1.5 border transition-colors", tipo === t ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border/60 hover:bg-accent/60")}>
                            {t === "todos" ? <Layers size={13} className="text-muted-foreground" /> : <IconoTipo tipo={t} size={13} />} {rot}
                            <span className="h-[17px] min-w-[18px] px-1 rounded-full bg-muted text-[10px] grid place-items-center tabular-nums">{n}</span>
                        </button>
                    ))}
                    <div className="ml-auto flex items-center gap-2 text-[11px]">
                        {porTipo.alertas > 0 && <span className="px-2 py-1 rounded-full bg-red-500/10 text-red-500 font-bold">{porTipo.alertas} con alertas</span>}
                        {porTipo.off > 0 && <span className="px-2 py-1 rounded-full bg-red-500/10 text-red-500 font-bold">{porTipo.off} sin respuesta</span>}
                        {lista.some((d) => d.deviceType !== "NVR") && (
                            <button onClick={() => onDetectar(lista.filter((d) => d.deviceType !== "NVR").map((d) => d.id))} className="h-7 px-2.5 rounded-md border border-border/60 font-semibold hover:bg-accent" data-tooltip-id="tt-grab" data-tooltip-content="Detectar en qué NVR y canal graba cada cámara de esta área">Detectar grabaciones</button>
                        )}
                    </div>
                </div>
            </div>
            {/* Lista */}
            <div className="grid grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1.3fr)_78px_auto] gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-card/40">
                <span className="pl-4">Equipo</span><span>IP</span><span>Grabación</span><span>Estado</span><span className="text-right">Acciones</span>
            </div>
            {lista.length === 0 ? (
                <div className="py-16 text-center text-[12.5px] text-muted-foreground space-y-2 border-t border-border/50">
                    <FolderOpen size={26} className="mx-auto opacity-40" />
                    <p>{q || tipo !== "todos" ? "Ningún equipo de esta área coincide con el filtro." : "Esta área está vacía. Arrastrá equipos desde el árbol o desde la tabla de cada tipo."}</p>
                </div>
            ) : (<>
                {directos(areaId).map(fila)}
                {!sinArea && hijas(areaId).map((h) => grupo(h, 0))}
            </>)}
        </div>
        </div>
    );
}
