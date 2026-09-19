"use client";

/** AcuSearchPanel — busca un recorte (Blob JPEG) en todas las cámaras del NVR (AcuSearch) y muestra
 *  la grilla de coincidencias. Pensado para embeberse en modales (evento, vehículo, etc.). */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Car, User, Film, Search, Clock, Camera, X, ArrowLeft, Info, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { fecha, fechaHoraSeg } from "@/lib/fechas";

export interface AcuMatch { id: number; channel: number; time: string; score?: number; imagePath?: string; targetImagePath?: string; rect?: { x: number; y: number; width: number; height: number }; deviceId?: string; deviceName?: string; attrs?: Record<string, string>; }
const imgProxy = (u?: string) => u ? `/api/acuseek/image?u=${encodeURIComponent(u)}` : "";
const scoreColor = (s?: number) => s == null ? "text-muted-foreground" : s >= 80 ? "text-emerald-400" : s >= 65 ? "text-amber-400" : "text-orange-400";
const RANGES = [{ k: 1, l: "24 h" }, { k: 3, l: "3 días" }, { k: 7, l: "7 días" }];
const ATTR_ES: Record<string, string> = { vehicleType: "tipo", vehicleColor: "color", gender: "género", bag: "mochila", jacketColor: "ropa", ride: "vehículo", glass: "gafas", ageGroup: "edad" };

function Splash({ preview, progress, tone }: { preview?: string | null; progress?: number; tone: "fuchsia" | "violet" }) {
    const c = tone === "violet" ? "#a78bfa" : "#e879f9", c2 = tone === "violet" ? "#d946ef" : "#f472b6";
    return (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-10 select-none">
            <svg width="200" height="200" viewBox="0 0 260 260">
                <defs><radialGradient id="acuP"><stop offset="0%" stopColor={c} stopOpacity="0.35" /><stop offset="100%" stopColor={c} stopOpacity="0" /></radialGradient><linearGradient id="acuPb" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={c2} stopOpacity="0" /><stop offset="100%" stopColor={c2} stopOpacity="0.9" /></linearGradient><clipPath id="acuPc"><circle cx="130" cy="130" r="34" /></clipPath></defs>
                <circle cx="130" cy="130" r="120" fill="url(#acuP)" />
                {[0, 1, 2].map(i => <circle key={i} cx="130" cy="130" r="40" fill="none" stroke={c} strokeWidth="1.5" opacity="0"><animate attributeName="r" values="40;120" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" /><animate attributeName="opacity" values="0.7;0" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" /></circle>)}
                <circle cx="130" cy="130" r="58" fill="none" stroke={c} strokeWidth="2" strokeDasharray="4 10" opacity="0.7"><animateTransform attributeName="transform" type="rotate" from="0 130 130" to="360 130 130" dur="9s" repeatCount="indefinite" /></circle>
                <g><path d="M130 130 L130 30 A100 100 0 0 1 200 59 Z" fill="url(#acuPb)" opacity="0.55" /><animateTransform attributeName="transform" type="rotate" from="0 130 130" to="360 130 130" dur="2.2s" repeatCount="indefinite" /></g>
                {[0, 1, 2, 3, 4, 5].map(i => { const a = (i / 6) * Math.PI * 2; const x = 130 + Math.cos(a) * 96, y = 130 + Math.sin(a) * 96; return <g key={i}><circle cx={x} cy={y} r="5" fill={c2}><animate attributeName="r" values="4;7;4" dur="1.6s" begin={`${i * 0.25}s`} repeatCount="indefinite" /></circle><circle cx={x} cy={y} r="10" fill="none" stroke={c2} strokeWidth="1"><animate attributeName="r" values="6;16" dur="1.6s" begin={`${i * 0.25}s`} repeatCount="indefinite" /><animate attributeName="opacity" values="0.5;0" dur="1.6s" begin={`${i * 0.25}s`} repeatCount="indefinite" /></circle></g>; })}
                <circle cx="130" cy="130" r="36" fill="#0b0b12" stroke={c} strokeWidth="2" />
                {preview ? <image href={preview} x="96" y="96" width="68" height="68" clipPath="url(#acuPc)" preserveAspectRatio="xMidYMid slice" /> : null}
                <rect x="94" y="94" width="72" height="2" fill={c2} clipPath="url(#acuPc)"><animate attributeName="y" values="94;164;94" dur="1.8s" repeatCount="indefinite" /></rect>
            </svg>
            <p className="text-sm font-bold">Buscando en todas las cámaras</p>
            <p className="text-xs text-muted-foreground">{progress ? `${progress}%` : "Iniciando…"}</p>
            <div className="w-48 h-1 rounded-full bg-muted/40 mt-3 overflow-hidden"><motion.div className="h-full" style={{ background: `linear-gradient(90deg, ${c}, ${c2})` }} animate={{ width: `${Math.max(6, progress || 0)}%` }} /></div>
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
    const [days, setDays] = useState(1);
    const [minScore, setMinScore] = useState(70);
    const [searching, setSearching] = useState(false);
    const [progress, setProgress] = useState(0);
    const [results, setResults] = useState<AcuMatch[]>([]);
    const [total, setTotal] = useState(0);
    const [msg, setMsg] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<AcuMatch | null>(null);
    const poll = useRef<any>(null);
    const runId = useRef(0);

    async function run() {
        if (!image) return;
        const my = ++runId.current;
        if (poll.current) clearInterval(poll.current);
        setSearching(true); setProgress(0); setResults([]); setTotal(0); setMsg(null);
        const center = centerTimeMs || Date.now();
        const half = (days * 86400000) / 2;
        const from = new Date(center - half).toISOString();
        const to = new Date(Math.min(Date.now(), center + half)).toISOString();
        try {
            const fd = new FormData();
            fd.append("file", image, "ref.jpg"); fd.append("from", from); fd.append("to", to);
            fd.append("similarity", String(minScore / 100)); fd.append("engine", engine);
            const j = await fetch("/api/acuseek/image-search", { method: "POST", body: fd }).then(r => r.json());
            if (my !== runId.current) return;
            if (!j.ok) { setMsg(j.error || "No se pudo iniciar la búsqueda."); setSearching(false); return; }
            let tries = 0;
            poll.current = setInterval(async () => {
                tries++;
                const pr = await fetch(`/api/acuseek/image-search?taskId=${encodeURIComponent(j.taskID)}&max=60&engine=${engine}&minScore=${minScore}`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
                if (!pr || my !== runId.current) return;
                if (!pr.ok) { clearInterval(poll.current); setMsg(pr.error || "Error en la búsqueda."); setSearching(false); return; }
                if (pr.progress != null) setProgress(Number(pr.progress));
                if (pr.totalMatches != null) setTotal(pr.totalMatches);
                if (pr.status === "completed" || tries > 45) {
                    clearInterval(poll.current); setSearching(false);
                    setResults(pr.matches || []);
                    if (!pr.matches?.length) setMsg("Sin coincidencias en ese rango. Probá ampliar los días o bajar la similitud.");
                }
            }, 1200);
        } catch (e: any) { setMsg(e?.message || "Error de red."); setSearching(false); }
    }
    useEffect(() => { run(); return () => { if (poll.current) clearInterval(poll.current); }; /* eslint-disable-next-line */ }, [image, engine, days]);

    return (
        <div className="absolute inset-0 z-40 bg-background flex flex-col">
            {/* header */}
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-3 shrink-0 bg-gradient-to-r from-fuchsia-500/[0.06] to-transparent">
                <button onClick={onBack} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-foreground"><ArrowLeft size={16} /></button>
                {previewUrl && <img src={previewUrl} alt="" className="h-9 w-9 rounded-md object-cover border border-fuchsia-500/50" />}
                <div className="min-w-0">
                    <h3 className="text-sm font-bold flex items-center gap-2">{title || "Similares en todas las cámaras"} <span className="text-[9px] font-black bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">ACUSEARCH</span></h3>
                    <p className="text-[11px] text-muted-foreground">{searching ? "buscando…" : total ? `${total} coincidencia${total === 1 ? "" : "s"}${results.length < total ? ` · mostrando ${results.length}` : ""}` : "—"}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="flex items-center bg-background/60 p-0.5 rounded-lg border border-border/60">
                        <button onClick={() => onEngineChange?.("vehicle")} title="Vehículos" className={cn("h-7 w-7 rounded-md flex items-center justify-center", engine === "vehicle" ? "bg-fuchsia-500/20 text-fuchsia-300" : "text-muted-foreground hover:text-foreground")}><Car size={14} /></button>
                        <button onClick={() => onEngineChange?.("human")} title="Personas" className={cn("h-7 w-7 rounded-md flex items-center justify-center", engine === "human" ? "bg-fuchsia-500/20 text-fuchsia-300" : "text-muted-foreground hover:text-foreground")}><User size={14} /></button>
                    </div>
                    <div className="flex items-center bg-background/60 p-0.5 rounded-lg border border-border/60">
                        {RANGES.map(r => <button key={r.k} onClick={() => setDays(r.k)} className={cn("h-7 px-2 rounded-md text-[11px] font-bold", days === r.k ? "bg-violet-500/20 text-violet-300" : "text-muted-foreground hover:text-foreground")}>{r.l}</button>)}
                    </div>
                    <div className="flex items-center gap-1.5 h-8 px-2 rounded-lg bg-background/60 border border-border/60" title="Similitud mínima">
                        <SlidersHorizontal size={12} className="text-muted-foreground" />
                        <input type="range" min={40} max={95} value={minScore} onChange={e => setMinScore(Number(e.target.value))} onMouseUp={run} onTouchEnd={run} className="w-20 accent-fuchsia-500" />
                        <span className="text-[11px] font-mono font-bold text-fuchsia-400 w-8">{minScore}%</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                <AnimatePresence>{searching && <Splash key="s" preview={previewUrl} progress={progress} tone="fuchsia" />}</AnimatePresence>
                {msg && !searching && <div className="text-sm text-muted-foreground flex items-center gap-2 py-10 justify-center"><Info size={14} /> {msg}</div>}
                {!searching && results.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                        {results.map((m, idx) => (
                            <motion.div key={m.id} initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: Math.min(idx, 20) * 0.03 }} className="rounded-lg border border-border bg-card overflow-hidden group hover:border-fuchsia-500/40">
                                <button onClick={() => setLightbox(m)} className="block w-full aspect-video bg-background relative overflow-hidden">
                                    {m.imagePath ? <img src={imgProxy(m.imagePath)} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center"><Camera size={20} className="text-muted-foreground/40" /></div>}
                                    {m.rect && <div className="absolute border-2 border-fuchsia-400 rounded-sm pointer-events-none" style={{ left: `${m.rect.x * 100}%`, top: `${m.rect.y * 100}%`, width: `${m.rect.width * 100}%`, height: `${m.rect.height * 100}%` }} />}
                                    {m.score != null && <span className={cn("absolute top-1 left-1 text-[10px] font-black px-1.5 py-0.5 rounded bg-black/75", scoreColor(m.score))}>{m.score}%</span>}
                                    {onOpenRecording && <span onClick={e => { e.stopPropagation(); onOpenRecording(m); }} title="Ver grabación" className="absolute bottom-1 right-1 h-7 w-7 rounded-md bg-blue-600/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Film size={13} /></span>}
                                </button>
                                <div className="px-2 py-1.5 text-[11px]">
                                    <div className="font-bold truncate">{m.deviceName || `Canal ${m.channel}`}</div>
                                    <div className="flex items-center gap-1 text-muted-foreground"><Clock size={10} /> {m.time ? fechaHoraSeg(new Date(m.time)) : "—"}</div>
                                    {m.attrs && <div className="flex flex-wrap gap-1 mt-1">{Object.entries(m.attrs).slice(0, 3).map(([k, v]) => <span key={k} className="text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground" title={ATTR_ES[k] || k}>{v}</span>)}</div>}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>

            {lightbox && (
                <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
                    <div className="relative max-w-full" onClick={e => e.stopPropagation()}>
                        <img src={imgProxy(lightbox.imagePath)} alt="" className="max-h-[70vh] max-w-full object-contain rounded-lg" />
                        {lightbox.rect && <div className="absolute border-2 border-fuchsia-400 rounded-sm pointer-events-none" style={{ left: `${lightbox.rect.x * 100}%`, top: `${lightbox.rect.y * 100}%`, width: `${lightbox.rect.width * 100}%`, height: `${lightbox.rect.height * 100}%` }} />}
                        <div className="absolute top-2 right-2 flex gap-2">
                            {onOpenRecording && <button onClick={() => { onOpenRecording(lightbox); setLightbox(null); }} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5"><Film size={13} /> Grabación</button>}
                            <button onClick={() => setLightbox(null)} className="h-8 w-8 rounded-lg bg-white/10 text-white flex items-center justify-center"><X size={14} /></button>
                        </div>
                        <div className="absolute bottom-2 left-2 text-xs text-white/90 bg-black/60 rounded-md px-2 py-1 flex items-center gap-2"><span className="font-bold">{lightbox.deviceName || `Canal ${lightbox.channel}`}</span>{lightbox.score != null && <span className={scoreColor(lightbox.score)}>{lightbox.score}%</span>}<span>{lightbox.time ? fecha(new Date(lightbox.time)) : ""}</span></div>
                    </div>
                </div>
            )}
        </div>
    );
}
