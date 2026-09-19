"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
    X, ChevronLeft, ChevronRight, Camera, ZoomIn, ZoomOut, Maximize2,
    Scan, Car, Home, Phone, ParkingSquare, ShieldAlert, Star, Search as Lupa,
    Layers, UserPlus, Radio, LogIn, LogOut, Image as IconoFoto, Video, Eye, Loader2,
    PlayCircle, Download, Archive, ShieldBan, PanelBottom, ScanFace,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActividadEnVivo } from "@/components/tracking/ActividadEnVivo";
import { leerDuracion } from "@/components/tracking/Cronometro";
import { ChapaMercosur } from "@/components/tracking/ChapaMercosur";
import { ContornoDeteccion } from "@/components/tracking/ContornoDeteccion";
import { Skeleton } from "@/components/ui/skeleton";
import { montarVivo } from "@/lib/vivo";
import { leerRecuadro } from "@/lib/deteccion";
import { getCarLogo } from "@/lib/car-logos";
import { fechaCorta, horaSeg } from "@/lib/fechas";

export type CuadroAvistamiento = {
    plate: string;
    cameraName?: string | null;
    deviceId?: string | null;
    timestamp: string | Date;
    confidence?: number | null;
    reads?: number | null;
    snapshotUrl?: string | null;
    bbox?: string | null;
    /** GRANT | DENY | UNKNOWN. Lo que decidió el control de acceso, si hubo uno. */
    decision?: string | null;
    estado?: string | null;
    estDesde?: string | Date | null;
    estHasta?: string | Date | null;
    estCerrada?: boolean | null;

    /* ── Lo que trae un evento de acceso y no trae una lectura de seguimiento ──
     *
     * Están en el MISMO tipo a propósito. Un paso por la barrera y una lectura de una
     * cámara de calle son el mismo hecho contado con distinto detalle: "a esta hora, esta
     * chapa, en esta cámara". Tener dos tipos obliga a tener dos visores, y ahí empiezan a
     * separarse — que es exactamente lo que había: dos ventanas que mostraban lo mismo y
     * se veían como dos productos distintos.
     *
     * Lo que no se comparte es el SIGNIFICADO, y eso se resuelve al dibujar: un acceso
     * decidió si la barrera abría y por eso lleva permitido o denegado; una lectura
     * interior no decide nada. Los campos que no vienen simplemente no se dibujan.
     */

    /** ENTRY | EXIT. */
    direccion?: string | null;
    /** PLATE | FACE | TAG. Con qué se identificó. */
    tipoAcceso?: string | null;
    /** Cuánto estuvo adentro, si esto es una salida y se pudo calcular. */
    permanenciaMs?: number | null;
    /** El rostro capturado, cuando el acceso fue por cara. */
    rostroUrl?: string | null;
    /** Qué tanto coincidió el rostro, de 0 a 100. */
    similitud?: number | null;
    /**
     * El renglón crudo `Marca: X, Color: Y, Tipo: Z` que escriben los equipos Hikvision.
     *
     * Se parsea acá y no en cada pantalla: hoy lo parsean tres, cada una con su función, y
     * las tres cortan por coma y por el primer dos puntos — o sea, el mismo código escrito
     * tres veces esperando a que alguien lo cambie en una sola.
     */
    detalles?: string | null;
};

/** Lo que los equipos dejan escrito en `details`, desarmado. */
export function leerDetalles(detalles?: string | null): Record<string, string> {
    if (!detalles) return {};
    const d: Record<string, string> = {};
    for (const parte of String(detalles).split(",")) {
        const i = parte.indexOf(":");
        if (i <= 0) continue;
        const k = parte.slice(0, i).trim();
        const v = parte.slice(i + 1).trim();
        if (k && v) d[k] = v;
    }
    return d;
}

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
 * Una ventana inmersiva: la foto ocupa todo y los datos flotan sobre ella, fundidos con un
 * lavado del color del estado en vez de encerrados en paneles con marco. La versión
 * anterior funcionaba pero se veía como tres cajas negras apoyadas sobre una foto, y un
 * marco separa dos cosas — acá los datos y la imagen son lo mismo: son el evento.
 *
 * **El color lo pone el estado, no el diseño.** Un solo dato, `--visor-tono`, baja por CSS
 * a todo lo que está encendido: el lavado ambiental, el resplandor, la retícula sobre la
 * chapa, el anillo del cronómetro, el tilde de la placa. Cambiar de un vehículo conocido a
 * uno en lista negra cambia una variable y se tiñe la ventana entera.
 *
 * Y ese tono no es el del ejemplo del que salió este diseño. Ahí había dos estados,
 * "autorizado" en verde y "no reconocido" en rojo. **Una matrícula desconocida no es una
 * alarma**: en un barrio pasan todo el día repartos, visitas, remises y obreros, y pintar
 * de rojo cada uno enseña al operador a ignorar el rojo, que es exactamente lo que no se
 * quiere el día que el rojo importe. Lo desconocido va en gris — que es lo que se sabe:
 * nada. El rojo queda para la lista negra, el ámbar para el pedido de captura.
 *
 * Tres zonas, y cada una contesta una pregunta distinta:
 *
 *   IZQUIERDA   la ficha, empezando por la chapa dibujada como chapa. El operador está
 *               comparando lo que dice el sistema contra lo que ve en la foto, y en la
 *               foto hay una matrícula: mismo formato y misma separación hacen esa
 *               comparación directa.
 *
 *   SOBRE EL    el estado y el tiempo, anclados al recuadro de la chapa con una guía fina.
 *   VEHÍCULO    Con tres vehículos en cuadro, un rótulo flotando no dice de cuál habla.
 *
 *   DERECHA     los controles, en vertical y en cápsula de vidrio. Son lo único que no es
 *               dato, así que van del otro lado y en otra orientación.
 *
 * La superficie es oscura en los dos temas, y no es una excepción: acá el fondo no lo pone
 * la aplicación, lo pone la cámara.
 *
 * Se puede acercar. Una matrícula chica en un cuadro de calle es justo lo que hay que
 * mirar de cerca para saber si el lector acertó, y sin acercar no se distingue una B de
 * una 8. El zoom va al puntero — no al centro — porque lo que interesa casi nunca está en
 * el medio, y con la rueda, el doble clic o el pellizco. Al acercar, TODO lo demás se
 * apaga: el lavado, la ficha, los rótulos. Quien acerca vino a ver píxeles.
 */

const ESCALA_MAX = 8;
const ESCALA_DOBLE_CLIC = 3;

/**
 * La proporción de la ventana. Tiene que coincidir con `.visor-ventana` en globals.css —
 * es el mismo número dicho de los dos lados, uno para dibujar el marco y otro para decidir
 * si la foto lo cubre a lo ancho o a lo alto.
 */
const AR_VENTANA = 16 / 9;

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

/**
 * De qué color se tiñe la ventana.
 *
 * El orden importa: la lista manda sobre el padrón. Un vehículo puede estar perfectamente
 * registrado Y estar en la lista negra — de hecho es el caso que más importa —, y ahí lo
 * que hay que ver es la lista, no el registro.
 */
function tonoDelEstado(fila: CuadroAvistamiento, ficha?: FichaMatricula | null) {
    const cat = ficha?.vigilancia?.categoria;
    if (cat === "negra") return "var(--mal)";
    // Denegado: el sistema miró y dijo que no. Eso sí es rojo — es un hecho, no una
    // ausencia de datos.
    if (fila.decision === "DENY") return "var(--mal)";
    if (cat === "busca") return "var(--aviso)";
    if (cat === "vip") return "var(--quieto)";
    if (ficha?.dueno || ficha?.marca) return "var(--bien)";
    // Desconocida: no se sabe nada, y eso no es una alarma.
    return "var(--muted-foreground)";
}

/**
 * En qué momento de su historia está este vehículo.
 *
 * Cuatro, y cada uno se dice distinto porque son cosas distintas:
 *
 *   pasó          cruzó el encuadre y siguió. No tiene duración: tiene hora.
 *   llegó         acaba de estacionar y la estadía todavía no se consolidó. Un auto
 *                 detenido dos minutos puede ser alguien que baja a abrir un portón, así
 *                 que hasta que cruza el umbral del servidor es "llegó", no "estacionado".
 *   estacionado   lleva ahí lo suficiente como para que sea una estadía de verdad.
 *   se fue        la estadía se cerró. El reloj queda quieto en cuánto estuvo.
 *
 * El umbral que separa "llegó" de "estacionado" es `limiteMin`, y viene del servidor: es
 * el mismo con el que el barrendero decide que una estadía se consolidó. Sin él no se
 * puede afirmar la diferencia, así que no se afirma: queda en "estacionado".
 */
function momentoDeLaEstadia(fila: CuadroAvistamiento, limiteMin?: number | null) {
    if (fila.estado !== "ESTACIONADO") {
        return { clave: "paso" as const, etiqueta: "Pasó", icono: Car };
    }
    if (fila.estCerrada) {
        return { clave: "fue" as const, etiqueta: "Se fue", icono: LogOut };
    }
    const desde = fila.estDesde ? new Date(fila.estDesde).getTime() : null;
    const recien = desde != null && limiteMin != null && (Date.now() - desde) < limiteMin * 60000;
    return recien
        ? { clave: "llego" as const, etiqueta: "Llegó", icono: LogIn }
        : { clave: "quieto" as const, etiqueta: "Estacionado", icono: ParkingSquare };
}

/**
 * Una etiqueta de la ficha.
 *
 * Cuando no hay valor NO desaparece: queda como etiqueta fantasma, con el borde punteado y
 * el texto apagado. Es al revés de lo que uno haría — un campo vacío parece ruido — pero el
 * hueco dice algo: muestra qué se podría saber de este vehículo y no se sabe. Una ficha que
 * esconde los campos que le faltan se ve completa cuando está vacía, y nadie va a cargar lo
 * que no sabe que falta.
 */
function Etiqueta({ icono: Icono, valor, falta, sufijo, verificado }: {
    icono: any; valor?: string | null; falta: string; sufijo?: string | null; verificado?: boolean;
}) {
    if (!valor) {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-dashed border-white/15 text-white/30">
                <Icono size={13} />
                <span className="text-[11px] font-medium">{falta}</span>
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-xl border border-white/15">
            <Icono size={13} className="text-white/55" />
            <span className="text-[12px] font-medium text-white/95">{valor}</span>
            {sufijo && (
                <span className="text-[11px] tabular-nums" style={{ color: "color-mix(in oklab, var(--visor-tono) 65%, #fff)" }}>
                    {sufijo}
                </span>
            )}
            {verificado && (
                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
                    style={{ background: "color-mix(in oklab, var(--visor-tono) 30%, transparent)" }}>
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"
                        style={{ color: "color-mix(in oklab, var(--visor-tono) 75%, #fff)" }}>
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </span>
            )}
        </span>
    );
}

/**
 * Una acción del visor. Píldora de vidrio, todas iguales.
 *
 * `destacada` es para la única que conviene que salte — casi siempre registrar la
 * matrícula, porque es la que llena un hueco. Dos botones destacados en la misma fila no
 * destacan ninguno.
 */
function Pildora({ icono: Ico, children, onClick, href, destacada, encendida, ocupada, title }: {
    icono: React.ComponentType<{ size?: number; className?: string }>;
    children: React.ReactNode;
    onClick?: () => void;
    href?: string | null;
    destacada?: boolean;
    encendida?: boolean;
    ocupada?: boolean;
    title?: string;
}) {
    const clase = cn(
        "visor-vidrio flex items-center gap-2 py-2 px-4 rounded-full text-[12px] font-semibold whitespace-nowrap disabled:opacity-60",
        (destacada || encendida) ? "visor-vidrio-activo text-white" : "text-white/90 hover:text-white",
    );
    const dentro = (
        <>
            {ocupada ? <Loader2 size={14} className="animate-spin" /> : <Ico size={14} />}
            {children}
        </>
    );
    if (href) {
        return <a href={href} download title={title} className={clase}>{dentro}</a>;
    }
    return (
        <button type="button" onClick={onClick} disabled={ocupada} title={title} className={clase}>
            {dentro}
        </button>
    );
}



/** Una medida de la lectura. Sin caja: viven sobre la imagen, con sombra de texto. */
function Medida({ valor, rotulo, tono, ayuda }: { valor: string; rotulo: string; tono?: string; ayuda?: string }) {
    return (
        <span className="inline-flex items-baseline gap-1" title={ayuda}>
            <span className={cn("text-[11px] font-bold tabular-nums", tono || "text-white/85")}>{valor}</span>
            <span className="text-[10px] text-white/45">{rotulo}</span>
        </span>
    );
}

export function VisorCuadro({
    fila, ficha, onRegistrar, limiteMin,
    historial, cargandoHistorial,
    onGrabacion, hrefClip, onExportar, onListaNegra, enListaNegra, ocupadoLista,
    hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar,
}: {
    fila: CuadroAvistamiento;
    ficha?: FichaMatricula | null;
    /** Dar de alta esta matrícula. Sin esto, los campos vacíos solo informan. */
    onRegistrar?: (plate: string) => void;
    /** Contra qué minutos se mide el anillo de la estadía. Sin esto el anillo barre el minuto. */
    limiteMin?: number | null;

    /**
     * Los pasos anteriores de esta chapa.
     *
     * Viene de afuera y no se pide acá: quien lo pide sabe si está mirando accesos, o
     * lecturas de calle, o las dos cosas. El visor sólo lo dibuja — y mientras no venga, la
     * solapa del historial no aparece, que es más honesto que una lista vacía.
     */
    historial?: { id?: string; momento: string | Date; camara?: string | null; direccion?: string | null; decision?: string | null }[];
    cargandoHistorial?: boolean;

    /* Las acciones. Cada una se dibuja SÓLO si le pasan el manejador: un botón que no hace
       nada es peor que no tenerlo, porque el operador lo aprieta igual y aprende que la
       pantalla a veces no responde. */
    onGrabacion?: () => void;
    hrefClip?: string | null;
    onExportar?: () => void;
    onListaNegra?: () => void;
    enListaNegra?: boolean;
    ocupadoLista?: boolean;

    hayAnterior?: boolean;
    haySiguiente?: boolean;
    onAnterior?: () => void;
    onSiguiente?: () => void;
    onCerrar: () => void;
}) {
    const [escala, setEscala] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [verContorno, setVerContorno] = useState(true);
    /**
     * El cajón de los pasos anteriores.
     *
     * El modal viejo de acceso tenía tres solapas arriba: perfil, historial y datos. Las
     * tres se fueron, cada una por su motivo.
     *
     * El **perfil** ya es la ficha de la izquierda: ponerlo también en una solapa era
     * mostrarlo dos veces.
     *
     * Los **datos de la lectura** llegué a hacerlos y los saqué. Eran una lista de
     * dieciséis renglones que tapaba media ventana para decir, sobre todo, lo que ya está
     * escrito debajo de la chapa: «90% confianza · 2 cuadros · 3,3% del cuadro». Un panel
     * grande que repite tres números chicos no agrega nada; ocupa. Lo único que no estaba
     * arriba —el recuadro en crudo, el identificador del equipo— es material de depuración,
     * y para eso está la base.
     *
     * Queda el **historial**, que es lo único que el visor no puede mostrar de otra forma, y
     * baja desde abajo en vez de partir la ventana con solapas en el borde superior.
     */
    const [cajon, setCajon] = useState<"" | "historial">("");
    const [copiada, setCopiada] = useState(false);
    /**
     * La proporcion de la foto. Arranca en 16:9 — que es lo que entrega cualquier camara
     * de seguridad — y se corrige con la medida real en cuanto la imagen carga. Arrancar
     * en un valor razonable evita el salto de un cuadro sin proporcion a uno con ella.
     */
    const [proporcion, setProporcion] = useState(AR_VENTANA);
    /** Qué se está mirando: el cuadro guardado o lo que la cámara ve ahora. */
    const [modo, setModo] = useState<"foto" | "vivo">("foto");
    const [vivoListo, setVivoListo] = useState(false);
    const vivoRef = useRef<HTMLVideoElement | null>(null);
    const marco = useRef<HTMLDivElement | null>(null);
    /** La caja de la imagen: mas chica que la ventana cuando la foto no es 16:9. */
    const cajaImg = useRef<HTMLDivElement | null>(null);
    const arrastre = useRef<{ x: number; y: number; px: number; py: number; movio: boolean } | null>(null);
    const pellizco = useRef<number | null>(null);

    const acercado = escala > 1.01;
    const recuadro = leerRecuadro(fila.bbox);

    const reiniciar = useCallback(() => { setEscala(1); setPos({ x: 0, y: 0 }); }, []);

    /** La proporción real de la foto, de donde venga. */
    const medir = useCallback((i: HTMLImageElement) => {
        if (i.naturalWidth && i.naturalHeight) setProporcion(i.naturalWidth / i.naturalHeight);
    }, []);

    // Cada foto se abre sin acercar: heredar el zoom de la anterior desorienta.
    useEffect(() => { reiniciar(); setProporcion(AR_VENTANA); setModo("foto"); }, [fila.snapshotUrl, reiniciar]);

    /**
     * Acerca manteniendo quieto el punto que está bajo el puntero.
     * Escalar sobre el centro hace que lo que se quería mirar se escape del marco.
     */
    const zoomEn = useCallback((nueva: number, clienteX?: number, clienteY?: number) => {
        const caja = cajaImg.current?.getBoundingClientRect() || null;
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
        const caja = cajaImg.current?.getBoundingClientRect();
        if (!recuadro || !caja) return;
        // Que la chapa ocupe alrededor de un tercio del ancho del marco.
        const destino = Math.max(1, Math.min(ESCALA_MAX, 0.34 / recuadro.w));
        const cx = (recuadro.x + recuadro.w / 2 - 0.5) * caja.width;
        const cy = (recuadro.y + recuadro.h / 2 - 0.5) * caja.height;
        setEscala(destino);
        setPos(acotar({ x: -cx * destino, y: -cy * destino }, destino, caja));
    }, [recuadro]);

    /**
     * El vivo de la cámara, dentro del mismo visor.
     *
     * Una captura contesta "qué pasó"; el vivo contesta "qué está pasando", que es la
     * pregunta siguiente y hasta ahora obligaba a irse a otra pantalla — perdiendo de paso
     * la ficha y la chapa que se estaban mirando. Van las dos en la misma ventana y se
     * alterna con un botón.
     *
     * El flujo se monta sólo cuando se lo pide: abrir el visor de un evento de hace tres
     * días no tiene por qué levantar un RTSP.
     */
    useEffect(() => {
        if (modo !== "vivo") return;
        const v = vivoRef.current;
        if (!v || !fila.deviceId) return;
        setVivoListo(false);
        const alAndar = () => setVivoListo(true);
        v.addEventListener("playing", alAndar);
        const cortar = montarVivo(v, fila.deviceId);
        return () => { v.removeEventListener("playing", alAndar); cortar(); };
    }, [modo, fila.deviceId]);

    /**
     * Ir a mirar si el vehículo sigue ahí.
     *
     * El estado que muestra la cápsula sale de la última vez que la cámara lo vio, y entre
     * que un auto se va y que el sistema se entera pasan minutos — irse no genera ninguna
     * lectura. Para lo que se mira de pasada alcanza; para cuando alguien está por llamar
     * al dueño o por anotar una novedad, no. Esto pide un cuadro AHORA y pregunta.
     *
     * Las tres respuestas son tres, no dos: sigue, se fue, y **no se pudo mirar**. La
     * tercera se dice como lo que es, porque confundirla con "se fue" haría que el sistema
     * diera por retirado a un vehículo que está ahí.
     */
    const [verificando, setVerificando] = useState(false);
    const [veredicto, setVeredicto] = useState<{ tono: "bien" | "mal" | "aviso"; texto: string } | null>(null);

    const verificar = useCallback(async () => {
        setVerificando(true);
        setVeredicto(null);
        try {
            const r = await fetch("/api/tracking/stays/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plate: fila.plate }),
            });
            const j = await r.json().catch(() => ({}));
            if (j?.resultado === "sigue") setVeredicto({ tono: "bien", texto: j.mensaje });
            else if (j?.resultado === "se_fue") setVeredicto({ tono: "mal", texto: j.mensaje });
            else if (j?.resultado === "cerrada") setVeredicto({ tono: "aviso", texto: j.mensaje });
            else setVeredicto({ tono: "aviso", texto: j?.mensaje || j?.error || "No se pudo mirar la cámara." });
        } catch (e: any) {
            setVeredicto({ tono: "aviso", texto: e?.message || "No se pudo consultar." });
        } finally {
            setVerificando(false);
        }
    }, [fila.plate]);

    const copiar = useCallback(() => {
        try { navigator.clipboard?.writeText(fila.plate); setCopiada(true); setTimeout(() => setCopiada(false), 1600); } catch { }
    }, [fila.plate]);

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
     * Dónde va la cápsula del estado y el tiempo.
     *
     * Sobre el VEHÍCULO, no sobre la matrícula. Pegada a la chapa tapaba justo lo que se
     * vino a mirar, y además quedaba a la altura de la parrilla, que no es donde uno espera
     * el nombre de una cosa: un rótulo se pone arriba del objeto que nombra.
     *
     * La distancia se mide en ALTURAS DE LA CHAPA LEÍDA, no en fracciones fijas del cuadro.
     * Una matrícula mide 13 cm, así que siete alturas son unos 90 cm por encima de ella:
     * más o menos el techo de un auto. Y como la chapa se ve más chica cuanto más lejos
     * está, la cápsula se aleja menos en los autos del fondo y más en los de adelante,
     * sola. Nada de esto necesita calibración ni supone que la chapa mire de frente: es un
     * desplazamiento, no una medición, y si cae diez centímetros arriba o abajo no afirma
     * nada falso.
     */
    const ALTURAS_SOBRE_EL_AUTO = 7;
    const rotulo = (() => {
        if (!recuadro) return null;
        const cx = (recuadro.x + recuadro.w / 2) * 100;
        const arriba = (recuadro.y - ALTURAS_SOBRE_EL_AUTO * recuadro.h) * 100;
        // Si no entra arriba, el marco la recortaría justo donde dice el tiempo.
        const abajo = arriba < 6;
        const y = abajo
            ? (recuadro.y + recuadro.h) * 100 + ALTURAS_SOBRE_EL_AUTO * recuadro.h * 100
            : arriba;
        const ancla = abajo ? (recuadro.y + recuadro.h) * 100 : recuadro.y * 100;
        return { cx, y, abajo, guiaDesde: Math.min(y, ancla), guiaAlto: Math.abs(y - ancla) };
    })();

    const conf = typeof fila.confidence === "number" ? Math.round(fila.confidence * 100) : null;
    const momento = new Date(fila.timestamp);
    const tonoConf = conf == null ? "text-white/30" : conf >= 85 ? "visor-bien" : conf >= 65 ? "visor-aviso" : "visor-mal";

    const estacionado = fila.estado === "ESTACIONADO";
    const cerrada = !!fila.estCerrada;
    const dueno = ficha?.dueno;
    const vig = ficha?.vigilancia;
    const IconoVig = vig?.categoria ? (ICONO_VIGILANCIA[vig.categoria] || ShieldAlert) : null;
    const conocida = !!(ficha?.dueno || ficha?.marca);

    /**
     * Marca, modelo y color: primero lo del padrón, después lo que vio la cámara.
     *
     * El padrón es lo que alguien cargó a mano y verificó; el renglón `Marca: X` lo escribe
     * el equipo Hikvision con lo que reconoció en ese cuadro. Cuando los dos existen gana
     * el padrón — y se marca de dónde salió cada dato, porque "Peugeot gris" cargado por
     * el administrador y "Peugeot gris" adivinado por una cámara no valen lo mismo.
     */
    const meta = useMemo(() => leerDetalles(fila.detalles), [fila.detalles]);
    const marca = ficha?.marca || meta.Marca || null;
    const modelo = ficha?.modelo || meta.Modelo || null;
    const color = ficha?.color || meta.Color || null;
    const tipoVeh = ficha?.tipo || meta.Tipo || null;
    const deLaCamara = !ficha?.marca && !!meta.Marca;

    const logo = getCarLogo(marca);
    const tono = tonoDelEstado(fila, ficha);
    const momentoEst = momentoDeLaEstadia(fila, limiteMin);

    /** Un acceso es un hecho distinto de una lectura: decidió si la barrera abría. */
    const esAcceso = !!fila.decision;
    const salida = fila.direccion === "EXIT";
    const rostro = fila.rostroUrl || meta.FaceImage || null;

    /**
     * La cápsula del estado y el tiempo.
     *
     * Se arma una sola vez y se dibuja en uno de dos lugares, según haya o no recuadro:
     * anclada al vehículo cuando se sabe dónde está, y arriba al centro cuando no.
     *
     * Ese segundo caso era, hasta acá, ningún caso: la cápsula sólo existía si había
     * `bbox`, así que en todos los avistamientos viejos y en todo lo que llega desde el
     * historial —que no traía el recuadro— el visor abría sin estado y sin cronómetro. Y
     * el estado no depende del recuadro: que no se sepa DÓNDE está el auto no quiere decir
     * que no se sepa que estacionó hace cuarenta minutos.
     */
    const capsula = (
        <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 26, delay: 0.12 }}>
            <ActividadEnVivo
                desde={estacionado ? fila.estDesde : null}
                hasta={estacionado && cerrada ? fila.estHasta : null}
                limiteMin={estacionado && !cerrada ? limiteMin : null}
                /*
                 * Un acceso no tiene duración: tiene hora. Salvo cuando es una SALIDA y se
                 * pudo calcular cuánto estuvo adentro — ahí el número que importa no es la
                 * hora de salida sino la permanencia, que es la pregunta que alguien se
                 * hace mirando una salida: "¿cuánto estuvo?".
                 */
                texto={estacionado ? undefined
                    : (salida && fila.permanenciaMs ? leerDuracion(fila.permanenciaMs) : horaSeg(momento))}
                icono={esAcceso ? (salida ? LogOut : LogIn) : momentoEst.icono}
                etiqueta={esAcceso ? (salida ? "Salió" : "Entró") : momentoEst.etiqueta}
                sub={vig?.etiqueta
                    || (fila.decision === "DENY" ? "No abrió" : fila.decision === "GRANT" ? "Abrió" : "")
                    || (conocida ? "En el padrón" : "Sin registrar")}
            />
        </motion.div>
    );

    return (
        /*
         * El fondo NO cierra.
         *
         * Cerraba con un clic afuera, que es la costumbre — y acá está mal por una razón
         * concreta: en esta ventana se arrastra. Se acerca a una chapa, se corre la imagen
         * para encontrarla, y si el puntero sale del marco mientras se arrastra, el clic
         * cae en el fondo y la ventana desaparece con todo el trabajo de encuadre adentro.
         * El costo de equivocarse en un sentido (cerrar sin querer) es mucho mayor que en
         * el otro (tener que apuntarle a la cruz).
         */
        <div className="fixed inset-0 z-[3400] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-150">

            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
                onClick={(e) => e.stopPropagation()}
                style={{ ["--visor-tono" as any]: tono, borderRadius: "var(--radio-ventana)" }}
                className="visor-ventana relative overflow-hidden border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.85)] bg-[#05070b]">

                <div
                    ref={marco}
                    className={cn("absolute inset-0 overflow-hidden flex items-center justify-center", acercado ? (arrastre.current ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in")}
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
                        setPos(acotar({ x: a.px + dx, y: a.py + dy }, escala, cajaImg.current?.getBoundingClientRect() || null));
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
                    {/* La imagen, su retícula y la cápsula se mueven JUNTAS: van dentro del
                        mismo transform, si no el recuadro se despega de la chapa al acercar. */}
                    <div
                        ref={cajaImg}
                        className="relative"
                        style={{
                            /*
                             * La caja toma la proporción REAL de la foto y CUBRE la ventana:
                             * el lado que sobra se recorta contra el marco.
                             *
                             * Antes se encajaba (`contain`) y quedaban franjas negras arriba
                             * y abajo, que es lo primero que se ve y lo primero que molesta.
                             * Cubrir recorta unos píxeles de los bordes — casi siempre cielo
                             * o vereda — a cambio de que la foto llene la ventana.
                             *
                             * La caja sigue siendo exactamente la imagen, no la ventana, y por
                             * eso las superposiciones se pueden seguir midiendo en porcentaje:
                             * el recuadro de la chapa no se despega aunque sobresalga.
                             */
                            height: proporcion >= AR_VENTANA ? "100%" : "auto",
                            width: proporcion >= AR_VENTANA ? "auto" : "100%",
                            aspectRatio: String(proporcion),
                            transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${escala})`,
                            transformOrigin: "center",
                            transition: arrastre.current || pellizco.current != null ? "none" : "transform 160ms cubic-bezier(.22,1,.36,1)",
                        }}>
                        {/*
                          * `ref` Y `onLoad`, y no sólo `onLoad`.
                          *
                          * Acá estaba el defecto que corría las detecciones. Si la foto ya
                          * estaba en la caché del navegador, el evento `load` ocurre ANTES de
                          * que React alcance a enganchar el manejador: `onLoad` no se llama
                          * nunca, la proporción queda en el 16:9 de arranque, y el recuadro
                          * de la chapa — que se mide en porcentaje de la caja — apunta a otro
                          * lado. Se notaba al cambiar el tamaño de la ventana justamente
                          * porque ahí la foto sí venía de caché. El `ref` pregunta por
                          * `complete`, que es un estado y no un evento, así que no se puede
                          * perder.
                          */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            ref={(i) => { if (i?.complete && i.naturalWidth) medir(i); }}
                            src={fila.snapshotUrl || ""} alt={fila.plate}
                            onLoad={(e) => medir(e.currentTarget)}
                            className={cn("block w-full h-full object-cover select-none",
                                modo === "vivo" && "invisible")}
                            draggable={false} />
                        {modo === "vivo" && (
                            <>
                                <video ref={vivoRef} muted autoPlay playsInline
                                    className="absolute inset-0 w-full h-full object-cover bg-black" />
                                {/* Mientras go2rtc levanta el flujo. Un rectángulo negro y
                                    quieto no se distingue de una cámara caída; el esqueleto
                                    dice que algo está viniendo. */}
                                {!vivoListo && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#05070b]">
                                        <Skeleton brillo superficie="oscura" className="absolute inset-0 rounded-none" />
                                        <span className="relative flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-xl border border-white/15">
                                            <Radio size={11} className="animate-pulse" style={{ color: "var(--visor-tono)" }} />
                                            <span className="text-[11.5px] font-semibold text-white/80">Conectando con la cámara…</span>
                                        </span>
                                    </div>
                                )}
                            </>
                        )}

                        {/* La retícula marca dónde estaba la chapa EN ESA FOTO. Sobre el vivo
                            sería una marca sobre una escena que ya cambió, así que se apaga. */}
                        {modo === "foto" && verContorno && (
                            <ContornoDeteccion bbox={fila.bbox} plate={fila.plate} escala={escala} />
                        )}

                        {/* La cápsula va DENTRO del transform para seguir al auto mientras
                            se acerca, pero con la escala invertida: si creciera con el zoom,
                            a 8x taparía media foto. */}
                        {rotulo && (
                            <>
                                <div className="visor-guia absolute z-[19] pointer-events-none"
                                    style={{
                                        left: `${rotulo.cx}%`,
                                        top: `${rotulo.guiaDesde}%`,
                                        height: `${rotulo.guiaAlto}%`,
                                        width: `${1 / escala}px`,
                                        marginLeft: `${-0.5 / escala}px`,
                                        transform: rotulo.abajo ? "scaleY(-1)" : undefined,
                                    }} />
                                <div className="absolute z-20"
                                    style={{
                                        left: `${rotulo.cx}%`,
                                        top: `${rotulo.y}%`,
                                        transform: `translate(-50%, ${rotulo.abajo ? "0" : "-100%"}) scale(${1 / escala})`,
                                        transformOrigin: rotulo.abajo ? "top center" : "bottom center",
                                    }}>
                                    {capsula}
                                </div>
                            </>
                        )}
                    </div>

                    {/* El lavado ambiental del estado, fundido sobre la imagen. Se apaga al
                        acercar: quien acerca vino a ver píxeles, no un degradado encima. */}
                    <div className={cn("visor-ambiente absolute inset-0 z-[5] pointer-events-none transition-opacity duration-300",
                        acercado && "opacity-0")} />
                    <div className={cn("absolute inset-0 z-[5] pointer-events-none bg-gradient-to-t from-black/80 via-transparent to-black/45 transition-opacity duration-300",
                        acercado && "opacity-0")} />
                    <div className={cn("visor-orbe absolute left-[-6%] top-[24%] w-[460px] h-[460px] rounded-full z-[4] pointer-events-none transition-opacity duration-300",
                        acercado && "!opacity-0")} />
                </div>

                {/* Sin recuadro no hay a qué anclarla, pero el estado sigue siendo un
                    dato: va arriba al centro, donde no tapa la ficha ni los controles. */}
                {!rotulo && (
                    <div className={cn("absolute top-16 left-1/2 -translate-x-1/2 z-20 transition-opacity duration-200",
                        acercado && "opacity-0 pointer-events-none")}>
                        {capsula}
                    </div>
                )}

                {/* ── ARRIBA · de dónde salió esta lectura ─────────────────────────── */}
                <div className="absolute top-0 inset-x-0 z-30 flex items-start justify-between p-4 md:p-5 pointer-events-none">
                    <div className="flex items-center gap-2 pointer-events-auto">
                        <span className="px-3 py-1.5 rounded-full bg-black/45 backdrop-blur-xl border border-white/15 flex items-center gap-2">
                            <Radio size={11} style={{ color: "var(--visor-tono)" }} />
                            <span className="text-[11px] font-semibold tracking-wide text-white/90 max-w-[240px] truncate">
                                {fila.cameraName || fila.deviceId || "Cámara desconocida"}
                            </span>
                        </span>
                        {vig && (
                            <span className="px-3 py-1.5 rounded-full backdrop-blur-xl border flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
                                style={{
                                    background: "color-mix(in oklab, var(--visor-tono) 22%, transparent)",
                                    borderColor: "color-mix(in oklab, var(--visor-tono) 50%, transparent)",
                                    color: "color-mix(in oklab, var(--visor-tono) 65%, #fff)",
                                }}>
                                {IconoVig && <IconoVig size={12} />}
                                {vig.etiqueta || vig.categoria}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 pointer-events-auto">
                        {(hayAnterior || haySiguiente) && (
                            <span className="visor-panel rounded-full p-1 flex items-center gap-0.5">
                                <button type="button" onClick={onAnterior} disabled={!hayAnterior} title="Anterior  ( ← )"
                                    className="w-8 h-8 rounded-full text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                                    <ChevronLeft size={17} />
                                </button>
                                <button type="button" onClick={onSiguiente} disabled={!haySiguiente} title="Siguiente  ( → )"
                                    className="w-8 h-8 rounded-full text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent flex items-center justify-center transition-colors">
                                    <ChevronRight size={17} />
                                </button>
                            </span>
                        )}
                        <button type="button" onClick={onCerrar} title="Cerrar  ( Esc )"
                            className="visor-vidrio w-9 h-9 rounded-full text-white/85 hover:text-white flex items-center justify-center">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* ── IZQUIERDA · LA FICHA ─────────────────────────────────────────── */}
                <div className={cn(
                    "absolute left-5 md:left-8 top-1/2 -translate-y-1/2 z-20 max-w-[min(420px,42vw)] flex flex-col gap-3.5 transition-opacity duration-200",
                    acercado && "opacity-0 pointer-events-none",
                )}>
                    <ChapaMercosur plate={fila.plate} conocida={conocida} onCopiar={copiar} />

                    {/* Qué tan buena fue la lectura. Va pegado a la chapa y no en un rincón
                        porque es lo que dice si hay que creerle a la chapa de arriba. */}
                    <div className="flex items-center gap-3 visor-sombra-texto -mt-1">
                        <Medida valor={conf != null ? `${conf}%` : "—"} rotulo="confianza" tono={tonoConf}
                            ayuda="Qué tan seguro estaba el lector de esta lectura." />
                        <span className="text-white/20">·</span>
                        <Medida valor={fila.reads != null ? String(fila.reads) : "—"} rotulo="cuadros"
                            ayuda="En cuántos cuadros seguidos de la ráfaga se leyó lo mismo. Una chapa vista en cinco vale mucho más que una vista en uno." />
                        <span className="text-white/20">·</span>
                        <Medida
                            valor={recuadro ? `${(recuadro.w * 100).toFixed(1)}%` : "—"}
                            rotulo="del cuadro"
                            tono={!recuadro ? "text-white/30" : recuadro.w >= 0.05 ? "visor-bien" : recuadro.w >= 0.03 ? "visor-aviso" : "visor-mal"}
                            ayuda="Ancho de la matrícula respecto del cuadro. Por debajo de 3% el lector empieza a fallar." />
                        {copiada && (
                            <span className="text-[10px] font-semibold" style={{ color: "color-mix(in oklab, var(--visor-tono) 70%, #fff)" }}>
                                copiada
                            </span>
                        )}
                    </div>

                    {/*
                      * El rostro, cuando el acceso fue por cara.
                      *
                      * Va al lado de la chapa y no en su lugar: un mismo evento puede tener
                      * las dos cosas — el auto entró y la cámara de la garita le leyó la
                      * cara al conductor —, y elegir una de las dos escondería la otra.
                      *
                      * El porcentaje es lo que el equipo dijo que se parecía. Se muestra
                      * con su tono porque una coincidencia del 62% y una del 97% llevan a
                      * decisiones distintas, y el número solo no lo grita.
                      */}
                    {rostro && (
                        <div className="flex items-center gap-3 visor-sombra-texto">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={rostro} alt="" width={56} height={56}
                                className="w-14 h-14 rounded-xl object-cover border border-white/25 bg-black shrink-0" />
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white/90">
                                    <ScanFace size={13} className="text-white/55" />
                                    Reconocimiento facial
                                </div>
                                {fila.similitud != null && (
                                    <div className="text-[12px] mt-0.5">
                                        <span className={cn("font-bold tabular-nums",
                                            fila.similitud >= 85 ? "visor-bien" : fila.similitud >= 65 ? "visor-aviso" : "visor-mal")}>
                                            {Math.round(fila.similitud)}%
                                        </span>
                                        <span className="text-white/50"> de coincidencia</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* La marca. */}
                    <div className="flex items-center gap-3.5 visor-sombra-texto">
                        <span className="relative w-11 h-11 rounded-xl bg-gradient-to-b from-white/20 via-white/10 to-white/5 border border-white/25 backdrop-blur-md flex items-center justify-center shrink-0">
                            {logo
                                ? <Image src={logo} alt={marca || ""} fill sizes="44px" className="object-contain p-2.5" />
                                : <Car size={20} className="text-white/70" />}
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-2xl md:text-3xl font-bold tracking-[0.06em] uppercase text-white/95 truncate leading-none">
                                {marca || "Sin marca"}
                            </h2>
                            <p className="text-[12.5px] text-white/70 truncate mt-1.5">
                                {[modelo, color, tipoVeh].filter(Boolean).join(" · ") || "Modelo y color sin cargar"}
                                <span className="text-white/25 mx-1.5">•</span>
                                <span className="font-semibold" style={{ color: "color-mix(in oklab, var(--visor-tono) 70%, #fff)" }}>
                                    {conocida ? "En el padrón" : "No figura en el padrón"}
                                </span>
                                {/* De dónde salió el dato. "Peugeot gris" cargado por el
                                    administrador y "Peugeot gris" adivinado por una cámara
                                    no valen lo mismo, y quien mira tiene que poder saberlo. */}
                                {deLaCamara && (
                                    <span className="text-white/45 italic ml-1.5">· lo reconoció la cámara</span>
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Quién y de dónde. Lo que falta también se muestra, en fantasma. */}
                    <div className="flex flex-wrap items-center gap-2 visor-sombra-texto">
                        <Etiqueta icono={Home} valor={dueno?.nombre} falta="Sin residente" verificado={!!dueno?.nombre} />
                        <Etiqueta icono={Layers}
                            valor={[dueno?.unidad, dueno?.apartamento].filter(Boolean).join(" · ") || null}
                            falta="Sin unidad"
                            sufijo={dueno?.cochera ? `Cochera ${dueno.cochera}` : null} />
                        <Etiqueta icono={Phone} valor={dueno?.telefono} falta="Sin teléfono" />
                        {!dueno?.cochera && <Etiqueta icono={ParkingSquare} valor={null} falta="Sin cochera" />}
                    </div>

                    {/* El hueco tiene que poder llenarse desde donde se ve. Mandar a buscar
                        el alta en otra pantalla es la forma más segura de que la matrícula
                        quede sin cargar. */}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {!dueno && onRegistrar && (
                            <Pildora icono={UserPlus} destacada onClick={() => onRegistrar(fila.plate)}>
                                Registrar esta matrícula
                            </Pildora>
                        )}
                        {estacionado && !cerrada && fila.deviceId && (
                            <Pildora icono={Eye} onClick={verificar} ocupada={verificando}
                                title="Toma un cuadro de la cámara ahora y busca esta matrícula en el encuadre">
                                {verificando ? "Mirando…" : "¿Sigue ahí?"}
                            </Pildora>
                        )}
                        {onGrabacion && (
                            <Pildora icono={PlayCircle} onClick={onGrabacion}
                                title="Ver la grabación del NVR en este instante">
                                Grabación
                            </Pildora>
                        )}
                        {hrefClip && (
                            <Pildora icono={Download} href={hrefClip} title="Bajar un clip de treinta segundos">
                                Clip
                            </Pildora>
                        )}
                        {onExportar && (
                            <Pildora icono={Archive} onClick={onExportar}
                                title="Un ZIP con la foto, el clip y los datos del evento">
                                Exportar
                            </Pildora>
                        )}
                        {onListaNegra && (
                            <Pildora icono={ShieldBan} onClick={onListaNegra} encendida={enListaNegra} ocupada={ocupadoLista}
                                title={enListaNegra ? "Sacar esta matrícula de la lista negra" : "Marcar esta matrícula y alertar cuando aparezca"}>
                                {enListaNegra ? "Quitar de la lista" : "Lista negra"}
                            </Pildora>
                        )}
                        {historial && (
                            <Pildora icono={PanelBottom} onClick={() => setCajon((c) => c ? "" : "historial")}
                                encendida={!!cajon} title="Las veces anteriores que se vio esta matrícula">
                                {cajon ? "Cerrar" : `Pasos anteriores${historial.length ? ` (${historial.length})` : ""}`}
                            </Pildora>
                        )}
                    </div>

                    {veredicto && (
                        <div className={cn("flex items-start gap-2 px-3 py-2 rounded-xl bg-black/55 backdrop-blur-xl border text-[12px] max-w-[380px]",
                            veredicto.tono === "bien" ? "visor-bien" : veredicto.tono === "mal" ? "visor-mal" : "visor-aviso")}
                            style={{ borderColor: "rgba(255,255,255,0.15)" }}>
                            <Eye size={13} className="mt-0.5 shrink-0" />
                            <span className="font-medium">{veredicto.texto}</span>
                        </div>
                    )}
                </div>

                {/* ── DERECHA · LOS CONTROLES, EN VERTICAL ─────────────────────────── */}
                <div className="absolute right-4 md:right-5 top-1/2 -translate-y-1/2 z-30 visor-panel rounded-full p-1.5 flex flex-col items-center gap-1.5">
                    {fila.deviceId && (
                        <>
                            <button type="button"
                                onClick={() => setModo((m) => (m === "vivo" ? "foto" : "vivo"))}
                                title={modo === "vivo" ? "Volver al cuadro guardado" : "Ver lo que la cámara ve ahora"}
                                className={cn("visor-vidrio w-9 h-9 rounded-full flex items-center justify-center",
                                    modo === "vivo" ? "visor-vidrio-activo text-white" : "text-white/85 hover:text-white")}>
                                {modo === "vivo" ? <IconoFoto size={15} /> : <Video size={15} />}
                            </button>
                            <span className="w-4 h-px bg-white/15" />
                        </>
                    )}
                    {modo === "foto" && recuadro && (
                        <>
                            <button type="button" onClick={irALaChapa} title="Acercar a la matrícula  ( P )"
                                className="visor-vidrio w-9 h-9 rounded-full text-white/85 hover:text-white flex items-center justify-center">
                                <Lupa size={15} />
                            </button>
                            <button type="button" onClick={() => setVerContorno((v) => !v)} title="Marcar lo que detectó el lector  ( C )"
                                className={cn("visor-vidrio w-9 h-9 rounded-full flex items-center justify-center",
                                    verContorno ? "visor-vidrio-activo text-white" : "text-white/85 hover:text-white")}>
                                <Scan size={15} />
                            </button>
                            <span className="w-4 h-px bg-white/15" />
                        </>
                    )}
                    <button type="button" onClick={() => zoomEn(escala * 1.6)} disabled={escala >= ESCALA_MAX} title="Acercar  ( + )"
                        className="visor-vidrio w-9 h-9 rounded-full text-white/85 hover:text-white disabled:opacity-25 flex items-center justify-center">
                        <ZoomIn size={15} />
                    </button>
                    <span className="text-[10.5px] font-bold tabular-nums text-white/65 select-none">
                        {escala.toFixed(1)}×
                    </span>
                    <button type="button" onClick={() => zoomEn(escala / 1.6)} disabled={!acercado} title="Alejar  ( − )"
                        className="visor-vidrio w-9 h-9 rounded-full text-white/85 hover:text-white disabled:opacity-25 flex items-center justify-center">
                        <ZoomOut size={15} />
                    </button>
                    <button type="button" onClick={reiniciar} disabled={!acercado} title="Volver al tamaño original  ( 0 )"
                        className="visor-vidrio w-9 h-9 rounded-full text-white/85 hover:text-white disabled:opacity-25 flex items-center justify-center">
                        <Maximize2 size={14} />
                    </button>
                </div>

                {/* ── EL CAJÓN · los pasos anteriores y los datos crudos ───────────── */}
                <AnimatePresence>
                    {cajon && (
                        <motion.div
                            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                            transition={{ type: "spring", stiffness: 380, damping: 36 }}
                            className="absolute inset-x-0 bottom-0 z-40 visor-panel rounded-t-2xl max-h-[58%] flex flex-col">

                            <div className="shrink-0 flex items-center gap-1 px-3 pt-2.5 pb-2">
                                <span className="px-2 text-[12px] font-semibold text-white/80">
                                    Pasos anteriores{historial?.length ? ` · ${historial.length}` : ""}
                                </span>
                                <button type="button" onClick={() => setCajon("")} title="Cerrar"
                                    className="ml-auto w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
                                    <X size={15} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-3 pb-3">
                                {cajon === "historial" && (
                                    cargandoHistorial ? (
                                        <div className="py-8 text-center text-[12px] text-white/50">Buscando pasos anteriores…</div>
                                    ) : !historial?.length ? (
                                        <div className="py-8 text-center text-[12px] text-white/50">
                                            Es la primera vez que se ve esta matrícula.
                                        </div>
                                    ) : (
                                        <ul className="divide-y divide-white/10">
                                            {historial.slice(0, 40).map((h, i) => (
                                                <li key={h.id || i} className="flex items-center justify-between gap-4 py-2">
                                                    <span className="flex items-center gap-2 min-w-0">
                                                        {h.direccion === "EXIT"
                                                            ? <LogOut size={13} className="text-white/45 shrink-0" />
                                                            : <LogIn size={13} className="text-white/45 shrink-0" />}
                                                        <span className="text-[12.5px] text-white/85 truncate">
                                                            {h.camara || "Cámara sin nombre"}
                                                        </span>
                                                        {h.decision && (
                                                            <span className={cn("text-[10px] font-bold uppercase tracking-wider",
                                                                h.decision === "GRANT" ? "visor-bien" : "visor-mal")}>
                                                                {h.decision === "GRANT" ? "abrió" : "no abrió"}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="text-[11.5px] text-white/55 tabular-nums shrink-0">
                                                        {fechaCorta(h.momento)} · {horaSeg(h.momento)}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )
                                )}

                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── ABAJO · cuándo, y con qué se está mirando ────────────────────── */}
                <div className="absolute bottom-0 inset-x-0 z-30 flex items-center justify-between px-5 md:px-7 py-3.5 pointer-events-none text-[11px] text-white/50 tabular-nums">
                    <span className="flex items-center gap-2.5">
                        {modo === "vivo" ? (
                            <>
                                <Radio size={11} className="animate-pulse" style={{ color: "var(--visor-tono)" }} />
                                <span className="font-semibold" style={{ color: "color-mix(in oklab, var(--visor-tono) 60%, #fff)" }}>
                                    En vivo
                                </span>
                                <span className="text-white/20">·</span>
                                <span>el cuadro guardado es de {horaSeg(momento)}</span>
                            </>
                        ) : (
                            <>
                                <Camera size={11} className="text-white/35" />
                                {fechaCorta(momento)}
                                <span className="text-white/20">·</span>
                                {horaSeg(momento)}
                            </>
                        )}
                    </span>
                    <span className="flex items-center gap-2.5">
                        {acercado && <span>arrastrar para mover</span>}
                        {acercado && <span className="text-white/20">·</span>}
                        <span>Esc para {acercado ? "alejar" : "cerrar"}</span>
                    </span>
                </div>
            </motion.div>
        </div>
    );
}
