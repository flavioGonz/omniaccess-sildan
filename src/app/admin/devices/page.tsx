"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
    getDevices,
    deleteDevice,
    testDeviceConnection,
    triggerDeviceRelay,
    getDeviceStats,
    syncPlatesToDevice,
    getCameraUserCounts
} from "@/app/actions/devices";
import { getAccessGroups } from "@/app/actions/groups";
import { getEnabledModules, type ModuleId } from "@/app/actions/modules";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Trash2,
    Plus,
    Server,
    Wifi,
    WifiOff,
    Settings2,
    Cpu,
    Globe,
    ArrowRightLeft,
    ShieldCheck,
    ArrowRightCircle,
    ArrowLeftCircle,
    Activity,
    Network,
    Camera,
    ScanFace,
    Search,
    Lock,
    Unlock,
    Database,
    Loader2,
    DoorOpen,
    DoorClosed,
    RefreshCw,
    Zap,
    Eye,
    Volume2,
    Maximize2,
    Wand2,
    Clock,
    Users,
    HardDrive,
    MemoryStick,
    Timer,
    AlertTriangle,
    Radio,
    TimerReset,
    Play,
    ScanLine
} from "lucide-react";
import { sileo } from "sileo";
// Adaptador estilo sonner (title, {description}) → sileo ({title, description})
const toast = {
    success: (title: string, o?: { description?: string }) => sileo.success({ title, description: o?.description }),
    error: (title: string, o?: { description?: string }) => sileo.error({ title, description: o?.description }),
    warning: (title: string, o?: { description?: string }) => sileo.warning({ title, description: o?.description }),
    info: (title: string, o?: { description?: string }) => sileo.info({ title, description: o?.description }),
};
import { io } from "socket.io-client";
import { Badge } from "@/components/ui/badge";
import { DeviceFormDialog } from "@/components/DeviceFormDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { DeviceMemoryDialog } from "@/components/DeviceMemoryDialog";
import { DevicePlateListDialog } from "@/components/DevicePlateListDialog";
import { AkuvoxActionUrlDialog } from "@/components/AkuvoxActionUrlDialog";
import { DRIVER_MODELS, DEVICE_MODELS } from "@/lib/driver-models";
import { CameraCalibrator } from "@/components/CameraCalibrator";
import { InteriorCalibrator } from "@/components/InteriorCalibrator";
import { HealthHistoryDialog } from "@/components/HealthHistoryDialog";
import { ReadRateDialog } from "@/components/ReadRateDialog";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, DownloadCloud, UploadCloud, Info } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Inline SVG data URIs for fallback images (avoid 404s for missing placeholder files)
const PLACEHOLDER_DEVICE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="8" fill="%23262626"/><path d="M24 14a4 4 0 100 8 4 4 0 000-8zm-6 14c0-2 4-3.1 6-3.1S30 26 30 28v1H18v-1z" fill="%23525252"/><rect x="14" y="32" width="20" height="3" rx="1.5" fill="%23525252"/></svg>')}`;
const PLACEHOLDER_BRAND = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="4" fill="%23262626"/><circle cx="16" cy="16" r="8" stroke="%23525252" stroke-width="1.5" fill="none"/><path d="M16 12v4l3 3" stroke="%23525252" stroke-width="1.5" stroke-linecap="round"/></svg>')}`;

const TYPE_META: Record<string, { label: string; color: string; activeClass: string }> = {
    LPR_CAMERA: { label: "LPR", color: "text-amber-400", activeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    FACE_TERMINAL: { label: "Face", color: "text-teal-400", activeClass: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
    QUEUE_COUNTER: { label: "Queue", color: "text-violet-400", activeClass: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
    NVR: { label: "NVR", color: "text-blue-400", activeClass: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
};

const BRAND_CONFIG: Record<string, { label: string, color: string, bg: string, logoUrl: string }> = {
    HIKVISION: { label: "Hikvision", color: "#E4002B", bg: "bg-red-500/10", logoUrl: "/logos/hikvision.png" },
    AKUVOX: { label: "Akuvox", color: "#005BA4", bg: "bg-blue-500/10", logoUrl: "/logos/akuvox.png" },
    INTELBRAS: { label: "Intelbras", color: "#009639", bg: "bg-emerald-500/10", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Intelbras_logo.svg" },
    DAHUA: { label: "Dahua", color: "#ED1C24", bg: "bg-red-500/10", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/b/b3/Dahua_Technology_logo.svg" },
    ZKTECO: { label: "ZKTeco", color: "#0191D2", bg: "bg-sky-500/10", logoUrl: "https://www.zkteco.com/upload/201908/5d4d3c3f3f0f7.png" },
    AVICAM: { label: "Avicam", color: "#8E8E8E", bg: "bg-muted/10", logoUrl: "" },
    MILESIGHT: { label: "Milesight", color: "#00AEEF", bg: "bg-cyan-500/10", logoUrl: "" },
    UNIFI: { label: "UniFi", color: "#0559C9", bg: "bg-blue-600/10", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Ubiquiti_Networks_logo.svg" },
    UNIVIEW: { label: "Uniview", color: "#005EB8", bg: "bg-blue-700/10", logoUrl: "https://www.uniview.com/etc/designs/uniview/logo.png" },
    BOSCH: { label: "Bosch", color: "#E20015", bg: "bg-red-500/10", logoUrl: "https://upload.wikimedia.org/wikipedia/commons/0/0e/Bosch-brand.svg" },
};


// go2rtc MP4-over-HTTP live video for Bosch cameras (WS/MSE falla por el proxy)
function BoschLiveVideo({ ip }: { ip: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!ip) { setFailed(true); return; }
        const video = videoRef.current; if (!video) return;
        const streamName = `bosch_${ip.replace(/\./g, "_")}`;
        let tries = 0; let stopped = false;
        const start = () => { if (stopped) return; setFailed(false); video.src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}&t=${Date.now()}`; video.play().catch(() => {}); };
        const onErr = () => { if (stopped) return; if (tries++ < 6) setTimeout(start, 1300); else setFailed(true); };
        const onProgress = () => { try { if (video.buffered.length) { const end = video.buffered.end(video.buffered.length - 1); if (end - video.currentTime > 2.5) video.currentTime = end; } } catch {} };
        video.addEventListener("error", onErr);
        video.addEventListener("progress", onProgress);
        start();
        return () => { stopped = true; video.removeEventListener("error", onErr); video.removeEventListener("progress", onProgress); video.pause(); video.removeAttribute("src"); video.load(); };
    }, [ip]);
    if (failed) {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-neutral-400">
                <Camera size={32} className="mb-2 opacity-30" />
                <span className="text-xs">Reconectando…</span>
            </div>
        );
    }
    return <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-contain" />;
}

function LiveVideo({ streamName, deviceId }: { streamName: string; deviceId?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const video = videoRef.current; if (!video || !streamName) { setFailed(true); return; }
        let tries = 0; let stopped = false; let wd: any = null;
        const src = () => `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}&video=h264&t=${Date.now()}`;
        const arm = () => { clearTimeout(wd); wd = setTimeout(() => { if (stopped) return; if ((video.readyState < 3 || video.paused) && tries++ < 8) start(); else if (tries >= 8) setFailed(true); }, 3500); };
        const start = () => { if (stopped) return; setFailed(false); try { video.src = src(); video.play().catch(() => {}); } catch {} arm(); };
        const onErr = () => { if (stopped) return; if (tries++ < 8) setTimeout(start, 1300); else setFailed(true); };
        const onProgress = () => { try { if (video.buffered.length) { const end = video.buffered.end(video.buffered.length - 1); if (end - video.currentTime > 2.5) video.currentTime = end; } } catch {} };
        const onPlaying = () => { clearTimeout(wd); tries = 0; };
        video.addEventListener("error", onErr);
        video.addEventListener("progress", onProgress);
        video.addEventListener("playing", onPlaying);
        start();
        return () => { stopped = true; clearTimeout(wd); video.removeEventListener("error", onErr); video.removeEventListener("progress", onProgress); video.removeEventListener("playing", onPlaying); try { video.pause(); video.removeAttribute("src"); video.load(); } catch {} };
    }, [streamName]);
    if (failed && deviceId) return <SnapFallback deviceId={deviceId} />;
    return <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-contain" />;
}
function SnapFallback({ deviceId }: { deviceId: string }) {
    const [src, setSrc] = useState(`/api/snapshot/${deviceId}?t=${Date.now()}`);
    useEffect(() => { const iv = setInterval(() => setSrc(`/api/snapshot/${deviceId}?t=${Date.now()}`), 2000); return () => clearInterval(iv); }, [deviceId]);
    return <img src={src} alt="" className="absolute inset-0 w-full h-full object-contain" />;
}

function fmtUptime(sec?: number): string {
    if (!sec || sec <= 0) return "—";
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
function fmtClock(iso?: string): string {
    if (!iso) return "—";
    const t = Date.parse(iso);
    if (isNaN(t)) return "—";
    return new Date(t).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function DevicesPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [devices, setDevices] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [testingDevice, setTestingDevice] = useState<string | null>(null);
    const [triggeringRelay, setTriggeringRelay] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<Record<string, { success: boolean; message: string }>>({});
    const [deviceStats, setDeviceStats] = useState<Record<string, { faces: number; tags: number }>>({});
    const [managingMemory, setManagingMemory] = useState<any>(null);
    const [configActionUrl, setConfigActionUrl] = useState<any>(null);
    const [viewingLive, setViewingLive] = useState<any>(null);
    const [managingPlates, setManagingPlates] = useState<any>(null);
    const [calibrating, setCalibrating] = useState<any>(null);
    const [calibrandoInterior, setCalibrandoInterior] = useState<any>(null);
    const [health, setHealth] = useState<Record<string, any>>({});
    const [syncing, setSyncing] = useState<string | null>(null);
    const [streamBusy, setStreamBusy] = useState<string | null>(null);
    const [userCounts, setUserCounts] = useState<Record<string, number | null>>({});
    const [loadingCounts, setLoadingCounts] = useState(false);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [healthHistory, setHealthHistory] = useState<any>(null);
    const [showReadRate, setShowReadRate] = useState(false);
    const [modules, setModules] = useState<Record<ModuleId, boolean>>({
        MODULE_LPR: true,
        MODULE_FACE: true,
        MODULE_QUEUE: false,
    });

    const typeFilter = searchParams.get('type');

    // Build allowed device types based on active modules
    const allowedTypes: string[] = [];
    if (modules.MODULE_LPR) { allowedTypes.push("LPR_CAMERA"); allowedTypes.push("NVR"); }
    if (modules.MODULE_FACE) allowedTypes.push("FACE_TERMINAL");
    if (modules.MODULE_QUEUE) allowedTypes.push("QUEUE_COUNTER");

    const filteredDevices = devices.filter(d => {
        // Only show devices whose type belongs to an active module
        if (!allowedTypes.includes(d.deviceType)) return false;
        const matchesType = !typeFilter || d.deviceType === typeFilter || (typeFilter === "LPR_CAMERA" && d.deviceType === "NVR");
        const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            d.ip.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (d.location && d.location.toLowerCase().includes(searchTerm.toLowerCase()));
        return matchesType && matchesSearch;
    });

    // El NVR va en su propia tabla de salud debajo; el resto en la tabla principal
    const cameraDevices = filteredDevices.filter(d => d.deviceType !== 'NVR');
    const nvrDevices = filteredDevices.filter(d => d.deviceType === 'NVR');

    useEffect(() => {
        loadData();
        getEnabledModules().then(setModules);

        // Socket Connection for Real-time Status
        const socket = io(window.location.origin, { path: '/io/socket.io', transports: ['polling'] });

        socket.on("device_status", (data) => {
            setDevices(prev => prev.map(d => {
                if (d.id === data.deviceId || d.mac === data.mac) {
                    return { ...d, doorStatus: data.doorStatus === 'open' ? 'OPEN' : 'CLOSED' };
                }
                return d;
            }));
        });

        socket.on("access_event", (event) => {
            // Si el evento viene de uno de nuestros dispositivos, actualizamos su estado visual
            setDevices(prev => prev.map(d => {
                const deviceMac = d.mac?.replace(/:/g, '').toLowerCase();
                const eventMac = event.deviceMac?.replace(/:/g, '').toLowerCase();

                if (d.id === event.deviceId || (deviceMac && eventMac && deviceMac === eventMac)) {
                    // Si es un acceso concedido, simulamos la apertura de puerta visualmente
                    if (event.decision === "GRANT") {
                        setTimeout(() => {
                            setDevices(curr => curr.map(currD =>
                                currD.id === d.id ? { ...currD, doorStatus: 'CLOSED' } : currD
                            ));
                        }, 5000);
                        return { ...d, doorStatus: 'OPEN', lastEvent: event };
                    }
                    return { ...d, lastEvent: event };
                }
                return d;
            }));
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    // Sondeo activo de salud (estado real + latencia + hora/NTP + salud NVR + usuarios)
    useEffect(() => {
        let stop = false;
        const pull = async () => {
            try {
                const r = await fetch('/api/devices/health', { cache: 'no-store' });
                const j = await r.json();
                if (!stop && j?.ok) setHealth(j.devices || {});
            } catch { }
            try {
                const ra = await fetch('/api/devices/alerts', { cache: 'no-store' });
                const ja = await ra.json();
                if (!stop && ja?.ok) setAlerts(ja.active || []);
            } catch { }
        };
        pull();
        const iv = setInterval(pull, 30000);
        return () => { stop = true; clearInterval(iv); };
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [devData, groupData] = await Promise.all([getDevices(), getAccessGroups()]);
            setDevices(devData);
            setGroups(groupData as any[]);
            loadUserCounts(); // conteo de matrículas/usuarios cargados en cada cámara (asíncrono)

            // Stats are no longer loaded automatically to prevent lag on entry
            // They will be loaded on demand or if the user clicks 'Refresh'
        } finally {
            setLoading(false);
        }
    }

    async function refreshHealth() {
        try { const r = await fetch('/api/devices/health', { cache: 'no-store' }); const j = await r.json(); if (j?.ok) setHealth(j.devices || {}); } catch { }
    }

    async function loadUserCounts() {
        setLoadingCounts(true);
        try { const counts = await getCameraUserCounts(); setUserCounts(counts || {}); }
        catch { } finally { setLoadingCounts(false); }
    }

    async function syncTime(opts: { deviceId?: string; all?: boolean }) {
        const key = opts.all ? "__all__" : (opts.deviceId || "");
        setSyncing(key);
        try {
            const r = await fetch('/api/devices/sync-time', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...opts, mode: 'now' }),
            });
            const j = await r.json();
            if (j.ok) toast.success(opts.all ? `Hora sincronizada (${j.applied}/${j.total})` : "Hora sincronizada", { description: "Se puso la hora del servidor en el equipo" });
            else toast.error("No se pudo sincronizar la hora", { description: j.error });
            setTimeout(refreshHealth, 1200);
        } catch (e: any) { toast.error("Error sincronizando", { description: e?.message }); }
        finally { setSyncing(null); }
    }

    async function probeStream(deviceId: string) {
        setStreamBusy(deviceId);
        try {
            const r = await fetch(`/api/devices/stream?deviceId=${deviceId}`, { cache: 'no-store' });
            const j = await r.json();
            const s = j.stream;
            if (s?.frameOk) toast.success("Stream OK", { description: `Frame ${Math.round((s.bytes || 0) / 1024)} KB en ${s.ms} ms · ${s.consumers} viewer(s)` });
            else toast.error("El stream no responde", { description: s?.configured ? "Configurado pero sin frame (¿cámara caída?)" : "No está en go2rtc" });
        } catch (e: any) { toast.error("Error probando stream", { description: e?.message }); }
        finally { setStreamBusy(null); }
    }

    async function restartStream(deviceId: string) {
        setStreamBusy(deviceId);
        try {
            const r = await fetch(`/api/devices/stream?deviceId=${deviceId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart' }),
            });
            const j = await r.json();
            if (j.ok && j.frameOk) toast.success("Stream reiniciado", { description: `Frame OK en ${j.ms} ms` });
            else if (j.ok) toast.warning("Stream reiniciado", { description: "Aún sin frame; puede tardar unos segundos" });
            else toast.error("No se pudo reiniciar", { description: j.error });
            setTimeout(refreshHealth, 1500);
        } catch (e: any) { toast.error("Error reiniciando stream", { description: e?.message }); }
        finally { setStreamBusy(null); }
    }

    async function handleRefreshStats(deviceId: string) {
        try {
            const stats = await getDeviceStats(deviceId);
            setDeviceStats(prev => ({ ...prev, [deviceId]: stats }));
        } catch (error) {
            console.error("Failed to refresh stats:", error);
        }
    }

    async function handleTestConnection(id: string) {
        setTestingDevice(id);
        const result = await testDeviceConnection(id);
        setConnectionStatus(prev => ({ ...prev, [id]: result }));
        setTestingDevice(null);
    }

    async function handleTriggerRelay(id: string) {
        setTriggeringRelay(id);
        await triggerDeviceRelay(id);
        setTimeout(() => setTriggeringRelay(null), 3000); // Animation duration
    }

    async function handleSyncPlates(id: string) {
        setTriggeringRelay(id); // Use same state for loading feedback or add a new one
        const result = await syncPlatesToDevice(id);
        if (result.success) {
            await loadData();
        }
        setTriggeringRelay(null);
    }

    const setFilter = (type?: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (type) {
            params.set('type', type);
        } else {
            params.delete('type');
        }
        router.push(`${pathname}?${params.toString()}`);
    };

    return (
        <div className="p-6 space-y-4 animate-in fade-in duration-500">
            {/* Compact Header */}
            <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                        <Network className="text-indigo-400" size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">
                            Dispositivos
                        </h1>
                        <p className="text-[11px] text-muted-foreground">
                            {filteredDevices.length} dispositivo{filteredDevices.length !== 1 ? "s" : ""} {typeFilter ? `· ${TYPE_META[typeFilter]?.label || typeFilter}` : ""}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full lg:w-auto">
                    {/* Module-aware filter tabs */}
                    <div className="flex items-center gap-1 bg-card/80 p-1 rounded-lg border border-border/60">
                        <button
                            onClick={() => setFilter()}
                            className={cn(
                                "h-8 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                                !typeFilter ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-muted-foreground hover:bg-accent"
                            )}
                        >
                            Todos
                        </button>
                        {allowedTypes.map(type => {
                            const meta = TYPE_META[type];
                            return (
                                <button
                                    key={type}
                                    onClick={() => setFilter(type)}
                                    className={cn(
                                        "h-8 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border border-transparent",
                                        typeFilter === type ? meta.activeClass : "text-muted-foreground hover:text-muted-foreground hover:bg-accent"
                                    )}
                                >
                                    {meta.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="relative flex-1 lg:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                        <input
                            type="text"
                            placeholder="Buscar dispositivo..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-card/80 border border-border/60 h-9 rounded-lg pl-9 pr-3 text-xs font-medium focus:ring-1 focus:ring-indigo-500/30 focus:border-indigo-500/30 outline-none transition-all placeholder:text-muted-foreground text-foreground"
                        />
                    </div>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button onClick={() => setShowReadRate(true)} variant="outline" className="h-9 px-3 rounded-lg text-xs shrink-0 gap-1.5 border-border/60 bg-card/80 hover:bg-accent">
                                    <ScanLine size={15} className="text-amber-400" /> <span className="hidden sm:inline">Tasa de lectura</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs max-w-[200px]">% de placas leídas vs no reconocidas, por cámara y por hora</p></TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={() => syncTime({ all: true })}
                                    disabled={syncing === "__all__"}
                                    variant="outline"
                                    className="h-9 px-3 rounded-lg text-xs shrink-0 gap-1.5 border-border/60 bg-card/80 hover:bg-accent"
                                >
                                    {syncing === "__all__" ? <Loader2 size={15} className="animate-spin" /> : <TimerReset size={15} />}
                                    <span className="hidden sm:inline">Sincronizar hora</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs max-w-[200px]">Pone la hora del servidor en todas las cámaras y el NVR (funciona sin internet)</p></TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <DeviceFormDialog groups={groups} onSuccess={loadData}>
                        <Button className="bg-indigo-600 hover:bg-indigo-500 text-foreground font-bold h-9 px-4 rounded-lg transition-all active:scale-95 text-xs shrink-0 gap-1.5">
                            <Plus size={15} /> Nuevo
                        </Button>
                    </DeviceFormDialog>
                </div>
            </header>

            {alerts.length > 0 && (
                <div className="border border-red-500/30 bg-red-500/[0.07] rounded-lg p-3 space-y-2 animate-in fade-in duration-300">
                    <div className="flex items-center gap-2 text-red-400 text-[11px] font-bold uppercase tracking-wide">
                        <AlertTriangle size={14} className="animate-pulse" /> {alerts.length} alerta{alerts.length !== 1 ? "s" : ""} activa{alerts.length !== 1 ? "s" : ""}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {alerts.slice(0, 10).map((a) => {
                            const dev = devices.find((d) => d.id === a.deviceId);
                            return (
                                <button key={a.id} onClick={() => dev && setHealthHistory(dev)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-card/70 border border-red-500/25 text-[11px] hover:bg-red-500/10 transition">
                                    <span className={cn("w-1.5 h-1.5 rounded-full", a.severity === "critical" ? "bg-red-500 animate-pulse" : "bg-amber-500")} />
                                    <span className="font-semibold text-foreground">{dev?.name || "Equipo"}</span>
                                    <span className="text-muted-foreground">· {a.message}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                <Table>
                    <TableHeader className="bg-card/60">
                        <TableRow className="border-border/60 hover:bg-transparent">
                            <TableHead className="text-muted-foreground font-semibold tracking-wide py-3 pl-5 uppercase text-[10px]">Dispositivo</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">Marca / Modelo</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">Red</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Tipo</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Hora / NTP</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Enlace</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Usuarios</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Estado</TableHead>
                            <TableHead className="text-right text-muted-foreground font-semibold tracking-wide pr-5 uppercase text-[10px]">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {cameraDevices.length === 0 && !loading && (
                            <TableRow>
                                <TableCell colSpan={9} className="text-center py-20">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="p-5 bg-card/50 rounded-lg border border-dashed border-border">
                                            <Server size={36} className="text-muted-foreground" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-sm font-semibold text-muted-foreground">No se encontraron dispositivos</p>
                                            <p className="text-xs text-muted-foreground">Intenta con otro término de búsqueda o agrega un dispositivo.</p>
                                        </div>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                        {cameraDevices.map((dev) => {
                            const brand = BRAND_CONFIG[dev.brand] || { label: dev.brand, color: "#fff", bg: "bg-muted" };
                            const isOpening = triggeringRelay === dev.id;
                            const h = health[dev.id];

                            return (
                                <TableRow key={dev.id} className="border-border/50 hover:bg-foreground/[0.04] transition-colors group">
                                    <TableCell className="py-3 pl-5">
                                        <div className="flex items-center gap-4">
                                            <div className="relative">
                                                <div className="w-11 h-11 rounded-md bg-white flex items-center justify-center p-1.5 border border-border/30 overflow-hidden">
                                                    <img
                                                        src={
                                                            dev.modelPhoto ||
                                                            DRIVER_MODELS[dev.brand as keyof typeof DRIVER_MODELS]?.find((m: any) => m.value === dev.deviceModel)?.photo ||
                                                            DEVICE_MODELS[dev.brand]?.[dev.deviceType] ||
                                                            DEVICE_MODELS[dev.brand]?.DEFAULT ||
                                                            brand.logoUrl ||
                                                            PLACEHOLDER_DEVICE
                                                        }
                                                        alt={brand.label}
                                                        className="w-full h-full object-contain"
                                                        onError={(e) => {
                                                            const fallback = brand.logoUrl || PLACEHOLDER_DEVICE;
                                                            if ((e.target as any).src !== fallback) {
                                                                (e.target as any).src = fallback;
                                                            }
                                                        }}
                                                    />
                                                    {dev.brandLogo && (
                                                        <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-white rounded p-0.5 border border-border shadow-sm">
                                                            <img src={dev.brandLogo} alt="Brand" className="w-full h-full object-contain" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <div>
                                                    <p className="font-semibold text-foreground text-sm leading-none">{dev.name}</p>
                                                </div>

                                                    <div className="flex items-center gap-2 pt-0.5">
                                                        <div className={cn(
                                                            "px-2 py-0.5 rounded flex items-center gap-1 transition-all duration-500 border text-[9px] font-bold uppercase tracking-wide",
                                                            dev.doorStatus === 'OPEN'
                                                                ? "bg-red-500/15 border-red-500/30 text-red-400 animate-pulse"
                                                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                        )}>
                                                            {dev.doorStatus === 'OPEN' ? (
                                                                <><Unlock size={9} /> Abierta</>
                                                            ) : (
                                                                <><Lock size={9} /> Cerrada</>
                                                            )}
                                                        </div>

                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        onClick={() => handleTriggerRelay(dev.id)}
                                                                        disabled={isOpening}
                                                                        size="icon"
                                                                        className={cn(
                                                                            "h-6 w-6 rounded transition-all border",
                                                                            isOpening
                                                                                ? "bg-emerald-500 border-emerald-400 text-foreground"
                                                                                : "bg-card text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 border-border hover:border-emerald-500/30"
                                                                        )}
                                                                    >
                                                                        {isOpening ? <Unlock className="animate-bounce" size={11} /> : <Zap size={11} />}
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent><p>Accionar Relé</p></TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>

                                                        {isOpening && (
                                                            <span className="text-blue-400 text-[9px] font-semibold animate-pulse flex items-center gap-1">
                                                                <RefreshCw size={9} className="animate-spin" /> Procesando
                                                            </span>
                                                        )}

                                                        {dev.lastEvent && (
                                                            <span className="text-[9px] font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 animate-in fade-in duration-500">
                                                                {dev.lastEvent.user?.name || dev.lastEvent.plateDetected || "Sistema"}
                                                            </span>
                                                        )}
                                                    </div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded bg-foreground/10 border border-border/40 p-1.5 flex items-center justify-center overflow-hidden shrink-0">
                                                <img
                                                    src={dev.brandLogo || brand.logoUrl || PLACEHOLDER_BRAND}
                                                    alt={brand.label}
                                                    className="max-w-full max-h-full object-contain"
                                                    onError={(e) => {
                                                        const target = e.target as HTMLImageElement;
                                                        target.src = PLACEHOLDER_BRAND;
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{brand.label}</p>
                                                <p className="text-xs font-semibold text-foreground">{dev.deviceModel || "Default"}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-0.5">
                                            <p className="text-xs text-foreground font-mono font-medium">{dev.ip}</p>
                                            {dev.location ? (
                                                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                    <Globe size={10} className="text-blue-400/70" /> {dev.location}
                                                </p>
                                            ) : (
                                                <p className="text-[10px] text-muted-foreground font-mono">
                                                    {dev.mac || "—"}
                                                </p>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {dev.deviceType === 'LPR_CAMERA' && dev.direction ? (
                                            <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide border", dev.direction === 'ENTRY' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-orange-500/10 text-orange-400 border-orange-500/20")}>
                                                {dev.direction === 'ENTRY' ? 'Entrada' : 'Salida'}
                                            </span>
                                        ) : <span className="text-muted-foreground text-xs">-</span>}
                                    </TableCell>
                                    {/* Hora / NTP */}
                                    <TableCell className="text-center">
                                        <div className="inline-flex items-center gap-1.5">
                                        {h?.reachable && h?.localTime ? (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div className="inline-flex flex-col items-center cursor-help">
                                                            <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground">
                                                                <Clock size={11} className={cn(Math.abs(h.driftSec ?? 0) > 90 ? "text-amber-400" : "text-emerald-400/70")} />
                                                                {fmtClock(h.localTime)}
                                                            </span>
                                                            <span className={cn(
                                                                "text-[8px] font-bold uppercase tracking-wide px-1 rounded",
                                                                h.timeMode === 'NTP' ? "text-emerald-400" : "text-amber-400"
                                                            )}>
                                                                {h.timeMode === 'NTP' ? 'NTP' : 'Manual'}
                                                                {typeof h.driftSec === 'number' && Math.abs(h.driftSec) > 90 ? ` · ${h.driftSec > 0 ? '+' : ''}${h.driftSec}s` : ''}
                                                            </span>
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="text-[10px]">Reloj del equipo: <b>{fmtClock(h.localTime)}</b></p>
                                                        <p className="text-[10px]">Modo: <b>{h.timeMode || '—'}</b></p>
                                                        <p className="text-[10px]">Desfase vs servidor: <b className={cn(Math.abs(h.driftSec ?? 0) > 90 ? "text-amber-400" : "text-emerald-400")}>{typeof h.driftSec === 'number' ? `${h.driftSec > 0 ? '+' : ''}${h.driftSec}s` : '—'}</b></p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        ) : (
                                            <span className="text-muted-foreground text-xs font-mono">—</span>
                                        )}
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <button
                                                            onClick={() => syncTime({ deviceId: dev.id })}
                                                            disabled={syncing === dev.id}
                                                            className="h-6 w-6 rounded flex items-center justify-center border border-border/50 bg-card/50 text-muted-foreground hover:text-emerald-400 hover:border-emerald-500/30 transition-all"
                                                        >
                                                            {syncing === dev.id ? <Loader2 size={11} className="animate-spin" /> : <TimerReset size={11} />}
                                                        </button>
                                                    </TooltipTrigger>
                                                    <TooltipContent><p className="text-[10px]">Poner hora del servidor</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger>
                                                        <div className={cn(
                                                            "w-7 h-7 rounded flex items-center justify-center transition-all border",
                                                            (dev.lastOnlinePull && (new Date().getTime() - new Date(dev.lastOnlinePull).getTime()) < 5 * 60 * 1000)
                                                                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                                                                : "bg-card/50 border-border/50 text-muted-foreground"
                                                        )}>
                                                            <DownloadCloud size={13} />
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="font-semibold text-xs">PULL</p>
                                                        <p className="text-[10px] text-muted-foreground">{dev.lastOnlinePull ? new Date(dev.lastOnlinePull).toLocaleTimeString() : 'Nunca'}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>

                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger>
                                                        <div className={cn(
                                                            "w-7 h-7 rounded flex items-center justify-center transition-all border",
                                                            (dev.lastOnlinePush && (new Date().getTime() - new Date(dev.lastOnlinePush).getTime()) < 5 * 60 * 1000)
                                                                ? "bg-blue-500/10 border-blue-500/25 text-blue-400"
                                                                : "bg-card/50 border-border/50 text-muted-foreground"
                                                        )}>
                                                            <UploadCloud size={13} />
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="font-semibold text-xs">PUSH</p>
                                                        <p className="text-[10px] text-muted-foreground">{dev.lastOnlinePush ? new Date(dev.lastOnlinePush).toLocaleTimeString() : 'Nunca'}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>

                                            {dev.deviceType === 'LPR_CAMERA' && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger>
                                                        <div className={cn(
                                                            "w-7 h-7 rounded flex items-center justify-center transition-all border",
                                                            !h ? "bg-card/50 border-border/50 text-muted-foreground"
                                                                : (h.streamConfigured && h.streamProducers > 0) ? "bg-violet-500/10 border-violet-500/25 text-violet-400"
                                                                    : h.streamConfigured ? "bg-card/50 border-border/50 text-muted-foreground"
                                                                        : "bg-red-500/10 border-red-500/25 text-red-400"
                                                        )}>
                                                            {streamBusy === dev.id ? <Loader2 size={12} className="animate-spin" /> : <Radio size={13} />}
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="font-semibold text-xs">Stream go2rtc</p>
                                                        <p className="text-[10px] text-muted-foreground">{!h ? 'Sondeando…' : h.streamConfigured ? `Configurado · ${h.streamProducers} fuente(s)` : 'No configurado'}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            )}
                                        </div>
                                    </TableCell>
                                    {/* Usuarios cargados = matrículas en la lista blanca de la cámara */}
                                    <TableCell className="text-center">
                                        {dev.deviceType === 'LPR_CAMERA' && dev.brand === 'HIKVISION' ? (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className={cn(
                                                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold font-mono cursor-help",
                                                            userCounts[dev.id] == null ? "bg-card/50 text-muted-foreground border-border/50"
                                                                : "bg-blue-500/10 text-blue-400 border-blue-500/25"
                                                        )}>
                                                            <Users size={11} />
                                                            {(loadingCounts && userCounts[dev.id] === undefined)
                                                                ? <Loader2 size={10} className="animate-spin" />
                                                                : (userCounts[dev.id] == null ? '—' : userCounts[dev.id])}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p className="text-[10px] font-semibold">Matrículas cargadas en la cámara</p>
                                                        <p className="text-[10px] text-muted-foreground">Lista blanca ANPR (whitelist del equipo)</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {(() => {
                                            const now = new Date().getTime();
                                            const lastPull = dev.lastOnlinePull ? new Date(dev.lastOnlinePull).getTime() : 0;
                                            const lastPush = dev.lastOnlinePush ? new Date(dev.lastOnlinePush).getTime() : 0;

                                            // Diff calculation with math abs to handle slight clock skews
                                            const diffPull = Math.abs(now - lastPull);
                                            const diffPush = Math.abs(now - lastPush);

                                            // Sondeo activo (ISAPI) manda; si aún no corrió, cae a la heurística pull/push
                                            const probed = h && typeof h.reachable === 'boolean';
                                            const isOnline = probed
                                                ? h.reachable
                                                : ((lastPull > 0 && diffPull < 10 * 60 * 1000) || (lastPush > 0 && diffPush < 10 * 60 * 1000));

                                            const lastSeenMsg = probed
                                                ? (h.reachable ? `Sondeo OK · ${h.latencyMs ?? '?'} ms` : 'Sin respuesta ISAPI')
                                                : lastPull > lastPush
                                                    ? `Sincro: ${new Date(lastPull).toLocaleTimeString()}`
                                                    : lastPush > 0 ? `Evento: ${new Date(lastPush).toLocaleTimeString()}` : 'Sin datos';

                                            return (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    "text-[9px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded border cursor-help",
                                                                    isOnline
                                                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                                                        : "bg-red-500/10 text-red-400 border-red-500/25"
                                                                )}
                                                            >
                                                                <span className={cn("w-1.5 h-1.5 rounded-full mr-1.5 inline-block", isOnline ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                                                                {isOnline ? "Online" : "Offline"}
                                                            </Badge>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p className="font-bold uppercase text-[10px]">{lastSeenMsg}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell className="text-right pr-5">
                                        <div className="flex justify-end items-center gap-2">
                                            {/* Face/Tags Stats Badge */}
                                            {dev.deviceType === 'FACE_TERMINAL' && dev.brand !== 'HIKVISION' && (
                                                <div className="flex items-center gap-2 bg-card/60 p-1 rounded-md border border-border/50">
                                                    <div className="flex flex-col items-center bg-purple-500/8 border border-purple-500/15 rounded px-1.5 py-0.5 min-w-[36px]">
                                                        <span className="text-[7px] text-purple-400/70 font-semibold uppercase tracking-wide leading-none">Faces</span>
                                                        <span className="text-[10px] font-mono font-semibold text-purple-400">
                                                            {deviceStats[dev.id]?.faces ?? "--"}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col items-center bg-amber-500/8 border border-amber-500/15 rounded px-1.5 py-0.5 min-w-[36px]">
                                                        <span className="text-[7px] text-amber-400/70 font-semibold uppercase tracking-wide leading-none">Tags</span>
                                                        <span className="text-[10px] font-mono font-semibold text-amber-400">
                                                            {deviceStats[dev.id]?.tags ?? "--"}
                                                        </span>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleRefreshStats(dev.id)}
                                                        className="h-6 w-6 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                                    >
                                                        <RefreshCw size={11} className={cn(loading ? "animate-spin" : "")} />
                                                    </Button>
                                                </div>
                                            )}

                                            {dev.deviceType === 'LPR_INTERIOR' && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setCalibrandoInterior(dev)}
                                                            className="h-8 w-8 rounded-md bg-card/50 text-muted-foreground hover:text-teal-400 hover:bg-teal-500/10 border border-border/50 hover:border-teal-500/30 transition-all"
                                                        >
                                                            <Wand2 size={15} />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent><p>Calibrar cámara interior</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            )}

                                            {dev.deviceType === 'LPR_CAMERA' && dev.brand === 'HIKVISION' && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setCalibrating(dev)}
                                                            className="h-8 w-8 rounded-md bg-card/50 text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 border border-border/50 hover:border-amber-500/30 transition-all"
                                                        >
                                                            <Wand2 size={15} />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent><p>Calibrar ANPR</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            )}

                                            {dev.deviceType !== 'NVR' && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setViewingLive(dev)}
                                                            className="h-8 w-8 rounded-md bg-card/50 text-muted-foreground hover:text-indigo-400 hover:bg-indigo-500/10 border border-border/50 hover:border-indigo-500/30 transition-all"
                                                        >
                                                            <Eye size={15} />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent><p>Ver en Vivo</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            )}

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                                                        <MoreHorizontal size={15} />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-48 bg-card border-border text-foreground">
                                                    <DropdownMenuLabel className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Gestión</DropdownMenuLabel>

                                                    {dev.deviceType === 'FACE_TERMINAL' && (
                                                        <DropdownMenuItem onClick={() => setManagingMemory(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-indigo-400 focus:bg-foreground/10 focus:text-indigo-400">
                                                            <Database size={14} /> Memoria Flash
                                                        </DropdownMenuItem>
                                                    )}

                                                    {dev.deviceType === 'LPR_CAMERA' && dev.brand === 'HIKVISION' && (
                                                        <DropdownMenuItem onClick={() => setManagingPlates(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-blue-400 focus:bg-foreground/10 focus:text-blue-400">
                                                            <Database size={14} /> Lista Blanca LPR
                                                        </DropdownMenuItem>
                                                    )}

                                                    {dev.deviceType === 'LPR_CAMERA' && (
                                                        <>
                                                            <DropdownMenuItem onClick={() => syncTime({ deviceId: dev.id })} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-emerald-400 focus:bg-foreground/10 focus:text-emerald-400">
                                                                <TimerReset size={14} /> Sincronizar hora
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => probeStream(dev.id)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-violet-400 focus:bg-foreground/10 focus:text-violet-400">
                                                                <Play size={14} /> Probar stream
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => restartStream(dev.id)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-violet-400 focus:bg-foreground/10 focus:text-violet-400">
                                                                <Radio size={14} /> Reiniciar stream
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => setHealthHistory(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-indigo-400 focus:bg-foreground/10 focus:text-indigo-400">
                                                                <Activity size={14} /> Historial de salud
                                                            </DropdownMenuItem>
                                                        </>
                                                    )}

                                                    {dev.brand === 'AKUVOX' && (
                                                        <DropdownMenuItem onClick={() => setConfigActionUrl(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-orange-400 focus:bg-foreground/10 focus:text-orange-400">
                                                            <Network size={14} /> Webhooks (Action URL)
                                                        </DropdownMenuItem>
                                                    )}

                                                    <DropdownMenuSeparator className="bg-foreground/10" />

                                                    <DeviceFormDialog device={dev} groups={groups} onSuccess={loadData}>
                                                        <div className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs font-bold outline-none transition-colors hover:bg-accent hover:text-blue-400 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 gap-2">
                                                            <Settings2 size={14} /> Editar Configuración
                                                        </div>
                                                    </DeviceFormDialog>

                                                    <DropdownMenuSeparator className="bg-foreground/10" />

                                                    <DeleteConfirmDialog
                                                        id={dev.id}
                                                        title={dev.name}
                                                        description="Se eliminará este dispositivo."
                                                        onDelete={deleteDevice}
                                                        onSuccess={loadData}
                                                    >
                                                        <div className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs font-bold outline-none transition-colors hover:bg-red-500/10 hover:text-red-500 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 gap-2 text-red-400">
                                                            <Trash2 size={14} /> Eliminar
                                                        </div>
                                                    </DeleteConfirmDialog>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow >
                            );
                        })}
                    </TableBody >
                </Table >
            </div >

            {/* ─────────────── Tabla de salud del NVR ─────────────── */}
            {nvrDevices.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 pt-1">
                        <Server size={15} className="text-blue-400" />
                        <h2 className="text-sm font-bold text-foreground">Salud del NVR</h2>
                        <span className="text-[10px] text-muted-foreground">· sondeo activo cada 30s</span>
                    </div>
                    <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                        <Table>
                            <TableHeader className="bg-card/60">
                                <TableRow className="border-border/60 hover:bg-transparent">
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide py-3 pl-5 uppercase text-[10px]">NVR</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">Salud</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">IP / MAC</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">Discos (SMART)</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">CPU / Mem</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Latencia</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Uptime</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Hora / NTP</TableHead>
                                    <TableHead className="text-muted-foreground font-semibold tracking-wide text-center pr-5 uppercase text-[10px]">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {nvrDevices.map((dev) => {
                                    const brand = BRAND_CONFIG[dev.brand] || { label: dev.brand, color: "#fff", bg: "bg-muted" };
                                    const h = health[dev.id];
                                    const disks: any[] = h?.disks || [];
                                    const disksOk = disks.length > 0 && disks.every((d) => d.status === 'ok');
                                    const healthy = h?.reachable && (disks.length === 0 || disksOk) && (h?.memPct == null || h.memPct < 95);
                                    return (
                                        <TableRow key={dev.id} className="border-border/50 hover:bg-foreground/[0.04] transition-colors">
                                            <TableCell className="py-3 pl-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                                        <Server size={18} className="text-blue-400" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-foreground text-sm leading-none">{dev.name}</p>
                                                        <p className="text-[10px] text-muted-foreground mt-1">{dev.deviceModel || brand.label}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {h ? (
                                                    <span className={cn(
                                                        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide",
                                                        !h.reachable ? "bg-red-500/10 text-red-400 border-red-500/25"
                                                            : healthy ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                                                : "bg-amber-500/10 text-amber-400 border-amber-500/25"
                                                    )}>
                                                        <span className={cn("w-1.5 h-1.5 rounded-full", !h.reachable ? "bg-red-500" : healthy ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                                                        {!h.reachable ? "Offline" : healthy ? "Saludable" : "Atención"}
                                                    </span>
                                                ) : <span className="text-muted-foreground text-xs">Sondeando…</span>}
                                            </TableCell>
                                            <TableCell>
                                                <p className="text-xs text-foreground font-mono">{dev.ip}</p>
                                                <p className="text-[10px] text-muted-foreground font-mono">{dev.mac || '—'}</p>
                                            </TableCell>
                                            <TableCell>
                                                {disks.length > 0 ? (
                                                    <div className="flex flex-col gap-1">
                                                        {disks.map((d, i) => (
                                                            <TooltipProvider key={i}>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <span className="inline-flex items-center gap-1.5 cursor-help">
                                                                            <HardDrive size={12} className={d.status === 'ok' ? "text-emerald-400" : "text-red-400"} />
                                                                            <span className="text-[11px] text-foreground">{d.capacityGB >= 1000 ? (d.capacityGB / 1000).toFixed(1) + ' TB' : d.capacityGB + ' GB'}</span>
                                                                            <span className="text-[9px] text-muted-foreground">{d.usedPct}% usado</span>
                                                                            <span className={cn("text-[8px] font-bold uppercase px-1 rounded", d.status === 'ok' ? "text-emerald-400" : "text-red-400")}>{d.status === 'ok' ? 'SMART OK' : d.status}</span>
                                                                        </span>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p className="text-[10px]">{d.model}</p>
                                                                        <p className="text-[10px] text-muted-foreground">S/N {d.serial}</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        ))}
                                                    </div>
                                                ) : <span className="text-muted-foreground text-xs">{h?.reachable ? 'Sin discos' : '—'}</span>}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="text-[9px] text-muted-foreground cursor-help">CPU: N/D</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent><p className="text-[10px] max-w-[180px]">Este NVR no expone uso de CPU por ISAPI. Se monitorea memoria, discos y uptime.</p></TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                    {h?.memPct != null ? (
                                                        <div className="w-16">
                                                            <div className="flex items-center gap-1">
                                                                <MemoryStick size={11} className={h.memPct >= 90 ? "text-amber-400" : "text-cyan-400"} />
                                                                <span className="text-[11px] font-mono text-foreground">{h.memPct}%</span>
                                                            </div>
                                                            <div className="h-1 rounded-full bg-border/60 overflow-hidden mt-0.5">
                                                                <div className={cn("h-full rounded-full", h.memPct >= 90 ? "bg-amber-400" : "bg-cyan-400")} style={{ width: `${h.memPct}%` }} />
                                                            </div>
                                                        </div>
                                                    ) : <span className="text-muted-foreground text-xs">—</span>}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {h?.reachable ? (
                                                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-mono", (h.latencyMs ?? 0) > 400 ? "text-amber-400" : "text-emerald-400")}>
                                                        <Timer size={11} /> {h.latencyMs ?? '?'} ms
                                                    </span>
                                                ) : <span className="text-red-400 text-[11px] inline-flex items-center gap-1"><AlertTriangle size={11} /> s/resp</span>}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="text-[11px] font-mono text-foreground">{fmtUptime(h?.uptimeSec)}</span>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {h?.localTime ? (
                                                    <div className="inline-flex flex-col items-center">
                                                        <span className="font-mono text-[11px] text-foreground">{fmtClock(h.localTime)}</span>
                                                        <span className={cn("text-[8px] font-bold uppercase", h.timeMode === 'NTP' ? "text-emerald-400" : "text-amber-400")}>{h.timeMode || '—'}</span>
                                                    </div>
                                                ) : <span className="text-muted-foreground text-xs">—</span>}
                                            </TableCell>
                                            <TableCell className="text-center pr-5">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                                                            <MoreHorizontal size={15} />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-48 bg-card border-border text-foreground">
                                                        <DropdownMenuLabel className="text-xs font-bold uppercase tracking-widest text-muted-foreground">NVR</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={() => syncTime({ deviceId: dev.id })} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-emerald-400 focus:bg-foreground/10 focus:text-emerald-400">
                                                            <TimerReset size={14} /> Sincronizar hora
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setHealthHistory(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-indigo-400 focus:bg-foreground/10 focus:text-indigo-400">
                                                            <Activity size={14} /> Historial de salud
                                                        </DropdownMenuItem>
                                                        <DeviceFormDialog device={dev} groups={groups} onSuccess={loadData}>
                                                            <div className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs font-bold outline-none transition-colors hover:bg-accent hover:text-blue-400 gap-2">
                                                                <Settings2 size={14} /> Editar / Mapeo de canales
                                                            </div>
                                                        </DeviceFormDialog>
                                                        <DropdownMenuSeparator className="bg-foreground/10" />
                                                        <DeleteConfirmDialog id={dev.id} title={dev.name} description="Se eliminará este NVR." onDelete={deleteDevice} onSuccess={loadData}>
                                                            <div className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs font-bold outline-none transition-colors hover:bg-red-500/10 hover:text-red-500 gap-2 text-red-400">
                                                                <Trash2 size={14} /> Eliminar
                                                            </div>
                                                        </DeleteConfirmDialog>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}

            {calibrating && (
                <CameraCalibrator device={calibrating} onClose={() => setCalibrating(null)} />
            )}

            {calibrandoInterior && (
                <InteriorCalibrator device={calibrandoInterior} onClose={() => setCalibrandoInterior(null)} />
            )}

            {healthHistory && (
                <HealthHistoryDialog device={healthHistory} onClose={() => setHealthHistory(null)} />
            )}

            {showReadRate && (
                <ReadRateDialog onClose={() => setShowReadRate(false)} />
            )}

            {managingMemory && (
                <DeviceMemoryDialog
                    device={managingMemory}
                    open={!!managingMemory}
                    onOpenChange={(v) => !v && setManagingMemory(null)}
                />
            )}

            {managingPlates && (
                <DevicePlateListDialog
                    device={managingPlates}
                    open={!!managingPlates}
                    onOpenChange={(v) => !v && setManagingPlates(null)}
                />
            )}

            {configActionUrl && (
                <AkuvoxActionUrlDialog
                    device={configActionUrl}
                    open={!!configActionUrl}
                    onOpenChange={(v) => !v && setConfigActionUrl(null)}
                />
            )}

            {viewingLive && (() => {
                const streamName = viewingLive.brand === "BOSCH"
                    ? `bosch_${String(viewingLive.ip).replace(/\./g, "_")}`
                    : (viewingLive.deviceType === "FACE" ? `face_${viewingLive.id}` : `lpr_${viewingLive.id}`);
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setViewingLive(null)}>
                        <div className="relative w-full max-w-5xl aspect-video rounded-xl overflow-hidden shadow-lg bg-black group" onClick={(e) => e.stopPropagation()}>
                            <LiveVideo key={streamName} streamName={streamName} deviceId={viewingLive.id} />
                            <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md">
                                <span className="flex h-2 w-2 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>
                                <span className="text-[10px] font-bold text-white uppercase tracking-wide">Live</span>
                                <span className="text-[10px] text-white/70">· {viewingLive.name}</span>
                            </div>
                            <button onClick={() => setViewingLive(null)} className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/50 backdrop-blur-md text-white/90 hover:bg-black/70 flex items-center justify-center transition-colors">
                                <Plus className="rotate-45" size={18} />
                            </button>
                            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                                <button onClick={(e) => { const box = (e.currentTarget as HTMLElement).closest(".group"); const v = box?.querySelector("video") as HTMLVideoElement | null; if (v) v.muted = !v.muted; }} className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-md text-white/90 hover:bg-black/70 flex items-center justify-center"><Volume2 size={15} /></button>
                                <button onClick={(e) => { const box = (e.currentTarget as HTMLElement).closest(".group") as HTMLElement | null; if (box) { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen?.(); } }} className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-md text-white/90 hover:bg-black/70 flex items-center justify-center"><Maximize2 size={15} /></button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div >
    );
}
