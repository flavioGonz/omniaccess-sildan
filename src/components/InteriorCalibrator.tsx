"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { sileo as toast } from "sileo";
import { X, Loader2, Play, Pause, Save, RotateCcw, SquareDashed, Crosshair, CheckCircle2, XCircle, Gauge, Timer, ScanLine, Info, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Roi = { x: number; y: number; w: number; h: number };
const ROI_COMPLETA: Roi = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Calibrador de una cámara interior: se ve el cuadro real, se recorta la zona
 * donde pasan los autos y se ajustan sensibilidad, confianza y ritmo hasta que
 * el lector saca la matrícula. Lo que se guarda lo usa la pasarela.
 */
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
    const [editandoRoi, setEditandoRoi] = useState(false);
    const [editandoLinea, setEditandoLinea] = useState(false);
    const [linea, setLinea] = useState<any>(null);
    const [regla, setRegla] = useState<any>(null);
    const [cambiandoModo, setCambiandoModo] = useState(false);

    // Estado de la regla de vehiculo en la propia camara.
    useEffect(() => {
        let vivo = true;
        axios.get(`/api/tracking/camera-rule?deviceId=${device.id}`)
            .then((r) => { if (vivo) { setRegla(r.data); if (r.data?.linea) setLinea(r.data.linea); } })
            .catch(() => { if (vivo) setRegla({ soportada: false }); });
        return () => { vivo = false; };
    }, [device.id]);

    const cambiarModo = async (modo: "escena" | "zona" | "linea") => {
        setCambiandoModo(true);
        try {
            const r = await axios.post("/api/tracking/camera-rule", { deviceId: device.id, modo, linea: modo === "linea" ? linea : undefined });
            setRegla((x: any) => ({ ...(x || {}), modo: r.data.modo }));
            toast.success({ title: modo === "escena" ? "Disparo por cambio de escena" : modo === "linea" ? "La cámara avisa al cruzar la línea" : "La cámara avisa al entrar en la zona" });
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo cambiar el modo de disparo." });
        } finally {
            setCambiandoModo(false);
        }
    };

    const lienzo = useRef<HTMLDivElement>(null);
    const arrastre = useRef<{ x: number; y: number } | null>(null);
    const autoRef = useRef(false);

    // ── Carga de la calibración guardada ────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const r = await axios.get(`/api/tracking/calibration?deviceId=${device.id}`);
                setEscena(r.data.escena ?? 0.08);
                setConfianza(r.data.confianza ?? 0.6);
                setFps(r.data.fps ?? 2);
                setRoi(r.data.roi || ROI_COMPLETA);
            } catch {
                toast.error({ title: "No se pudo leer la calibración" });
            } finally { setCargando(false); }
        })();
    }, [device.id]);

    // ── Un cuadro, con o sin lectura ────────────────────────────
    const tomar = useCallback(async (leer = true, conRecorte = true) => {
        setTomando(true);
        try {
            const r = await axios.post("/api/tracking/frame", {
                deviceId: device.id,
                leer,
                roi: conRecorte ? roi : null,
            });
            setCuadro(r.data);
        } catch (e: any) {
            setCuadro(null);
            toast.error({ title: e?.response?.data?.error || "No se pudo tomar el cuadro" });
            autoRef.current = false; setAuto(false);
        } finally { setTomando(false); }
    }, [device.id, roi]);

    useEffect(() => { tomar(true, true); /* primer cuadro */ // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [device.id]);

    // ── Modo continuo: encadena capturas sin solaparlas ─────────
    useEffect(() => {
        autoRef.current = auto;
        if (!auto) return;
        let vivo = true;
        const ciclo = async () => {
            while (vivo && autoRef.current) {
                await tomar(true, true);
                await new Promise((r) => setTimeout(r, 900));
            }
        };
        ciclo();
        return () => { vivo = false; };
    }, [auto, tomar]);

    // ── Dibujo de la zona de interés ────────────────────────────
    const aRelativo = (e: React.MouseEvent) => {
        const c = lienzo.current!.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (e.clientX - c.left) / c.width)),
            y: Math.max(0, Math.min(1, (e.clientY - c.top) / c.height)),
        };
    };
    const alBajar = (e: React.MouseEvent) => {
        if (!editandoRoi && !editandoLinea) return;
        e.preventDefault();
        arrastre.current = aRelativo(e);
        if (editandoLinea) setLinea((l: any) => ({ x1: arrastre.current!.x, y1: arrastre.current!.y, x2: arrastre.current!.x, y2: arrastre.current!.y, sentido: l?.sentido || "any" }));
        else setRoi({ ...arrastre.current, w: 0, h: 0 });
    };
    const alMover = (e: React.MouseEvent) => {
        if (!arrastre.current) return;
        const p = aRelativo(e);
        const a = arrastre.current;
        if (editandoLinea) { setLinea((l: any) => ({ ...(l || {}), x1: a.x, y1: a.y, x2: p.x, y2: p.y, sentido: l?.sentido || "any" })); return; }
        if (!editandoRoi) return;
        setRoi({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
    };
    const alSoltar = () => {
        if (!arrastre.current) return;
        arrastre.current = null;
        if (editandoLinea) {
            // Una raya de dos píxeles no es una línea: si quedó demasiado corta, se descarta.
            setLinea((l: any) => (l && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.08 ? l : null));
            return;
        }
        setRoi((r) => (r.w < 0.05 || r.h < 0.05 ? ROI_COMPLETA : r));
    };

    const guardar = async () => {
        setGuardando(true);
        try {
            await axios.put("/api/tracking/calibration", { deviceId: device.id, escena, confianza, fps, roi });
            toast.success({ title: "Calibración guardada", description: "La pasarela la toma en menos de un minuto." });
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo guardar" });
        } finally { setGuardando(false); }
    };

    const mejor = cuadro?.lecturas?.[0];
    const pasa = mejor ? mejor.confidence >= confianza : false;
    const zonaCompleta = roi.x < 0.01 && roi.y < 0.01 && roi.w > 0.99 && roi.h > 0.99;

    return (
        <div className="fixed inset-0 z-[3000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-3xl bg-[#0b0d11] border border-white/[0.08] shadow-2xl">

                {/* Encabezado */}
                <div className="flex items-center gap-3 px-5 h-14 border-b border-white/[0.07] sticky top-0 bg-[#0b0d11] z-10">
                    <div className="p-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20"><ScanLine size={15} className="text-teal-400" /></div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white truncate">Calibrar {device.name}</div>
                        <div className="text-[10px] text-white/40">Cámara interior · lectura por Omni-LPR</div>
                    </div>
                    <button onClick={guardar} disabled={guardando || cargando}
                        className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                        {guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
                    </button>
                    <button onClick={onClose} className="w-9 h-9 rounded-xl text-white/50 hover:text-white hover:bg-white/[0.08] flex items-center justify-center"><X size={16} /></button>
                </div>

                {cargando ? (
                    <div className="flex items-center gap-2 p-16 justify-center text-white/50 text-sm"><Loader2 size={16} className="animate-spin" /> Leyendo la calibración…</div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px]">

                        {/* ── Cuadro ── */}
                        <div className="p-5 space-y-3">
                            <div ref={lienzo}
                                onMouseDown={alBajar} onMouseMove={alMover} onMouseUp={alSoltar} onMouseLeave={alSoltar}
                                className={cn("relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-white/[0.08]",
                                    (editandoRoi || editandoLinea) && "cursor-crosshair")}>
                                {cuadro?.imagen ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={cuadro.imagen} alt="" className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" draggable={false} />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-white/30 text-xs">
                                        {tomando ? "Tomando el cuadro…" : "Sin imagen"}
                                    </div>
                                )}

                                {/* La zona se dibuja sobre la imagen completa; cuando ya está
                                    recortada, el cuadro ES la zona, así que solo se marca al editar. */}
                                {editandoRoi && !zonaCompleta && (
                                    <div className="absolute border-2 border-amber-400 bg-amber-400/10 pointer-events-none"
                                        style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }} />
                                )}

                                {linea && (
                                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                        <line x1={linea.x1 * 100} y1={linea.y1 * 100} x2={linea.x2 * 100} y2={linea.y2 * 100}
                                            stroke="#f43f5e" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
                                        {[[linea.x1, linea.y1], [linea.x2, linea.y2]].map(([cx, cy], i) => (
                                            <circle key={i} cx={cx * 100} cy={cy * 100} r={0.9} fill="#f43f5e" vectorEffect="non-scaling-stroke" />
                                        ))}
                                    </svg>
                                )}

                                {tomando && (
                                    <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/70 text-[10px] text-white/70">
                                        <Loader2 size={10} className="animate-spin" /> capturando
                                    </div>
                                )}
                                {mejor && (
                                    <div className={cn("absolute bottom-2 left-2 flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-bold backdrop-blur",
                                        pasa ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300")}>
                                        {pasa ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                                        <span className="font-mono tracking-widest">{mejor.plate}</span>
                                        <span className="opacity-70">{Math.round(mejor.confidence * 100)}%</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={() => setAuto((a) => !a)}
                                    className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                                        auto ? "bg-amber-500 text-black" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                                    {auto ? <Pause size={14} /> : <Play size={14} />} {auto ? "Detener" : "Ver en vivo"}
                                </button>
                                <button onClick={() => tomar(true, true)} disabled={tomando || auto}
                                    className="h-9 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-white/80 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
                                    <Crosshair size={14} /> Un cuadro
                                </button>
                                <button onClick={() => { setEditandoLinea((v) => !v); setEditandoRoi(false); if (!editandoLinea) tomar(false, false); }}
                                    className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                                        editandoLinea ? "bg-rose-500 text-white" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                                    <Minus size={14} /> {editandoLinea ? "Listo" : "Marcar línea"}
                                </button>
                                <button onClick={() => { setEditandoRoi((v) => !v); setEditandoLinea(false); if (!editandoRoi) tomar(false, false); }}
                                    className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                                        editandoRoi ? "bg-amber-500 text-black" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                                    <SquareDashed size={14} /> {editandoRoi ? "Listo" : "Marcar zona"}
                                </button>
                                {!zonaCompleta && (
                                    <button onClick={() => { setRoi(ROI_COMPLETA); tomar(true, false); }}
                                        className="h-9 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-white/60 text-xs font-bold flex items-center gap-1.5">
                                        <RotateCcw size={14} /> Zona completa
                                    </button>
                                )}
                                {cuadro && (
                                    <span className="ml-auto text-[10px] text-white/35">
                                        {Math.round(cuadro.bytes / 1024)} KB · captura {cuadro.msCaptura} ms · lectura {cuadro.msLectura} ms
                                    </span>
                                )}
                            </div>

                            {editandoRoi && (
                                <p className="text-[11px] text-white/45 flex items-start gap-1.5">
                                    <Info size={12} className="mt-0.5 shrink-0" />
                                    Arrastrá sobre la imagen para encerrar el tramo por donde pasan los autos.
                                    Recortar sube la precisión y baja el consumo: el lector mira menos imagen.
                                </p>
                            )}
                            {cuadro?.errorLpr && <p className="text-[11px] text-red-400">{cuadro.errorLpr}</p>}
                            {cuadro && !cuadro.errorLpr && !mejor && (
                                <p className="text-[11px] text-white/45">
                                    Ninguna matrícula en este cuadro. Si no pasaba ningún auto es normal; poné
                                    &quot;Ver en vivo&quot; y esperá a que pase uno.
                                </p>
                            )}
                        </div>

                        {/* ── Ajustes ── */}
                        <div className="p-5 lg:border-l border-white/[0.07] space-y-5">
                            <Dial icono={Gauge} titulo="Sensibilidad de escena" valor={escena.toFixed(2)}
                                min={0.02} max={0.3} paso={0.01} v={escena} set={setEscena}
                                ayuda="Cuánto tiene que cambiar la imagen para mandar un cuadro al lector. Más bajo, más lecturas y más GPU." />

                            <Dial icono={ScanLine} titulo="Confianza mínima" valor={`${Math.round(confianza * 100)}%`}
                                min={0.2} max={0.95} paso={0.05} v={confianza} set={setConfianza}
                                ayuda="Por debajo de esto la lectura se descarta. Subilo si aparecen matrículas inventadas." />

                            <Dial icono={Timer} titulo="Cuadros por segundo" valor={`${fps}`}
                                min={0.5} max={6} paso={0.5} v={fps} set={setFps}
                                ayuda="Ritmo al que se muestrea el video. 2 alcanza para vehículos a paso de barrio." />

                            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 space-y-1.5">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Zona de interés</div>
                                <div className="text-xs text-white/80">
                                    {zonaCompleta ? "Toda la imagen" : `${Math.round(roi.w * 100)}% × ${Math.round(roi.h * 100)}% del cuadro`}
                                </div>
                                <p className="text-[10px] text-white/40 leading-relaxed">
                                    {zonaCompleta
                                        ? "Sin recorte. Marcá la zona por donde pasan los autos para ganar precisión."
                                        : "El lector solo mira ese recorte, y lo recibe en resolución nativa: con menos superficie inútil, la matrícula llega con más píxeles y se lee mejor."}
                                </p>
                            </div>

                            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 space-y-2.5">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Quién decide cuándo leer</div>

                                {regla === null ? (
                                    <div className="text-xs text-white/50 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> consultando la cámara…</div>
                                ) : (
                                    <>
                                        {[
                                            {
                                                id: "linea" as const, titulo: "Al cruzar una línea", icono: Minus,
                                                puede: regla.soportaLinea, listo: !!linea,
                                                falta: "Marcá la línea sobre el cuadro, del lado por donde pasan los autos.",
                                                texto: "La cámara avisa en el instante exacto del cruce. Es lo mejor para una calle: la lectura queda centrada en el paso, y un auto estacionado dentro del encuadre deja de disparar.",
                                            },
                                            {
                                                id: "zona" as const, titulo: "Al entrar en una zona", icono: SquareDashed,
                                                puede: regla.soportaZona, listo: !zonaCompleta,
                                                falta: "Marcá primero la zona de interés.",
                                                texto: "La cámara avisa mientras haya un vehículo dentro del área marcada. Sirve para un sector entero, pero un auto quieto adentro vuelve a disparar con cada movimiento.",
                                            },
                                            {
                                                id: "escena" as const, titulo: "Por cambio de imagen", icono: Gauge,
                                                puede: true, listo: true, falta: "",
                                                texto: "Lo decide el servidor mirando si la imagen cambió. Funciona con CUALQUIER cámara, incluso una que solo entregue RTSP y no tenga analítica propia. A cambio trabaja más y se despierta también con una sombra o una rama.",
                                            },
                                        ].map((o) => {
                                            const activo = (regla.modo === "camara" ? "zona" : regla.modo) === o.id;
                                            const bloqueado = !o.puede || (!o.listo && o.id !== "escena");
                                            return (
                                                <button key={o.id} type="button" disabled={cambiandoModo || bloqueado}
                                                    onClick={() => cambiarModo(o.id)}
                                                    className={cn("w-full text-left rounded-lg border p-2.5 transition-colors disabled:cursor-not-allowed",
                                                        activo ? "border-emerald-500/40 bg-emerald-500/[0.07]" : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]",
                                                        bloqueado && "opacity-45")}>
                                                    <div className="flex items-center gap-2">
                                                        <o.icono size={12} className={activo ? "text-emerald-400" : "text-white/50"} />
                                                        <span className={cn("text-[11px] font-bold", activo ? "text-emerald-300" : "text-white/80")}>{o.titulo}</span>
                                                        {activo && <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-emerald-400">en uso</span>}
                                                    </div>
                                                    <p className="text-[10px] text-white/45 leading-relaxed mt-1">{o.texto}</p>
                                                    {!o.puede && <p className="text-[10px] text-amber-300/80 mt-1">Esta cámara no ofrece esta analítica.</p>}
                                                    {o.puede && !o.listo && o.id !== "escena" && <p className="text-[10px] text-amber-300/80 mt-1">{o.falta}</p>}
                                                </button>
                                            );
                                        })}

                                        {regla.soportada === false && (
                                            <p className="text-[10px] text-white/45 leading-relaxed">
                                                No se pudo consultar la analítica de esta cámara. Si es una cámara que solo entrega
                                                RTSP —sin analítica propia—, es lo esperable: queda en cambio de imagen, que es el
                                                modo pensado justamente para ese caso.
                                            </p>
                                        )}
                                        {regla.avisaAlServidor === false && (
                                            <p className="text-[10px] text-amber-300/80 leading-relaxed">
                                                En la cámara está apagado el aviso al centro de vigilancia, así que el evento no
                                                llegaría. Hay que prenderlo en su configuración de eventos.
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>

                            <p className="text-[10px] text-white/35 leading-relaxed">
                                Los cambios se aplican al guardar; la pasarela relee la configuración cada minuto,
                                no hace falta reiniciar nada.
                            </p>
                        </div>
                    </div>
                )}
            </motion.div>
        </div>
    );
}

/** Deslizador con su explicación al lado, para no tener que adivinar qué hace. */
function Dial({ icono: Ic, titulo, valor, min, max, paso, v, set, ayuda }: {
    icono: any; titulo: string; valor: string; min: number; max: number; paso: number;
    v: number; set: (n: number) => void; ayuda: string;
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
                <Ic size={12} className="text-white/45" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/45 flex-1">{titulo}</span>
                <span className="text-xs font-bold text-white tabular-nums">{valor}</span>
            </div>
            <input type="range" min={min} max={max} step={paso} value={v}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full h-1 accent-teal-400 cursor-pointer" />
            <p className="text-[10px] text-white/35 leading-relaxed">{ayuda}</p>
        </div>
    );
}

export default InteriorCalibrator;
