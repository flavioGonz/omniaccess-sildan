"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LogIn, LogOut, Camera, ParkingCircle, Loader2, ShieldCheck, ShieldX, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type PasoFlujo = {
    id: string;
    tipo: "ACCESO" | "PASO" | "ESTACIONADO";
    momento: string;
    camara: string | null;
    decision: string | null;
    sentido: string | null;
    confianza: number | null;
    foto: string | null;
    estDesde: string | null;
    estHasta: string | null;
    desdeAnterior: number | null;
};

const hora = (t: string) => new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const lapso = (seg: number) => {
    if (seg < 60) return `${Math.round(seg)} s`;
    if (seg < 3600) return `${Math.round(seg / 60)} min`;
    const h = Math.floor(seg / 3600);
    return `${h} h ${Math.round((seg % 3600) / 60)} min`;
};

/** Qué distingue a cada clase de paso, de un vistazo. */
function rasgo(p: PasoFlujo) {
    if (p.tipo === "ESTACIONADO") {
        return { Ico: ParkingCircle, color: "text-slate-300", fondo: "bg-slate-500/20 border-slate-400/35", rotulo: "Estacionado" };
    }
    if (p.tipo === "PASO") {
        return { Ico: Camera, color: "text-violet-300", fondo: "bg-violet-500/20 border-violet-400/35", rotulo: "Pasó" };
    }
    if (p.decision === "DENY") {
        return { Ico: ShieldX, color: "text-rose-300", fondo: "bg-rose-500/20 border-rose-400/35", rotulo: "Denegado" };
    }
    const salida = p.sentido === "EXIT";
    return {
        Ico: salida ? LogOut : LogIn,
        color: salida ? "text-amber-300" : "text-emerald-300",
        fondo: salida ? "bg-amber-500/20 border-amber-400/35" : "bg-emerald-500/20 border-emerald-400/35",
        rotulo: salida ? "Salida" : "Entrada",
    };
}

/**
 * El recorrido de una matrícula, como una fila de pasos.
 *
 * Una fila del historial dice dónde estuvo el vehículo en un instante. Eso casi nunca es
 * la pregunta: la pregunta es de dónde venía y a dónde fue. Acá se ven las dos cosas que
 * una tabla no puede mostrar sin repetirse — el ORDEN de las cámaras y el TIEMPO entre
 * una y otra.
 *
 * Entre dos pasos se muestra solo el tiempo. No hay distancia ni velocidad porque las
 * posiciones de las cámaras en el mapa todavía no están verificadas, y un número
 * derivado de ellas sería inventado.
 */
export function FlujoMatricula({ plate, at, onVerFoto }: {
    plate: string;
    at: string;
    onVerFoto?: (p: PasoFlujo) => void;
}) {
    const [pasos, setPasos] = useState<PasoFlujo[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        setPasos(null); setError(null);
        fetch(`/api/history/flujo?plate=${encodeURIComponent(plate)}&at=${encodeURIComponent(at)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => { if (vivo) { if (j.error) setError(j.error); else setPasos(j.pasos || []); } })
            .catch(() => { if (vivo) setError("No se pudo consultar el recorrido"); });
        return () => { vivo = false; };
    }, [plate, at]);

    if (error) return <p className="px-5 py-4 text-xs text-rose-400">{error}</p>;

    if (!pasos) {
        return (
            <div className="px-5 py-5 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin" /> Buscando el recorrido de {plate}…
            </div>
        );
    }

    if (pasos.length <= 1) {
        return (
            <p className="px-5 py-4 text-xs text-muted-foreground">
                Una sola detección de <span className="font-mono font-bold text-foreground">{plate}</span> en esta
                ventana. No hay recorrido que mostrar: el vehículo no volvió a aparecer en ninguna otra cámara.
            </p>
        );
    }

    return (
        <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Recorrido de {plate}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                    {pasos.length} detecciones · {lapso(
                        (new Date(pasos[pasos.length - 1].momento).getTime() - new Date(pasos[0].momento).getTime()) / 1000,
                    )} entre la primera y la última
                </span>
            </div>

            <div className="flex items-stretch gap-0 overflow-x-auto pb-2 omni-sin-barra">
                {pasos.map((p, i) => {
                    const { Ico, color, fondo, rotulo } = rasgo(p);
                    const actual = p.momento === at;
                    return (
                        <div key={p.id} className="flex items-stretch shrink-0">
                            {/* El tiempo que pasó desde el paso anterior, sobre el conector */}
                            {i > 0 && (
                                <div className="flex flex-col items-center justify-center px-1.5 min-w-[68px]">
                                    <span className="text-[9.5px] font-semibold text-sky-300/70 tabular-nums whitespace-nowrap">
                                        {lapso(p.desdeAnterior ?? 0)}
                                    </span>
                                    <span className="mt-1 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                                </div>
                            )}

                            <motion.button
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: Math.min(i, 10) * 0.035 }}
                                onClick={() => p.foto && onVerFoto?.(p)}
                                className={cn(
                                    "relative w-[132px] rounded-xl border px-2.5 py-2 text-left transition-colors",
                                    fondo,
                                    p.foto ? "cursor-pointer hover:brightness-125" : "cursor-default",
                                    actual && "ring-2 ring-white/45",
                                )}
                            >
                                <div className="flex items-center gap-1.5">
                                    <Ico size={12} className={cn("shrink-0", color)} />
                                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", color)}>{rotulo}</span>
                                </div>
                                <p className="mt-1 text-[11.5px] font-semibold text-foreground truncate" title={p.camara || ""}>
                                    {p.camara || "—"}
                                </p>
                                <p className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-1">
                                    <Clock size={9} className="shrink-0 opacity-60" />
                                    {hora(p.momento)}
                                </p>
                                {p.tipo === "ESTACIONADO" && p.estDesde && (
                                    <p className="text-[9.5px] text-slate-300/80 mt-0.5">
                                        quieto {lapso((new Date(p.estHasta || p.momento).getTime() - new Date(p.estDesde).getTime()) / 1000)}
                                    </p>
                                )}
                                {p.confianza != null && p.tipo !== "ESTACIONADO" && (
                                    <p className="text-[9.5px] text-muted-foreground/80 mt-0.5 tabular-nums">
                                        {Math.round(p.confianza * 100)}% de confianza
                                    </p>
                                )}
                                {actual && (
                                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 rounded-full bg-white text-black text-[8.5px] font-bold uppercase tracking-wider">
                                        esta fila
                                    </span>
                                )}
                            </motion.button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
