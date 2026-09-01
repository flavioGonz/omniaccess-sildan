"use client";

import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Clock,
    User as UserIcon,
    LogIn,
    LogOut,
    Car,
    MapPin,
    ShieldCheck,
    ShieldAlert,
    Calendar,
    Building2,
    Hash,
    Edit2,
    Save,
    AlertCircle,
    Activity,
    CreditCard,
    Key,
    FileText,
    Camera,
    ScanFace,
    Fingerprint,
    Eye,
    ChevronRight,
    Layers,
    Zap,
    X,
    PlayCircle,
    Radio,
    Shield,
    ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { getCarLogo } from "@/lib/car-logos";
import { getRelatedSessionEvents } from "@/app/actions/history";
import { getImagePath } from "@/lib/image-path";
import { getNvrChannel } from "@/app/actions/nvr";
import { NvrTimeMachine } from "@/components/dashboard/NvrTimeMachine";
import { getVehicleBrandName } from "@/lib/hikvision-codes";

interface EventDetailsDialogProps {
    event: any;
    children: React.ReactNode;
    timeStatus?: { label: string; value: string; color: string } | null;
    autoRecording?: boolean;
}

export function EventDetailsDialog({ event, children, timeStatus, autoRecording }: EventDetailsDialogProps) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedUser, setEditedUser] = useState(event.user?.name || "");
    const [editedUnit, setEditedUnit] = useState(event.user?.unit?.name || "");
    const [plateHistory, setPlateHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [sessionEvents, setSessionEvents] = useState<any[]>([]);
    const [loadingSession, setLoadingSession] = useState(false);
    const [expandImage, setExpandImage] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showRect, setShowRect] = useState(true);
    const [nvrChannel, setNvrChannel] = useState<number | null>(null);
    const [showVideo, setShowVideo] = useState(false);
    useEffect(() => {
        const dev = (event as any).device;
        if (isOpen && dev?.id && (event.accessType === "PLATE" || event.plateDetected)) {
            fetch(`/api/nvr/channel?deviceId=${dev.id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { const ch = (d && d.channel != null) ? Number(d.channel) : null; setNvrChannel(ch); if (autoRecording && ch) setShowVideo(true); }).catch(() => setNvrChannel(null));
        }
        // OJO: no reseteamos nvrChannel al cerrarse el dialog — el time machine puede seguir
        // abierto por encima (Radix cierra el dialog por "outside click" sobre el time machine)
        // y perdería el canal mostrando "no mapeada" falsamente.
    }, [isOpen]);

    const isGrant = event.decision === "GRANT";
    const isLPR = event.accessType === "PLATE" || (!event.accessType && event.plateDetected && event.plateDetected !== "unknown");
    const isFace = event.accessType === "FACE";
    const accessType = event.accessType || (isLPR ? "PLATE" : "OTHER");

    const plateText = event.plateDetected?.toLowerCase() === "unknown" || !event.plateDetected || event.plateDetected === "NO_LEIDA"
        ? "No Leida"
        : event.plateDetected;

    const parseDetails = (details: string | null) => {
        if (!details) return {};
        const data: any = {};
        details.split(",").forEach(p => {
            const [k, v] = p.split(":").map(s => s.trim());
            if (k && v) data[k] = v;
        });
        return data;
    };
    const meta = parseDetails(event.details);

    const getImg = (path: string | null | undefined): string | null => {
        return getImagePath(path);
    };

    let cleanSim = "";
    let simNum = 0;
    let detectedMode = "Estandar";
    const simStr = meta.Similitud || "";
    const simMatch = simStr.match(/(\d+)\s*%/);
    if (simMatch) { cleanSim = `${simMatch[1]}%`; simNum = parseInt(simMatch[1]); }
    else {
        const digitMatch = simStr.match(/(\d+)/);
        if (digitMatch && parseInt(digitMatch[1]) > 50) { cleanSim = `${digitMatch[1]}%`; simNum = parseInt(digitMatch[1]); }
    }
    if (simStr.toLowerCase().includes("whitelist") || simStr.toLowerCase().includes("lista blanca")) detectedMode = "Lista Blanca";
    else if (simStr.toLowerCase().includes("blacklist") || simStr.toLowerCase().includes("lista negra")) detectedMode = "Lista Negra";

    const logoUrl = isLPR ? getCarLogo(meta.Marca) : null;
    const plateRect = (() => {
        const r = (meta as any).PlateRect;
        if (!r) return null;
        const parts = String(r).split("/").map(Number);
        if (parts.length !== 4 || parts.some((n) => isNaN(n))) return null;
        return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    })();

    const fmtDur = (ms: number) => {
        const sec = Math.floor(ms / 1000); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${sec}s`;
    };
    const plateCropUrl = (meta as any).PlateCrop ? getImagePath((meta as any).PlateCrop) : null;
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

    const mainImage = getImg(event.imagePath) || getImg(event.snapshotPath);
    const userImage = getImg(event.user?.cara);
    const faceImage = getImg(meta.FaceImage);
    const displayImage = mainImage || faceImage || userImage;
    const profileImage = userImage || faceImage || getImg(event.snapshotPath);

    const dateObj = new Date(event.timestamp);
    const timeStr = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateStr = dateObj.toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" });

    let brandName = meta.Marca || "";
    if (brandName.startsWith("Brand ")) brandName = getVehicleBrandName(brandName.replace("Brand ", ""));

    const personName = event.user?.name || meta.Rostro || "Desconocido";
    const unitName = event.user?.unit?.name || "Externo";
    const isVerified = !!event.user;
    const isBlacklist = detectedMode === "Lista Negra";
    const isWhitelist = detectedMode === "Lista Blanca";

    const modeLabel = isFace ? "Facial" : isLPR ? "LPR" : accessType === "TAG" ? "RFID" : "Estandar";

    const extraMeta = Object.entries(meta).filter(([key]) =>
        !["Marca", "Color", "Tipo", "Modelo", "FaceImage", "Similitud", "Rostro", "Modo", "Persona", "PlateRect", "PlateCrop"].includes(key)
    );

    useEffect(() => {
        if (!isOpen) return;
        if (isLPR && event.plateDetected && event.plateDetected !== "unknown" && plateHistory.length === 0) {
            setLoadingHistory(true);
            fetch(`/api/events?plate=${event.plateDetected}&limit=50`)
                .then(res => res.json())
                .then(data => {
                    const h = (data.events || []).filter((e: any) => e.id !== event.id).sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                    setPlateHistory(h);
                })
                .catch(() => {})
                .finally(() => setLoadingHistory(false));
        }
        setLoadingSession(true);
        getRelatedSessionEvents(event.id)
            .then(evts => setSessionEvents(evts))
            .catch(() => {})
            .finally(() => setLoadingSession(false));
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
        return { bg: "#171717", light: false };
    };

    // Alert color system
    const alertColor = isBlacklist
        ? { border: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-400", pulse: "bg-red-500", glow: "shadow-red-500/20" }
        : !isGrant
        ? { border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-400", pulse: "bg-amber-500", glow: "shadow-amber-500/20" }
        : { border: "border-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-400", pulse: "bg-emerald-500", glow: "shadow-emerald-500/10" };

    return (
        <>
        <Dialog onOpenChange={(o) => { setIsOpen(o); if (!o) setShowHistory(false); }}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className={cn("p-0 bg-background border overflow-hidden rounded-lg shadow-lg w-[95vw] max-w-[850px] max-h-[90vh]", alertColor.border, alertColor.glow)} aria-describedby="evt-desc">
                <DialogTitle className="sr-only">Evento de Acceso</DialogTitle>
                <p id="evt-desc" className="sr-only">Detalles del evento</p>

                {/* Fullscreen image overlay */}
                {expandImage && displayImage && (
                    <div className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center cursor-pointer" onClick={() => setExpandImage(false)}>
                        <button className="absolute top-3 right-3 p-2 rounded-full bg-muted/80 text-foreground hover:bg-muted transition-colors z-10">
                            <X size={18} />
                        </button>
                        <img src={displayImage} alt="Evidencia" className="max-w-full max-h-full object-contain" />
                    </div>
                )}


                {showHistory && (
                    <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in slide-in-from-right duration-300">
                        <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0">
                            <button onClick={() => setShowHistory(false)} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-foreground"><span className="text-xl leading-none">&larr;</span></button>
                            <div>
                                <h3 className="text-sm font-bold text-foreground">Historial de <span className="font-mono">{plateText}</span></h3>
                                <p className="text-[11px] text-muted-foreground">{plateHistory.length} accesos anteriores</p>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {loadingHistory ? (
                                <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">Cargando...</div>
                            ) : plateHistory.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2"><FileText size={22} className="opacity-30" /><span className="text-xs">Sin accesos anteriores</span></div>
                            ) : plateHistory.map((h: any) => {
                                const hd = new Date(h.timestamp);
                                return (
                                    <div key={h.id} className="px-5 py-3 flex items-center gap-3 border-b border-border/50 hover:bg-accent transition-colors">
                                        <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase", h.direction === "ENTRY" ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-400")}>{h.direction === "ENTRY" ? "Entrada" : "Salida"}</span>
                                        <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold", h.decision === "GRANT" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>{h.decision === "GRANT" ? "OK" : "DENY"}</span>
                                        <span className="text-xs text-foreground">{hd.toLocaleDateString("es-UY", { day: "2-digit", month: "short" })} {hd.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                        <span className="ml-auto text-[11px] text-muted-foreground truncate max-w-[170px]">{h.device?.name || h.location || ""}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="flex flex-col min-h-[72vh] max-h-[90vh] overflow-hidden">

                    {/* ─── STATUS BAR ─── */}
                    <div className={cn("px-6 py-2 flex justify-between items-center border-b", alertColor.bg, alertColor.border)}>
                        <div className="flex items-center gap-3">
                            <span className={cn("w-2 h-2 rounded-full animate-pulse", alertColor.pulse)} />
                            <span className={cn("text-[10px] font-bold uppercase tracking-[0.15em]", alertColor.text)}>
                                {isBlacklist ? "ALERTA: ENTIDAD EN LISTA NEGRA" : !isGrant ? "ACCESO DENEGADO" : "ACCESO AUTORIZADO"}
                            </span>
                        </div>
                        <div className="flex items-center gap-4">
                            {nvrChannel && (
                                <button onClick={() => setShowVideo(true)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-500 text-[10px] font-bold transition-colors">
                                    <PlayCircle size={13} /> Ver grabación
                                </button>
                            )}
                            <span className="text-[9px] font-bold text-muted-foreground tracking-[0.15em]">
                                {dateStr} {timeStr}
                            </span>
                            {timeStatus && (
                                <span className={cn("text-[9px] font-bold tracking-wide", timeStatus.color)}>
                                    {timeStatus.label}: {timeStatus.value}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* ─── MAIN GRID: 5/7 columns ─── */}
                    <div className="grid grid-cols-12 flex-1 overflow-hidden">

                        {/* LEFT: Subject Visual */}
                        <div className="col-span-6 border-r border-border/60 p-5 flex flex-col gap-3 overflow-y-auto">
                            {/* Photo with reticle */}
                            <div
                                className="relative group rounded-lg overflow-hidden border border-border/50 cursor-pointer"
                                onClick={() => displayImage && setExpandImage(true)}
                            >
                                {/* Reticle corners */}
                                <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-emerald-500/60 z-10" />
                                <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-emerald-500/60 z-10" />
                                <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-emerald-500/60 z-10" />
                                <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-emerald-500/60 z-10" />

                                {displayImage ? (
                                    <img
                                        src={displayImage}
                                        alt="Evidencia"
                                        className={cn(
                                            "w-full object-cover transition-all duration-700",
                                            isFace ? "aspect-[4/5]" : "aspect-video",
                                            "grayscale group-hover:grayscale-0"
                                        )}
                                    />
                                ) : (
                                    <div className={cn("w-full flex items-center justify-center bg-card", isFace ? "aspect-[4/5]" : "aspect-video")}>
                                        <Camera className="w-12 h-12 text-muted-foreground" />
                                    </div>
                                )}


                                {/* Zoom hint */}
                                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-white text-[9px] font-semibold">
                                        <Eye size={10} /> Ampliar
                                    </div>
                                </div>

                                {/* Match badge */}
                                {isFace && cleanSim && (
                                    <div className="absolute bottom-3 right-3 z-10">
                                        <div className={cn(
                                            "px-2.5 py-1 rounded text-[11px] font-bold shadow-lg",
                                            simNum >= 80 ? "bg-emerald-500 text-foreground" : simNum >= 60 ? "bg-amber-500 text-black" : "bg-red-500 text-foreground"
                                        )}>
                                            {cleanSim} MATCH
                                        </div>
                                    </div>
                                )}

                                {/* LPR Plate overlay */}
                                {isLPR && (() => {
                                    const vc = getVehicleColor(meta.Color);
                                    return (
                                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-stretch gap-1.5">
                                            {logoUrl && (
                                                <div className="bg-white rounded w-10 flex items-center justify-center p-0.5 shadow-lg">
                                                    <img src={logoUrl} alt="" className="w-6 h-6 object-contain" />
                                                </div>
                                            )}
                                            <div
                                                className={cn("px-3 py-1.5 rounded shadow-lg border flex flex-col justify-center", vc.light ? "text-black border-black/10" : "text-foreground border-border")}
                                                style={{ backgroundColor: plateText === "No Leida" ? "#dc2626" : vc.bg }}
                                            >
                                                <p className="text-[7px] font-bold uppercase tracking-widest opacity-60">Matricula</p>
                                                <h3 className="text-lg font-bold font-mono tracking-wider leading-tight">{plateText}</h3>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Mini info chips below photo */}
                            <div className="grid grid-cols-2 gap-2">
                                {permanencia != null && (
                                    <div className="col-span-2 bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/30 flex items-center justify-between">
                                        <div>
                                            <p className="text-[9px] text-emerald-400/80 uppercase font-bold tracking-tight">Permanencia</p>
                                            <p className="text-sm font-bold text-emerald-400">{fmtDur(permanencia)} adentro</p>
                                        </div>
                                        <Clock size={18} className="text-emerald-400/60" />
                                    </div>
                                )}
                                <div className="bg-muted/40 p-2 rounded-lg border border-border/30">
                                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Direccion</p>
                                    <p className={cn("text-sm font-semibold", event.direction === "ENTRY" ? "text-blue-400" : "text-orange-400")}>
                                        {event.direction === "ENTRY" ? "Entrada" : "Salida"}
                                    </p>
                                </div>
                                <div className="bg-muted/40 p-2 rounded-lg border border-border/30">
                                    <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Credencial</p>
                                    <p className="text-sm font-semibold text-foreground">{modeLabel}</p>
                                </div>
                            </div>

                            {/* LPR vehicle chips */}
                            {isLPR && (brandName || meta.Color || meta.Tipo) && (
                                <div className="grid grid-cols-3 gap-2">
                                    {brandName && (
                                        <div className="bg-muted/40 p-2 rounded-lg border border-border/30">
                                            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Marca</p>
                                            <p className="text-xs font-semibold text-foreground">{brandName}</p>
                                        </div>
                                    )}
                                    {meta.Color && (
                                        <div className="bg-muted/40 p-2 rounded-lg border border-border/30">
                                            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Color</p>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <div className="w-2.5 h-2.5 rounded-full border border-border" style={{ backgroundColor: getVehicleColor(meta.Color).bg }} />
                                                <p className="text-xs font-semibold text-foreground">{meta.Color}</p>
                                            </div>
                                        </div>
                                    )}
                                    {meta.Tipo && (
                                        <div className="bg-muted/40 p-2 rounded-lg border border-border/30">
                                            <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight">Tipo</p>
                                            <p className="text-xs font-semibold text-foreground">{meta.Tipo}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* RIGHT: High-Density Metadata */}
                        <div className="col-span-6 p-5 flex flex-col overflow-y-auto">
                            {/* Identity header */}
                            <div className="mb-5 flex justify-between items-start gap-3">
                                <div className="flex items-start gap-3 min-w-0">
                                    {/* Profile photo */}
                                    <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-border/50 bg-muted shrink-0">
                                        {profileImage ? (
                                            <img src={profileImage} alt="Perfil" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <UserIcon size={20} className="text-muted-foreground" />
                                            </div>
                                        )}
                                        {isVerified && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-[#0a0f1a] flex items-center justify-center">
                                                <ShieldCheck size={7} className="text-foreground" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        {isEditing ? (
                                            <div className="space-y-1.5">
                                                <input value={editedUser} onChange={e => setEditedUser(e.target.value)} className="w-full bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                                                <input value={editedUnit} onChange={e => setEditedUnit(e.target.value)} className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-blue-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                                            </div>
                                        ) : (
                                            <>
                                                <h2 className="text-2xl font-bold text-foreground leading-tight truncate">{editedUser || personName}</h2>
                                                <p className={cn("text-[11px] font-bold tracking-[0.12em] uppercase", isVerified ? "text-emerald-400" : "text-amber-400")}>
                                                    {editedUnit || unitName} / {isVerified ? "Autorizado" : "No Registrado"}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {event.user && (
                                        <button onClick={() => setIsEditing(!isEditing)} className={cn("p-1.5 rounded transition-colors", isEditing ? "text-emerald-400 bg-emerald-500/10" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
                                            {isEditing ? <Save size={14} /> : <Edit2 size={14} />}
                                        </button>
                                    )}
                                    <div className={cn(
                                        "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.1em]",
                                        isGrant ? "bg-emerald-500 text-foreground" : isBlacklist ? "bg-red-500 text-foreground" : "bg-amber-500 text-black"
                                    )}>
                                        {isGrant ? "AUTORIZADO" : isBlacklist ? "LISTA NEGRA" : "DENEGADO"}
                                    </div>
                                </div>
                            </div>

                            {/* Data Grid — 2 columns with underlined labels */}
                            <div className="grid grid-cols-2 gap-y-3 gap-x-5 mb-5">
                                <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Dispositivo</p>
                                    <p className="text-sm font-medium text-foreground">{event.device?.name || "---"}</p>
                                    {event.device?.location && <p className="text-[10px] text-muted-foreground mt-0.5">{event.device.location}</p>}
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Timestamp</p>
                                    <p className="text-sm font-medium text-foreground font-mono">{dateStr} {timeStr}</p>
                                </div>
                                {isFace && cleanSim && (
                                    <>
                                        <div>
                                            <p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Similitud</p>
                                            <p className={cn("text-sm font-bold", simNum >= 80 ? "text-emerald-400" : simNum >= 60 ? "text-amber-400" : "text-red-400")}>{cleanSim}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">Modo Deteccion</p>
                                            <p className={cn("text-sm font-medium", isBlacklist ? "text-red-400" : isWhitelist ? "text-emerald-400" : "text-foreground")}>{detectedMode}</p>
                                        </div>
                                    </>
                                )}
                                <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">ID de Evento</p>
                                    <p className="text-sm font-medium text-foreground font-mono truncate" title={event.id}>{event.id}</p>
                                </div>
                                {/* Extra metadata in grid */}
                                {extraMeta.map(([key, value]) => {
                                    const isSrc = key === "Source" || key === "Fuente";
                                    return (
                                        <div key={key}>
                                            <p className="text-[10px] text-muted-foreground uppercase font-bold border-b border-border/50 pb-1 mb-1">{isSrc ? "Cámara" : key}</p>
                                            <p className="text-sm font-medium text-foreground">{isSrc ? (event.device?.name || (value as string)) : (value as string)}</p>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Detection History mini-table */}
                            {((isLPR && plateHistory.length > 0) || sessionEvents.length > 0) && (
                                <div className="flex-1 mb-4">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2 tracking-wide">
                                        {isLPR ? "Historial LPR" : "Secuencia de Eventos"}
                                    </p>
                                    <div className="border border-border/40 rounded-lg overflow-hidden text-[11px]">
                                        {/* Table header */}
                                        <div className="bg-muted/50 grid grid-cols-4 px-3 py-1.5 text-[9px] font-bold text-muted-foreground uppercase tracking-wide">
                                            <div>Hora</div>
                                            <div>Dispositivo</div>
                                            <div>Conf</div>
                                            <div className="text-right">Estado</div>
                                        </div>
                                        {/* Table rows */}
                                        {isLPR ? (
                                            plateHistory.slice(0, 4).map((h: any) => (
                                                <div key={h.id} className="grid grid-cols-4 px-3 py-2 border-t border-border/20 hover:bg-muted/30 transition-colors">
                                                    <div className="text-muted-foreground font-mono">{new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                                                    <div className="text-muted-foreground font-medium truncate">{h.device?.name || "—"}</div>
                                                    <div className="text-muted-foreground">—</div>
                                                    <div className={cn("text-right font-bold", h.decision === "GRANT" ? "text-emerald-400" : "text-red-400")}>
                                                        {h.decision === "GRANT" ? "OK" : "DENY"}
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            sessionEvents.slice(0, 4).map((se: any) => (
                                                <div key={se.id} className="grid grid-cols-4 px-3 py-2 border-t border-border/20 hover:bg-muted/30 transition-colors">
                                                    <div className="text-muted-foreground font-mono">{new Date(se.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                                                    <div className="text-muted-foreground font-medium truncate">{se.device?.name || "—"}</div>
                                                    <div className="text-muted-foreground">—</div>
                                                    <div className={cn("text-right font-bold", se.decision === "GRANT" ? "text-emerald-400" : "text-red-400")}>
                                                        {se.decision === "GRANT" ? "OK" : "DENY"}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Action Footer */}
                            <div className="mt-auto flex gap-3 pt-3 border-t border-border/50">
                                {isLPR && plateText !== "No Leida" && (
                                    <button
                                        onClick={() => setShowHistory(true)}
                                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-foreground font-bold text-[11px] uppercase tracking-[0.1em] py-2.5 rounded-lg transition-all active:scale-[0.98] shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2"
                                    >
                                        <FileText size={14} /> Ver Historial Completo
                                    </button>
                                )}
                                {isFace && !isVerified && (
                                    <button
                                        onClick={() => {
                                            setIsOpen(false);
                                            const faceParam = encodeURIComponent(faceImage || displayImage || "");
                                            router.push(`/admin/users?action=create&face=${faceParam}`);
                                        }}
                                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-foreground font-bold text-[11px] uppercase tracking-[0.1em] py-2.5 rounded-lg transition-all active:scale-[0.98] shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2"
                                    >
                                        <UserIcon size={14} /> Registrar Rostro
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="bg-muted hover:bg-muted text-muted-foreground border border-border/50 font-bold text-[11px] uppercase tracking-[0.1em] px-5 py-2.5 rounded-lg transition-all active:scale-[0.98]"
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
        <NvrTimeMachine open={showVideo} onClose={() => setShowVideo(false)} deviceId={(event as any).device?.id} channel={nvrChannel} eventTimeMs={new Date(event.timestamp).getTime()} deviceName={(event as any).device?.name} evidenceUrl={displayImage || undefined} plate={event.plateDetected} />
        </>
    );
}
