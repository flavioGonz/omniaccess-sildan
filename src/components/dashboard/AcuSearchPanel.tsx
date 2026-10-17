"use client";

/**
 * Buscar similares (desde la ficha de un evento): el recorte del vehículo o la persona, o una
 * frase, buscado en las cámaras.
 *
 * Rehecho el 17/10 (Nico: «debe ser más estilizado, la animación al centro, debe poder buscar en
 * OmniVision también y ofrecer buscar con texto o foto; cuidar la experiencia»). Lo que cambió:
 *  · DOS MOTORES, elegibles arriba: OmniVision (el registro de detecciones de OmniAccess, por cómo
 *    se ve: foto o frase) y el Grabador (AcuSearch del NVR, por foto). Antes era sólo AcuSearch, y
 *    en San Nicolás se le pedía al NVR 2 —que no lo tiene— y contestaba «socket hang up».
 *  · FOTO o TEXTO: con texto se describe lo que se busca («camioneta blanca con escalera»). El
 *    grabador de este barrio no busca por texto, así que el texto va siempre por OmniVision.
 *  · La espera al centro del panel, y los errores dicen qué hacer (ampliar el rango, probar el
 *    otro motor) en vez de mostrar el mensaje técnico.
 *
 * El nombre del componente se mantiene (AcuSearchPanel) para no tocar a quien lo usa.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Camera, Car, Clock, Film, ImageIcon, Info, Search, Server, SlidersHorizontal, Sparkles, Type, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaHoraSeg } from "@/lib/fechas";
import { Filtros } from "@/components/ui/filtros";
import { Button } from "@/components/ui/button";

export interface AcuMatch { id: number; channel: number; time: string; score?: number; imagePath?: string; targetImagePath?: string; rect?: { x: number; y: number; width: number; height: number }; deviceId?: string; deviceName?: string; attrs?: Record<string, string>; }

type Motor = "omnivision" | "grabador";
type Modo = "foto" | "texto";
/** Un resultado, venga del motor que venga. `score` en 0-100. */
type Hallazgo = {
    clave: string; fuente: Motor; foto: string; recorte?: string | null;
    rect?: { x: number; y: number; width: number; height: number } | null;
    score: number | null; camara: string; deviceId?: string | null; channel?: number; time: string; attrs?: Record<string, string>;
};

const proxyNvr = (u?: string) => (u ? `/api/acuseek/image?u=${encodeURIComponent(u)}` : "");
const imgVision = (clave?: string | null, w?: number) => (clave ? `/api/vision/imagen/${clave}${w ? `?w=${w}` : ""}` : "");
/** Los rangos de cada motor: OmniVision guarda 30 días de huellas; el grabador busca de a pocos días. */
const RANGOS: Record<Motor, { valor: string; rotulo: string; ms: number }[]> = {
    omnivision: [{ valor: "24", rotulo: "24 h", ms: 864e5 }, { valor: "168", rotulo: "7 días", ms: 7 * 864e5 }, { valor: "720", rotulo: "30 días", ms: 30 * 864e5 }],
    grabador: [{ valor: "1", rotulo: "24 h", ms: 864e5 }, { valor: "3", rotulo: "3 días", ms: 3 * 864e5 }, { valor: "7", rotulo: "7 días", ms: 7 * 864e5 }],
};
const CLAVE_MOTOR = "buscar-similares:motor";
const tonoScore = (s: number | null) => s == null ? "bg-black/70 text-white" : s >= 80 ? "pleno-bien" : s >= 65 ? "pleno-aviso" : "bg-black/70 text-white";

/** La espera: el recorte en el centro, con el barrido. Ocupa el centro del panel, no el borde de arriba. */
function Espera({ preview, texto, progreso, detalle }: { preview?: string | null; texto: string; progreso: number | null; detalle: string }) {
    return (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center text-center select-none">
            <svg width="190" height="190" viewBox="0 0 260 260" style={{ color: "var(--accion)" }}>
                <defs>
                    <radialGradient id="bsHalo"><stop offset="0%" stopColor="currentColor" stopOpacity="0.22" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></radialGradient>
                    <linearGradient id="bsBarrido" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="currentColor" stopOpacity="0" /><stop offset="100%" stopColor="currentColor" stopOpacity="0.7" /></linearGradient>
                    <clipPath id="bsRecorte"><circle cx="130" cy="130" r="42" /></clipPath>
                </defs>
                <circle cx="130" cy="130" r="122" fill="url(#bsHalo)" />
                {[0, 1, 2].map((i) => (
                    <circle key={i} cx="130" cy="130" r="46" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0">
                        <animate attributeName="r" values="46;122" dur="2.6s" begin={`${i * 0.87}s`} repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.55;0" dur="2.6s" begin={`${i * 0.87}s`} repeatCount="indefinite" />
                    </circle>
                ))}
                <circle cx="130" cy="130" r="64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 9" opacity="0.6">
                    <animateTransform attributeName="transform" type="rotate" from="0 130 130" to="360 130 130" dur="10s" repeatCount="indefinite" />
                </circle>
                <g><path d="M130 130 L130 26 A104 104 0 0 1 204 56 Z" fill="url(#bsBarrido)" opacity="0.5" />
                    <animateTransform attributeName="transform" type="rotate" from="0 130 130" to="360 130 130" dur="2.4s" repeatCount="indefinite" /></g>
                <circle cx="130" cy="130" r="44" fill="#0b0f17" stroke="currentColor" strokeWidth="2" />
                {preview && <image href={preview} x="86" y="86" width="88" height="88" clipPath="url(#bsRecorte)" preserveAspectRatio="xMidYMid slice" />}
                <rect x="86" y="86" width="88" height="2" fill="currentColor" clipPath="url(#bsRecorte)"><animate attributeName="y" values="86;172;86" dur="1.9s" repeatCount="indefinite" /></rect>
            </svg>
            <p className="mt-2 text-[14px] font-semibold">{texto}</p>
            <p className="text-[12px] text-muted-foreground">{detalle}</p>
            <div className="w-52 h-1 rounded-full bg-muted mt-3 overflow-hidden">
                {progreso == null
                    ? <motion.div className="h-full w-1/3 rounded-full bg-[var(--accion)]" animate={{ x: ["-100%", "300%"] }} transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }} />
                    : <motion.div className="h-full rounded-full bg-[var(--accion)]" animate={{ width: `${Math.max(6, progreso)}%` }} />}
            </div>
        </motion.div>
    );
}

interface Props {
    image: Blob | null;                    // recorte JPEG
    previewUrl?: string | null;
    engine: "vehicle" | "human";
    onEngineChange?: (e: "vehicle" | "human") => void;
    centerTimeMs?: number;                 // centro del rango (el evento) — por defecto ahora
    onBack: () => void;
    onOpenRecording?: (m: AcuMatch) => void;
    title?: string;
}

export function AcuSearchPanel({ image, previewUrl, engine, onEngineChange, centerTimeMs, onBack, onOpenRecording, title }: Props) {
    const [motor, setMotorEstado] = useState<Motor>("omnivision");
    useEffect(() => { try { const v = localStorage.getItem(CLAVE_MOTOR); if (v === "grabador" || v === "omnivision") setMotorEstado(v); } catch { } }, []);
    const setMotor = (m: Motor) => { setMotorEstado(m); try { localStorage.setItem(CLAVE_MOTOR, m); } catch { } };
    const [modo, setModo] = useState<Modo>(image ? "foto" : "texto");
    const [texto, setTexto] = useState("");
    const [consulta, setConsulta] = useState("");     // la frase que se buscó (al apretar Enter)
    const [rangoIdx, setRangoIdx] = useState(0);
    const [similitud, setSimilitud] = useState(70);
    const [buscando, setBuscando] = useState(false);
    const [progreso, setProgreso] = useState<number | null>(null);
    const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
    const [total, setTotal] = useState(0);
    const [aviso, setAviso] = useState<{ texto: string; sinGrabador?: boolean } | null>(null);
    const [visto, setVisto] = useState<Hallazgo | null>(null);
    const poll = useRef<any>(null);
    const corrida = useRef(0);

    const rango = RANGOS[motor][rangoIdx];
    // El texto sólo lo busca OmniVision: si se pasa a texto con el grabador elegido, se cambia y se dice.
    const motorEfectivo: Motor = modo === "texto" ? "omnivision" : motor;

    const buscar = useCallback(async () => {
        const mia = ++corrida.current;
        if (poll.current) clearInterval(poll.current);
        setHallazgos([]); setTotal(0); setAviso(null); setProgreso(null);
        if (modo === "texto" && !consulta.trim()) { setBuscando(false); return; }
        if (modo === "foto" && !image) { setBuscando(false); setAviso({ texto: "Este evento no tiene recorte para buscar. Escribí qué buscar." }); return; }
        setBuscando(true);
        const grupo = engine === "vehicle" ? "vehiculo" : "persona";
        try {
            if (motorEfectivo === "omnivision") {
                const h = RANGOS.omnivision[rangoIdx].valor;
                const r = modo === "texto"
                    ? await fetch(`/api/vision/buscar?${new URLSearchParams({ q: consulta.trim(), h, grupo })}`, { cache: "no-store" })
                    : await fetch(`/api/vision/buscar?${new URLSearchParams({ h, grupo })}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: image! });
                const j = await r.json().catch(() => ({}));
                if (mia !== corrida.current) return;
                if (!r.ok) throw new Error(j?.error || `OmniVision respondió ${r.status}`);
                const lista: Hallazgo[] = (j.resultados || []).map((f: any) => {
                    const c = Array.isArray(f.caja) && f.caja.every((x: number) => x >= 0 && x <= 1) ? f.caja : null;
                    const p = f.prob != null ? f.prob : f.coseno;
                    return {
                        clave: `ov-${f.id}`, fuente: "omnivision", foto: imgVision(f.foto || f.recorte, 960), recorte: imgVision(f.recorte, 360),
                        rect: c ? { x: c[0], y: c[1], width: c[2] - c[0], height: c[3] - c[1] } : null,
                        score: p != null ? Math.round(p * 100) : null, camara: f.camara || "Cámara", deviceId: f.deviceId, time: f.ultimaVez || f.primeraVez,
                    } as Hallazgo;
                });
                setHallazgos(lista); setTotal(lista.length); setBuscando(false);
                if (!lista.length) setAviso({ texto: modo === "texto" ? "OmniVision no encontró nada parecido a esa descripción en ese rango." : "OmniVision no encontró nada parecido en ese rango." });
                return;
            }
            // Grabador (AcuSearch): crea la tarea y se consulta su avance.
            const centro = centerTimeMs || Date.now();
            const mitad = rango.ms / 2;
            const fd = new FormData();
            fd.append("file", image!, "ref.jpg");
            fd.append("from", new Date(centro - mitad).toISOString());
            fd.append("to", new Date(Math.min(Date.now(), centro + mitad)).toISOString());
            fd.append("similarity", String(similitud / 100)); fd.append("engine", engine);
            const j = await fetch("/api/acuseek/image-search", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: "No se pudo pedir" }));
            if (mia !== corrida.current) return;
            if (!j.ok) { setBuscando(false); setAviso({ texto: j.sinAcuSeek ? j.error : `El grabador no pudo buscar: ${j.error || "sin respuesta"}.`, sinGrabador: true }); return; }
            setProgreso(0);
            let vueltas = 0;
            poll.current = setInterval(async () => {
                vueltas++;
                const pr = await fetch(`/api/acuseek/image-search?taskId=${encodeURIComponent(j.taskID)}&max=60&engine=${engine}&minScore=${similitud}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
                if (!pr || mia !== corrida.current) return;
                if (!pr.ok) { clearInterval(poll.current); setBuscando(false); setAviso({ texto: `El grabador cortó la búsqueda: ${pr.error || "sin respuesta"}.`, sinGrabador: true }); return; }
                if (pr.progress != null) setProgreso(Number(pr.progress));
                if (pr.totalMatches != null) setTotal(pr.totalMatches);
                if (pr.status === "completed" || vueltas > 45) {
                    clearInterval(poll.current); setBuscando(false);
                    const lista: Hallazgo[] = (pr.matches || []).map((m: any) => ({
                        clave: `nvr-${m.id}-${m.channel}`, fuente: "grabador", foto: proxyNvr(m.imagePath), recorte: m.targetImagePath ? proxyNvr(m.targetImagePath) : null,
                        rect: m.rect || null, score: m.score ?? null, camara: m.deviceName || `Canal ${m.channel}`, deviceId: m.deviceId, channel: m.channel, time: m.time, attrs: m.attrs,
                    }));
                    setHallazgos(lista);
                    if (!lista.length) setAviso({ texto: "El grabador no encontró coincidencias en ese rango." });
                }
            }, 1200);
        } catch (e: any) {
            if (mia !== corrida.current) return;
            setBuscando(false); setAviso({ texto: e?.message || "No se pudo buscar." });
        }
    }, [modo, consulta, image, engine, motorEfectivo, rangoIdx, rango, similitud, centerTimeMs]);

    // Se busca solo al cambiar lo que define la búsqueda (no la similitud mientras se arrastra).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { buscar(); return () => { if (poll.current) clearInterval(poll.current); }; }, [image, engine, motorEfectivo, rangoIdx, modo, consulta]);

    const abrirGrabacion = (h: Hallazgo) => onOpenRecording?.({ id: 0, channel: h.channel ?? 0, time: h.time, deviceId: h.deviceId || undefined, deviceName: h.camara });
    const otroRango = rangoIdx < RANGOS[motorEfectivo].length - 1;
    const nombreMotor = motorEfectivo === "omnivision" ? "OmniVision" : "el grabador";

    return (
        <div className="absolute inset-0 z-40 bg-background flex flex-col">
            {/* Cabecera: qué se busca */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-3.5 shrink-0">
                <button onClick={onBack} aria-label="Volver a la ficha" className="h-9 w-9 rounded-full hover:bg-accent grid place-items-center shrink-0"><ArrowLeft size={17} /></button>
                <div className="relative h-12 w-12 rounded-[10px] overflow-hidden bg-muted shrink-0 ring-1 ring-border">
                    {modo === "foto" && previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : <span className="h-full w-full grid place-items-center text-muted-foreground"><Type size={18} /></span>}
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-[16px] font-bold tracking-tight truncate">{modo === "texto" ? (consulta ? `«${consulta}»` : "Buscar por descripción") : (title || "Similares en las cámaras")}</h3>
                    <p className="text-[12px] text-muted-foreground truncate">
                        {buscando ? `Buscando en ${nombreMotor}…` : hallazgos.length ? `${total || hallazgos.length} ${(total || hallazgos.length) === 1 ? "coincidencia" : "coincidencias"} · ${nombreMotor} · ${rango.rotulo.toLowerCase()}` : `${nombreMotor === "OmniVision" ? "OmniVision" : "Grabador"} · ${RANGOS[motorEfectivo][rangoIdx].rotulo.toLowerCase()}`}
                    </p>
                </div>
                <button onClick={onBack} aria-label="Cerrar" className="h-9 w-9 rounded-full hover:bg-accent grid place-items-center shrink-0 text-muted-foreground"><X size={17} /></button>
            </div>

            {/* Cómo se busca: motor, foto o texto, qué, cuándo */}
            <div className="px-5 pb-3 border-b border-border shrink-0">
                <Filtros className="gap-2" grupos={[
                    { clave: "motor", titulo: "Dónde buscar", valor: motorEfectivo, alElegir: (v) => { setMotor(v as Motor); if (v === "grabador") setModo("foto"); },
                        opciones: [{ valor: "omnivision", rotulo: "OmniVision", icono: Sparkles, titulo: "El registro de detecciones de OmniAccess: por foto o por descripción" },
                            { valor: "grabador", rotulo: "Grabador", icono: Server, titulo: "AcuSearch del NVR: busca la foto en lo grabado" }] },
                    { clave: "modo", titulo: "Con qué", valor: modo, alElegir: (v) => setModo(v as Modo),
                        opciones: [{ valor: "foto", rotulo: "Foto", icono: ImageIcon, titulo: "El recorte de este evento" }, { valor: "texto", rotulo: "Texto", icono: Type, titulo: "Describir lo que se busca (sólo OmniVision)" }] },
                    { clave: "que", titulo: "Qué", valor: engine, alElegir: (v) => onEngineChange?.(v as any),
                        opciones: [{ valor: "vehicle", rotulo: "", icono: Car, titulo: "Vehículos" }, { valor: "human", rotulo: "", icono: User, titulo: "Personas" }] },
                    { clave: "rango", titulo: "Cuándo", valor: String(rangoIdx), alElegir: (v) => setRangoIdx(Number(v)),
                        opciones: RANGOS[motorEfectivo].map((r, i) => ({ valor: String(i), rotulo: r.rotulo })) },
                ]}>
                    {modo === "texto" && (
                        <form onSubmit={(e) => { e.preventDefault(); setConsulta(texto.trim()); if (texto.trim() === consulta) buscar(); }} className="flex-1 min-w-[220px] flex items-center gap-2 h-[34px] px-3 rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-[var(--accion)]/30">
                            <Search size={14} className="text-muted-foreground shrink-0" />
                            <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="camioneta blanca con escalera, moto roja, persona con mochila…" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
                            <kbd className="text-[10px] text-muted-foreground">Enter</kbd>
                        </form>
                    )}
                    {motorEfectivo === "grabador" && (
                        <span className="flex items-center gap-2 h-[34px] px-3 rounded-lg bg-muted/60" title="Similitud mínima que pide el grabador">
                            <SlidersHorizontal size={13} className="text-muted-foreground" />
                            <input type="range" min={40} max={95} value={similitud} onChange={(e) => setSimilitud(Number(e.target.value))} onMouseUp={buscar} onTouchEnd={buscar} className="w-24 accent-[var(--accion)]" />
                            <span className="text-[12px] font-semibold tabular-nums w-9">{similitud} %</span>
                        </span>
                    )}
                </Filtros>
            </div>

            {/* Resultados, o la espera al centro */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {buscando ? (
                    <div className="h-full grid place-items-center p-6">
                        <AnimatePresence><Espera key="e" preview={modo === "foto" ? previewUrl : null}
                            texto={motorEfectivo === "omnivision" ? "Buscando en OmniVision" : "Buscando en el grabador"}
                            detalle={motorEfectivo === "omnivision" ? "Comparando con todo lo que registraron las cámaras" : progreso ? `${progreso} % de lo grabado` : "El grabador está preparando la búsqueda…"}
                            progreso={motorEfectivo === "grabador" ? progreso : null} /></AnimatePresence>
                    </div>
                ) : aviso || (modo === "texto" && !consulta) ? (
                    <div className="h-full grid place-items-center p-6">
                        <div className="max-w-[420px] text-center flex flex-col items-center gap-3">
                            <span className="h-12 w-12 rounded-full bg-muted grid place-items-center text-muted-foreground">{modo === "texto" && !consulta ? <Type size={20} /> : <Info size={20} />}</span>
                            <p className="text-[14px] font-semibold">{modo === "texto" && !consulta ? "Describí lo que buscás" : aviso?.texto}</p>
                            {modo === "texto" && !consulta && <p className="text-[12.5px] text-muted-foreground">Con palabras simples: color, tipo de vehículo, algo que lleve. OmniVision lo compara con todo lo que vieron las cámaras.</p>}
                            {aviso && <div className="flex items-center gap-2 flex-wrap justify-center">
                                {otroRango && !aviso.sinGrabador && <Button size="sm" variant="outline" onClick={() => setRangoIdx(rangoIdx + 1)}>Ampliar a {RANGOS[motorEfectivo][rangoIdx + 1].rotulo}</Button>}
                                {motorEfectivo === "grabador"
                                    ? <Button size="sm" onClick={() => setMotor("omnivision")}><Sparkles size={14} /> Buscar en OmniVision</Button>
                                    : modo === "foto" && <Button size="sm" variant="outline" onClick={() => setMotor("grabador")}><Server size={14} /> Probar en el grabador</Button>}
                            </div>}
                        </div>
                    </div>
                ) : (
                    <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                        {hallazgos.map((h, i) => (
                            <motion.button key={h.clave} type="button" onClick={() => setVisto(h)}
                                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.025 }}
                                className="group text-left rounded-[10px] border border-border bg-card overflow-hidden hover:border-[var(--accion)] transition-colors">
                                <div className="relative aspect-video bg-black overflow-hidden">
                                    {(h.recorte || h.foto) ? <img src={h.fuente === "omnivision" ? (h.recorte || h.foto) : h.foto} alt="" loading="lazy" className={cn("w-full h-full group-hover:scale-[1.04] transition-transform duration-300", h.fuente === "omnivision" && h.recorte ? "object-contain" : "object-cover")} />
                                        : <span className="h-full w-full grid place-items-center text-white/30"><Camera size={20} /></span>}
                                    {h.fuente === "grabador" && h.rect && <span className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-[3px] pointer-events-none" style={{ left: `${h.rect.x * 100}%`, top: `${h.rect.y * 100}%`, width: `${h.rect.width * 100}%`, height: `${h.rect.height * 100}%` }} />}
                                    {h.score != null && <span className={cn("absolute top-1.5 left-1.5 h-5 px-1.5 rounded-md text-[10.5px] font-bold tabular-nums grid place-items-center", tonoScore(h.score))}>{h.score} %</span>}
                                </div>
                                <div className="px-2.5 py-2">
                                    <div className="text-[12.5px] font-semibold truncate">{h.camara}</div>
                                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums"><Clock size={10} /> {h.time ? fechaHoraSeg(new Date(h.time)) : "—"}</div>
                                </div>
                            </motion.button>
                        ))}
                    </div>
                )}
            </div>

            {/* Lo elegido, grande, con su recuadro */}
            <AnimatePresence>
                {visto && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setVisto(null)}>
                        <div className="relative max-w-full" onClick={(e) => e.stopPropagation()}>
                            <div className="relative">
                                <img src={visto.foto || visto.recorte || ""} alt="" className="max-h-[72vh] max-w-full object-contain rounded-[10px]" />
                                {visto.rect && <span className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-[3px] pointer-events-none" style={{ left: `${visto.rect.x * 100}%`, top: `${visto.rect.y * 100}%`, width: `${visto.rect.width * 100}%`, height: `${visto.rect.height * 100}%` }} />}
                            </div>
                            <div className="mt-3 flex items-center gap-3 text-white">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[14px] font-semibold truncate">{visto.camara}</div>
                                    <div className="text-[12px] text-white/65 tabular-nums">{visto.time ? fechaHoraSeg(new Date(visto.time)) : ""}{visto.score != null ? ` · ${visto.score} % parecido` : ""} · {visto.fuente === "omnivision" ? "OmniVision" : "Grabador"}</div>
                                </div>
                                {onOpenRecording && (visto.deviceId || visto.channel) && <Button size="sm" onClick={() => { abrirGrabacion(visto); setVisto(null); }}><Film size={14} /> Ver la grabación</Button>}
                                <button onClick={() => setVisto(null)} aria-label="Cerrar" className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center"><X size={16} /></button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
