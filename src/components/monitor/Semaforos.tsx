"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import { TrafficCone, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaCorta } from "@/lib/monitor/cliente";

export type EstadoSemaforo = {
    deviceId: string; nombre: string; garita: string; sentido: string;
    ultima: { id: string; ts: string; plate: string | null; decision: string; rele: boolean } | null;
};

/** Que luz tiene AHORA una camara: verde mientras dura el pulso del rele; si no, rojo. */
export function luzDe(c: EstadoSemaforo, seg: number, ahora = Date.now()): "verde" | "rojo-nuevo" | "rojo" {
    const u = c.ultima; if (!u) return "rojo";
    const edad = ahora - new Date(u.ts).getTime();
    if (edad < 0 || edad > seg * 1000) return "rojo";
    return u.rele ? "verde" : "rojo-nuevo";
}

/** Una lampara del semaforo (redonda, con brillo cuando esta prendida). */
function Lampara({ color, prendida, latido, chica }: { color: "rojo" | "verde"; prendida: boolean; latido?: boolean; chica?: boolean }) {
    const base = color === "verde" ? "#22c55e" : "#ef4444";
    return (
        <motion.span
            className={cn("block rounded-full border border-black/60", chica ? "h-3.5 w-3.5" : "h-6 w-6")}
            animate={prendida
                ? { backgroundColor: base, boxShadow: `0 0 ${chica ? 8 : 16}px ${base}, inset 0 0 6px rgba(255,255,255,.45)`, opacity: latido ? [1, 0.55, 1] : 1 }
                : { backgroundColor: color === "verde" ? "#0f2a18" : "#2a1010", boxShadow: "inset 0 0 6px rgba(0,0,0,.8)", opacity: 1 }}
            transition={latido ? { duration: 0.9, repeat: Infinity } : { duration: 0.18 }}
        />
    );
}

/** El semaforo de una camara: rojo arriba, verde abajo, como el de la garita. */
export function Semaforo({ luz, chico }: { luz: "verde" | "rojo-nuevo" | "rojo"; chico?: boolean }) {
    return (
        <span className={cn("inline-flex flex-col items-center gap-1 rounded-lg bg-neutral-950 border border-white/15", chico ? "p-1" : "p-1.5")}>
            <Lampara color="rojo" prendida={luz !== "verde"} latido={luz === "rojo-nuevo"} chica={chico} />
            <Lampara color="verde" prendida={luz === "verde"} chica={chico} />
        </span>
    );
}

/**
 * Las garitas del barrio con el semaforo de cada lectora. Verde = la camara encontro la
 * matricula en su lista y disparo el rele (persona conocida). Rojo que late = acaba de leer a
 * alguien que NO esta en la lista. Rojo quieto = en reposo.
 */
export function PanelSemaforos({ camaras, seg, alTocar }: { camaras: EstadoSemaforo[]; seg: number; alTocar?: (lecturaId: string) => void }) {
    const garitas = useMemo(() => {
        const m = new Map<string, EstadoSemaforo[]>();
        for (const c of camaras) m.set(c.garita, [...(m.get(c.garita) || []), c]);
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));
    }, [camaras]);
    if (!camaras.length) return null;
    const ahora = Date.now();
    return (
        <div className="rounded-2xl bg-card border border-border p-3 lg:p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <TrafficCone size={14} /> Semáforos de garita
                <span className="ml-auto normal-case tracking-normal font-normal text-[12px]"
                    data-tooltip-id="tt-semaforo" data-tooltip-content={`Verde: la cámara encontró la matrícula en su lista y su relé prendió el semáforo (persona conocida). Rojo que late: acaba de leer a alguien que no está en la lista. Se apaga a los ${seg} s, como el pulso del relé.`}>
                    ¿qué indica?
                </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {garitas.map(([garita, cams]) => (
                    <div key={garita} className="rounded-xl bg-muted/40 border border-border p-2">
                        <div className="text-[12px] font-black uppercase tracking-wider text-muted-foreground mb-1.5">Garita {garita}</div>
                        <div className="flex flex-col gap-1.5">
                            {cams.map((c) => {
                                const luz = luzDe(c, seg, ahora);
                                const u = c.ultima;
                                return (
                                    <button key={c.deviceId} type="button" disabled={!u || !alTocar} onClick={() => u && alTocar?.(u.id)}
                                        data-tooltip-id="tt-semaforo"
                                        data-tooltip-content={u ? `${c.nombre} · ${u.plate || "S/L"} a las ${horaCorta(u.ts)} · ${u.rele ? "relé disparado (en la lista)" : u.decision === "GRANT" ? "permitido por el servidor, el relé no disparó" : "no está en la lista"}` : `${c.nombre} · sin lecturas en 7 días`}
                                        className={cn("flex items-center gap-2 rounded-lg px-1.5 py-1 text-left min-h-[44px]", u && alTocar && "active:scale-[0.98] transition-transform")}>
                                        <Semaforo luz={luz} chico />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                                                {c.sentido === "EXIT" ? <LogOut size={12} /> : <LogIn size={12} />}{c.sentido === "EXIT" ? "Salida" : "Entrada"}
                                            </span>
                                            <span className={cn("block text-[15px] font-bold tabular-nums tracking-[0.08em] truncate", luz === "verde" ? "text-[#22c55e]" : luz === "rojo-nuevo" ? "text-[#ef4444]" : "text-foreground/70")}>
                                                {u ? (u.plate || "S/L") : "—"}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
            <Tooltip id="tt-semaforo" place="left" className="!max-w-[320px] !text-[13px] !rounded-lg !z-[70]" />
        </div>
    );
}
