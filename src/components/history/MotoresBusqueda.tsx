"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Database, ImageIcon, Loader2, ScanSearch, Server, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cada búsqueda del Historial con su propio indicador (21/10, Nico: «debés animar los loaders
 * individuales de cada búsqueda en el historial de accesos»).
 *
 * Una misma consulta la contestan hasta cinco motores — los registros, OmniVision por cómo se ve,
 * los objetos nombrados en las fotos, la foto subida, y el grabador — y cada uno tarda lo suyo:
 * los registros, medio segundo; el grabador, a veces medio minuto. Antes todo eso era un ícono
 * que latía al pie de la tabla, y no se sabía quién faltaba ni cuánto le quedaba. Ahora cada motor
 * es una pieza: gira mientras busca, el grabador muestra su avance real, y al terminar dice
 * cuántos encontró (o por qué no pudo).
 */
export type EstadoMotor = {
    clave: "registros" | "omni" | "objetos" | "foto" | "grabador";
    estado: "buscando" | "listo" | "error";
    /** Cuántos encontró (al terminar). */
    n?: number;
    /** «hay más»: los registros vienen de a páginas. */
    mas?: boolean;
    /** 0–100 si el motor dice su avance (el grabador); si no, la barra es indeterminada. */
    progreso?: number | null;
    error?: string | null;
};

const MOTOR: Record<EstadoMotor["clave"], { nombre: string; Icono: typeof Sparkles; tono: string; barra: string }> = {
    registros: { nombre: "Registros", Icono: Database, tono: "text-foreground/70", barra: "bg-[var(--accion)]" },
    omni: { nombre: "OmniVision", Icono: Sparkles, tono: "text-[var(--quieto)]", barra: "bg-[var(--quieto)]" },
    objetos: { nombre: "Objetos en las fotos", Icono: ScanSearch, tono: "text-[var(--quieto)]", barra: "bg-[var(--quieto)]" },
    foto: { nombre: "La foto en OmniVision", Icono: ImageIcon, tono: "text-[var(--quieto)]", barra: "bg-[var(--quieto)]" },
    grabador: { nombre: "Grabador IA", Icono: Server, tono: "text-sky-500", barra: "bg-sky-500" },
};

export function MotoresBusqueda({ motores }: { motores: EstadoMotor[] }) {
    if (!motores.length) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5 mb-2" aria-live="polite">
            <AnimatePresence initial={false}>
                {motores.map((m) => <Motor key={m.clave} m={m} />)}
            </AnimatePresence>
        </div>
    );
}

function Motor({ m }: { m: EstadoMotor }) {
    const { nombre, Icono, tono, barra } = MOTOR[m.clave];
    const buscando = m.estado === "buscando";
    const determinado = buscando && m.progreso != null && m.progreso > 0;
    return (
        <motion.span layout initial={{ opacity: 0, y: -4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.18 }}
            title={m.estado === "error" ? `${nombre}: ${m.error || "no contestó"}` : undefined}
            className={cn("relative overflow-hidden inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full border text-[11.5px] font-semibold tabular-nums",
                m.estado === "error" ? "border-[color-mix(in_oklab,var(--aviso)_45%,transparent)]" : "border-border", buscando ? "bg-muted/40" : "bg-card")}>
            {/* El ícono del motor gira mientras busca; al terminar, se apoya y aparece el resultado. */}
            <span className="relative grid place-items-center h-4 w-4">
                {buscando ? (
                    <>
                        <Loader2 size={16} className={cn("absolute animate-spin opacity-60", tono)} />
                        <Icono size={9} className={tono} />
                    </>
                ) : m.estado === "error" ? (
                    <AlertTriangle size={13} className="tono-aviso" />
                ) : (
                    <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 520, damping: 22 }} className="grid place-items-center">
                        <Icono size={13} className={tono} />
                    </motion.span>
                )}
            </span>
            <span className={cn(buscando ? "text-muted-foreground" : "text-foreground")}>{nombre}</span>
            {buscando ? (
                <span className="text-muted-foreground">{determinado ? `${Math.round(m.progreso!)} %` : "buscando…"}</span>
            ) : m.estado === "error" ? (
                <span className="tono-aviso font-normal max-w-[180px] truncate">{m.error || "no contestó"}</span>
            ) : (
                <motion.span key={m.n} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} className={cn("inline-flex items-center gap-1", m.n ? "text-foreground" : "text-muted-foreground font-normal")}>
                    {m.n ? <><Check size={11} className="tono-bien" /> {m.n}{m.mas ? "+" : ""}</> : "nada"}
                </motion.span>
            )}
            {/* La barra de abajo: el avance real si el motor lo dice; si no, una que corre. */}
            {buscando && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-transparent">
                    {determinado ? (
                        <motion.span className={cn("block h-full", barra)} initial={false} animate={{ width: `${Math.min(100, m.progreso!)}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
                    ) : (
                        <motion.span className={cn("absolute inset-y-0 w-1/3 rounded-full", barra)} initial={{ left: "-35%" }} animate={{ left: "100%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} />
                    )}
                </span>
            )}
        </motion.span>
    );
}
