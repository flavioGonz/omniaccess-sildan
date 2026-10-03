"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Gauge, Joystick, Save, Play, Square, Bookmark, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";

export function ptzAngleToDir(rad: number): string {
    const deg = (rad * 180 / Math.PI + 360) % 360;
    if (deg >= 337.5 || deg < 22.5) return "right";
    if (deg < 67.5) return "downright";
    if (deg < 112.5) return "down";
    if (deg < 157.5) return "downleft";
    if (deg < 202.5) return "left";
    if (deg < 247.5) return "upleft";
    if (deg < 292.5) return "up";
    return "upright";
}

/**
 * Controles PTZ (Dahua/Hik vía /api/devices/ptz). Pad + zoom + velocidad + presets.
 * speed/onSpeed opcionales para compartir la velocidad con atajos de teclado/rueda/arrastre del modal.
 */
export function PtzControls({ deviceId, config = false, speed: speedProp, onSpeed, compact = false }:
    { deviceId: string; config?: boolean; speed?: number; onSpeed?: (n: number) => void; compact?: boolean }) {
    const [spInt, setSpInt] = useState(5);
    const speed = speedProp ?? spInt;
    const setSpeed = onSpeed ?? setSpInt;
    const [slot, setSlot] = useState(1);
    const [busy, setBusy] = useState<string | null>(null);
    const send = (action: string, opts: any = {}) => fetch(`/api/devices/ptz?deviceId=${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, speed, ...opts }) }).catch(() => { });

    const hold = (dir: string) => ({
        onPointerDown: (e: any) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); send("move", { dir }); },
        onPointerUp: (e: any) => { e.stopPropagation(); send("stop", { dir }); },
        onPointerLeave: () => { send("stop", { dir }); },
        onClick: (e: any) => e.stopPropagation(),
    });
    const Pad = ({ dir, children }: { dir: string; children: any }) => (
        <motion.button whileTap={{ scale: 0.86 }} {...hold(dir)}
            className="group/pb relative grid place-items-center h-9 w-9 rounded-xl bg-white/[0.06] hover:bg-white/15 ring-1 ring-white/10 text-white/80 hover:text-white active:bg-red-500/80 active:text-white transition-colors">
            {children}
        </motion.button>
    );

    return (
        <motion.div initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 26 }}
            onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
            className="w-[208px] rounded-2xl bg-gradient-to-b from-neutral-900/80 to-black/70 backdrop-blur-2xl ring-1 ring-white/12 shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden select-none touch-none">
            {/* header */}
            <div className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-red-500/15 to-transparent border-b border-white/[0.06]">
                <Joystick size={13} className="text-red-400" />
                <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/80">Control PTZ</span>
            </div>

            <div className="p-3 flex flex-col items-center gap-3">
                {/* D-pad con joystick central */}
                <div className="relative grid grid-cols-3 gap-1.5">
                    <Pad dir="upleft"><ChevronUp size={16} className="-rotate-45" /></Pad>
                    <Pad dir="up"><ChevronUp size={17} /></Pad>
                    <Pad dir="upright"><ChevronUp size={16} className="rotate-45" /></Pad>
                    <Pad dir="left"><ChevronLeft size={17} /></Pad>
                    <div className="grid place-items-center h-9 w-9 rounded-full bg-white/[0.04] ring-1 ring-white/10"><Joystick size={14} className="text-white/35" /></div>
                    <Pad dir="right"><ChevronRight size={17} /></Pad>
                    <Pad dir="downleft"><ChevronDown size={16} className="rotate-45" /></Pad>
                    <Pad dir="down"><ChevronDown size={17} /></Pad>
                    <Pad dir="downright"><ChevronDown size={16} className="-rotate-45" /></Pad>
                </div>

                {/* zoom */}
                <div className="w-full flex items-center gap-2">
                    <motion.button whileTap={{ scale: 0.9 }} {...hold("zoomout")} className="grid place-items-center h-8 flex-1 rounded-lg bg-white/[0.06] hover:bg-white/15 ring-1 ring-white/10 text-white/80 hover:text-white active:bg-red-500/80 transition"><ZoomOut size={15} /></motion.button>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Zoom</span>
                    <motion.button whileTap={{ scale: 0.9 }} {...hold("zoomin")} className="grid place-items-center h-8 flex-1 rounded-lg bg-white/[0.06] hover:bg-white/15 ring-1 ring-white/10 text-white/80 hover:text-white active:bg-red-500/80 transition"><ZoomIn size={15} /></motion.button>
                </div>

                {/* velocidad */}
                <div className="w-full flex items-center gap-2">
                    <Gauge size={13} className="text-white/45 shrink-0" />
                    <input type="range" min={1} max={8} value={speed} onChange={(e) => setSpeed(parseInt(e.target.value))} onClick={(e) => e.stopPropagation()} className="w-full accent-red-500 h-1 cursor-pointer" />
                    <span className="text-[10px] font-bold tabular-nums text-white/70 w-4 text-right">{speed}</span>
                </div>

                {/* presets ir */}
                <div className="w-full">
                    <div className="text-[8.5px] font-bold uppercase tracking-widest text-white/35 mb-1">Presets</div>
                    <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                            <motion.button whileTap={{ scale: 0.86 }} key={n} onClick={(e) => { e.stopPropagation(); send("preset", { preset: n }); }} data-tooltip-id="mi-tip" data-tooltip-content={`Ir a preset ${n}`}
                                className="grid place-items-center flex-1 h-7 rounded-md bg-white/[0.06] hover:bg-red-500/60 ring-1 ring-white/10 text-white/80 hover:text-white text-[11px] font-bold transition">{n}</motion.button>
                        ))}
                    </div>
                </div>

                {/* CONFIG: guardar preset + crucero */}
                {config && (
                    <div className="w-full pt-2.5 border-t border-white/10 flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                            <Bookmark size={12} className="text-amber-400 shrink-0" />
                            <span className="text-[10px] font-bold text-white/70">Guardar posición</span>
                            <select value={slot} onChange={(e) => setSlot(parseInt(e.target.value))} onClick={(e) => e.stopPropagation()} className="ml-auto bg-white/10 rounded-md text-[11px] text-white px-1.5 py-0.5 outline-none">
                                {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n} className="bg-neutral-900">P{n}</option>)}
                            </select>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("setpreset", { preset: slot }); setBusy("set"); setTimeout(() => setBusy((b) => b === "set" ? null : b), 600); }}
                                className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition", busy === "set" ? "bg-emerald-500 text-white" : "bg-amber-500/80 hover:bg-amber-500 text-black")}><Save size={12} /> {busy === "set" ? "OK" : "Set"}</motion.button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-white/70">Crucero</span>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("tourstart", { preset: 1 }); }} className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600/80 hover:bg-emerald-500 text-white text-[10px] font-bold transition"><Play size={11} /> Iniciar</motion.button>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("tourstop", { preset: 1 }); }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 text-[10px] font-bold transition"><Square size={11} /> Parar</motion.button>
                        </div>
                    </div>
                )}

                {/* hint teclado/mouse */}
                {!compact && (
                    <div className="w-full flex items-center gap-1.5 text-[8.5px] text-white/35 leading-tight pt-0.5">
                        <Keyboard size={11} className="shrink-0" /> Flechas mueven · +/− zoom · rueda o arrastrá sobre el video
                    </div>
                )}
            </div>
        </motion.div>
    );
}
