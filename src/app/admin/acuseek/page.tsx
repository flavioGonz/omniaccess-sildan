"use client";

import { useEffect, useRef, useState, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Search, AlertTriangle, ChevronDown, Camera, Clock, Film, Info, X, History, Car, User, Bike, SlidersHorizontal, RotateCw, Lightbulb, CalendarDays, ImagePlus, Trash2, Video, ScanLine, LogIn, LogOut, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NvrTimeMachine } from "@/components/dashboard/NvrTimeMachine";

const imgProxy = (u?: string) => u ? `/api/acuseek/image?u=${encodeURIComponent(u)}` : "";
const RANGES = [{ k: "today", l: "Hoy", days: 0 }, { k: "3d", l: "3 días", days: 3 }, { k: "7d", l: "7 días", days: 7 }, { k: "30d", l: "30 días", days: 30 }];

interface Status { ok: boolean; supported?: boolean; activated?: boolean; reason?: string; nvr?: { name: string; ip: string; model: string }; capabilities?: Record<string, boolean>; examples?: string[]; recent?: string[]; cameras?: { channel: number; name: string }[]; error?: string; }
interface Match { id: number; channel: number; time: string; targetType?: string; score?: number; imagePath?: string; targetImagePath?: string; rect?: { x: number; y: number; width: number; height: number }; deviceId?: string; deviceName?: string; attrs?: Record<string, string>; }
/** Resultado de la fuente propia (eventos de acceso LPR, no depende del NVR) */
interface LprMatch { id: string; time: string; plate?: string | null; direction?: string; decision?: string; deviceId?: string | null; deviceName?: string | null; imagePath?: string | null; cropPath?: string | null; brand?: string | null; color?: string | null; type?: string | null; typeEs?: string | null; user?: string | null; unit?: string | null; }
const LPR_EXAMPLES = ["camioneta blanca ayer", "autos negros por P7", "buggy el fin de semana", "no autorizados de noche", "Toyota gris esta semana"];
const ATTR_ES: Record<string, string> = { gender: "género", glass: "gafas", ageGroup: "edad", ride: "vehículo", bag: "mochila", jacketColor: "ropa", direction: "dirección", speed: "velocidad", targetSize: "tamaño", vehicleType: "tipo", vehicleColor: "color", plateType: "matrícula", plateColor: "color matrícula", vehicleHead: "frente", sunroof: "techo", luggageRack: "portaequipaje", spareTire: "rueda aux.", pilotSafebelt: "cinturón", uphone: "celular" };

const scoreColor = (s?: number) => s == null ? "text-muted-foreground" : s >= 80 ? "text-emerald-400" : s >= 65 ? "text-amber-400" : "text-orange-400";
const TargetIcon = ({ t }: { t?: string }) => t === "vehicle" ? <Car size={11} /> : t === "human" ? <User size={11} /> : t === "nonmotorVehicle" ? <Bike size={11} /> : <Camera size={11} />;

function rangeToDates(k: string): { from: string; to: string } {
    const now = new Date();
    const r = RANGES.find(x => x.k === k) || RANGES[0];
    const start = new Date(now); start.setDate(now.getDate() - r.days); start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
}

/* ───────── Tooltip animado (hover) ───────── */
function Tip({ label, children, side = "bottom" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
    const [on, setOn] = useState(false);
    return (
        <span className="relative inline-flex" onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)}>
            {children}
            <AnimatePresence>
                {on && (
                    <motion.span initial={{ opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: side === "bottom" ? -4 : 4, scale: 0.9 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}
                        className={cn("pointer-events-none absolute left-1/2 -translate-x-1/2 z-[60] whitespace-nowrap rounded-md bg-zinc-900 text-white text-[10.5px] font-semibold px-2 py-1 shadow-xl border border-white/10", side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5")}>
                        {label}
                        <span className={cn("absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-zinc-900 border-white/10", side === "bottom" ? "-top-1 border-l border-t" : "-bottom-1 border-r border-b")} />
                    </motion.span>
                )}
            </AnimatePresence>
        </span>
    );
}

/* ───────── Botón de ícono ───────── */
function IconBtn({ tip, active, onClick, children, className, disabled, tone = "violet" }: { tip: ReactNode; active?: boolean; onClick?: () => void; children: ReactNode; className?: string; disabled?: boolean; tone?: "violet" | "fuchsia" }) {
    const act = tone === "violet" ? "bg-violet-500/20 text-violet-300 border-violet-500/40" : "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40";
    return (
        <Tip label={tip}>
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={onClick} disabled={disabled}
                className={cn("h-9 w-9 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-40", active ? act : "bg-background/60 border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent", className)}>
                {children}
            </motion.button>
        </Tip>
    );
}

/* ───────── Popover simple ───────── */
function Pop({ open, onClose, children, align = "right" }: { open: boolean; onClose: () => void; children: ReactNode; align?: "left" | "right" }) {
    return (
        <AnimatePresence>
            {open && (
                <>
                    <div className="fixed inset-0 z-[55]" onClick={onClose} />
                    <motion.div initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}
                        className={cn("absolute top-full mt-2 z-[56] rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-2xl p-3 min-w-[240px]", align === "right" ? "right-0" : "left-0")}>
                        {children}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

/* ───────── Splash SVG animado de búsqueda ───────── */
function SearchSplash({ preview, label, progress, tone }: { preview?: string | null; label: string; progress?: number; tone: "violet" | "fuchsia" }) {
    const c = tone === "violet" ? "#a78bfa" : "#e879f9";
    const c2 = tone === "violet" ? "#d946ef" : "#f472b6";
    return (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="relative flex flex-col items-center justify-center py-8 select-none">
            <svg width="260" height="260" viewBox="0 0 260 260" className="drop-shadow-[0_0_24px_rgba(168,85,247,0.25)]">
                <defs>
                    <radialGradient id="acuGlow"><stop offset="0%" stopColor={c} stopOpacity="0.35" /><stop offset="100%" stopColor={c} stopOpacity="0" /></radialGradient>
                    <linearGradient id="acuBeam" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={c2} stopOpacity="0" /><stop offset="100%" stopColor={c2} stopOpacity="0.9" /></linearGradient>
                    <clipPath id="acuClip"><circle cx="130" cy="130" r="34" /></clipPath>
                </defs>
                <circle cx="130" cy="130" r="120" fill="url(#acuGlow)" />
                {/* ondas / ripples */}
                {[0, 1, 2].map(i => (
                    <circle key={i} cx="130" cy="130" r="40" fill="none" stroke={c} strokeWidth="1.5" opacity="0">
                        <animate attributeName="r" values="40;120" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.7;0" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
                    </circle>
                ))}
                {/* anillo punteado giratorio */}
                <circle cx="130" cy="130" r="58" fill="none" stroke={c} strokeWidth="2" strokeDasharray="4 10" opacity="0.7">
                    <animateTransform attributeName="transform" type="rotate" from="0 130 130" to="360 130 130" dur="9s" repeatCount="indefinite" />
                </circle>
                {/* haz de radar */}
                <g>
                    <path d="M130 130 L130 30 A100 100 0 0 1 200 59 Z" fill="url(#acuBeam)" opacity="0.55" />
                    <animateTransform attributeName="transform" type="rotate" from="0 130 130" to="360 130 130" dur="2.2s" repeatCount="indefinite" />
                </g>
                {/* cámaras orbitando */}
                {[0, 1, 2, 3, 4, 5].map(i => {
                    const a = (i / 6) * Math.PI * 2; const x = 130 + Math.cos(a) * 96, y = 130 + Math.sin(a) * 96;
                    return (
                        <g key={i}>
                            <circle cx={x} cy={y} r="5" fill={c2} opacity="0.9">
                                <animate attributeName="r" values="4;7;4" dur="1.6s" begin={`${i * 0.25}s`} repeatCount="indefinite" />
                            </circle>
                            <circle cx={x} cy={y} r="10" fill="none" stroke={c2} strokeWidth="1" opacity="0.4">
                                <animate attributeName="r" values="6;16" dur="1.6s" begin={`${i * 0.25}s`} repeatCount="indefinite" />
                                <animate attributeName="opacity" values="0.5;0" dur="1.6s" begin={`${i * 0.25}s`} repeatCount="indefinite" />
                            </circle>
                        </g>
                    );
                })}
                {/* núcleo: foto de referencia o lupa */}
                <circle cx="130" cy="130" r="36" fill="#0b0b12" stroke={c} strokeWidth="2" />
                {preview ? <image href={preview} x="96" y="96" width="68" height="68" clipPath="url(#acuClip)" preserveAspectRatio="xMidYMid slice" />
                    : <g transform="translate(112,112)"><circle cx="15" cy="15" r="11" fill="none" stroke={c} strokeWidth="3" /><path d="M23 23 L34 34" stroke={c} strokeWidth="3.5" strokeLinecap="round" /></g>}
                {/* línea de escaneo sobre el núcleo */}
                <rect x="94" y="94" width="72" height="2" fill={c2} opacity="0.9" clipPath="url(#acuClip)">
                    <animate attributeName="y" values="94;164;94" dur="1.8s" repeatCount="indefinite" />
                </rect>
            </svg>
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-sm font-bold mt-1">{label}</motion.p>
            <p className="text-xs text-muted-foreground mt-0.5">Revisando el video de todas las cámaras{progress != null && progress > 0 ? ` · ${progress}%` : "…"}</p>
            {progress != null && (
                <div className="w-56 h-1 rounded-full bg-muted/40 mt-3 overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${c}, ${c2})` }} initial={{ width: 0 }} animate={{ width: `${Math.max(6, progress)}%` }} transition={{ ease: "easeOut", duration: 0.5 }} />
                </div>
            )}
        </motion.div>
    );
}

export default function AcuSeekPage() {
    const [status, setStatus] = useState<Status | null>(null);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [showHelp, setShowHelp] = useState(false);

    const [query, setQuery] = useState("");
    const [range, setRange] = useState("today");
    const [similarity, setSimilarity] = useState(60);
    const [channel, setChannel] = useState<string>("ALL");
    const [pop, setPop] = useState<null | "range" | "filters" | "ideas">(null);

    const [searching, setSearching] = useState(false);
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [results, setResults] = useState<Match[]>([]);
    const [searchMsg, setSearchMsg] = useState<string | null>(null);
    const [totalMatches, setTotalMatches] = useState(0);
    const [lastQuery, setLastQuery] = useState("");
    const [lightbox, setLightbox] = useState<Match | null>(null);
    const [tm, setTm] = useState<{ open: boolean; deviceId: string; channel: number; eventTimeMs: number; deviceName?: string } | null>(null);
    const pollRef = useRef<any>(null);

    // ── AcuSearch (por imagen / objetivo) ──
    const [mode, setMode] = useState<"text" | "image" | "lpr">("text");
    const [lprResults, setLprResults] = useState<LprMatch[]>([]);
    const [lprChips, setLprChips] = useState<string[]>([]);
    const [lprHint, setLprHint] = useState<string | null>(null);
    const [similarBusy, setSimilarBusy] = useState<string | null>(null);
    const [refFile, setRefFile] = useState<File | null>(null);
    const [refPreview, setRefPreview] = useState<string | null>(null);
    const [refSourceUrl, setRefSourceUrl] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [targetType, setTargetType] = useState<"human" | "vehicle">("human");
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Pegar imagen desde el portapapeles (Ctrl+V) en cualquier parte de la página
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items; if (!items) return;
            for (const it of Array.from(items)) {
                if (it.type.startsWith("image/")) {
                    const f = it.getAsFile(); if (!f) continue;
                    e.preventDefault();
                    pickFile(new File([f], `portapapeles-${Date.now()}.png`, { type: f.type }));
                    return;
                }
            }
        };
        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function pickFile(f: File | null) {
        if (!f) return;
        if (!/^image\/(jpeg|jpg|png|webp)$/i.test(f.type)) { setSearchMsg("Formato no soportado — usá JPG/PNG."); return; }
        setRefFile(f); setRefSourceUrl(null);
        setRefPreview(URL.createObjectURL(f));
        setMode("image"); setSearchMsg(null);
    }

    /** Búsqueda por imagen: con archivo subido o con un recorte del NVR (sourceUrl) */
    async function runImageSearch(opts: { file?: File | null; sourceUrl?: string | null; engine?: "human" | "vehicle" }) {
        const eng = opts.engine || targetType;
        if (opts.engine) setTargetType(opts.engine);
        if (!activated) return;
        if (!opts.file && !opts.sourceUrl) { setSearchMsg("Subí una foto o elegí 'Similar' en un resultado."); return; }
        if (pollRef.current) clearInterval(pollRef.current);
        setPop(null); setMode("image"); setSearching(true); setProgress(0); setResults([]); setSearchMsg(null); setTotalMatches(0);
        setLastQuery(opts.file ? `Imagen: ${opts.file.name}` : "Objetivo similar");
        if (opts.sourceUrl) { setRefSourceUrl(opts.sourceUrl); setRefPreview(imgProxy(opts.sourceUrl)); setRefFile(null); }
        // el motor de vehículos del NVR acepta como máximo 7 días
        const { from, to } = rangeToDates(eng === "vehicle" && range === "30d" ? "7d" : range);
        try {
            let res: Response;
            if (opts.file) {
                const jpeg = await toJpeg(opts.file);
                const fd = new FormData();
                fd.append("file", jpeg, "ref.jpg");
                fd.append("from", from); fd.append("to", to); fd.append("similarity", String(similarity / 100));
                fd.append("engine", eng);
                if (channel !== "ALL") fd.append("channelID", channel);
                res = await fetch("/api/acuseek/image-search", { method: "POST", body: fd });
            } else {
                res = await fetch("/api/acuseek/image-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: opts.sourceUrl, from, to, similarity: similarity / 100, channelID: channel !== "ALL" ? channel : undefined, engine: eng }) });
            }
            const j = await res.json();
            if (!j.ok) { setSearchMsg(j.error || "No se pudo iniciar la búsqueda por imagen."); setSearching(false); return; }
            const taskId = j.taskID; let tries = 0;
            const minScore = eng === "vehicle" ? `&minScore=${similarity}` : "";
            pollRef.current = setInterval(async () => {
                tries++;
                const pr = await fetch(`/api/acuseek/image-search?taskId=${encodeURIComponent(taskId)}&max=80&engine=${j.engine || eng}${minScore}`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
                if (!pr) return;
                if (!pr.ok) { clearInterval(pollRef.current); setSearchMsg(pr.error || "Error en la búsqueda."); setSearching(false); return; }
                if (pr.progress != null) setProgress(Number(pr.progress));
                if (pr.totalMatches != null) setTotalMatches(pr.totalMatches);
                if (pr.status === "completed" || tries > 45) {
                    clearInterval(pollRef.current); setSearching(false);
                    setResults(pr.matches || []);
                    if (!pr.matches || pr.matches.length === 0) setSearchMsg("Sin coincidencias para esa imagen en el rango elegido.");
                }
            }, 1200);
        } catch (e: any) { setSearchMsg(e?.message || "Error de red."); setSearching(false); }
    }

    /** Re-encode cualquier imagen a JPEG (máx 1280px) para mandar al NVR */
    function toJpeg(file: File): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const img = new Image(); const url = URL.createObjectURL(file);
            img.onload = () => {
                const max = 1280; let w = img.width, h = img.height;
                if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
                const c = document.createElement("canvas"); c.width = w; c.height = h;
                c.getContext("2d")!.drawImage(img, 0, 0, w, h);
                c.toBlob(b => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error("No se pudo convertir la imagen")); }, "image/jpeg", 0.9);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagen inválida")); };
            img.src = url;
        });
    }

    const loadStatus = () => {
        setLoadingStatus(true);
        fetch("/api/acuseek/status", { cache: "no-store" }).then(r => r.json()).then(setStatus).catch(() => setStatus({ ok: false, error: "No se pudo consultar el NVR" })).finally(() => setLoadingStatus(false));
    };
    useEffect(() => { loadStatus(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

    const activated = !!status?.activated;
    const examples = status?.examples?.length ? status.examples : ["Person in White", "Black Vehicle", "Motorcycle Rider"];
    const recent = status?.recent || [];
    const cameras = status?.cameras || [];

    async function runSearch(text: string) {
        if (!text.trim() || !activated) return;
        if (pollRef.current) clearInterval(pollRef.current);
        setPop(null); setSearching(true); setProgress(undefined); setResults([]); setSearchMsg(null); setTotalMatches(0); setLastQuery(text);
        const { from, to } = rangeToDates(range);
        const channels = channel === "ALL" ? undefined : [Number(channel)];
        try {
            const res = await fetch("/api/acuseek/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, from, to, similarity, channels }) });
            const j = await res.json();
            if (!j.ok) { setSearchMsg(j.error || "No se pudo iniciar la búsqueda."); setSearching(false); return; }
            const taskId = j.taskID; let tries = 0;
            pollRef.current = setInterval(async () => {
                tries++;
                const pr = await fetch(`/api/acuseek/search?taskId=${encodeURIComponent(taskId)}&max=80`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
                if (!pr) return;
                if (!pr.ok) { clearInterval(pollRef.current); setSearchMsg(pr.error || "Error en la búsqueda."); setSearching(false); return; }
                if (pr.matches?.length) setResults(pr.matches);
                if (pr.totalMatches != null) setTotalMatches(pr.totalMatches);
                if (pr.progress != null) setProgress(Number(pr.progress));
                if (pr.status === "completed" || pr.status === "error" || tries > 40) {
                    clearInterval(pollRef.current); setSearching(false);
                    if (pr.status === "error") setSearchMsg("El NVR reportó un error en la búsqueda.");
                    else if (!pr.matches || pr.matches.length === 0) setSearchMsg("Sin coincidencias en el rango elegido.");
                }
            }, 1100);
        } catch (e: any) { setSearchMsg(e?.message || "Error de red."); setSearching(false); }
    }

    /** Fuente propia: eventos de acceso LPR (no depende del NVR) */
    async function runLprSearch(text: string) {
        if (!text.trim()) return;
        if (pollRef.current) clearInterval(pollRef.current);
        setPop(null); setMode("lpr"); setSearching(true); setProgress(undefined); setResults([]); setLprResults([]); setSearchMsg(null); setTotalMatches(0); setLastQuery(text); setLprChips([]); setLprHint(null);
        const days = RANGES.find(r => r.k === range)?.days ?? 0;
        try {
            const j = await fetch(`/api/lpr/smart-search?q=${encodeURIComponent(text)}&max=120&days=${days || 1}`, { cache: "no-store" }).then(r => r.json());
            setSearching(false);
            if (!j.ok) { setSearchMsg(j.error || "No se pudo buscar en los accesos."); return; }
            setLprResults(j.matches || []); setTotalMatches(j.total || 0); setLprChips(j.parsed?.chips || []);
            if (j.hint) setLprHint(j.hint);
            if (!j.matches?.length) setSearchMsg(j.hint || "Sin coincidencias en los accesos para esa descripción.");
        } catch (e: any) { setSearchMsg(e?.message || "Error de red."); setSearching(false); }
    }

    /** Puente accesos → NVR: toma la foto local del evento y busca ese vehículo en las cámaras del barrio */
    async function similarFromLpr(m: LprMatch) {
        const src = m.cropPath || m.imagePath; if (!src) return;
        setSimilarBusy(m.id);
        try {
            const blob = await fetch(src).then(r => r.blob());
            const file = new File([blob], `acceso-${m.plate || m.id}.jpg`, { type: blob.type || "image/jpeg" });
            setRefFile(file); setRefPreview(URL.createObjectURL(blob)); setRefSourceUrl(null);
            await runImageSearch({ file, engine: "vehicle" });
        } catch { setSearchMsg("No se pudo usar esa captura como referencia."); }
        finally { setSimilarBusy(null); }
    }

    const tone = mode === "text" ? "violet" : mode === "lpr" ? "violet" : "fuchsia";
    const rangeLabel = RANGES.find(r => r.k === range)?.l || "Hoy";
    const filtersActive = similarity !== 60 || channel !== "ALL";
    const canSearch = mode === "image" ? !!(refFile || refSourceUrl) : !!query.trim();

    return (
        <div className="h-full flex flex-col bg-background text-foreground overflow-y-auto">
            {/* Header */}
            <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <motion.div animate={searching ? { rotate: [0, 8, -8, 0] } : { rotate: 0 }} transition={{ repeat: searching ? Infinity : 0, duration: 1.2 }} className="p-2 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 border border-violet-500/20"><Sparkles size={20} className="text-violet-400" /></motion.div>
                    <div>
                        <h1 className="text-base font-bold flex items-center gap-2">Búsqueda inteligente <span className="text-[10px] font-black bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">AcuSeek · AcuSearch</span></h1>
                        <p className="text-[11px] text-muted-foreground">Describilo en palabras o subí una foto: el NVR revisa todas las cámaras</p>
                    </div>
                </div>
                {!loadingStatus && (activated
                    ? <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Activo</span>
                    : <button onClick={loadStatus} className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20"><AlertTriangle size={12} /> No activado</button>
                )}
            </div>

            <div className="p-4 sm:p-5 space-y-4 w-full max-w-[1800px] mx-auto">
                {/* Not-activated banner */}
                {!loadingStatus && !activated && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 overflow-hidden">
                        <div className="flex items-start gap-3 p-4">
                            <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
                            <div className="text-sm flex-1">
                                <p className="font-bold text-amber-400">AcuSeek no está respondiendo</p>
                                <p className="text-muted-foreground mt-0.5">{status?.reason || status?.error} {status?.nvr && <>· {status.nvr.name} ({status.nvr.model})</>}</p>
                                <p className="text-emerald-400 mt-1 flex items-center gap-1"><ScanLine size={12} /> La búsqueda por <b>Accesos</b> funciona igual: no usa el NVR.</p>
                                <button onClick={() => setShowHelp(v => !v)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300"><ChevronDown size={13} className={cn("transition-transform", showHelp && "rotate-180")} /> Cómo activarlo</button>
                            </div>
                            <button onClick={loadStatus} className="text-[11px] font-bold px-2 py-1 rounded-md border border-border hover:bg-accent text-muted-foreground shrink-0 flex items-center gap-1"><RotateCw size={12} /> Reintentar</button>
                        </div>
                        {showHelp && <div className="px-4 pb-4 text-xs text-muted-foreground border-t border-amber-500/20"><ol className="list-decimal ml-4 space-y-1 mt-3"><li>Web del NVR ({status?.nvr?.ip}) → AcuSeek habilitado por canal.</li><li>Autorizá AcuSeek (licencia/trial).</li><li>Reintentá acá.</li></ol></div>}
                    </div>
                )}

                {/* ───── Toolbar compacta (una fila) ───── */}
                <div className={cn("rounded-2xl border border-border p-2 flex items-center gap-2 relative", mode === "lpr" ? "bg-gradient-to-r from-emerald-500/[0.06] via-transparent to-teal-500/[0.05]" : "bg-gradient-to-r from-violet-500/[0.05] via-transparent to-fuchsia-500/[0.05]", !activated && mode !== "lpr" && "opacity-50 pointer-events-none")}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0] || null); }}>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => pickFile(e.target.files?.[0] || null)} />

                    {/* modo */}
                    <div className="flex items-center gap-1 bg-background/60 p-0.5 rounded-lg border border-border/60 shrink-0">
                        <IconBtn tip={<>Accesos · <b>matrículas del barrio</b><br /><span className="opacity-70">Los 4 portones · no usa el NVR</span></>} active={mode === "lpr"} onClick={() => setMode("lpr")} className="h-8 w-8 border-0"><ScanLine size={15} /></IconBtn>
                        <IconBtn tip={<>Por texto · <b>AcuSeek</b><br /><span className="opacity-70">Cámaras de contexto del NVR</span></>} active={mode === "text"} onClick={() => setMode("text")} className="h-8 w-8 border-0"><Sparkles size={15} /></IconBtn>
                        <IconBtn tip={<>Por imagen · <b>AcuSearch</b><br /><span className="opacity-70">Cámaras de contexto del NVR</span></>} active={mode === "image"} onClick={() => setMode("image")} tone="fuchsia" className="h-8 w-8 border-0"><Camera size={15} /></IconBtn>
                    </div>

                    {/* entrada principal */}
                    <div className="flex-1 min-w-0 relative">
                        <AnimatePresence mode="wait" initial={false}>
                            {mode !== "image" ? (
                                <motion.div key="t" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.15 }} className="relative">
                                    {mode === "lpr" ? <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400" /> : <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
                                    <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") mode === "lpr" ? runLprSearch(query) : runSearch(query); }}
                                        placeholder={mode === "lpr" ? "Ej: camioneta blanca ayer a la tarde · autos negros por P7 · SCT4403" : "Ej: camioneta blanca, persona con mochila roja, moto de noche…"}
                                        className={cn("w-full h-9 pl-9 pr-3 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2", mode === "lpr" ? "focus:ring-emerald-500/40" : "focus:ring-violet-500/40")} />
                                </motion.div>
                            ) : (
                                <motion.div key="i" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}
                                    onClick={() => !refPreview && fileInputRef.current?.click()}
                                    className={cn("h-9 rounded-lg border border-dashed flex items-center gap-2 px-2 text-xs transition-colors", dragOver ? "border-fuchsia-500 bg-fuchsia-500/10" : "border-border bg-background", !refPreview && "cursor-pointer hover:border-fuchsia-500/50")}>
                                    {refPreview ? (
                                        <>
                                            <motion.img layoutId="refimg" src={refPreview} alt="" className="h-7 w-7 object-cover rounded border border-fuchsia-500/40" />
                                            <span className="font-semibold truncate flex-1">{refFile?.name || "Objetivo de un resultado"}</span>
                                            <Tip label="Cambiar foto"><button onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }} className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center"><ImagePlus size={14} /></button></Tip>
                                            <Tip label="Quitar"><button onClick={e => { e.stopPropagation(); setRefFile(null); setRefPreview(null); setRefSourceUrl(null); }} className="h-7 w-7 rounded-md text-red-400 hover:bg-red-500/10 flex items-center justify-center"><Trash2 size={14} /></button></Tip>
                                        </>
                                    ) : (
                                        <><ImagePlus size={15} className="text-fuchsia-400 shrink-0" /><span className="truncate"><b>Subí</b>, arrastrá o <b className="text-fuchsia-400">pegá (Ctrl+V)</b> una foto del objetivo</span></>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* tipo de objetivo (solo imagen) */}
                    <AnimatePresence>
                        {mode === "image" && (
                            <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} className="flex items-center gap-1 bg-background/60 p-0.5 rounded-lg border border-border/60 overflow-hidden shrink-0">
                                <IconBtn tip="Buscar personas" active={targetType === "human"} onClick={() => setTargetType("human")} tone="fuchsia" className="h-8 w-8 border-0"><User size={15} /></IconBtn>
                                <IconBtn tip={<>Buscar vehículos <span className="opacity-60">(máx. 7 días)</span></>} active={targetType === "vehicle"} onClick={() => setTargetType("vehicle")} tone="fuchsia" className="h-8 w-8 border-0"><Car size={15} /></IconBtn>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* rango */}
                    <div className="relative shrink-0">
                        <Tip label={`Rango: ${rangeLabel}`}>
                            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setPop(p => p === "range" ? null : "range")}
                                className={cn("h-9 px-2.5 rounded-lg border flex items-center gap-1.5 text-[11px] font-bold", pop === "range" || range !== "today" ? "bg-violet-500/15 text-violet-300 border-violet-500/40" : "bg-background/60 border-border/60 text-muted-foreground hover:text-foreground")}>
                                <CalendarDays size={15} /> {rangeLabel}
                            </motion.button>
                        </Tip>
                        <Pop open={pop === "range"} onClose={() => setPop(null)}>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Buscar en</p>
                            <div className="grid grid-cols-2 gap-1">
                                {RANGES.map(r => {
                                    const dis = mode === "image" && targetType === "vehicle" && r.days > 7;
                                    return <button key={r.k} disabled={dis} onClick={() => { setRange(r.k); setPop(null); }} className={cn("h-8 rounded-md text-[11px] font-bold border", range === r.k ? "bg-violet-500/20 text-violet-300 border-violet-500/40" : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent", dis && "opacity-40 cursor-not-allowed")}>{r.l}</button>;
                                })}
                            </div>
                            {mode === "image" && targetType === "vehicle" && <p className="text-[10px] text-muted-foreground mt-2">El motor de vehículos del NVR admite hasta 7 días.</p>}
                        </Pop>
                    </div>

                    {/* filtros */}
                    <div className="relative shrink-0">
                        <IconBtn tip={filtersActive ? `Similitud ${similarity}% · ${channel === "ALL" ? "todas" : cameras.find(c => String(c.channel) === channel)?.name || "cámara"}` : "Filtros"} active={pop === "filters" || filtersActive} onClick={() => setPop(p => p === "filters" ? null : "filters")}>
                            <SlidersHorizontal size={15} />
                            {filtersActive && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-fuchsia-400 ring-2 ring-background" />}
                        </IconBtn>
                        <Pop open={pop === "filters"} onClose={() => setPop(null)}>
                            <div className="space-y-3 w-64">
                                <div>
                                    <div className="flex items-center justify-between mb-1"><span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Similitud mínima</span><span className="text-[11px] font-mono font-bold text-violet-400">{similarity}%</span></div>
                                    <input type="range" min={0} max={100} value={similarity} onChange={e => setSimilarity(Number(e.target.value))} className="w-full accent-violet-500" />
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Cámara</span>
                                    <select value={channel} onChange={e => setChannel(e.target.value)} className="w-full h-8 rounded-md bg-background border border-border px-2 text-[11px] text-foreground focus:outline-none">
                                        <option value="ALL">Todas las cámaras</option>
                                        {cameras.map(cam => <option key={cam.channel} value={cam.channel}>{cam.name}</option>)}
                                    </select>
                                </div>
                                {filtersActive && <button onClick={() => { setSimilarity(60); setChannel("ALL"); }} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"><RotateCw size={11} /> Restablecer</button>}
                            </div>
                        </Pop>
                    </div>

                    {/* ideas / sugerencias */}
                    {mode === "lpr" && (
                        <div className="relative shrink-0">
                            <IconBtn tip="Ejemplos de búsqueda" active={pop === "ideas"} onClick={() => setPop(p => p === "ideas" ? null : "ideas")}><Lightbulb size={15} /></IconBtn>
                            <Pop open={pop === "ideas"} onClose={() => setPop(null)}>
                                <div className="w-72">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Ejemplos</p>
                                    <div className="flex flex-wrap gap-1">{LPR_EXAMPLES.map(ex => <button key={ex} onClick={() => { setQuery(ex); runLprSearch(ex); }} className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-500/25 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/15">{ex}</button>)}</div>
                                    <p className="text-[10px] text-muted-foreground mt-2 leading-snug">Entiende color, tipo (auto, camioneta, pickup, van, camión, buggy, moto), marca, matrícula, acceso (P1…P7), entradas/salidas, autorizados/denegados, y fechas (“hoy”, “ayer”, “últimos 3 días”, “a la tarde”).</p>
                                </div>
                            </Pop>
                        </div>
                    )}
                    {mode === "text" && (
                        <div className="relative shrink-0">
                            <IconBtn tip="Sugerencias y recientes" active={pop === "ideas"} onClick={() => setPop(p => p === "ideas" ? null : "ideas")}><Lightbulb size={15} /></IconBtn>
                            <Pop open={pop === "ideas"} onClose={() => setPop(null)}>
                                <div className="w-72 space-y-3">
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Búsqueda rápida</p>
                                        <div className="flex gap-1.5">
                                            {[{ l: "Persona", q: "person", icon: <User size={13} /> }, { l: "Vehículo", q: "vehicle", icon: <Car size={13} /> }, { l: "Moto", q: "motorcycle rider", icon: <Bike size={13} /> }].map(cat => (
                                                <button key={cat.l} onClick={() => { setQuery(cat.l); runSearch(cat.q); }} className="flex-1 h-8 rounded-lg border border-violet-500/25 bg-violet-500/5 text-violet-300 text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-violet-500/15">{cat.icon} {cat.l}</button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Ejemplos</p>
                                        <div className="flex flex-wrap gap-1">{examples.slice(0, 6).map(ex => <button key={ex} onClick={() => { setQuery(ex); runSearch(ex); }} className="text-[11px] px-2 py-0.5 rounded-full border border-violet-500/20 bg-violet-500/5 text-violet-300 hover:bg-violet-500/15">{ex}</button>)}</div>
                                    </div>
                                    {recent.length > 0 && <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Recientes</p>
                                        <div className="flex flex-wrap gap-1">{recent.slice(0, 8).map(rt => <button key={rt} onClick={() => { setQuery(rt); runSearch(rt); }} className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-background/60 text-muted-foreground hover:text-foreground flex items-center gap-1"><History size={10} /> {rt}</button>)}</div>
                                    </div>}
                                </div>
                            </Pop>
                        </div>
                    )}

                    {/* buscar */}
                    <Tip label={mode === "lpr" ? "Buscar en los accesos del barrio (Enter)" : mode === "text" ? "Buscar por descripción (Enter)" : `Buscar ${targetType === "vehicle" ? "vehículos" : "personas"} similares`}>
                        <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }} onClick={() => mode === "lpr" ? runLprSearch(query) : mode === "text" ? runSearch(query) : runImageSearch({ file: refFile, sourceUrl: refSourceUrl })} disabled={searching || !canSearch}
                            className={cn("h-9 px-4 rounded-lg text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shrink-0", mode === "lpr" ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/20" : mode === "text" ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-violet-500/20" : "bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 shadow-fuchsia-500/20")}>
                            {searching ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="flex"><Search size={15} /></motion.span> : mode === "lpr" ? <ScanLine size={15} /> : <Sparkles size={15} />} Buscar
                        </motion.button>
                    </Tip>
                </div>

                {/* Results header */}
                {(results.length > 0 || lprResults.length > 0 || searchMsg) && !searching && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-sm flex-wrap">
                        {mode === "image" && refPreview && <img src={refPreview} alt="" className="h-7 w-7 rounded object-cover border border-fuchsia-500/40" />}
                        {lastQuery && <span className="font-semibold">{mode === "image" ? lastQuery : `"${lastQuery}"`}</span>}
                        {mode === "lpr" && lprChips.map(ch => <span key={ch} className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">{ch}</span>)}
                        {mode === "lpr" && <span className="text-[10.5px] text-muted-foreground">· accesos del barrio</span>}
                        {totalMatches > 0 && <span className="text-muted-foreground">· {totalMatches} coincidencia{totalMatches === 1 ? "" : "s"}{results.length < totalMatches && mode !== "lpr" ? ` (mostrando ${results.length})` : ""}</span>}
                    </motion.div>
                )}
                {searchMsg && !searching && <div className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center"><Info size={14} /> {searchMsg}</div>}

                {/* Splash de búsqueda */}
                <AnimatePresence>
                    {searching && results.length === 0 && <SearchSplash key="splash" preview={mode === "image" ? refPreview : null} label={mode === "image" ? lastQuery : `"${lastQuery}"`} progress={progress} tone={tone} />}
                </AnimatePresence>

                {/* Resultados de accesos (fuente propia) */}
                {mode === "lpr" && lprResults.length > 0 && !searching && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                        {lprResults.map((m, idx) => (
                            <motion.div key={m.id} initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: Math.min(idx, 24) * 0.03, type: "spring", stiffness: 300, damping: 24 }}
                                className={cn("rounded-xl border bg-card overflow-hidden group transition-colors", m.decision === "GRANT" ? "border-border hover:border-emerald-500/40" : "border-amber-500/25 hover:border-amber-500/50")}>
                                <div className="relative aspect-video bg-background overflow-hidden">
                                    {m.imagePath ? <img src={`${m.imagePath}${m.imagePath.includes("?") ? "&" : "?"}w=400`} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center"><Camera size={22} className="text-muted-foreground/40" /></div>}
                                    <span className={cn("absolute top-1.5 left-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-md flex items-center gap-1", m.direction === "EXIT" ? "bg-orange-500 text-white" : "bg-blue-500 text-white")}>{m.direction === "EXIT" ? <LogOut size={10} /> : <LogIn size={10} />}{m.direction === "EXIT" ? "Salida" : "Entrada"}</span>
                                    {m.decision !== "GRANT" && <span className="absolute top-1.5 right-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-500 text-black">DENY</span>}
                                    {m.plate && <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[13px] font-black font-mono tracking-wider px-2 py-0.5 rounded bg-black/80 text-white border border-white/20">{m.plate}</span>}
                                    <Tip label="Rastrear este vehículo en las cámaras del barrio (AcuSearch)" side="top">
                                        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => similarFromLpr(m)} disabled={!!similarBusy}
                                            className="absolute bottom-1.5 right-1.5 h-7 w-7 rounded-md bg-fuchsia-600/90 text-white flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity">
                                            {similarBusy === m.id ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                                        </motion.button>
                                    </Tip>
                                </div>
                                <div className="px-2 py-1.5 text-[11px]">
                                    <div className="font-bold truncate">{m.deviceName || "—"}</div>
                                    <div className="flex items-center gap-1 text-muted-foreground"><Clock size={10} /> {m.time ? new Date(m.time).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {m.brand && m.brand !== "Unknown" && <span className="text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{m.brand}</span>}
                                        {m.color && <span className="text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{m.color}</span>}
                                        {m.typeEs && <span className="text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{m.typeEs}</span>}
                                    </div>
                                    {m.user && <div className="text-[10px] text-emerald-400 truncate mt-0.5">{m.user}{m.unit ? ` · ${m.unit}` : ""}</div>}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}

                {/* Results grid */}
                {results.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                        {results.map((m, idx) => (
                            <motion.div key={m.id} initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: Math.min(idx, 24) * 0.03, type: "spring", stiffness: 300, damping: 24 }}
                                className="rounded-xl border border-border bg-card overflow-hidden group hover:border-violet-500/40 transition-colors">
                                <button onClick={() => setLightbox(m)} className="block w-full aspect-video bg-background relative overflow-hidden">
                                    {m.imagePath ? <img src={imgProxy(m.imagePath)} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center"><Camera size={22} className="text-muted-foreground/40" /></div>}
                                    {m.rect && <div className="absolute border-2 border-violet-400 rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none" style={{ left: `${m.rect.x * 100}%`, top: `${m.rect.y * 100}%`, width: `${m.rect.width * 100}%`, height: `${m.rect.height * 100}%` }} />}
                                    {m.score != null && <span className={cn("absolute top-1.5 left-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-md bg-black/75", scoreColor(m.score))}>{m.score}%</span>}
                                    {/* acciones flotantes */}
                                    <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                        <Tip label="Ver grabación" side="top"><motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setTm({ open: true, deviceId: m.deviceId || "", channel: m.channel, eventTimeMs: m.time ? Date.parse(m.time) : Date.now(), deviceName: m.deviceName })} className="h-7 w-7 rounded-md bg-blue-600/90 text-white flex items-center justify-center shadow"><Film size={13} /></motion.button></Tip>
                                        <Tip label="Buscar similar en todas las cámaras" side="top"><motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => runImageSearch({ sourceUrl: m.targetImagePath || m.imagePath, engine: m.targetType === "vehicle" || (mode === "image" && targetType === "vehicle") ? "vehicle" : "human" })} className="h-7 w-7 rounded-md bg-fuchsia-600/90 text-white flex items-center justify-center shadow"><Search size={13} /></motion.button></Tip>
                                    </div>
                                </button>
                                <div className="px-2 py-1.5 text-xs">
                                    <div className="flex items-center justify-between gap-1">
                                        <span className="font-bold truncate">{m.deviceName || `Canal ${m.channel}`}</span>
                                        <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 capitalize shrink-0"><TargetIcon t={m.targetType} /></span>
                                    </div>
                                    <div className="flex items-center gap-1 text-muted-foreground mt-0.5 text-[11px]"><Clock size={10} /> {m.time ? new Date(m.time).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</div>
                                    {m.attrs && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {Object.entries(m.attrs).slice(0, 4).map(([k, v]) => <Tip key={k} label={ATTR_ES[k] || k}><span className="text-[9px] px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{v}</span></Tip>)}
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}

                {/* Empty initial state */}
                {(activated || mode === "lpr") && results.length === 0 && lprResults.length === 0 && !searching && !searchMsg && (
                    <div className="text-center py-14 text-muted-foreground">
                        <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
                            {mode === "lpr" ? <ScanLine size={40} className="mx-auto text-emerald-400/40 mb-3" /> : <Sparkles size={40} className="mx-auto text-violet-400/30 mb-3" />}
                        </motion.div>
                        <p className="text-sm">{mode === "lpr" ? "Describí el vehículo y busco en los 4 accesos del barrio." : mode === "text" ? "Escribí qué buscás y AcuSeek revisa el video de las cámaras de contexto." : "Subí o pegá (Ctrl+V) una foto y AcuSearch encuentra ese objetivo en las cámaras de contexto."}</p>
                        <p className="text-xs mt-1 opacity-70">{mode === "lpr" ? "Color, tipo, marca, matrícula, acceso y fecha — sobre las lecturas de las cámaras LPR." : mode === "text" ? "Color, tipo de vehículo, vestimenta, accesorios…" : "Elegí Persona o Vehículo según lo que haya en la foto."}</p>
                        {mode === "lpr" && <div className="flex flex-wrap gap-1.5 justify-center mt-4">{LPR_EXAMPLES.slice(0, 4).map(ex => <button key={ex} onClick={() => { setQuery(ex); runLprSearch(ex); }} className="text-[11px] px-2.5 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/15">{ex}</button>)}</div>}
                    </div>
                )}
            </div>

            {/* Lightbox */}
            <AnimatePresence>
                {lightbox && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[3400] flex items-center justify-center bg-black/85 backdrop-blur-sm p-6" onClick={() => setLightbox(null)}>
                        <motion.div initial={{ scale: 0.94, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 10 }} className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
                            <img src={imgProxy(lightbox.imagePath)} alt="" className="w-full max-h-[80vh] object-contain rounded-lg" />
                            {lightbox.rect && <div className="absolute border-2 border-violet-400 rounded-sm pointer-events-none" style={{ left: `${lightbox.rect.x * 100}%`, top: `${lightbox.rect.y * 100}%`, width: `${lightbox.rect.width * 100}%`, height: `${lightbox.rect.height * 100}%` }} />}
                            <div className="absolute top-2 right-2 flex gap-2">
                                <button onClick={() => { runImageSearch({ sourceUrl: lightbox.targetImagePath || lightbox.imagePath, engine: lightbox.targetType === "vehicle" || (mode === "image" && targetType === "vehicle") ? "vehicle" : "human" }); setLightbox(null); }} className="h-9 px-3 rounded-lg bg-fuchsia-600 text-white text-xs font-bold flex items-center gap-1.5"><Search size={14} /> Buscar similar</button>
                                <button onClick={() => { setTm({ open: true, deviceId: lightbox.deviceId || "", channel: lightbox.channel, eventTimeMs: lightbox.time ? Date.parse(lightbox.time) : Date.now(), deviceName: lightbox.deviceName }); setLightbox(null); }} className="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5"><Video size={14} /> Ver grabación</button>
                                <button onClick={() => setLightbox(null)} className="h-9 w-9 rounded-lg bg-white/10 text-white flex items-center justify-center"><X size={16} /></button>
                            </div>
                            <div className="absolute bottom-2 left-2 text-xs text-white/90 bg-black/60 rounded-md px-2 py-1 flex items-center gap-2">
                                <span className="font-bold">{lightbox.deviceName || `Canal ${lightbox.channel}`}</span>
                                {lightbox.score != null && <span className={scoreColor(lightbox.score)}>{lightbox.score}%</span>}
                                <span>{lightbox.time ? new Date(lightbox.time).toLocaleString("es-UY") : ""}</span>
                                {lightbox.attrs && Object.entries(lightbox.attrs).map(([k, v]) => <span key={k} className="opacity-80">· {ATTR_ES[k] || k}: {v}</span>)}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {tm?.open && <NvrTimeMachine open={tm.open} onClose={() => setTm(null)} deviceId={tm.deviceId} channel={tm.channel} eventTimeMs={tm.eventTimeMs} deviceName={tm.deviceName} />}
        </div>
    );
}
