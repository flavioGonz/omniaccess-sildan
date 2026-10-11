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

    const vidrio = "bg-black/35 backdrop-blur-md ring-1 ring-white/15 shadow-[0_6px_24px_rgba(0,0,0,0.45)]";
    return (
        <motion.div drag dragListener={false} dragControls={arrastre} dragMomentum={false} dragElastic={0}
            initial={{ opacity: 0, scale: 0.92, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 26 }}
            onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
            className="relative flex flex-col items-end gap-2 select-none touch-none">
            {/* manija + estado: una píldora chica, sin panel */}
            <div onPointerDown={(e) => { e.stopPropagation(); arrastre.start(e); }}
                className={cn("flex items-center gap-1.5 h-7 px-2.5 rounded-full cursor-grab active:cursor-grabbing", vidrio)} data-tooltip-id="mi-tip" data-tooltip-content="Arrastrá para mover los controles">
                <GripHorizontal size={12} className="text-white/60" />
                <Joystick size={12} className={activo || zoom ? "text-red-400" : "text-white/70"} />
                <span className="text-[9.5px] font-bold uppercase tracking-wider tabular-nums text-white/85">{activo ? `${activo.dir} · v${activo.v}` : zoom ? `zoom ${zoom === "in" ? "+" : "−"}` : "PTZ"}</span>
            </div>

            <div className="flex items-end gap-3">
                {/* Gatillos de zoom (izquierda de la palanca, a mano del pulgar) */}
                <div className="flex flex-col items-center gap-2">
                    <motion.button whileTap={{ scale: 0.88 }} {...gatillo("zoomin")} data-tooltip-id="mi-tip" data-tooltip-content="Acercar (mantener)"
                        className={cn("h-12 w-12 rounded-full grid place-items-center transition-colors", zoom === "in" ? "bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.7)]" : cn(vidrio, "text-white/90 hover:bg-black/55"))}>
                        <ZoomIn size={19} />
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.88 }} {...gatillo("zoomout")} data-tooltip-id="mi-tip" data-tooltip-content="Alejar (mantener)"
                        className={cn("h-12 w-12 rounded-full grid place-items-center transition-colors", zoom === "out" ? "bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.7)]" : cn(vidrio, "text-white/90 hover:bg-black/55"))}>
                        <ZoomOut size={19} />
                    </motion.button>
                </div>

                {/* Palanca flotante */}
                <div ref={base}
                    onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); actualizar(e.clientX, e.clientY); }}
                    onPointerMove={(e) => { if ((e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) actualizar(e.clientX, e.clientY); }}
                    onPointerUp={soltar} onPointerCancel={soltar}
                    className="relative h-[148px] w-[148px] shrink-0 rounded-full cursor-grab active:cursor-grabbing backdrop-blur-[3px] transition-opacity opacity-80 hover:opacity-100"
                    style={{ background: "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.10), rgba(0,0,0,0.28) 70%)", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.22), 0 6px 26px rgba(0,0,0,0.35)" }}>
                    {Object.entries(ANG).map(([k, a]) => (
                        <span key={k} className={cn("absolute left-1/2 top-1/2 h-[3px] rounded-full transition-all duration-150", activo?.dir === k ? "w-4 bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]" : "w-2.5 bg-white/40")}
                            style={{ transform: `rotate(${a}deg) translateX(62px) translateY(-50%)`, transformOrigin: "0 0" }} />
                    ))}
                    {anguloActivo !== null && (
                        <span className="absolute inset-0 rounded-full pointer-events-none"
                            style={{ background: `conic-gradient(from ${anguloActivo + 90 - 30}deg, rgba(239,68,68,${0.2 + (activo?.f || 0) * 0.5}) 0deg, transparent 60deg, transparent 360deg)`, maskImage: "radial-gradient(circle, transparent 52%, black 54%)", WebkitMaskImage: "radial-gradient(circle, transparent 52%, black 54%)" }} />
                    )}
                    <motion.div style={{ x, y }}
                        className={cn("absolute left-1/2 top-1/2 -ml-[29px] -mt-[29px] h-[58px] w-[58px] rounded-full grid place-items-center pointer-events-none",
                            activo ? "shadow-[0_0_0_4px_rgba(239,68,68,0.3),0_8px_22px_rgba(0,0,0,0.55)]" : "shadow-[0_8px_22px_rgba(0,0,0,0.55)]")}>
                        <span className="absolute inset-0 rounded-full" style={{ background: activo ? "radial-gradient(circle at 35% 30%, #fecaca, #ef4444 45%, #991b1b)" : "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(160,160,160,0.85) 50%, rgba(40,40,40,0.9))" }} />
                        <span className="absolute inset-[18%] rounded-full border border-white/30" />
                        <Crosshair size={15} className="relative text-white/85" />
                    </motion.div>
                </div>
            </div>

            {/* Velocidad + presets: una tira fina */}
            <div className={cn("flex items-center gap-2 h-8 pl-2.5 pr-1 rounded-full", vidrio)}>
                <Gauge size={12} className="text-white/60 shrink-0" />
                <div className="flex items-end gap-[2px] h-4" data-tooltip-id="mi-tip" data-tooltip-content={`Velocidad máxima ${vmax}/8`}>
                    {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" onClick={(e) => { e.stopPropagation(); setVmax(n); }}
                            className={cn("w-[5px] rounded-[2px] transition-all", n <= vmax ? "bg-red-500" : "bg-white/25 hover:bg-white/50")} style={{ height: 4 + n * 1.5 }} />
                    ))}
                </div>
                <span className="w-px h-4 bg-white/20 mx-0.5" />
                {[1, 2, 3, 4, 5, 6].map((n) => (
                    <motion.button whileTap={{ scale: 0.85 }} key={n} onClick={(e) => { e.stopPropagation(); send("preset", { preset: n }); }} data-tooltip-id="mi-tip" data-tooltip-content={`Ir a preset ${n}`}
                        className="h-6 w-6 rounded-full grid place-items-center text-[10.5px] font-bold text-white/85 hover:bg-red-500 hover:text-white transition">{n}</motion.button>
                ))}
            </div>

            {config && (
                <div className={cn("flex items-center gap-1.5 h-8 px-2 rounded-full", vidrio)}>
                    <Bookmark size={12} className="text-amber-400" />
                    <select value={slot} onChange={(e) => setSlot(parseInt(e.target.value))} onClick={(e) => e.stopPropagation()} className="bg-transparent text-[11px] text-white outline-none">
                        {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n} className="bg-neutral-900">P{n}</option>)}
                    </select>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("setpreset", { preset: slot }); setGuardado(true); setTimeout(() => setGuardado(false), 900); }} data-tooltip-id="mi-tip" data-tooltip-content="Guardar la posición actual en este preset"
                        className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-bold", guardado ? "bg-emerald-500 text-white" : "bg-amber-500/90 text-black")}><Save size={11} /> {guardado ? "OK" : "Guardar"}</motion.button>
                    <span className="w-px h-4 bg-white/20" />
                    <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("tourstart", { preset: 1 }); }} data-tooltip-id="mi-tip" data-tooltip-content="Iniciar recorrido" className="h-6 w-6 rounded-full grid place-items-center bg-emerald-600/90 text-white"><Play size={11} /></motion.button>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); send("tourstop", { preset: 1 }); }} data-tooltip-id="mi-tip" data-tooltip-content="Parar recorrido" className="h-6 w-6 rounded-full grid place-items-center bg-white/15 text-white"><Square size={11} /></motion.button>
                </div>
            )}
        </motion.div>
    );
}
