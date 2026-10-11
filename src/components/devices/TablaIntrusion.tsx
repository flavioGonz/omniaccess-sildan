"use client";

import { useEffect, useMemo, useState } from "react";
import { Radar, Server, BellRing, BellOff, Crosshair, Settings2, Trash2, Search, Loader2, Camera } from "lucide-react";
import { Tooltip } from "react-tooltip";
import { cn } from "@/lib/utils";
import { getIntrusionCameras, type IntrusionCam } from "@/app/actions/detections";
import { deleteDevice } from "@/app/actions/devices";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { IntrusionCalibrator } from "@/components/IntrusionCalibrator";
import { AlertasFila, claseNombreConAlerta, type AlertaEquipo } from "@/components/devices/AlertasFila";

/**
 * Las cámaras de INTRUSIÓN, en su propia vista (no mezcladas con las LPR ni con los NVR).
 * Cada fila dice dónde graba (NVR y canal), si tiene la analítica dibujada, si le avisa a
 * OmniAccess y deja calibrarla con el calibrador de intrusión.
 */
export function TablaIntrusion({ devices, health, analyticsIds, groups, onReload, onEditar, alertasDe = {}, onVerSalud }: {
    devices: any[]; health: Record<string, any>; analyticsIds: Set<string>; groups: any[]; onReload: () => void; onEditar?: (d: any) => void; alertasDe?: Record<string, AlertaEquipo[]>; onVerSalud?: (d: any) => void;
}) {
    const [cams, setCams] = useState<Record<string, IntrusionCam>>({});
    const [cargando, setCargando] = useState(true);
    const [q, setQ] = useState("");
    const [nvr, setNvr] = useState<string>("todos");
    const [calibrando, setCalibrando] = useState<any>(null);

    const cargar = () => { setCargando(true); getIntrusionCameras().then((l) => setCams(Object.fromEntries(l.map((c) => [c.id, c])))).catch(() => { }).finally(() => setCargando(false)); };
    useEffect(() => { cargar(); }, [devices.length]);

    const nvrs = useMemo(() => [...new Set(Object.values(cams).map((c) => c.nvrName || "Sin NVR"))].sort(), [cams]);
    const filas = useMemo(() => devices
        .filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()) || d.ip.includes(q))
        .filter((d) => nvr === "todos" || (cams[d.id]?.nvrName || "Sin NVR") === nvr)
        .sort((a, b) => (cams[a.id]?.nvrName || "").localeCompare(cams[b.id]?.nvrName || "") || (cams[a.id]?.ch ?? 999) - (cams[b.id]?.ch ?? 999) || a.name.localeCompare(b.name)),
    [devices, cams, q, nvr]);
    const conAnalitica = devices.filter((d) => analyticsIds.has(d.id)).length;
    const conAviso = Object.values(cams).filter((c) => c.alarmOk).length;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-border"><Camera size={12} /> {devices.length} cámaras</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-border" data-tooltip-id="tt-intr" data-tooltip-content="Con línea de cruce o zona de intrusión configurada en la cámara."><Radar size={12} className="text-red-400" /> {conAnalitica} con analítica</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-border" data-tooltip-id="tt-intr" data-tooltip-content="Con el servidor de alarmas apuntando a OmniAccess: sus detecciones llegan al monitor de intrusión."><BellRing size={12} className="text-emerald-400" /> {conAviso} avisan a OmniAccess</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <select value={nvr} onChange={(e) => setNvr(e.target.value)} className="h-9 rounded-lg bg-card border border-border px-2 text-xs">
                        <option value="todos">Todos los NVR</option>
                        {nvrs.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cámara o IP…" className="h-9 w-56 rounded-lg bg-card border border-border pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-red-500/30" />
                    </div>
                </div>
            </div>

            <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                <table className="w-full text-sm">
                    <thead className="bg-card/60">
                        <tr className="text-muted-foreground text-[10px] uppercase tracking-wide">
                            <th className="text-left font-semibold py-3 pl-5">Cámara</th>
                            <th className="text-left font-semibold">Grabación</th>
                            <th className="text-left font-semibold">Red</th>
                            <th className="text-center font-semibold">Analítica</th>
                            <th className="text-center font-semibold">Aviso a OmniAccess</th>
                            <th className="text-center font-semibold">Estado</th>
                            <th className="text-right font-semibold pr-5">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cargando && !Object.keys(cams).length && <tr><td colSpan={7} className="py-10 text-center text-muted-foreground text-xs"><Loader2 size={16} className="animate-spin inline mr-2" /> Cargando cámaras de intrusión…</td></tr>}
                        {!cargando && !filas.length && <tr><td colSpan={7} className="py-10 text-center text-muted-foreground text-xs">No hay cámaras de intrusión{q || nvr !== "todos" ? " con ese filtro" : ". Se agregan importándolas desde su NVR o con «Agregar → Cámara de intrusión»."}</td></tr>}
                        {filas.map((d) => {
                            const c = cams[d.id]; const h = health[d.id]; const ana = analyticsIds.has(d.id);
                            return (
                                <tr key={d.id} className={cn("border-t border-border/50 hover:bg-foreground/[0.04] transition-colors", alertasDe[d.id] && "bg-red-500/[0.035]")}>
                                    <td className="py-2.5 pl-5">
                                        <div className="flex items-center gap-3">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={`/api/snapshot/${d.id}?w=160`} alt="" loading="lazy" className="w-20 h-11 rounded-md object-cover bg-black border border-border/40" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                                            <div className="min-w-0">
                                                <p className={cn("font-semibold text-foreground text-sm leading-tight truncate max-w-[240px]", claseNombreConAlerta(alertasDe[d.id]))}>{d.name}</p>
                                                <p className="text-[10px] text-muted-foreground">{d.brand}{d.deviceModel ? ` · ${d.deviceModel}` : ""}</p>
                                                <AlertasFila alertas={alertasDe[d.id]} onVer={() => onVerSalud?.(d)} />
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        {c?.nvrName ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs"><Server size={12} className="text-blue-400" /> <span className="truncate max-w-[160px]">{c.nvrName}</span> {c.ch != null && <span className="px-1.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[9px] font-bold font-mono">CH {c.ch}</span>}</span>
                                        ) : <span className="text-[10px] font-bold uppercase text-amber-500">Sin NVR</span>}
                                    </td>
                                    <td><p className="text-xs font-mono text-foreground">{d.ip}</p></td>
                                    <td className="text-center">
                                        {ana ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/15 text-red-400 border border-red-500/30 text-[9px] font-bold uppercase"><Radar size={10} /> Configurada</span>
                                            : <span className="text-[10px] text-muted-foreground" data-tooltip-id="tt-intr" data-tooltip-content="No tiene línea ni zona dibujada: abrí el calibrador para configurarla.">Sin analítica</span>}
                                    </td>
                                    <td className="text-center">
                                        {c?.alarmOk ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500"><BellRing size={12} /> Avisa</span>
                                            : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground" data-tooltip-id="tt-intr" data-tooltip-content="Todavía no se confirmó que le avise a OmniAccess. Se configura en el calibrador (control «Servidor»)."><BellOff size={12} /> Sin confirmar</span>}
                                    </td>
                                    <td className="text-center">
                                        {h ? <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-bold uppercase", h.reachable ? "text-emerald-500" : "text-red-500")}><span className={cn("w-1.5 h-1.5 rounded-full", h.reachable ? "bg-emerald-500" : "bg-red-500")} />{h.reachable ? "En línea" : "Sin respuesta"}</span>
                                            : <span className="text-[10px] text-muted-foreground">—</span>}
                                    </td>
                                    <td className="text-right pr-5">
                                        <div className="inline-flex items-center gap-1.5">
                                            <button onClick={() => setCalibrando(d)} data-tooltip-id="tt-intr" data-tooltip-content="Calibrar la intrusión: línea, zona, sentido, sensibilidad, objetivo y aviso a OmniAccess, sobre el video en vivo."
                                                className="h-8 px-2.5 rounded-md bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 text-[11px] font-bold inline-flex items-center gap-1.5"><Crosshair size={13} /> Calibrar</button>
                                            <button onClick={() => onEditar?.(d)} className="h-8 w-8 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground grid place-items-center" data-tooltip-id="tt-intr" data-tooltip-content="Editar la cámara: nombre, conexión y grabación"><Settings2 size={14} /></button>
                                            <DeleteConfirmDialog id={d.id} title={d.name} description="Se saca de OmniAccess (la cámara y su grabación en el NVR no se tocan)." onDelete={deleteDevice} onSuccess={onReload}>
                                                <button className="h-8 w-8 rounded-md hover:bg-red-500/10 text-red-400 grid place-items-center" data-tooltip-id="tt-intr" data-tooltip-content="Quitar de OmniAccess"><Trash2 size={14} /></button>
                                            </DeleteConfirmDialog>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <Tooltip id="tt-intr" place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[60]" />
            {calibrando && <IntrusionCalibrator device={calibrando} onClose={() => { setCalibrando(null); cargar(); }} />}
        </div>
    );
}
