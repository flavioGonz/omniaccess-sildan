"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderTree, Server, VideoOff, ChevronLeft, ChevronRight, ChevronDown, Cpu, Image as ImageIcon, Loader2, ShieldAlert, Car, Check, Plus, Pencil, AppWindow, Monitor, Timer, LogIn, LogOut, LayoutGrid, Rows3, Columns2, Gauge, X, Maximize2, History, Camera, ScanEye, Crosshair } from "lucide-react";
import { useMarco, BarraDelMarco } from "@/components/monitor/MarcoMonitor";
import { fondoDe, type TonoFondo } from "@/lib/monitor/fondos";
import { usarDatos, horaCorta, hace, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { metaDe } from "@/components/intrusion/comun";
import { SUAVE, tocable } from "@/components/monitor/tactil";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { geomDeIntrusion } from "@/lib/vision-capa";
import { getImagePath } from "@/lib/image-path";
import { conAncho } from "@/lib/ancho-foto";
import { DISPOSICIONES, disposicionDe, disposicionDeGrilla, DISPOSICION_POR_DEFECTO, CLAVE_CANAL, type Casilla, type VistaCamaras as VistaGuardada } from "@/lib/monitor/disposiciones";
import { Vivo, Foto, Geometria, Glifo, Flotante, estiloCasilla, fotoDe, vivoDe, ubicacion, grupoDe, idCanal, reproduceH265, usaHls, FOTO_MS, type Canal, type Alerta, type Lectura, type Modo } from "@/components/monitor/camaras/piezas";
import { Recursos } from "@/components/monitor/camaras/Recursos";
import { FichaCanal } from "@/components/monitor/camaras/Ficha";
import { PasoVisionCanal, type PasoVision } from "@/components/monitor/camaras/PasoVision";
import { EnlacesBaldosa, cuadroCover, aCuadro, type Enlace } from "@/components/monitor/camaras/EnlacesBaldosa";
import { setVisualTrackLinks, type TrackLink } from "@/app/actions/detections";
import { EditorVista } from "@/components/monitor/camaras/Editor";
import { abrirVentana, listarPantallas, hayVariasPantallasApi, clavePrefs, type Pantalla } from "@/components/monitor/camaras/ventanas";
import { cn } from "@/lib/utils";

/**
 * La pared de video: los canales de los NVR y las cámaras sueltas, como en un NVR.
 *
 * El problema de fondo (medido el 15/10 en San Nicolás): todos los subflujos son H.265 a
 * 640×360. Un navegador que no decodifica H.265 necesita que el servidor convierta cada canal
 * a H.264 con su CPU — veinte canales a la vez es dejar al servidor sin aire para la lectura de
 * matrículas. Entonces cada pantalla decide sola: si su navegador reproduce H.265 todo va
 * directo (medido ese día en la PC de Nico: 16 canales directos, CPU del servidor en 6 %); si
 * no, a lo sumo MAX_CONVERTIDOS baldosas van convertidas y el resto es foto. Cada baldosa dice
 * cuál de las tres cosas es: una foto con aire de vivo sería una pantalla que miente.
 *
 * Dos maneras de mirar:
 *  · Automática: todos los canales (o los de un NVR) en la disposición elegida, por páginas.
 *    La cámara que detecta se pone roja y pasa a la primera casilla — la grande, si hay.
 *  · Una vista diseñada (Editor): la disposición y el canal de cada casilla, fijos. Se guardan
 *    en el servidor y las ve cualquier pantalla. Diseñarlas pide sesión con el permiso Monitores.
 *
 * Cada vista se puede desacoplar en otra ventana para otro monitor (ventanas.ts); cada ventana
 * guarda sus ajustes aparte. Arriba, lo que la pared le cuesta al servidor (Recursos).
 */

/** Cada cuánto se repite la lista de canales (y las detecciones). El socket adelanta lo urgente. */
const INTERVALO_MS = 30_000;
/** Tope de baldosas convertidas por pantalla cuando el navegador no reproduce H.265. */
const MAX_CONVERTIDOS = 4;
const PAGINA_SEG = [10, 20, 40] as const;
const PREFS_BASE = "omni.pared-camaras.v2";
/** Cuánto dura el destello de una baldosa LPR cuando lee una chapa. */
const DESTELLO_MS = 4000;
/** Cuántas chapas recientes entran en una baldosa chica y en una grande. */
const CHAPAS_CHICA = 2, CHAPAS_GRANDE = 4;
const AUTO = "auto";
/**
 * Cuánto se queda en la baldosa la captura de una detección con las siluetas de OmniVision,
 * desde que llega el análisis. Después vuelve el vivo (el borde rojo sigue los 2 minutos).
 * Es lo que se puede mostrar sin costo: ese análisis ya lo hace vision-worker para verificar.
 */
const CAPTURA_EN_BALDOSA_MS = 15_000;

type Datos = {
    /** OmniVision: carga medida contra su tope, cuántas cámaras analiza, y si quien mira puede cambiarlo. */
    vision?: { total: number; tope: number; medido: boolean; cuantas: number; puedeCambiar: boolean };
    canales: Canal[]; errores: { nvr: string; error: string }[]; go2rtc: boolean;
    /** Las áreas de Dispositivos, en el orden del árbol. */
    areas?: { id: string; nombre: string; padre: string | null; color: string; nivel: number }[]; ventanaAlertaMs: number; ahora: string; vistas: VistaGuardada[]; puedeEditar: boolean;
    /** Seguimiento visual: por idCanal, los enlaces a las cámaras vecinas. */
    seguimiento?: Record<string, { to: string; x: number; y: number }[]> };
/** colMovil: en el celular la pared es una lista que se desliza, de 1 o 2 columnas. */
type Prefs = { vista: string; disposicion: string; pagSeg: number; pausa: boolean; nvr: string; area: string; colMovil: 1 | 2 };
type Celda = { casilla: Casilla; canal: Canal | null; claveFaltante?: string | null };

const PREFS_INICIALES: Prefs = { vista: AUTO, disposicion: DISPOSICION_POR_DEFECTO, pagSeg: 20, pausa: false, nvr: "todos", area: "todas", colMovil: 1 };
/** «Sin área» en el filtro de áreas. */
const SIN_AREA = "__sin_area";

/** Los ajustes de esta ventana; los parámetros de la dirección mandan sobre lo guardado. */
function leerPrefs(): { prefs: Prefs; canalSolo: string | null } {
    let p = { ...PREFS_INICIALES };
    try { p = { ...p, ...JSON.parse(localStorage.getItem(clavePrefs(PREFS_BASE)) || "{}") }; } catch { }
    let canalSolo: string | null = null;
    try {
        const q = new URLSearchParams(window.location.search);
        const g = disposicionDeGrilla(Number(q.get("grilla")));
        if (g) p.disposicion = g;
        if (q.get("disposicion") && DISPOSICIONES.some((d) => d.clave === q.get("disposicion"))) p.disposicion = q.get("disposicion")!;
        if (q.get("vista")) p.vista = q.get("vista")!;
        const c = q.get("canal"); if (c && CLAVE_CANAL.test(c)) canalSolo = c;
    } catch { }
    if (!DISPOSICIONES.some((d) => d.clave === p.disposicion)) p.disposicion = DISPOSICION_POR_DEFECTO;
    if (!PAGINA_SEG.includes(p.pagSeg as any)) p.pagSeg = PREFS_INICIALES.pagSeg;
    return { prefs: p, canalSolo };
}

/** Botón de la barra de arriba: misma altura y superficie que los medidores de recursos. */
function BotonBarra({ children, onClick, activo, titulo, className }: { children: React.ReactNode; onClick: () => void; activo?: boolean; titulo?: string; className?: string }) {
    return (
        <button type="button" onClick={onClick} title={titulo} aria-expanded={activo}
            className={cn("h-10 px-3 rounded-[10px] inline-flex items-center gap-2 text-[13px] font-semibold whitespace-nowrap transition-colors", tocable,
                activo ? "bg-muted text-foreground" : "bg-muted/60 hover:bg-muted text-foreground", className)}>
            {children}
        </button>
    );
}
function OpcionMenu({ children, onClick, elegida, className }: { children: React.ReactNode; onClick: () => void; elegida?: boolean; className?: string }) {
    return (
        <button type="button" onClick={onClick} className={cn("w-full flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] hover:bg-muted", elegida && "font-semibold", className)}>
            {children}
            {elegida && <Check size={15} className="ml-auto text-[var(--accion-en-oscuro)] shrink-0" />}
        </button>
    );
}

const MODO_ROTULO: Record<Modo, { t: string; Ic: any; titulo: string }> = {
    directo: { t: "Vivo", Ic: null, titulo: "En vivo, directo desde la cámara (H.265 en este equipo)" },
    convertido: { t: "Convertido", Ic: Cpu, titulo: "En vivo, convertido a H.264 por el servidor" },
    foto: { t: `Foto c/${FOTO_MS / 1000} s`, Ic: ImageIcon, titulo: "Foto que se renueva: este equipo no reproduce H.265 y el servidor ya convierte el máximo de canales" },
};

function ChapaMini({ l, nueva }: { l: Lectura; nueva?: boolean }) {
    const ok = l.decision === "GRANT" && !l.listaNegra;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 bg-black/65 text-white text-[12px]", nueva && (ok ? "ring-2 ring-[var(--bien)]" : "ring-2 ring-[var(--mal)]"))}>
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", ok ? "bg-[var(--bien)]" : "bg-[var(--mal)]")} />
            {l.sentido === "EXIT" ? <LogOut size={11} className="text-white/55" /> : <LogIn size={11} className="text-white/55" />}
            <span className="font-bold tabular-nums tracking-wide">{l.plate || "SIN LEER"}</span>
            <span className="text-white/55 tabular-nums">{horaCorta(l.ts).slice(0, 5)}</span>
        </span>
    );
}

/**
 * Botón chico sobre la baldosa (aparecen al pasar el mouse). Corta el clic para que no abra
 * además la ficha, que es lo que hace tocar el resto de la baldosa.
 */
function AccionBaldosa({ children, titulo, onClick, href, activo }: { children: React.ReactNode; titulo: string; onClick?: () => void; href?: string; activo?: boolean }) {
    const cls = cn("w-8 h-8 rounded-full grid place-items-center transition-colors", activo ? "bg-white text-black" : "text-white/85 hover:text-white hover:bg-white/15");
    const cortar = (e: React.SyntheticEvent) => e.stopPropagation();
    if (href) return <a href={href} target="_blank" rel="noreferrer" title={titulo} aria-label={titulo} onClick={cortar} onPointerDown={cortar} className={cls}>{children}</a>;
    return <button type="button" title={titulo} aria-label={titulo} onPointerDown={cortar} onClick={(e) => { cortar(e); onClick?.(); }} className={cls}>{children}</button>;
}

/**
 * La captura de la detección con lo que vio OmniVision, sobre la baldosa durante
 * CAPTURA_EN_BALDOSA_MS. No se dibuja sobre el vivo: la persona ya se movió desde la captura, y
 * su silueta flotando en otro lugar del video sería una mentira. Lo dice el rótulo.
 */
function CapturaConSiluetas({ a, geom, ancho }: { a: Alerta; geom: Canal["geom"]; ancho: number }) {
    const [visible, setVisible] = useState(true);
    useEffect(() => { const k = setTimeout(() => setVisible(false), CAPTURA_EN_BALDOSA_MS); return () => clearTimeout(k); }, []);
    const src = conAncho(getImagePath(a.foto || null), ancho);
    if (!visible || !src) return null;
    return (
        <div className="absolute inset-0 bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
            <CapaAnalisis analisis={a.verif!.analisis} geom={geomDeIntrusion(geom)} ajuste="cover" etiquetas={false} />
            <span className="absolute top-12 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white/85 tabular-nums">
                Captura {horaCorta(a.ts)} · OmniVision
            </span>
        </div>
    );
}

/** El tipo del arrastre de una baldosa sobre otra (seguimiento visual): sólo esto se acepta al soltar. */
const TIPO_ARRASTRE = "application/x-omni-canal";

/** Cuánto se ve, como mínimo, «enviando»; cuánto la confirmación; cuánto un error si nadie lo cierra. */
const PASO_VISION_MIN_MS = 1400;
const PASO_VISION_LISTO_MS = 2600;
const PASO_VISION_ERROR_MS = 9000;

function Baldosa({ celda, modo, alerta, lecturas, destello, alTocar, alResultado, hls, libre, dormida, alGrabacion, alVentana, alVision, pasoVision = null, alCerrarPaso, enlaces = [], editandoSeg = false, alSeguir, alSoltarCanal, alCambiarEnlaces }: {
    celda: Celda; modo: Modo; alerta: Alerta | null; lecturas: Lectura[]; destello: Lectura | null;
    alTocar: () => void; alResultado: (c: Canal, modo: Modo, ok: boolean) => void;
    hls: boolean;
    /** En el celular: la baldosa no va en una casilla de la cuadrícula sino en una lista, a 16:9. */
    libre?: boolean;
    /** Fuera de la pantalla del celular: no abre video (datos y batería). */
    dormida?: boolean;
    /** Abrir el canal directo en su grabación (sólo si se sabe en qué NVR graba). */
    alGrabacion?: () => void;
    /** Abrir el canal solo en otra ventana (escritorio). */
    alVentana?: () => void;
    /** Mandarla a OmniVision o retirarla (sólo con permiso de Ajustes). */
    alVision?: () => void;
    /** Entrando o saliendo de OmniVision: el canal muestra el paso en lugar del video. */
    pasoVision?: PasoVision | null;
    alCerrarPaso?: () => void;
    /** Seguimiento visual: los enlaces de este canal, y si se están editando (arrastrar y soltar). */
    enlaces?: Enlace[]; editandoSeg?: boolean;
    alSeguir?: (destino: Canal) => void;
    alSoltarCanal?: (origenClave: string, x: number, y: number) => void;
    alCambiarEnlaces?: (links: TrackLink[]) => void;
}) {
    const [aspecto, setAspecto] = useState(16 / 9);
    const [encima, setEncima] = useState(false);
    const ocupadoVision = pasoVision?.fase === "enviando" || pasoVision?.fase === "retirando";
    const c = celda.canal;
    const grande = celda.casilla.w > 1;
    if (!c) {
        return (
            <div style={estiloCasilla(celda.casilla)} className="relative min-h-0 rounded-[10px] bg-muted/60 ring-1 ring-border grid place-items-center text-[12px] text-muted-foreground/70">
                {celda.claveFaltante ? "El canal de esta casilla ya no está" : ""}
            </div>
        );
    }
    const caido = c.online === false;
    const m = alerta ? metaDe(alerta.tipo) : null;
    const captura = alerta?.verif?.analisis && alerta.foto ? alerta : null;
    const ult = !alerta && c.ultima ? metaDe(c.ultima.tipo) : null;
    const foto = fotoDe(c, grande ? 960 : 640);
    const r = MODO_ROTULO[modo];
    const okDestello = destello ? destello.decision === "GRANT" && !destello.listaNegra : null;
    return (
        <motion.div role="button" tabIndex={0} layout="position" onClick={alTocar} onKeyDown={(e) => { if (e.key === "Enter") alTocar(); }} transition={SUAVE} aria-label={`Abrir ${c.nombre}`} style={libre ? undefined : estiloCasilla(celda.casilla)}
            className={cn("group relative rounded-[10px] overflow-hidden bg-neutral-950 text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-en-oscuro)]", libre ? "aspect-video w-full" : "min-h-0", tocable,
                alerta ? "ring-4 ring-[var(--mal)]" : destello ? (okDestello ? "ring-4 ring-[var(--bien)]" : "ring-4 ring-[var(--mal)]") : "ring-1 ring-white/10")}>
            {caido ? (
                <span className="absolute inset-0 grid place-items-center text-white/45">
                    <span className="flex flex-col items-center gap-2"><VideoOff size={grande ? 36 : 26} /><span className="text-[13px] font-semibold">Sin señal en el NVR</span></span>
                </span>
            ) : dormida ? null : modo === "foto" ? (
                foto ? <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-cover" /> : null
            ) : (
                <Vivo src={vivoDe(c.stream, modo === "convertido", hls)} alResultado={(ok) => alResultado(c, modo, ok)} alMedir={(w, h) => { if (w && h) setAspecto(w / h); }} className="absolute inset-0 w-full h-full object-cover" />
            )}
            {c.geom && !caido && <Geometria geom={c.geom} alerta={!!alerta} ajuste="cover" />}
            {captura && <CapturaConSiluetas key={captura.id} a={captura} geom={c.geom} ancho={grande ? 960 : 640} />}
            {/* Editando el seguimiento: la baldosa entera se arrastra (lleva su canal) y recibe a las
                otras; donde se suelta, queda el ícono. Es una capa encima y no el motion.div, porque
                framer-motion se queda con onDragStart para su propio gesto. */}
            {editandoSeg && (
                <div draggable className={cn("absolute inset-0 z-[14] cursor-grab active:cursor-grabbing transition-colors", encima && "bg-[color-mix(in_oklab,var(--accion-en-oscuro)_22%,transparent)] ring-4 ring-inset ring-[var(--accion-en-oscuro)]")}
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => { e.dataTransfer.setData(TIPO_ARRASTRE, c.clave); e.dataTransfer.effectAllowed = "link"; }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes(TIPO_ARRASTRE)) { e.preventDefault(); e.dataTransfer.dropEffect = "link"; if (!encima) setEncima(true); } }}
                    onDragLeave={() => setEncima(false)}
                    onDrop={(e) => {
                        e.preventDefault(); setEncima(false);
                        const origen = e.dataTransfer.getData(TIPO_ARRASTRE); if (!origen || origen === c.clave) return;
                        const b = e.currentTarget.getBoundingClientRect();
                        const p = aCuadro(cuadroCover(b.width, b.height, aspecto), e.clientX - b.left, e.clientY - b.top);
                        alSoltarCanal?.(origen, p.x, p.y);
                    }} />
            )}
            {!caido && (enlaces.length > 0 || editandoSeg) && (
                <EnlacesBaldosa enlaces={enlaces} aspecto={aspecto} editando={editandoSeg} chica={!grande && !libre}
                    alSeguir={(d) => alSeguir?.(d)}
                    alMover={(i, x, y) => alCambiarEnlaces?.(enlaces.map((e, j) => (j === i ? { ...e.link, x, y } : e.link)))}
                    alQuitar={(i) => alCambiarEnlaces?.(enlaces.filter((_, j) => j !== i).map((e) => e.link))} />
            )}
            <PasoVisionCanal paso={pasoVision} nombre={c.nombre} foto={foto} alCerrar={alCerrarPaso} />

            <div className="absolute top-0 inset-x-0 px-3 pt-2 pb-6 bg-gradient-to-b from-black/75 to-transparent flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className={cn("font-bold text-white leading-tight truncate", grande ? "text-[18px]" : "text-[14px]")}>{c.nombre}</div>
                    <div className="text-[11.5px] text-white/65 inline-flex items-center gap-1 truncate max-w-full">{c.nvr && <Server size={10} />} {ubicacion(c)}</div>
                </div>
                {/* OmniVision la analiza: queda a la vista siempre, no sólo al pasar el mouse. */}
                {c.vision?.analiza && (
                    <span title={`OmniVision analiza esta cámara${c.vision.porSeg != null ? ` · ${c.vision.porSeg.toLocaleString("es-UY", { maximumFractionDigits: 2 })} análisis por segundo` : ""}`}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-full bg-[color-mix(in_oklab,var(--accion-en-oscuro)_30%,rgba(0,0,0,0.55))] text-white text-[11px] font-semibold shrink-0 [@media(hover:hover)]:group-hover:opacity-0 transition-opacity">
                        <ScanEye size={13} /> Omni
                        {/* Recién agregada: el motor la toma en su próxima vuelta y la medición tarda. */}
                        {!(c.vision.porSeg && c.vision.porSeg > 0) && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accion-en-oscuro)] animate-pulse" aria-label="arrancando" />}
                    </span>
                )}
                {c.funcion && (
                    <span title={c.funcion === "lpr" ? "Lee matrículas" : "Vigila una línea o una zona"} className="grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white/80 shrink-0 [@media(hover:hover)]:group-hover:opacity-0 transition-opacity">
                        {c.funcion === "lpr" ? <Car size={14} /> : <ShieldAlert size={14} />}
                    </span>
                )}
            </div>
            {/* Los controles de la baldosa: aparecen al pasar el mouse, como los de la ficha. Con el
                dedo no hay «pasar»: tocar la baldosa abre la ficha, que los tiene todos. */}
            <div className={cn("absolute top-2 right-2 hidden [@media(hover:hover)]:flex items-center gap-0.5 rounded-full visor-panel p-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity", editandoSeg && "[@media(hover:hover)]:hidden")}>
                <AccionBaldosa titulo="Abrir a pantalla completa" onClick={alTocar}><Maximize2 size={15} /></AccionBaldosa>
                {alGrabacion && <AccionBaldosa titulo="Ver la grabación" onClick={alGrabacion}><History size={15} /></AccionBaldosa>}
                {foto && <AccionBaldosa titulo="Abrir la foto de ahora en una pestaña" href={foto.replace(/[?&]w=\d+/, "")}><Camera size={15} /></AccionBaldosa>}
                {alVentana && <AccionBaldosa titulo="Abrir este canal solo en otra ventana (para otro monitor)" onClick={alVentana}><AppWindow size={15} /></AccionBaldosa>}
                {alVision && (
                    <AccionBaldosa titulo={c.vision?.analiza ? `Retirar de OmniVision${c.vision.porSeg != null ? ` (usa ${c.vision.porSeg.toLocaleString("es-UY", { maximumFractionDigits: 2 })} análisis/s)` : ""}` : "Analizar con OmniVision: siluetas, búsqueda, reglas y verificación"} onClick={alVision} activo={c.vision?.analiza}>
                        {ocupadoVision ? <Loader2 size={15} className="animate-spin" /> : <ScanEye size={15} />}
                    </AccionBaldosa>
                )}
            </div>

            <div className="absolute bottom-2 left-2 right-2 flex items-end gap-2">
                <div className="min-w-0 flex-1 flex flex-col items-start gap-1">
                    {alerta && m && (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold pleno-mal max-w-full truncate"><m.Icon size={13} /> {m.label} · <span className="tabular-nums">{horaCorta(alerta.ts)}</span></span>
                    )}
                    {ult && c.ultima && (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold bg-black/60 text-white/75 max-w-full truncate"><ult.Icon size={12} /> {ult.label} · {hace(c.ultima.ts)}</span>
                    )}
                    {lecturas.slice(0, grande ? CHAPAS_GRANDE : CHAPAS_CHICA).map((l) => <ChapaMini key={l.id} l={l} nueva={destello?.id === l.id} />)}
                </div>
                {!caido && (
                    <span title={r.titulo} className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white/75 shrink-0">
                        {r.Ic ? <r.Ic size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--mal)]" />} {r.t}
                    </span>
                )}
            </div>
        </motion.div>
    );
}

/** El veredicto de OmniVision que confirma una detección (hay alguien en la captura). */
const VEREDICTO_CONFIRMADO = "PRESENTE";

export function VistaCamaras() {
    const { latir, setTitulo, setFondo } = useMarco();
    usarReloj(5000);
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/camaras", INTERVALO_MS, latir);

    // Lo que sabe este navegador y cómo quiere ver esta ventana. null = primer render (servidor).
    const [h265, setH265] = useState<boolean | null>(null);
    const [prefs, setPrefsState] = useState<Prefs | null>(null);
    const [canalSolo, setCanalSolo] = useState<string | null>(null);
    const [hls, setHls] = useState(false);
    useEffect(() => { setH265(reproduceH265()); setHls(usaHls()); const l = leerPrefs(); setPrefsState(l.prefs); setCanalSolo(l.canalSolo); }, []);
    // Celular: menos de 768 px de ancho. La pared pasa a ser una lista con un menú abajo.
    const [movil, setMovil] = useState(false);
    useEffect(() => {
        try { const mq = window.matchMedia("(max-width: 767px)"); const leer = () => setMovil(mq.matches); leer(); mq.addEventListener?.("change", leer); return () => mq.removeEventListener?.("change", leer); } catch { }
    }, []);
    // Qué baldosas de la lista del celular están a la vista: sólo esas abren video.
    const [aLaVista, setALaVista] = useState<Set<string>>(new Set());
    const observador = useMemo(() => (typeof window === "undefined" || !("IntersectionObserver" in window)) ? null : new IntersectionObserver((entradas) => {
        setALaVista((prev) => {
            const n = new Set(prev);
            for (const e of entradas) { const k = (e.target as HTMLElement).dataset.clave; if (!k) continue; if (e.isIntersecting) n.add(k); else n.delete(k); }
            return n;
        });
    }, { rootMargin: "120px 0px" }), []);
    useEffect(() => () => observador?.disconnect(), [observador]);
    const observar = useCallback((el: HTMLElement | null) => { if (el && observador) observador.observe(el); }, [observador]);
    const setPrefs = useCallback((cambio: Partial<Prefs>) => setPrefsState((p) => {
        const n = { ...(p || PREFS_INICIALES), ...cambio };
        try { localStorage.setItem(clavePrefs(PREFS_BASE), JSON.stringify(n)); } catch { }
        return n;
    }), []);

    // Cuántos vivos arrancaron y cuántos no, por canal y modo: la prueba de verdad.
    const [resultados, setResultados] = useState<Record<string, boolean>>({});
    const alResultado = useCallback((c: Canal, modo: Modo, ok: boolean) => setResultados((r) => { const k = `${c.clave}|${modo}`; return r[k] === ok ? r : { ...r, [k]: ok }; }), []);

    // Lo que llega por el socket, sin esperar la próxima vuelta.
    const [alertasVivas, setAlertasVivas] = useState<Record<string, Alerta>>({});
    const [lecturasVivas, setLecturasVivas] = useState<Record<string, Lectura[]>>({});
    const [destellos, setDestellos] = useState<Record<string, Lectura>>({});
    useTiempoReal("general_detection", (d: any) => {
        if (!d?.id || !d.deviceId || d.type === "MOTION") return;
        setAlertasVivas((p) => ({ ...p, [d.deviceId]: { id: d.id, tipo: d.type, ts: d.timestamp || new Date().toISOString() } }));
        latir();
        // Si quien avisó es un NVR (canal sin mapear), el canal lo resuelve la consulta.
        setTimeout(recargar, 1500);
    });
    // OmniVision terminó de mirar una captura: la consulta trae sus siluetas para la baldosa.
    useTiempoReal("detection_verified", () => { recargar(); });
    useTiempoReal("access_event", (e: any) => {
        const dev = e?.deviceId || e?.device?.id;
        if (!e?.id || !dev) return;
        const l: Lectura = { id: e.id, ts: e.timestamp || new Date().toISOString(), plate: (e.plateDetected || e.plateNumber || "").toUpperCase() || null, decision: e.decision || "DENY", sentido: e.direction || "ENTRY", listaNegra: /lista negra/i.test(e.details || "") };
        setLecturasVivas((p) => ({ ...p, [dev]: [l, ...(p[dev] || []).filter((x) => x.id !== l.id)].slice(0, CHAPAS_GRANDE * 2) }));
        setDestellos((p) => ({ ...p, [dev]: l }));
        setTimeout(() => setDestellos((p) => { if (p[dev]?.id !== l.id) return p; const n = { ...p }; delete n[dev]; return n; }), DESTELLO_MS);
        latir();
    });
    const ventana = datos?.ventanaAlertaMs || 120_000;
    const alertaDe = useCallback((c: Canal): Alerta | null => {
        // La del socket no trae captura ni análisis: si es la misma detección, vale la de la consulta.
        const viva = c.equipoId && alertasVivas[c.equipoId]?.id !== c.alerta?.id ? alertasVivas[c.equipoId] : undefined;
        const a = [c.alerta, viva].filter(Boolean).sort((x, y) => +new Date(y!.ts) - +new Date(x!.ts))[0] || null;
        return a && Date.now() - +new Date(a.ts) < ventana ? a : null;
    }, [alertasVivas, ventana]);
    const lecturasDe = useCallback((c: Canal): Lectura[] => {
        if (c.funcion !== "lpr" && !(c.equipoId && lecturasVivas[c.equipoId])) return [];
        const vivas = c.equipoId ? lecturasVivas[c.equipoId] || [] : [];
        const ids = new Set(vivas.map((x) => x.id));
        return [...vivas, ...c.lecturas.filter((x) => !ids.has(x.id))];
    }, [lecturasVivas]);

    const todos = datos?.canales || [];
    const porClave = useMemo(() => new Map(todos.map((c) => [c.clave, c])), [todos]);
    const nvrs = useMemo(() => [...new Set(todos.map(grupoDe))], [todos]);
    const guardada = prefs && prefs.vista !== AUTO ? datos?.vistas.find((v) => v.id === prefs.vista) || null : null;
    const modoVista: "solo" | "guardada" | "auto" = canalSolo ? "solo" : guardada ? "guardada" : "auto";
    const disp = disposicionDe(modoVista === "solo" ? "1" : guardada ? guardada.disposicion : prefs?.disposicion);
    const filtro = prefs?.nvr && (prefs.nvr === "todos" || nvrs.includes(prefs.nvr)) ? prefs.nvr : "todos";
    /*
     * Por área de Dispositivos (21/10, Nico: «filtrar las cámaras por áreas también acá»). Un área
     * incluye las de adentro; un canal sin equipo cuenta en el área de su NVR. Se combina con el NVR.
     */
    const areas = datos?.areas || [];
    const areaSel = prefs?.area && (prefs.area === "todas" || prefs.area === SIN_AREA || areas.some((a) => a.id === prefs.area)) ? prefs.area : "todas";
    const bajoArea = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const a of areas) { const set = new Set([a.id]); let cambio = true; while (cambio) { cambio = false; for (const b of areas) if (b.padre && set.has(b.padre) && !set.has(b.id)) { set.add(b.id); cambio = true; } } m.set(a.id, set); }
        return m;
    }, [areas]);
    const enArea = useCallback((c: Canal, area: string) => area === "todas" ? true : area === SIN_AREA ? !c.areaId || !bajoArea.has(c.areaId) : !!c.areaId && !!bajoArea.get(area)?.has(c.areaId), [bajoArea]);
    const nombreArea = areaSel === "todas" ? null : areaSel === SIN_AREA ? "Sin área" : areas.find((a) => a.id === areaSel)?.nombre || null;

    // Automática: las que detectan van primero (a la casilla grande, si hay); el resto en el orden del NVR.
    const ordenados = useMemo(() => {
        const f = todos.filter((c) => (filtro === "todos" || grupoDe(c) === filtro) && enArea(c, areaSel));
        const con = f.filter((c) => alertaDe(c)).sort((a, b) => +new Date(alertaDe(b)!.ts) - +new Date(alertaDe(a)!.ts));
        return [...con, ...f.filter((c) => !alertaDe(c))];
    }, [todos, filtro, alertaDe, enArea, areaSel]);
    const porPagina = disp.casillas.length;
    const paginas = modoVista === "auto" ? Math.max(1, Math.ceil(ordenados.length / porPagina)) : 1;
    const [pagina, setPagina] = useState(0);
    const hayAlerta = ordenados.some((c) => alertaDe(c));
    const pausada = !!prefs?.pausa;
    /** Editando el seguimiento visual (arrastrar cámaras unas sobre otras): la página no pasa sola. */
    const [editandoSeg, setEditandoSeg] = useState(false);
    useEffect(() => { if (hayAlerta) setPagina(0); }, [hayAlerta]);
    // Mismo criterio de fondo que las demás paredes (lib/monitor/fondos): una detección en pantalla es
    // ámbar (hay que mirarla); si OmniVision confirmó que hay alguien, roja (hay que atenderla).
    const tonoPared: TonoFondo | null = !hayAlerta ? null
        : ordenados.some((c) => alertaDe(c)?.verif?.veredicto === VEREDICTO_CONFIRMADO) ? "mal" : "aviso";
    useEffect(() => { setFondo(fondoDe(tonoPared)); }, [tonoPared, setFondo]);
    useEffect(() => () => setFondo(null), [setFondo]);
    useEffect(() => {
        if (modoVista !== "auto" || paginas <= 1 || pausada || hayAlerta || editandoSeg) return;
        const iv = setInterval(() => setPagina((p) => (p + 1) % paginas), (prefs?.pagSeg || 20) * 1000);
        return () => clearInterval(iv);
    }, [modoVista, paginas, pausada, hayAlerta, prefs?.pagSeg, editandoSeg]);
    const pag = Math.min(pagina, paginas - 1);

    const celdas: Celda[] = useMemo(() => {
        if (modoVista === "solo") return [{ casilla: disp.casillas[0], canal: porClave.get(canalSolo!) || null, claveFaltante: canalSolo }];
        if (modoVista === "guardada") return disp.casillas.map((casilla, i) => { const k = guardada!.canales[i]; return { casilla, canal: k ? porClave.get(k) || null : null, claveFaltante: k }; });
        const lista = ordenados.slice(pag * porPagina, pag * porPagina + porPagina);
        return disp.casillas.map((casilla, i) => ({ casilla, canal: lista[i] || null }));
    }, [modoVista, disp, porClave, canalSolo, guardada, ordenados, pag, porPagina]);
    // En el celular no hay casillas ni páginas: la lista entera de la vista, y sólo se mira lo visible.
    const lista: Canal[] = useMemo(() => modoVista === "solo" ? celdas.map((x) => x.canal).filter(Boolean) as Canal[]
        : modoVista === "guardada" ? (guardada!.canales.map((k) => (k ? porClave.get(k) : null)).filter(Boolean) as Canal[]) : ordenados, [modoVista, celdas, guardada, porClave, ordenados]);
    const enPantalla = movil ? lista : celdas.map((x) => x.canal).filter(Boolean) as Canal[];

    useEffect(() => {
        setTitulo(modoVista === "solo" ? (porClave.get(canalSolo!)?.nombre || "Cámara") : guardada ? `Cámaras · ${guardada.nombre}` : "Cámaras");
    }, [setTitulo, modoVista, guardada, canalSolo, porClave]);

    // Qué es cada baldosa: directo si el navegador puede (y ese canal no falló); si no, las
    // primeras MAX_CONVERTIDOS van convertidas —las grandes primero— y el resto es foto.
    const modos = useMemo(() => {
        const m = new Map<string, Modo>();
        let convertidos = 0;
        const orden = movil ? lista.filter((c) => aLaVista.has(c.clave)) : [...celdas].filter((x) => x.canal).sort((a, b) => b.casilla.w - a.casilla.w).map((x) => x.canal!);
        for (const c of orden) {
            if (h265 && resultados[`${c.clave}|directo`] !== false) { m.set(c.clave, "directo"); continue; }
            if (convertidos < MAX_CONVERTIDOS && c.online !== false && resultados[`${c.clave}|convertido`] !== false) { m.set(c.clave, "convertido"); convertidos++; continue; }
            m.set(c.clave, "foto");
        }
        return m;
    }, [celdas, h265, resultados, movil, lista, aLaVista]);

    const directos = Object.entries(resultados).filter(([k]) => k.endsWith("|directo")).map(([, v]) => v);
    const directosOk = directos.filter(Boolean).length;
    const directosMal = directos.filter((x) => !x).length;

    // La ficha a pantalla completa, por clave (así se actualiza con cada vuelta de datos).
    const [abiertaClave, setAbiertaClave] = useState<string | null>(null);
    /** Si la ficha se abrió desde el control «grabación» de una baldosa: el instante donde arranca. */
    const [grabacionInicial, setGrabacionInicial] = useState<number | null>(null);
    /** De qué cámara se vino por el seguimiento visual (para volver). */
    const [origenClave, setOrigenClave] = useState<string | null>(null);
    const abierta = abiertaClave ? porClave.get(abiertaClave) || null : null;
    const mover = useCallback((paso: 1 | -1) => {
        if (!abiertaClave || !enPantalla.length) return;
        const i = enPantalla.findIndex((c) => c.clave === abiertaClave);
        setAbiertaClave(enPantalla[(i + paso + enPantalla.length) % enPantalla.length].clave);
    }, [abiertaClave, enPantalla]);

    // Menús de la barra.
    const [menu, setMenu] = useState<null | "vista" | "disposicion" | "nvr" | "area" | "paginas" | "ventanas" | "recursos">(null);
    const cerrarMenu = useCallback(() => setMenu(null), []);
    const alternar = (m: NonNullable<typeof menu>) => setMenu((x) => (x === m ? null : m));
    const [editando, setEditando] = useState<VistaGuardada | null>(null);
    const [pantallas, setPantallas] = useState<Pantalla[] | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    /** Por canal: en qué paso está su entrada o salida de OmniVision (se dibuja en el canal mismo). */
    const [pasosVision, setPasosVision] = useState<Record<string, PasoVision>>({});
    /**
     * Seguimiento visual en la pared: lo que dice el servidor más lo que se cambió acá (se guarda
     * enseguida; esto evita esperar la próxima recarga para verlo). `editandoSeg` prende el modo
     * de arrastrar cámaras unas sobre otras.
     */
    const [segLocal, setSegLocal] = useState<Record<string, TrackLink[]>>({});
    const seguimiento = useMemo(() => ({ ...(datos?.seguimiento || {}), ...segLocal }), [datos?.seguimiento, segLocal]);
    const porIdCanal = useMemo(() => new Map(todos.map((c) => [idCanal(c), c])), [todos]);
    const enlacesDe = useCallback((c: Canal): Enlace[] => (seguimiento[idCanal(c)] || [])
        .map((link) => { const destino = porIdCanal.get(link.to); return destino ? { link, destino, alarma: !!alertaDe(destino) } : null; })
        .filter((x): x is Enlace => !!x), [seguimiento, porIdCanal, alertaDe]);
    const guardarSeg = async (c: Canal, links: TrackLink[]) => {
        const id = idCanal(c), antes = seguimiento[id] || [];
        setSegLocal((s) => ({ ...s, [id]: links }));
        const r = await setVisualTrackLinks(id, links).catch(() => ({ ok: false }));
        if (!r.ok) { setSegLocal((s) => ({ ...s, [id]: antes })); setAviso("No se pudo guardar el seguimiento visual: hace falta entrar al panel con sesión."); }
    };
    /** Soltar la cámara `origen` sobre `c` en (x, y) del cuadro de `c`: enlace nuevo, o mover el que ya había. */
    const enlazar = (c: Canal, origenClave: string, x: number, y: number) => {
        const o = porClave.get(origenClave); if (!o || o.clave === c.clave) return;
        const to = idCanal(o), actuales = seguimiento[idCanal(c)] || [];
        const n = actuales.some((l) => l.to === to) ? actuales.map((l) => (l.to === to ? { to, x, y } : l)) : [...actuales, { to, x, y }];
        void guardarSeg(c, n);
    };
    const ponerPaso = useCallback((clave: string, paso: PasoVision | null) => setPasosVision((s) => {
        const n = { ...s }; if (paso) n[clave] = paso; else delete n[clave]; return n;
    }), []);
    useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 6000); return () => clearTimeout(t); }, [aviso]);

    const paramsVista = (): Record<string, string> => modoVista === "solo" ? { canal: canalSolo! } : guardada ? { vista: guardada.id } : { vista: AUTO, disposicion: disp.clave };
    const nombreVentana = () => (modoVista === "solo" ? `canal-${canalSolo}` : guardada ? `vista-${guardada.id}` : `auto-${Date.now().toString(36)}`);
    const desacoplar = (pantalla?: Pantalla | null) => {
        if (!abrirVentana(paramsVista(), nombreVentana(), pantalla)) setAviso("El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio y probá de nuevo.");
        setMenu(null);
    };
    const detectarPantallas = async () => {
        const p = await listarPantallas();
        if (!p) setAviso("El navegador no dio acceso a los monitores. Abrí la ventana común y arrastrala al otro monitor.");
        setPantallas(p);
    };

    if (editando) {
        return (
            <EditorVista inicial={editando} canales={todos} alSalir={(r) => {
                setEditando(null);
                if (r === "borrada") setPrefs({ vista: AUTO });
                else if (r) setPrefs({ vista: r.id });
                recargar();
            }} />
        );
    }


    const nombreVista = modoVista === "solo" ? (porClave.get(canalSolo!)?.nombre || "Una cámara") : guardada ? guardada.nombre : [nombreArea, filtro === "todos" ? null : filtro].filter(Boolean).join(" · ") || "Todas las cámaras";
    // Los NVR que no contestan van en su menú, apagados y con el porqué: un aviso fijo arriba
    // (como era hasta el 15/10) le sacaba una fila al video para algo que no se puede arreglar desde acá.
    const nvrsCaidos = datos?.errores || [];

    // Lo que hay en cada menú: el mismo contenido en el menú flotante (escritorio) y en la hoja de abajo (celular).
    const opcionesVista = (
        <>
            <OpcionMenu onClick={() => { setPrefs({ vista: AUTO }); setPagina(0); setMenu(null); }} elegida={modoVista === "auto"}>
                <LayoutGrid size={16} className="text-muted-foreground" /> <span className="flex-1">Automática <span className="text-muted-foreground font-normal">· todos los canales</span></span>
            </OpcionMenu>
            {(datos?.vistas || []).length > 0 && <div className="my-1 h-px bg-border" />}
            {(datos?.vistas || []).map((v) => (
                <OpcionMenu key={v.id} onClick={() => { setPrefs({ vista: v.id }); setMenu(null); }} elegida={guardada?.id === v.id}>
                    <Glifo d={disposicionDe(v.disposicion)} tam={20} className="text-muted-foreground shrink-0" />
                    <span className="truncate">{v.nombre}</span>
                    <span className="text-[12px] text-muted-foreground tabular-nums">{v.canales.filter(Boolean).length}</span>
                </OpcionMenu>
            ))}
            {datos?.puedeEditar && !movil && (<>
                <div className="my-1 h-px bg-border" />
                {guardada && <OpcionMenu onClick={() => { setEditando(guardada); setMenu(null); }}><Pencil size={15} className="text-muted-foreground" /> Editar «{guardada.nombre}»</OpcionMenu>}
                <OpcionMenu onClick={() => {
                    const d = disposicionDe(modoVista === "auto" ? disp.clave : DISPOSICION_POR_DEFECTO);
                    // Arranca con lo que se está viendo: casi siempre se diseña a partir de eso.
                    setEditando({ id: "", nombre: "", disposicion: d.clave, canales: d.casillas.map((_, i) => (modoVista === "auto" ? celdas[i]?.canal?.clave : null) || null) });
                    setMenu(null);
                }}><Plus size={15} className="text-muted-foreground" /> Nueva vista</OpcionMenu>
            </>)}
            {datos && !datos.puedeEditar && !movil && <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground">Diseñar vistas pide entrar al panel con el permiso Monitores.</p>}
            {movil && datos?.puedeEditar && <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground">Las vistas se diseñan desde una pantalla grande.</p>}
        </>
    );
    const opcionesNvr = (
        <>
            {["todos", ...nvrs].map((n) => (
                <OpcionMenu key={n} onClick={() => { setPrefs({ nvr: n }); setPagina(0); setMenu(null); }} elegida={filtro === n}>
                    <span className="flex-1 truncate">{n === "todos" ? "Todos los NVR" : n}</span>
                    <span className="text-[12px] text-muted-foreground tabular-nums">{n === "todos" ? todos.length : todos.filter((c) => grupoDe(c) === n).length}</span>
                </OpcionMenu>
            ))}
            {nvrsCaidos.map((e) => (
                <div key={e.nvr} title={e.error} className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-[var(--mal)] shrink-0" />
                    <span className="flex-1 truncate">{e.nvr}</span>
                    <span className="text-[12px]">no responde</span>
                </div>
            ))}
        </>
    );
    const hayNvrs = nvrs.length > 1 || nvrsCaidos.length > 0;
    const haySinArea = todos.some((c) => enArea(c, SIN_AREA));
    const opcionesArea = (
        <>
            <OpcionMenu onClick={() => { setPrefs({ area: "todas" }); setPagina(0); setMenu(null); }} elegida={areaSel === "todas"}>
                <span className="flex-1 truncate">Todas las áreas</span>
                <span className="text-[12px] text-muted-foreground tabular-nums">{todos.length}</span>
            </OpcionMenu>
            {areas.map((a) => {
                const n = todos.filter((c) => enArea(c, a.id)).length;
                if (!n) return null;
                return (
                    <OpcionMenu key={a.id} onClick={() => { setPrefs({ area: a.id }); setPagina(0); setMenu(null); }} elegida={areaSel === a.id}>
                        <span className="flex items-center gap-2 flex-1 min-w-0" style={{ paddingLeft: a.nivel * 12 }}>
                            <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: a.color }} />
                            <span className="truncate">{a.nombre}</span>
                        </span>
                        <span className="text-[12px] text-muted-foreground tabular-nums">{n}</span>
                    </OpcionMenu>
                );
            })}
            {haySinArea && (
                <OpcionMenu onClick={() => { setPrefs({ area: SIN_AREA }); setPagina(0); setMenu(null); }} elegida={areaSel === SIN_AREA}>
                    <span className="flex-1 truncate text-muted-foreground">Sin área</span>
                    <span className="text-[12px] text-muted-foreground tabular-nums">{todos.filter((c) => enArea(c, SIN_AREA)).length}</span>
                </OpcionMenu>
            )}
        </>
    );
    const hayAreas = areas.length > 0;

    /**
     * Mandar a OmniVision o retirar (PUT /api/vision/camaras/<id>, permiso Ajustes). El servidor
     * decide si hay cupo: si no, contesta 409 con el porqué y se muestra tal cual.
     */
    const ponerEnVision = async (c: Canal) => {
        if (pasosVision[c.clave]) return; // ya hay un pedido de este canal en curso
        const analiza = !c.vision?.analiza;
        ponerPaso(c.clave, { fase: analiza ? "enviando" : "retirando" });
        // El pedido tarda decenas de ms: sin un mínimo, el cartel parpadea y no se llega a leer.
        const minimo = new Promise((r) => setTimeout(r, PASO_VISION_MIN_MS));
        let fallo: string | null = null;
        try {
            const r = await fetch(`/api/vision/camaras/${encodeURIComponent(idCanal(c))}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ analiza, nombre: `${c.nombre}${c.nvr ? ` · ${c.nvr}` : ""}` }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) fallo = j.error || `El servidor respondió ${r.status}.`;
        } catch { fallo = "No hubo respuesta del servidor. Probá de nuevo."; }
        await minimo;
        if (fallo) { ponerPaso(c.clave, { fase: "error", texto: fallo }); setTimeout(() => setPasosVision((s) => (s[c.clave]?.fase === "error" ? (({ [c.clave]: _, ...resto }) => resto)(s) : s)), PASO_VISION_ERROR_MS); return; }
        await recargar();
        ponerPaso(c.clave, { fase: analiza ? "listo" : "retirado" });
        setTimeout(() => setPasosVision((s) => (s[c.clave]?.fase === "listo" || s[c.clave]?.fase === "retirado" ? (({ [c.clave]: _, ...resto }) => resto)(s) : s)), PASO_VISION_LISTO_MS);
    };

    const baldosa = (celda: Celda, i: number, libre = false) => (
        <Baldosa key={celda.canal?.clave || `vacia-${i}`} celda={celda} modo={celda.canal ? modos.get(celda.canal.clave) || "foto" : "foto"} hls={hls} libre={libre}
            dormida={libre && !!celda.canal && !aLaVista.has(celda.canal.clave)}
            alerta={celda.canal ? alertaDe(celda.canal) : null} lecturas={celda.canal ? lecturasDe(celda.canal) : []}
            destello={celda.canal?.equipoId ? destellos[celda.canal.equipoId] || null : null}
            alTocar={() => { if (celda.canal && !editandoSeg) { setGrabacionInicial(null); setAbiertaClave(celda.canal.clave); } }} alResultado={alResultado}
            enlaces={celda.canal ? enlacesDe(celda.canal) : []} editandoSeg={editandoSeg && !libre}
            alSeguir={(d) => { if (!celda.canal) return; setOrigenClave(celda.canal.clave); setGrabacionInicial(null); setAbiertaClave(d.clave); }}
            alSoltarCanal={(origen, x, y) => { if (celda.canal) enlazar(celda.canal, origen, x, y); }}
            alCambiarEnlaces={(n) => { if (celda.canal) void guardarSeg(celda.canal, n); }}
            alGrabacion={celda.canal?.nvrId && celda.canal.ch != null ? () => { const k = celda.canal!; const a = alertaDe(k); setGrabacionInicial(a ? +new Date(a.ts) - 5000 : Date.now() - 60_000); setAbiertaClave(k.clave); } : undefined}
            alVentana={!movil && celda.canal ? () => { const k = celda.canal!; if (!abrirVentana({ canal: k.clave }, `canal-${k.clave}`, null)) setAviso("El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio."); } : undefined}
            alVision={datos?.vision?.puedeCambiar && celda.canal ? () => ponerEnVision(celda.canal!) : undefined} pasoVision={celda.canal ? pasosVision[celda.canal.clave] || null : null}
            alCerrarPaso={celda.canal ? () => ponerPaso(celda.canal!.clave, null) : undefined} />
    );

    const estados = (
        <>
            {!datos && !error && <div className="col-span-full row-span-full grid place-items-center py-16 text-muted-foreground"><Loader2 className="animate-spin" /></div>}
            {error && !datos && (
                <div className="col-span-full row-span-full grid place-items-center text-center py-16">
                    <div>
                        <div className="text-[18px] text-[var(--mal-texto)]">No se pudo leer la lista de canales: {error}</div>
                        <button type="button" onClick={recargar} className={cn("mt-3 h-11 px-4 rounded-[6px] bg-[var(--accion)] text-white font-semibold", tocable)}>Reintentar</button>
                    </div>
                </div>
            )}
            {datos && todos.length === 0 && <div className="col-span-full row-span-full grid place-items-center py-16 text-[18px] text-muted-foreground">No hay canales para mostrar.</div>}
        </>
    );

    return (
        <div className="absolute inset-0 flex flex-col">
            <LiveEdgeKeeper />
            {/* Escritorio: los controles van en el encabezado del marco, en la misma fila que el título y la hora. */}
            {!movil && (
                <BarraDelMarco>
                    <div className="flex items-center gap-1.5 min-w-0 w-full">
                        {modoVista !== "solo" && (<>
                            <div className="relative shrink-0">
                                <BotonBarra onClick={() => alternar("vista")} activo={menu === "vista"} titulo="Elegir o diseñar una vista">
                                    <LayoutGrid size={15} className="text-muted-foreground" /> <span className="max-w-[180px] truncate">{nombreVista}</span> <ChevronDown size={14} className="text-muted-foreground" />
                                </BotonBarra>
                                <Flotante abierto={menu === "vista"} alCerrar={cerrarMenu} className="w-[300px]">{opcionesVista}</Flotante>
                            </div>
                            {modoVista === "auto" && (<>
                                <div className="relative shrink-0">
                                    <BotonBarra onClick={() => alternar("disposicion")} activo={menu === "disposicion"} titulo="Cómo se divide la pantalla">
                                        <Glifo d={disp} tam={22} /> <ChevronDown size={14} className="text-muted-foreground" />
                                    </BotonBarra>
                                    <Flotante abierto={menu === "disposicion"} alCerrar={cerrarMenu} className="w-[264px]">
                                        <div className="grid grid-cols-3 gap-1">
                                            {DISPOSICIONES.map((d) => (
                                                <button key={d.clave} type="button" onClick={() => { setPrefs({ disposicion: d.clave }); setPagina(0); setMenu(null); }} aria-pressed={disp.clave === d.clave}
                                                    className={cn("flex flex-col items-center gap-1.5 rounded-[8px] py-2.5 transition-colors",
                                                        disp.clave === d.clave ? "bg-[color-mix(in_oklab,var(--accion-en-oscuro)_20%,transparent)] text-[var(--accion-en-oscuro)]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                                                    <Glifo d={d} tam={34} />
                                                    <span className="text-[11px] font-semibold">{d.nombre}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </Flotante>
                                </div>
                                {hayAreas && modoVista === "auto" && (
                                    <div className="relative shrink-0">
                                        <BotonBarra onClick={() => alternar("area")} activo={menu === "area"} titulo="Mostrar las cámaras de un área de Dispositivos">
                                            <FolderTree size={15} className={areaSel === "todas" ? "text-muted-foreground" : "text-[var(--accion-en-oscuro)]"} />
                                            <span className="max-w-[160px] truncate">{nombreArea || "Todas las áreas"}</span>
                                            <ChevronDown size={14} className="text-muted-foreground" />
                                        </BotonBarra>
                                        <Flotante abierto={menu === "area"} alCerrar={cerrarMenu} className="w-[280px] max-h-[60vh] overflow-y-auto">{opcionesArea}</Flotante>
                                    </div>
                                )}
                                {hayNvrs && (
                                    <div className="relative shrink-0">
                                        <BotonBarra onClick={() => alternar("nvr")} activo={menu === "nvr"} titulo="Mostrar los canales de un solo grabador">
                                            <Server size={15} className="text-muted-foreground" /> <span className="hidden 2xl:inline">{filtro === "todos" ? "Todos los NVR" : filtro}</span>
                                            {nvrsCaidos.length > 0 && <span className="h-2 w-2 rounded-full bg-[var(--mal)]" title={`${nvrsCaidos.length} sin respuesta`} />}
                                            <ChevronDown size={14} className="text-muted-foreground" />
                                        </BotonBarra>
                                        <Flotante abierto={menu === "nvr"} alCerrar={cerrarMenu} className="w-[260px]">{opcionesNvr}</Flotante>
                                    </div>
                                )}
                                {paginas > 1 && (
                                    <div className="relative flex items-center gap-1 shrink-0">
                                        <BotonBarra onClick={() => setPagina((p) => (p - 1 + paginas) % paginas)} titulo="Página anterior" className="px-2"><ChevronLeft size={16} /></BotonBarra>
                                        <BotonBarra onClick={() => alternar("paginas")} activo={menu === "paginas"} titulo="Cada cuánto pasa de página">
                                            <span className="tabular-nums">{pag + 1}/{paginas}</span>
                                            <span className="inline-flex items-center gap-1 text-muted-foreground font-normal"><Timer size={13} /> {pausada ? "fija" : hayAlerta ? "fija" : `${prefs?.pagSeg || 20} s`}</span>
                                        </BotonBarra>
                                        <BotonBarra onClick={() => setPagina((p) => (p + 1) % paginas)} titulo="Página siguiente" className="px-2"><ChevronRight size={16} /></BotonBarra>
                                        <Flotante abierto={menu === "paginas"} alCerrar={cerrarMenu} className="w-[200px] left-9">
                                            <OpcionMenu onClick={() => { setPrefs({ pausa: true }); setMenu(null); }} elegida={pausada}>Quedarse en esta página</OpcionMenu>
                                            {PAGINA_SEG.map((s) => <OpcionMenu key={s} onClick={() => { setPrefs({ pausa: false, pagSeg: s }); setMenu(null); }} elegida={!pausada && prefs?.pagSeg === s}>Pasar cada {s} s</OpcionMenu>)}
                                        </Flotante>
                                    </div>
                                )}
                            </>)}
                        </>)}
                        <div className="ml-auto flex items-center gap-1.5 min-w-0">
                            <Recursos h265={h265} directosOk={directosOk} directosMal={directosMal} />
                            {datos?.puedeEditar && modoVista !== "solo" && (
                                <BotonBarra onClick={() => setEditandoSeg((x) => !x)} activo={editandoSeg} className="px-2.5"
                                    titulo={editandoSeg ? "Terminar de editar el seguimiento visual" : "Seguimiento visual: enlazar cámaras arrastrando una sobre otra"}>
                                    <Crosshair size={16} />{editandoSeg && <span>Listo</span>}
                                </BotonBarra>
                            )}
                            <div className="relative shrink-0">
                                <BotonBarra onClick={() => alternar("ventanas")} activo={menu === "ventanas"} titulo="Desacoplar esta vista en otra ventana, para otro monitor" className="px-2.5">
                                    <AppWindow size={16} />
                                </BotonBarra>
                                <Flotante abierto={menu === "ventanas"} alCerrar={cerrarMenu} lado="derecha" className="w-[300px]">
                                    <OpcionMenu onClick={() => desacoplar(null)}><AppWindow size={15} className="text-muted-foreground" /> Abrir «{nombreVista}» en otra ventana</OpcionMenu>
                                    {hayVariasPantallasApi() && (<>
                                        <div className="my-1 h-px bg-border" />
                                        {!pantallas ? (
                                            <OpcionMenu onClick={detectarPantallas}><Monitor size={15} className="text-muted-foreground" /> Detectar los monitores</OpcionMenu>
                                        ) : pantallas.map((p) => (
                                            <OpcionMenu key={p.id} onClick={() => desacoplar(p)}>
                                                <Monitor size={15} className="text-muted-foreground" />
                                                <span className="flex-1 truncate">Abrir en {p.nombre}{p.principal ? " (principal)" : ""}</span>
                                                <span className="text-[11px] text-muted-foreground tabular-nums">{p.width}×{p.height}</span>
                                            </OpcionMenu>
                                        ))}
                                    </>)}
                                    <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground">Cada ventana guarda su vista y su disposición. En la ventana nueva, el primer toque la pone en pantalla completa.</p>
                                </Flotante>
                            </div>
                        </div>
                    </div>
                </BarraDelMarco>
            )}

            {editandoSeg && !movil && (
                <div className="shrink-0 px-3 pt-3">
                    <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--accion-en-oscuro)_45%,transparent)] bg-[color-mix(in_oklab,var(--accion-en-oscuro)_10%,transparent)] px-3 py-2 text-[13px] flex items-center gap-3">
                        <Crosshair size={16} className="text-[var(--accion-en-oscuro)] shrink-0" />
                        <span className="flex-1">Arrastrá una cámara y soltala <b>sobre otra</b>, en el punto de la escena por donde se pasa a ella: queda un ícono ahí. Los íconos se mueven arrastrándolos y se quitan con la ✕.</span>
                        <button type="button" onClick={() => setEditandoSeg(false)} className="h-8 px-3 rounded-full bg-[var(--accion)] text-white text-[12.5px] font-semibold shrink-0">Listo</button>
                    </div>
                </div>
            )}
            {(aviso || (datos && !datos.go2rtc) || (!canalSolo && prefs && prefs.vista !== AUTO && !guardada && datos)) && (
                <div className="shrink-0 px-3 pt-3 flex flex-col gap-2">
                    {aviso && <div className="rounded-[10px] chip-aviso border px-3 py-2 text-[13px]">{aviso}</div>}
                    {datos && !datos.go2rtc && <div className="rounded-[10px] chip-mal border px-3 py-2 text-[13px]">El servidor de video (go2rtc) no responde: los vivos no van a abrir.</div>}
                    {!canalSolo && prefs && prefs.vista !== AUTO && !guardada && datos && <div className="rounded-[10px] chip-aviso border px-3 py-2 text-[13px]">Esa vista ya no existe: se muestra la automática.</div>}
                </div>
            )}

            {movil ? (
                /* Celular: una lista que se desliza, de 1 o 2 columnas; el menú va abajo, al alcance del pulgar. */
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pt-2 pb-[calc(84px+env(safe-area-inset-bottom))]">
                    <div className={cn("grid gap-2", prefs?.colMovil === 2 ? "grid-cols-2" : "grid-cols-1")}>
                        {estados}
                        {datos && h265 !== null && lista.map((c, i) => (
                            <div key={c.clave} ref={observar} data-clave={c.clave}>{baldosa({ casilla: { x: 0, y: 0, w: 1, h: 1 }, canal: c }, i, true)}</div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex-1 min-h-0 grid gap-2 p-3" style={{ gridTemplateColumns: `repeat(${disp.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${disp.filas}, minmax(0, 1fr))` }}>
                    {estados}
                    {datos && h265 !== null && todos.length > 0 && celdas.map((celda, i) => baldosa(celda, i))}
                </div>
            )}

            {movil && modoVista !== "solo" && (
                <MenuInferior
                    items={[
                        { k: "vista", Icono: LayoutGrid, rotulo: guardada ? guardada.nombre : "Vista", activo: menu === "vista", onClick: () => alternar("vista") },
                        { k: "col", Icono: prefs?.colMovil === 2 ? Columns2 : Rows3, rotulo: prefs?.colMovil === 2 ? "2 columnas" : "1 columna", onClick: () => setPrefs({ colMovil: prefs?.colMovil === 2 ? 1 : 2 }) },
                        ...(modoVista === "auto" && hayAreas ? [{ k: "area", Icono: FolderTree, rotulo: nombreArea || "Áreas", activo: menu === "area", onClick: () => alternar("area") }] : []),
                        ...(modoVista === "auto" && hayNvrs ? [{ k: "nvr", Icono: Server, rotulo: filtro === "todos" ? "NVR" : filtro, activo: menu === "nvr", onClick: () => alternar("nvr"), punto: nvrsCaidos.length > 0 }] : []),
                        { k: "recursos", Icono: Gauge, rotulo: "Servidor", activo: menu === "recursos", onClick: () => alternar("recursos") },
                    ]} />
            )}
            {movil && (
                <Hoja abierta={menu === "vista" || menu === "nvr" || menu === "area" || menu === "recursos"} titulo={menu === "vista" ? "Vista" : menu === "nvr" ? "Grabador" : menu === "area" ? "Área" : "Lo que usa el servidor"} alCerrar={cerrarMenu}>
                    {menu === "vista" && opcionesVista}
                    {menu === "area" && opcionesArea}
                    {menu === "nvr" && opcionesNvr}
                    {menu === "recursos" && <div className="flex flex-wrap gap-1.5"><Recursos h265={h265} directosOk={directosOk} directosMal={directosMal} envolver /></div>}
                </Hoja>
            )}

            <FichaCanal c={abierta} grabacionInicial={grabacionInicial} h265={!!h265 && (abierta ? resultados[`${abierta.clave}|directo`] !== false : true)} hls={hls}
                alerta={abierta ? alertaDe(abierta) : null} lecturas={abierta ? lecturasDe(abierta) : []}
                alCerrar={() => { setAbiertaClave(null); setOrigenClave(null); }} alMover={enPantalla.length > 1 ? mover : null}
                canales={todos} seguimiento={seguimiento} alGuardarSeguimiento={(id, n) => setSegLocal((s) => ({ ...s, [id]: n }))} puedeEditar={!!datos?.puedeEditar} alertaDe={alertaDe}
                alSeguir={(d) => { setOrigenClave(abiertaClave); setGrabacionInicial(null); setAbiertaClave(d.clave); }}
                origen={origenClave ? porClave.get(origenClave) || null : null}
                alVolverOrigen={() => { if (origenClave) { setAbiertaClave(origenClave); setOrigenClave(null); } }}
                alSoltarOrigen={() => setOrigenClave(null)}
                alVision={datos?.vision?.puedeCambiar && abierta ? () => ponerEnVision(abierta) : undefined}
                pasoVision={abierta ? pasosVision[abierta.clave] || null : null} alCerrarPaso={abierta ? () => ponerPaso(abierta.clave, null) : undefined}
                alVentana={!movil && abierta ? () => { if (!abrirVentana({ canal: abierta.clave }, `canal-${abierta.clave}`, null)) setAviso("El navegador bloqueó la ventana: permití las ventanas emergentes para este sitio."); } : undefined} />
        </div>
    );
}

/** El menú de abajo del celular: cuatro botones con ícono y rótulo, al alcance del pulgar. */
function MenuInferior({ items }: { items: { k: string; Icono: any; rotulo: string; activo?: boolean; onClick: () => void; punto?: boolean }[] }) {
    return (
        <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
            <div className="grid h-[68px]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
                {items.map((x) => (
                    <button key={x.k} type="button" onClick={x.onClick} aria-expanded={x.activo}
                        className={cn("relative flex flex-col items-center justify-center gap-1 min-w-0 px-1 text-[11px] font-semibold", tocable, x.activo ? "text-[var(--accion-en-oscuro)]" : "text-muted-foreground")}>
                        <x.Icono size={22} />
                        <span className="max-w-full truncate">{x.rotulo}</span>
                        {x.punto && <span className="absolute top-3 left-[calc(50%+8px)] h-2 w-2 rounded-full bg-[var(--mal)]" />}
                    </button>
                ))}
            </div>
        </nav>
    );
}

/** Hoja que sube desde abajo, para los menús del celular. */
function Hoja({ abierta, titulo, alCerrar, children }: { abierta: boolean; titulo: string; alCerrar: () => void; children: React.ReactNode }) {
    return (
        <AnimatePresence>
            {abierta && (<>
                <motion.button key="fondo" type="button" aria-label="Cerrar" onClick={alCerrar} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SUAVE}
                    className="fixed inset-0 z-40 bg-black/55" />
                <motion.div key="hoja" role="dialog" aria-label={titulo} initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={SUAVE}
                    className="fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] overflow-y-auto rounded-t-[14px] border-t border-border bg-card px-3 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[var(--sombra-flotante)]">
                    <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" />
                    <div className="flex items-center mb-1">
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground px-1">{titulo}</span>
                        <button type="button" onClick={alCerrar} aria-label="Cerrar" className="ml-auto grid h-10 w-10 place-items-center rounded-full hover:bg-muted"><X size={18} /></button>
                    </div>
                    {children}
                </motion.div>
            </>)}
        </AnimatePresence>
    );
}
