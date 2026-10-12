"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { Tooltip as ReactTooltip } from "react-tooltip";
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
import { ProvisionButton } from "@/components/ProvisionButton";
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
import { Radar } from "lucide-react";
import { getDevicesWithAnalytics } from "@/app/actions/detections";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { HardDrive as HardDriveIco, ScanSearch, Calculator } from "lucide-react";
import { CajonDispositivo } from "@/components/devices/CajonDispositivo";
import { AlertasFila, claseNombreConAlerta, type AlertaEquipo } from "@/components/devices/AlertasFila";
import { ConfirmarHora } from "@/components/devices/ConfirmarHora";
import { IntrusionCalibrator as CalibradorIntrusion } from "@/components/IntrusionCalibrator";
import { TablaIntrusion } from "@/components/devices/TablaIntrusion";
import { ImportarCanalesNvr } from "@/components/devices/ImportarCanalesNvr";
import { Car as CarIco, Radar as RadarIco, Server as ServerIco, ChevronDown as ChevronDownIco, Download as DownloadIco, LogIn as LogInIco, LogOut as LogOutIco } from "lucide-react";
import { grabacionesDe, detectarGrabaciones, calcularRetencion, type FilaGrabacion } from "@/app/actions/grabaciones";
import { CeldaGrabacion } from "@/components/devices/CeldaGrabacion";
import { SyncToDevicesDialog } from "@/components/SyncToDevicesDialog";
import { VistaArea } from "@/components/devices/VistaArea";
import { ArbolAreas, arrastrarEquipos, enArea, IconoTipo, TODAS } from "@/components/devices/ArbolAreas";
import { leerAreas, type EstadoAreas } from "@/app/actions/areas";

// Inline SVG data URIs for fallback images (avoid 404s for missing placeholder files)
const PLACEHOLDER_DEVICE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="8" fill="%23262626"/><path d="M24 14a4 4 0 100 8 4 4 0 000-8zm-6 14c0-2 4-3.1 6-3.1S30 26 30 28v1H18v-1z" fill="%23525252"/><rect x="14" y="32" width="20" height="3" rx="1.5" fill="%23525252"/></svg>')}`;
const PLACEHOLDER_BRAND = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="4" fill="%23262626"/><circle cx="16" cy="16" r="8" stroke="%23525252" stroke-width="1.5" fill="none"/><path d="M16 12v4l3 3" stroke="%23525252" stroke-width="1.5" stroke-linecap="round"/></svg>')}`;

const TYPE_META: Record<string, { label: string; color: string; activeClass: string }> = {
    LPR_CAMERA: { label: "Cámaras LPR", color: "text-amber-400", activeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    CAMERA: { label: "Intrusión", color: "text-red-400", activeClass: "bg-red-500/15 text-red-300 border-red-500/30" },
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
    const [analyticsIds, setAnalyticsIds] = useState<Set<string>>(new Set());
    useEffect(() => { getDevicesWithAnalytics().then((ids) => setAnalyticsIds(new Set(ids))).catch(() => { }); }, []);
    const [managingPlates, setManagingPlates] = useState<any>(null);
    const [calibrating, setCalibrating] = useState<any>(null);
    const [health, setHealth] = useState<Record<string, any>>({});
    const [syncing, setSyncing] = useState<string | null>(null);
    const [streamBusy, setStreamBusy] = useState<string | null>(null);
    const [userCounts, setUserCounts] = useState<Record<string, number | null>>({});
    const [loadingCounts, setLoadingCounts] = useState(false);
    const [alerts, setAlerts] = useState<any[]>([]);
    const alertasDe = useMemo(() => { const m: Record<string, AlertaEquipo[]> = {}; for (const a of alerts) (m[a.deviceId] ||= []).push(a); return m; }, [alerts]);
    const [healthHistory, setHealthHistory] = useState<any>(null);
    const [showReadRate, setShowReadRate] = useState(false);
    // Grabaciones de las camaras LPR: NVR + canal (detectado) y retencion calculada.
    const [grab, setGrab] = useState<Record<string, FilaGrabacion>>({});
    const [detectando, setDetectando] = useState<string | null>(null);
    const [calculando, setCalculando] = useState<string | null>(null);
    const cargarGrab = async () => { try { setGrab(await grabacionesDe(["LPR_CAMERA", "CAMERA"])); } catch { } };
    useEffect(() => { cargarGrab(); }, []);
    // Áreas (árbol para agrupar equipos) y el nodo elegido, que filtra la tabla.
    const [areas, setAreas] = useState<EstadoAreas>({ areas: [], equipos: {} });
    const [areaSel, setAreaSelState] = useState<string>(TODAS);
    const setAreaSel = (v: string) => { setAreaSelState(v); try { localStorage.setItem("devices.area", v); } catch { } };
    useEffect(() => { leerAreas().then(setAreas).catch(() => { }); try { const v = localStorage.getItem("devices.area"); if (v) setAreaSelState(v); } catch { } }, []);
    const buscador = useRef<HTMLInputElement>(null);
    const [panelCerrado, setPanelCerrado] = useState(false);
    useEffect(() => { try { setPanelCerrado(localStorage.getItem("devices.panel") === "0"); } catch { } }, []);
    const colapsarPanel = (v: boolean) => { setPanelCerrado(v); try { localStorage.setItem("devices.panel", v ? "0" : "1"); } catch { } };
    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) { e.preventDefault(); buscador.current?.focus(); } };
        window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
    }, []);
    async function detectar(ids?: string[]) {
        setDetectando(ids?.length === 1 ? ids[0] : "__todas__");
        try {
            const r = await detectarGrabaciones(ids);
            if (!r.ok) toast.error("No se pudo detectar", { description: r.error });
            else {
                const caidos = r.nvrs.filter((n) => !n.ok);
                toast.success(r.cambios.length ? `Grabación detectada en ${r.cambios.length} cámara${r.cambios.length !== 1 ? "s" : ""}` : `Revisados ${r.nvrs.length} NVR: el mapa ya estaba bien`, {
                    description: [r.cambios.slice(0, 4).join(" · "), r.sinNvr.length ? `Sin NVR: ${r.sinNvr.slice(0, 4).join(", ")}${r.sinNvr.length > 4 ? "…" : ""} (agregá su NVR o no tendrán grabaciones)` : "", caidos.length ? `No respondió: ${caidos.map((n) => n.nombre).join(", ")}` : ""].filter(Boolean).join(" — ") || undefined,
                });
            }
            await cargarGrab();
        } finally { setDetectando(null); }
    }
    async function retencion(id: string) {
        setCalculando(id);
        try {
            const r = await calcularRetencion(id);
            if (r.ok && r.retencion && !r.retencion.error) toast.success(`Retención: ${r.retencion.dias} días`, { description: `La grabación más vieja es del ${r.retencion.desde}${r.retencion.grabando === false ? " · OJO: no está grabando ahora" : ""}` });
            else toast.error("No se pudo calcular la retención", { description: r.error || r.retencion?.error });
            await cargarGrab();
        } finally { setCalculando(null); }
    }
    const [modules, setModules] = useState<Record<ModuleId, boolean>>({
        MODULE_LPR: true,
        MODULE_FACE: true,
        MODULE_QUEUE: false,
    });

    // Cada clase de equipo en su vista (como san-nicolas): LPR, intrusión y NVR no se mezclan.
    const allowedTypes: string[] = [];
    if (modules.MODULE_LPR) { allowedTypes.push("LPR_CAMERA"); allowedTypes.push("CAMERA"); allowedTypes.push("NVR"); }
    if (modules.MODULE_FACE) allowedTypes.push("FACE_TERMINAL");
    if (modules.MODULE_QUEUE) allowedTypes.push("QUEUE_COUNTER");
    const pedido = searchParams.get('type');
    const typeFilter = pedido && allowedTypes.includes(pedido) ? pedido : (allowedTypes[0] || "LPR_CAMERA");
    // Alta: un solo botón que pregunta qué se agrega (LPR, intrusión o NVR) e importar canales de un NVR.
    const [alta, setAlta] = useState<null | "lpr" | "intrusion" | "nvr" | "otro">(null);
    const [editando, setEditando] = useState<any>(null);
    const [calibIntr, setCalibIntr] = useState<any>(null);
    // Sincronizar hora: siempre se pregunta antes (lista de equipos + desfase actual).
    const [pedirHora, setPedirHora] = useState<any[] | null>(null);
    const [importandoDe, setImportandoDe] = useState<any>(null);

    const filteredDevices = devices.filter(d => {
        // Only show devices whose type belongs to an active module
        if (!allowedTypes.includes(d.deviceType)) return false;
        const matchesType = d.deviceType === typeFilter;
        const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            d.ip.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (d.location && d.location.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesArea = areaSel === TODAS || !areas.areas.length && areaSel !== "__sin__" ? true : enArea(areas, d.id, areaSel);
        return matchesType && matchesSearch && matchesArea;
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
            {/* Encabezado: título y alta a la izquierda/derecha; abajo la barra con tipos, buscador al centro y herramientas */}
            {/* Una sola fila: título · buscador al centro · acciones + Agregar */}
            <header className="grid grid-cols-1 xl:grid-cols-[minmax(220px,1fr)_minmax(0,620px)_minmax(220px,1fr)] items-center gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                        <Network className="text-indigo-400" size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground leading-tight">Dispositivos</h1>
                        <p className="text-[11px] text-muted-foreground">
                            {filteredDevices.length} {TYPE_META[typeFilter]?.label || typeFilter}{areaSel !== TODAS ? ` · ${areaSel === "__sin__" ? "sin área" : areas.areas.find((a) => a.id === areaSel)?.nombre || "área"}` : ""}{searchTerm ? ` · «${searchTerm}»` : ""}
                        </p>
                    </div>
                </div>
                <div className="relative w-full group order-3 xl:order-none">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-indigo-500 transition-colors" size={17} />
                    <input ref={buscador} type="text" placeholder="Buscar por nombre, IP o ubicación…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-background border border-border/70 h-11 rounded-xl pl-11 pr-20 text-[13.5px] font-medium outline-none transition-all placeholder:text-muted-foreground/70 text-foreground focus:border-indigo-500/60 focus:ring-4 focus:ring-indigo-500/10 shadow-sm" />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                        {searchTerm ? (
                            <button onClick={() => setSearchTerm("")} className="h-6 px-2 rounded-md text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">Limpiar</button>
                        ) : <kbd className="h-6 px-2 rounded-md border border-border bg-muted/60 text-[11px] font-mono text-muted-foreground grid place-items-center" data-tooltip-id="tt-grab" data-tooltip-content="Atajo: tecla / para buscar">/</kbd>}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                    {(typeFilter === "LPR_CAMERA" || typeFilter === "CAMERA") && (
                        <button onClick={() => detectar(filteredDevices.map((d) => d.id))} disabled={!!detectando}
                            data-tooltip-id="tt-grab" data-tooltip-content={`Detectar grabaciones: busca cada cámara de esta vista (${filteredDevices.length}) en los canales de todos los NVR, por su IP, y vincula dónde graba. No borra vínculos existentes.`}
                            className="h-10 w-10 rounded-xl grid place-items-center border border-border/60 bg-background/70 hover:bg-accent hover:border-border transition-colors">
                            {detectando === "__todas__" ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={17} className="text-indigo-400" />}
                        </button>
                    )}
                    {typeFilter === "LPR_CAMERA" && <SyncToDevicesDialog variante="boton" onSuccess={() => loadUserCounts()} />}
                    {typeFilter === "LPR_CAMERA" && (
                        <button onClick={() => setShowReadRate(true)} data-tooltip-id="tt-grab" data-tooltip-content="Tasa de lectura: % de placas leídas vs no reconocidas, por cámara y por hora."
                            className="h-10 w-10 rounded-xl grid place-items-center border border-border/60 bg-background/70 hover:bg-accent hover:border-border transition-colors">
                            <ScanLine size={17} className="text-amber-400" />
                        </button>
                    )}
                    <button onClick={() => setPedirHora(devices.filter((d) => ["LPR_CAMERA", "NVR"].includes(d.deviceType) && ["HIKVISION", "DAHUA"].includes(d.brand)))}
                        data-tooltip-id="tt-grab" data-tooltip-content="Sincronizar hora: muestra la hora y el desfase de cada cámara LPR y NVR y pregunta antes de poner la hora del servidor."
                        className="h-10 w-10 rounded-xl grid place-items-center border border-border/60 bg-background/70 hover:bg-accent hover:border-border transition-colors">
                        <TimerReset size={17} className="text-emerald-500" />
                    </button>
                                    <span className="w-px h-7 bg-border mx-1" />
                    <Button onClick={() => setAlta(modules.MODULE_LPR ? "lpr" : "otro")} data-tooltip-id="tt-grab" data-tooltip-content="Alta guiada: primero elegís qué equipo es (cámara LPR, cámara de intrusión o NVR) y después sólo se piden los datos de ese tipo."
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold h-10 px-5 rounded-xl transition-all active:scale-95 text-sm gap-2 shrink-0 shadow-lg shadow-indigo-600/20">
                    <Plus size={16} /> Agregar
                </Button>
                </div>
            </header>

            <div className="flex gap-4 items-start">
                <ArbolAreas estado={areas} setEstado={setAreas} devices={devices} tiposVisibles={allowedTypes} tipoActual={typeFilter}
                    seleccion={areaSel} onSeleccion={setAreaSel} onAbrirEquipo={(d) => (["LPR_CAMERA", "CAMERA", "NVR"].includes(d.deviceType) ? setEditando(d) : null)} health={health} alertasDe={alertasDe}
                    colapsado={panelCerrado} onColapsar={colapsarPanel} onTipo={(t) => { setAreaSel(TODAS); setFilter(t); }}
                    tipos={allowedTypes.map((t) => ({ tipo: t, rotulo: TYPE_META[t]?.label || t, cuenta: devices.filter((d) => d.deviceType === t).length, alertas: devices.filter((d) => d.deviceType === t && alertasDe[d.id]?.length).length }))} />
                <div className="flex-1 min-w-0 space-y-4">
            {areaSel !== TODAS ? (
                <VistaArea estado={areas} areaId={areaSel} devices={devices.filter((d) => allowedTypes.includes(d.deviceType))} busqueda={searchTerm}
                    health={health} alertasDe={alertasDe} grab={grab} detectando={detectando} calculando={calculando}
                    onDetectar={(ids) => detectar(ids)} onRetencion={retencion} onEditar={(d) => (["LPR_CAMERA", "CAMERA", "NVR"].includes(d.deviceType) ? setEditando(d) : null)}
                    onCalibrar={(d) => (d.deviceType === "CAMERA" ? setCalibIntr(d) : setCalibrating(d))}
                    onSalud={(d) => setHealthHistory(d)} onElegirArea={setAreaSel} />
            ) : (<>

            {typeFilter !== "NVR" && typeFilter !== "CAMERA" && (
            <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                <Table>
                    <TableHeader className="bg-card/60">
                        <TableRow className="border-border/60 hover:bg-transparent">
                            <TableHead className="text-muted-foreground font-semibold tracking-wide py-2.5 pl-4 uppercase text-[10px]">Equipo</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">Red</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">Grabación</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Hora</TableHead>
                            <TableHead className="text-muted-foreground font-semibold tracking-wide text-center uppercase text-[10px]">Estado · enlaces</TableHead>
                            <TableHead className="text-right text-muted-foreground font-semibold tracking-wide pr-4 uppercase text-[10px]">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {cameraDevices.length === 0 && !loading && (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-20">
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
                                <TableRow key={dev.id} draggable onDragStart={(e) => arrastrarEquipos(e, [dev.id], dev.name)} onClick={(e: React.MouseEvent) => { const t = e.target as HTMLElement; if (!(e.currentTarget as HTMLElement).contains(t) || t.closest('button,a,input,select,textarea,label,[role="menuitem"],[data-no-fila]')) return; if (["LPR_CAMERA", "CAMERA", "NVR"].includes(dev.deviceType)) setEditando(dev); }} className={cn("border-border/50 hover:bg-foreground/[0.04] transition-colors group cursor-pointer", alertasDe[dev.id] && "bg-red-500/[0.035]")}>
                                    <TableCell className="py-2 pl-4">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="relative shrink-0">
                                                <div className="w-9 h-9 rounded-md bg-white flex items-center justify-center p-1 border border-border/30">
                                                    <img src={dev.modelPhoto || DRIVER_MODELS[dev.brand as keyof typeof DRIVER_MODELS]?.find((m: any) => m.value === dev.deviceModel)?.photo || DEVICE_MODELS[dev.brand]?.[dev.deviceType] || DEVICE_MODELS[dev.brand]?.DEFAULT || brand.logoUrl || PLACEHOLDER_DEVICE}
                                                        alt={brand.label} className="w-full h-full object-contain"
                                                        onError={(e) => { const f = brand.logoUrl || PLACEHOLDER_DEVICE; if ((e.target as any).src !== f) (e.target as any).src = f; }} />
                                                </div>
                                                {dev.deviceType === "LPR_CAMERA" && (
                                                    <span className="absolute -top-1.5 -left-1.5 h-[18px] w-[18px] rounded-md bg-amber-500 text-black grid place-items-center shadow ring-2 ring-background" data-tooltip-id="tt-grab" data-tooltip-content="Cámara LPR"><CarIco size={10} /></span>
                                                )}
                                            </div>
                                            <div className="min-w-0 space-y-1">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <p className={cn("font-semibold text-foreground text-[13px] leading-none truncate max-w-[200px]", claseNombreConAlerta(alertasDe[dev.id]))} data-tooltip-id="tt-grab" data-tooltip-content={dev.name}>{dev.name}</p>
                                                    {dev.deviceType === "LPR_CAMERA" && dev.direction && (
                                                        <span className={cn("h-[16px] px-1 rounded text-[9px] font-black grid place-items-center", dev.direction === "ENTRY" ? "bg-emerald-500/15 text-emerald-500" : "bg-orange-500/15 text-orange-500")}
                                                            data-tooltip-id="tt-grab" data-tooltip-content={dev.direction === "ENTRY" ? "Entrada" : "Salida"}>{dev.direction === "ENTRY" ? <LogInIco size={10} /> : <LogOutIco size={10} />}</span>
                                                    )}
                                                    {analyticsIds.has(dev.id) && <span className="h-[16px] w-[16px] rounded bg-red-500/15 text-red-500 grid place-items-center" data-tooltip-id="tt-grab" data-tooltip-content="Con analíticas configuradas"><Radar size={10} /></span>}
                                                </div>
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    <span className="h-[17px] px-1.5 rounded bg-muted text-[9px] font-bold uppercase text-muted-foreground grid place-items-center" data-tooltip-id="tt-grab" data-tooltip-content={`${brand.label}${dev.deviceModel ? ` · ${dev.deviceModel}` : ""}`}>
                                                        {(brand.label || dev.brand || "").slice(0, 3)}{dev.deviceModel ? ` · ${String(dev.deviceModel).replace(/^i?DS-/i, "").slice(0, 12)}` : ""}
                                                    </span>
                                                    <button onClick={() => handleTriggerRelay(dev.id)} disabled={isOpening}
                                                        data-tooltip-id="tt-grab" data-tooltip-content={dev.doorStatus === "OPEN" ? "Barrera abierta · tocar para accionar el relé" : "Barrera cerrada · tocar para accionar el relé"}
                                                        className={cn("h-[17px] px-1.5 rounded text-[9px] font-bold uppercase inline-flex items-center gap-1 border transition-colors",
                                                            isOpening ? "bg-emerald-500 text-white border-emerald-500" : dev.doorStatus === "OPEN" ? "bg-red-500/15 text-red-500 border-red-500/30 animate-pulse" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20")}>
                                                        {isOpening ? <RefreshCw size={9} className="animate-spin" /> : dev.doorStatus === "OPEN" ? <Unlock size={9} /> : <Zap size={9} />} {isOpening ? "..." : "Relé"}
                                                    </button>
                                                    {dev.deviceType === "LPR_CAMERA" && dev.brand === "HIKVISION" && (
                                                        <span className="h-[17px] px-1.5 rounded bg-blue-500/10 text-blue-500 text-[9px] font-bold font-mono inline-flex items-center gap-1" data-tooltip-id="tt-grab" data-tooltip-content="Matrículas cargadas en la lista de la cámara">
                                                            <Users size={9} />{(loadingCounts && userCounts[dev.id] === undefined) ? <Loader2 size={9} className="animate-spin" /> : (userCounts[dev.id] ?? "—")}
                                                        </span>
                                                    )}
                                                    {dev.lastEvent && <span className="h-[17px] px-1.5 rounded bg-indigo-500/10 text-indigo-500 text-[9px] font-semibold truncate max-w-[110px] inline-flex items-center" data-tooltip-id="tt-grab" data-tooltip-content="Última lectura">{dev.lastEvent.user?.name || dev.lastEvent.plateDetected || "Sistema"}</span>}
                                                </div>
                                                <AlertasFila alertas={alertasDe[dev.id]} onVer={() => setHealthHistory(dev)} />
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <p className="text-[12px] text-foreground font-mono" data-tooltip-id="tt-grab" data-tooltip-content={`MAC ${dev.mac || "—"}`}>{dev.ip}</p>
                                        {dev.location && <p className="text-[10px] text-muted-foreground truncate max-w-[110px] flex items-center gap-1"><Globe size={9} /> {dev.location}</p>}
                                    </TableCell>
                                    <TableCell>
                                        {dev.deviceType !== 'LPR_CAMERA' ? <span className="text-muted-foreground text-xs">—</span> : (
                                            <CeldaGrabacion g={grab[dev.id]} detectando={detectando === dev.id || detectando === "__todas__"} calculando={calculando === dev.id}
                                                onDetectar={() => detectar([dev.id])} onRetencion={() => retencion(dev.id)} />
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <div className="inline-flex items-center gap-1">
                                            {h?.reachable && h?.localTime ? (
                                                <span className="inline-flex flex-col items-center leading-tight cursor-help"
                                                    data-tooltip-id="tt-grab" data-tooltip-content={`Reloj ${fmtClock(h.localTime)} · ${h.timeMode || "—"} · desfase ${typeof h.driftSec === "number" ? `${h.driftSec > 0 ? "+" : ""}${h.driftSec}s` : "—"}`}>
                                                    <span className={cn("font-mono text-[11.5px]", Math.abs(h.driftSec ?? 0) > 90 ? "text-amber-500 font-bold" : "text-foreground")}>{fmtClock(h.localTime)}</span>
                                                    <span className={cn("text-[8px] font-black uppercase", h.timeMode === "NTP" ? "text-emerald-500" : "text-amber-500")}>{h.timeMode === "NTP" ? "NTP" : "MAN"}{typeof h.driftSec === "number" && Math.abs(h.driftSec) > 90 ? ` ${h.driftSec > 0 ? "+" : ""}${h.driftSec}s` : ""}</span>
                                                </span>
                                            ) : <span className="text-muted-foreground text-xs font-mono">—</span>}
                                            <button onClick={() => setPedirHora([dev])} data-tooltip-id="tt-grab" data-tooltip-content="Poner la hora del servidor (pide confirmación)"
                                                className="h-6 w-6 rounded grid place-items-center text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"><TimerReset size={12} /></button>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {(() => {
                                            const now = Date.now();
                                            const pull = dev.lastOnlinePull && now - new Date(dev.lastOnlinePull).getTime() < 5 * 60 * 1000;
                                            const push = dev.lastOnlinePush && now - new Date(dev.lastOnlinePush).getTime() < 5 * 60 * 1000;
                                            const st = !h ? "nd" : (h.streamConfigured && h.streamProducers > 0) ? "ok" : h.streamConfigured ? "cfg" : "no";
                                            const lastPull = dev.lastOnlinePull ? new Date(dev.lastOnlinePull).getTime() : 0;
                                            const lastPush = dev.lastOnlinePush ? new Date(dev.lastOnlinePush).getTime() : 0;
                                            const probed = h && typeof h.reachable === "boolean";
                                            const on = probed ? h.reachable : ((lastPull > 0 && now - lastPull < 600000) || (lastPush > 0 && now - lastPush < 600000));
                                            const msg = probed ? (h.reachable ? `Responde · ${h.latencyMs ?? "?"} ms` : "Sin respuesta") : "Sin sondeo todavía";
                                            return (
                                                <div className="inline-flex items-center gap-1">
                                                    <span className={cn("h-6 px-2 rounded-md text-[9.5px] font-bold uppercase inline-flex items-center gap-1 border", on ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25" : "bg-red-500/10 text-red-500 border-red-500/25")}
                                                        data-tooltip-id="tt-grab" data-tooltip-content={msg}>
                                                        <span className={cn("w-1.5 h-1.5 rounded-full", on ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />{on ? "On" : "Off"}
                                                    </span>
                                                    <span className={cn("h-6 w-6 rounded grid place-items-center", pull ? "text-emerald-500 bg-emerald-500/10" : "text-muted-foreground/50")} data-tooltip-id="tt-grab" data-tooltip-content={`Pull: ${dev.lastOnlinePull ? new Date(dev.lastOnlinePull).toLocaleTimeString("es-UY") : "nunca"}`}><DownloadCloud size={12} /></span>
                                                    <span className={cn("h-6 w-6 rounded grid place-items-center", push ? "text-blue-500 bg-blue-500/10" : "text-muted-foreground/50")} data-tooltip-id="tt-grab" data-tooltip-content={`Push (eventos): ${dev.lastOnlinePush ? new Date(dev.lastOnlinePush).toLocaleTimeString("es-UY") : "nunca"}`}><UploadCloud size={12} /></span>
                                                    {dev.deviceType === "LPR_CAMERA" && (
                                                        <span className={cn("h-6 w-6 rounded grid place-items-center", st === "ok" ? "text-violet-500 bg-violet-500/10" : st === "no" ? "text-red-500 bg-red-500/10" : "text-muted-foreground/50")}
                                                            data-tooltip-id="tt-grab" data-tooltip-content={`Video en vivo: ${st === "nd" ? "sondeando…" : st === "no" ? "no configurado" : `configurado · ${h.streamProducers} fuente(s)`}`}>
                                                            {streamBusy === dev.id ? <Loader2 size={11} className="animate-spin" /> : <Radio size={12} />}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </TableCell>
                                    <TableCell className="text-right pr-4">
                                        <div className="flex justify-end items-center gap-1">
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

                                            {dev.deviceType === 'LPR_CAMERA' && dev.brand === 'HIKVISION' && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setCalibrating(dev)}
                                                            className="h-7 w-7 rounded-md bg-card/50 text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 border border-border/50 hover:border-amber-500/30 transition-all"
                                                        >
                                                            <Wand2 size={15} />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent><p>Calibrar ANPR</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            )}

                                            {dev.deviceType === 'LPR_CAMERA' && dev.brand === 'HIKVISION' && (
                                                <ProvisionButton deviceId={dev.id} deviceName={dev.name} onDone={() => handleRefreshStats(dev.id)} />
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
                                                            <DropdownMenuItem onClick={() => setPedirHora([dev])} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-emerald-400 focus:bg-foreground/10 focus:text-emerald-400">
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

                                                    {dev.deviceType === "LPR_CAMERA" ? (
                                                        <DropdownMenuItem onClick={() => setEditando(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-blue-400 focus:bg-foreground/10 focus:text-blue-400">
                                                            <Settings2 size={14} /> Editar configuración
                                                        </DropdownMenuItem>
                                                    ) : (
                                                    <DeviceFormDialog device={dev} groups={groups} onSuccess={loadData}>
                                                        <div className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs font-bold outline-none transition-colors hover:bg-accent hover:text-blue-400 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 gap-2">
                                                            <Settings2 size={14} /> Editar Configuración
                                                        </div>
                                                    </DeviceFormDialog>
                                                    )}

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
            )}

            {/* ─────────────── Cámaras de intrusión ─────────────── */}
            {typeFilter === "CAMERA" && (
                <TablaIntrusion devices={filteredDevices} health={health} analyticsIds={analyticsIds} groups={groups} onReload={loadData} onEditar={setEditando} alertasDe={alertasDe} onVerSalud={setHealthHistory}
                    grab={grab} detectando={detectando} calculando={calculando} onDetectar={(ids) => detectar(ids)} onRetencion={retencion} />
            )}

            {/* ─────────────── Tabla de salud del NVR ─────────────── */}
            {typeFilter === "NVR" && nvrDevices.length === 0 && (
                <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">No hay NVR dados de alta. Agregalo con «Agregar → NVR».</div>
            )}
            {typeFilter === "NVR" && nvrDevices.length > 0 && (
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
                                        <TableRow key={dev.id} draggable onDragStart={(e) => arrastrarEquipos(e, [dev.id], dev.name)} onClick={(e: React.MouseEvent) => { const t = e.target as HTMLElement; if (!(e.currentTarget as HTMLElement).contains(t) || t.closest('button,a,input,select,textarea,label,[role="menuitem"],[data-no-fila]')) return; setEditando(dev); }} className={cn("border-border/50 hover:bg-foreground/[0.04] transition-colors cursor-pointer", alertasDe[dev.id] && "bg-red-500/[0.035]")}>
                                            <TableCell className="py-3 pl-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                                        <Server size={18} className="text-blue-400" />
                                                    </div>
                                                    <div>
                                                        <p className={cn("font-semibold text-foreground text-sm leading-none", claseNombreConAlerta(alertasDe[dev.id]))}>{dev.name}</p>
                                                        <p className="text-[10px] text-muted-foreground mt-1" data-tooltip-id="tt-grab" data-tooltip-content={[h?.machineName && `Nombre: ${h.machineName}`, h?.firmware && `Firmware: ${h.firmware}`, h?.serial && `Serie: ${h.serial}`].filter(Boolean).join(" · ") || "Modelo"}>{h?.model || dev.deviceModel || brand.label}</p>
                                                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                                                            {h?.channels && (
                                                                <span className={cn("h-[17px] px-1.5 rounded text-[9px] font-bold inline-flex items-center gap-1", h.channels.caidos.length ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-500")}
                                                                    data-tooltip-id="tt-grab" data-tooltip-content={`${h.channels.conectados} de ${h.channels.usados} cámaras conectadas (${h.channels.total} canales)${h.channels.caidos.length ? `. Sin conexión: D${h.channels.caidos.join(", D")}` : ""}`}>
                                                                    <Camera size={9} /> {h.channels.conectados}/{h.channels.usados}
                                                                </span>
                                                            )}
                                                            {typeof h?.recording === "boolean" && <span className={cn("h-[17px] px-1.5 rounded text-[9px] font-bold inline-flex items-center gap-1", h.recording ? "bg-red-500/10 text-red-500" : "bg-muted text-muted-foreground")} data-tooltip-id="tt-grab" data-tooltip-content={h.recording ? "Grabando" : "No está grabando"}><span className={cn("w-1.5 h-1.5 rounded-full", h.recording ? "bg-red-500 animate-pulse" : "bg-muted-foreground")} /> REC</span>}
                                                            {h?.linkMbps && <span className="h-[17px] px-1.5 rounded bg-sky-500/10 text-sky-500 text-[9px] font-bold inline-flex items-center gap-1" data-tooltip-id="tt-grab" data-tooltip-content={`Enlace de red ${h.linkMbps} Mbps${h.rxGB != null ? ` · recibidos ${h.rxGB} GB / enviados ${h.txGB} GB desde el arranque` : ""}`}><Network size={9} /> {h.linkMbps >= 1000 ? `${h.linkMbps / 1000}G` : `${h.linkMbps}M`}</span>}
                                                        </div>
                                                        <AlertasFila alertas={alertasDe[dev.id]} onVer={() => setHealthHistory(dev)} />
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
                                                <p className="text-[10px] text-muted-foreground font-mono">{dev.mac || h?.mac || '—'}</p>
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
                                                    {h?.cpuPct != null ? (
                                                        <div className="w-16" data-tooltip-id="tt-grab" data-tooltip-content={`CPU ${h.cpuPct}%`}>
                                                            <div className="flex items-center gap-1"><Cpu size={11} className={h.cpuPct >= 85 ? "text-amber-400" : "text-violet-400"} /><span className="text-[11px] font-mono text-foreground">{h.cpuPct}%</span></div>
                                                            <div className="h-1 rounded-full bg-border/60 overflow-hidden mt-0.5"><div className={cn("h-full rounded-full", h.cpuPct >= 85 ? "bg-amber-400" : "bg-violet-400")} style={{ width: `${h.cpuPct}%` }} /></div>
                                                        </div>
                                                    ) : <span className="text-[9px] text-muted-foreground" data-tooltip-id="tt-grab" data-tooltip-content="Este equipo no informa uso de CPU.">CPU: N/D</span>}
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
                                                {h?.uptimeSec ? <span className="text-[11px] font-mono text-foreground">{fmtUptime(h.uptimeSec)}</span> : <span className="text-[11px] text-muted-foreground" data-tooltip-id="tt-grab" data-tooltip-content={h?.memTotalMB ? `Memoria ${h.memUsedMB}/${h.memTotalMB} MB. El equipo no informa uptime.` : "El equipo no informa uptime."}>—</span>}
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
                                                        <DropdownMenuItem onClick={() => setPedirHora([dev])} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-emerald-400 focus:bg-foreground/10 focus:text-emerald-400">
                                                            <TimerReset size={14} /> Sincronizar hora
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setHealthHistory(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-indigo-400 focus:bg-foreground/10 focus:text-indigo-400">
                                                            <Activity size={14} /> Historial de salud
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setImportandoDe(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-amber-400 focus:bg-foreground/10 focus:text-amber-400">
                                                            <DownloadIco size={14} /> Importar cámaras (clasificar)
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => setEditando(dev)} className="cursor-pointer gap-2 text-xs font-bold hover:bg-accent hover:text-blue-400 focus:bg-foreground/10 focus:text-blue-400">
                                                            <Settings2 size={14} /> Editar configuración
                                                        </DropdownMenuItem>
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

            </>)}
                </div>
            </div>
            <ReactTooltip id="tt-grab" place="top" className="!max-w-[300px] !text-[12px] !rounded-lg !z-[60]" />

            {calibrating && (
                <CameraCalibrator device={calibrating} onClose={() => setCalibrating(null)} />
            )}

            {/* Altas desde el botón «Agregar» */}
            <CajonDispositivo groups={groups} open={alta === "lpr"} onOpenChange={(v) => !v && setAlta(null)} onSuccess={() => { loadData(); cargarGrab(); }}
                alCalibrar={(d) => setCalibIntr(d)} alImportar={(d) => setImportandoDe(d)} />
            <CajonDispositivo device={editando} groups={groups} open={!!editando} onOpenChange={(v) => !v && setEditando(null)} onSuccess={() => { loadData(); cargarGrab(); }}
                alCalibrar={(d) => setCalibIntr(d)} alImportar={(d) => setImportandoDe(d)} />
            <DeviceFormDialog groups={groups} onSuccess={() => { loadData(); }} abierto={alta === "otro"} alCambiarAbierto={(v) => !v && setAlta(null)} />
            <ConfirmarHora equipos={pedirHora || []} health={health} open={!!pedirHora} onOpenChange={(v) => !v && setPedirHora(null)} onListo={() => setTimeout(refreshHealth, 1500)} />
            <ReactTooltip id="tt-alertas" place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[60]" />
            {calibIntr && <CalibradorIntrusion device={calibIntr} onClose={() => { setCalibIntr(null); loadData(); }} />}
            <ImportarCanalesNvr nvr={importandoDe} groups={groups} open={!!importandoDe} onOpenChange={(v) => !v && setImportandoDe(null)} onListo={() => { loadData(); cargarGrab(); }} />

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
