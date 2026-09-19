"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
    X, ChevronLeft, ChevronRight, Camera, Clock, ZoomIn, ZoomOut, Maximize2,
    Scan, Car, Home, Phone, ParkingSquare, ShieldAlert, Star, Search as Lupa, Layers, UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Cronometro } from "@/components/tracking/Cronometro";
import { ContornoDeteccion } from "@/components/tracking/ContornoDeteccion";
import { leerRecuadro } from "@/lib/deteccion";
import { fechaCorta, hora } from "@/lib/fechas";

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
 * lo que se necesita saber es de quién es el auto, de qué lote es, si tiene cochera, si
 * está en la lista, y si estaba pasando o estacionado.
 *
 * Tres zonas, y cada una contesta una pregunta distinta:
 *
 *   IZQUIERDA   la ficha. Quién es, de dónde, y qué tan buena fue la lectura. Es lo que se
 *               lee, así que va donde empieza la vista y en una columna, no en una fila:
 *               una ficha es una lista de campos, y una lista se lee hacia abajo.
 *
 *   SOBRE EL    el estado y el tiempo, anclados al recuadro de la chapa. Antes estaban en
 *   VEHÍCULO    una barra arriba, lejos del auto del que hablaban; con tres vehículos en
 *               cuadro, "estacionado 13 min" no decía cuál. Ahora el rótulo sale del auto
 *               que le corresponde, y acompaña el zoom sin agrandarse con él.
 *
 *   DERECHA     los controles, en vertical. Son lo único que no es dato, así que van del
 *               otro lado y en otra orientación: no se confunden con la ficha ni le comen
 *               el ancho, que es justo lo que hace falta para los campos largos.
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

/**
 * Un renglón de la ficha.
 *
 * Se dibuja SIEMPRE, tenga valor o no. Es al revés de lo que uno haría — un campo vacío
 * parece ruido — pero acá el hueco dice algo: muestra qué se podría saber de este
 * vehículo y no se sabe. Una ficha que esconde los campos que le faltan se ve completa
 * cuando está vacía, y nadie va a cargar lo que no sabe que falta. Además el panel deja
 * de cambiar de alto entre un auto registrado y uno que no, que es lo que hacía saltar
 * los controles de lugar.
 */
function Dato({ icono: Icono, etiqueta, valor }: { icono: any; etiqueta: string; valor?: string | null }) {
    return (
        <div className="flex items-start gap-2">
            <Icono size={12} className={cn("mt-[3px] shrink-0", valor ? "text-white/35" : "text-white/15")} />
            <div className="min-w-0 flex-1">
                <div className="text-[8.5px] uppercase tracking-wider text-white/35 leading-none">{etiqueta}</div>
                <div className={cn("text-[12px] truncate leading-tight mt-0.5",
                    valor ? "font-semibold text-white/90" : "text-white/25")}>
                    {valor || "sin definir"}
                </div>
            </div>
        </div>
    );
}

/**
 * Una medida de la calidad de la lectura: el número grande, el rótulo chico debajo.
 * Sin caja propia — viven dentro de la ficha, y una caja dentro de otra caja es un borde
 * que no separa nada.
 */
function Medida({ valor, rotulo, tono, ayuda }: { valor: string; rotulo: string; tono: string; ayuda?: string }) {
    return (
        <div className="text-center leading-none flex-1" title={ayuda}>
            <div className={cn("text-[13px] font-extrabold tabular-nums", tono)}>{valor}</div>
            <div className="text-[8px] uppercase tracking-wider text-white/40 mt-1">{rotulo}</div>
        </div>
    );
}

export function VisorCuadro({ fila, ficha, onRegistrar, hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar }: {
    fila: CuadroAvistamiento;
    ficha?: FichaMatricula | null;
    /** Dar de alta esta matrícula. Sin esto, los campos vacíos solo informan. */
    onRegistrar?: (plate: string) => void;
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

    /**
     * Dónde va el rótulo del estado y el tiempo.
     *
     * Sobre el VEHÍCULO, no sobre la matrícula. Pegado a la chapa tapaba justo lo que se
     * vino a mirar, y además quedaba a la altura de la parrilla, que no es donde uno
     * espera el nombre de una cosa: un rótulo se pone arriba del objeto que nombra.
     *
     * La distancia se mide en ALTURAS DE LA CHAPA LEÍDA, no en fracciones fijas del
     * cuadro — el mismo criterio que usa la banda de la línea de pasada. Una matrícula
     * mide 13 cm, así que siete alturas son unos 90 cm por encima de ella: más o menos el
     * techo de un auto. Y como la chapa se ve más chica cuanto más lejos está, el rótulo
     * se aleja menos en los autos del fondo y más en los de adelante, solo. Nada de esto
     * necesita calibración ni supone que la chapa mire de frente: es un desplazamiento,
     * no una medición, y si cae diez centímetros arriba o abajo no afirma nada falso.
     *
     * Una guía fina baja del rótulo hasta el recuadro. Con tres autos en cuadro, un
     * rótulo flotando no dice de cuál habla.
     */
    const ALTURAS_SOBRE_EL_AUTO = 7;
    const rotulo = (() => {
        if (!recuadro) return null;
        const cx = (recuadro.x + recuadro.w / 2) * 100;
        const arriba = (recuadro.y - ALTURAS_SOBRE_EL_AUTO * recuadro.h) * 100;
        // Si no entra arriba, el marco lo recortaría justo donde dice el tiempo.
        const abajo = arriba < 4;
        const y = abajo
            ? (recuadro.y + recuadro.h) * 100 + ALTURAS_SOBRE_EL_AUTO * recuadro.h * 100
            : arriba;
        const ancla = abajo ? (recuadro.y + recuadro.h) * 100 : recuadro.y * 100;
        return { cx, y, abajo, guiaDesde: Math.min(y, ancla), guiaAlto: Math.abs(y - ancla) };
    })();

    const conf = typeof fila.confidence === "number" ? Math.round(fila.confidence * 100) : null;
    const momento = new Date(fila.timestamp);
    const tonoConf = conf == null ? "" : conf >= 85 ? "text-emerald-300" : conf >= 65 ? "text-amber-300" : "text-rose-300";

    const estacionado = fila.estado === "ESTACIONADO";
    const cerrada = !!fila.estCerrada;
    const dueno = ficha?.dueno;
    const vig = ficha?.vigilancia;
    const IconoVig = vig?.categoria ? (ICONO_VIGILANCIA[vig.categoria] || ShieldAlert) : null;
    const vehiculo = [ficha?.marca, ficha?.modelo].filter(Boolean).join(" ") || null;

    return (
        <div onClick={onCerrar}
            className="fixed inset-0 z-[3400] bg-black/85 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-150">

            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
                onClick={(e) => e.stopPropagation()}
                className="relative inline-block rounded-2xl overflow-hidden border border-white/[0.14] shadow-2xl shadow-black/80 bg-[#0a0d12] max-w-[min(1400px,96vw)]">

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

                        {/* El estado y el tiempo, sobre el vehículo. Van DENTRO del
                            mismo transform para seguir al auto mientras se acerca, pero
                            con la escala invertida: si creciera con el zoom, a 8x taparía
                            media foto. */}
                        {rotulo && (
                            <>
                                <div className="absolute z-[19] pointer-events-none"
                                    style={{
                                        left: `${rotulo.cx}%`,
                                        top: `${rotulo.guiaDesde}%`,
                                        height: `${rotulo.guiaAlto}%`,
                                        width: `${1 / escala}px`,
                                        marginLeft: `${-0.5 / escala}px`,
                                        background: rotulo.abajo
                                            ? "linear-gradient(to bottom, rgba(167,243,208,0.15), rgba(167,243,208,0.7))"
                                            : "linear-gradient(to bottom, rgba(167,243,208,0.7), rgba(167,243,208,0.15))",
                                    }} />
                                <div className="absolute z-20 pointer-events-none"
                                    style={{
                                        left: `${rotulo.cx}%`,
                                        top: `${rotulo.y}%`,
                                        transform: `translate(-50%, ${rotulo.abajo ? "0" : "-100%"}) scale(${1 / escala})`,
                                        transformOrigin: rotulo.abajo ? "top center" : "bottom center",
                                    }}>
                                    <div className="flex items-center gap-1.5">
                                        <div className={cn(
                                            "inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border backdrop-blur-sm text-[10.5px] font-extrabold uppercase tracking-wider leading-none shadow-lg shadow-black/60",
                                            estacionado
                                                ? (cerrada ? "bg-black/75 border-white/25 text-white/75" : "bg-violet-600/85 border-violet-300/50 text-white")
                                                : "bg-sky-600/85 border-sky-300/50 text-white",
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
                                                className="shadow-lg shadow-black/60 bg-black/70"
                                            />
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Sombras laterales: hacen legibles los paneles sin taparle nada a la
                    imagen, y solo del lado donde hay algo escrito. */}
                <div className="absolute inset-y-0 left-0 w-72 bg-gradient-to-r from-black/80 via-black/25 to-transparent pointer-events-none" />
                <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-black/70 to-transparent pointer-events-none" />

                {/* ── IZQUIERDA · LA FICHA ─────────────────────────────────────────── */}
                <div className={cn(
                    "absolute left-3 top-3 bottom-3 w-[248px] flex flex-col gap-2 transition-opacity duration-200",
                    acercado && "opacity-0 pointer-events-none",
                )}>
                    <div className="rounded-xl bg-black/75 backdrop-blur-md border border-white/15 shadow-lg shadow-black/60 overflow-hidden">

                        {/* La matrícula: es lo que se vino a ver, así que es lo más grande
                            de la pantalla después de la foto. */}
                        <button
                            type="button"
                            onClick={() => { try { navigator.clipboard?.writeText(fila.plate); } catch { } }}
                            title="Copiar la matrícula"
                            className="w-full px-3 py-2.5 bg-white text-black text-[30px] font-extrabold tabular-nums tracking-[0.14em] leading-none text-center hover:bg-white/90 transition-colors">
                            {fila.plate}
                        </button>

                        <div className="px-3 py-2 space-y-0.5 border-b border-white/10">
                            <div className="text-[12px] font-semibold text-white/95 truncate flex items-center gap-1.5 leading-tight">
                                <Camera size={11} className="text-white/45 shrink-0" />
                                {fila.cameraName || fila.deviceId || "cámara desconocida"}
                            </div>
                            <div className="text-[11px] text-white/55 tabular-nums flex items-center gap-1.5 leading-tight">
                                <Clock size={10} className="text-white/35 shrink-0" />
                                {fechaCorta(momento)} · {hora(momento)}
                            </div>
                        </div>

                        {/* Qué tan buena fue la lectura. Va acá y no en un rincón porque es
                            lo que dice si hay que creerle a la matrícula de arriba. */}
                        <div className="flex items-start px-2 py-2 border-b border-white/10">
                            <Medida valor={conf != null ? `${conf}%` : "—"} rotulo="confianza" tono={conf != null ? tonoConf : "text-white/30"} />
                            <Medida valor={fila.reads != null ? String(fila.reads) : "—"} rotulo="cuadros" tono={fila.reads != null ? "text-white" : "text-white/30"} />
                            <Medida
                                valor={recuadro ? `${(recuadro.w * 100).toFixed(1)}%` : "—"}
                                rotulo="del cuadro"
                                tono={!recuadro ? "text-white/30" : recuadro.w >= 0.05 ? "text-emerald-300" : recuadro.w >= 0.03 ? "text-amber-300" : "text-rose-300"}
                                ayuda="Ancho de la matrícula respecto del cuadro. Por debajo de 3% el lector empieza a fallar." />
                        </div>

                        {vig && (
                            <div className={cn("flex items-center gap-1.5 px-3 py-2 border-b text-[11px] font-extrabold uppercase tracking-wider", TONO_VIGILANCIA[vig.categoria || "negra"])}>
                                {IconoVig && <IconoVig size={12} />}
                                {vig.etiqueta || vig.categoria}
                            </div>
                        )}
                    </div>

                    {/* Lo que se sabe — y lo que falta saber, que ocupa el mismo lugar. */}
                    <div className="rounded-xl bg-black/75 backdrop-blur-md border border-white/15 shadow-lg shadow-black/60 p-3 space-y-2.5 overflow-y-auto">
                        <div className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-white/40">Vehículo y titular</div>
                        <Dato icono={Home} etiqueta="Residente" valor={dueno?.nombre} />
                        <Dato icono={Layers} etiqueta="Unidad / lote" valor={[dueno?.unidad, dueno?.apartamento].filter(Boolean).join(" · ") || null} />
                        <Dato icono={ParkingSquare} etiqueta="Cochera" valor={dueno?.cochera} />
                        <Dato icono={Phone} etiqueta="Teléfono" valor={dueno?.telefono} />
                        <Dato icono={Car} etiqueta="Vehículo" valor={[vehiculo, ficha?.color].filter(Boolean).join(" · ") || null} />

                        {!dueno && onRegistrar && (
                            /* El hueco tiene que poder llenarse desde donde se ve. Mandar a
                               buscar el alta en otra pantalla es la forma más segura de que
                               la matrícula quede sin cargar. */
                            <button type="button" onClick={() => onRegistrar(fila.plate)}
                                className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 text-amber-100 text-[11px] font-bold hover:bg-amber-500/25 transition-colors">
                                <UserPlus size={12} /> Registrar esta matrícula
                            </button>
                        )}
                    </div>
                </div>

                {/* ── DERECHA · LOS CONTROLES, EN VERTICAL ─────────────────────────── */}
                <div className="absolute right-3 top-3 flex flex-col items-center gap-1 rounded-xl bg-black/75 backdrop-blur-md border border-white/15 p-1 shadow-lg shadow-black/60">
                    {recuadro && (
                        <>
                            <button onClick={irALaChapa} title="Acercar a la matrícula  ( P )"
                                className="w-9 h-9 rounded-lg text-white/75 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
                                <Lupa size={15} />
                            </button>
                            <button onClick={() => setVerContorno((v) => !v)} title="Marcar lo que detectó el lector  ( C )"
                                className={cn("w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                                    verContorno ? "bg-emerald-500/25 text-emerald-200 border border-emerald-400/40" : "text-white/75 hover:text-white hover:bg-white/10")}>
                                <Scan size={15} />
                            </button>
                            <div className="h-px w-6 bg-white/15 my-0.5" />
                        </>
                    )}
                    <button onClick={() => zoomEn(escala * 1.6)} disabled={escala >= ESCALA_MAX} title="Acercar  ( + )"
                        className="w-9 h-9 rounded-lg text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                        <ZoomIn size={15} />
                    </button>
                    <span className="text-[10.5px] font-bold tabular-nums text-white/60 select-none py-0.5">
                        {escala.toFixed(1)}×
                    </span>
                    <button onClick={() => zoomEn(escala / 1.6)} disabled={!acercado} title="Alejar  ( − )"
                        className="w-9 h-9 rounded-lg text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                        <ZoomOut size={15} />
                    </button>
                    <button onClick={reiniciar} disabled={!acercado} title="Volver al tamaño original  ( 0 )"
                        className="w-9 h-9 rounded-lg text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                        <Maximize2 size={14} />
                    </button>
                    <div className="h-px w-6 bg-white/15 my-0.5" />
                    <button onClick={onCerrar} title="Cerrar  ( Esc )"
                        className="w-9 h-9 rounded-lg text-white/75 hover:text-white hover:bg-rose-500/30 flex items-center justify-center transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Moverse entre avistamientos. Abajo y al centro: a los costados
                    chocaban con la ficha y con el riel de controles. */}
                {(hayAnterior || haySiguiente) && !acercado && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/75 backdrop-blur-md border border-white/15 p-1 shadow-lg shadow-black/60">
                        <button onClick={onAnterior} disabled={!hayAnterior} title="Anterior  ( ← )"
                            className="w-8 h-8 rounded-full text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                            <ChevronLeft size={17} />
                        </button>
                        <button onClick={onSiguiente} disabled={!haySiguiente} title="Siguiente  ( → )"
                            className="w-8 h-8 rounded-full text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                            <ChevronRight size={17} />
                        </button>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
