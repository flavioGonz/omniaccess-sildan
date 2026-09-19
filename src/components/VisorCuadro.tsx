"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
    X, ChevronLeft, ChevronRight, Camera, Clock, ZoomIn, ZoomOut, Maximize2,
    Scan, Car, Home, Phone, ParkingSquare, ShieldAlert, Star, Search as Lupa, Gauge, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Cronometro } from "@/components/tracking/Cronometro";
import { ContornoDeteccion } from "@/components/tracking/ContornoDeteccion";
import { leerRecuadro } from "@/lib/deteccion";

export type CuadroAvistamiento = {
    plate: string;
    cameraName?: string | null;
    deviceId?: string | null;
    timestamp: string | Date;
    confidence?: number | null;
    reads?: number | null;
    snapshotUrl?: string | null;
    bbox?: string | null;
    estado?: string | null;
    estDesde?: string | Date | null;
    estHasta?: string | Date | null;
    estCerrada?: boolean | null;
};

/** Lo que se sabe del vehículo, tal como lo devuelve /api/tracking/recent. */
export type FichaMatricula = {
    marca?: string | null;
    modelo?: string | null;
    color?: string | null;
    tipo?: string | null;
    dueno?: {
        id?: string; nombre?: string | null; telefono?: string | null;
        unidad?: string | null; apartamento?: string | null; cochera?: string | null; rol?: string | null;
    } | null;
    vigilancia?: { etiqueta?: string | null; categoria?: string | null; color?: string | null } | null;
};

/**
 * Visor del cuadro de un avistamiento.
 *
 * Una ventana que abraza la imagen, no una foto pegada al borde de la pantalla con los
 * datos desparramados en las esquinas. Los rótulos van SOBRE la imagen, sobre una sombra
 * degradada que los hace legibles sin tapar nada, y la ventana mide lo que mide la foto.
 *
 * La foto sola contesta poco. "Esta chapa, a esta hora, en esta cámara" es el dato crudo;
 * lo que se necesita saber es de quién es el auto, si tiene cochera, si está en la lista,
 * y si estaba pasando o estacionado. Todo eso ya lo sabe el sistema, así que va acá, en
 * tres lugares fijos: la identidad arriba, la ficha a la izquierda, el estado abajo. Tres
 * lugares y no cinco, porque una esquina con un dato suelto no se mira.
 *
 * Los controles van juntos, en un solo riel, con fondo propio. Sueltos sobre la imagen
 * desaparecían contra cualquier foto clara.
 *
 * Se puede acercar. Una matrícula chica en un cuadro de calle es justo lo que hay que
 * mirar de cerca para saber si el lector acertó, y sin acercar no se distingue una B de
 * una 8. El zoom va al puntero — no al centro — porque lo que interesa casi nunca está en
 * el medio, y con la rueda, el doble clic o el pellizco.
 *
 * Y se puede ver QUÉ marcó el detector: el recuadro de la chapa. Con el contorno
 * encendido, mirar la foto contesta también por qué una lectura salió mal — chapa
 * cortada, chapa demasiado chica, chapa del auto de al lado.
 *
 * Una sola tipografía, la de la aplicación. La matrícula estaba en monoespaciada, que es
 * la convención para una chapa, pero la variable apuntaba a una fuente que este proyecto
 * no carga: el navegador caía en su monoespaciada por defecto y el resultado era una
 * placa escrita en otra letra que todo lo que la rodea. Para que se lea como chapa
 * alcanza con el espaciado entre letras y el ancho fijo de dígitos.
 */

const ESCALA_MAX = 8;
const ESCALA_DOBLE_CLIC = 3;

/** Que la imagen no se pueda arrastrar fuera de su propio marco. */
function acotar(pos: { x: number; y: number }, escala: number, caja: DOMRect | null) {
    if (!caja || escala <= 1) return { x: 0, y: 0 };
    const margenX = (caja.width * (escala - 1)) / 2;
    const margenY = (caja.height * (escala - 1)) / 2;
    return {
        x: Math.max(-margenX, Math.min(margenX, pos.x)),
        y: Math.max(-margenY, Math.min(margenY, pos.y)),
    };
}

const ICONO_VIGILANCIA: Record<string, any> = { negra: ShieldAlert, busca: Lupa, vip: Star };
const TONO_VIGILANCIA: Record<string, string> = {
    negra: "bg-rose-500/20 border-rose-400/50 text-rose-200",
    busca: "bg-amber-500/20 border-amber-400/50 text-amber-200",
    vip: "bg-violet-500/20 border-violet-400/50 text-violet-200",
};

/** Un renglón de la ficha. No se dibuja si no hay qué poner: un campo vacío es ruido. */
function Dato({ icono: Icono, etiqueta, valor }: { icono: any; etiqueta: string; valor?: string | null }) {
    if (!valor) return null;
    return (
        <div className="flex items-start gap-2">
            <Icono size={12} className="text-white/35 mt-[3px] shrink-0" />
            <div className="min-w-0">
                <div className="text-[8.5px] uppercase tracking-wider text-white/35 leading-none">{etiqueta}</div>
                <div className="text-[12px] font-semibold text-white/90 truncate leading-tight mt-0.5">{valor}</div>
            </div>
        </div>
    );
}

/**
 * Una medida de la calidad de la lectura: el número grande, el rótulo chico debajo.
 * Sin caja propia — viven dentro de la barra del evento, y una caja dentro de otra caja
 * es un borde que no separa nada.
 */
function Medida({ valor, rotulo, tono, ayuda }: { valor: string; rotulo: string; tono: string; ayuda?: string }) {
    return (
        <div className="text-center leading-none" title={ayuda}>
            <div className={cn("text-[14px] font-extrabold tabular-nums", tono)}>{valor}</div>
            <div className="text-[8.5px] uppercase tracking-wider text-white/40 mt-1">{rotulo}</div>
        </div>
    );
}

export function VisorCuadro({ fila, ficha, hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar }: {
    fila: CuadroAvistamiento;
    ficha?: FichaMatricula | null;
    hayAnterior?: boolean;
    haySiguiente?: boolean;
    onAnterior?: () => void;
    onSiguiente?: () => void;
    onCerrar: () => void;
}) {
    const [escala, setEscala] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [verContorno, setVerContorno] = useState(true);
    const marco = useRef<HTMLDivElement | null>(null);
    const arrastre = useRef<{ x: number; y: number; px: number; py: number; movio: boolean } | null>(null);
    const pellizco = useRef<number | null>(null);

    const acercado = escala > 1.01;
    const recuadro = leerRecuadro(fila.bbox);

    const reiniciar = useCallback(() => { setEscala(1); setPos({ x: 0, y: 0 }); }, []);

    // Cada foto se abre sin acercar: heredar el zoom de la anterior desorienta.
    useEffect(() => { reiniciar(); }, [fila.snapshotUrl, reiniciar]);

    /**
     * Acerca manteniendo quieto el punto que está bajo el puntero.
     * Escalar sobre el centro hace que lo que se quería mirar se escape del marco.
     */
    const zoomEn = useCallback((nueva: number, clienteX?: number, clienteY?: number) => {
        const caja = marco.current?.getBoundingClientRect() || null;
        const destino = Math.max(1, Math.min(ESCALA_MAX, nueva));
        setPos((p) => {
            if (destino <= 1) return { x: 0, y: 0 };
            if (!caja || clienteX == null || clienteY == null) return acotar(p, destino, caja);
            const cx = clienteX - (caja.left + caja.width / 2);
            const cy = clienteY - (caja.top + caja.height / 2);
            const k = destino / (escala || 1);
            return acotar({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }, destino, caja);
        });
        setEscala(destino);
    }, [escala]);

    /**
     * Acercar la chapa, de una. Es la razón por la que se abre este visor nueve de cada
     * diez veces, y a mano son tres gestos: acercar, encontrarla y centrarla.
     */
    const irALaChapa = useCallback(() => {
        const caja = marco.current?.getBoundingClientRect();
        if (!recuadro || !caja) return;
        // Que la chapa ocupe alrededor de un tercio del ancho del marco.
        const destino = Math.max(1, Math.min(ESCALA_MAX, 0.34 / recuadro.w));
        const cx = (recuadro.x + recuadro.w / 2 - 0.5) * caja.width;
        const cy = (recuadro.y + recuadro.h / 2 - 0.5) * caja.height;
        setEscala(destino);
        setPos(acotar({ x: -cx * destino, y: -cy * destino }, destino, caja));
    }, [recuadro]);

    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            if (e.key === "Escape") { if (acercado) { reiniciar(); return; } onCerrar(); }
            if (e.key === "ArrowLeft" && hayAnterior && !acercado) onAnterior?.();
            if (e.key === "ArrowRight" && haySiguiente && !acercado) onSiguiente?.();
            if (e.key === "+" || e.key === "=") zoomEn(escala * 1.5);
            if (e.key === "-" || e.key === "_") zoomEn(escala / 1.5);
            if (e.key === "0") reiniciar();
            if (e.key === "c" || e.key === "C") setVerContorno((v) => !v);
            if ((e.key === "p" || e.key === "P") && recuadro) irALaChapa();
        };
        window.addEventListener("keydown", tecla);
        return () => window.removeEventListener("keydown", tecla);
    }, [hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar, acercado, escala, zoomEn, reiniciar, irALaChapa, recuadro]);

    // La rueda se escucha a mano y no con onWheel: React lo registra como pasivo y no
    // deja frenar el desplazamiento de la página detrás del visor.
    useEffect(() => {
        const el = marco.current;
        if (!el) return;
        const rueda = (e: WheelEvent) => {
            e.preventDefault();
            zoomEn(escala * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY);
        };
        el.addEventListener("wheel", rueda, { passive: false });
        return () => el.removeEventListener("wheel", rueda);
    }, [escala, zoomEn]);

    const conf = typeof fila.confidence === "number" ? Math.round(fila.confidence * 100) : null;
    const momento = new Date(fila.timestamp);
    const tonoConf = conf == null ? "" : conf >= 85 ? "text-emerald-300" : conf >= 65 ? "text-amber-300" : "text-rose-300";

    const estacionado = fila.estado === "ESTACIONADO";
    const cerrada = !!fila.estCerrada;
    const dueno = ficha?.dueno;
    const vig = ficha?.vigilancia;
    const IconoVig = vig?.categoria ? (ICONO_VIGILANCIA[vig.categoria] || ShieldAlert) : null;
    const vehiculo = [ficha?.marca, ficha?.modelo].filter(Boolean).join(" ") || null;
    const hayFicha = !!(dueno || vehiculo || ficha?.color || vig);

    return (
        <div onClick={onCerrar}
            className="fixed inset-0 z-[3400] bg-black/85 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-150">

            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
                onClick={(e) => e.stopPropagation()}
                className="relative inline-block rounded-2xl overflow-hidden border border-white/[0.14] shadow-2xl shadow-black/80 bg-[#0a0d12] max-w-[min(1240px,94vw)]">

                <div
                    ref={marco}
                    className={cn("relative overflow-hidden", acercado ? (arrastre.current ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in")}
                    onDoubleClick={(e) => zoomEn(acercado ? 1 : ESCALA_DOBLE_CLIC, e.clientX, e.clientY)}
                    onPointerDown={(e) => {
                        if (!acercado) return;
                        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                        arrastre.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, movio: false };
                    }}
                    onPointerMove={(e) => {
                        const a = arrastre.current;
                        if (!a) return;
                        const dx = e.clientX - a.x, dy = e.clientY - a.y;
                        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) a.movio = true;
                        setPos(acotar({ x: a.px + dx, y: a.py + dy }, escala, marco.current?.getBoundingClientRect() || null));
                    }}
                    onPointerUp={() => { arrastre.current = null; }}
                    onPointerCancel={() => { arrastre.current = null; }}
                    onTouchStart={(e) => {
                        if (e.touches.length === 2) {
                            pellizco.current = Math.hypot(
                                e.touches[0].clientX - e.touches[1].clientX,
                                e.touches[0].clientY - e.touches[1].clientY,
                            );
                        }
                    }}
                    onTouchMove={(e) => {
                        if (e.touches.length !== 2 || pellizco.current == null) return;
                        const d = Math.hypot(
                            e.touches[0].clientX - e.touches[1].clientX,
                            e.touches[0].clientY - e.touches[1].clientY,
                        );
                        zoomEn(escala * (d / pellizco.current),
                            (e.touches[0].clientX + e.touches[1].clientX) / 2,
                            (e.touches[0].clientY + e.touches[1].clientY) / 2);
                        pellizco.current = d;
                    }}
                    onTouchEnd={() => { pellizco.current = null; }}
                >
                    {/* La imagen y su contorno se mueven JUNTOS: el contorno va dentro del
                        mismo transform, si no el recuadro se despega de la chapa al acercar. */}
                    <div className="relative"
                        style={{
                            transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${escala})`,
                            transformOrigin: "center",
                            transition: arrastre.current || pellizco.current != null ? "none" : "transform 160ms cubic-bezier(.22,1,.36,1)",
                        }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={fila.snapshotUrl || ""} alt={fila.plate}
                            className="block max-h-[74vh] max-w-full w-auto select-none"
                            draggable={false} />
                        {verContorno && <ContornoDeteccion bbox={fila.bbox} />}
                    </div>
                </div>

                {/* Sombra de arriba: hace legibles los rótulos sin taparle nada a la imagen */}
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-none" />

                {/* ── EL EVENTO, EN UN SOLO BLOQUE ───────────────────────────────────
                    Antes esto estaba repartido: la chapa suelta arriba a la izquierda, el
                    estado abajo a la izquierda, la calidad abajo a la derecha, los
                    controles arriba a la derecha. Cuatro esquinas para un solo evento, y
                    para leerlo había que recorrer la pantalla entera. Ahora es una barra:
                    quién, dónde y cuándo; qué estaba haciendo; qué tan buena fue la
                    lectura; y recién al final los controles, separados por una línea
                    porque son lo único que no es dato. */}
                <div className="absolute inset-x-2.5 top-2.5 flex items-stretch gap-2.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/15 px-2.5 py-2 shadow-lg shadow-black/60">

                    {/* quién, dónde, cuándo */}
                    <div className="flex items-center gap-2.5 min-w-0">
                        <button
                            type="button"
                            onClick={() => { try { navigator.clipboard?.writeText(fila.plate); } catch { } }}
                            title="Copiar la matrícula"
                            className="px-2.5 py-1 rounded-md bg-white text-black text-[19px] font-extrabold tabular-nums tracking-[0.16em] leading-none hover:bg-white/90 transition-colors">
                            {fila.plate}
                        </button>
                        <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-white/95 truncate flex items-center gap-1.5 leading-tight">
                                <Camera size={11} className="text-white/45 shrink-0" />
                                {fila.cameraName || fila.deviceId || "cámara desconocida"}
                            </div>
                            <div className="text-[10.5px] text-white/55 tabular-nums flex items-center gap-1.5 leading-tight">
                                <Clock size={10} className="text-white/35 shrink-0" />
                                {momento.toLocaleDateString("es-UY", { day: "2-digit", month: "short" })} · {momento.toLocaleTimeString("es-UY", { hour12: false })}
                            </div>
                        </div>
                        {vig && (
                            <div className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-extrabold uppercase tracking-wider shrink-0", TONO_VIGILANCIA[vig.categoria || "negra"])}>
                                {IconoVig && <IconoVig size={11} />}
                                {vig.etiqueta || vig.categoria}
                            </div>
                        )}
                    </div>

                    <div className="w-px bg-white/12 shrink-0" />

                    {/* qué estaba haciendo */}
                    <div className="flex items-center gap-2 shrink-0">
                        <div className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[10.5px] font-extrabold uppercase tracking-wider leading-none",
                            estacionado
                                ? (cerrada ? "bg-white/10 border-white/25 text-white/70" : "bg-violet-500/25 border-violet-400/50 text-violet-100")
                                : "bg-sky-500/20 border-sky-400/45 text-sky-100",
                        )}>
                            {estacionado ? <ParkingSquare size={12} /> : <Car size={12} />}
                            {estacionado ? (cerrada ? "Se fue" : "Estacionado") : "Pasó"}
                        </div>
                        {estacionado && fila.estDesde && (
                            <Cronometro
                                desde={fila.estDesde}
                                hasta={cerrada ? fila.estHasta : null}
                                etiqueta={cerrada ? "estuvo" : "hace"}
                                tamano="chico"
                            />
                        )}
                    </div>

                    {/* qué tan buena fue la lectura */}
                    <div className="ml-auto flex items-center gap-3.5 shrink-0 px-1">
                        {conf != null && <Medida valor={`${conf}%`} rotulo="confianza" tono={tonoConf} />}
                        {fila.reads != null && <Medida valor={String(fila.reads)} rotulo="cuadros" tono="text-white" />}
                        {recuadro && (
                            /* Qué fracción del cuadro ocupa la chapa. Es el número que decide
                               si el lector la puede leer, y el primero que hay que mirar
                               cuando una cámara lee mal. */
                            <Medida
                                valor={`${(recuadro.w * 100).toFixed(1)}%`}
                                rotulo="del cuadro"
                                tono={recuadro.w >= 0.05 ? "text-emerald-300" : recuadro.w >= 0.03 ? "text-amber-300" : "text-rose-300"}
                                ayuda="Ancho de la matrícula respecto del cuadro. Por debajo de 3% el lector empieza a fallar." />
                        )}
                    </div>

                    <div className="w-px bg-white/12 shrink-0" />

                    {/* y lo único que no es dato: los controles */}
                    <div className="flex items-center gap-1 shrink-0">
                        {recuadro && (
                            <>
                                <button onClick={irALaChapa} title="Acercar a la matrícula  ( P )"
                                    className="h-8 px-2.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10 flex items-center gap-1.5 text-[11px] font-semibold transition-colors">
                                    <Lupa size={13} /> Chapa
                                </button>
                                <button onClick={() => setVerContorno((v) => !v)} title="Marcar lo que detectó el lector  ( C )"
                                    className={cn("h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[11px] font-semibold transition-colors",
                                        verContorno ? "bg-emerald-500/25 text-emerald-200 border border-emerald-400/40" : "text-white/75 hover:text-white hover:bg-white/10")}>
                                    <Scan size={13} /> Contorno
                                </button>
                            </>
                        )}
                        <button onClick={() => zoomEn(escala / 1.6)} disabled={!acercado} title="Alejar  ( − )"
                            className="w-8 h-8 rounded-lg text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                            <ZoomOut size={14} />
                        </button>
                        <span className="px-0.5 text-[11px] font-bold tabular-nums text-white/60 select-none min-w-[32px] text-center">
                            {escala.toFixed(1)}×
                        </span>
                        <button onClick={() => zoomEn(escala * 1.6)} disabled={escala >= ESCALA_MAX} title="Acercar  ( + )"
                            className="w-8 h-8 rounded-lg text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                            <ZoomIn size={14} />
                        </button>
                        <button onClick={reiniciar} disabled={!acercado} title="Volver al tamaño original  ( 0 )"
                            className="w-8 h-8 rounded-lg text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                            <Maximize2 size={13} />
                        </button>
                        <button onClick={onCerrar} title="Cerrar  ( Esc )"
                            className="w-8 h-8 rounded-lg text-white/75 hover:text-white hover:bg-rose-500/30 flex items-center justify-center transition-colors">
                            <X size={15} />
                        </button>
                    </div>
                </div>

                {/* ── FICHA: lo que ya se sabe de este vehículo ───────────────────── */}
                {hayFicha && !acercado && (
                    <div className="absolute left-2.5 top-[68px] w-[210px] rounded-xl bg-black/70 backdrop-blur-md border border-white/15 p-2.5 space-y-2.5 shadow-lg shadow-black/60">
                        <div className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-white/40">Lo que se sabe</div>
                        <Dato icono={Home} etiqueta="Residente" valor={dueno?.nombre} />
                        <Dato icono={Layers} etiqueta="Unidad" valor={[dueno?.unidad, dueno?.apartamento].filter(Boolean).join(" · ") || null} />
                        <Dato icono={ParkingSquare} etiqueta="Cochera" valor={dueno?.cochera} />
                        <Dato icono={Phone} etiqueta="Teléfono" valor={dueno?.telefono} />
                        <Dato icono={Car} etiqueta="Vehículo" valor={[vehiculo, ficha?.color].filter(Boolean).join(" · ") || null} />
                        {!dueno && (
                            <div className="text-[11px] text-amber-200/80 leading-snug">
                                Matrícula sin registrar. No hay residente asociado.
                            </div>
                        )}
                    </div>
                )}

                {/* Moverse entre avistamientos, dentro de la ventana */}
                {hayAnterior && !acercado && (
                    <button onClick={onAnterior}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm border border-white/15 text-white/75 hover:text-white hover:bg-black/85 flex items-center justify-center transition-colors">
                        <ChevronLeft size={17} />
                    </button>
                )}
                {haySiguiente && !acercado && (
                    <button onClick={onSiguiente}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm border border-white/15 text-white/75 hover:text-white hover:bg-black/85 flex items-center justify-center transition-colors">
                        <ChevronRight size={17} />
                    </button>
                )}
            </motion.div>
        </div>
    );
}
