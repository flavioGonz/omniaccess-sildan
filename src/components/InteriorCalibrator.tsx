"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
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
 * ocupando todo lo que puede, y los controles en un riel abajo. Nada de scroll vertical
 * dentro del modal — lo que no entra no debería estar acá.
 *
 * Dibujar la zona o la línea entra en un modo aparte que toma la imagen entera, como el
 * editor de región del otro calibrador.
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
    const [linea, setLinea] = useState<Linea | null>(null);
    const [dibujando, setDibujando] = useState<null | "zona" | "linea">(null);
    const [regla, setRegla] = useState<any>(null);
    const [modo, setModo] = useState<"escena" | "zona" | "linea">("escena");
    const [aplicando, setAplicando] = useState(false);

    const lienzo = useRef<HTMLDivElement>(null);
    const arrastre = useRef<{ x: number; y: number } | null>(null);
    const autoRef = useRef(false);

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
        if (dibujando === "linea") setLinea((l) => ({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, sentido: l?.sentido || "any" }));
        else setRoi({ ...p, w: 0, h: 0 });
    };
    const alMover = (e: React.MouseEvent) => {
        if (!arrastre.current || !dibujando) return;
        const p = aRelativo(e);
        const a = arrastre.current;
        if (dibujando === "linea") setLinea((l) => ({ x1: a.x, y1: a.y, x2: p.x, y2: p.y, sentido: l?.sentido || "any" }));
        else setRoi({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
    };
    const alSoltar = () => {
        if (!arrastre.current) return;
        arrastre.current = null;
        if (dibujando === "linea") {
            // Una raya de dos píxeles no es una línea.
            setLinea((l) => (l && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.08 ? l : null));
        } else if (dibujando === "zona") {
            setRoi((r) => (r.w < 0.05 || r.h < 0.05 ? ROI_COMPLETA : r));
        }
    };

    /**
     * Guardar hace las dos cosas que uno espera: deja la calibración en la base y, si el
     * disparo lo pone la cámara, le vuelve a escribir la regla. Antes la línea se dibujaba,
     * se apretaba Guardar y no pasaba nada, porque aplicarla era otro botón.
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

    const MODOS = [
        { id: "linea" as const, ic: Minus, txt: "Al cruzar una línea", puede: regla?.soportaLinea, listo: !!linea, falta: "dibujá la línea" },
        { id: "zona" as const, ic: SquareDashed, txt: "Al entrar en la zona", puede: regla?.soportaZona, listo: !zonaCompleta, falta: "marcá la zona" },
        { id: "escena" as const, ic: Gauge, txt: "Por cambio de imagen", puede: true, listo: true, falta: "" },
    ];
    const AYUDA: Record<string, string> = {
        linea: "La cámara avisa en el instante del cruce. Lo mejor para una calle: un auto estacionado dentro del encuadre deja de disparar.",
        zona: "La cámara avisa mientras haya un vehículo dentro del área. Sirve para un sector entero; un auto quieto adentro vuelve a disparar.",
        escena: "Lo decide el servidor mirando si la imagen cambió. Anda con cualquier cámara, incluso una que solo entregue RTSP. A cambio trabaja más.",
    };

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

                        {/* La zona se marca sobre la imagen completa; cuando ya está recortada,
                            el cuadro ES la zona, así que solo se dibuja al editarla. */}
                        {dibujando === "zona" && !zonaCompleta && (
                            <div className="absolute border-2 border-amber-400 bg-amber-400/10 pointer-events-none"
                                style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }} />
                        )}

                        {/* La línea se dibuja sobre el cuadro ENTERO. Con una zona marcada, lo que
                            se ve es el recorte, y la misma línea caería en otro lugar: por eso solo
                            se muestra mientras se la edita, que es cuando la imagen es la completa. */}
                        {linea && dibujando === "linea" && (
                            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                <line x1={linea.x1 * 100} y1={linea.y1 * 100} x2={linea.x2 * 100} y2={linea.y2 * 100}
                                    stroke="#f43f5e" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                                {[[linea.x1, linea.y1], [linea.x2, linea.y2]].map(([cx, cy], i) => (
                                    <circle key={i} cx={cx * 100} cy={cy * 100} r={0.8} fill="#f43f5e" vectorEffect="non-scaling-stroke" />
                                ))}
                            </svg>
                        )}
                    </div>

                    {/* Aviso del modo de dibujo, arriba, sin tapar el cuadro */}
                    {dibujando && (
                        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-1.5 rounded-xl bg-black/80 border border-white/10 backdrop-blur">
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

                    {/* Resultado de la lectura */}
                    {mejor && !dibujando && (
                        <div className={cn("absolute bottom-3 left-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold backdrop-blur",
                            pasa ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300")}>
                            {pasa ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            <span className="font-mono tracking-widest">{mejor.plate}</span>
                            <span className="opacity-70">{Math.round(mejor.confidence * 100)}%</span>
                            <span className="opacity-60 font-medium">{pasa ? "se registraría" : "por debajo del mínimo"}</span>
                        </div>
                    )}
                    {cuadro && !cuadro.errorLpr && !mejor && !dibujando && (
                        <div className="absolute bottom-3 left-3 px-3 py-2 rounded-xl bg-black/70 text-[11px] text-white/55 backdrop-blur max-w-md">
                            Ninguna matrícula en este cuadro. Si no pasaba ningún auto es normal: poné <b className="text-white/75">Ver en vivo</b> y esperá a que pase uno.
                        </div>
                    )}
                    {cuadro?.errorLpr && !dibujando && (
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
                        <button onClick={() => setAuto((a) => !a)} disabled={!!dibujando}
                            className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40",
                                auto ? "bg-amber-500 text-black" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                            {auto ? <Pause size={14} /> : <Play size={14} />} {auto ? "Detener" : "Ver en vivo"}
                        </button>
                        <button onClick={() => tomar(true, true)} disabled={tomando || auto || !!dibujando}
                            className="h-9 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-white/80 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
                            <Crosshair size={14} /> Un cuadro
                        </button>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        <button onClick={() => { setDibujando("zona"); setAuto(false); tomar(false, false); }}
                            className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                                dibujando === "zona" ? "bg-amber-500 text-black" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                            <SquareDashed size={14} /> Zona
                            <span className="text-[10px] font-medium opacity-60">{zonaCompleta ? "completa" : `${Math.round(roi.w * 100)}×${Math.round(roi.h * 100)}%`}</span>
                        </button>
                        <button onClick={() => { setDibujando("linea"); setAuto(false); tomar(false, false); }}
                            className={cn("h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                                dibujando === "linea" ? "bg-rose-500 text-white" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]")}>
                            <Minus size={14} /> Línea
                            <span className="text-[10px] font-medium opacity-60">{linea ? "puesta" : "sin marcar"}</span>
                        </button>
                        {!zonaCompleta && (
                            <button onClick={() => { setRoi(ROI_COMPLETA); tomar(true, false); }}
                                className="h-9 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/50 text-[11px] font-bold flex items-center gap-1.5">
                                <RotateCcw size={13} /> todo el cuadro
                            </button>
                        )}
                        {modo === "linea" && linea && (
                            <button
                                onClick={() => setLinea((l) => l && ({ ...l, sentido: l.sentido === "any" ? "left-right" : l.sentido === "left-right" ? "right-left" : "any" }))}
                                className="h-9 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/60 text-[11px] font-bold flex items-center gap-1.5">
                                <ArrowLeftRight size={13} />
                                {linea.sentido === "any" ? "los dos sentidos" : linea.sentido === "left-right" ? "izq → der" : "der → izq"}
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 items-end">
                        <div className="grid grid-cols-3 gap-3">
                            <Mando icono={Gauge} titulo="Sensibilidad" valor={escena.toFixed(2)} min={0.02} max={0.3} paso={0.01} v={escena} set={setEscena}
                                apagado={modo !== "escena"} />
                            <Mando icono={ScanLine} titulo="Confianza mínima" valor={`${Math.round(confianza * 100)}%`} min={0.2} max={0.95} paso={0.05} v={confianza} set={setConfianza} />
                            <Mando icono={Timer} titulo="Cuadros por segundo" valor={String(fps)} min={0.5} max={10} paso={0.5} v={fps} set={setFps} />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1 bg-white/[0.04] rounded-xl p-1 border border-white/[0.06]">
                                {MODOS.map((o) => {
                                    const bloqueado = !o.puede || (!o.listo && o.id !== "escena") || aplicando;
                                    const activo = modo === o.id;
                                    return (
                                        <button key={o.id} type="button" disabled={bloqueado} onClick={() => cambiarModo(o.id)}
                                            title={!o.puede ? "Esta cámara no ofrece esta analítica" : !o.listo ? o.falta : AYUDA[o.id]}
                                            className={cn("h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap",
                                                activo ? "bg-emerald-600 text-white" : "text-white/60 hover:text-white hover:bg-white/[0.06]",
                                                bloqueado && !activo && "opacity-35 cursor-not-allowed")}>
                                            <o.ic size={12} /> {o.txt}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-white/40 leading-snug max-w-[28rem]">
                                {regla === null ? "consultando qué sabe hacer esta cámara…" : AYUDA[modo]}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Control compacto: rótulo, valor y una barra fina. Entra en el riel sin empujar nada. */
function Mando({ icono: Ic, titulo, valor, min, max, paso, v, set, apagado }:
    { icono: any; titulo: string; valor: string; min: number; max: number; paso: number; v: number; set: (n: number) => void; apagado?: boolean }) {
    return (
        <div className={cn("rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2", apagado && "opacity-45")}>
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
