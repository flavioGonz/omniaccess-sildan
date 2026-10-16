"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ptzAngleToDir } from "@/components/PtzControls";
import { tip } from "./TipVisor";

/**
 * El joystick PTZ de la cámara abierta (16/10, Nico: «en el liveview, los controles PTZ
 * estilizados tipo joystick»).
 *
 * Una perilla que se arrastra dentro de un círculo: el ángulo da la dirección (ocho, como el
 * pad) y la distancia al centro la velocidad (1 a 8). Al soltar vuelve al centro y la cámara se
 * frena. Al lado, el zoom: se mantiene apretado mientras acerca o aleja.
 *
 * Se manda sólo cuando cambia algo (dirección o velocidad): /api/devices/ptz arranca un
 * movimiento continuo en el equipo, y repetirlo a cada píxel del arrastre sólo llenaba la fila
 * del NVR. Un «stop» al soltar, al cancelar y al cerrar: una cámara que se queda girando es el
 * peor error posible acá.
 */
const RADIO = 64;
const PERILLA = 46;
/** Debajo de esta fracción del radio no se mueve: el dedo apoyado en el centro no es una orden. */
const ZONA_MUERTA = 0.18;

export function JoystickPtz({ deviceId, alCerrar }: { deviceId: string; alCerrar: () => void }) {
    const base = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [activo, setActivo] = useState(false);
    const [zoom, setZoom] = useState<"in" | "out" | null>(null);
    const ultimo = useRef<string>("");
    const enviar = (action: string, opts: Record<string, unknown> = {}) =>
        fetch(`/api/devices/ptz?deviceId=${encodeURIComponent(deviceId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...opts }) }).catch(() => { });
    const frenar = () => { if (ultimo.current) { ultimo.current = ""; void enviar("stop"); } };
    useEffect(() => () => { if (ultimo.current) void enviar("stop"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const mover = (clientX: number, clientY: number) => {
        const b = base.current?.getBoundingClientRect(); if (!b) return;
        let dx = clientX - (b.left + b.width / 2), dy = clientY - (b.top + b.height / 2);
        const d = Math.hypot(dx, dy);
        if (d > RADIO) { dx = (dx / d) * RADIO; dy = (dy / d) * RADIO; }
        setPos({ x: dx, y: dy });
        const f = Math.min(1, d / RADIO);
        if (f < ZONA_MUERTA) { frenar(); return; }
        const dir = ptzAngleToDir(Math.atan2(dy, dx));
        const speed = Math.max(1, Math.min(8, Math.round(1 + ((f - ZONA_MUERTA) / (1 - ZONA_MUERTA)) * 7)));
        const clave = `${dir}:${speed}`;
        if (clave !== ultimo.current) { ultimo.current = clave; void enviar("move", { dir, speed }); }
    };
    const soltar = () => { setActivo(false); setPos({ x: 0, y: 0 }); frenar(); };
    const fuerza = Math.min(1, Math.hypot(pos.x, pos.y) / RADIO);

    const zoomar = (z: "in" | "out" | null) => {
        setZoom(z);
        if (z) void enviar("move", { dir: z === "in" ? "zoomin" : "zoomout", speed: 5 }); else void enviar("stop");
    };

    return (
        <motion.div initial={{ opacity: 0, y: 16, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.94 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="rounded-[22px] visor-panel p-3 flex items-center gap-3 select-none touch-none">
            {/* La base: anillo, ocho marcas y la perilla. */}
            <div ref={base} className="relative grid place-items-center rounded-full cursor-grab active:cursor-grabbing"
                style={{ width: RADIO * 2 + PERILLA / 2, height: RADIO * 2 + PERILLA / 2, background: "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 62%, rgba(0,0,0,0.25))" }}
                onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } setActivo(true); mover(e.clientX, e.clientY); }}
                onPointerMove={(e) => { if (activo) mover(e.clientX, e.clientY); }}
                onPointerUp={soltar} onPointerCancel={soltar} onLostPointerCapture={() => { if (activo) soltar(); }}
                {...tip("Arrastrá para mover la cámara: más lejos del centro, más rápido")}>
                <span className="absolute inset-0 rounded-full ring-1 ring-white/15" />
                <span className="absolute rounded-full ring-1 ring-white/10" style={{ inset: PERILLA / 2 + 10 }} />
                {Array.from({ length: 8 }, (_, i) => (
                    <span key={i} className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -ml-[1.5px] -mt-[1.5px] rounded-full bg-white/45"
                        style={{ transform: `rotate(${i * 45}deg) translateY(-${RADIO + PERILLA / 4 - 4}px)` }} />
                ))}
                {/* La estela: hacia dónde va y con cuánta fuerza. */}
                {activo && fuerza > ZONA_MUERTA && (
                    <span className="absolute left-1/2 top-1/2 h-[3px] origin-left rounded-full bg-[var(--accion-en-oscuro)]/70"
                        style={{ width: Math.hypot(pos.x, pos.y), transform: `rotate(${Math.atan2(pos.y, pos.x)}rad)` }} />
                )}
                <motion.span className={cn("absolute grid place-items-center rounded-full ring-1 transition-colors",
                    activo ? "bg-[var(--accion-en-oscuro)] ring-white/70" : "bg-white/90 ring-white/40")}
                    style={{ width: PERILLA, height: PERILLA, boxShadow: "0 6px 18px rgba(0,0,0,0.45), inset 0 -3px 8px rgba(0,0,0,0.18)" }}
                    animate={{ x: pos.x, y: pos.y }} transition={activo ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 26 }}>
                    <span className={cn("h-3 w-3 rounded-full", activo ? "bg-white" : "bg-black/25")} />
                </motion.span>
            </div>

            <div className="flex flex-col items-center gap-2">
                {([["in", Plus, "Acercar (mantener)"], ["out", Minus, "Alejar (mantener)"]] as const).map(([z, I, t]) => (
                    <button key={z} type="button" {...tip(t)}
                        onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } zoomar(z); }}
                        onPointerUp={() => zoomar(null)} onPointerCancel={() => zoomar(null)}
                        className={cn("w-11 h-11 rounded-full grid place-items-center transition-colors", zoom === z ? "bg-[var(--accion-en-oscuro)] text-white" : "bg-white/10 text-white/90 hover:bg-white/20")}>
                        <I size={18} />
                    </button>
                ))}
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/50">Zoom</span>
                <button type="button" onClick={alCerrar} {...tip("Cerrar el joystick")} className="w-8 h-8 rounded-full grid place-items-center text-white/70 hover:text-white hover:bg-white/15"><X size={15} /></button>
            </div>
        </motion.div>
    );
}
