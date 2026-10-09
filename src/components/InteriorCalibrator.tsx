"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { AnimatePresence, motion } from "framer-motion";
import { sileo as toast } from "sileo";
import {
    X, Loader2, Save, RotateCcw, SquareDashed, ParkingSquare, ScanLine,
    Minus, Gauge, Timer, Crosshair, Trash2, ArrowLeftRight, CheckCircle2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconBar } from "@/components/ui/icon-bar";
import { LineaDePasada, ZONA_COMPLETA, type Linea, type Zona } from "@/components/tracking/Calibracion";
import { EscenaViva, type Caja } from "@/components/tracking/EscenaViva";
import {
    MenuEscena, GlifoLinea, GlifoZona, GlifoFranja, GlifoLeer, GlifoTodo, GlifoSentido,
} from "@/components/tracking/MenuEscena";
import { useFranja } from "@/components/tracking/useFranja";
import { FranjaLienzo } from "@/components/tracking/FranjaLienzo";
import { FranjaPanel } from "@/components/tracking/FranjaPanel";

type Roi = Zona;
const ROI_COMPLETA: Roi = ZONA_COMPLETA;

/**
 * Calibrador de una cámara interior.
 *
 * ## Sobre el video, no sobre fotos
 *
 * La versión anterior sacaba una foto cada 900 ms y **se la mandaba al lector** para poder
 * mostrarla: mirar la calle costaba una inferencia por segundo, en la misma GPU que tiene
 * que leer las matrículas — y el lector ya se cayó tres veces por trabajo concurrente.
 *
 * Ahora la escena es el flujo de go2rtc, el mismo que ya usan el mapa y el monitor.
 * Decodificar video es CPU; **la GPU sólo se toca cuando alguien pide leer**. Es el cambio
 * que más rinde de todo esto, y es el que no se ve.
 *
 * De paso arregla algo viejo: la línea y la zona están expresadas en fracciones del cuadro
 * ENTERO, así que con un recorte activo no se podían mostrar sin mentir. El vivo es
 * siempre el cuadro entero, así que ahora se ven siempre.
 *
 * ## Dónde va cada cosa
 *
 * Sobre la imagen, lo que se hace mirando: las herramientas, el estado de la lectura y el
 * menú del botón derecho. En la barra lateral, lo que se decide: qué dispara la lectura y
 * los tres reguladores. La barra es de cristal porque tiene la calle atrás y taparla del
 * todo sería perder justo lo que hay que mirar mientras se ajusta.
 */
/** Lo que dice el panel de ayuda de cada control. */
const AYUDA: Record<string, { titulo: string; detalle: string }> = {
    vivo: {
        titulo: "Ver en vivo",
        detalle: "Encadena capturas y las manda al lector, una por segundo aproximadamente. Es la forma de esperar a que pase un auto y ver en el momento si lo lee. Mientras está prendido consume GPU, así que conviene apagarlo al terminar.",
    },
    cuadro: {
        titulo: "Un cuadro",
        detalle: "Saca una sola foto del momento y la lee. La prueba rápida: sirve para confirmar que la cámara responde y que el recorte quedó donde querías.",
    },
    franja: {
        titulo: "Dónde estacionan",
        detalle: "Una franja dibujada sobre la calle, dividida en tantos lugares como autos entren. Mide si cada lugar está ocupado en vez de deducirlo de las lecturas de matrícula — que es lo que marcaba autos donde no había ninguno: una lectura dice que una chapa cruzó el cuadro, no que el vehículo esté quieto.",
    },
    zona: {
        titulo: "Zona de interés",
        detalle: "El recorte que el lector mira. Es el ajuste que más rinde, y por dos motivos a la vez: la matrícula le llega con más detalle, y ocupa una porción mayor de lo que el lector alcanza a ver. Dejá afuera la vereda, la pared y el cielo.",
    },
    linea: {
        titulo: "Línea de pasada",
        detalle: "La raya que el auto cruza al pasar. Con ella la cámara avisa en el instante exacto del cruce, así la lectura queda centrada en el paso. Además un auto estacionado dentro del encuadre deja de disparar, que es el problema de la zona.",
    },
    todo: {
        titulo: "Todo el cuadro",
        detalle: "Saca el recorte y vuelve a la imagen completa. Útil para redibujar la zona desde cero o para ver qué está quedando afuera.",
    },
    sentido: {
        titulo: "Sentido del cruce",
        detalle: "Si solo interesa una mano de la calle, la cámara ignora los vehículos que cruzan al revés. Con «los dos sentidos» avisa siempre.",
    },
    sensibilidad: {
        titulo: "Sensibilidad de escena",
        detalle: "Cuánto tiene que cambiar la imagen para que el servidor mande un cuadro al lector. Más bajo, más lecturas y más GPU; más alto, se puede perder un auto rápido. Solo se usa cuando el disparo lo decide el servidor.",
    },
    confianza: {
        titulo: "Confianza mínima",
        detalle: "Por debajo de esto la lectura se descarta. Subilo si aparecen matrículas inventadas; bajalo si ves que descarta lecturas que a ojo están bien.",
    },
    fps: {
        titulo: "Cuadros por segundo",
        detalle: "El ritmo al que se muestrea el video. Más alto junta más cuadros por ráfaga, y más cuadros es más probabilidad de agarrar la chapa de frente — a costa de más GPU. Con el disparo por cámara conviene alto, porque solo trabaja cuando pasa un auto.",
    },
    "modo-linea": {
        titulo: "Disparo al cruzar una línea",
        detalle: "La cámara avisa en el instante del cruce. Es lo mejor para una calle: la lectura queda centrada en el paso y un auto estacionado dentro del encuadre deja de disparar. Necesita una cámara con analítica propia.",
    },
    "modo-zona": {
        titulo: "Disparo al entrar en la zona",
        detalle: "La cámara avisa mientras haya un vehículo dentro del área marcada. Sirve para vigilar un sector entero, pero un auto quieto adentro vuelve a disparar con cada movimiento. Necesita una cámara con analítica propia.",
    },
    "modo-escena": {
        titulo: "Disparo por cambio de imagen",
        detalle: "Lo decide el servidor mirando si la imagen cambió. Funciona con cualquier cámara, incluso una que solo entregue RTSP y no tenga analítica. A cambio trabaja más y también se despierta con una sombra o una rama, así que pide una zona bien ajustada.",
    },
};


export function InteriorCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [leyendo, setLeyendo] = useState(false);
    const [lectura, setLectura] = useState<any>(null);

    const [escena, setEscena] = useState(0.08);
    const [confianza, setConfianza] = useState(0.6);
    const [fps, setFps] = useState(2);
    const [roi, setRoi] = useState<Roi>(ROI_COMPLETA);
    const [linea, setLinea] = useState<Linea | null>(null);
    const [herramienta, setHerramienta] = useState<"mirar" | "zona" | "linea" | "franja">("mirar");
    const [regla, setRegla] = useState<any>(null);
    const [modo, setModo] = useState<"escena" | "zona" | "linea">("escena");
    const [aplicando, setAplicando] = useState(false);

    /** La caja exacta del video. Sin bandas: el overlay usa estas medidas y nada más. */
    const [caja, setCaja] = useState<Caja>({ ancho: 0, alto: 0 });
    const lienzo = useRef<HTMLDivElement>(null);
    const arrastre = useRef<{ x: number; y: number } | null>(null);
    const tirando = useRef<null | "a" | "b">(null);

    // Desde el monitor de intrusión llega sin la URL (lleva la clave): `tieneRtsp` dice lo mismo.
    const franja = useFranja(device.id, !!(device.tieneRtsp ?? device.rtspUrl));
    /**
     * La línea que la cámara tiene puesta AHORA (la misma regla que usa intrusión). Antes este
     * calibrador mostraba sólo la línea guardada en OmniAccess, y una línea dibujada desde el
     * monitor de intrusión no aparecía acá: parecían dos calibradores con dos líneas (9/10).
     * Ahora la de la cámara manda: se muestra, se mueve y se borra desde acá.
     */
    const lineaOriginal = useRef<string | null>(null);

    // ── Calibración guardada ────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const r = await axios.get(`/api/tracking/calibration?deviceId=${device.id}`);
                setEscena(r.data.escena ?? 0.08);
                setConfianza(r.data.confianza ?? 0.6);
                setFps(r.data.fps ?? 2);
                setRoi(r.data.roi || ROI_COMPLETA);
                // Si ya llegó la línea de la cámara, manda ésa (es la que está vigilando).
                if (r.data.linea && !lineaOriginal.current) setLinea(r.data.linea);
                if (r.data.modo) setModo(r.data.modo);
            } catch {
                toast.error({ title: "No se pudo leer la calibración" });
            } finally { setCargando(false); }
        })();
    }, [device.id]);

    useEffect(() => {
        let vivo = true;
        axios.get(`/api/tracking/camera-rule?deviceId=${device.id}`)
            .then((r) => {
                if (!vivo) return;
                setRegla(r.data);
                if (r.data?.lineaActiva && r.data?.lineaCamara) {
                    setLinea(r.data.lineaCamara);
                    lineaOriginal.current = JSON.stringify(r.data.lineaCamara);
                }
            })
            .catch(() => { if (vivo) setRegla({ soportada: false }); });
        return () => { vivo = false; };
    }, [device.id]);

    /**
     * Leer ahora: UNA captura, UNA inferencia.
     *
     * Es el único lugar de esta pantalla que toca la GPU, y lo hace cuando una persona lo
     * pide. Antes esto corría solo, una vez por segundo, mientras el modal estuviera
     * abierto.
     */
    const leer = useCallback(async () => {
        setLeyendo(true);
        try {
            const r = await axios.post("/api/tracking/frame", { deviceId: device.id, leer: true, roi });
            setLectura(r.data);
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo leer" });
        } finally { setLeyendo(false); }
    }, [device.id, roi]);

    // ── Dibujo, en fracciones de la caja del video ──────────────
    const aRelativo = (e: React.MouseEvent) => {
        const c = lienzo.current!.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (e.clientX - c.left) / c.width)),
            y: Math.max(0, Math.min(1, (e.clientY - c.top) / c.height)),
        };
    };
    const dibuja = herramienta === "zona" || herramienta === "linea";
    const alBajar = (e: React.MouseEvent) => {
        if (!dibuja || e.button !== 0) return;
        e.preventDefault();
        const p = aRelativo(e);
        arrastre.current = p;
        if (herramienta === "linea") {
            // Si el clic cae sobre un extremo se corrige ESE extremo: trazar la línea
            // entera de nuevo para mover una punta es molesto y se hace seguido.
            const cerca = (x: number, y: number) =>
                Math.hypot((x - p.x) * (caja.ancho || 1), (y - p.y) * (caja.alto || 1)) < 14;
            if (linea && cerca(linea.x1, linea.y1)) { tirando.current = "a"; return; }
            if (linea && cerca(linea.x2, linea.y2)) { tirando.current = "b"; return; }
            tirando.current = null;
            setLinea((l) => ({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, sentido: l?.sentido || "any" }));
        } else setRoi({ ...p, w: 0, h: 0 });
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
        setRoi({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
    };
    const alSoltar = () => {
        if (!arrastre.current) return;
        arrastre.current = null;
        const movia = tirando.current;
        tirando.current = null;
        // Una raya de dos píxeles no es una línea; corregir una punta no la borra.
        if (herramienta === "linea" && !movia) {
            setLinea((l) => (l && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.08 ? l : null));
        } else if (herramienta === "zona") {
            setRoi((r) => (r.w < 0.05 || r.h < 0.05 ? ROI_COMPLETA : r));
        }
    };

    const guardar = async () => {
        setGuardando(true);
        try {
            await axios.put("/api/tracking/calibration", { deviceId: device.id, escena, confianza, fps, roi, linea });
            if (modo !== "escena") {
                await axios.post("/api/tracking/camera-rule", { deviceId: device.id, modo, linea: modo === "linea" ? linea : undefined });
            }
            // La línea que la cámara ya tenía (la de intrusión): borrada acá → se apaga en la
            // cámara; movida acá → se mueve en la cámara, sin cambiar su objetivo.
            if (lineaEnCamara && modo !== "linea") {
                if (!linea) await axios.post("/api/tracking/camera-rule", { deviceId: device.id, lineaCamara: "quitar" });
                else if (JSON.stringify(linea) !== lineaOriginal.current) await axios.post("/api/tracking/camera-rule", { deviceId: device.id, lineaCamara: "poner", linea });
            }
            toast.success({
                title: "Calibración guardada",
                description: lineaEnCamara && !linea ? "La línea se quitó de la cámara." : modo === "escena" ? "La pasarela la toma en menos de un minuto." : "Aplicada también en la cámara.",
            });
            onClose();
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo guardar" });
        } finally { setGuardando(false); }
    };

    const cambiarModo = async (m: "escena" | "zona" | "linea") => {
        setAplicando(true);
        try {
            await axios.post("/api/tracking/camera-rule", { deviceId: device.id, modo: m, linea: m === "linea" ? linea : undefined });
            setModo(m);
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "La cámara no aceptó el cambio" });
        } finally { setAplicando(false); }
    };

    const lineaEnCamara = !!regla?.lineaActiva;
    const mejor = lectura?.lecturas?.[0];
    const pasa = mejor ? mejor.confidence >= confianza : false;
    const zonaCompleta = roi.x < 0.01 && roi.y < 0.01 && roi.w > 0.99 && roi.h > 0.99;

    const MODOS = useMemo(() => [
        { id: "linea" as const, ic: Minus, txt: "Al cruzar una línea", puede: regla?.soportaLinea, listo: !!linea, falta: "dibujá la línea" },
        { id: "zona" as const, ic: SquareDashed, txt: "Al entrar en la zona", puede: regla?.soportaZona, listo: !zonaCompleta, falta: "marcá la zona" },
        { id: "escena" as const, ic: Gauge, txt: "Por cambio de imagen", puede: true, listo: true, falta: "" },
    ], [regla, linea, zonaCompleta]);

    const sentidoTexto = linea?.sentido === "left-right" ? "izq → der"
        : linea?.sentido === "right-left" ? "der → izq" : "los dos sentidos";

    const items = [
        { clave: "leer", rotulo: "Leer ahora", nota: "una captura, una inferencia", Icono: GlifoLeer, alElegir: leer, apagado: leyendo },
        { clave: "linea", rotulo: "Dibujar la línea de pasada", nota: linea ? "ya está puesta" : "sin marcar", Icono: GlifoLinea, alElegir: () => setHerramienta("linea") },
        { clave: "zona", rotulo: "Dibujar la zona de interés", nota: zonaCompleta ? "todo el cuadro" : `${Math.round(roi.w * 100)}×${Math.round(roi.h * 100)}%`, Icono: GlifoZona, alElegir: () => setHerramienta("zona") },
        { clave: "franja", rotulo: "Dibujar dónde estacionan", nota: franja.existe ? `${franja.lugares} lugares` : "sin dibujar", Icono: GlifoFranja, alElegir: () => setHerramienta("franja") },
        { clave: "todo", rotulo: "Volver a todo el cuadro", nota: "saca el recorte", Icono: GlifoTodo, alElegir: () => setRoi(ROI_COMPLETA), apagado: zonaCompleta },
        {
            clave: "sentido", rotulo: "Cambiar el sentido del cruce", nota: sentidoTexto, Icono: GlifoSentido,
            apagado: !linea,
            alElegir: () => setLinea((l) => l && ({ ...l, sentido: l.sentido === "any" ? "left-right" : l.sentido === "left-right" ? "right-left" : "any" })),
        },
    ];

    return (
        <div className="fixed inset-0 z-[var(--capa-panel)] bg-background flex flex-col md:flex-row animate-in fade-in duration-200">

            {/* ── La escena ── */}
            <MenuEscena items={items}>
                <div className="relative flex-1 min-h-0 p-3 md:p-4">
                    <EscenaViva deviceId={device.id} alMedir={setCaja}>
                        <div
                            ref={lienzo}
                            onMouseDown={alBajar} onMouseMove={alMover} onMouseUp={alSoltar} onMouseLeave={alSoltar}
                            className={cn("absolute inset-0 rounded-[10px] overflow-hidden", dibuja && "cursor-crosshair")}
                        >
                            {!zonaCompleta && (herramienta === "zona" || herramienta === "mirar") && (
                                <div className="absolute pointer-events-none transition-opacity"
                                    style={{
                                        left: `${roi.x * 100}%`, top: `${roi.y * 100}%`,
                                        width: `${roi.w * 100}%`, height: `${roi.h * 100}%`,
                                        border: "2px solid var(--accion-en-oscuro)",
                                        background: "color-mix(in oklab, var(--accion-en-oscuro) 12%, transparent)",
                                        opacity: herramienta === "zona" ? 1 : 0.55,
                                    }} />
                            )}

                            {/* La línea ya se puede mostrar SIEMPRE: el vivo es el cuadro entero,
                                así que sus fracciones caen donde corresponde. Con el recorte
                                activo, antes, habría caído en otro lado. */}
                            {linea && caja.ancho > 0 && herramienta !== "franja" && (
                                <div className={cn("transition-opacity", herramienta === "linea" ? "opacity-100" : "opacity-60")}>
                                    <LineaDePasada linea={linea} w={caja.ancho} h={caja.alto} />
                                </div>
                            )}
                        </div>

                        {herramienta === "franja" && (
                            <FranjaLienzo franja={franja} encuadre={{ left: 0, top: 0, w: caja.ancho, h: caja.alto }} />
                        )}
                    </EscenaViva>

                    {/* ── Herramientas, flotando ── */}
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[var(--capa-flotante)]">
                        <IconBar
                            superficie="imagen"
                            items={[
                                { key: "mirar", label: "Sólo mirar", Icon: Crosshair },
                                { key: "zona", label: `Zona · ${zonaCompleta ? "todo el cuadro" : `${Math.round(roi.w * 100)}×${Math.round(roi.h * 100)}%`}`, Icon: SquareDashed },
                                { key: "linea", label: `Línea · ${linea ? (lineaEnCamara ? "en la cámara" : "puesta") : lineaEnCamara ? "se quita al guardar" : "sin marcar"}`, Icon: Minus },
                                { key: "franja", label: `Estacionamiento · ${franja.existe ? `${franja.lugares} lugares` : "sin dibujar"}`, Icon: ParkingSquare },
                            ]}
                            value={herramienta}
                            onChange={(k) => setHerramienta(k as any)}
                            acciones={[
                                { key: "leer", label: leyendo ? "Leyendo…" : "Leer ahora", Icon: ScanLine, off: leyendo, onClick: leer },
                                { key: "todo", label: "Volver a todo el cuadro", Icon: RotateCcw, off: zonaCompleta, onClick: () => setRoi(ROI_COMPLETA) },
                            ]}
                        />
                    </div>

                    {/* ── Lo que hay que hacer, mientras se dibuja ── */}
                    <AnimatePresence>
                        {herramienta !== "mirar" && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.18 }}
                                className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[var(--capa-flotante)]
                                    flex items-center gap-3 px-3.5 py-2 rounded-[10px] cristal-menu text-[12.5px]">
                                <span className="font-medium">
                                    {herramienta === "linea" ? "Arrastrá la línea por donde cruzan los autos"
                                        : herramienta === "zona" ? "Arrastrá el rectángulo sobre la calzada"
                                            : "Movés las cuatro esquinas sobre el cordón donde estacionan"}
                                </span>
                                {herramienta === "linea" && linea && (
                                    <button onClick={() => setLinea(null)}
                                        className="opacity-60 hover:opacity-100 flex items-center gap-1 transition-opacity">
                                        <Trash2 size={13} /> {lineaEnCamara ? "borrar (se quita de la cámara al guardar)" : "borrar"}
                                    </button>
                                )}
                                <button onClick={() => setHerramienta("mirar")}
                                    className="opacity-60 hover:opacity-100 transition-opacity">listo</button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* ── La lectura, cuando se pidió ── */}
                    <AnimatePresence>
                        {lectura && herramienta === "mirar" && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                className="absolute bottom-6 left-6 z-[var(--capa-flotante)] px-3.5 py-2.5 rounded-[10px] cristal-menu max-w-md">
                                {mejor ? (
                                    <div className="flex items-center gap-2 text-[12.5px]">
                                        <span className={pasa ? "tono-bien" : "tono-aviso"}>
                                            {pasa ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                                        </span>
                                        <span className="font-semibold tracking-widest tabular-nums">{mejor.plate}</span>
                                        <span className="tabular-nums opacity-70">{Math.round(mejor.confidence * 100)}%</span>
                                        <span className="opacity-60">{pasa ? "se registraría" : "por debajo del mínimo"}</span>
                                    </div>
                                ) : (
                                    <p className="text-[12.5px] opacity-75">
                                        {lectura.errorLpr || "Ninguna matrícula en ese cuadro. Si no pasaba ningún auto es normal."}
                                    </p>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </MenuEscena>

            {/* ── La barra lateral, de cristal ── */}
            <aside className="w-full md:w-[340px] shrink-0 border-t md:border-t-0 md:border-l cristal flex flex-col min-h-0">
                <header className="shrink-0 flex items-center gap-3 px-4 h-14">
                    <span className="size-8 rounded-[6px] bg-muted grid place-items-center text-muted-foreground">
                        <ScanLine size={15} />
                    </span>
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate">{device.name}</div>
                        <div className="text-[11px] text-muted-foreground">Cámara interior · lee Omni-LPR</div>
                    </div>
                    <button onClick={onClose}
                        className="size-8 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-accent grid place-items-center transition-colors">
                        <X size={16} />
                    </button>
                </header>

                <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-5">
                    <AnimatePresence mode="wait">
                        {herramienta === "franja" ? (
                            <motion.div key="franja"
                                initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                                transition={{ duration: 0.18 }}>
                                <Rotulo icono={ParkingSquare}>Dónde estacionan</Rotulo>
                                <FranjaPanel franja={franja} compacto />
                            </motion.div>
                        ) : (
                            <motion.div key="ajustes"
                                initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                                transition={{ duration: 0.18 }}
                                className="space-y-5">

                                <section>
                                    <Rotulo icono={Gauge}>Qué dispara la lectura</Rotulo>
                                    <div className="relative flex flex-col gap-0.5">
                                        {MODOS.map((o) => {
                                            const bloqueado = !o.puede || (!o.listo && o.id !== "escena") || aplicando;
                                            const activo = modo === o.id;
                                            return (
                                                <button key={o.id} type="button" disabled={bloqueado}
                                                    onClick={() => cambiarModo(o.id)}
                                                    className={cn("relative h-10 px-3 rounded-[6px] flex items-center gap-2.5 text-left text-[12.5px] transition-colors",
                                                        !activo && !bloqueado && "hover:bg-accent",
                                                        bloqueado && !activo && "opacity-40 cursor-not-allowed")}>
                                                    {/* El indicador se MUEVE entre opciones en vez de aparecer y
                                                        desaparecer: así se ve de dónde a dónde fue el cambio, que es
                                                        justamente lo que no se entendía antes. */}
                                                    {activo && (
                                                        <motion.span layoutId="modo-activo"
                                                            transition={{ type: "spring", stiffness: 520, damping: 38 }}
                                                            className="absolute inset-0 rounded-[6px]"
                                                            style={{ background: "var(--accion)" }} />
                                                    )}
                                                    <o.ic size={14} className={cn("relative z-10", activo && "text-[var(--accion-texto)]")} />
                                                    <span className={cn("relative z-10 flex-1 font-medium", activo && "text-[var(--accion-texto)]")}>
                                                        {o.txt}
                                                    </span>
                                                    {!o.puede && <span className="relative z-10 text-[11px] opacity-70">no la soporta</span>}
                                                    {o.puede && !o.listo && o.id !== "escena" && (
                                                        <span className="relative z-10 text-[11px] opacity-70">{o.falta}</span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* La explicación del modo elegido crece y se achica con el alto real,
                                        no con un salto: es lo que hace que se lea como el mismo bloque
                                        cambiando y no como dos carteles distintos. */}
                                    <AnimatePresence mode="wait" initial={false}>
                                        <motion.div key={modo}
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                                            className="overflow-hidden">
                                            <p className="text-[12px] text-muted-foreground leading-relaxed pt-2.5">
                                                {AYUDA[`modo-${modo}`]?.detalle}
                                            </p>
                                        </motion.div>
                                    </AnimatePresence>

                                    {modo === "linea" && linea && (
                                        <button
                                            onClick={() => setLinea((l) => l && ({ ...l, sentido: l.sentido === "any" ? "left-right" : l.sentido === "left-right" ? "right-left" : "any" }))}
                                            className="mt-2 h-8 px-2.5 rounded-[6px] hover:bg-accent text-[12px] flex items-center gap-1.5 text-muted-foreground transition-colors">
                                            <ArrowLeftRight size={13} /> {sentidoTexto}
                                        </button>
                                    )}
                                </section>

                                <section>
                                    <Rotulo icono={Timer}>Ajustes</Rotulo>
                                    <div className="space-y-1">
                                        <Mando icono={Gauge} titulo="Sensibilidad" ayuda={AYUDA.sensibilidad.detalle}
                                            valor={escena.toFixed(2)} min={0.02} max={0.3} paso={0.01} v={escena} set={setEscena}
                                            apagado={modo !== "escena"} />
                                        <Mando icono={ScanLine} titulo="Confianza mínima" ayuda={AYUDA.confianza.detalle}
                                            valor={`${Math.round(confianza * 100)}%`} min={0.2} max={0.95} paso={0.05} v={confianza} set={setConfianza} />
                                        <Mando icono={Timer} titulo="Cuadros por segundo" ayuda={AYUDA.fps.detalle}
                                            valor={String(fps)} min={0.5} max={10} paso={0.5} v={fps} set={setFps} />
                                    </div>
                                </section>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Botón derecho sobre la imagen para el resto.
                    </p>
                </div>

                <footer className="shrink-0 px-4 py-3">
                    <Button onClick={guardar} disabled={guardando || cargando} className="w-full accion">
                        {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar calibración
                    </Button>
                </footer>
            </aside>
        </div>
    );
}

/** El rótulo de un bloque. Mayúsculas espaciadas, que es el único lugar donde van. */
function Rotulo({ icono: Ic, children }: { icono: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
    return (
        <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5 mb-2">
            <Ic size={11} /> {children}
        </h3>
    );
}

/**
 * Regulador con su explicación adentro.
 *
 * La ayuda vive donde está el control y se abre al pasar el mouse, en vez de en un panel
 * aparte que antes saltaba sobre la escena y tapaba justo lo que se iba a dibujar.
 */
function Mando({ icono: Ic, titulo, ayuda, valor, min, max, paso, v, set, apagado }: {
    icono: React.ComponentType<{ size?: number }>; titulo: string; ayuda: string; valor: string;
    min: number; max: number; paso: number; v: number; set: (n: number) => void; apagado?: boolean;
}) {
    const [abierto, setAbierto] = useState(false);
    return (
        <div
            onMouseEnter={() => setAbierto(true)}
            onMouseLeave={() => setAbierto(false)}
            className={cn("rounded-[6px] px-2.5 py-2 transition-colors hover:bg-accent", apagado && "opacity-45")}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] text-muted-foreground flex items-center gap-1.5 truncate">
                    <Ic size={12} /> {titulo}
                </span>
                <span className="text-[12.5px] font-semibold tabular-nums">{valor}</span>
            </div>
            <input type="range" min={min} max={max} step={paso} value={v}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full mt-2 h-1 cursor-pointer accent-[var(--accion)]" />
            <AnimatePresence initial={false}>
                {abierto && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden">
                        <p className="text-[11.5px] text-muted-foreground leading-relaxed pt-2">{ayuda}</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
