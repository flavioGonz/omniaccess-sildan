"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useDragControls, useMotionValue, animate } from "framer-motion";
import { ZoomIn, ZoomOut, Gauge, Joystick, Save, Play, Square, Bookmark, GripHorizontal, Crosshair } from "lucide-react";
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

const RADIO = 52;       // recorrido máximo de la palanca (px)
const MUERTA = 0.16;    // zona muerta (fracción del radio)
const ANG: Record<string, number> = { right: 0, downright: 45, down: 90, downleft: 135, left: 180, upleft: 225, up: 270, upright: 315 };

/**
 * Control PTZ estilo palanca de videojuego de celular: se arrastra la perilla y la cámara se
 * mueve hacia ese lado, más rápido cuanto más lejos del centro (hasta la velocidad máxima
 * elegida). Al soltar, la perilla vuelve al centro y la cámara se detiene. A la derecha, el
 * zoom como gatillo (mantener). El panel flota y se puede arrastrar desde la manija.
 * Dahua/Hik vía /api/devices/ptz. Misma API que antes (deviceId, config, speed, onSpeed, compact).
 */
export function PtzControls({ deviceId, config = false, speed: speedProp, onSpeed, compact = false }:
    { deviceId: string; config?: boolean; speed?: number; onSpeed?: (n: number) => void; compact?: boolean }) {
    const [spInt, setSpInt] = useState(6);
    const vmax = speedProp ?? spInt;
    const setVmax = onSpeed ?? setSpInt;
    const [slot, setSlot] = useState(1);
    const [guardado, setGuardado] = useState(false);
    const [activo, setActivo] = useState<{ dir: string; v: number; f: number } | null>(null);
    const [zoom, setZoom] = useState<"in" | "out" | null>(null);
    const arrastre = useDragControls();
    const x = useMotionValue(0), y = useMotionValue(0);
    const base = useRef<HTMLDivElement>(null);
    const ultimo = useRef<{ dir: string; v: number } | null>(null);
    const latido = useRef<any>(null);

    const send = (action: string, opts: any = {}) => fetch(`/api/devices/ptz?deviceId=${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, speed: vmax, ...opts }) }).catch(() => { });

    const mover = (dir: string, v: number) => {
        const u = ultimo.current;
        if (u && u.dir === dir && u.v === v) return;
        ultimo.current = { dir, v };
        try { if (!u || u.dir !== dir) navigator.vibrate?.(8); } catch { }
        send("move", { dir, speed: v });
    };
    const parar = () => {
        const u = ultimo.current;
        ultimo.current = null;
        if (u) send("stop", { dir: u.dir });
    };
    // Re-envío periódico mientras se sostiene (algunos equipos cortan el movimiento continuo solos).
    useEffect(() => {
        if (!activo) { clearInterval(latido.current); return; }
        clearInterval(latido.current);
        latido.current = setInterval(() => { const u = ultimo.current; if (u) send("move", { dir: u.dir, speed: u.v }); }, 1800);
        return () => clearInterval(latido.current);
    }, [activo?.dir]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => { clearInterval(latido.current); parar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const actualizar = (cx: number, cy: number) => {
        const r = base.current?.getBoundingClientRect(); if (!r) return;
        let dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy);
        if (d > RADIO) { dx = dx / d * RADIO; dy = dy / d * RADIO; }
        x.set(dx); y.set(dy);
        const f = Math.min(1, d / RADIO);
        if (f < MUERTA) { setActivo(null); parar(); return; }
        const dir = ptzAngleToDir(Math.atan2(dy, dx));
        const v = Math.max(1, Math.round(((f - MUERTA) / (1 - MUERTA)) * vmax));
        setActivo({ dir, v, f });
        mover(dir, v);
    };
    const soltar = () => {
        animate(x, 0, { type: "spring", stiffness: 520, damping: 26 });
        animate(y, 0, { type: "spring", stiffness: 520, damping: 26 });
        setActivo(null); parar();
    };

    const gatillo = (dir: "zoomin" | "zoomout") => ({
        onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setZoom(dir === "zoomin" ? "in" : "out"); try { navigator.vibrate?.(8); } catch { } send("move", { dir }); },
        onPointerUp: (e: React.PointerEvent) => { e.stopPropagation(); setZoom(null); send("stop", { dir }); },
        onPointerCancel: () => { setZoom(null); send("stop", { dir }); },
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
    });

    const anguloActivo = activo ? ANG[activo.dir] : null;

    return (
        <motion.div drag dragListener={false} dragControls={arrastre} dragMomentum={false} dragElastic={0}
            initial={{ opacity: 0, scale: 0.92, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 26 }}
            onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
            className="w-[272px] rounded-[22px] bg-gradient-to-b from-neutral-900/85 to-black/75 backdrop-blur-2xl ring-1 ring-white/12 shadow-[0_12px_48px_rgba(0,0,0,0.65)] overflow-hidden select-none touch-none">
            {/* manija: arrastrar el panel */}
            <div onPointerDown={(e) => { e.stopPropagation(); arrastre.start(e); }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-red-500/20 via-red-500/5 to-transparent border-b border-white/[0.06] cursor-grab active:cursor-grabbing">
                <Joystick size={13} className="text-red-400" />
                <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/85">Control PTZ</span>
                <span className="ml-auto text-[9.5px] font-bold tabular-nums text-white/50">{activo ? `${activo.dir.toUpperCase()} · v${activo.v}` : zoom ? `ZOOM ${zoom === "in" ? "+" : "−"}` : "listo"}</span>
                <GripHorizontal size={13} className="text-white/30" />
            </div>

            <div className="p-3.5 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                    {/* Palanca */}
                    <div ref={base}
                        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); actualizar(e.clientX, e.clientY); }}
                        onPointerMove={(e) => { if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) actualizar(e.clientX, e.clientY); }}
                        onPointerUp={soltar} onPointerCancel={soltar}
                        className="relative h-[148px] w-[148px] shrink-0 rounded-full cursor-grab active:cursor-grabbing"
                        style={{ background: "radial-gradient(circle at 50% 40%, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 62%, rgba(0,0,0,0.35))", boxShadow: "inset 0 2px 14px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
                        {/* marcas de dirección */}
                        {Object.entries(ANG).map(([k, a]) => (
                            <span key={k} className={cn("absolute left-1/2 top-1/2 h-[3px] rounded-full transition-all duration-150", activo?.dir === k ? "w-4 bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]" : "w-2.5 bg-white/25")}
                                style={{ transform: `rotate(${a}deg) translateX(62px) translateY(-50%)`, transformOrigin: "0 0" }} />
                        ))}
                        {/* arco de intensidad hacia la dirección */}
                        {anguloActivo !== null && (
                            <span className="absolute inset-0 rounded-full pointer-events-none transition-opacity"
                                style={{ background: `conic-gradient(from ${anguloActivo + 90 - 30}deg, rgba(239,68,68,${0.15 + (activo?.f || 0) * 0.45}) 0deg, transparent 60deg, transparent 360deg)`, maskImage: "radial-gradient(circle, transparent 52%, black 54%)", WebkitMaskImage: "radial-gradient(circle, transparent 52%, black 54%)" }} />
                        )}
                        <span className="absolute inset-[34%] rounded-full border border-dashed border-white/10 pointer-events-none" />
                        {/* perilla */}
                        <motion.div style={{ x, y }}
                            className={cn("absolute left-1/2 top-1/2 -ml-[30px] -mt-[30px] h-[60px] w-[60px] rounded-full grid place-items-center pointer-events-none transition-shadow",
                                activo ? "shadow-[0_0_0_4px_rgba(239,68,68,0.25),0_8px_22px_rgba(0,0,0,0.6)]" : "shadow-[0_8px_22px_rgba(0,0,0,0.6)]")}>
                            <span className="absolute inset-0 rounded-full" style={{ background: activo ? "radial-gradient(circle at 35% 30%, #fca5a5, #ef4444 45%, #991b1b)" : "radial-gradient(circle at 35% 30%, #e5e5e5, #737373 50%, #262626)" }} />
                            <span className="absolute inset-[18%] rounded-full border border-white/25" />
                            <Crosshair size={16} className="relative text-white/80" />
                        </motion.div>
                    </div>

                    {/* Gatillos de zoom */}
                    <div className="flex-1 flex flex-col items-center gap-2">
                        <motion.button whileTap={{ scale: 0.9 }} {...gatillo("zoomin")} data-tooltip-id="mi-tip" data-tooltip-content="Acercar (mantener)"
                            className={cn("w-full h-[62px] rounded-2xl grid place-items-center ring-1 transition-colors", zoom === "in" ? "bg-red-500 ring-red-400 text-white shadow-[0_0_18px_rgba(239,68,68,0.6)]" : "bg-white/[0.07] ring-white/10 text-white/80 hover:bg-white/15")}>
                            <ZoomIn size={20} />
                        </motion.button>
                        <span className="text-[8.5px] font-bold uppercase tracking-[0.2em] text-white/40">Zoom</span>
                        <motion.button whileTap={{ scale: 0.9 }} {...gatillo("zoomout")} data-tooltip-id="mi-tip" data-tooltip-content="Alejar (mantener)"
                            className={cn("w-full h-[62px] rounded-2xl grid place-items-center ring-1 transition-colors", zoom === "out" ? "bg-red-500 ring-red-400 text-white shadow-[0_0_18px_rgba(239,68,68,0.6)]" : "bg-white/[0.07] ring-white/10 text-white/80 hover:bg-white/15")}>
                            <ZoomOut size={20} />
                        </motion.button>
                    </div>
                </div>

                {/* Velocidad máxima */}
                <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] px-2.5 py-2">
                    <Gauge size={13} className="text-white/50 shrink-0" />
                    <span className="text-[9.5px] font-bold uppercase tracking-wider text-white/50">Vel. máx</span>
                    <div className="flex-1 flex items-center gap-[3px]">
                        {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                            <button key={n} type="button" onClick={(e) => { e.stopPropagation(); setVmax(n); }}
                                className={cn("flex-1 rounded-[3px] transition-all", n <= vmax ? "bg-red-500" : "bg-white/12 hover:bg-white/25")} style={{ height: 6 + n * 1.6 }} />
                        ))}
                    </div>
                    <span className="text-[10.5px] font-bold tabular-nums text-white/80 w-3 text-right">{vmax}</span>
                </div>

                {/* Presets */}
                <div>
                    <div className="text-[8.5px] font-bold uppercase tracking-widest text-white/35 mb-1">Presets</div>
                    <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                            <motion.button whileTap={{ scale: 0.86 }} key={n} onClick={(e) => { e.stopPropagation(); send("preset", { preset: n }); }} data-tooltip-id="mi-tip" data-tooltip-content={`Ir a preset ${n}`}
                                className="grid place-items-center flex-1 h-8 rounded-lg bg-white/[0.06] hover:bg-red-500/70 ring-1 ring-white/10 text-white/80 hover:text-white text-[11.5px] font-bold transition">{n}</motion.button>
                        ))}
                    </div>
                </div>

                {config && (
                    <div className="pt-2.5 border-t border-white/10 flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                            <Bookmark size={12} className="text-amber-400 shrink-0" />
                            <span className="text-[10px] font-bold text-white/70">Guardar posición</span>
                            <select value={slot} onChange={(e) => setSlot(parseInt(e.target.value))} onClick={(e) => e.stopPropagation()} className="ml-auto bg-white/10 rounded-md text-[11px] text-white px-1.5 py-0.5 outline-none">
                                {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n} className="bg-neutral-900">P{n}</option>)}
                            </select>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("setpreset", { preset: slot }); setGuardado(true); setTimeout(() => setGuardado(false), 900); }}
                                className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition", guardado ? "bg-emerald-500 text-white" : "bg-amber-500/80 hover:bg-amber-500 text-black")}><Save size={12} /> {guardado ? "OK" : "Set"}</motion.button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-white/70">Crucero</span>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("tourstart", { preset: 1 }); }} className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600/80 hover:bg-emerald-500 text-white text-[10px] font-bold transition"><Play size={11} /> Iniciar</motion.button>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("tourstop", { preset: 1 }); }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/80 text-[10px] font-bold transition"><Square size={11} /> Parar</motion.button>
                        </div>
                    </div>
                )}

                {!compact && (
                    <p className="text-[8.5px] text-white/35 leading-tight text-center">Arrastrá la palanca: más lejos del centro, más rápido · Soltá para frenar · Flechas y +/− también</p>
                )}
            </div>
        </motion.div>
    );
}
