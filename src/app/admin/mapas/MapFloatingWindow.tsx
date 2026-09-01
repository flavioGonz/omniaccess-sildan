"use client";

import { useRef } from "react";
import { X, Move, PanelRight, PanelRightClose, Save, Cast } from "lucide-react";

type Geom = { x: number; y: number; w: number; h: number; docked: boolean };
type Dev = { id: string; name: string; ip: string; type: string; online: boolean };

function aforoColor(a: number, limit: number) { const r = limit > 0 ? a / limit : 0; return r >= 1 ? "#ef4444" : r >= 0.7 ? "#f59e0b" : "#10b981"; }

export default function MapFloatingWindow({ device, aforo, limit, geom, setGeom, onClose, onSave, children }: {
    device: Dev; aforo: number; limit: number; geom: Geom;
    setGeom: (g: Geom) => void; onClose: () => void; onSave: () => void; children?: React.ReactNode;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const isQ = device.type === "QUEUE_COUNTER";
    const col = isQ ? aforoColor(aforo, limit) : "#10b981";

    const startDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
        if (mode === "move" && geom.docked) return;
        e.preventDefault(); e.stopPropagation();
        const g0 = { ...geom }; const sx = e.clientX, sy = e.clientY;
        const move = (ev: PointerEvent) => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (mode === "move") setGeom({ ...g0, x: Math.max(0, g0.x + dx), y: Math.max(56, g0.y + dy) });
            else setGeom({ ...g0, w: Math.max(240, g0.w + dx), h: Math.max(170, g0.h + dy) });
        };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.userSelect = ""; };
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };

    const onCast = () => {
        const v = rootRef.current?.querySelector("video") as any;
        try { if (v?.remote?.prompt) v.remote.prompt(); else if (v?.webkitShowPlaybackTargetPicker) v.webkitShowPlaybackTargetPicker(); } catch {}
    };

    const stop = (e: React.PointerEvent) => e.stopPropagation();

    const style: React.CSSProperties = geom.docked
        ? { position: "fixed", right: 8, top: 64, bottom: 8, width: Math.max(280, geom.w), zIndex: 2000 }
        : { position: "fixed", left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: 2000 };

    const btn = "p-1.5 rounded-lg text-white/85 hover:text-white hover:bg-white/15 transition-colors";

    return (
        <div ref={rootRef} style={style} className="group rounded-2xl overflow-hidden shadow-lg vid-surface relative ring-1 ring-white/5">
            {/* Video */}
            <div className="absolute inset-0">{children}</div>

            {/* Aforo centrado (siempre visible) */}
            {isQ && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70" style={{ textShadow: "0 1px 6px rgba(0,0,0,.7)" }}>Aforo</span>
                        <span className="font-bold tabular-nums leading-none" style={{ color: col, fontSize: "clamp(2.5rem, 11vw, 5.5rem)", textShadow: "0 2px 14px rgba(0,0,0,.7)" }}>{aforo}</span>
                        <span className="text-xs font-bold text-white/60" style={{ textShadow: "0 1px 6px rgba(0,0,0,.7)" }}>/ {limit}</span>
                    </div>
                </div>
            )}

            {/* Barra de controles (overlay al hover) */}
            <div
                onPointerDown={startDrag("move")}
                className={`absolute top-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-b from-black/75 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${geom.docked ? "" : "cursor-move"}`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {!geom.docked && <Move size={13} className="text-white/70 shrink-0" />}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${device.online ? "bg-emerald-400" : "bg-red-400"}`} />
                    <span className="font-bold text-xs truncate text-white" style={{ textShadow: "0 1px 4px rgba(0,0,0,.8)" }}>{device.name}</span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0" onPointerDown={stop}>
                    <button title="Transmitir (Cast)" onClick={onCast} className={btn}><Cast size={14} /></button>
                    <button title="Guardar esta vista" onClick={onSave} className={btn}><Save size={14} /></button>
                    <button title={geom.docked ? "Desacoplar" : "Acoplar a la derecha"} onClick={() => setGeom({ ...geom, docked: !geom.docked })} className={btn}>{geom.docked ? <PanelRightClose size={14} /> : <PanelRight size={14} />}</button>
                    <button title="Cerrar" onClick={onClose} className="p-1.5 rounded-lg text-white/85 hover:text-white hover:bg-red-500/40 transition-colors"><X size={14} /></button>
                </div>
            </div>

            {/* IP (overlay al hover, abajo izquierda) */}
            <div className="absolute bottom-1.5 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <span className="text-[9px] font-mono text-white/70 px-1.5 py-0.5 rounded bg-black/50">{device.ip}</span>
            </div>

            {/* Handle de resize (overlay al hover) */}
            {!geom.docked && (
                <div onPointerDown={startDrag("resize")} title="Redimensionar" className="absolute bottom-0 right-0 w-7 h-7 cursor-se-resize z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-end p-1">
                    <div className="w-3.5 h-3.5" style={{ background: "linear-gradient(135deg, transparent 45%, rgba(255,255,255,.85) 45%, rgba(255,255,255,.85) 60%, transparent 60%, transparent 70%, rgba(255,255,255,.85) 70%, rgba(255,255,255,.85) 85%, transparent 85%)" }} />
                </div>
            )}
        </div>
    );
}
