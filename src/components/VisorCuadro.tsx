"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
    X, ChevronLeft, ChevronRight, Camera, ZoomIn, ZoomOut, Maximize2,
    Scan, Car, Home, ParkingSquare, ShieldAlert, Star, Search as Lupa,
    UserPlus, Radio, LogIn, LogOut, Image as IconoFoto, Video, Eye, EyeOff,
    PlayCircle, Download, Archive, ShieldBan, ScanFace, Sparkles, Activity, GalleryHorizontal, Cctv, Undo2, Share2, ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ActividadEnVivo } from "@/components/tracking/ActividadEnVivo";
import { leerDuracion } from "@/components/tracking/Cronometro";
import { ChapaMercosur } from "@/components/tracking/ChapaMercosur";
import { ContornoDeteccion } from "@/components/tracking/ContornoDeteccion";
import { Skeleton } from "@/components/ui/skeleton";
import { montarVivo } from "@/lib/vivo";
import { leerRecuadro } from "@/lib/deteccion";
import { leerChapa } from "@/lib/categoria-chapa";
import { getCarLogo } from "@/lib/car-logos";
import { datoDeCamara, useMarcasCamara } from "@/lib/marca-vehiculo";
import { fechaCorta, hora, horaSeg } from "@/lib/fechas";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { LogoSobreFoto } from "@/components/empresas/LogoSobreFoto";
import { useSiluetas } from "@/lib/use-siluetas";
import type { Analisis } from "@/lib/vision-capa";
import { BotonVisor, Dato, ListaVision, Seccion } from "@/components/visor/FichaVisor";
import { TiraPasos, type PasoVisor } from "@/components/visor/TiraPasos";
import { PanelComportamiento, type ComportamientoVisor } from "@/components/visor/PanelComportamiento";
import { VerGrabacion, canalDe } from "@/components/video/VerGrabacion";
import { CompartirEvento } from "@/components/visor/CompartirEvento";
import { GrabacionVisor } from "@/components/visor/GrabacionVisor";
import { SeguimientoVivo } from "@/components/visor/SeguimientoVivo";
import { BuscarParecidos } from "@/components/visor/BuscarParecidos";
import { describirObjeto } from "@/components/visor/FichaVisor";
import { chapaDe, esSinLectura, MarcaOmniVision, MarcaVerificacion, textoChapa } from "@/components/vision/ChapaReleida";

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
    /** La visita que estaba abierta a esa hora: a qué lote iba y hasta cuándo. */
    visita?: { tipo?: string | null; lote?: string | null; nombre?: string | null; empresa?: string | null; entra?: string; vence?: string; sale?: string | null } | null;
};

/**
 * Lo que el visor sabe ADEMÁS de la lectura, cuando quien lo abre lo consulta (el historial,
 * por /api/history/ficha): lo que vio OmniVision en la foto, la relectura de una NO_LEIDA y la
 * empresa. Todo opcional: las pantallas que no lo pasan ven el visor como siempre.
 */
export type DatosVisor = {
    /** La chapa con la que se armó la ficha (la releída, si `porRelectura`). */
    plate?: string | null;
    porRelectura?: boolean;
    ficha?: FichaMatricula | null;
    vision?: Analisis | null;
    relectura?: {
        estado: string; plate: string | null; confianza: number | null; vehiculo?: string | null;
        recorte?: string | null; chapa?: string | null; otras?: { plate: string; confianza: number }[];
        /** Dónde está la chapa en la foto (normalizado): se dibuja con las siluetas. */
        caja?: [number, number, number, number] | null;
    } | null;
    empresa?: { nombre: string; logo: string; transparente: boolean } | null;
    /** Los pasos de la chapa en los últimos días y cuándo se la ve (panel «Comportamiento»). */
    comportamiento?: ComportamientoVisor | null;
};

/**
 * Lo que el equipo escribió como marca cuando no la reconoció: «Brand 1723», «Unknown», un
 * código suelto. Dibujado como título parecía una marca de verdad.
 */
const SIN_DATO = /^(brand\s*)?\d+$|^unknown$|^desconocid[oa]$|^other$|^otro$|^vehicle$|^veh[ií]culo$/i;
const dato = (v?: string | null) => (v && !SIN_DATO.test(v.trim()) ? v : null);

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

// Las categorías canónicas de la lista de vigilancia; las viejas (negra/busca/vip) se aceptan
// por si llega una ficha de una instancia sin migrar.
const ICONO_VIGILANCIA: Record<string, any> = { BLACKLISTED: ShieldAlert, SEARCH: Lupa, WHITELISTED: Star, negra: ShieldAlert, busca: Lupa, vip: Star };
const esNegra = (c?: string | null) => c === "BLACKLISTED" || c === "negra";
const esBusca = (c?: string | null) => c === "SEARCH" || c === "busca";
const esVip = (c?: string | null) => c === "WHITELISTED" || c === "vip";

/**
 * De qué color se tiñe la ventana.
 *
 * El orden importa: la lista manda sobre el padrón. Un vehículo puede estar perfectamente
 * registrado Y estar en la lista negra — de hecho es el caso que más importa —, y ahí lo
 * que hay que ver es la lista, no el registro.
 */
function tonoDelEstado(fila: CuadroAvistamiento, ficha?: FichaMatricula | null) {
    const cat = ficha?.vigilancia?.categoria;
    if (esNegra(cat)) return "var(--mal)";
    // Denegado: el sistema miró y dijo que no. Eso sí es rojo — es un hecho, no una
    // ausencia de datos.
    if (fila.decision === "DENY") return "var(--mal)";
    if (esBusca(cat)) return "var(--aviso)";
    if (esVip(cat)) return "var(--quieto)";
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
    // "Visto" no es "pasó". La cámara lo vio en un rincón del cuadro que no vigila y no
    // volvió a verlo el tiempo suficiente: decir que pasó seria afirmar un recorrido que
    // nadie observó.
    if (fila.estado === "VISTO") {
        return { clave: "visto" as const, etiqueta: "Visto", icono: Eye };
    }
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

export function VisorCuadro({
    fila, ficha, onRegistrar, limiteMin,
    historial, cargandoHistorial,
    onGrabacion, hrefClip, onClip, onExportar, onListaNegra, enListaNegra, ocupadoLista,
    hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar,
    datos, cargandoFicha, tapado,
}: {
    fila: CuadroAvistamiento;
    ficha?: FichaMatricula | null;
    /** OmniVision, relectura y empresa (ver DatosVisor). */
    datos?: DatosVisor | null;
    /** La ficha se está consultando: no decir «no figura en el padrón» antes de saberlo. */
    cargandoFicha?: boolean;
    /** Dar de alta esta matrícula. Sin esto, los campos vacíos solo informan. */
    onRegistrar?: (plate: string) => void;
    /**
     * Un cajón abierto desde el visor (el alta de la matrícula) va encima. El visor vive sobre
     * la capa de los paneles para poder abrirse desde una ficha en un cajón, así que el alta
     * quedaba DEBAJO, tapada. Mientras esto está prendido el visor baja una capa y deja el
     * teclado: Esc cierra el cajón, no el evento que se está registrando.
     */
    tapado?: boolean;
    /** Contra qué minutos se mide el anillo de la estadía. Sin esto el anillo barre el minuto. */
    limiteMin?: number | null;

    /**
     * Los pasos anteriores de esta chapa.
     *
     * Viene de afuera y no se pide acá: quien lo pide sabe si está mirando accesos, o
     * lecturas de calle, o las dos cosas. El visor sólo lo dibuja — y mientras no venga, la
     * solapa del historial no aparece, que es más honesto que una lista vacía.
     */
    historial?: PasoVisor[];
    cargandoHistorial?: boolean;

    /* Las acciones. Cada una se dibuja SÓLO si le pasan el manejador: un botón que no hace
       nada es peor que no tenerlo, porque el operador lo aprieta igual y aprende que la
       pantalla a veces no responde. */
    onGrabacion?: () => void;
    hrefClip?: string | null;
    /** Si viene, "Clip" abre el diálogo (qué trae, cambiarlo, mandarlo por WhatsApp) en vez de bajar directo. */
    onClip?: () => void;
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
     * Las siluetas de OmniVision encima de la foto. La misma preferencia que las miniaturas del
     * historial (lib/use-siluetas): apagarlas acá las apaga también atrás.
     */
    const [verSiluetas, setVerSiluetas] = useSiluetas();
    const vision = datos?.vision && datos.vision.objetos?.length ? datos.vision : null;
    const [copiada, setCopiada] = useState(false);
    /**
     * Sin nada encima. Mirando el vivo (o una foto) a veces lo que estorba es la ficha, la
     * cápsula, los lavados y los botones: con H (o el ojo tachado) se va todo y queda la imagen
     * limpia; con H, Esc o el botón chico de la esquina vuelve.
     */
    const [limpio, setLimpio] = useState(false);
    /** Qué consulta está abierta: la tira de pasos anteriores o el panel de comportamiento. */
    const [panel, setPanel] = useState<null | "pasos" | "comportamiento">(null);
    /** Un paso anterior mostrado en grande en lugar de la foto del evento (desde la tira o el panel). */
    const [pasoViendo, setPasoViendo] = useState<PasoVisor | null>(null);
    /** El visor completo de la cámara (vivo con sus controles, o la grabación de este instante). */
    const [abrirCamara, setAbrirCamara] = useState<null | "live" | "rec">(null);
    /** El diálogo para mandar el evento por WhatsApp o Telegram. */
    const [compartir, setCompartir] = useState(false);
    /**
     * Si la cámara graba en un NVR: entonces la grabación se mira ACÁ, en el lugar de la foto
     * (GrabacionVisor). Sin canal, se usa lo que haya traído quien abrió el visor (`onGrabacion`),
     * y si tampoco, no hay botón: un botón de grabación sin grabación no se dibuja.
     */
    const [hayGrabacion, setHayGrabacion] = useState(false);
    useEffect(() => {
        if (!fila.deviceId) { setHayGrabacion(false); return; }
        let vivo = true;
        canalDe(fila.deviceId).then((c) => { if (vivo) setHayGrabacion(c.ch != null); });
        return () => { vivo = false; };
    }, [fila.deviceId]);
    /**
     * La proporcion de la foto. Arranca en 16:9 — que es lo que entrega cualquier camara
     * de seguridad — y se corrige con la medida real en cuanto la imagen carga. Arrancar
     * en un valor razonable evita el salto de un cuadro sin proporcion a uno con ella.
     */
    const [proporcion, setProporcion] = useState(AR_VENTANA);
    /** Qué se está mirando: el cuadro guardado o lo que la cámara ve ahora. */
    const [modo, setModo] = useState<"foto" | "vivo" | "grabacion">("foto");
    /** El cajón del clip de la grabación: se abre desde la barra del reproductor o desde los íconos de arriba. */
    const [clip, setClip] = useState(false);
    /** Buscar lo que se ve en la foto en todas las cámaras (recorte → OmniVision / NVR). */
    const [parecidos, setParecidos] = useState(false);
    /** La grabación de OTRA cámara, abierta desde un resultado de «Buscar parecidos». */
    const [grabacionDe, setGrabacionDe] = useState<{ deviceId: string; ms: number; camara: string } | null>(null);
    useEffect(() => { if (modo !== "grabacion") setClip(false); }, [modo]);
    // El cajón del clip entra por la derecha del reproductor: con la ficha y la barra de arriba a la
    // vista, se le encimarían. Mientras está abierto, la vista queda limpia.
    useEffect(() => { if (clip) setLimpio(true); }, [clip]);
    const [vivoListo, setVivoListo] = useState(false);
    /** HD (flujo principal) o SD (secundario, liviano), como el botón del visor de intrusión. */
    const [calidad, setCalidad] = useState<"hd" | "sd">("hd");
    const [avisoCalidad, setAvisoCalidad] = useState(0);
    useEffect(() => { if (!avisoCalidad) return; const t = setTimeout(() => setAvisoCalidad(0), 1200); return () => clearTimeout(t); }, [avisoCalidad]);
    /** Siguiendo a otra cámara con el seguimiento visual (null = la del evento). */
    const [camVivo, setCamVivo] = useState<{ id: string; nombre: string } | null>(null);
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
    useEffect(() => { reiniciar(); setProporcion(AR_VENTANA); setModo("foto"); setLimpio(false); setPasoViendo(null); }, [fila.snapshotUrl, reiniciar]);
    // Al pasar a un paso anterior (o volver), la foto es otra: se abre sin acercar y se vuelve a medir.
    useEffect(() => { reiniciar(); setProporcion(AR_VENTANA); }, [pasoViendo?.foto, reiniciar]);

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
    const idVivo = camVivo?.id || fila.deviceId;
    useEffect(() => { if (modo !== "vivo") setCamVivo(null); }, [modo]);
    useEffect(() => { setCamVivo(null); }, [fila.deviceId]);
    useEffect(() => {
        if (modo !== "vivo") return;
        const v = vivoRef.current;
        if (!v || !idVivo) return;
        setVivoListo(false);
        const alAndar = () => setVivoListo(true);
        v.addEventListener("playing", alAndar);
        const cortar = montarVivo(v, idVivo, 4, calidad);
        return () => { v.removeEventListener("playing", alAndar); cortar(); };
    }, [modo, idVivo, calidad]);

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

    /** La chapa que se muestra: la de la cámara o, en una NO_LEIDA, la que leyó OmniVision. */
    const chapaVisor = chapaDe(fila.plate, datos?.relectura);
    const copiar = useCallback(() => {
        try { navigator.clipboard?.writeText(chapaVisor.plate || fila.plate); setCopiada(true); setTimeout(() => setCopiada(false), 1600); } catch { }
    }, [fila.plate, chapaVisor.plate]);

    useEffect(() => {
        const tecla = (e: KeyboardEvent) => {
            // Con el visor completo de la cámara abierto encima, las teclas son de él.
            if (tapado || abrirCamara || compartir || clip || parecidos || grabacionDe) return;
            if (e.key === "Escape") {
                // Esc deshace de a una cosa, de la más nueva a la más vieja: no cierra el evento
                // de golpe estando en un paso anterior o con un panel abierto.
                if (acercado) { reiniciar(); return; }
                if (pasoViendo) { setPasoViendo(null); return; }
                if (panel) { setPanel(null); return; }
                if (modo !== "foto") { setModo("foto"); setLimpio(false); return; }
                if (limpio) { setLimpio(false); return; }
                onCerrar();
                return;
            }
            if (e.key === "h" || e.key === "H") { setLimpio((v) => !v); return; }
            // En la grabación, las flechas, el espacio y la E son del reproductor (GrabacionVisor).
            if (modo === "grabacion") return;
            if (e.key === "ArrowLeft" && hayAnterior && !acercado) onAnterior?.();
            if (e.key === "ArrowRight" && haySiguiente && !acercado) onSiguiente?.();
            if (e.key === "+" || e.key === "=") zoomEn(escala * 1.5);
            if (e.key === "-" || e.key === "_") zoomEn(escala / 1.5);
            if (e.key === "0") reiniciar();
            if (e.key === "c" || e.key === "C") setVerContorno((v) => !v);
            if ((e.key === "o" || e.key === "O") && vision) setVerSiluetas(!verSiluetas);
            if ((e.key === "p" || e.key === "P") && recuadro) irALaChapa();
        };
        window.addEventListener("keydown", tecla);
        return () => window.removeEventListener("keydown", tecla);
    }, [hayAnterior, haySiguiente, onAnterior, onSiguiente, onCerrar, acercado, escala, zoomEn, reiniciar, irALaChapa, recuadro, vision, verSiluetas, setVerSiluetas, abrirCamara, compartir, pasoViendo, panel, limpio, modo, clip, parecidos, grabacionDe, tapado]);

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
    useMarcasCamara();
    const meta = useMemo(() => leerDetalles(fila.detalles), [fila.detalles]);
    // La marca y el modelo de la cámara sólo con LPR_MARCAS prendida: fallan seguido (lib/marca-vehiculo).
    const marca = ficha?.marca || datoDeCamara(dato(meta.Marca));
    const modelo = ficha?.modelo || datoDeCamara(dato(meta.Modelo));
    const color = ficha?.color || dato(meta.Color);
    const tipoVeh = ficha?.tipo || dato(meta.Tipo);
    const deLaCamara = !ficha?.marca && !!datoDeCamara(dato(meta.Marca));

    const logo = getCarLogo(marca);
    const tono = tonoDelEstado(fila, ficha);
    const momentoEst = momentoDeLaEstadia(fila, limiteMin);

    /** Un acceso es un hecho distinto de una lectura: decidió si la barrera abría. */
    const esAcceso = !!fila.decision;
    const salida = fila.direccion === "EXIT";
    const rostro = fila.rostroUrl || meta.FaceImage || null;

    /**
     * Los pasos anteriores, de las dos fuentes: los que trajo quien abrió el visor (en el
     * historial, lo cargado en la tabla, que incluye las cámaras de calle) y los de los últimos
     * días que trae la ficha del servidor (accesos, con foto). Se juntan sin repetir: el mismo
     * acceso viene de los dos lados, con id «a_<id>» en la tabla.
     */
    const pasos = useMemo<PasoVisor[]>(() => {
        const comp = datos?.comportamiento?.pasos || [];
        const ids = new Set(comp.map((p) => p.id));
        const segundos = new Set(comp.map((p) => Math.floor(+new Date(p.momento) / 1000)));
        const lista: PasoVisor[] = comp.filter((p) => !p.actual);
        for (const h of historial || []) {
            const id = h.id?.replace(/^a_/, "");
            if (id && ids.has(id)) continue;
            if (segundos.has(Math.floor(+new Date(h.momento) / 1000))) continue;
            lista.push(h);
        }
        return lista.sort((a, b) => +new Date(b.momento) - +new Date(a.momento));
    }, [datos?.comportamiento, historial]);
    const hayPasos = !!historial || !!datos?.comportamiento;
    const comportamiento = datos?.comportamiento && datos.comportamiento.pasos.length ? datos.comportamiento : null;

    /** Lo que la cámara LPR dijo del vehículo (no el padrón): se muestra aparte, con su origen. */
    const vehiculoCamara = [dato(meta.Marca), dato(meta.Modelo), dato(meta.Color), dato(meta.Tipo)].filter(Boolean).join(" · ");
    const sentido = esAcceso
        ? (salida ? "Salida" : fila.direccion === "ENTRY" ? "Entrada" : "Acceso")
        : momentoEst.etiqueta;
    /** Mirando un paso anterior: la foto es otra y lo que se dibuja encima (chapa, siluetas, cápsula) es del evento. */
    const enPaso = !!pasoViendo?.foto;
    const fotoUrl = enPaso ? pasoViendo!.foto! : (fila.snapshotUrl || "");
    /* La grabación se mira limpia, como el vivo: el reproductor trae su propia barra. */
    const verGrabacion = hayGrabacion ? () => { setPasoViendo(null); reiniciar(); setModo("grabacion"); setLimpio(true); } : onGrabacion;

    /** Lo que sale al compartir: lo mismo que dice la ficha, en renglones (sin lo que no se sabe). */
    const textoCompartir = useMemo(() => {
        const chapaTexto = chapaVisor.omni ? `${textoChapa(chapaVisor)} (la cámara no la leyó; la leyó OmniVision)` : chapaVisor.plate || "sin leer";
        const lineas = [
            `${sentido}${fila.decision === "DENY" ? " · no abrió" : fila.decision === "GRANT" ? " · abrió" : ""} · ${fechaCorta(momento)} ${horaSeg(momento)}`,
            `Matrícula ${chapaTexto}${[marca, color].filter(Boolean).length ? ` · ${[marca, color].filter(Boolean).join(" ")}` : ""}`,
            dueno?.nombre ? `${dueno.nombre}${[dueno.unidad, dueno.apartamento].filter(Boolean).length ? ` · ${[dueno.unidad, dueno.apartamento].filter(Boolean).join(" ")}` : ""}` : (cargandoFicha ? "" : "No figura en el padrón"),
            ficha?.visita ? `Visita${ficha.visita.lote ? ` a ${ficha.visita.lote}` : ""}${ficha.visita.nombre ? ` · ${ficha.visita.nombre}` : ""}` : "",
            vig ? `Lista: ${vig.etiqueta || vig.categoria}` : "",
            vision ? `OmniVision: ${vision.objetos.slice(0, 4).map((o) => describirObjeto(o)).join("; ")}` : "",
        ].filter(Boolean);
        return { titulo: `📷 ${fila.cameraName || "Cámara"}`, lineas };
    }, [datos, fila, sentido, momento, marca, color, dueno, cargandoFicha, ficha, vig, vision, chapaVisor]);

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
                    || (cargandoFicha ? "" : conocida ? "En el padrón" : "Sin registrar")}
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
        <div className={cn("visor-raiz visor-fondo fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-150",
            tapado ? "z-[calc(var(--capa-panel)-1)]" : "z-[3400]")}>

            <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
                onClick={(e) => e.stopPropagation()}
                style={{ ["--visor-tono" as any]: tono, borderRadius: "var(--radio-ventana)" }}
                className="visor-ventana visor-marco relative overflow-hidden border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.85)] bg-[#05070b]">

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
                            src={fotoUrl} alt={fila.plate}
                            onLoad={(e) => medir(e.currentTarget)}
                            className={cn("block w-full h-full object-cover select-none",
                                modo === "vivo" && "invisible")}
                            draggable={false} />
                        {modo === "vivo" && (
                            <>
                                <video ref={vivoRef} muted autoPlay playsInline
                                    className="absolute inset-0 w-full h-full object-cover bg-black" />
                                {/* Los enlaces del seguimiento visual: tocar uno sigue en la cámara vecina. */}
                                {vivoListo && idVivo && <SeguimientoVivo deviceId={idVivo} onSeguir={(c) => { setCamVivo(c.id === fila.deviceId ? null : c); }} />}
                                {avisoCalidad > 0 && (
                                    <div className="absolute inset-0 grid place-items-center pointer-events-none z-[8]">
                                        <span className="px-5 py-2.5 rounded-2xl bg-black/55 backdrop-blur-md text-white text-lg font-extrabold tracking-[0.25em] ring-1 ring-white/15">{calidad === "hd" ? "HD · ALTA" : "SD · ESTÁNDAR"}</span>
                                    </div>
                                )}
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
                        {modo === "foto" && !enPaso && !limpio && verContorno && (
                            <ContornoDeteccion bbox={fila.bbox} plate={fila.plate} escala={escala} />
                        )}

                        {/* Lo que vio OmniVision: siluetas y rótulos. La caja es exactamente la
                            foto (misma proporción), así que el ajuste «contain» cae justo. */}
                        {modo === "foto" && !enPaso && !limpio && verSiluetas && vision && (
                            <CapaAnalisis analisis={vision} atributos className="z-[6]"
                                chapa={datos?.relectura?.plate && datos.relectura.caja ? { plate: datos.relectura.plate, caja: datos.relectura.caja } : null} />
                        )}

                        {/* La cápsula va DENTRO del transform para seguir al auto mientras
                            se acerca, pero con la escala invertida: si creciera con el zoom,
                            a 8x taparía media foto. */}
                        {rotulo && !enPaso && !limpio && (
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
                    {/* El tinte del estado no va sobre el vivo: es del evento, y sobre un video lo ensucia. */}
                    <div className={cn("visor-ambiente absolute inset-0 z-[5] pointer-events-none transition-opacity duration-300",
                        (acercado || limpio || modo === "vivo") && "opacity-0")} />
                    <div className={cn("visor-velo-vert absolute inset-0 z-[5] pointer-events-none bg-gradient-to-t from-black/80 via-transparent to-black/55 transition-opacity duration-300",
                        (acercado || limpio) && "opacity-0")} />
                    {/* Detrás de la ficha: la ficha ahora es texto en renglones, y el texto sobre
                        una calle de día necesita un fondo que le gane, no una caja. */}
                    <div className={cn("visor-velo-izq absolute inset-y-0 left-0 w-[58%] z-[5] pointer-events-none bg-gradient-to-r from-black/80 via-black/45 to-transparent transition-opacity duration-300",
                        (acercado || limpio) && "opacity-0")} />
                    {/* El orbe late con una animación de opacidad, que le gana a la clase: en la
                        vista limpia directamente no se dibuja. */}
                    {!limpio && <div className={cn("visor-orbe absolute left-[-6%] top-[24%] w-[460px] h-[460px] rounded-full z-[4] pointer-events-none transition-opacity duration-300",
                        acercado && "!opacity-0")} />}
                </div>

                {/* La grabación del NVR, en el lugar de la foto y con su propia barra de tiempo. */}
                {modo === "grabacion" && fila.deviceId && (
                    <GrabacionVisor deviceId={fila.deviceId} camara={fila.cameraName} instanteMs={momento.getTime()}
                        poster={fila.snapshotUrl} matricula={chapaVisor.plate} clip={clip} onClip={setClip}
                        marcas={pasos.filter((p) => p.camara && p.camara === fila.cameraName).map((p) => ({ ms: new Date(p.momento).getTime(), titulo: `Paso anterior · ${fechaCorta(p.momento)} ${horaSeg(p.momento)}` }))} />
                )}

                {/* Sin recuadro no hay a qué anclarla, pero el estado sigue siendo un
                    dato: va arriba al centro, donde no tapa la ficha ni los controles. */}
                {!rotulo && !enPaso && modo !== "grabacion" && (
                    <div className={cn("absolute top-24 left-1/2 -translate-x-1/2 z-20 transition-opacity duration-200",
                        (acercado || limpio) && "opacity-0 pointer-events-none")}>
                        {capsula}
                    </div>
                )}

                {/* ── ARRIBA · el título: de qué cámara y cuándo ──────────────────────
                    Era un chip chico («LPR Entrada») perdido en la esquina: lo primero que uno
                    quiere saber de un evento — dónde y cuándo — estaba escrito en 11px. Ahora es
                    el título de la ventana, y el punto del color del estado lo ata a la cápsula. */}
                <div className={cn("visor-zona absolute top-0 inset-x-0 z-30 flex items-start justify-between gap-4 p-4 md:px-7 md:py-5 pointer-events-none transition-opacity duration-200",
                    limpio && "opacity-0")}>
                    <div className={cn("flex items-center gap-4 min-w-0", !limpio && "pointer-events-auto")}>
                        <div className="min-w-0 visor-sombra-texto">
                            <h1 className="text-[20px] md:text-[22px] font-bold tracking-[-0.015em] text-white leading-tight truncate max-w-[46vw]">
                                {fila.cameraName || fila.deviceId || "Cámara desconocida"}
                            </h1>
                            <p className="flex items-center gap-2 mt-0.5 text-[12.5px] text-white/70 tabular-nums">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--visor-tono)" }} />
                                <span className="font-semibold text-white/90">{sentido}</span>
                                {fila.decision === "DENY" && <span className="visor-mal font-semibold">no abrió</span>}
                                <span className="text-white/30">·</span>
                                <span>{fechaCorta(momento)}</span>
                                <span className="text-white/30">·</span>
                                <span>{horaSeg(momento)}</span>
                            </p>
                        </div>
                        {vision && modo === "foto" && !enPaso && (
                            /* Un interruptor: se prende y se apaga, por eso es píldora. */
                            <button type="button" onClick={() => setVerSiluetas(!verSiluetas)} aria-pressed={verSiluetas}
                                title={verSiluetas ? "Ocultar las siluetas de OmniVision  ( O )" : "Mostrar lo que detectó OmniVision  ( O )"}
                                className={cn("shrink-0 h-8 px-3 rounded-full border flex items-center gap-1.5 text-[11.5px] font-semibold transition-colors",
                                    verSiluetas ? "bg-[var(--accion)] border-transparent text-white" : "bg-black/45 backdrop-blur-xl border-white/15 text-white/80 hover:text-white")}>
                                <Sparkles size={12} />
                                OmniVision · {vision.objetos.length}
                                <span className={cn("ml-0.5 w-6 h-3.5 rounded-full relative transition-colors", verSiluetas ? "bg-white/35" : "bg-white/15")}>
                                    <span className={cn("absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all", verSiluetas ? "left-3" : "left-0.5")} />
                                </span>
                            </button>
                        )}
                        {vig && (
                            <span className="visor-vig shrink-0 h-8 px-3 rounded-[8px] border flex items-center gap-1.5 text-[11.5px] font-bold"
                                style={{
                                    background: "color-mix(in oklab, var(--visor-tono) 22%, transparent)",
                                    borderColor: "color-mix(in oklab, var(--visor-tono) 50%, transparent)",
                                    color: "color-mix(in oklab, var(--visor-tono) 65%, #fff)",
                                }}>
                                {IconoVig && <IconoVig size={13} />}
                                {vig.etiqueta || vig.categoria}
                            </span>
                        )}
                    </div>

                    <div className={cn("flex items-center gap-1.5 shrink-0", !limpio && "pointer-events-auto")}>
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

                {/* Sin nada encima: lo único que queda es la forma de volver. Apagado hasta que se
                    le pasa el mouse, para no ensuciar lo que se pidió ver limpio. */}
                {limpio && !clip && (
                    <div className="absolute top-4 right-4 z-40 flex items-center gap-2 opacity-60 hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {/* Qué se está mirando: un punto y la cámara. Es lo único con texto, porque el
                            nombre de la cámara no tiene ícono. */}
                        {modo !== "foto" && (
                            <span className="h-9 pl-2.5 pr-3 rounded-full bg-black/50 backdrop-blur-xl border border-white/15 text-white/85 text-[12px] font-semibold flex items-center gap-2 max-w-[260px]">
                                {modo === "vivo"
                                    ? <Radio size={14} className="animate-pulse text-[var(--mal)] shrink-0" />
                                    : <PlayCircle size={14} className="text-[var(--accion-en-oscuro)] shrink-0" />}
                                <span className="truncate">{modo === "vivo" ? (camVivo?.nombre || fila.cameraName || "Cámara") : (fila.cameraName || "Cámara")}</span>
                            </span>
                        )}
                        <span className="h-9 rounded-full bg-black/50 backdrop-blur-xl border border-white/15 p-0.5 flex items-center gap-0.5">
                            {modo === "vivo" && camVivo && (
                                <IconoLimpio onClick={() => setCamVivo(null)} titulo={`Volver a ${fila.cameraName || "la cámara del evento"}`}><Undo2 size={15} /></IconoLimpio>
                            )}
                            {modo === "vivo" && (
                                <IconoLimpio onClick={() => { setCalidad((c) => (c === "hd" ? "sd" : "hd")); setAvisoCalidad(Date.now()); }} activo={calidad === "hd"}
                                    titulo={calidad === "hd" ? "Flujo principal (HD) · cambiar a sub-flujo, más liviano" : "Sub-flujo (SD) · cambiar a flujo principal (HD)"}>
                                    <span className="text-[10px] font-bold tracking-wide">{calidad === "hd" ? "HD" : "SD"}</span>
                                </IconoLimpio>
                            )}
                            {modo === "grabacion" && (
                                <IconoLimpio onClick={() => setClip(true)} activo={clip} titulo="Exportar un clip: descargarlo o mandarlo por WhatsApp"><Download size={15} /></IconoLimpio>
                            )}
                            {modo !== "foto" && (
                                <IconoLimpio onClick={() => { setModo("foto"); setLimpio(false); }} titulo="Volver a la foto del evento  ( Esc )"><IconoFoto size={15} /></IconoLimpio>
                            )}
                            <IconoLimpio onClick={() => setLimpio(false)} titulo="Mostrar la ficha y los controles  ( H )"><Eye size={15} /></IconoLimpio>
                            <span className="w-px h-4 bg-white/15 mx-0.5" />
                            <IconoLimpio onClick={onCerrar} titulo="Cerrar el visor"><X size={15} /></IconoLimpio>
                        </span>
                    </div>
                )}

                {/* Mirando un paso anterior: se dice cuál, y se ofrece volver. */}
                {enPaso && pasoViendo && (
                    <div className={cn("visor-zona absolute top-[92px] left-1/2 -translate-x-1/2 z-30 visor-panel rounded-[10px] pl-3.5 pr-1.5 py-1.5 flex items-center gap-3 text-[12px] text-white/85 tabular-nums",
                        limpio && "hidden")}>
                        <GalleryHorizontal size={14} className="text-white/55" />
                        <span>
                            Paso del <b className="text-white">{fechaCorta(pasoViendo.momento)} · {horaSeg(pasoViendo.momento)}</b>
                            {pasoViendo.camara ? <span className="text-white/55"> · {pasoViendo.camara}</span> : null}
                        </span>
                        <BotonVisor icono={Undo2} onClick={() => setPasoViendo(null)} title="Volver a la foto de este evento  ( Esc )">Volver al evento</BotonVisor>
                    </div>
                )}

                {/* ── IZQUIERDA · LA FICHA ─────────────────────────────────────────── */}
                {/* Todo a la vista y nada en cajones: con OmniVision la ficha puede pasar del alto
                    de la ventana, así que se desplaza (centrada si entra). */}
                <div className={cn(
                    "visor-zona absolute left-5 md:left-8 top-[88px] z-20 w-[min(420px,42vw)] overflow-y-auto overscroll-contain [scrollbar-width:none] flex flex-col transition-opacity duration-200",
                    panel === "pasos" ? "bottom-[214px]" : modo === "grabacion" ? "bottom-[150px]" : "bottom-12",
                    (acercado || limpio) && "opacity-0 pointer-events-none",
                )}>
                <div className="my-auto flex flex-col gap-3 py-2 visor-sombra-texto">
                    <div className="flex items-center gap-3">
                        {/* Una NO_LEIDA lleva la chapa que leyó OmniVision, con su marca en la banda. */}
                        <ChapaMercosur plate={chapaVisor.plate ? textoChapa(chapaVisor) : esSinLectura(fila.plate) ? "SIN LEER" : fila.plate}
                            omnivision={chapaVisor.omni ? datos?.relectura : undefined}
                            conocida={chapaVisor.plate ? conocida && !datos?.porRelectura : undefined} onCopiar={chapaVisor.plate ? copiar : undefined} />
                        {datos?.empresa && <LogoSobreFoto empresa={datos.empresa} className="h-9 max-w-[120px]" />}
                        {copiada && <span className="text-[11px] font-semibold text-white/70">copiada</span>}
                        {!chapaVisor.plate && chapaVisor.intento && datos?.relectura && <MarcaOmniVision r={datos.relectura} oscuro tamano="md" />}
                        {!chapaVisor.omni && <MarcaVerificacion plate={fila.plate} r={datos?.relectura} oscuro tamano="md" />}
                    </div>

                    {/*
                      * El rostro, cuando el acceso fue por cara. Va al lado de la chapa y no en su
                      * lugar: un mismo evento puede tener las dos cosas. El porcentaje lleva su tono
                      * porque una coincidencia del 62% y una del 97% llevan a decisiones distintas.
                      */}
                    {rostro && (
                        <div className="flex items-center gap-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={rostro} alt="" width={56} height={56}
                                className="w-14 h-14 rounded-[10px] object-cover border border-white/25 bg-black shrink-0" />
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

                    {/* La marca: del padrón si está cargada, si no la que reconoció la cámara. */}
                    <div className="flex items-center gap-3.5">
                        {/* Fondo claro: los logos de marca son oscuros (los anillos de Audi, el león de
                            Peugeot) y sobre vidrio oscuro no se veían. */}
                        <span className={cn("relative w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0",
                            logo ? "bg-white/90" : "bg-white/10 border border-white/20")}>
                            {logo
                                ? <Image src={logo} alt={marca || ""} fill sizes="44px" className="object-contain p-2" />
                                : <Car size={20} className="text-white/70" />}
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-2xl md:text-[28px] font-bold tracking-[0.04em] uppercase text-white truncate leading-none">
                                {marca || "Sin marca"}
                            </h2>
                            {([modelo, color, tipoVeh].some(Boolean) || deLaCamara) && (
                                <p className="text-[12.5px] text-white/70 truncate mt-1.5">
                                    {[modelo, color, tipoVeh].filter(Boolean).join(" · ")}
                                    {/* "Peugeot gris" cargado por el administrador y adivinado por una
                                        cámara no valen lo mismo: se dice de dónde salió. */}
                                    {deLaCamara && <span className="text-white/45 italic">{[modelo, color, tipoVeh].some(Boolean) ? " · " : ""}según la cámara</span>}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* ── El padrón: quién es y a dónde va ── */}
                    <Seccion titulo="Padrón" icono={Home}
                        extra={<span className={cn("text-[11px] font-semibold", cargandoFicha ? "text-white/45" : conocida ? "visor-bien" : "text-white/55")}>
                            {cargandoFicha ? "Consultando…" : conocida ? "Registrada" : "No figura"}
                        </span>}>
                        {cargandoFicha && !dueno ? (
                            <div className="h-4 w-48 rounded bg-white/10 animate-pulse my-1" />
                        ) : dueno ? (
                            <dl>
                                <Dato rotulo="Residente" valor={dueno.nombre} />
                                <Dato rotulo="Lote" valor={[dueno.unidad, dueno.apartamento].filter(Boolean).join(" · ") || null} />
                                <Dato rotulo="Teléfono" valor={dueno.telefono} />
                                <Dato rotulo="Cochera" valor={dueno.cochera} falta="sin asignar" />
                            </dl>
                        ) : (
                            <div className="flex items-center justify-between gap-3 py-0.5">
                                {/* Lo que dice la chapa sola (18/10, Nico: «dar una mejor descripción a desconocidos»). */}
                                <span className="text-[12.5px] text-white/60">
                                    {(() => { const l = chapaVisor.plate ? leerChapa(chapaVisor.plate) : null; return l && (l.categoria || l.extranjera) ? <>No está en el padrón. <b className="text-white/90">{l.frase}</b>{l.confianza === "probable" ? " (probable)" : ""}.</> : "Esta matrícula no está en el padrón."; })()}
                                </span>
                                {/* Con la chapa que se ve (la releída, en una NO_LEIDA). Sin chapa no hay qué dar de alta. */}
                                {onRegistrar && chapaVisor.plate && (
                                    <BotonVisor icono={UserPlus} destacada onClick={() => onRegistrar(chapaVisor.plate!)}>Registrar</BotonVisor>
                                )}
                            </div>
                        )}
                        {ficha?.visita && (
                            <dl>
                                <Dato rotulo="Visita"
                                    valor={[ficha.visita.tipo, ficha.visita.lote ? `a ${ficha.visita.lote}` : null, ficha.visita.nombre].filter(Boolean).join(" · ") || "Visita"}
                                    sufijo={ficha.visita.sale ? `salió ${hora(new Date(ficha.visita.sale))}` : ficha.visita.vence ? `hasta ${hora(new Date(ficha.visita.vence))}` : null} />
                            </dl>
                        )}
                        {datos?.porRelectura && datos.plate && (
                            <p className="text-[11.5px] text-white/55 mt-1 leading-snug">
                                La cámara no leyó la chapa: estos datos son de <b className="text-white/90 tracking-wider">{datos.plate}</b>, la que releyó OmniVision. Confirmalo mirando la foto.
                            </p>
                        )}
                    </Seccion>

                    {/* ── Lo que dijo la cámara LPR ── separado de OmniVision: son dos equipos distintos
                        mirando la misma foto, y cuando no coinciden hay que poder ver quién dijo qué. */}
                    {(conf != null || fila.reads != null || recuadro || vehiculoCamara) && (
                        <Seccion titulo="Según la cámara" icono={Camera}>
                            <dl>
                                {(conf != null || fila.reads != null) && (
                                    <Dato rotulo="Lectura" tono={cn("font-bold tabular-nums", tonoConf)}
                                        valor={conf != null ? `${conf} %` : null} falta="sin dato"
                                        sufijo={fila.reads != null ? `en ${fila.reads} ${fila.reads === 1 ? "cuadro" : "cuadros"}` : null} />
                                )}
                                {recuadro && (
                                    <Dato rotulo="Chapa"
                                        tono={cn("font-semibold tabular-nums", recuadro.w >= 0.05 ? "visor-bien" : recuadro.w >= 0.03 ? "visor-aviso" : "visor-mal")}
                                        valor={`${(recuadro.w * 100).toFixed(1)} % del ancho`}
                                        sufijo={recuadro.w < 0.03 ? "chica: el lector puede fallar" : null} />
                                )}
                                {vehiculoCamara && <Dato rotulo="Vehículo" valor={vehiculoCamara} />}
                            </dl>
                        </Seccion>
                    )}

                    {/* ── Lo que vio OmniVision ── */}
                    {(vision || datos?.relectura) && (
                        <Seccion titulo="OmniVision" icono={Sparkles}
                            extra={vision ? <span className="text-[11px] text-white/45 tabular-nums">{vision.objetos.length} {vision.objetos.length === 1 ? "objeto" : "objetos"}</span> : null}>
                            {vision && <ListaVision objetos={vision.objetos} />}
                            {datos?.relectura && <Relectura r={datos.relectura} />}
                        </Seccion>
                    )}

                    {/* ── Historia y acciones ── */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-white/12 pt-3">
                        {hayPasos && (
                            <BotonVisor icono={GalleryHorizontal} encendida={panel === "pasos"}
                                onClick={() => setPanel(panel === "pasos" ? null : "pasos")}
                                title="Las fotos de las veces anteriores que pasó esta matrícula">
                                Pasos anteriores{pasos.length ? <span className="tabular-nums text-white/55">· {pasos.length}</span> : null}
                            </BotonVisor>
                        )}
                        {comportamiento && (
                            <BotonVisor icono={Activity} encendida={panel === "comportamiento"}
                                onClick={() => setPanel(panel === "comportamiento" ? null : "comportamiento")}
                                title="Cuándo entra, cuánto se queda y en qué horarios se la ve">
                                Comportamiento
                            </BotonVisor>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 -mt-1">
                        {fila.snapshotUrl && (
                            <BotonVisor icono={Share2} onClick={() => setCompartir(true)} title="Mandar la foto con los datos del evento por WhatsApp o Telegram">
                                Compartir
                            </BotonVisor>
                        )}
                        {fila.snapshotUrl && (
                            <BotonVisor icono={ScanSearch} onClick={() => setParecidos(true)} title="Recortar algo de la foto y buscarlo en todas las cámaras con OmniVision (y en el NVR, si es VPro)">
                                Buscar parecidos
                            </BotonVisor>
                        )}
                        {estacionado && !cerrada && fila.deviceId && (
                            <BotonVisor icono={Eye} onClick={verificar} ocupada={verificando}
                                title="Toma un cuadro de la cámara ahora y busca esta matrícula en el encuadre">
                                {verificando ? "Mirando…" : "¿Sigue ahí?"}
                            </BotonVisor>
                        )}
                        {(onClip || hrefClip) && (
                            <BotonVisor icono={Download} onClick={onClip} href={onClip ? undefined : hrefClip}
                                title={onClip ? "Bajar o mandar por WhatsApp un clip de este instante" : "Bajar el clip de este instante (la duración es la de Ajustes → Video del evento)"}>
                                Clip
                            </BotonVisor>
                        )}
                        {onExportar && (
                            <BotonVisor icono={Archive} onClick={onExportar} title="Un ZIP con la foto, el clip y los datos del evento">
                                Exportar
                            </BotonVisor>
                        )}
                        {onListaNegra && (
                            <BotonVisor icono={ShieldBan} onClick={onListaNegra} encendida={enListaNegra} ocupada={ocupadoLista}
                                title={enListaNegra ? "Sacar de la lista negra: vuelve a decidir la credencial y el modo LPR; si tiene credencial vuelve a la lista blanca de las lectoras" : "Lista negra: toda lectura se registra DENEGADA (aunque tenga credencial), va a la lista negra de las lectoras, el monitor la muestra en rojo y avisa"}>
                                {enListaNegra ? "Quitar de la lista" : "Lista negra"}
                            </BotonVisor>
                        )}
                    </div>

                    {veredicto && (
                        <div className={cn("flex items-start gap-2 px-3 py-2 rounded-[8px] bg-black/55 border border-white/15 text-[12px] max-w-[380px]",
                            veredicto.tono === "bien" ? "visor-bien" : veredicto.tono === "mal" ? "visor-mal" : "visor-aviso")}>
                            <Eye size={13} className="mt-0.5 shrink-0" />
                            <span className="font-medium">{veredicto.texto}</span>
                        </div>
                    )}
                </div>
                </div>

                {/* ── DERECHA · LOS CONTROLES, EN VERTICAL ─────────────────────────── */}
                <div className={cn("visor-zona absolute right-4 md:right-5 top-1/2 -translate-y-1/2 z-30 visor-panel rounded-full p-1.5 flex flex-col items-center gap-1.5 transition-opacity duration-200",
                    limpio && "opacity-0 pointer-events-none")}>
                    {fila.deviceId && (
                        <>
                            <BotonRiel activo={modo === "vivo"}
                                onClick={() => {
                                    /* El vivo se mira limpio: la ficha, la cápsula y los lavados tapaban el video
                                       (pedido el 12/10). Al volver a la foto, vuelve todo. */
                                    const n = modo === "vivo" ? "foto" : "vivo";
                                    setPasoViendo(null); setModo(n); setLimpio(n === "vivo");
                                }}
                                title={modo === "vivo" ? "Volver al cuadro guardado" : "Ver acá lo que la cámara ve ahora"}>
                                {modo === "vivo" ? <IconoFoto size={15} /> : <Video size={15} />}
                            </BotonRiel>
                            {/* Se sacó «Abrir la cámara en vivo, con todos sus controles» (17/10, Nico): el vivo
                                ya se ve acá con el botón de arriba, y abrir otro visor encima de la ficha confundía. */}
                            {verGrabacion && (
                                <BotonRiel activo={modo === "grabacion"} onClick={modo === "grabacion" ? () => { setModo("foto"); setLimpio(false); } : verGrabacion}
                                    title={modo === "grabacion" ? "Volver a la foto del evento" : "Ver la grabación del NVR en este instante, acá"}>
                                    <PlayCircle size={15} />
                                </BotonRiel>
                            )}
                            <span className="w-4 h-px bg-white/15" />
                        </>
                    )}
                    {modo === "foto" && fila.snapshotUrl && (
                        <BotonRiel onClick={() => setParecidos(true)} title="Buscar parecidos: recortar algo de la foto y buscarlo en todas las cámaras">
                            <ScanSearch size={15} />
                        </BotonRiel>
                    )}
                    <BotonRiel onClick={() => setLimpio(true)} title="Ocultar la ficha y los controles, ver la imagen limpia  ( H )">
                        <EyeOff size={15} />
                    </BotonRiel>
                    {modo === "foto" && !enPaso && recuadro && (
                        <>
                            <BotonRiel onClick={irALaChapa} title="Acercar a la matrícula  ( P )"><Lupa size={15} /></BotonRiel>
                            <BotonRiel activo={verContorno} onClick={() => setVerContorno((v) => !v)} title="Marcar lo que detectó el lector  ( C )"><Scan size={15} /></BotonRiel>
                        </>
                    )}
                    {modo !== "grabacion" && <>
                    <span className="w-4 h-px bg-white/15" />
                    <BotonRiel onClick={() => zoomEn(escala * 1.6)} disabled={escala >= ESCALA_MAX} title="Acercar  ( + )"><ZoomIn size={15} /></BotonRiel>
                    <span className="text-[10.5px] font-bold tabular-nums text-white/65 select-none">
                        {escala.toFixed(1)}×
                    </span>
                    <BotonRiel onClick={() => zoomEn(escala / 1.6)} disabled={!acercado} title="Alejar  ( − )"><ZoomOut size={15} /></BotonRiel>
                    <BotonRiel onClick={reiniciar} disabled={!acercado} title="Volver al tamaño original  ( 0 )"><Maximize2 size={14} /></BotonRiel>
                    </>}
                </div>

                {/* ── ABAJO · con qué se está mirando ──────────────────────────────── */}
                {!panel && modo !== "grabacion" && (
                    <div className={cn("visor-zona absolute bottom-0 inset-x-0 z-30 flex items-center justify-between px-5 md:px-7 py-3.5 pointer-events-none text-[11px] text-white/50 tabular-nums transition-opacity",
                        limpio && "opacity-0")}>
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
                                <span>H para ver la imagen limpia</span>
                            )}
                        </span>
                        <span className="flex items-center gap-2.5">
                            {acercado && <span>arrastrar para mover</span>}
                            {acercado && <span className="text-white/20">·</span>}
                            <span>Esc para {acercado ? "alejar" : enPaso ? "volver al evento" : "cerrar"}</span>
                        </span>
                    </div>
                )}

                {panel === "pasos" && !limpio && (
                    <TiraPasos pasos={pasos} viendo={pasoViendo?.id || null}
                        cargando={!!cargandoHistorial || (!!cargandoFicha && !pasos.length)}
                        onElegir={(p) => { setModo("foto"); setPasoViendo(p); }}
                        onCerrar={() => setPanel(null)} />
                )}
                {panel === "comportamiento" && comportamiento && !limpio && (
                    <PanelComportamiento plate={datos?.plate || fila.plate} datos={comportamiento} viendo={pasoViendo?.id || null}
                        onElegir={(p) => { setModo("foto"); setPasoViendo(p.actual ? null : p); }}
                        onCerrar={() => setPanel(null)} />
                )}
                {/* Buscar parecidos baja como persiana DENTRO de esta ventana (antes era otra ventana a la derecha). */}
                <AnimatePresence>
                    {parecidos && fila.snapshotUrl && (
                        <BuscarParecidos key="parecidos" foto={fila.snapshotUrl} instanteMs={new Date(fila.timestamp).getTime()} onCerrar={() => setParecidos(false)}
                            onVerGrabacion={(deviceId, ms, camara) => setGrabacionDe({ deviceId, ms, camara })} />
                    )}
                </AnimatePresence>
                {/* Compartir: un cajón dentro de la ventana, como «Exportar clip». */}
                {compartir && (
                    <CompartirEvento foto={fila.snapshotUrl || null} deviceId={fila.deviceId || null} deviceName={fila.cameraName || null}
                        instante={fila.timestamp} titulo={textoCompartir.titulo} lineas={textoCompartir.lineas} onCerrar={() => setCompartir(false)} />
                )}
            </motion.div>

            {grabacionDe && (
                <VerGrabacion deviceId={grabacionDe.deviceId} nombre={grabacionDe.camara} instanteMs={grabacionDe.ms} onClose={() => setGrabacionDe(null)} />
            )}
            {abrirCamara && fila.deviceId && (
                <VerGrabacion deviceId={fila.deviceId} nombre={fila.cameraName} tab={abrirCamara}
                    instanteMs={new Date(fila.timestamp).getTime()} onClose={() => setAbrirCamara(null)} />
            )}
        </div>
    );
}

/** Un botón del riel de la derecha: redondo y de vidrio, como el resto del riel. */
function BotonRiel({ children, onClick, title, activo, disabled }: {
    children: React.ReactNode; onClick: () => void; title: string; activo?: boolean; disabled?: boolean;
}) {
    return (
        <button type="button" onClick={onClick} title={title} aria-label={title} disabled={disabled}
            className={cn("visor-vidrio w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-25",
                activo ? "visor-vidrio-activo text-white" : "text-white/85 hover:text-white")}>
            {children}
        </button>
    );
}

/**
 * La relectura de OmniVision: si la cámara no leyó la chapa, qué leyó OmniVision recortando el
 * vehículo. Un renglón más de la sección, con el recorte de la chapa para comparar.
 */
function Relectura({ r }: { r: NonNullable<DatosVisor["relectura"]> }) {
    const leyo = r.plate && (r.estado === "LEIDA" || r.estado === "DUDOSA");
    return (
        <div className="grid grid-cols-[92px_1fr] items-center gap-3 py-[3px] mt-0.5 text-[12.5px] leading-snug">
            <span className="text-white/50">Releyó</span>
            <span className="flex items-center gap-2.5 min-w-0">
                {r.chapa && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={r.chapa} alt="" className="h-7 w-auto max-w-[96px] rounded-[4px] object-contain bg-black border border-white/20" />
                )}
                {leyo ? (
                    <span className="min-w-0">
                        <b className="text-white tracking-wider">{r.plate}</b>
                        {r.confianza != null && <span className="text-white/50 tabular-nums"> · {Math.round(r.confianza * 100)} %</span>}
                        <span className={cn("block text-[11px]", r.estado === "DUDOSA" ? "visor-aviso" : "text-white/45")}>
                            {r.estado === "DUDOSA" ? "Dudosa: confirmala mirando la foto." : "Sugerencia: no cambia el evento ni la barrera."}
                        </span>
                    </span>
                ) : (
                    <span className="text-white/55">
                        {r.estado === "SIN_CHAPA" ? "Recortó el vehículo pero no encontró la chapa."
                            : r.estado === "SIN_VEHICULO" ? "No encontró un vehículo para releer."
                                : "No pudo releer la chapa."}
                    </span>
                )}
            </span>
        </div>
    );
}

/**
 * Un ícono de la cápsula de arriba a la derecha, en la vista limpia (vivo y grabación). Eran
 * píldoras con texto —«Volver a la foto», «Mostrar controles»— que tapaban una franja del video;
 * ahora son íconos con su explicación al pasar el mouse. `activo` marca lo que está prendido.
 */
function IconoLimpio({ children, onClick, titulo, activo }: { children: React.ReactNode; onClick: () => void; titulo: string; activo?: boolean }) {
    return (
        <button type="button" onClick={onClick} title={titulo} aria-label={titulo} aria-pressed={activo}
            className={cn("w-8 h-8 rounded-full grid place-items-center transition-colors",
                activo ? "bg-white text-black" : "text-white/80 hover:text-white hover:bg-white/15")}>
            {children}
        </button>
    );
}
