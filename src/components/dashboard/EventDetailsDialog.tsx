"use client";

import React, { useState, useEffect, useRef, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
    Clock, User as UserIcon, ShieldCheck, Edit2, Save, FileText, Camera, Eye, X, PlayCircle, Search, Download,
    Archive, UserPlus, ShieldBan, ShieldOff, Crop, Car, LogIn, LogOut, Activity, MapPin, Hash, Loader2, Check, CalendarDays, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { getCarLogo } from "@/lib/car-logos";
import { getRelatedSessionEvents } from "@/app/actions/history";
import { getImagePath } from "@/lib/image-path";
import { NvrTimeMachine } from "@/components/dashboard/NvrTimeMachine";
import { getVehicleBrandName } from "@/lib/hikvision-codes";
import { AcuSearchPanel, AcuMatch } from "@/components/dashboard/AcuSearchPanel";
import { getWatchlist, addWatch, deleteWatch } from "@/app/actions/watchlist";
import { sileo as toast } from "sileo";

interface EventDetailsDialogProps {
    event: any;
    children: React.ReactNode;
    timeStatus?: { label: string; value: string; color: string } | null;
    autoRecording?: boolean;
    onRegister?: (plate: string) => void;
}

interface PlateStats {
    ok: boolean; total: number; today: number; perDay: number; perActiveDay: number; activeDays: number; last7: number; denied: number; days: number;
    firstSeen?: string | null; lastSeen?: string | null;
    daily: { date: string; count: number }[];
    topCameras: { deviceId: string | null; name: string; total: number; entry: number; exit: number; pct: number; last: string }[];
    hourly: { all: number[]; entry: number[]; exit: number[] };
    typicalEntry: { from: number; to: number; count: number; share: number } | null;
    typicalExit: { from: number; to: number; count: number; share: number } | null;
}

/* ───────── Tooltip animado ───────── */
/** Tooltip en portal (position: fixed) → nunca lo recorta un overflow y queda centrado sobre el disparador. */
function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom"; align?: "center" | "right" }) {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const ref = useRef<HTMLSpanElement>(null);
    const show = () => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ x: r.left + r.width / 2, y: side === "top" ? r.top : r.bottom }); };
    const hide = () => setPos(null);
    return (
        <span ref={ref} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onPointerDown={hide}>
            {children}
            {typeof document !== "undefined" && createPortal(
                <AnimatePresence>
                    {pos && (
                        /* capa 1: posición fija (sin animar, framer no la toca) · capa 2: animación */
                        <span className="pointer-events-none fixed z-[5000]" style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${side === "top" ? "calc(-100% - 8px)" : "8px"})` }}>
                            <motion.span initial={{ opacity: 0, y: side === "top" ? 4 : -4, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: side === "top" ? 4 : -4, scale: 0.9 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}
                                className="relative block max-w-[260px] whitespace-nowrap text-center rounded-md bg-zinc-900 text-white text-[10.5px] font-semibold px-2 py-1 shadow-xl border border-white/10">
                                {label}<span className={cn("absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-zinc-900 border-white/10", side === "top" ? "-bottom-1 border-r border-b" : "-top-1 border-l border-t")} />
                            </motion.span>
                        </span>
                    )}
                </AnimatePresence>, document.body)}
        </span>
    );
}

/* ───────── Botón de acción (icono + label chico) ───────── */
function Action({ icon, label, tip, onClick, href, download, tone = "neutral", disabled, active, busy }: { icon: ReactNode; label: string; tip?: ReactNode; onClick?: () => void; href?: string; download?: boolean; tone?: "neutral" | "blue" | "fuchsia" | "emerald" | "red" | "amber"; disabled?: boolean; active?: boolean; busy?: boolean }) {
    // círculo de ícono con degradado por tono + halo al hover; etiqueta abajo
    const tones: Record<string, { circle: string; glow: string; label: string }> = {
        neutral: { circle: "from-zinc-400/20 to-zinc-400/5 border-zinc-400/30 text-zinc-300", glow: "group-hover:shadow-[0_0_0_4px_rgba(161,161,170,.15),0_6px_18px_rgba(161,161,170,.25)]", label: "group-hover:text-foreground" },
        blue: { circle: "from-blue-500/30 to-blue-500/5 border-blue-400/40 text-blue-300", glow: "group-hover:shadow-[0_0_0_4px_rgba(59,130,246,.18),0_6px_18px_rgba(59,130,246,.45)]", label: "group-hover:text-blue-300" },
        fuchsia: { circle: "from-fuchsia-500/30 to-fuchsia-500/5 border-fuchsia-400/40 text-fuchsia-300", glow: "group-hover:shadow-[0_0_0_4px_rgba(217,70,239,.18),0_6px_18px_rgba(217,70,239,.45)]", label: "group-hover:text-fuchsia-300" },
        emerald: { circle: "from-emerald-500/30 to-emerald-500/5 border-emerald-400/40 text-emerald-300", glow: "group-hover:shadow-[0_0_0_4px_rgba(16,185,129,.18),0_6px_18px_rgba(16,185,129,.45)]", label: "group-hover:text-emerald-300" },
        red: { circle: "from-red-500/30 to-red-500/5 border-red-400/40 text-red-300", glow: "group-hover:shadow-[0_0_0_4px_rgba(239,68,68,.18),0_6px_18px_rgba(239,68,68,.45)]", label: "group-hover:text-red-300" },
        amber: { circle: "from-amber-500/30 to-amber-500/5 border-amber-400/40 text-amber-300", glow: "group-hover:shadow-[0_0_0_4px_rgba(245,158,11,.18),0_6px_18px_rgba(245,158,11,.45)]", label: "group-hover:text-amber-300" },
    };
    const t = tones[tone];
    const cls = cn("group flex-1 min-w-0 flex flex-col items-center gap-1.5 py-1.5 px-1 rounded-xl transition-colors focus:outline-none focus-visible:bg-accent/60", disabled && "opacity-35 pointer-events-none grayscale");
    const inner = (
        <>
            <span className={cn("relative h-10 w-10 rounded-full border bg-gradient-to-br flex items-center justify-center transition-all duration-200 group-hover:-translate-y-0.5", t.circle, t.glow, active && "ring-2 ring-offset-2 ring-offset-background ring-current -translate-y-0.5")}>
                {busy ? <Loader2 size={17} className="animate-spin" /> : icon}
                {active && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-current animate-pulse" />}
            </span>
            <span className={cn("text-[10px] font-semibold leading-none whitespace-nowrap text-muted-foreground transition-colors", t.label)}>{label}</span>
        </>
    );
    const el = href
        ? <motion.a whileTap={{ scale: 0.94 }} href={disabled ? undefined : href} download={download} className={cls}>{inner}</motion.a>
        : <motion.button whileTap={{ scale: 0.94 }} onClick={onClick} disabled={disabled} className={cls}>{inner}</motion.button>;
    return tip ? <Tip label={tip}>{el}</Tip> : el;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function EventDetailsDialog({ event, children, timeStatus, autoRecording, onRegister }: EventDetailsDialogProps) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedUser, setEditedUser] = useState(event.user?.name || "");
    const [editedUnit, setEditedUnit] = useState(event.user?.unit?.name || "");
    const [plateHistory, setPlateHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [sessionEvents, setSessionEvents] = useState<any[]>([]);
    const [expandImage, setExpandImage] = useState(false);
    const [tab, setTab] = useState<"perfil" | "historial" | "datos">("perfil");
    const [nvrChannel, setNvrChannel] = useState<number | null>(null);
    const [showVideo, setShowVideo] = useState(false);
    const [stats, setStats] = useState<PlateStats | null>(null);
    const [watch, setWatch] = useState<{ id: string; category: string } | null>(null);
    const [watchBusy, setWatchBusy] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [logoErr, setLogoErr] = useState(false);

    // ── encuadre / AcuSearch ──
    const imgRef = useRef<HTMLImageElement>(null);
    const [cropMode, setCropMode] = useState(false);
    const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null); // en % del elemento
    const dragRef = useRef<{ x0: number; y0: number } | null>(null);
    const [similar, setSimilar] = useState<{ blob: Blob; preview: string; engine: "vehicle" | "human" } | null>(null);
    const [tm, setTm] = useState<{ deviceId: string; channel: number | null; eventTimeMs: number; deviceName?: string } | null>(null);

    const isGrant = event.decision === "GRANT";
    const isLPR = event.accessType === "PLATE" || (!event.accessType && event.plateDetected && event.plateDetected !== "unknown");
    const isFace = event.accessType === "FACE";
    const accessType = event.accessType || (isLPR ? "PLATE" : "OTHER");
    const plateText = event.plateDetected?.toLowerCase() === "unknown" || !event.plateDetected || event.plateDetected === "NO_LEIDA" ? "No Leida" : event.plateDetected;
    const hasPlate = isLPR && plateText !== "No Leida";

    useEffect(() => {
        const dev = (event as any).device;
        if (isOpen && dev?.id && (event.accessType === "PLATE" || event.plateDetected)) {
            fetch(`/api/nvr/channel?deviceId=${dev.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { const ch = (d && d.channel != null) ? Number(d.channel) : null; setNvrChannel(ch); if (autoRecording && ch) setShowVideo(true); }).catch(() => setNvrChannel(null));
        }
    }, [isOpen]);

    const parseDetails = (details: string | null) => {
        if (!details) return {};
        const data: any = {};
        details.split(",").forEach(p => { const i = p.indexOf(":"); if (i > 0) { const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (k && v) data[k] = v; } });
        return data;
    };
    const meta = parseDetails(event.details);
    const getImg = (path: string | null | undefined): string | null => getImagePath(path);

    let cleanSim = ""; let simNum = 0; let detectedMode = "Estandar";
    const simStr = meta.Similitud || "";
    const simMatch = simStr.match(/(\d+)\s*%/);
    if (simMatch) { cleanSim = `${simMatch[1]}%`; simNum = parseInt(simMatch[1]); }
    else { const dm = simStr.match(/(\d+)/); if (dm && parseInt(dm[1]) > 50) { cleanSim = `${dm[1]}%`; simNum = parseInt(dm[1]); } }
    if (simStr.toLowerCase().includes("whitelist") || simStr.toLowerCase().includes("lista blanca")) detectedMode = "Lista Blanca";
    else if (simStr.toLowerCase().includes("blacklist") || simStr.toLowerCase().includes("lista negra")) detectedMode = "Lista Negra";

    let brandName = meta.Marca || "";
    if (brandName.startsWith("Brand ")) brandName = getVehicleBrandName(brandName.replace("Brand ", ""));
    const logoUrl = isLPR ? getCarLogo(brandName || meta.Marca) : null;

    const fmtDur = (ms: number) => { const sec = Math.floor(ms / 1000); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${sec}s`; };
    const permanencia = (() => {
        if (event.direction !== "EXIT") return null;
        const sd = (event as any).stayDuration;
        if (sd && (event as any).previousDirection === "ENTRY") return sd as number;
        const t = new Date(event.timestamp).getTime();
        const entries = (plateHistory || []).filter((h: any) => h.direction === "ENTRY" && new Date(h.timestamp).getTime() < t);
        if (entries.length === 0) return null;
        const lastEntry = entries.reduce((a: any, b: any) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b));
        return t - new Date(lastEntry.timestamp).getTime();
    })();

    const [viewAlt, setViewAlt] = useState<any | null>(null); // captura anterior seleccionada en la tira
    const mainImage = getImg(event.imagePath) || getImg(event.snapshotPath);
    const userImage = getImg(event.user?.cara);
    const faceImage = getImg(meta.FaceImage);
    const displayImage = (viewAlt && (getImg(viewAlt.imagePath) || getImg(viewAlt.snapshotPath))) || mainImage || faceImage || userImage;
    const profileImage = userImage || faceImage || getImg(event.snapshotPath);

    const dateObj = new Date(event.timestamp);
    const timeStr = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateStr = dateObj.toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" });
    const eventMs = dateObj.getTime();

    const isVerified = !!event.user;
    const personName = event.user?.name || meta.Rostro || (hasPlate ? plateText : "Desconocido");
    const unitName = event.user?.unit?.name || (hasPlate && !isVerified ? "Vehículo externo" : "Externo");
    const isBlacklist = detectedMode === "Lista Negra" || watch?.category === "BLACKLISTED";
    const modeLabel = isFace ? "Facial" : isLPR ? "LPR" : accessType === "TAG" ? "RFID" : "Estandar";
    const extraMeta = Object.entries(meta).filter(([key]) => !["Marca", "Color", "Tipo", "Modelo", "FaceImage", "Similitud", "Rostro", "Modo", "Persona", "PlateRect", "PlateCrop", "Source", "Fuente"].includes(key));

    useEffect(() => {
        if (!isOpen) return;
        setTab("perfil"); setCropMode(false); setCrop(null); setSimilar(null); setViewAlt(null);
        if (hasPlate) {
            if (plateHistory.length === 0) {
                setLoadingHistory(true);
                fetch(`/api/events?plate=${event.plateDetected}&limit=50`).then(res => res.json())
                    .then(data => setPlateHistory((data.events || []).filter((e: any) => e.id !== event.id).sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())))
                    .catch(() => { }).finally(() => setLoadingHistory(false));
            }
            fetch(`/api/lpr/plate-stats?plate=${encodeURIComponent(event.plateDetected)}&days=30`, { cache: "no-store" }).then(r => r.json()).then(s => s?.ok && setStats(s)).catch(() => { });
            getWatchlist().then((rows: any[]) => { const p = String(event.plateDetected).toUpperCase().replace(/[^A-Z0-9]/g, ""); const w = rows.find((r: any) => String(r.plate).toUpperCase().replace(/[^A-Z0-9]/g, "") === p && r.active !== false); setWatch(w ? { id: w.id, category: w.category } : null); }).catch(() => { });
        }
        getRelatedSessionEvents(event.id).then(evts => setSessionEvents(evts)).catch(() => { });
    }, [isOpen]);

    const getVehicleColor = (colorName: string) => {
        const c = (colorName || "").toLowerCase();
        if (c.includes("blanc") || c.includes("white")) return { bg: "#ffffff", light: true };
        if (c.includes("plat") || c.includes("silver")) return { bg: "#d1d5db", light: true };
        if (c.includes("gris") || c.includes("gray")) return { bg: "#4b5563", light: false };
        if (c.includes("neg") || c.includes("black")) return { bg: "#000000", light: false };
        if (c.includes("roj") || c.includes("red")) return { bg: "#dc2626", light: false };
        if (c.includes("azu") || c.includes("blue")) return { bg: "#2563eb", light: false };
        if (c.includes("amar") || c.includes("yellow")) return { bg: "#facc15", light: true };
        if (c.includes("verd") || c.includes("green")) return { bg: "#16a34a", light: false };
        if (c.includes("cian") || c.includes("cyan")) return { bg: "#06b6d4", light: false };
        return { bg: "#171717", light: false };
    };

    const alertColor = isBlacklist
        ? { border: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-400", pulse: "bg-red-500", glow: "shadow-red-500/20" }
        : !isGrant
            ? { border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-400", pulse: "bg-amber-500", glow: "shadow-amber-500/20" }
            : { border: "border-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-400", pulse: "bg-emerald-500", glow: "shadow-emerald-500/10" };

    /* ── encuadre sobre la foto ── */
    const pct = (e: React.PointerEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) }; };
    const onPD = (e: React.PointerEvent<HTMLDivElement>) => { if (!cropMode) return; e.preventDefault(); (e.currentTarget as any).setPointerCapture(e.pointerId); const p = pct(e, e.currentTarget); dragRef.current = { x0: p.x, y0: p.y }; setCrop({ x: p.x, y: p.y, w: 0, h: 0 }); };
    const onPM = (e: React.PointerEvent<HTMLDivElement>) => { if (!cropMode || !dragRef.current) return; const p = pct(e, e.currentTarget); const { x0, y0 } = dragRef.current; setCrop({ x: Math.min(x0, p.x), y: Math.min(y0, p.y), w: Math.abs(p.x - x0), h: Math.abs(p.y - y0) }); };
    const onPU = () => { if (crop && (crop.w < 2 || crop.h < 2)) setCrop(null); dragRef.current = null; };

    async function cropToBlob(): Promise<{ blob: Blob; url: string } | null> {
        const img = imgRef.current; if (!img || !img.naturalWidth) return null;
        const c = crop || { x: 0, y: 0, w: 100, h: 100 };
        const sx = Math.round((c.x / 100) * img.naturalWidth), sy = Math.round((c.y / 100) * img.naturalHeight);
        const sw = Math.max(16, Math.round((c.w / 100) * img.naturalWidth)), sh = Math.max(16, Math.round((c.h / 100) * img.naturalHeight));
        const max = 1280; const r = Math.min(1, max / Math.max(sw, sh));
        const cv = document.createElement("canvas"); cv.width = Math.round(sw * r); cv.height = Math.round(sh * r);
        cv.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        return new Promise(res => cv.toBlob(b => res(b ? { blob: b, url: URL.createObjectURL(b) } : null), "image/jpeg", 0.92));
    }
    async function searchSimilar(engine?: "vehicle" | "human") {
        try {
            const out = await cropToBlob();
            if (!out) { toast.error({ title: "No se pudo recortar la imagen" }); return; }
            setSimilar({ blob: out.blob, preview: out.url, engine: engine || (isFace ? "human" : "vehicle") });
            setCropMode(false);
        } catch { toast.error({ title: "No se pudo preparar el recorte", description: "La imagen no permite lectura (CORS)." }); }
    }

    async function toggleBlacklist() {
        if (!hasPlate) return;
        setWatchBusy(true);
        try {
            if (watch?.category === "BLACKLISTED") { await deleteWatch(watch.id); setWatch(null); toast.success({ title: `${plateText} quitada de lista negra` }); }
            else { const r: any = await addWatch({ plate: plateText, label: brandName ? `${brandName} ${meta.Color || ""}`.trim() : "", category: "BLACKLISTED", notify: true }); if (r?.ok === false) throw new Error(r.error); setWatch({ id: r?.row?.id || "?", category: "BLACKLISTED" }); toast.warning({ title: `${plateText} en lista negra`, description: "Se alertará en cada detección." }); }
        } catch (e: any) { toast.error({ title: "No se pudo actualizar la lista", description: e?.message }); }
        finally { setWatchBusy(false); }
    }
    function doRegister() {
        setIsOpen(false);
        if (hasPlate && onRegister) { onRegister(plateText); return; }
        if (isFace) { router.push(`/admin/users?action=create&face=${encodeURIComponent(faceImage || displayImage || "")}`); return; }
        router.push(`/admin/users?action=create${hasPlate ? `&plate=${encodeURIComponent(plateText)}` : ""}`);
    }
    async function exportZip() {
        setExporting(true);
        try {
            const a = document.createElement("a"); a.href = `/api/events/${event.id}/export?pre=10&dur=30`; a.download = ""; document.body.appendChild(a); a.click(); a.remove();
            toast.success({ title: "Exportando evento", description: nvrChannel ? "Foto + clip de 30 s + datos en un ZIP." : "Foto + datos (sin clip: cámara sin canal NVR)." });
        } finally { setTimeout(() => setExporting(false), 2500); }
    }
    const clipHref = nvrChannel ? `/api/nvr/playback?ch=${nvrChannel}&t=${eventMs}&pre=10&dur=30&download=1` : undefined;

    const maxDaily = Math.max(1, ...(stats?.daily.map(d => d.count) || [1]));
    const maxHour = Math.max(1, ...(stats?.hourly.entry || [0]), ...(stats?.hourly.exit || [0]));

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); }}>
                <DialogTrigger asChild>{children}</DialogTrigger>
                {/* sm:!max-w — el DialogContent base trae sm:max-w-4xl (896px) y le gana a max-w-[…] */}
                <DialogContent className={cn("p-0 bg-background border overflow-hidden rounded-xl shadow-2xl w-[96vw] sm:!max-w-[1240px] max-h-[92vh] [&>button[data-slot=dialog-close]]:hidden", alertColor.border, alertColor.glow)} aria-describedby="evt-desc">
                    <DialogTitle className="sr-only">Evento de Acceso</DialogTitle>
                    <p id="evt-desc" className="sr-only">Detalles del evento</p>

                    {/* Fullscreen image */}
                    {expandImage && displayImage && (
                        <div className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center cursor-pointer" onClick={() => setExpandImage(false)}>
                            <button className="absolute top-3 right-3 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 z-10"><X size={18} /></button>
                            <img src={displayImage} alt="Evidencia" className="max-w-full max-h-full object-contain" />
                        </div>
                    )}

                    {/* Panel de similares (AcuSearch) */}
                    {similar && (
                        <AcuSearchPanel image={similar.blob} previewUrl={similar.preview} engine={similar.engine} onEngineChange={(e) => setSimilar(s => s ? { ...s, engine: e } : s)}
                            centerTimeMs={eventMs} title={`Similares a ${hasPlate ? plateText : "este objetivo"}`} onBack={() => setSimilar(null)}
                            onOpenRecording={(m: AcuMatch) => setTm({ deviceId: m.deviceId || "", channel: m.channel, eventTimeMs: m.time ? Date.parse(m.time) : eventMs, deviceName: m.deviceName })} />
                    )}

                    {/* con el panel de similares abierto el modal toma toda la altura, para que la grilla respire */}
                    <div className={cn("flex flex-col max-h-[92vh] overflow-hidden transition-[height] duration-200", similar && "h-[92vh]")}>
                        {/* ─── STATUS BAR ─── */}
                        <div className={cn("pl-5 pr-2 py-2 flex items-center gap-3 border-b", alertColor.bg, alertColor.border)}>
                            <span className={cn("w-2 h-2 rounded-full animate-pulse", alertColor.pulse)} />
                            <span className={cn("text-[10px] font-bold uppercase tracking-[0.15em]", alertColor.text)}>
                                {isBlacklist ? "ALERTA: ENTIDAD EN LISTA NEGRA" : !isGrant ? "ACCESO DENEGADO" : "ACCESO AUTORIZADO"}
                            </span>
                            <span className="ml-auto text-[10px] font-bold text-muted-foreground tracking-[0.12em] flex items-center gap-1.5"><CalendarDays size={12} /> {dateStr} · {timeStr}</span>
                            {timeStatus && <span className={cn("text-[9px] font-bold tracking-wide", timeStatus.color)}>{timeStatus.label}: {timeStatus.value}</span>}
                            <button onClick={() => setIsOpen(false)} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"><X size={16} /></button>
                        </div>

                        {/* ─── MAIN ─── */}
                        <div className="grid grid-cols-12 min-h-0 overflow-hidden">
                            {/* LEFT: foto grande + encuadre */}
                            <div className="col-span-7 border-r border-border/60 p-4 flex flex-col gap-3 overflow-y-auto custom-scrollbar min-h-0">
                                <div className="group/photo relative rounded-xl overflow-hidden border border-border/50 bg-black select-none" onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}
                                    style={{ cursor: cropMode ? "crosshair" : "default" }}>
                                    {displayImage ? (
                                        <img ref={imgRef} src={displayImage} alt="Evidencia" crossOrigin="anonymous" draggable={false}
                                            className={cn("w-full object-contain transition-all duration-500", isFace ? "aspect-[4/5]" : "aspect-video", !cropMode && "grayscale-[35%] hover:grayscale-0")} />
                                    ) : (
                                        <div className={cn("w-full flex items-center justify-center bg-card", isFace ? "aspect-[4/5]" : "aspect-video")}><Camera className="w-12 h-12 text-muted-foreground" /></div>
                                    )}
                                    {/* esquinas */}
                                    {!cropMode && <>
                                        <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-emerald-500/60" /><div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-emerald-500/60" />
                                        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-emerald-500/60" /><div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-emerald-500/60" />
                                    </>}

                                    {/* encuadre */}
                                    {cropMode && (
                                        <div className="absolute inset-0 pointer-events-none">
                                            {crop && crop.w > 0 ? (
                                                <>
                                                    <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)", clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0, ${crop.x}% ${crop.y}%, ${crop.x}% ${crop.y + crop.h}%, ${crop.x + crop.w}% ${crop.y + crop.h}%, ${crop.x + crop.w}% ${crop.y}%, ${crop.x}% ${crop.y}%)` }} />
                                                    <div className="absolute border-2 border-fuchsia-400 shadow-[0_0_0_1px_rgba(0,0,0,.6),0_0_18px_rgba(232,121,249,.5)]" style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}>
                                                        {[["-top-1 -left-1"], ["-top-1 -right-1"], ["-bottom-1 -left-1"], ["-bottom-1 -right-1"]].map(([c]) => <span key={c} className={cn("absolute w-2.5 h-2.5 bg-fuchsia-400 rounded-sm", c)} />)}
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="px-3 py-2 rounded-lg bg-black/70 border border-fuchsia-500/40 text-white text-xs font-semibold flex items-center gap-2"><Crop size={14} className="text-fuchsia-400" /> Dibujá un recuadro sobre el objetivo</motion.div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* barra flotante superior derecha */}
                                    <div className={cn("absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10 transition-opacity duration-200", cropMode ? "opacity-100" : "opacity-0 group-hover/photo:opacity-100 focus-within:opacity-100")} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
                                        {cropMode ? (
                                            <>
                                                <Tip side="bottom" label="Cancelar encuadre"><button onClick={() => { setCropMode(false); setCrop(null); }} className="h-8 px-2.5 rounded-lg bg-black/70 text-white text-[11px] font-bold border border-white/10 hover:bg-black/90 flex items-center gap-1"><X size={13} /> Cancelar</button></Tip>
                                                <Tip side="bottom" label={crop ? "Buscar el recorte como vehículo" : "Buscar la foto completa como vehículo"}><button onClick={() => searchSimilar("vehicle")} className="h-8 px-2.5 rounded-lg bg-fuchsia-600 text-white text-[11px] font-bold hover:bg-fuchsia-500 flex items-center gap-1 shadow-lg shadow-fuchsia-500/30"><Car size={13} /> {crop ? "Buscar recorte" : "Buscar todo"}</button></Tip>
                                                <Tip side="bottom" align="right" label="Buscar como persona"><button onClick={() => searchSimilar("human")} className="h-8 w-8 rounded-lg bg-fuchsia-600/70 text-white hover:bg-fuchsia-500 flex items-center justify-center"><UserIcon size={13} /></button></Tip>
                                            </>
                                        ) : (
                                            <>
                                                <Tip side="bottom" align="right" label="Encuadrar el objetivo y buscarlo en todas las cámaras"><button onClick={() => { setCropMode(true); setCrop(null); }} className="h-8 px-2.5 rounded-lg bg-black/60 backdrop-blur text-white text-[11px] font-bold border border-white/10 hover:bg-fuchsia-600 flex items-center gap-1"><Crop size={13} /> Encuadrar</button></Tip>
                                                {displayImage && <Tip side="bottom" align="right" label="Ampliar"><button onClick={() => setExpandImage(true)} className="h-8 w-8 rounded-lg bg-black/60 backdrop-blur text-white border border-white/10 hover:bg-black/80 flex items-center justify-center"><Eye size={13} /></button></Tip>}
                                            </>
                                        )}
                                    </div>

                                    {isFace && cleanSim && <div className="absolute bottom-3 right-3 z-10"><div className={cn("px-2.5 py-1 rounded text-[11px] font-bold shadow-lg", simNum >= 80 ? "bg-emerald-500 text-white" : simNum >= 60 ? "bg-amber-500 text-black" : "bg-red-500 text-white")}>{cleanSim} MATCH</div></div>}

                                    {/* Matrícula */}
                                    {isLPR && !cropMode && (() => {
                                        const vc = getVehicleColor(meta.Color);
                                        return (
                                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-stretch gap-1.5">
                                                <div className={cn("px-3.5 py-1.5 rounded-md shadow-lg border flex flex-col justify-center", vc.light ? "text-black border-black/10" : "text-white border-white/20")} style={{ backgroundColor: plateText === "No Leida" ? "#dc2626" : vc.bg }}>
                                                    <p className="text-[7px] font-bold uppercase tracking-widest opacity-60">Matrícula</p>
                                                    <h3 className="text-xl font-bold font-mono tracking-wider leading-tight">{plateText}</h3>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* chips debajo de la foto */}
                                {(() => {
                                    const loc = event.device?.location || event.location;
                                    const fourth = permanencia != null || !!loc;
                                    return (
                                        <div className={cn("grid gap-2", fourth ? "grid-cols-4" : "grid-cols-3")}>
                                            <div className="bg-muted/40 p-2 rounded-lg border border-border/30">
                                                <p className="text-[9px] text-muted-foreground uppercase font-bold">Dirección</p>
                                                <p className={cn("text-sm font-semibold flex items-center gap-1", event.direction === "ENTRY" ? "text-blue-400" : "text-orange-400")}>{event.direction === "ENTRY" ? <LogIn size={13} /> : <LogOut size={13} />}{event.direction === "ENTRY" ? "Entrada" : "Salida"}</p>
                                            </div>
                                            <div className="bg-muted/40 p-2 rounded-lg border border-border/30"><p className="text-[9px] text-muted-foreground uppercase font-bold">Credencial</p><p className="text-sm font-semibold">{modeLabel}</p></div>
                                            <div className="bg-muted/40 p-2 rounded-lg border border-border/30"><p className="text-[9px] text-muted-foreground uppercase font-bold">Cámara</p><p className="text-sm font-semibold truncate" title={event.device?.name}>{event.device?.name || "—"}</p></div>
                                            {permanencia != null
                                                ? <div className="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/30"><p className="text-[9px] text-emerald-400/80 uppercase font-bold">Permanencia</p><p className="text-sm font-bold text-emerald-400 flex items-center gap-1"><Clock size={13} /> {fmtDur(permanencia)}</p></div>
                                                : loc ? <div className="bg-muted/40 p-2 rounded-lg border border-border/30"><p className="text-[9px] text-muted-foreground uppercase font-bold">Ubicación</p><p className="text-sm font-semibold truncate">{loc}</p></div> : null}
                                        </div>
                                    );
                                })()}
                                {isLPR && (brandName || meta.Color || meta.Tipo) && (
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="bg-muted/40 p-2 rounded-lg border border-border/30 flex items-center gap-2">
                                            {logoUrl && !logoErr ? <div className="bg-white rounded-md w-9 h-9 p-1 shrink-0 flex items-center justify-center"><img src={logoUrl} alt="" className="w-full h-full object-contain" /></div> : <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0"><Car size={16} className="text-muted-foreground" /></div>}
                                            <div className="min-w-0"><p className="text-[9px] text-muted-foreground uppercase font-bold">Marca</p><p className="text-xs font-semibold truncate">{brandName || "—"}</p></div>
                                        </div>
                                        <div className="bg-muted/40 p-2 rounded-lg border border-border/30"><p className="text-[9px] text-muted-foreground uppercase font-bold">Color</p><div className="flex items-center gap-1.5 mt-0.5"><div className="w-3 h-3 rounded-full border border-border" style={{ backgroundColor: getVehicleColor(meta.Color).bg }} /><p className="text-xs font-semibold">{meta.Color || "—"}</p></div></div>
                                        <div className="bg-muted/40 p-2 rounded-lg border border-border/30"><p className="text-[9px] text-muted-foreground uppercase font-bold">Tipo</p><p className="text-xs font-semibold">{meta.Tipo || "—"}</p></div>
                                    </div>
                                )}

                                {/* Últimas capturas de esta matrícula (clic = ver esa foto; se puede encuadrar sobre ella) */}
                                {hasPlate && plateHistory.some((h: any) => h.imagePath || h.snapshotPath) && (
                                    <div className="mt-1">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1"><Camera size={11} /> Últimas capturas de {plateText}</p>
                                            {viewAlt && <button onClick={() => setViewAlt(null)} className="text-[10px] font-bold text-emerald-400 hover:underline flex items-center gap-1"><Check size={11} /> Volver a la captura del evento</button>}
                                        </div>
                                        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
                                            {[{ ...event, __cur: true }, ...plateHistory.filter((h: any) => h.imagePath || h.snapshotPath).slice(0, 12)].map((h: any) => {
                                                const src = getImg(h.imagePath) || getImg(h.snapshotPath); if (!src) return null;
                                                const sel = h.__cur ? !viewAlt : viewAlt?.id === h.id;
                                                const hd = new Date(h.timestamp);
                                                return (
                                                    <motion.button key={h.id} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => { setViewAlt(h.__cur ? null : h); setCrop(null); }}
                                                        className={cn("relative shrink-0 w-[92px] rounded-lg overflow-hidden border-2 bg-black", sel ? "border-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,.25)]" : "border-border/40 hover:border-fuchsia-400/60")} title={hd.toLocaleString("es-UY")}>
                                                        <img src={`${src}${src.includes("?") ? "&" : "?"}w=200`} alt="" loading="lazy" className="w-full aspect-video object-cover" />
                                                        <span className={cn("absolute top-0.5 left-0.5 text-[8px] font-black px-1 rounded", h.direction === "EXIT" ? "bg-orange-500 text-white" : "bg-blue-500 text-white")}>{h.direction === "EXIT" ? "S" : "E"}</span>
                                                        {h.__cur && <span className="absolute top-0.5 right-0.5 text-[8px] font-black px-1 rounded bg-emerald-500 text-white">Evento</span>}
                                                        <span className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[8.5px] font-mono px-1 py-0.5 leading-tight">{hd.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" })} {hd.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                                    </motion.button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {/* Horarios habituales (perfil de la matrícula) */}
                                {hasPlate && stats && (stats.typicalEntry || stats.typicalExit) && (
                                <div className="rounded-xl border border-border/60 p-3 grid grid-cols-[auto_1fr] gap-3 items-center">
                                    <div className="flex flex-col gap-1.5 min-w-[150px]">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1"><Clock size={11} /> Horarios habituales</p>
                                        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-2 py-1.5"><p className="text-[9px] font-bold uppercase text-blue-400 flex items-center gap-1"><LogIn size={10} /> Entradas</p>{stats.typicalEntry ? <p className="text-sm font-black leading-tight">{hh(stats.typicalEntry.from)} – {hh(stats.typicalEntry.to)} <span className="text-[9.5px] font-medium text-muted-foreground">· {stats.typicalEntry.share}%</span></p> : <p className="text-xs text-muted-foreground">—</p>}</div>
                                        <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 px-2 py-1.5"><p className="text-[9px] font-bold uppercase text-orange-400 flex items-center gap-1"><LogOut size={10} /> Salidas</p>{stats.typicalExit ? <p className="text-sm font-black leading-tight">{hh(stats.typicalExit.from)} – {hh(stats.typicalExit.to)} <span className="text-[9.5px] font-medium text-muted-foreground">· {stats.typicalExit.share}%</span></p> : <p className="text-xs text-muted-foreground">—</p>}</div>
                                    </div>
                                    <div className="min-w-0">
                                    <div className="flex items-end gap-[2px] h-14">
                                        {Array.from({ length: 24 }).map((_, h) => {
                                            const e = stats.hourly.entry[h], x = stats.hourly.exit[h];
                                            const inWin = (w: PlateStats["typicalEntry"]) => !!w && (w.from <= w.to ? h >= w.from && h < w.to : h >= w.from || h < w.to);
                                            return (
                                                <div key={h} title={`${hh(h)} · ${e} entradas / ${x} salidas`} className={cn("flex-1 flex flex-col justify-end gap-[1px] h-14 rounded-sm", (inWin(stats.typicalEntry) || inWin(stats.typicalExit)) && "bg-muted/30")} style={{ minWidth: 6 }}>
                                                    <motion.div initial={{ height: 0 }} animate={{ height: e ? `${Math.max(8, (e / maxHour) * 50)}%` : 0 }} className="w-full bg-blue-400 rounded-t-sm" />
                                                    <motion.div initial={{ height: 0 }} animate={{ height: x ? `${Math.max(8, (x / maxHour) * 50)}%` : 0 }} className="w-full bg-orange-400 rounded-b-sm" />
                                                    {!e && !x && <div className="w-full h-[2px] bg-muted-foreground/25 rounded-sm" />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span></div>
                                    </div>
                                </div>
                                )}
                            </div>

                            {/* RIGHT */}
                            <div className="col-span-5 flex flex-col min-h-0 overflow-hidden">
                                {/* identidad */}
                                <div className="px-4 pt-4 pb-3 flex items-start gap-3 border-b border-border/50">
                                    <div className="relative w-14 h-14 rounded-xl overflow-hidden border border-border/50 bg-muted shrink-0">
                                        {profileImage ? <img src={profileImage} alt="Perfil" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><UserIcon size={22} className="text-muted-foreground" /></div>}
                                        {isVerified && <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 rounded-full border-2 border-background flex items-center justify-center"><ShieldCheck size={8} className="text-white" /></div>}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        {isEditing ? (
                                            <div className="space-y-1.5">
                                                <input value={editedUser} onChange={e => setEditedUser(e.target.value)} className="w-full bg-muted border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                                                <input value={editedUnit} onChange={e => setEditedUnit(e.target.value)} className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-blue-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                                            </div>
                                        ) : (
                                            <>
                                                <h2 className="text-xl font-bold leading-tight truncate">{editedUser || personName}</h2>
                                                <p className={cn("text-[10.5px] font-bold tracking-[0.12em] uppercase", isVerified ? "text-emerald-400" : "text-amber-400")}>{editedUnit || unitName} / {isVerified ? "Autorizado" : "No registrado"}</p>
                                            </>
                                        )}
                                        <div className="flex items-center gap-1.5 mt-1.5">
                                            <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.1em]", isGrant ? "bg-emerald-500 text-white" : isBlacklist ? "bg-red-500 text-white" : "bg-amber-500 text-black")}>{isGrant ? "Autorizado" : isBlacklist ? "Lista negra" : "Denegado"}</span>
                                            {watch?.category === "BLACKLISTED" && !isBlacklist && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-red-500/15 text-red-400 border border-red-500/30">Vigilada</span>}
                                            {event.user && <button onClick={() => setIsEditing(!isEditing)} className={cn("p-1 rounded", isEditing ? "text-emerald-400 bg-emerald-500/10" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>{isEditing ? <Save size={12} /> : <Edit2 size={12} />}</button>}
                                        </div>
                                    </div>
                                    {logoUrl && !logoErr && <div className="w-16 h-16 rounded-xl bg-white p-2 shadow-lg shrink-0 flex items-center justify-center" title={brandName}><img src={logoUrl} alt={brandName} className="w-full h-full object-contain" /></div>}
                                </div>

                                {/* acciones */}
                                <div className="px-4 py-2.5 border-b border-border/50">
                                    <div className="flex items-stretch rounded-2xl border border-border/60 bg-gradient-to-b from-muted/30 to-transparent p-1 [&>span]:flex [&>span]:flex-1 [&>span]:min-w-0">
                                        <Action icon={<PlayCircle size={18} />} label="Grabación" tone="blue" tip={nvrChannel ? "Ver grabación del NVR en este instante" : "Cámara sin canal NVR mapeado"} disabled={!nvrChannel} onClick={() => setShowVideo(true)} />
                                        <Action icon={<Search size={18} />} label="Similares" tone="fuchsia" tip="Encuadrar el objetivo y buscarlo en todas las cámaras" disabled={!displayImage} onClick={() => { setCropMode(true); setCrop(null); }} active={cropMode} />
                                        <div className="w-px bg-border/70 my-3 mx-0.5 shrink-0" />
                                        <Action icon={<Download size={18} />} label="Clip" tone="neutral" tip={nvrChannel ? "Descargar clip MP4 (30 s)" : "Sin canal NVR"} href={clipHref} download disabled={!clipHref} />
                                        <Action icon={<Archive size={18} />} label="Exportar" tone="neutral" tip="ZIP con foto + clip + datos del evento" onClick={exportZip} busy={exporting} />
                                        {((!isVerified || !isGrant) || hasPlate) && <div className="w-px bg-border/70 my-3 mx-0.5 shrink-0" />}
                                        {(!isVerified || !isGrant) && <Action icon={<UserPlus size={18} />} label="Registrar" tone="emerald" tip={hasPlate ? `Dar de alta un usuario con ${plateText}` : "Registrar"} onClick={doRegister} />}
                                        {hasPlate && <Action icon={watch?.category === "BLACKLISTED" ? <ShieldOff size={18} /> : <ShieldBan size={18} />} label={watch?.category === "BLACKLISTED" ? "Desmarcar" : "Lista negra"} tone={watch?.category === "BLACKLISTED" ? "amber" : "red"} tip={watch?.category === "BLACKLISTED" ? "Quitar de la lista negra" : "Marcar matrícula en lista negra y alertar"} onClick={toggleBlacklist} busy={watchBusy} active={watch?.category === "BLACKLISTED"} />}
                                    </div>
                                </div>

                                {/* tabs */}
                                <div className="px-4 pt-2 flex items-center gap-1 border-b border-border/50">
                                    {([["perfil", "Perfil", <BarChart3 size={12} key="a" />], ["historial", `Historial${plateHistory.length ? ` (${plateHistory.length})` : ""}`, <FileText size={12} key="b" />], ["datos", "Datos", <Hash size={12} key="c" />]] as const).map(([k, l, ic]) => (
                                        <button key={k} onClick={() => setTab(k as any)} className={cn("relative h-8 px-3 text-[11px] font-bold flex items-center gap-1.5 rounded-t-md", tab === k ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                            {ic} {l}{tab === k && <motion.span layoutId="evtTab" className="absolute left-1 right-1 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-emerald-400 to-fuchsia-400" />}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
                                    {/* ── PERFIL ── */}
                                    {tab === "perfil" && (
                                        hasPlate ? (
                                            !stats ? <div className="flex items-center justify-center h-32 text-xs text-muted-foreground gap-2"><Loader2 size={14} className="animate-spin" /> Analizando comportamiento…</div> : (
                                                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                                                    {/* Frecuencia */}
                                                    <div className="rounded-xl border border-border/60 bg-gradient-to-br from-violet-500/[0.06] to-transparent p-3">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div>
                                                                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1"><Activity size={11} /> Frecuencia</p>
                                                                <p className="text-2xl font-black leading-tight mt-0.5">{stats.perDay}<span className="text-xs font-bold text-muted-foreground ml-1">pasadas / día</span></p>
                                                                <p className="text-[10.5px] text-muted-foreground">{stats.total} en {stats.days} días · activa {stats.activeDays} día{stats.activeDays === 1 ? "" : "s"} ({stats.perActiveDay}/día activo)</p>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <p className="text-[9px] font-bold uppercase text-muted-foreground">Hoy</p><p className="text-lg font-black text-emerald-400 leading-tight">{stats.today}</p>
                                                                <p className="text-[9px] font-bold uppercase text-muted-foreground mt-1">7 días</p><p className="text-sm font-bold leading-tight">{stats.last7}</p>
                                                            </div>
                                                        </div>
                                                        {/* sparkline 30d */}
                                                        <div className="flex items-end gap-[2px] h-9 mt-2" title="Pasadas por día (últimos 30 días)">
                                                            {stats.daily.map((d, i) => (
                                                                <motion.div key={d.date} title={`${d.date}: ${d.count}`} initial={{ height: 2 }} animate={{ height: d.count === 0 ? 3 : `${Math.max(14, (d.count / maxDaily) * 100)}%` }} transition={{ delay: i * 0.012 }}
                                                                    className={cn("flex-1 rounded-sm", d.count === 0 ? "bg-muted-foreground/25" : i === stats.daily.length - 1 ? "bg-emerald-400" : "bg-violet-400/80")} style={{ minWidth: 4 }} />
                                                            ))}
                                                        </div>
                                                        <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5"><span>hace {stats.days} d</span>{stats.firstSeen && <span>1ª vez: {new Date(stats.firstSeen).toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "2-digit" })}</span>}<span>hoy</span></div>
                                                    </div>

                                                    {/* Cámaras top */}
                                                    <div className="rounded-xl border border-border/60 p-3">
                                                        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1 mb-2"><Camera size={11} /> Cámaras habituales</p>
                                                        {stats.topCameras.length === 0 ? <p className="text-xs text-muted-foreground">Sin datos.</p> : (
                                                            <div className="space-y-1.5">
                                                                {stats.topCameras.slice(0, 4).map((c, i) => (
                                                                    <div key={c.deviceId || c.name} className="text-[11px]">
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <span className="font-semibold truncate flex items-center gap-1.5"><span className={cn("w-4 h-4 rounded text-[9px] font-black flex items-center justify-center", i === 0 ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>{i + 1}</span>{c.name}</span>
                                                                            <span className="text-muted-foreground shrink-0 flex items-center gap-2"><span className="text-blue-400 flex items-center gap-0.5"><LogIn size={10} />{c.entry}</span><span className="text-orange-400 flex items-center gap-0.5"><LogOut size={10} />{c.exit}</span><b className="text-foreground">{c.pct}%</b></span>
                                                                        </div>
                                                                        <div className="h-1.5 rounded-full bg-muted/40 mt-1 overflow-hidden flex"><motion.div initial={{ width: 0 }} animate={{ width: `${(c.entry / Math.max(1, c.total)) * c.pct}%` }} className="h-full bg-blue-400" /><motion.div initial={{ width: 0 }} animate={{ width: `${(c.exit / Math.max(1, c.total)) * c.pct}%` }} className="h-full bg-orange-400" /></div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {stats.denied > 0 && <p className="text-[10.5px] text-amber-400 flex items-center gap-1"><ShieldBan size={11} /> {stats.denied} denegado{stats.denied === 1 ? "" : "s"} en el período</p>}
                                                </motion.div>
                                            )
                                        ) : (
                                            <div className="text-xs text-muted-foreground space-y-2">
                                                {isFace && cleanSim && <div className="grid grid-cols-2 gap-2"><div className="bg-muted/40 p-2 rounded-lg border border-border/30"><p className="text-[9px] uppercase font-bold">Similitud</p><p className={cn("text-sm font-bold", simNum >= 80 ? "text-emerald-400" : simNum >= 60 ? "text-amber-400" : "text-red-400")}>{cleanSim}</p></div><div className="bg-muted/40 p-2 rounded-lg border border-border/30"><p className="text-[9px] uppercase font-bold">Modo</p><p className="text-sm font-semibold text-foreground">{detectedMode}</p></div></div>}
                                                {sessionEvents.length > 0 && <div><p className="text-[9px] font-bold uppercase tracking-wide mb-1">Secuencia de eventos</p>{sessionEvents.slice(0, 8).map((se: any) => <div key={se.id} className="flex items-center gap-2 py-1 border-t border-border/30"><span className="font-mono">{new Date(se.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><span className="truncate">{se.device?.name || "—"}</span><span className={cn("ml-auto font-bold", se.decision === "GRANT" ? "text-emerald-400" : "text-red-400")}>{se.decision === "GRANT" ? "OK" : "DENY"}</span></div>)}</div>}
                                                {!isFace && sessionEvents.length === 0 && <p>Sin matrícula leída: no hay perfil de comportamiento.</p>}
                                            </div>
                                        )
                                    )}

                                    {/* ── HISTORIAL ── */}
                                    {tab === "historial" && (
                                        loadingHistory ? <div className="flex items-center justify-center h-32 text-xs text-muted-foreground gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
                                            : plateHistory.length === 0 ? <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2"><FileText size={22} className="opacity-30" /><span className="text-xs">Sin accesos anteriores</span></div>
                                                : (
                                                    <div className="border border-border/40 rounded-lg overflow-hidden text-[11px]">
                                                        <div className="bg-muted/50 grid grid-cols-[1fr_1.4fr_auto_auto] gap-2 px-3 py-1.5 text-[9px] font-bold text-muted-foreground uppercase tracking-wide"><div>Fecha / hora</div><div>Cámara</div><div>Dir.</div><div className="text-right">Estado</div></div>
                                                        {plateHistory.map((h: any) => {
                                                            const hd = new Date(h.timestamp);
                                                            return (
                                                                <div key={h.id} className="grid grid-cols-[1fr_1.4fr_auto_auto] gap-2 px-3 py-1.5 border-t border-border/20 hover:bg-muted/30 items-center">
                                                                    <div className="font-mono text-muted-foreground">{hd.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" })} {hd.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                                                                    <div className="truncate font-medium">{h.device?.name || h.location || "—"}</div>
                                                                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase", h.direction === "ENTRY" ? "bg-blue-500/15 text-blue-400" : "bg-orange-500/15 text-orange-400")}>{h.direction === "ENTRY" ? "Ent" : "Sal"}</span>
                                                                    <div className={cn("text-right font-bold", h.decision === "GRANT" ? "text-emerald-400" : "text-red-400")}>{h.decision === "GRANT" ? "OK" : "DENY"}</div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )
                                    )}

                                    {/* ── DATOS ── */}
                                    {tab === "datos" && (
                                        <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                                            <div><p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Dispositivo</p><p className="text-sm font-medium">{event.device?.name || "---"}</p>{event.device?.location && <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin size={10} />{event.device.location}</p>}</div>
                                            <div><p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Timestamp</p><p className="text-sm font-medium font-mono">{dateStr} {timeStr}</p></div>
                                            <div className="col-span-2"><p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">ID de evento</p><p className="text-xs font-medium font-mono break-all">{event.id}</p></div>
                                            {nvrChannel && <div><p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Canal NVR</p><p className="text-sm font-medium">D{nvrChannel}</p></div>}
                                            {isFace && cleanSim && <><div><p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Similitud</p><p className="text-sm font-bold">{cleanSim}</p></div><div><p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Modo</p><p className="text-sm">{detectedMode}</p></div></>}
                                            {extraMeta.map(([key, value]) => <div key={key}><p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">{key}</p><p className="text-sm font-medium break-words">{value as string}</p></div>)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <NvrTimeMachine open={showVideo} onClose={() => setShowVideo(false)} deviceId={(event as any).device?.id} channel={nvrChannel} eventTimeMs={eventMs} deviceName={(event as any).device?.name} evidenceUrl={displayImage || undefined} plate={event.plateDetected} />
            {tm && <NvrTimeMachine open onClose={() => setTm(null)} deviceId={tm.deviceId} channel={tm.channel} eventTimeMs={tm.eventTimeMs} deviceName={tm.deviceName} />}
        </>
    );
}
