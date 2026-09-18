"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { sileo as toast } from "sileo";
import {
    X, Loader2, Play, Pause, Save, RotateCcw, SquareDashed, Crosshair,
    CheckCircle2, XCircle, Gauge, Timer, ScanLine, Minus, ArrowLeftRight, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Roi = { x: number; y: number; w: number; h: number };
type Linea = { x1: number; y1: number; x2: number; y2: number; sentido: string };
const ROI_COMPLETA: Roi = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Calibrador de una cámara interior.
 *
 * Mismo formato que el calibrador de las cámaras LPR a propósito: alto fijo, el cuadro
 * ocupando todo lo que puede, los controles en un riel abajo y la explicación de cada
 * uno en un panel flotante al pasar el mouse. Nada de scroll adentro del modal: la
 * documentación no ocupa lugar hasta que se la pide.
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
    const [tomando, setTomando] = useState(false);
    const [auto, setAuto] = useState(false);
    const [cuadro, setCuadro] = useState<any>(null);

    const [escena, setEscena] = useState(0.08);
    const [confianza, setConfianza] = useState(0.6);
    const [fps, setFps] = useState(2);
    const [roi, setRoi] = useState<Roi>(ROI_COMPLETA);
    const [linea, setLinea] = useState<Linea | null>(null);
    const [dibujando, setDibujando] = useState<null | "zona" | "linea">(null);
    const [regla, setRegla] = useState<any>(null);
    const [modo, setModo] = useState<"escena" | "zona" | "linea">("escena");
    const [aplicando, setAplicando] = useState(false);
    const [sobre, setSobre] = useState<string | null>(null);

    const lienzo = useRef<HTMLDivElement>(null);
    const arrastre = useRef<{ x: number; y: number } | null>(null);
    const tirando = useRef<null | "a" | "b">(null);
    const autoRef = useRef(false);

    // El tamaño real del lienzo. Dibujar la línea en fracciones sobre un SVG estirado
    // deformaba todo: los extremos salían elipses y una flecha perpendicular no habría
    // quedado perpendicular. Con las medidas se dibuja en píxeles y la geometría cierra.
    const [tam, setTam] = useState({ w: 0, h: 0 });
    useEffect(() => {
        const el = lienzo.current;
        if (!el) return;
        const medir = () => setTam({ w: el.clientWidth, h: el.clientHeight });
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // ── Calibración guardada ────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const r = await axios.get(`/api/tracking/calibration?deviceId=${device.id}`);
                setEscena(r.data.escena ?? 0.08);
                setConfianza(r.data.confianza ?? 0.6);
                setFps(r.data.fps ?? 2);
                setRoi(r.data.roi || ROI_COMPLETA);
                if (r.data.linea) setLinea(r.data.linea);
                if (r.data.modo) setModo(r.data.modo);
            } catch {
                toast.error({ title: "No se pudo leer la calibración" });
            } finally { setCargando(false); }
        })();
    }, [device.id]);

    // ── Qué analítica soporta esta cámara ───────────────────────
    useEffect(() => {
        let vivo = true;
        axios.get(`/api/tracking/camera-rule?deviceId=${device.id}`)
            .then((r) => { if (vivo) setRegla(r.data); })
            .catch(() => { if (vivo) setRegla({ soportada: false }); });
        return () => { vivo = false; };
    }, [device.id]);

    // ── Cuadro, con o sin lectura ───────────────────────────────
    const tomar = useCallback(async (leer = true, conRecorte = true) => {
        setTomando(true);
        try {
            const r = await axios.post("/api/tracking/frame", { deviceId: device.id, leer, roi: conRecorte ? roi : null });
            setCuadro(r.data);
        } catch (e: any) {
            setCuadro(null);
            toast.error({ title: e?.response?.data?.error || "No se pudo tomar el cuadro" });
            autoRef.current = false; setAuto(false);
        } finally { setTomando(false); }
    }, [device.id, roi]);

    useEffect(() => { tomar(true, true); // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [device.id]);

    useEffect(() => {
        autoRef.current = auto;
        if (!auto) return;
        let vivo = true;
        (async () => {
            while (vivo && autoRef.current) {
                await tomar(true, true);
                await new Promise((r) => setTimeout(r, 900));
            }
        })();
        return () => { vivo = false; };
    }, [auto, tomar]);

    // ── Dibujo ──────────────────────────────────────────────────
    const aRelativo = (e: React.MouseEvent) => {
        const c = lienzo.current!.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (e.clientX - c.left) / c.width)),
            y: Math.max(0, Math.min(1, (e.clientY - c.top) / c.height)),
        };
    };
    const alBajar = (e: React.MouseEvent) => {
        if (!dibujando) return;
        e.preventDefault();
        const p = aRelativo(e);
        arrastre.current = p;
        if (dibujando === "linea") {
            // Si el clic cae sobre un extremo, se corrige ESE extremo en vez de empezar
            // una línea nueva. Trazarla entera de nuevo para mover una punta es molesto.
            const cerca = (x: number, y: number) =>
                Math.hypot((x - p.x) * (tam.w || 1), (y - p.y) * (tam.h || 1)) < 14;
            if (linea && cerca(linea.x1, linea.y1)) { tirando.current = "a"; return; }
            if (linea && cerca(linea.x2, linea.y2)) { tirando.current = "b"; return; }
            tirando.current = null;
            setLinea((l) => ({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, sentido: l?.sentido || "any" }));
        } else setRoi({ ...p, w: 0, h: 0 });
    };
    const alMover = (e: React.MouseEvent) => {
        if (!arrastre.current || !dibujando) return;
        const p = aRelativo(e);
        const a = arrastre.current;
        if (dibujando === "linea") {
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
        if (dibujando === "linea") {
            // Una raya de dos píxeles no es una línea; corregir una punta no la borra.
            if (!movia) setLinea((l) => (l && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.08 ? l : null));
        } else if (dibujando === "zona") {
            setRoi((r) => (r.w < 0.05 || r.h < 0.05 ? ROI_COMPLETA : r));
        }
    };

    /**
     * Guardar hace las dos cosas que uno espera: deja la calibración en la base y, si el
     * disparo lo pone la cámara, le vuelve a escribir la regla.
     */
    const guardar = async () => {
        setGuardando(true);
        try {
            await axios.put("/api/tracking/calibration", { deviceId: device.id, escena, confianza, fps, roi, linea });
            if (modo !== "escena") {
                await axios.post("/api/tracking/camera-rule", { deviceId: device.id, modo, linea: modo === "linea" ? linea : undefined });
            }
            toast.success({
                title: "Calibración guardada",
                description: modo === "escena" ? "La pasarela la toma en menos de un minuto." : "Aplicada también en la cámara.",
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
            toast.success({ title: m === "escena" ? "Decide el servidor, por cambio de imagen" : m === "linea" ? "La cámara avisa al cruzar la línea" : "La cámara avisa al entrar en la zona" });
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "La cámara no aceptó el cambio" });
        } finally { setAplicando(false); }
    };

    const mejor = cuadro?.lecturas?.[0];
    const pasa = mejor ? mejor.confidence >= confianza : false;
    const zonaCompleta = roi.x < 0.01 && roi.y < 0.01 && roi.w > 0.99 && roi.h > 0.99;

    /** Valor actual que muestra el panel de ayuda, para no tener que buscarlo en el riel. */
    const ACTUAL: Record<string, string> = {
        vivo: auto ? "encendido" : "apagado",
        zona: zonaCompleta ? "todo el cuadro" : `${Math.round(roi.w * 100)} × ${Math.round(roi.h * 100)}% del cuadro`,
        linea: linea ? "marcada" : "sin marcar",
        sentido: linea?.sentido === "left-right" ? "izquierda a derecha" : linea?.sentido === "right-left" ? "derecha a izquierda" : "los dos sentidos",
        sensibilidad: escena.toFixed(2),
        confianza: `${Math.round(confianza * 100)}%`,
        fps: `${fps} por segundo`,
        "modo-linea": modo === "linea" ? "en uso" : regla?.soportaLinea === false ? "no disponible en esta cámara" : "disponible",
        "modo-zona": modo === "zona" ? "en uso" : regla?.soportaZona === false ? "no disponible en esta cámara" : "disponible",
        "modo-escena": modo === "escena" ? "en uso" : "disponible",
    };

    const ayuda = sobre ? AYUDA[sobre] : null;
    const sobreProps = (k: string) => ({
        onMouseEnter: () => setSobre(k),
        onMouseLeave: () => setSobre((s) => (s === k ? null : s)),
    });

    const MODOS = [
        { id: "linea" as const, ic: Minus, txt: "Al cruzar una línea", puede: regla?.soportaLinea, listo: !!linea, falta: "dibujá la línea" },
        { id: "zona" as const, ic: SquareDashed, txt: "Al entrar en la zona", puede: regla?.soportaZona, listo: !zonaCompleta, falta: "marcá la zona" },
        { id: "escena" as const, ic: Gauge, txt: "Por cambio de imagen", puede: true, listo: true, falta: "" },
    ];

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/95 backdrop-blur-sm p-3 md:p-6 animate-in fade-in duration-200">
            <div className="relative w-full max-w-6xl h-[88vh] rounded-2xl overflow-hidden shadow-2xl bg-[#0b0d11] border border-white/10 flex flex-col">

                {/* ── Encabezado ── */}
                <div className="shrink-0 flex items-center gap-3 px-5 h-14 border-b border-white/[0.07]">
                    <div className="p-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20"><ScanLine size={15} className="text-teal-400" /></div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white truncate">Calibrar {device.name}</div>
                        <div className="text-[10px] text-white/40">Cámara interior · lectura por Omni-LPR</div>
                    </div>
                    {cuadro && (
                        <span className="hidden md:block text-[10px] text-white/35 tabular-nums mr-1">
                            {Math.round(cuadro.bytes / 1024)} KB · captura {cuadro.msCaptura} ms · lectura {cuadro.msLectura} ms
                        </span>
                    )}
                    <button onClick={guardar} disabled={guardando || cargando}
                        className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                        {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
                    </button>
                    <button onClick={onClose} className="w-9 h-9 rounded-xl text-white/50 hover:text-white hover:bg-white/[0.08] flex items-center justify-center"><X size={16} /></button>
                </div>

                {/* ── Cuadro ── */}
                <div className="relative flex-1 min-h-0 bg-black">
                    <div ref={lienzo}
                        onMouseDown={alBajar} onMouseMove={alMover} onMouseUp={alSoltar} onMouseLeave={alSoltar}
                        className={cn("absolute inset-0", dibujando && "cursor-crosshair")}>

                        {cuadro?.imagen ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={cuadro.imagen} alt="" className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" draggable={false} />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-white/30 text-xs">
                                {tomando ? "Tomando el cuadro…" : cargando ? "Leyendo la calibración…" : "Sin imagen"}
                            </div>
                        )}

                        {dibujando === "zona" && !zonaCompleta && (
                            <div className="absolute border-2 border-amber-400 bg-amber-400/10 pointer-events-none"
                                style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }} />
                        )}

                        {/* La línea se dibuja sobre el cuadro ENTERO. Con una zona marcada lo que se
                            ve es el recorte, y la misma línea caería en otro lugar: por eso solo se
                            muestra mientras se la edita, que es cuando la imagen es la completa. */}
                        {linea && dibujando === "linea" && tam.w > 0 && (
                            <LineaDePasada linea={linea} w={tam.w} h={tam.h} />
                        )}
                    </div>

                    {/* Panel de ayuda del control que el mouse está tocando */}
                    <AnimatePresence>
                        {ayuda && (
                            <motion.div
                                initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }}
                                transition={{ type: "spring", stiffness: 320, damping: 26 }}
                                className="absolute left-3 bottom-3 w-[320px] rounded-xl bg-white/[0.07] backdrop-blur-2xl border border-white/10 p-4 shadow-2xl pointer-events-none z-20">
                                <p className="text-white font-bold text-sm">{ayuda.titulo}</p>
                                {ACTUAL[sobre!] && <p className="text-[11px] text-white/60 font-mono mb-2">actual: {ACTUAL[sobre!]}</p>}
                                <p className="text-[12px] text-white/80 leading-relaxed">{ayuda.detalle}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {dibujando && (
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-1.5 rounded-xl bg-black/80 border border-white/10 backdrop-blur z-20">
                            <span className="text-[11px] font-bold text-white/85">
                                {dibujando === "linea" ? "Arrastrá la línea por donde cruzan los autos" : "Arrastrá el rectángulo sobre la calzada"}
                            </span>
                            {dibujando === "linea" && linea && (
                                <button onClick={() => setLinea(null)} className="text-[11px] text-white/50 hover:text-white flex items-center gap-1"><Trash2 size={12} /> borrar</button>
                            )}
                            <button onClick={() => { setDibujando(null); tomar(true, true); }}
                                className="h-7 px-3 rounded-lg bg-white text-black text-[11px] font-bold">Listo</button>
                        </div>
                    )}

                    {mejor && !dibujando && !ayuda && (
                        <div className={cn("absolute bottom-3 left-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold backdrop-blur",
                            pasa ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300")}>
                            {pasa ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            <span className="font-mono tracking-widest">{mejor.plate}</span>
                            <span className="opacity-70">{Math.round(mejor.confidence * 100)}%</span>
                            <span className="opacity-60 font-medium">{pasa ? "se registraría" : "por debajo del mínimo"}</span>
                        </div>
                    )}
                    {cuadro && !cuadro.errorLpr && !mejor && !dibujando && !ayuda && (
                        <div className="absolute bottom-3 left-3 px-3 py-2 rounded-xl bg-black/70 text-[11px] text-white/55 backdrop-blur max-w-md">
                            Ninguna matrícula en este cuadro. Si no pasaba ningún auto es normal: poné <b className="text-white/75">Ver en vivo</b> y esperá a que pase uno.
                        </div>
                    )}
                    {cuadro?.errorLpr && !dibujando && !ayuda && (
                        <div className="absolute bottom-3 left-3 px-3 py-2 rounded-xl bg-red-500/20 text-[11px] text-red-300 backdrop-blur">{cuadro.errorLpr}</div>
                    )}
                    {tomando && (
                        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/70 text-[10px] text-white/70">
                            <Loader2 size={10} className="animate-spin" /> capturando
                        </div>
                    )}
                </div>

                {/* ── Riel de controles ── */}
                <div className="shrink-0 border-t border-white/[0.07] bg-[#0e1116] px-4 py-3 space-y-3">

                    <div className="flex flex-wrap items-center gap-2">
                        <button {...sobreProps("vivo")} onClick={() => setAuto((a) => !a)} disabled={!!dibujando}
                            className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40",
                                auto ? "bg-amber-500 text-black" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                            {auto ? <Pause size={14} /> : <Play size={14} />} {auto ? "Detener" : "Ver en vivo"}
                        </button>
                        <button {...sobreProps("cuadro")} onClick={() => tomar(true, true)} disabled={tomando || auto || !!dibujando}
                            className="h-9 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-white/80 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
                            <Crosshair size={14} /> Un cuadro
                        </button>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        <button {...sobreProps("zona")} onClick={() => { setDibujando("zona"); setAuto(false); tomar(false, false); }}
                            className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                                dibujando === "zona" ? "bg-amber-500 text-black" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                            <SquareDashed size={14} /> Zona
                            <span className="text-[10px] font-medium opacity-60">{zonaCompleta ? "completa" : `${Math.round(roi.w * 100)}×${Math.round(roi.h * 100)}%`}</span>
                        </button>
                        <button {...sobreProps("linea")} onClick={() => { setDibujando("linea"); setAuto(false); tomar(false, false); }}
                            className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                                dibujando === "linea" ? "bg-rose-500 text-white" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                            <Minus size={14} /> Línea
                            <span className="text-[10px] font-medium opacity-60">{linea ? "puesta" : "sin marcar"}</span>
                        </button>
                        {!zonaCompleta && (
                            <button {...sobreProps("todo")} onClick={() => { setRoi(ROI_COMPLETA); tomar(true, false); }}
                                className="h-9 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/50 text-[11px] font-bold flex items-center gap-1.5">
                                <RotateCcw size={13} /> todo el cuadro
                            </button>
                        )}
                        {modo === "linea" && linea && (
                            <button {...sobreProps("sentido")}
                                onClick={() => setLinea((l) => l && ({ ...l, sentido: l.sentido === "any" ? "left-right" : l.sentido === "left-right" ? "right-left" : "any" }))}
                                className="h-9 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/60 text-[11px] font-bold flex items-center gap-1.5">
                                <ArrowLeftRight size={13} />
                                {linea.sentido === "any" ? "los dos sentidos" : linea.sentido === "left-right" ? "izq → der" : "der → izq"}
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 items-end">
                        <div className="grid grid-cols-3 gap-3">
                            <Mando clave="sensibilidad" sobreProps={sobreProps} icono={Gauge} titulo="Sensibilidad" valor={escena.toFixed(2)}
                                min={0.02} max={0.3} paso={0.01} v={escena} set={setEscena} apagado={modo !== "escena"} />
                            <Mando clave="confianza" sobreProps={sobreProps} icono={ScanLine} titulo="Confianza mínima" valor={`${Math.round(confianza * 100)}%`}
                                min={0.2} max={0.95} paso={0.05} v={confianza} set={setConfianza} />
                            <Mando clave="fps" sobreProps={sobreProps} icono={Timer} titulo="Cuadros por segundo" valor={String(fps)}
                                min={0.5} max={10} paso={0.5} v={fps} set={setFps} />
                        </div>

                        <div className="flex items-center gap-1 bg-white/[0.04] rounded-xl p-1 border border-white/[0.06]">
                            {MODOS.map((o) => {
                                const bloqueado = !o.puede || (!o.listo && o.id !== "escena") || aplicando;
                                const activo = modo === o.id;
                                return (
                                    <button key={o.id} {...sobreProps(`modo-${o.id}`)} type="button" disabled={bloqueado} onClick={() => cambiarModo(o.id)}
                                        className={cn("h-9 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap",
                                            activo ? "bg-emerald-600 text-white" : "text-white/60 hover:text-white hover:bg-white/[0.06]",
                                            bloqueado && !activo && "opacity-35 cursor-not-allowed")}>
                                        <o.ic size={12} /> {o.txt}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * La línea de pasada dibujada sobre el cuadro.
 *
 * Se dibuja en píxeles del lienzo, no en fracciones sobre un SVG estirado: si no, los
 * extremos salen elipses y la flecha del sentido no queda perpendicular a la raya.
 *
 * Lo que se ve: un resplandor por debajo para que se lea sobre cualquier fondo, la raya,
 * los dos extremos como manijas — se pueden agarrar y mover — y, en el medio, la flecha
 * del sentido en que tiene que cruzar el vehículo para que la cámara avise.
 */
function LineaDePasada({ linea, w, h }: { linea: Linea; w: number; h: number }) {
    const ax = linea.x1 * w, ay = linea.y1 * h;
    const bx = linea.x2 * w, by = linea.y2 * h;
    const largo = Math.hypot(bx - ax, by - ay) || 1;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // Normal unitaria: hacia dónde se cruza la raya.
    const nx = -(by - ay) / largo, ny = (bx - ax) / largo;
    const flecha = (signo: number, desde: number, hasta: number) => {
        const x0 = mx + nx * desde * signo, y0 = my + ny * desde * signo;
        const x1 = mx + nx * hasta * signo, y1 = my + ny * hasta * signo;
        const ux = (x1 - x0) / (Math.hypot(x1 - x0, y1 - y0) || 1), uy = (y1 - y0) / (Math.hypot(x1 - x0, y1 - y0) || 1);
        const px = -uy, py = ux;
        return { x0, y0, x1, y1, punta: `${x1},${y1} ${x1 - ux * 9 + px * 5},${y1 - uy * 9 + py * 5} ${x1 - ux * 9 - px * 5},${y1 - uy * 9 - py * 5}` };
    };
    const sentidos = linea.sentido === "left-right" ? [1] : linea.sentido === "right-left" ? [-1] : [1, -1];

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${w} ${h}`}>
            {/* resplandor: la raya se tiene que ver sobre asfalto claro y sobre sombra */}
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#f43f5e" strokeWidth={9} strokeLinecap="round" opacity={0.22} />
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#f43f5e" strokeWidth={2.5} strokeLinecap="round" />

            {sentidos.map((sg, i) => {
                const f = flecha(sg, 4, 30);
                return (
                    <g key={i}>
                        <line x1={f.x0} y1={f.y0} x2={f.x1} y2={f.y1} stroke="#fda4af" strokeWidth={2} strokeLinecap="round" />
                        <polygon points={f.punta} fill="#fda4af" />
                    </g>
                );
            })}

            {[[ax, ay], [bx, by]].map(([cx, cy], i) => (
                <g key={i}>
                    <circle cx={cx} cy={cy} r={7} fill="#f43f5e" />
                    <circle cx={cx} cy={cy} r={7} fill="none" stroke="#fff" strokeWidth={2} />
                </g>
            ))}
        </svg>
    );
}

/** Control compacto: rótulo, valor y una barra fina. Entra en el riel sin empujar nada. */
function Mando({ clave, sobreProps, icono: Ic, titulo, valor, min, max, paso, v, set, apagado }:
    {
        clave: string; sobreProps: (k: string) => any; icono: any; titulo: string; valor: string;
        min: number; max: number; paso: number; v: number; set: (n: number) => void; apagado?: boolean;
    }) {
    return (
        <div {...sobreProps(clave)} className={cn("rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 transition-colors hover:bg-white/[0.06]", apagado && "opacity-45")}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 flex items-center gap-1.5 truncate"><Ic size={11} /> {titulo}</span>
                <span className="text-xs font-bold text-white tabular-nums">{valor}</span>
            </div>
            <input type="range" min={min} max={max} step={paso} value={v}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full mt-1.5 h-1 accent-teal-400 cursor-pointer" />
        </div>
    );
}
