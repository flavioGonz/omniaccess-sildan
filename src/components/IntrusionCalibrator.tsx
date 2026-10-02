"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { AnimatePresence, motion } from "framer-motion";
import { sileo as toast } from "sileo";
import { Minus, SquareDashed, Crosshair, RotateCcw, Save, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconBar } from "@/components/ui/icon-bar";
import { LineaDePasada, ZonaDeInteres, ZONA_COMPLETA, type Linea, type Zona } from "@/components/tracking/Calibracion";
import { EscenaViva, type Caja } from "@/components/tracking/EscenaViva";

/**
 * Editor de líneas y zonas de INTRUSIÓN, dibujadas directamente sobre el video de la cámara.
 *
 * Es un shell fino: reusa la escena viva (`EscenaViva`), la barra flotante (`IconBar`) y las
 * primitivas de dibujo (`LineaDePasada`, `ZonaDeInteres`) que ya usa el calibrador de interior.
 * Lo propio de acá es apenas el arrastre y el guardado, que va a `/api/intrusion/geometry`
 * (esa ruta guarda la geometría y la ESCRIBE en la cámara por ISAPI, con relectura).
 *
 * A diferencia del disparo de seguimiento, intrusión mira PERSONAS en el perímetro; y como la
 * cámara tiene una sola regla de hardware, la ruta rechaza activar intrusión en una cámara que
 * ya dispara el seguimiento por su propia regla (no se puede mentir que conviven).
 */
export function IntrusionCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [linea, setLinea] = useState<Linea | null>(null);
    const [zona, setZona] = useState<Zona | null>(null);
    const [herramienta, setHerramienta] = useState<"mirar" | "linea" | "zona">("mirar");
    const [caja, setCaja] = useState<Caja>({ ancho: 0, alto: 0 });

    const lienzo = useRef<HTMLDivElement>(null);
    const arrastre = useRef<{ x: number; y: number } | null>(null);
    const tirando = useRef<null | "a" | "b">(null);

    // ── Geometría guardada ──────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const r = await axios.get(`/api/intrusion/geometry?deviceId=${device.id}`);
                if (r.data?.geometria?.linea) setLinea(r.data.geometria.linea);
                if (r.data?.geometria?.zona) setZona(r.data.geometria.zona);
                if (r.data?.chocaConSeguimiento) {
                    toast.error({
                        title: "Esta cámara dispara el seguimiento por su propia regla",
                        description: "Intrusión y seguimiento por cámara comparten la única regla del hardware. Pasá el seguimiento a 'escena' antes de activar intrusión.",
                    });
                }
            } catch {
                toast.error({ title: "No se pudo leer la configuración de intrusión" });
            } finally { setCargando(false); }
        })();
    }, [device.id]);

    // ── Dibujo, en fracciones de la caja del video (idéntico criterio al de interior) ──
    const aRelativo = (e: React.MouseEvent) => {
        const c = lienzo.current!.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (e.clientX - c.left) / c.width)),
            y: Math.max(0, Math.min(1, (e.clientY - c.top) / c.height)),
        };
    };
    const dibuja = herramienta === "linea" || herramienta === "zona";

    const alBajar = (e: React.MouseEvent) => {
        if (!dibuja || e.button !== 0) return;
        e.preventDefault();
        const p = aRelativo(e);
        arrastre.current = p;
        if (herramienta === "linea") {
            // Agarrar un extremo si el clic cae cerca: mover una punta sin redibujar todo.
            const cerca = (x: number, y: number) =>
                Math.hypot((x - p.x) * (caja.ancho || 1), (y - p.y) * (caja.alto || 1)) < 14;
            if (linea && cerca(linea.x1, linea.y1)) { tirando.current = "a"; return; }
            if (linea && cerca(linea.x2, linea.y2)) { tirando.current = "b"; return; }
            tirando.current = null;
            setLinea((l) => ({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, sentido: l?.sentido || "any" }));
        } else {
            setZona({ ...p, w: 0, h: 0 });
        }
    };
    const alMover = (e: React.MouseEvent) => {
        if (!arrastre.current || !dibuja) return;
        const p = aRelativo(e);
        const a = arrastre.current;
        if (herramienta === "linea") {
            if (tirando.current === "a") setLinea((l) => l && ({ ...l, x1: p.x, y1: p.y }));
            else if (tirando.current === "b") setLinea((l) => l && ({ ...l, x2: p.x, y2: p.y }));
            else setLinea((l) => ({ x1: a.x, y1: a.y, x2: p.x, y2: p.y, sentido: l?.sentido || "any" }));
            return;
        }
        setZona({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
    };
    const alSoltar = () => {
        if (!arrastre.current) return;
        arrastre.current = null;
        const movia = tirando.current;
        tirando.current = null;
        // Una raya de dos píxeles no es una línea; un rectángulo diminuto tampoco es zona.
        if (herramienta === "linea" && !movia) {
            setLinea((l) => (l && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.08 ? l : null));
        } else if (herramienta === "zona") {
            setZona((z) => (z && (z.w < 0.05 || z.h < 0.05) ? null : z));
        }
    };

    const sentidoTexto = linea?.sentido === "left-right" ? "izq → der"
        : linea?.sentido === "right-left" ? "der → izq" : "los dos sentidos";

    const guardar = async () => {
        if (!linea && !zona) {
            toast.error({ title: "Dibujá una línea o una zona antes de guardar" });
            return;
        }
        setGuardando(true);
        try {
            await axios.post("/api/intrusion/geometry", {
                deviceId: device.id,
                enabled: true,
                geometria: { linea, zona },
            });
            toast.success({ title: "Intrusión activada", description: "Escrita en la cámara y verificada." });
            onClose();
        } catch (e: any) {
            // 409 (choca con seguimiento) y 502 (la cámara rechazó) traen mensaje claro: se muestra.
            toast.error({ title: e?.response?.data?.error || "No se pudo guardar la intrusión" });
        } finally { setGuardando(false); }
    };

    const apagar = async () => {
        setGuardando(true);
        try {
            await axios.post("/api/intrusion/geometry", { deviceId: device.id, enabled: false, geometria: { linea, zona } });
            toast.success({ title: "Intrusión desactivada en esta cámara" });
            onClose();
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo desactivar" });
        } finally { setGuardando(false); }
    };

    return (
        <div className="fixed inset-0 z-[var(--capa-panel)] bg-background flex flex-col animate-in fade-in duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <ShieldAlert size={18} style={{ color: "var(--mal)" }} className="shrink-0" />
                    <p className="text-sm font-semibold truncate">Intrusión &middot; {device.name}</p>
                </div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>

            <div className="relative flex-1 min-h-0 p-3 md:p-4">
                <EscenaViva deviceId={device.id} alMedir={setCaja}>
                    <div
                        ref={lienzo}
                        onMouseDown={alBajar} onMouseMove={alMover} onMouseUp={alSoltar} onMouseLeave={alSoltar}
                        className={cn("absolute inset-0 rounded-[10px] overflow-hidden", dibuja && "cursor-crosshair")}
                    >
                        {zona && caja.ancho > 0 && (
                            <div className={cn("transition-opacity", herramienta === "zona" ? "opacity-100" : "opacity-60")}>
                                <ZonaDeInteres zona={zona} />
                            </div>
                        )}
                        {linea && caja.ancho > 0 && (
                            <div className={cn("transition-opacity", herramienta === "linea" ? "opacity-100" : "opacity-60")}>
                                <LineaDePasada linea={linea} w={caja.ancho} h={caja.alto} />
                            </div>
                        )}
                    </div>
                </EscenaViva>

                {/* Herramientas, flotando (misma barra que el calibrador de interior). */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[var(--capa-flotante)]">
                    <IconBar
                        superficie="imagen"
                        items={[
                            { key: "mirar", label: "Sólo mirar", Icon: Crosshair },
                            { key: "linea", label: `Línea · ${linea ? "puesta" : "sin marcar"}`, Icon: Minus },
                            { key: "zona", label: `Zona · ${zona ? "puesta" : "sin marcar"}`, Icon: SquareDashed },
                        ]}
                        value={herramienta}
                        onChange={(k) => setHerramienta(k as any)}
                        acciones={[
                            {
                                key: "sentido", label: `Sentido · ${sentidoTexto}`, Icon: RotateCcw, off: !linea,
                                onClick: () => setLinea((l) => l && ({ ...l, sentido: l.sentido === "any" ? "left-right" : l.sentido === "left-right" ? "right-left" : "any" })),
                            },
                        ]}
                    />
                </div>

                <AnimatePresence>
                    {herramienta !== "mirar" && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.18 }}
                            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[var(--capa-flotante)] rounded-full bg-card/90 border border-border px-4 py-1.5 text-[12px] text-muted-foreground backdrop-blur"
                        >
                            {herramienta === "linea" ? "Arrastrá para trazar la línea de cruce; agarrá una punta para corregirla." : "Arrastrá para marcar la zona de intrusión."}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0">
                <Button variant="ghost" onClick={apagar} disabled={guardando}>Desactivar en esta cámara</Button>
                <Button onClick={guardar} disabled={guardando || cargando}>
                    <Save size={16} /> {guardando ? "Guardando…" : "Activar intrusión"}
                </Button>
            </div>
        </div>
    );
}
