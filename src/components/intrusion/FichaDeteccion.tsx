"use client";

import { useEffect, useState } from "react";
import { Tooltip as RTooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import { Activity, Check, ChevronLeft, ChevronRight, Clock, ImageOff, PlayCircle, Radar, Server, ShieldAlert, X } from "lucide-react";
import { AnalisisDeteccion } from "@/components/intrusion/AnalisisDeteccion";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { cn } from "@/lib/utils";
import { getDetectionHistory, type DetHistItem, type IntrusionCam } from "@/app/actions/detections";
import { META_DETECCION, GeomOverlay, type Geom } from "@/components/intrusion/comun";

/**
 * La ficha de una detección (cruce de línea, intrusión, zona): la captura grande con la
 * línea o la zona encima, los datos del canal, y las flechas para recorrer los eventos de
 * esa cámara.
 *
 * Vivía adentro de admin/monitor-intrusion/page.tsx. Salió el 8/10 porque el panel
 * «Detecciones» del monitor LPR mostraba las mismas detecciones y al tocarlas no abría
 * nada: tener la ficha en un solo lugar es lo que hace que una detección se vea igual
 * desde las dos pantallas.
 */

function ago(ts: string) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "hace " + s + "s";
    const m = Math.floor(s / 60); if (m < 60) return "hace " + m + "m";
    const h = Math.floor(m / 60); if (h < 24) return "hace " + h + "h";
    return new Date(ts).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

export function FichaDeteccion({ det, cam, geom, onClose, onResolveAlarm, hasAlarm, enAtencion, onCerrarAtencion, onMarcar }: {
    det: any; cam?: IntrusionCam; geom?: Geom; onClose: () => void;
    onResolveAlarm?: (deviceId: string, kind: "real" | "false") => void; hasAlarm?: boolean;
    /** La cámara tiene una intrusión confirmada como real y sin resolver. */
    enAtencion?: boolean;
    /** Cerrarla: aceptarla como resuelta, o reclasificarla como falsa alarma. */
    onCerrarAtencion?: (deviceId: string, como: "resuelta" | "falsa") => void;
    /** Corregir ESTA detección (no la cámara entera): real o falsa alarma. */
    onMarcar?: (id: string, kind: "real" | "false") => Promise<{ ok: boolean; error?: string } | void>;
}) {
    const [cur, setCur] = useState<any>(det);
    const [grabacion, setGrabacion] = useState(false);
    const [sibs, setSibs] = useState<DetHistItem[]>([]);
    useEffect(() => { setCur(det); }, [det]);
    useEffect(() => { if (!det.deviceId) { setSibs([]); return; } getDetectionHistory({ deviceId: det.deviceId, pageSize: 60 }).then((r) => setSibs(r.items)).catch(() => setSibs([])); }, [det.deviceId]);
    const idx = sibs.findIndex((x) => x.id === cur.id);
    const go = (d: number) => { if (idx < 0) return; const n = idx + d; if (n >= 0 && n < sibs.length) setCur(sibs[n]); };
    const m = META_DETECCION[cur.type] || META_DETECCION.OTHER;
    const [rk] = useState(Date.now());
    const nvr = cur.nvrName || cam?.nvrName; const ch = cur.ch ?? cam?.ch;
    const snap = cur.snapshotPath ? cur.snapshotPath : (cur.deviceId ? `/api/snapshot/${cur.deviceId}?t=${rk}_${cur.id}` : null);
    const fecha = new Date(cur.timestamp).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const hasGeom = !!(geom && ((geom.line && geom.line.length === 2) || (geom.field && geom.field.length >= 3)));
    const hasPrev = idx >= 0 && idx < sibs.length - 1; // más viejo
    const hasNext = idx > 0;                            // más nuevo
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (e.key === "ArrowLeft") { e.preventDefault(); go(1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); go(-1); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (hasAlarm && cur.deviceId && onResolveAlarm) {
                const k = e.key.toLowerCase();
                if (k === "a" || e.key === "Enter") { e.preventDefault(); onResolveAlarm(cur.deviceId, "real"); }
                else if (k === "f" || k === "r") { e.preventDefault(); onResolveAlarm(cur.deviceId, "false"); }
            } else if (enAtencion && cur.deviceId && onCerrarAtencion) {
                const k = e.key.toLowerCase();
                if (k === "a" || e.key === "Enter") { e.preventDefault(); onCerrarAtencion(cur.deviceId, "resuelta"); }
                else if (k === "f") { e.preventDefault(); onCerrarAtencion(cur.deviceId, "falsa"); }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [cur, idx, sibs, hasAlarm, onResolveAlarm, enAtencion, onCerrarAtencion, onClose]);
    const atencionAbierta = !hasAlarm && !!enAtencion && !!cur.deviceId && !!onCerrarAtencion;
    return (
        <div className="fixed inset-0 z-[2100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-10" onClick={onClose}>
            {/* flechas AFUERA del modal, para pasar eventos del canal */}
            {hasPrev && <button onClick={(e) => { e.stopPropagation(); go(1); }} data-tooltip-id="ficha-det-tip" data-tooltip-content="Evento anterior (más viejo)"
                className="absolute left-2 sm:left-8 top-1/2 -translate-y-1/2 z-[5] w-12 h-12 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white ring-1 ring-white/10 backdrop-blur-md transition active:scale-90"><ChevronLeft size={24} /></button>}
            {hasNext && <button onClick={(e) => { e.stopPropagation(); go(-1); }} data-tooltip-id="ficha-det-tip" data-tooltip-content="Evento siguiente (más nuevo)"
                className="absolute right-2 sm:right-8 top-1/2 -translate-y-1/2 z-[5] w-12 h-12 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white ring-1 ring-white/10 backdrop-blur-md transition active:scale-90"><ChevronRight size={24} /></button>}
            {/* cerrar AFUERA del modal, arriba a la derecha */}
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} data-tooltip-id="ficha-det-tip" data-tooltip-content="Cerrar"
                className="absolute right-3 top-3 sm:right-6 sm:top-6 z-[6] w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/25 text-white ring-1 ring-white/15 backdrop-blur-md transition active:scale-90"><X size={22} /></button>
            {/* La foto arriba y, debajo, la grabación y el análisis: se baja con la rueda o el dedo. */}
            <div className="relative w-full max-w-6xl max-h-full overflow-y-auto overscroll-contain flex flex-col gap-3 custom-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl shrink-0">
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[7] flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-black/65 backdrop-blur-md ring-1 ring-white/10 text-[10px] font-bold text-white/70 pointer-events-none">
                    <span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-white/15">←</kbd><kbd className="px-1 rounded bg-white/15">→</kbd> eventos</span>
                    {((hasAlarm && cur.deviceId && onResolveAlarm) || atencionAbierta) && (<><span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-red-500/40 text-red-100">A</kbd> aceptar</span><span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-amber-500/40 text-amber-100">F</kbd> falsa</span></>)}
                    <span className="inline-flex items-center gap-1"><kbd className="px-1 rounded bg-white/15">Esc</kbd> cerrar</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {snap ? <img src={snap} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/30"><ImageOff size={32} /></div>}
                <GeomOverlay geom={geom} alert />
                {hasGeom && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/90 ring-1 ring-red-200/40 shadow-[0_0_20px_rgba(239,68,68,0.8)] text-white text-[10px] font-extrabold uppercase tracking-wide animate-pulse"><m.Icon size={11} /> Detección en esta área</span>
                    </div>
                )}
                {/* La ficha de una intrusión confirmada lleva el mismo rojo que el canal: que no haya duda de qué se está decidiendo. */}
                {(atencionAbierta || (hasAlarm && cur.deviceId && onResolveAlarm)) && <div className="absolute inset-0 pointer-events-none intr-conf-borde" />}
                <div className="absolute top-0 inset-x-0 p-4 pr-16 flex items-start gap-3 bg-gradient-to-b from-black/75 to-transparent">
                    <span className={cn("grid h-11 w-11 place-items-center rounded-xl backdrop-blur-md ring-1 ring-white/10 shrink-0", m.cls)}><m.Icon size={21} /></span>
                    <div className="min-w-0">
                        <div className="text-lg font-extrabold text-white leading-tight truncate drop-shadow">{m.label}</div>
                        <div className="text-[12px] text-white/65 truncate">{cur.deviceName || cam?.name || "Cámara"}</div>
                        {atencionAbierta && (
                            <span className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-white text-[10px] font-extrabold uppercase tracking-[0.14em] shadow-lg animate-pulse"><ShieldAlert size={11} /> Intrusión confirmada · sin resolver</span>
                        )}
                        {hasAlarm && cur.deviceId && onResolveAlarm && (
                            <span className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-white text-[10px] font-extrabold uppercase tracking-[0.14em] shadow-lg animate-pulse"><ShieldAlert size={11} /> Intrusión detectada · sin confirmar</span>
                        )}
                    </div>
                    {idx >= 0 && sibs.length > 1 && <span className="ml-auto mt-1 text-[11px] font-bold text-white/60 tabular-nums self-start">{idx + 1} / {sibs.length}</span>}
                </div>
                <div className="absolute bottom-0 inset-x-0 p-4 pt-14 flex items-end justify-between gap-4 bg-gradient-to-t from-black/90 via-black/35 to-transparent">
                    {/* Resolver alarma desde la MISMA ficha del sidebar */}
                    {hasAlarm && cur.deviceId && onResolveAlarm ? (
                        <div className="flex items-center gap-2">
                            <button onClick={(e) => { e.stopPropagation(); onResolveAlarm(cur.deviceId, "false"); }}
                                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 text-[13px] font-extrabold ring-1 ring-white/10 active:scale-95 transition"><X size={16} /> Falsa alarma <kbd className="ml-1 px-1 rounded bg-black/30 text-[10px]">F</kbd></button>
                            <button onClick={(e) => { e.stopPropagation(); onResolveAlarm(cur.deviceId, "real"); }}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[13px] font-extrabold shadow-xl active:scale-95 transition"><Check size={16} /> Confirmar real <kbd className="ml-1 px-1 rounded bg-black/25 text-[10px]">A</kbd></button>
                        </div>
                    ) : atencionAbierta ? (
                        /* Confirmada y sin resolver: aceptarla cierra la atención; falsa alarma además corrige el registro. */
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                                <button onClick={(e) => { e.stopPropagation(); onCerrarAtencion!(cur.deviceId, "falsa"); }} data-tooltip-id="ficha-det-tip" data-tooltip-content="Se marca como falsa en el historial y el canal vuelve a la normalidad"
                                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 text-[13px] font-extrabold ring-1 ring-white/10 active:scale-95 transition"><X size={16} /> Falsa alarma <kbd className="ml-1 px-1 rounded bg-black/30 text-[10px]">F</kbd></button>
                                <button onClick={(e) => { e.stopPropagation(); onCerrarAtencion!(cur.deviceId, "resuelta"); }} data-tooltip-id="ficha-det-tip" data-tooltip-content="La intrusión fue real y ya se atendió: el canal vuelve a la normalidad"
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[13px] font-extrabold shadow-xl active:scale-95 transition"><Check size={16} /> Aceptar · resuelta <kbd className="ml-1 px-1 rounded bg-black/25 text-[10px]">A</kbd></button>
                            </div>
                            <p className="text-[10.5px] text-white/55 drop-shadow max-w-md">Fue confirmada como real. Si con la foto delante ves que no lo era, marcála como falsa: queda corregido en el historial.</p>
                        </div>
                    ) : onMarcar && cur.id && !String(cur.id).startsWith("live-") ? (
                        /* Ni pendiente ni en atención: un evento ya mirado (o viejo). Se puede corregir uno por uno. */
                        <div className="flex flex-col gap-1.5">
                            <span className={cn("w-fit inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-[0.14em]",
                                !cur.acknowledged ? "bg-amber-500 text-black" : cur.ackKind === "false" ? "bg-white/20 text-white" : "bg-red-600 text-white")}>
                                {!cur.acknowledged ? "Sin revisar" : cur.ackKind === "false" ? "Marcada falsa alarma" : "Marcada real"}
                            </span>
                            <div className="flex items-center gap-2">
                                {cur.ackKind !== "false" && (
                                    <button onClick={async (e) => { e.stopPropagation(); const r = await onMarcar(cur.id, "false"); if (!r || r.ok) setCur((c: any) => ({ ...c, acknowledged: true, ackKind: "false" })); }}
                                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 text-[13px] font-extrabold ring-1 ring-white/10 active:scale-95 transition"><X size={16} /> {cur.acknowledged ? "Era falsa alarma" : "Falsa alarma"}</button>
                                )}
                                {(cur.ackKind === "false" || !cur.acknowledged) && (
                                    <button onClick={async (e) => { e.stopPropagation(); const r = await onMarcar(cur.id, "real"); if (!r || r.ok) setCur((c: any) => ({ ...c, acknowledged: true, ackKind: "real" })); }}
                                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[13px] font-extrabold active:scale-95 transition"><Check size={16} /> {cur.acknowledged ? "Era real" : "Fue real"}</button>
                                )}
                            </div>
                            <p className="text-[10.5px] text-white/55 drop-shadow max-w-md">Corrige sólo este evento en el historial; no cambia el estado de la cámara.</p>
                        </div>
                    ) : <span />}
                    {/* datos apilados a la derecha, sin chips */}
                    <div className="flex flex-col items-end gap-0.5 text-right drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-white"><Server size={12} className="text-white/55" />{nvr || "—"}{ch != null ? ` · CH ${ch}` : ""}</span>
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/85"><Clock size={11} className="text-white/45" />{fecha}</span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/60"><Activity size={11} className="text-white/40" />{ago(cur.timestamp)}</span>
                        {cur.eventType && <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/55"><Radar size={11} className="text-white/40" />{cur.eventType}</span>}
                        <span className="text-[9.5px] font-mono text-white/35 select-all">{cur.id}</span>
                    </div>
                </div>
            </div>
            {/* Lo de abajo: ver la grabación de ese instante y lo que se sabe alrededor. */}
            {cur.deviceId && !String(cur.id).startsWith("live-") && (
                <div className="dark text-foreground shrink-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setGrabacion(true)}
                            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[var(--accion)] hover:opacity-90 text-white text-[14px] font-bold active:scale-[0.98] transition">
                            <PlayCircle size={18} /> Ver la grabación de este momento
                        </button>
                        <span className="text-[12px] text-white/55">Abre el visor en Grabación, parado en {new Date(cur.timestamp).toLocaleTimeString("es-UY", { hour12: false })}, con las marcas de los eventos.</span>
                    </div>
                    <AnalisisDeteccion id={cur.id} />
                </div>
            )}
            {/* Adentro de la columna (que corta el clic) y no del fondo: el visor va en un portal,
                pero sus clics suben por el árbol de React y el fondo cierra la ficha. */}
            {grabacion && cur.deviceId && <VerGrabacion deviceId={cur.deviceId} nombre={cur.deviceName || cam?.name} instanteMs={new Date(cur.timestamp).getTime()} canal={cur.ch ?? cam?.ch ?? null} nvrId={cam?.nvrId ?? null} onClose={() => setGrabacion(false)} />}
            </div>
            <RTooltip id="ficha-det-tip" place="top" className="!text-[11px] !rounded-md !px-2 !py-1 z-[2200]" />
        </div>
    );
}
