"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { sileo as toast } from "sileo";
import {
    X, Loader2, Play, Pause, Save, RotateCcw, SquareDashed, Crosshair, ParkingSquare,
    CheckCircle2, XCircle, Gauge, Timer, ScanLine, Minus, ArrowLeftRight, Trash2, Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconBar } from "@/components/ui/icon-bar";
import { useFranja } from "@/components/tracking/useFranja";
import { FranjaLienzo } from "@/components/tracking/FranjaLienzo";
import { FranjaPanel } from "@/components/tracking/FranjaPanel";
import { calzar } from "@/components/tracking/Calibracion";

import { LineaDePasada, ZONA_COMPLETA, type Linea, type Zona } from "@/components/tracking/Calibracion";

type Roi = Zona;
const ROI_COMPLETA: Roi = ZONA_COMPLETA;

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
    const [tomando, setTomando] = useState(false);
    const [auto, setAuto] = useState(false);
    const [cuadro, setCuadro] = useState<any>(null);

    const [escena, setEscena] = useState(0.08);
    const [confianza, setConfianza] = useState(0.6);
    const [fps, setFps] = useState(2);
    const [roi, setRoi] = useState<Roi>(ROI_COMPLETA);
    const [linea, setLinea] = useState<Linea | null>(null);
    /**
     * Qué se está dibujando encima de la escena.
     *
     * La franja entró acá, como una herramienta más, y no como un diálogo aparte. Abrir
     * otra ventana modal encima de esta obligaba a perder de vista la escena que se está
     * calibrando — justo lo único que hay que mirar para dibujar sobre ella — y dejaba dos
     * encuadres distintos del mismo cuadro, uno en cada ventana.
     */
    const [dibujando, setDibujando] = useState<null | "zona" | "linea" | "franja">(null);
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
    /* El cuadro llega encajado (object-contain): entre la caja y la imagen hay bandas, y
       dibujar sobre la caja corre la franja hacia ellas. El corrimiento sólo se nota
       cuando ya está mal calibrada, o sea tarde. */
    const [nativo, setNativo] = useState({ w: 16, h: 9 });
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
        /* Sólo zona y línea se arrastran acá. La franja tiene sus propios tiradores en
           `FranjaLienzo`, y sin esta guarda cada clic sobre la escena redibujaba la zona. */
        if (dibujando !== "zona" && dibujando !== "linea") return;
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
        if (!arrastre.current || (dibujando !== "zona" && dibujando !== "linea")) return;
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

    /* Una sola copia del estado de la franja, compartida con el dibujo de la escena y con
       el panel del costado. Ver `useFranja`. */
    const franja = useFranja(device.id, !!device.rtspUrl);
    const encuadre = calzar(tam.w, tam.h, nativo.w, nativo.h);

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
        franja: franja.aprendida ? "midiendo" : franja.existe ? "falta enseñarle el vacío" : "sin dibujar",
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
        <div className="fixed inset-0 z-[var(--capa-panel)] flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-0 md:p-6 animate-in fade-in duration-200">
            <div className="relative w-full h-full md:h-[90vh] md:max-w-[1500px] md:rounded-[14px] overflow-hidden bg-background flex flex-col md:flex-row">

                {/*
                 * ── La escena, a sangre ──
                 *
                 * Sin marco, sin borde y sin radio propio. Lo que hay que mirar acá es la
                 * calle: un recuadro alrededor de la imagen agrega una línea que compite con
                 * las que uno está dibujando encima, que son las que importan. Los controles
                 * flotan sobre ella en vez de robarle alto a un riel.
                 */}
                <div className="relative flex-1 min-h-0 bg-black">
                    <div ref={lienzo}
                        onMouseDown={alBajar} onMouseMove={alMover} onMouseUp={alSoltar} onMouseLeave={alSoltar}
                        className={cn("absolute inset-0", dibujando && dibujando !== "franja" && "cursor-crosshair")}>

                        {cuadro?.imagen ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={cuadro.imagen} alt="" draggable={false}
                                onLoad={(e) => setNativo({
                                    w: e.currentTarget.naturalWidth || 16,
                                    h: e.currentTarget.naturalHeight || 9,
                                })}
                                className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />
                        ) : (
                            <div className="absolute inset-0 grid place-items-center text-[13px] text-white/40">
                                {tomando ? "Tomando el cuadro…" : cargando ? "Leyendo la calibración…" : "Sin imagen"}
                            </div>
                        )}

                        {dibujando === "zona" && !zonaCompleta && (
                            <div className="absolute pointer-events-none"
                                style={{
                                    left: `${roi.x * 100}%`, top: `${roi.y * 100}%`,
                                    width: `${roi.w * 100}%`, height: `${roi.h * 100}%`,
                                    border: "2px solid var(--accion-en-oscuro)",
                                    background: "color-mix(in oklab, var(--accion-en-oscuro) 14%, transparent)",
                                }} />
                        )}

                        {/* La línea vive en coordenadas del cuadro ENTERO. Con una zona marcada
                            lo que se ve es el recorte, y la misma línea caería en otro lugar:
                            por eso sólo se muestra mientras se la edita, que es cuando la
                            imagen es la completa. */}
                        {linea && dibujando === "linea" && tam.w > 0 && (
                            <LineaDePasada linea={linea} w={tam.w} h={tam.h} />
                        )}
                    </div>

                    {/* La franja se dibuja sobre la imagen encajada, no sobre la caja. */}
                    {dibujando === "franja" && (
                        <FranjaLienzo franja={franja} encuadre={encuadre} />
                    )}

                    {/* ── Herramientas, flotando ── */}
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[var(--capa-flotante)]">
                        <IconBar
                            superficie="imagen"
                            items={[
                                { key: "mirar", label: "Sólo mirar", Icon: Crosshair },
                                { key: "zona", label: `Zona · ${zonaCompleta ? "todo el cuadro" : `${Math.round(roi.w * 100)}×${Math.round(roi.h * 100)}%`}`, Icon: SquareDashed },
                                { key: "linea", label: `Línea · ${linea ? "puesta" : "sin marcar"}`, Icon: Minus },
                                { key: "franja", label: `Estacionamiento · ${franja.existe ? `${franja.lugares} lugares` : "sin dibujar"}`, Icon: ParkingSquare },
                            ]}
                            value={dibujando ?? "mirar"}
                            onChange={(k) => {
                                setAuto(false);
                                if (k === "mirar") { setDibujando(null); tomar(true, true); return; }
                                setDibujando(k as any);
                                /* Sin recorte: la zona, la línea y la franja se dibujan sobre el
                                   cuadro entero, porque en eso están expresadas. Mostrar el
                                   recorte mientras se dibuja pondría cada trazo en otro lado. */
                                tomar(false, false);
                            }}
                            acciones={[
                                {
                                    key: "vivo", label: auto ? "Detener el vivo" : "Ver en vivo",
                                    Icon: auto ? Pause : Play, activa: auto, off: !!dibujando,
                                    onClick: () => setAuto((a) => !a),
                                },
                                {
                                    key: "cuadro", label: "Tomar un cuadro", Icon: Camera,
                                    off: tomando || auto,
                                    onClick: () => (dibujando === "franja" ? franja.tomar() : tomar(true, !dibujando)),
                                },
                            ]}
                        />
                    </div>

                    {/* ── Lo que hay que hacer, cuando se está dibujando ── */}
                    {dibujando && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[var(--capa-flotante)]
                            flex items-center gap-3 px-3 py-2 rounded-[10px] bg-black/75 backdrop-blur-md border border-white/15">
                            <span className="text-[12px] font-semibold text-white">
                                {dibujando === "linea" ? "Arrastrá la línea por donde cruzan los autos"
                                    : dibujando === "zona" ? "Arrastrá el rectángulo sobre la calzada"
                                        : "Movés las cuatro esquinas sobre el cordón donde estacionan"}
                            </span>
                            {dibujando === "linea" && linea && (
                                <button onClick={() => setLinea(null)}
                                    className="text-[12px] text-white/60 hover:text-white flex items-center gap-1">
                                    <Trash2 size={13} /> borrar
                                </button>
                            )}
                            {dibujando === "zona" && !zonaCompleta && (
                                <button onClick={() => { setRoi(ROI_COMPLETA); }}
                                    className="text-[12px] text-white/60 hover:text-white flex items-center gap-1">
                                    <RotateCcw size={13} /> todo el cuadro
                                </button>
                            )}
                        </div>
                    )}

                    {/* ── La lectura, abajo a la izquierda ── */}
                    {!dibujando && mejor && (
                        <div className={cn("absolute bottom-3 left-3 z-[var(--capa-flotante)] flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] font-semibold backdrop-blur-md",
                            pasa ? "chip-bien" : "chip-aviso")}>
                            {pasa ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            <span className="tracking-widest tabular-nums">{mejor.plate}</span>
                            <span className="opacity-75 tabular-nums">{Math.round(mejor.confidence * 100)}%</span>
                            <span className="opacity-70 font-normal">{pasa ? "se registraría" : "por debajo del mínimo"}</span>
                        </div>
                    )}
                    {!dibujando && cuadro && !cuadro.errorLpr && !mejor && (
                        <div className="absolute bottom-3 left-3 z-[var(--capa-flotante)] max-w-md px-3 py-2 rounded-[10px] bg-black/70 backdrop-blur-md text-[12px] text-white/70">
                            Ninguna matrícula en este cuadro. Si no pasaba ningún auto es normal:
                            poné <b className="text-white">Ver en vivo</b> y esperá a que pase uno.
                        </div>
                    )}
                    {!dibujando && cuadro?.errorLpr && (
                        <div className="absolute bottom-3 left-3 z-[var(--capa-flotante)] px-3 py-2 rounded-[10px] text-[12px] chip-mal backdrop-blur-md">
                            {cuadro.errorLpr}
                        </div>
                    )}

                    {tomando && (
                        <div className="absolute top-3 left-3 z-[var(--capa-flotante)] flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] bg-black/70 backdrop-blur-md text-[11px] text-white/80">
                            <Loader2 size={11} className="animate-spin" /> capturando
                        </div>
                    )}
                </div>

                {/* ── La barra lateral ── */}
                <aside className="w-full md:w-[360px] shrink-0 border-t md:border-t-0 md:border-l border-border bg-card flex flex-col min-h-0">
                    <header className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-border">
                        <span className="size-8 rounded-[6px] bg-muted flex items-center justify-center text-muted-foreground">
                            <ScanLine size={15} />
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold truncate">{device.name}</div>
                            <div className="text-[11px] text-muted-foreground">Cámara interior · lee Omni-LPR</div>
                        </div>
                        <button onClick={onClose}
                            className="size-8 rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center">
                            <X size={16} />
                        </button>
                    </header>

                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-6">

                        {/* La ayuda del control que el mouse está tocando. Va arriba y quieta:
                            cuando saltaba sobre la escena tapaba justo lo que se estaba por
                            dibujar. */}
                        <AnimatePresence mode="wait">
                            {ayuda && (
                                <motion.div key={sobre!}
                                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                    transition={{ duration: 0.16 }}
                                    className="rounded-[10px] bg-muted px-3 py-2.5">
                                    <p className="text-[13px] font-semibold">{ayuda.titulo}</p>
                                    {ACTUAL[sobre!] && (
                                        <p className="text-[11px] text-muted-foreground tabular-nums mb-1.5">ahora: {ACTUAL[sobre!]}</p>
                                    )}
                                    <p className="text-[12px] text-muted-foreground leading-relaxed">{ayuda.detalle}</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* ── Estacionamiento: acá adentro, no en otra ventana ── */}
                        {dibujando === "franja" && (
                            <Bloque titulo="Dónde estacionan" icono={ParkingSquare}>
                                <FranjaPanel franja={franja} alTomar={() => tomar(false, false)} />
                            </Bloque>
                        )}

                        <Bloque titulo="Qué dispara la lectura" icono={Gauge}>
                            <div className="flex flex-col gap-1.5">
                                {MODOS.map((o) => {
                                    const bloqueado = !o.puede || (!o.listo && o.id !== "escena") || aplicando;
                                    const activo = modo === o.id;
                                    return (
                                        <button key={o.id} {...sobreProps(`modo-${o.id}`)} type="button"
                                            disabled={bloqueado} onClick={() => cambiarModo(o.id)}
                                            data-principal={activo || undefined}
                                            className={cn("h-9 px-3 rounded-[6px] text-[12px] font-semibold flex items-center gap-2 text-left transition-colors",
                                                activo ? "text-[var(--accion-texto)]" : "hover:bg-accent",
                                                bloqueado && !activo && "opacity-40 cursor-not-allowed")}>
                                            <o.ic size={13} />
                                            <span className="flex-1">{o.txt}</span>
                                            {!o.puede && <span className="text-[11px] font-normal opacity-70">no la soporta</span>}
                                            {o.puede && !o.listo && o.id !== "escena" && (
                                                <span className="text-[11px] font-normal opacity-70">{o.falta}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            {modo === "linea" && linea && (
                                <button {...sobreProps("sentido")}
                                    onClick={() => setLinea((l) => l && ({ ...l, sentido: l.sentido === "any" ? "left-right" : l.sentido === "left-right" ? "right-left" : "any" }))}
                                    className="h-8 px-2.5 rounded-[6px] hover:bg-accent text-[12px] flex items-center gap-1.5 text-muted-foreground">
                                    <ArrowLeftRight size={13} />
                                    {linea.sentido === "any" ? "los dos sentidos" : linea.sentido === "left-right" ? "izq → der" : "der → izq"}
                                </button>
                            )}
                        </Bloque>

                        <Bloque titulo="Ajustes" icono={SlidersIcono}>
                            <Mando clave="sensibilidad" sobreProps={sobreProps} icono={Gauge} titulo="Sensibilidad"
                                valor={escena.toFixed(2)} min={0.02} max={0.3} paso={0.01} v={escena} set={setEscena}
                                apagado={modo !== "escena"} />
                            <Mando clave="confianza" sobreProps={sobreProps} icono={ScanLine} titulo="Confianza mínima"
                                valor={`${Math.round(confianza * 100)}%`} min={0.2} max={0.95} paso={0.05} v={confianza} set={setConfianza} />
                            <Mando clave="fps" sobreProps={sobreProps} icono={Timer} titulo="Cuadros por segundo"
                                valor={String(fps)} min={0.5} max={10} paso={0.5} v={fps} set={setFps} />
                        </Bloque>

                        {cuadro && (
                            <p className="text-[11px] text-muted-foreground tabular-nums">
                                {Math.round(cuadro.bytes / 1024)} KB · captura {cuadro.msCaptura} ms · lectura {cuadro.msLectura} ms
                            </p>
                        )}
                    </div>

                    <footer className="shrink-0 border-t border-border px-4 py-3">
                        <Button onClick={guardar} disabled={guardando || cargando} className="w-full accion">
                            {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar calibración
                        </Button>
                    </footer>
                </aside>
            </div>
        </div>
    );
}

/** Un ícono de regulador, sin traerse otro paquete por tres rayas. */
function SlidersIcono({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
            <circle cx="16" cy="7" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="17" r="2" />
        </svg>
    );
}

/**
 * Un bloque de la barra lateral.
 *
 * El riel de antes ponía todo en una fila: nueve controles de distinta naturaleza —
 * herramientas de dibujo, reguladores y modos de disparo — separados apenas por un palito
 * de un píxel. Agrupar por lo que cada cosa decide es lo que hace que se encuentre sin
 * leerlos todos.
 */
function Bloque({ titulo, icono: Ic, children }: {
    titulo: string;
    icono: React.ComponentType<{ size?: number }>;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-2.5">
            <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
                <Ic size={11} /> {titulo}
            </h3>
            {children}
        </section>
    );
}

/** Regulador: rótulo, valor y una barra fina. */
function Mando({ clave, sobreProps, icono: Ic, titulo, valor, min, max, paso, v, set, apagado }: {
    clave: string; sobreProps: (k: string) => any; icono: any; titulo: string; valor: string;
    min: number; max: number; paso: number; v: number; set: (n: number) => void; apagado?: boolean;
}) {
    return (
        <div {...sobreProps(clave)} className={cn("rounded-[6px] px-2.5 py-2 hover:bg-accent transition-colors", apagado && "opacity-45")}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-muted-foreground flex items-center gap-1.5 truncate">
                    <Ic size={12} /> {titulo}
                </span>
                <span className="text-[12px] font-semibold tabular-nums">{valor}</span>
            </div>
            <input type="range" min={min} max={max} step={paso} value={v}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full mt-2 h-1 cursor-pointer accent-[var(--accion)]" />
        </div>
    );
}
