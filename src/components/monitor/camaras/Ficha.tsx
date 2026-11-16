"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, History, AppWindow, Maximize2, Minimize2, Camera, Radio, VideoOff, LogIn, LogOut, Crosshair, ScanEye, Joystick, ScanSearch, TriangleAlert, Route, Circle, Square, CircleCheck, BellOff, Ban } from "lucide-react";
import type { AlertaLista, AccionAlertaLista } from "./AlertaDeLista";
import { JoystickPtz } from "./Joystick";
import { metaDe } from "@/components/intrusion/comun";
import { horaCorta, hace } from "@/lib/monitor/cliente";
import { Grabacion } from "./Grabacion";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { SUAVE } from "@/components/monitor/tactil";
import { PasoVisionCanal, type PasoVision } from "./PasoVision";
import { TipVisor, tip } from "./TipVisor";
import { getImagePath } from "@/lib/image-path";
import { Vivo, Foto, Geometria, fotoDe, vivoDe, ubicacion, idCanal, FOTO_MS, useSiluetasEnVivo, type Canal, type Alerta, type Lectura } from "./piezas";
import { CapaAnalisis, type OpcionObjeto } from "@/components/vision/CapaAnalisis";
import { WatchlistDialog } from "@/components/WatchlistDialog";
import { useFuncion } from "@/lib/funciones-cliente";
import { claseDeBusqueda, motivoDesdeVivo, type ClaseBusqueda } from "@/lib/vivo-menu";
import { nombreCamara } from "@/lib/rostros";
import { IconoPolicia } from "@/components/IconoPolicia";
import { MinInteriorDialog } from "@/components/MinInteriorDialog";
import { ANTES_DE, avisoDeLlegada, type Llegada } from "@/lib/vision-llegada";
import { RotuloVisor } from "./RotuloVisor";
import type { ObjetoAnalizado } from "@/lib/vision-capa";
import { SeguimientoVisual } from "./Seguimiento";
import type { TrackLink } from "@/app/actions/detections";
import { geomDeIntrusion } from "@/lib/vision-capa";
import { cn } from "@/lib/utils";
import { CapasDeAnaliticas, useCapasDelCanal } from "./CapasDeAnaliticas";
import { MenuDeCapas } from "./MenuDeCapas";
import { CAPAS_DEFECTO, CLAVE_CAPAS, leerCapas, objetosVisibles, pideAnalisis, type CapasVisibles, type ClaveCapa } from "@/lib/capas-visibles";

/**
 * Un canal a pantalla completa, con los controles flotando encima como en el visor de eventos.
 *
 * Por qué así (pedido 15/10): la primera versión abría el canal dentro de una ventana con
 * barra de título y bordes, y el video quedaba chico en medio de la pantalla. Ahora el video
 * ocupa todo y los controles son íconos sobre la imagen que se esconden solos a los
 * OCULTAR_MS sin mover el mouse.
 *
 * En el vivo vuelven con un CLIC (o una tecla), no al mover el mouse (13/11, Nico: «cada vez que
 * muevo el mouse sobre el video en vivo se muestran los controles, no quiero eso, que se muestren
 * al hacer clic»). Desde que las siluetas se tocan —el reloj del auto y su menú—, el mouse se
 * mueve sobre el video para apuntarle a algo, y cada movimiento le bajaba encima la barra de
 * arriba y la tira de abajo. Mover el mouse sólo trae el puntero, y mantiene los controles
 * mientras ya están a la vista (para llegar hasta ellos sin que se apaguen en el camino).
 * En la grabación siguen volviendo al mover: ahí un clic sobre el cuadro es pausar.
 *
 * La grabación se ve en este mismo cuadro (Grabacion), con la regla encima: no abre otra ventana.
 * La pantalla completa es la del documento y no la de este elemento, para que los menús que
 * se montan en <body> se sigan viendo.
 */

/** Sin mover el mouse este tiempo, los controles se apagan (y el puntero, con ellos). */
const OCULTAR_MS = 3500;
/** Sin tocar nada este tiempo, la ficha se cierra: una pared no puede quedar trabada en un canal. */
const CIERRA_SOLA_MS = 3 * 60_000;
/** Cuánto antes de "ahora" arranca la grabación si no hay detección de referencia. */
const GRABACION_ANTES_MS = 60_000;
/**
 * Los canales cuya alta calidad no abrió hace poco. Sin esto, cada vez que se abría la cámara se
 * volvía a esperar por un flujo que no iba a llegar (12/11: los canales del NVR 02 de Otto Villa
 * no entregan H.265 estándar y go2rtc nunca saca el primer cuadro). Se reintenta sola a los diez
 * minutos, o al tocar el botón HD.
 */
const HD_CAIDOS = new Map<string, number>();
const HD_REINTENTO_MS = 10 * 60_000;
const hdCaido = (clave: string) => { const t = HD_CAIDOS.get(clave); return !!t && Date.now() - t < HD_REINTENTO_MS; };
/** Con una detección en curso, la grabación arranca un poco antes de ella: se ve llegar al que la causó. */
const GRABACION_ANTES_ALERTA_MS = 5_000;

function Icono({ children, onClick, titulo, activo, href }: { children: React.ReactNode; onClick?: () => void; titulo: string; activo?: boolean; href?: string }) {
    const cls = cn("w-11 h-11 rounded-full grid place-items-center transition-colors", activo ? "bg-white text-black" : "text-white/85 hover:text-white hover:bg-white/15");
    if (href) return <a href={href} target="_blank" rel="noreferrer" {...tip(titulo)} className={cls}>{children}</a>;
    return <button type="button" onClick={onClick} {...tip(titulo)} aria-pressed={activo} className={cls}>{children}</button>;
}

/** «Grabar»: el tope es el de un clip que se manda a mano (lib/clips ENVIO_MAX_SEG); menos que el mínimo es un doble clic. */
const REC_TOPE_MS = 60_000;
const REC_MINIMO_MS = 2000;
/** Cuántas lecturas entran en la pila: más tapan el video, que es lo que se vino a mirar. */
const LECTURAS_EN_PILA = 4;
const CLAVE_PILA = "oa.vivo.lecturas";
/** Ancho con que se pide la captura de cada lectura: se ve a 176 px; la original pesa 1–2 MB. */
const ANCHO_CAPTURA = 320;

/**
 * Las últimas lecturas de la cámara, cada una con su captura, apiladas a la derecha del video
 * (13/11, Nico: «apiladas en vertical, al centro a la derecha, tipo overlay con transparencia,
 * pudiendo ocultarlas»). Antes eran una fila de chapas abajo, sin foto, que aparecía y se iba con
 * los controles y chocaba con la regla de la grabación.
 *
 * No se va con los controles: es información, no un control. Se oculta a mano con su pestaña, y
 * eso se recuerda en este navegador. Escondida no pide ninguna foto.
 */
export function PilaLecturas({ lecturas }: { lecturas: Lectura[] }) {
    const [abierta, setAbierta] = useState(true);
    useEffect(() => { try { setAbierta(localStorage.getItem(CLAVE_PILA) !== "0"); } catch { /* sin almacenamiento: abierta */ } }, []);
    const alternar = () => setAbierta((a) => { try { localStorage.setItem(CLAVE_PILA, a ? "0" : "1"); } catch { /* idem */ } return !a; });
    const lista = lecturas.slice(0, LECTURAS_EN_PILA);
    return (
        <div data-capa-tocable className="absolute right-0 top-1/2 -translate-y-1/2 z-[9] flex items-center pointer-events-none">
            <button type="button" onClick={alternar} aria-expanded={abierta} {...tip(abierta ? "Ocultar las últimas lecturas" : `Últimas lecturas (${lecturas.length})`)}
                className="pointer-events-auto h-14 w-5 rounded-l-[8px] grid place-items-center bg-black/35 backdrop-blur-md border border-r-0 border-white/15 text-white/70 hover:text-white hover:bg-black/55 transition-colors">
                {abierta ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
            <AnimatePresence initial={false}>
                {abierta && (
                    <motion.div key="pila" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18 }}
                        className="pointer-events-auto mr-3 sm:mr-4 w-[176px] max-h-[74vh] overflow-y-auto [scrollbar-width:none] flex flex-col gap-1.5">
                        <span className="px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,.8)]">Últimas lecturas</span>
                        {lista.map((l) => <LecturaApilada key={l.id} l={l} />)}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function LecturaApilada({ l }: { l: Lectura }) {
    const ok = l.decision === "GRANT" && !l.listaNegra;
    const foto = getImagePath(l.foto);
    // Si la captura no llega (borrada por retención, o una pantalla sin permiso de fotos), queda la chapa sola.
    const [rota, setRota] = useState(false);
    return (
        <div className={cn("relative overflow-hidden rounded-[10px] bg-black/45 backdrop-blur-md border", l.listaNegra ? "border-[var(--mal)]" : "border-white/15")}>
            {foto && !rota && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={`${foto}${foto.includes("?") ? "&" : "?"}w=${ANCHO_CAPTURA}`} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setRota(true)} className="block w-full aspect-video object-cover opacity-90" />
            )}
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-white">
                <span className={cn("h-2 w-2 rounded-full shrink-0", ok ? "bg-[var(--bien)]" : "bg-[var(--mal)]")} />
                {l.sentido === "EXIT" ? <LogOut size={12} className="text-white/60 shrink-0" /> : <LogIn size={12} className="text-white/60 shrink-0" />}
                <span className="text-[13.5px] font-bold tabular-nums tracking-wide whitespace-nowrap">{l.plate || "SIN LEER"}</span>
                <span className="ml-auto text-[10.5px] text-white/60 tabular-nums shrink-0">{horaCorta(l.ts)}</span>
            </div>
        </div>
    );
}

type EstadoSiluetas = "apagado" | "conectando" | "vivo" | "ocupado" | "error";
/**
 * Lo que OmniVision dibuja sobre el vivo, en su propia pieza.
 *
 * Por qué es una pieza aparte (15/11, Nico: «mejorar el rendimiento mientras se graba… un VMS
 * profesional, fluido»). Medido ese día con el canal abierto: la ficha ENTERA —los dos videos, la
 * barra, las lecturas, los seiscientos renglones— se volvía a calcular 20 veces por segundo, se
 * grabara o no. El análisis llega unas diez veces por segundo y su estado vivía en la ficha, así
 * que cada cuadro de análisis era un render de todo. El reloj del REC, que era el sospechoso, no
 * sumaba nada medible. Acá adentro el análisis sólo vuelve a dibujar esta capa; hacia arriba
 * avisa nada más que cuando cambia de estado (vivo, ocupado…), que es casi nunca.
 */
const SiluetasDelVivo = memo(function SiluetasDelVivo({ stream, activo, atraso, tam, geom, hayAlerta, verGeom, vis, opciones, alEstado, msRef }: {
    stream: string | null; activo: boolean; atraso: () => number | null;
    tam: { w: number; h: number } | null; geom: Canal["geom"]; hayAlerta: boolean; verGeom: boolean;
    /** Qué capas se dibujan de lo que llega (el menú de capas). */
    vis: CapasVisibles;
    opciones: (o: ObjetoAnalizado) => OpcionObjeto[];
    alEstado: (e: EstadoSiluetas) => void;
    /** Cuánto tardó el último cuadro: se lee al armar la ayuda del botón, no hace falta dibujar por eso. */
    msRef: MutableRefObject<number | null>;
}) {
    const sil = useSiluetasEnVivo(stream, activo, atraso);
    useEffect(() => { alEstado(sil.estado); }, [sil.estado, alEstado]);
    useEffect(() => { msRef.current = sil.ms; }, [sil.ms, msRef]);
    const g = useMemo(() => (verGeom ? geomDeIntrusion(geom) : null), [verGeom, geom]);
    // Lo que llegó, sin las capas apagadas. El tamaño es el del video que se ve.
    const analisis = useMemo(() => (sil.analisis ? { ...sil.analisis, ...(tam ? { ancho: tam.w, alto: tam.h } : {}), objetos: objetosVisibles(sil.analisis.objetos, vis) } : null), [sil.analisis, tam, vis]);
    // Sin análisis (apagado, buscando, o la grabación): la línea y la zona de la cámara, quietas.
    if (!activo || !analisis) return geom && verGeom ? <Geometria geom={geom} alerta={hayAlerta} ajuste="contain" /> : null;
    // Las siluetas van sobre el vivo con el mismo ajuste (contain): el análisis es del subflujo
    // 16:9, igual que el video. Si dejan de llegar cuadros, se borran solas. `interactiva` (13/11):
    // tocar un auto muestra cuánto lleva en su lugar; sólo las siluetas reciben el toque.
    return <CapaAnalisis analisis={analisis} geom={g} ajuste="contain" interactiva opciones={opciones} />;
});

/**
 * Grabando: el punto rojo y el cronómetro, y detener de un toque. Tiene su propio reloj: el de la
 * ficha la redibujaba entera cuatro veces por segundo para mover dos dígitos.
 */
function PildoraRec({ desde, acumulado, graba, camaras, alDetener }: {
    /** Desde cuándo corre el tramo de este canal, y lo ya grabado en los canales anteriores (ms). */
    desde: number; acumulado: number; graba: boolean; camaras: number; alDetener: () => void;
}) {
    const [seg, setSeg] = useState(() => Math.floor(acumulado / 1000));
    const parar = useRef(alDetener);
    useEffect(() => { parar.current = alDetener; }, [alDetener]);
    useEffect(() => {
        const paso = () => { const ms = acumulado + (graba ? Date.now() - desde : 0); setSeg(Math.floor(ms / 1000)); if (ms >= REC_TOPE_MS) parar.current(); };
        paso();
        const t = setInterval(paso, 250);
        return () => clearInterval(t);
    }, [desde, acumulado, graba]);
    const mmss = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    return (
        <button type="button" data-capa-tocable onClick={alDetener} {...tip("Detener: el clip se arma en el servidor y queda en la bandeja")}
            className="absolute left-4 sm:left-7 bottom-5 sm:bottom-7 z-10 inline-flex items-center gap-2.5 h-11 pl-3.5 pr-4 rounded-full visor-panel text-white">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--mal)] animate-pulse" />
            <span className="text-[13px] font-bold tracking-[0.08em]">REC</span>
            <span className="text-[14px] font-semibold tabular-nums">{mmss(seg)}</span>
            <span className="text-[11.5px] text-white/60 tabular-nums">/ {mmss(REC_TOPE_MS / 1000)}</span>
            {camaras > 1 && <span className="text-[11.5px] text-white/75 tabular-nums">· {camaras} cámaras</span>}
            {!graba && <span className="text-[11.5px] text-[color-mix(in_oklab,var(--aviso)_70%,#fff)]">· este canal no graba</span>}
            <Square size={13} fill="currentColor" className="ml-1" />
        </button>
    );
}

export function FichaCanal({ lista = null, alAlertaLista, tecladoAjeno = false, alGrabado, c, h265, hls = false, alerta, lecturas, alCerrar, alMover, alVentana, grabacionInicial = null, canales = [], seguimiento = {}, puedeEditar = false, alertaDe, alSeguir, origen, alVolverOrigen, alSoltarOrigen, alVision, pasoVision = null, alCerrarPaso, alGuardarSeguimiento, alBuscar, alSeguirChapa }: {
    /** «Seguirlo»: abrir el seguimiento de la matrícula de un vehículo tocado (dónde está, cuándo llegó, por dónde pasó). */
    alSeguirChapa?: (plate: string) => void;
    /**
     * «Grabar»: lo grabado (un tramo por cámara) se le entrega a quien arma los clips —la bandeja de
     * la pared— y la ficha se desentiende. Devuelve null si quedó en la cola, o por qué no. Sin
     * esto no hay botón de grabar.
     */
    alGrabado?: (tramos: { deviceId: string | null; nvrId: string | null; ch: number | null; desde: number; hasta: number; nombre: string }[], rotulo: string) => Promise<string | null>;
    /** La alerta de lista negra de ESTE canal, si hay una (la misma que resalta su cuadro en la pared). */
    lista?: AlertaLista | null;
    /**
     * Decidir sobre la alerta desde el vehículo tocado: aceptarla, desactivarla o retirar la chapa
     * de la lista negra. Lo hace la pared (es la misma acción que en el menú del cuadro, con la
     * misma auditoría); devuelve null si salió bien o qué pasó, para decirlo acá.
     */
    alAlertaLista?: (accion: AccionAlertaLista, plate: string) => Promise<string | null>;
    /**
     * Hay algo abierto ENCIMA de la ficha que es dueño del teclado (la confirmación de retirar de
     * la lista negra). Sin esto, el Esc que cerraba la confirmación cerraba también el canal: los
     * dos escuchan la tecla (visto al probarlo).
     */
    tecladoAjeno?: boolean;
    c: Canal | null; h265: boolean; hls?: boolean; alerta: Alerta | null; lecturas: Lectura[];
    /** Todas las cámaras de la pared y los enlaces del seguimiento visual (por idCanal). */
    canales?: Canal[]; seguimiento?: Record<string, TrackLink[]>; puedeEditar?: boolean;
    /** Se guardaron enlaces desde la ficha: la pared los muestra sin esperar la próxima recarga. */
    alGuardarSeguimiento?: (idCanal: string, links: TrackLink[]) => void;
    alertaDe?: (c: Canal) => Alerta | null;
    /** Pasar a la cámara vecina por un enlace del seguimiento; `origen` es de dónde se vino. */
    alSeguir?: (destino: Canal) => void; origen?: Canal | null; alVolverOrigen?: () => void; alSoltarOrigen?: () => void;
    /** Mandar esta cámara a OmniVision o retirarla (sólo con permiso de Ajustes). */
    alVision?: () => void;
    /** Entrando o saliendo de OmniVision: se cuenta sobre el cuadro (ver PasoVision). */
    pasoVision?: PasoVision | null; alCerrarPaso?: () => void;
    /** Abrir directo en la grabación, desde este instante (el control de la baldosa). null = en vivo. */
    grabacionInicial?: number | null;
    alCerrar: () => void;
    /** Al canal anterior o siguiente de la pared (null si no hay). */
    alMover?: ((paso: 1 | -1) => void) | null;
    /** Abrir este canal solo en otra ventana (para otro monitor). */
    alVentana?: () => void;
    /**
     * «Buscar parecidos» desde este canal: congela su cuadro y busca (openspec pared-vms). Desde el
     * menú de un objeto tocado llega con qué es y dónde está: la búsqueda no pregunta la clase y
     * arranca con ESE objeto elegido.
     */
    alBuscar?: (de?: { clase: ClaseBusqueda; caja: number[] }) => void;
}) {
    // La grabación se ve en el mismo cuadro (Grabacion): `desde` es dónde arranca; null = en vivo.
    const [grabacion, setGrabacionDesde] = useState<number | null>(null);
    const { pantalla } = useMarco();
    /*
     * El menú del objeto tocado (13/11, Nico: «ver cuándo llegó, buscar parecidos, etiquetar como
     * sospechoso (alerta amarilla)»). La ficha sabe qué se puede hacer en ESTE canal; la capa lo dibuja.
     *  · Ver cuándo llegó: la grabación de este mismo cuadro, desde un poco antes de que llegara.
     *    Cuándo fue se le pregunta al servidor (lib/vision-llegada): la hora del reloj no siempre
     *    es la de llegada. Si la pregunta falla, se usa la del reloj.
     *  · Buscar parecidos: la búsqueda de la pared, con este objeto ya elegido.
     *  · Sospechoso: el cajón de la Lista Amarilla con la matrícula y un motivo propuestos. La
     *    lista es por matrícula, así que es sólo para vehículos; no se guarda nada sin que el
     *    operador lo confirme ahí (marcar a alguien avisa a la guardia cada vez que pasa).
     */
    const amarillaOn = useFuncion("LPR_BUSQUEDA") === true;
    const ministerioOn = useFuncion("LPR_MIN_INTERIOR") === true;
    /** La matrícula que se está consultando en el Ministerio desde el menú de un vehículo. */
    const [consulta, setConsulta] = useState<string | null>(null);
    const [sospechoso, setSospechoso] = useState<{ chapa: string; motivo: string } | null>(null);
    const sospechosoRef = useRef(false); sospechosoRef.current = !!sospechoso;
    useEffect(() => { setSospechoso(null); setConsulta(null); }, [c?.clave]);
    const hayGrabacion = !!c?.nvrId && c?.ch != null;
    const nombreCanal = c?.nombre || "";
    const [buscandoLlegada, setBuscandoLlegada] = useState(false);
    /** Lo que hay que decir de la llegada al abrir su grabación (p. ej. «se lo ve ahí desde las 10:47…»). */
    const [notaLlegada, setNotaLlegada] = useState<string | null>(null);
    const streamCanal = c?.stream || null;
    const verLlegada = useCallback(async (o: ObjetoAnalizado) => {
        if (!o.quietoDesde) return;
        let abrir = o.quietoDesde - ANTES_DE.reloj, aviso: string | null = null;
        setBuscandoLlegada(true);
        try {
            if (streamCanal) {
                const r = await fetch(`/api/monitor/camaras/llegada?stream=${encodeURIComponent(streamCanal)}&caja=${o.caja.map((v) => v.toFixed(4)).join(",")}&reloj=${Math.round(o.quietoDesde)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
                const j = await r.json().catch(() => null);
                if (r.ok && j && Number.isFinite(j.abrir)) {
                    abrir = j.abrir;
                    aviso = avisoDeLlegada(j as Llegada, (ms) => new Date(ms).toLocaleString("es-UY", { timeZone: "America/Montevideo", ...(Date.now() - ms > 20 * 3600_000 ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", hour12: false }));
                }
            }
        } catch { /* sin respuesta: queda la hora del reloj */ }
        setBuscandoLlegada(false);
        // La nota va sobre la grabación, en el centro (Grabacion → RotuloVisor), no en un cartel aparte.
        setNotaLlegada(aviso);
        setGrabacionDesde(abrir);
    }, [streamCanal]);
    const [avisoLista, setAvisoLista] = useState<string | null>(null);
    useEffect(() => { if (!avisoLista) return; const t = setTimeout(() => setAvisoLista(null), 9000); return () => clearTimeout(t); }, [avisoLista]);
    const opcionesDeObjeto = useCallback((o: ObjetoAnalizado): OpcionObjeto[] => {
        /*
         * Un vehículo en alerta (lista negra): decidir ahí mismo (13/11, Nico: «el menú contextual
         * del vehículo, pudiendo desactivar esa alerta y retirarla de la lista negra»). Hasta el
         * 14/11 esto estaba sólo en el menú del cuadro de la pared: con el canal abierto había que
         * salir para hacerlo. Va primero: es lo que se vino a hacer. Sólo con sesión de operador.
         */
        const deLista: OpcionObjeto[] = [];
        if (o.alerta && alAlertaLista && !pantalla) {
            const chapa = o.chapa?.plate || lista?.plate || "";
            const hacer = (accion: AccionAlertaLista) => () => { void alAlertaLista(accion, chapa).then((m) => { if (m) setAvisoLista(m); }); };
            if (lista && !lista.real) deLista.push({ clave: "lista-aceptar", rotulo: "Aceptar la alerta: es real", Icono: CircleCheck, alElegir: hacer("aceptar") });
            if (lista) deLista.push({ clave: "lista-desactivar", rotulo: "Desactivar la alerta", Icono: BellOff, alElegir: hacer("desactivar") });
            deLista.push({ clave: "lista-retirar", rotulo: "Retirar de la lista negra", Icono: Ban, motivo: !chapa ? "Todavía no se le leyó la matrícula" : undefined, alElegir: hacer("retirar") });
        }
        const ops: OpcionObjeto[] = [...deLista, {
            clave: "llegada", rotulo: "Ver cuándo llegó", Icono: History,
            motivo: !hayGrabacion ? "Este canal no tiene grabación" : !o.quietoDesde ? "Todavía no se sabe desde cuándo está" : undefined,
            alElegir: () => { void verLlegada(o); },
        }];
        if (alBuscar) ops.push({ clave: "parecidos", rotulo: "Buscar parecidos", Icono: ScanSearch, alElegir: () => alBuscar({ clase: claseDeBusqueda(o.grupo), caja: o.caja }) });
        // En una pantalla de pared (sin sesión de operador) no se escribe la lista.
        if (amarillaOn && !pantalla) ops.push({
            clave: "sospechoso", rotulo: "Etiquetar como sospechoso", Icono: TriangleAlert, tono: "aviso",
            motivo: o.grupo !== "vehiculo" ? "La Lista Amarilla es por matrícula: sólo vehículos" : undefined,
            alElegir: () => setSospechoso({ chapa: o.chapa?.plate || "", motivo: motivoDesdeVivo(nombreCanal, o.quietoDesde) }),
        });
        if (alSeguirChapa && o.grupo === "vehiculo") ops.push({
            clave: "seguir", rotulo: "Seguir este vehículo", Icono: Route,
            motivo: !o.chapa?.plate ? "Todavía no se le leyó la matrícula" : undefined,
            alElegir: () => { if (o.chapa?.plate) alSeguirChapa(o.chapa.plate); },
        });
        // La consulta asistida al Ministerio, con la chapa de ESTE vehículo (13/11, Nico). Sólo con
        // sesión de operador: el código de verificación lo escribe una persona.
        if (ministerioOn && !pantalla && o.grupo === "vehiculo") ops.push({
            clave: "ministerio", rotulo: "Consultar al Ministerio", Icono: IconoPolicia as unknown as OpcionObjeto["Icono"],
            motivo: !o.chapa?.plate ? "Todavía no se le leyó la matrícula" : undefined,
            alElegir: () => setConsulta(o.chapa?.plate || null),
        });
        return ops;
    }, [hayGrabacion, alBuscar, alSeguirChapa, amarillaOn, ministerioOn, pantalla, nombreCanal, verLlegada, lista, alAlertaLista]);
    const [fallo, setFallo] = useState(false);
    const [hd, setHd] = useState(true);
    // Cuál de los dos vivos ya tiene imagen: el subflujo arranca siempre y la alta calidad lo tapa
    // recién cuando llegó (ver más abajo). `hdListoRef` es para el tamaño: manda el del que se ve.
    const [sdListo, setSdListo] = useState(false);
    const [hdListo, setHdListo] = useState(false);
    const hdListoRef = useRef(false); hdListoRef.current = hdListo;
    // Qué capas se dibujan sobre el video (el menú de capas): vale para el vivo y la grabación, y se recuerda.
    const [vis, setVisCrudo] = useState<CapasVisibles>(CAPAS_DEFECTO);
    useEffect(() => { try { setVisCrudo(leerCapas(localStorage.getItem(CLAVE_CAPAS))); } catch { /* sin almacenamiento: de fábrica */ } }, []);
    const setVis = useCallback((v: CapasVisibles) => { setVisCrudo(v); try { localStorage.setItem(CLAVE_CAPAS, JSON.stringify(v)); } catch { /* no se recuerda, nada más */ } }, []);
    const verGeom = vis.camara, verSiluetas = pideAnalisis(vis);
    // Siluetas de OmniVision sobre el vivo (pedido 15/10: «pretendo que sea la silueta»). Prendidas
    // al abrir; sólo mientras se mira el vivo de ESTE canal (la GPU no trabaja para nadie más).
    /**
     * El tamaño del video que se ve. Las siluetas salen del subflujo y vienen en 0–1 de su cuadro;
     * se dibujan con el tamaño del video EN PANTALLA, porque el HD puede tener otra proporción que
     * el subflujo (medido el 15/10: el subflujo de LPR Entrada es 704×576, 4:3, y su HD es 16:9).
     * Los dos ven lo mismo; cambia cómo está estirado.
     */
    const [tamVideo, setTamVideo] = useState<{ w: number; h: number } | null>(null);
    // Dónde cae el cuadro del video en la pantalla («contain»): ahí se ubican los enlaces.
    const [pantallaTam, setPantallaTam] = useState(() => (typeof window === "undefined" ? { w: 1920, h: 1080 } : { w: window.innerWidth, h: window.innerHeight }));
    useEffect(() => { const r = () => setPantallaTam({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
    const cuadro = useMemo(() => {
        if (!tamVideo) return null;
        const k = Math.min(pantallaTam.w / tamVideo.w, pantallaTam.h / tamVideo.h);
        const width = tamVideo.w * k, height = tamVideo.h * k;
        return { left: (pantallaTam.w - width) / 2, top: (pantallaTam.h - height) / 2, width, height };
    }, [tamVideo, pantallaTam]);
    const [editandoSeguimiento, setEditandoSeguimiento] = useState(false);
    useEffect(() => { setEditandoSeguimiento(false); }, [c?.clave]);
    // PTZ: se le pregunta al equipo si la cámara se mueve (el servidor lo recuerda media hora); el
    // ícono del joystick aparece sólo si es así.
    const [ptz, setPtz] = useState(false);
    const [verPtz, setVerPtz] = useState(false);
    const idPtz = c ? idCanal(c) : null;
    // Lo que las analíticas de este canal tienen dibujado (reglas, entrenables, lectura de matrículas).
    const capas = useCapasDelCanal(idPtz);
    // Las zonas de las analíticas arrancan apagadas (15/11, Nico, al verlas sobre el vivo: «las reglas
    // de analíticas dibujan un recuadro que no debe estar»): se prenden desde el menú de capas.
    const verCapas = vis.zonas;
    // Las capas que este canal tiene para ofrecer: las zonas sólo si alguna analítica dibujó una, la línea sólo si la cámara tiene.
    const filasDeCapas = useMemo<ClaveCapa[]>(() => ["persona", "vehiculo", "animal", "propio", "chapas", ...(capas ? ["zonas" as const] : []), ...(c?.geom ? ["camara" as const] : [])], [capas, c?.geom]);
    /*
     * «Grabar» (13/11, Nico: «un botón Grabar: comenzar un fragmento de video de lo que está viendo…
     * poder descargarlo o enviarlo por Telegram o WhatsApp como el resto de clips»). El botón marca
     * el inicio y el fin; el clip se corta de la GRABACIÓN del grabador (api/clip/grabar), no del
     * video que llega al navegador: es la imagen original y sale con el nombre, la calidad y la
     * marca de los demás clips. Por eso hace falta que el canal grabe, y por eso al detener hay que
     * esperar: el grabador entrega a tiempo real.
     */
    /** Desde cuándo corre el tramo de ESTE canal (null = no se está grabando). */
    const [rec, setRec] = useState<number | null>(null);
    const [errorClip, setErrorClip] = useState<string | null>(null);
    const puedeGrabar = !pantalla && hayGrabacion && !!alGrabado;
    // Mientras se graba, la ficha no se cierra sola.
    const ocupadaRef = useRef(false); ocupadaRef.current = rec != null;
    const alGrabadoRef = useRef(alGrabado); alGrabadoRef.current = alGrabado;
    /*
     * La grabación SIGUE al cambiar de cámara (13/11, Nico: «debe continuar grabando mientras
     * cambiamos de cámara vía el ícono de visual track»): es lo que hace falta para seguir a
     * alguien de una cámara a la otra. Cada cámara es un tramo; al cambiar se cierra el de la que
     * se deja y arranca el de la que llega, y al detener el clip los une en orden. Un canal que no
     * graba no aporta tramo (y se dice mientras se está en él).
     */
    type TramoRec = { deviceId: string | null; nvrId: string | null; ch: number | null; desde: number; hasta: number; /** El nombre de la cámara: el clip lo escribe sobre su tramo. */ nombre: string };
    const tramosRec = useRef<TramoRec[]>([]);
    const canalAhora = { deviceId: c?.equipoId || null, nvrId: c?.nvrId || null, ch: c?.ch ?? null, graba: hayGrabacion, nombre: c?.nombre || "" };
    /** El canal del tramo que está corriendo: al cambiar de cámara todavía es el anterior. */
    const canalDeTramo = useRef(canalAhora);
    const recRef = useRef<number | null>(null); recRef.current = rec;
    const cerrarTramo = (hasta: number) => {
        const k = canalDeTramo.current, desde = recRef.current;
        if (desde != null && k.graba && hasta - desde >= 1000) tramosRec.current.push({ deviceId: k.deviceId, nvrId: k.nvrId, ch: k.ch, desde, hasta, nombre: nombreCamara(k.nombre) || k.nombre });
    };
    const yaGrabado = () => tramosRec.current.reduce((x, t) => x + (t.hasta - t.desde), 0);
    const empezar = () => { tramosRec.current = []; canalDeTramo.current = canalAhora; setErrorClip(null); setRec(Date.now()); };
    const detener = useCallback(async () => {
        const hasta = Date.now();
        cerrarTramo(hasta);
        const tramos = tramosRec.current; tramosRec.current = [];
        const rotulo = canalDeTramo.current.nombre;
        setRec(null);
        const total = tramos.reduce((x, t) => x + (t.hasta - t.desde), 0);
        if (total < REC_MINIMO_MS) { setErrorClip(tramos.length ? "Muy corto: mantené la grabación al menos un par de segundos." : "No quedó nada grabado: los canales por los que pasaste no graban."); return; }
        // El clip lo arma el servidor (lib/clips-grabados) y aparece en la bandeja: acá no se espera nada.
        setErrorClip(null);
        const m = alGrabadoRef.current ? await alGrabadoRef.current(tramos, rotulo) : "no hay quién arme el clip.";
        if (m) setErrorClip(`No se pudo pedir el clip: ${m}`);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Otro canal. Grabando: se cierra el tramo del que se deja y arranca el del que llega. Si la
    // ficha se cerró (sin canal), se da por terminada y el clip se pide igual: hasta el 14/11 se
    // descartaba, porque el clip vivía en la ficha; ahora queda en la bandeja.
    const claveRec = useRef<string | null>(c?.clave ?? null);
    useEffect(() => {
        if (claveRec.current === (c?.clave ?? null)) return;
        claveRec.current = c?.clave ?? null;
        if (recRef.current != null && c) { const ahora = Date.now(); cerrarTramo(ahora); canalDeTramo.current = canalAhora; setRec(ahora); return; }
        if (recRef.current != null) { void detener(); return; }
        tramosRec.current = []; setRec(null); setErrorClip(null);
    }, [c?.clave]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!errorClip) return; const t = setTimeout(() => setErrorClip(null), 9000); return () => clearTimeout(t); }, [errorClip]);
    useEffect(() => {
        setPtz(false); setVerPtz(false);
        if (!idPtz || pantalla) return;
        let vivo = true;
        fetch(`/api/devices/ptz?deviceId=${encodeURIComponent(idPtz)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo) setPtz(!!j?.ptz); }).catch(() => { });
        return () => { vivo = false; };
    }, [idPtz, pantalla]);
    const [visibles, setVisibles] = useState(true);
    /** El puntero, aparte de los controles: en el vivo se mueve el mouse para tocar una silueta sin que aparezca nada más. */
    const [conPuntero, setConPuntero] = useState(true);
    const [lleno, setLleno] = useState(false);
    const entreYo = useRef(false);
    useEffect(() => { setGrabacionDesde(grabacionInicial); setFallo(!!c && hdCaido(c.clave)); setSdListo(false); setHdListo(false); }, [c?.clave]); // eslint-disable-line react-hooks/exhaustive-deps
    const grabacionRef = useRef(grabacion != null); grabacionRef.current = grabacion != null;
    const alCerrarRef = useRef(alCerrar); alCerrarRef.current = alCerrar;

    // Controles que se apagan solos, y la ficha que se cierra sola.
    useEffect(() => {
        if (!c) return;
        // Al abrir se muestran un momento: así se sabe que están y dónde.
        setVisibles(true); setConPuntero(true);
        const quieto = () => { setVisibles(false); setConPuntero(false); };
        let apagar = setTimeout(quieto, OCULTAR_MS);
        let cerrar = setTimeout(() => { if (!grabacionRef.current && !ocupadaRef.current) alCerrarRef.current(); }, CIERRA_SOLA_MS);
        /** Hubo actividad: se posterga el apagado y el cierre solo. `mostrar`: además trae los controles. */
        const actividad = (mostrar: boolean) => {
            if (mostrar) setVisibles(true);
            setConPuntero(true); clearTimeout(apagar); clearTimeout(cerrar);
            apagar = setTimeout(quieto, OCULTAR_MS);
            cerrar = setTimeout(() => { if (!grabacionRef.current && !ocupadaRef.current) alCerrarRef.current(); }, CIERRA_SOLA_MS);
        };
        // Mover el mouse trae los controles sólo en la grabación; en el vivo, el clic o una tecla.
        const mover = () => actividad(grabacionRef.current);
        // Tocar una silueta (o una opción de su menú) tampoco los trae: ese toque ya tiene a quién va.
        const tocar = (e: Event) => actividad(!(e.target instanceof Element && e.target.closest("[data-capa-tocable]")));
        window.addEventListener("pointermove", mover); window.addEventListener("pointerdown", tocar); window.addEventListener("keydown", tocar);
        return () => { clearTimeout(apagar); clearTimeout(cerrar); window.removeEventListener("pointermove", mover); window.removeEventListener("pointerdown", tocar); window.removeEventListener("keydown", tocar); };
    }, [c?.clave]); // eslint-disable-line react-hooks/exhaustive-deps
    // (por clave y no por objeto: la lista se vuelve a pedir cada 30 s y el cierre solo se reiniciaba)

    // Pantalla completa al abrir (viene de un toque, así que el navegador la permite) y se
    // devuelve al cerrar sólo si la pidió esta ficha: si la pared ya estaba en completa, queda.
    useEffect(() => {
        if (!c) return;
        const cambio = () => setLleno(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", cambio); cambio();
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => { entreYo.current = true; }).catch(() => { });
        return () => {
            document.removeEventListener("fullscreenchange", cambio);
            if (entreYo.current && document.fullscreenElement) document.exitFullscreen().catch(() => { });
            entreYo.current = false;
        };
    }, [!!c]); // eslint-disable-line react-hooks/exhaustive-deps

    // El Esc que cierra lo de encima llega acá en el MISMO evento, y para entonces lo de encima ya
    // se cerró y React ya volvió a dibujar (entre un oyente y el siguiente): mirar sólo «¿hay algo
    // encima ahora?» daba que no. Por eso también vale «se acaba de cerrar».
    const tecladoAjenoRef = useRef(tecladoAjeno), ajenoHasta = useRef(0);
    if (tecladoAjenoRef.current && !tecladoAjeno) ajenoHasta.current = performance.now() + 250;
    tecladoAjenoRef.current = tecladoAjeno;
    const teclas = useCallback((e: KeyboardEvent) => {
        // Con el cajón de la Lista Amarilla abierto, las teclas son suyas (Esc lo cierra a él, no a la ficha).
        if (sospechosoRef.current || tecladoAjenoRef.current || performance.now() < ajenoHasta.current) return;
        // En la grabación, Esc vuelve al vivo; las flechas son de la regla (Grabacion).
        if (grabacionRef.current) { if (e.key === "Escape") { e.preventDefault(); setGrabacionDesde(null); } return; }
        if (e.key === "Escape") { e.preventDefault(); alCerrar(); }
        else if (e.key === "ArrowRight" && alMover) alMover(1);
        else if (e.key === "ArrowLeft" && alMover) alMover(-1);
    }, [alCerrar, alMover]);
    useEffect(() => { if (!c) return; window.addEventListener("keydown", teclas); return () => window.removeEventListener("keydown", teclas); }, [!!c, teclas]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cuánto atrasa el video que se ve (la alta calidad cuando ya tapó al subflujo): las siluetas se
    // muestran a la hora de ESE video, no apenas llegan (lib/siluetas-sincronia). Cada Vivo da su medida.
    const atrasoSd = useRef<(() => number | null) | null>(null), atrasoHd = useRef<(() => number | null) | null>(null);
    const atrasoDelVideo = useCallback((): number | null => {
        const medir = (hdListoRef.current && atrasoHd.current) || atrasoSd.current;
        // Todavía sin video (se ve la foto del canal): no hay con qué sincronizar.
        return medir ? medir() : null;
    }, []);
    // El análisis en vivo se dibuja en SiluetasDelVivo; acá sólo llega su estado (cambia casi nunca).
    const [estadoSil, setEstadoSil] = useState<EstadoSiluetas>("apagado");
    const msSil = useRef<number | null>(null);
    // HD convertido es varias veces más caro que el subflujo: sin H.265 se ve el subflujo convertido.
    const enHd = h265 && hd && !fallo;
    const m = alerta ? metaDe(alerta.tipo) : null;
    const ult = c?.ultima ? metaDe(c.ultima.tipo) : null;
    const foto = c ? fotoDe(c, 1280) : null;
    const calidad = c?.online === false ? "sin señal en el NVR" : enHd ? (hdListo ? "alta calidad, directo" : "subflujo · abriendo la alta calidad…")
        : h265 ? (fallo && hd ? "subflujo, directo (la alta calidad no abrió)" : "subflujo, directo") : "subflujo convertido (este equipo no reproduce H.265 en alta)";
    const alternarLleno = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else document.documentElement.requestFullscreen?.().then(() => { entreYo.current = true; }).catch(() => { }); };

    return (
        <AnimatePresence>
            {c && (
                <motion.div key="ficha" role="dialog" aria-label={c.nombre} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                    className={cn("fixed inset-0 z-[2900] bg-black", !conPuntero && "cursor-none")}>
                    {grabacion != null ? (
                        <Grabacion c={c} h265={h265} hls={hls} desdeMs={grabacion} visibles={visibles} alVivo={() => { setNotaLlegada(null); setGrabacionDesde(null); }}
                            nota={notaLlegada} vis={vis} alVis={setVis}
                            deviceIdEnvio={!pantalla && c.equipoId ? c.equipoId : undefined} />
                    ) : c.online === false ? (
                        <>
                            {foto && <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-contain opacity-60" />}
                            <span className="absolute inset-0 grid place-items-center text-white/60"><span className="flex flex-col items-center gap-2"><VideoOff size={40} /><span className="text-[18px] font-semibold">El NVR no ve este canal</span></span></span>
                        </>
                    ) : (
                        <>
                            {/* Nunca en negro (12/11, Nico: «queda un rato largo en negro»). Antes se
                                pedía sólo la alta calidad y, si no abría, se esperaban 12 s mirando
                                nada antes de caer al subflujo. Ahora: la foto del canal al instante,
                                el subflujo siempre (un par de segundos), y la alta calidad se abre
                                por detrás y lo tapa cuando ya tiene imagen. Si no llega, se sigue
                                viendo el subflujo, sin corte. */}
                            {!sdListo && !hdListo && foto && <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-contain" />}
                            {!(enHd && hdListo) && (
                                <Vivo key={`${c.clave}-sd`} src={vivoDe(c.stream, !h265, hls)}
                                    alResultado={(ok) => { if (ok) setSdListo(true); }} alMedir={(w, h) => { if (!hdListoRef.current) setTamVideo({ w, h }); }}
                                    alAtraso={(m) => { atrasoSd.current = m; }}
                                    className={cn("absolute inset-0 w-full h-full object-contain", !sdListo && "opacity-0")} />
                            )}
                            {enHd && (
                                <Vivo key={`${c.clave}-hd`} src={vivoDe(`${c.stream}_hd`, false, hls)}
                                    alResultado={(ok) => { if (ok) setHdListo(true); else { HD_CAIDOS.set(c.clave, Date.now()); setFallo(true); } }}
                                    alMedir={(w, h) => setTamVideo({ w, h })} alAtraso={(m) => { atrasoHd.current = m; }}
                                    className={cn("absolute inset-0 w-full h-full object-contain", !hdListo && "opacity-0")} />
                            )}
                        </>
                    )}
                    {/* Debajo de las siluetas, que son las que reciben el toque. Sólo en el vivo: el estado de una entrenable es el de AHORA. */}
                    {capas && verCapas && grabacion == null && <CapasDeAnaliticas capas={capas} tam={tamVideo} />}
                    {/* Con `key`: al cambiar de canal la capa nace de nuevo, sin identidades ni rótulos del anterior. */}
                    <SiluetasDelVivo key={c.clave} stream={c.online !== false ? c.stream : null} activo={verSiluetas && grabacion == null} atraso={atrasoDelVideo} tam={tamVideo}
                        geom={c.geom} hayAlerta={!!alerta} verGeom={verGeom} vis={vis} opciones={opcionesDeObjeto} alEstado={setEstadoSil} msRef={msSil} />

                    {grabacion == null && <PasoVisionCanal paso={pasoVision} nombre={c.nombre} foto={foto} grande alCerrar={alCerrarPaso} capa="z-0" />}

                    {/* Arriba a la izquierda: qué se mira. Texto sobre la imagen, sin caja. */}
                    <div className={cn("absolute top-0 inset-x-0 p-3 sm:p-5 md:px-7 flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300", !visibles && "opacity-0 pointer-events-none")}>
                        <div className="min-w-0 visor-sombra-texto">
                            <h1 className="text-[18px] sm:text-[24px] font-bold tracking-[-0.015em] text-white leading-tight truncate max-w-[80vw] lg:max-w-[calc(50vw-330px)]">{c.nombre}</h1>
                            <p className="flex items-center gap-2 mt-1 text-[14px] text-white/75 tabular-nums">
                                {grabacion != null ? <History size={14} className="text-[var(--accion-en-oscuro)] shrink-0" /> : <Radio size={14} className="text-[var(--mal)] animate-pulse shrink-0" />}
                                <span className="font-semibold text-white/90">{ubicacion(c)}</span>
                                <span className="text-white/30">·</span><span>{grabacion != null ? "grabación" : calidad}</span>
                                {grabacion == null && verSiluetas && estadoSil !== "apagado" && (<>
                                    <span className="text-white/30">·</span>
                                    <span className={cn(estadoSil === "ocupado" || estadoSil === "error" ? "text-[var(--aviso-texto)]" : "")}>
                                        {estadoSil === "vivo" ? "siluetas en vivo" : estadoSil === "conectando" ? "buscando siluetas…" : estadoSil === "ocupado" ? "siluetas ocupadas (2 canales a la vez)" : "siluetas sin respuesta"}
                                    </span>
                                </>)}
                            </p>
                            {alerta && m && (
                                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-bold pleno-mal"><m.Icon size={15} /> {m.label} · {horaCorta(alerta.ts)} · {hace(alerta.ts)}</span>
                            )}
                            {!alerta && c.ultima && ult && (
                                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold visor-panel text-white/85"><ult.Icon size={14} /> Última: {ult.label} · {hace(c.ultima.ts)}</span>
                            )}
                        </div>
                    </div>

                    {/*
                     * Las acciones, en íconos, arriba al centro (16/10, Nico). Arriba a la derecha
                     * competían con la hora que sobreimprime la cámara; abajo chocaban con la regla de
                     * la grabación y las últimas lecturas. En pantallas angostas van debajo del nombre.
                     */}
                    <div className={cn("absolute inset-x-0 z-10 flex justify-center px-3 pointer-events-none transition-opacity duration-300 top-[84px] sm:top-[92px] lg:top-5",
                        !visibles && "opacity-0 [&_*]:pointer-events-none")}>
                        <div className="flex items-center gap-2 max-w-full overflow-x-auto pointer-events-auto">
                            {alMover && (
                                <span className="visor-panel rounded-full p-1 flex items-center gap-0.5">
                                    <Icono onClick={() => alMover(-1)} titulo="Canal anterior  ( ← )"><ChevronLeft size={20} /></Icono>
                                    <Icono onClick={() => alMover(1)} titulo="Canal siguiente  ( → )"><ChevronRight size={20} /></Icono>
                                </span>
                            )}
                            <span className="visor-panel rounded-full p-1 flex items-center gap-0.5">
                                {h265 && c.online !== false && grabacion == null && (
                                    <Icono onClick={() => { HD_CAIDOS.delete(c.clave); if (hdListoRef.current) setSdListo(false); setHd((x) => !x); setFallo(false); setHdListo(false); }} activo={enHd} titulo={enHd ? "Alta calidad · cambiar al subflujo, más liviano" : "Subflujo · cambiar a alta calidad"}>
                                        <span className="text-[11px] font-bold tracking-wide">{enHd ? "HD" : "SD"}</span>
                                    </Icono>
                                )}
                                {grabacion == null && c.online !== false && (
                                    <MenuDeCapas valor={vis} alCambiar={setVis} filas={filasDeCapas} abre="abajo"
                                        estado={!verSiluetas ? "OmniVision no está mirando este canal: no hay ninguna de sus capas prendida" : estadoSil === "vivo" ? `Siluetas en vivo${msSil.current != null ? ` · ${msSil.current} ms por cuadro` : ""}` : estadoSil === "ocupado" ? "Ocupado: ya hay dos canales con siluetas abiertos" : estadoSil === "conectando" ? "Conectando con OmniVision…" : estadoSil === "error" ? "OmniVision no contesta" : null}
                                        claseBoton={(activo) => cn("w-11 h-11 rounded-full grid place-items-center transition-colors", activo ? "bg-white text-black" : "text-white/85 hover:text-white hover:bg-white/15")} />
                                )}
                                {alBuscar && grabacion == null && c.online !== false && (
                                    <Icono onClick={() => alBuscar()} titulo="Buscar parecidos: congelar este cuadro y buscar a esa persona, vehículo u objeto en lo que registraron las cámaras"><ScanSearch size={18} /></Icono>
                                )}
                                {alVision && (
                                    <Icono onClick={alVision} activo={!!c.vision?.analiza}
                                        titulo={c.vision?.analiza ? `OmniVision analiza esta cámara${c.vision.porSeg != null ? ` (${c.vision.porSeg.toLocaleString("es-UY", { maximumFractionDigits: 2 })} análisis/s)` : ""} · tocar para retirarla` : "Analizar con OmniVision: siluetas, búsqueda, reglas y verificación"}><ScanEye size={18} /></Icono>
                                )}
                                {grabacion == null && puedeEditar && (
                                    <Icono onClick={() => setEditandoSeguimiento((x) => !x)} activo={editandoSeguimiento}
                                        titulo={editandoSeguimiento ? "Terminar de editar el seguimiento visual" : "Editar el seguimiento visual (a qué cámaras se pasa desde esta)"}><Crosshair size={18} /></Icono>
                                )}
                                {ptz && grabacion == null && c.online !== false && (
                                    <Icono onClick={() => setVerPtz((x) => !x)} activo={verPtz} titulo={verPtz ? "Ocultar el joystick" : "Mover la cámara (PTZ)"}><Joystick size={18} /></Icono>
                                )}
                                {(puedeGrabar || rec != null) && grabacion == null && (
                                    <Icono onClick={() => (rec != null ? void detener() : empezar())} activo={rec != null}
                                        titulo={rec != null ? "Detener: el clip se arma en el servidor y queda en la bandeja" : `Grabar un clip de lo que se ve (hasta ${REC_TOPE_MS / 1000} s; sigue grabando si cambiás de cámara)`}>
                                        {rec != null ? <Square size={15} fill="currentColor" /> : <Circle size={17} className="text-[var(--mal)]" fill="currentColor" />}
                                    </Icono>
                                )}
                                {c.nvrId && c.ch != null && (
                                    <Icono onClick={() => setGrabacionDesde((g) => (g != null ? null : alerta ? +new Date(alerta.ts) - GRABACION_ANTES_ALERTA_MS : Date.now() - GRABACION_ANTES_MS))}
                                        activo={grabacion != null} titulo={grabacion != null ? "Volver al vivo  ( Esc )" : "Ver la grabación sobre este mismo cuadro"}><History size={18} /></Icono>
                                )}
                                {foto && <span className="hidden sm:contents"><Icono href={foto.replace(/[?&]w=\d+/, "")} titulo="Abrir la foto de ahora en una pestaña"><Camera size={18} /></Icono></span>}
                                {alVentana && <span className="hidden md:contents"><Icono onClick={alVentana} titulo="Abrir este canal solo en otra ventana (para otro monitor)"><AppWindow size={18} /></Icono></span>}
                                <Icono onClick={alternarLleno} titulo={lleno ? "Salir de pantalla completa" : "Pantalla completa"}>{lleno ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</Icono>
                                <span className="w-px h-5 bg-white/15 mx-0.5" />
                                <Icono onClick={alCerrar} titulo="Volver a la pared  ( Esc )"><X size={20} /></Icono>
                            </span>
                        </div>
                    </div>

                    {/* Seguimiento visual: los enlaces a las cámaras vecinas, sobre el vivo. */}
                    {grabacion == null && c.online !== false && (
                        <SeguimientoVisual key={c.clave} c={c} canales={canales} links={seguimiento[idCanal(c)] || []} editando={editandoSeguimiento}
                            cuadro={cuadro} h265={h265} hls={hls} alertaDe={alertaDe || (() => null)} alSeguir={(d) => alSeguir?.(d)}
                            alGuardado={(n) => alGuardarSeguimiento?.(idCanal(c), n)} />
                    )}
                    {/* La cámara de la que se vino por el seguimiento: chica, abajo a la izquierda, para volver. */}
                    {origen && grabacion == null && (
                        <div className={cn("absolute left-4 bottom-24 w-[240px] aspect-video rounded-[10px] overflow-hidden ring-1 ring-white/25 bg-black transition-opacity", !visibles && "opacity-60")}>
                            <Vivo src={vivoDe(origen.stream, !h265, hls)} className="absolute inset-0 w-full h-full object-cover" />
                            <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white"><Crosshair size={11} /> Origen · {origen.nombre}</span>
                            <button type="button" onClick={alVolverOrigen} className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[var(--accion)] text-white text-[12px] font-semibold"><ChevronLeft size={13} /> Volver</button>
                            <button type="button" onClick={alSoltarOrigen} aria-label="Cerrar el origen" className="absolute top-1.5 right-1.5 w-7 h-7 grid place-items-center rounded-full bg-black/60 text-white/85"><X size={14} /></button>
                        </div>
                    )}


                    {/* El joystick PTZ: abajo a la derecha, donde llega la mano. */}
                    <AnimatePresence>
                        {verPtz && ptz && grabacion == null && idPtz && (
                            <div key="ptz" className="absolute right-4 sm:right-7 bottom-5 sm:bottom-7 z-10">
                                <JoystickPtz deviceId={idPtz} alCerrar={() => setVerPtz(false)} />
                            </div>
                        )}
                    </AnimatePresence>

                    {/* Las últimas lecturas con su captura: una pila a la derecha, sobre el video (ver PilaLecturas). */}
                    {lecturas.length > 0 && grabacion == null && <PilaLecturas lecturas={lecturas} />}

                    {/* Grabando: el punto rojo y el cronómetro, siempre a la vista (no se van con los controles), y detener de un toque. */}
                    {rec != null && <PildoraRec desde={rec} acumulado={yaGrabado()} graba={hayGrabacion} camaras={tramosRec.current.length + (hayGrabacion ? 1 : 0)} alDetener={detener} />}
                    {(errorClip || avisoLista) && rec == null && (
                        <div data-capa-tocable className="absolute left-4 sm:left-7 bottom-5 sm:bottom-7 z-10 max-w-[420px] rounded-[10px] visor-panel text-white px-3.5 py-2.5 text-[13px]" role="alert">{errorClip || avisoLista}</div>
                    )}
                    {/* Mientras se busca en el registro cuándo llegó (suele ser menos de un segundo). */}
                    {buscandoLlegada && (
                        <div className="absolute inset-0 z-10 grid place-items-center pointer-events-none">
                            <RotuloVisor Icono={History} texto="Buscando cuándo llegó" esperando />
                        </div>
                    )}
                    <TipVisor />
                    {/* Marcar el vehículo tocado: el mismo cajón de la Lista Amarilla del monitor LPR, con lo que ya se sabe escrito. */}
                    {sospechoso && <WatchlistDialog categoriaInicial="SEARCH" plateInicial={sospechoso.chapa} motivoInicial={sospechoso.motivo} onClose={() => setSospechoso(null)} />}
                    {consulta && <MinInteriorDialog plate={consulta} open onOpenChange={(o) => { if (!o) setConsulta(null); }} />}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
