"use client";

import { useEffect, useState, useMemo , memo} from "react";
import { io, Socket } from "socket.io-client";
import { getAccessEvents, getEventsCountToday } from "@/app/actions/history";
import {
    Activity,
    Car,
    User as UserIcon,
    CreditCard,
    DoorOpen,
    CheckCircle2,
    XCircle,
    Clock,
    TrendingUp,
    TrendingDown,
    Zap,
    Shield,
    AlertTriangle,
    Filter,
    RefreshCw,
    Camera,
    LogIn,
    LogOut,
    Truck,
    Bus,
    Bike,
    Phone
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { VisorEventoAcceso } from "@/components/eventos/VisorEventoAcceso";
import Image from "next/image";
import { AccessEvent, Device, Unit } from "@prisma/client";
import { getCarLogo } from "@/lib/car-logos";
import { getVehicleBrandName } from "@/lib/hikvision-codes";

interface FullAccessEvent extends AccessEvent {
    user: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        dni: string | null;
        apartment: string | null;
        cara: string | null;
        unit: Unit | null;
        parkingSlotId: string | null;
    } | null;
    device: Device | null;
}

function TimeAgo({ timestamp }: { timestamp: string | Date }) {
    const [label, setLabel] = useState("");

    useEffect(() => {
        const update = () => {
            const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
            if (diff < 0) {
                setLabel("Ahora");
                return;
            }
            if (diff < 60) setLabel(`Hace ${diff}s`);
            else if (diff < 3600) setLabel(`Hace ${Math.floor(diff / 60)}m`);
            else if (diff < 86400) setLabel(`Hace ${Math.floor(diff / 3600)}h`);
            else setLabel(`Hace ${Math.floor(diff / 86400)}d`);
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [timestamp]);

    return <span>{label}</span>;
}

import { getSocketUrl } from "@/lib/socket-config";
import { fecha, horaSeg } from "@/lib/fechas";

interface DashboardProps {
    variant?: "acceso" | "lpr" | "mixto";
}


    // Helper for image URLs
    const getImageUrl = (path: string | null | undefined): string => {
        if (!path) return "";
        if (path.startsWith('http') || path.startsWith('/')) return path;
        return `/api/files/${path}`;
    };

    const EventItem = memo(({ event, plateCountsToday, calculateDuration }: { event: FullAccessEvent & { hasDoorOpen?: boolean; hasDoorClose?: boolean }; plateCountsToday: Record<string, number>; calculateDuration: (e: any) => any }) => {
        const isCall = event.plateDetected === 'CALL_START';

        const typeConfig = {
            PLATE: { icon: Car, color: "blue", label: "LPR", bgClass: "bg-blue-500/10", textClass: "text-blue-400" },
            FACE: { icon: UserIcon, color: "purple", label: "FACE", bgClass: "bg-purple-500/10", textClass: "text-purple-400" },
            TAG: { icon: CreditCard, color: "amber", label: "RFID", bgClass: "bg-amber-500/10", textClass: "text-amber-400" },
            DOOR: { icon: DoorOpen, color: "emerald", label: "DOOR", bgClass: "bg-emerald-500/10", textClass: "text-emerald-400" },
            CALL: { icon: Phone, color: "orange", label: "CALL", bgClass: "bg-orange-500/10", textClass: "text-orange-400" }
        };

        const config = isCall ? typeConfig.CALL : (typeConfig[event.accessType as keyof typeof typeConfig] || typeConfig.TAG);
        const TypeIcon = config.icon;



        // Parse details into meta object
        const meta: any = {};
        if (event.details) {
            event.details.split(',').forEach(p => {
                const [k, v] = p.split(':').map(s => s.trim());
                if (k && v) meta[k] = v;
            });
        }

        // Clean and Resolve Brand Name
        if (meta.Marca) {
            // Remove "UNKNOWN" suffix which is common
            let cleanBrand = meta.Marca.replace(/\s*UNKNOWN\s*/gi, '').trim();

            // Check for "BRAND <Code>" pattern
            const brandCodeMatch = cleanBrand.match(/BRAND\s*(\d+)/i);
            if (brandCodeMatch) {
                // Resolve numeric code to name
                cleanBrand = getVehicleBrandName(brandCodeMatch[1]);
            }

            meta.Marca = cleanBrand;
        }

        // Extract call destination if available
        let callDest = "Central";
        if (isCall && event.details) {
            const match = event.details.match(/a:\s*(\S+)/);
            if (match) callDest = match[1];
            else if (event.details.includes('Central')) callDest = 'Central';
            else callDest = event.details; // Fallback
        }

        const logoUrl = getCarLogo(meta.Marca);
        const plateKey = event.plateDetected && event.plateDetected !== 'unknown' && event.plateDetected !== 'NO_LEIDA' && !isCall ? event.plateDetected : (event.user?.id || 'sys');
        const plateCount = plateCountsToday[plateKey] || 0;

        const fullImageUrl = getImageUrl(event.snapshotPath);
        const faceCropUrl = getImageUrl(meta.FaceImage);

        const timeStatus = calculateDuration(event);

        // Check for Anomalous Plate (S/P, No Leida)
        const isAnomalous = event.accessType === "PLATE" && (
            event.plateDetected === "NO_LEIDA" ||
            event.plateDetected === "unknown" ||
            event.plateDetected === "S/P" ||
            !event.plateDetected
        );

        // Determine Display Name for Face
        const faceName = event.user?.name || meta.Rostro;
        const faceSimilarity = meta.Similitud;

        return (
            <VisorEventoAcceso event={event} timeStatus={timeStatus}>
                <div className={cn(
                    "p-4 cursor-pointer transition-all group border-b border-border last:border-0 border-l-[3px]",
                    isAnomalous
                        ? "bg-yellow-500/10 border-l-yellow-500 hover:bg-yellow-500/20"
                        : isCall
                            ? "bg-blue-900/10 border-l-blue-500 hover:bg-blue-900/20"
                            : "hover:bg-accent border-l-transparent hover:border-l-indigo-500"
                )}>
                    <div className="flex items-center gap-3">
                        {/* LEFT: ICON/IMAGE (ALL TYPES) */}
                        <div className={cn("rounded-lg shrink-0 flex items-center justify-center p-0.5", "bg-card border border-border shadow-sm overflow-hidden", "w-14 h-11 relative")}>
                            {(isCall) ? (
                                <div className="relative w-full h-full">
                                    {fullImageUrl ? (
                                        <Image
                                            src={fullImageUrl}
                                            alt="Snap"
                                            fill
                                            sizes="56px"
                                            className="object-cover opacity-80"
                                        />
                                    ) : (
                                        <div className={cn("w-full h-full flex items-center justify-center", config.bgClass)}>
                                            <TypeIcon size={18} className={config.textClass} />
                                        </div>
                                    )}
                                    {isCall && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
                                            <div className="relative">
                                                <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-75" />
                                                <Phone size={14} className="text-foreground relative z-10 drop-shadow-md" fill="currentColor" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : event.accessType === 'FACE' ? (
                                (fullImageUrl || meta.FaceImage || event.user?.cara) ? (
                                    <Image
                                        src={fullImageUrl || getImageUrl(meta.FaceImage || event.user?.cara)}
                                        alt="Face"
                                        fill
                                        sizes="56px"
                                        className="object-cover scale-110"
                                    />
                                ) : (
                                    <div className={cn("w-full h-full flex items-center justify-center", config.bgClass)}>
                                        <UserIcon size={18} className={config.textClass} />
                                    </div>
                                )
                            ) : event.accessType === 'TAG' && !event.plateDetected?.startsWith('DOOR') ? (
                                // TAG/RFID - Show RFID Icon (don't try to load potentially invalid snapshots)
                                <div className={cn("w-full h-full rounded flex items-center justify-center", "bg-amber-500/10")}>
                                    <CreditCard size={18} className="text-amber-400" />
                                </div>
                            ) : logoUrl ? (
                                <div className="relative w-full h-full p-1 bg-white">
                                    <Image
                                        src={logoUrl}
                                        alt="Logo"
                                        fill
                                        sizes="44px"
                                        className="object-contain"
                                    />
                                </div>
                            ) : (
                                <div className={cn("w-full h-full rounded flex items-center justify-center", config.bgClass)}>
                                    <TypeIcon size={18} className={config.textClass} />
                                </div>
                            )}
                        </div>

                        {/* CENTER: PRIMARY DATA */}
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    {event.accessType === "PLATE" ? (
                                        <div className={cn("flex flex-col border border-border rounded-sm overflow-hidden min-w-[80px] mt-0.5",
                                            event.plateDetected === "NO_LEIDA" ? "bg-red-600 border-red-500" : "bg-white")}>
                                            <div className="h-0.5 bg-blue-600 w-full" />
                                            <p className={cn("text-[12px] font-bold tracking-widest uppercase px-2 py-0.5 text-center font-mono leading-none",
                                                event.plateDetected === "NO_LEIDA" ? "text-foreground text-[9px]" : "text-black")}>
                                                {event.plateDetected === "NO_LEIDA" ? "No Leída" : event.plateDetected}
                                            </p>
                                        </div>
                                    ) : event.accessType === "TAG" && !isCall && event.plateDetected !== 'DOOR_OPEN' && event.plateDetected !== 'DOOR_CLOSE' ? (
                                        // TAG/RFID Event - Show Card Number prominently
                                        <div className="flex items-center gap-2">
                                            <div className="bg-amber-500/20 border border-amber-500/30 rounded-lg px-2.5 py-1 flex items-center gap-2">
                                                <CreditCard size={14} className="text-amber-400" />
                                                <span className="text-sm font-bold text-amber-400 uppercase tracking-wider font-mono">
                                                    {event.plateDetected || 'TARJETA'}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className={cn("text-sm font-bold truncate tracking-tight uppercase", isCall ? "text-blue-400" : "text-foreground")}>
                                            {isCall
                                                ? `LLAMADA DE ${event.device?.name?.replace('AKUVOX ', '') || 'PORTERO'}`
                                                : (event.plateDetected === 'DOOR_OPEN' || event.plateDetected === 'DOOR_CLOSE')
                                                    ? "CONTROL DE PUERTA"
                                                    : (event.accessType === 'FACE')
                                                        ? (faceName || "ROSTRO DETECTADO")
                                                        : (event.user?.name || event.plateDetected || "ID: " + event.id.slice(-4))}
                                        </p>
                                    )}

                                    {/* SEQUENCE INDICATORS (INLINE) */}
                                    <div className="flex items-center gap-1 ml-2">
                                        {event.hasDoorOpen && (
                                            <div title="Puerta Abierta" className="bg-emerald-500/20 text-emerald-400 p-0.5 rounded border border-emerald-500/30">
                                                <DoorOpen size={10} />
                                            </div>
                                        )}
                                        {event.hasDoorClose && (
                                            <div title="Puerta Cerrada" className="bg-indigo-500/20 text-indigo-400 p-0.5 rounded border border-indigo-500/30">
                                                <LogOut size={10} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate italic">
                                        {event.accessType === 'PLATE' ? (
                                            [meta.Marca, meta.Modelo, meta.Tipo]
                                                .filter(val => val && !['unknown', 'null', 'undefined'].includes(val.toLowerCase()))
                                                .join(' • ') || 'Vehículo Detectado'
                                        ) : isCall ? (
                                            `A: ${callDest}`
                                        ) : (event.plateDetected === 'DOOR_OPEN' || event.plateDetected === 'DOOR_CLOSE') ? (
                                            event.device?.name || 'ACCIONAMIENTO MANUAL'
                                        ) : (event.accessType === 'FACE') ? (
                                            // FIX SIMILARITY STRING
                                            (() => {
                                                const simVal = meta['Similitud']?.match(/(\d+)/)?.[1];
                                                return simVal ? `${simVal}% Similitud` : (faceName ? 'IDENTIFICADO POR CAMARA' : 'ROSTRO NO IDENTIFICADO');
                                            })()
                                        ) : (event.accessType === 'TAG') ? (
                                            // Show device/reader name for TAG events
                                            event.device?.name || 'LECTOR RFID'
                                        ) : (
                                            `SIMILITUD: ${meta.Similitud || 'VERIFICADO'}`
                                        )}
                                    </p>
                                </div>
                                {meta.Color && (
                                    <div className="w-2 h-2 rounded-full border border-border" style={{ backgroundColor: meta.Color.toLowerCase() === 'blanco' ? '#fff' : meta.Color.toLowerCase() === 'negro' ? '#000' : meta.Color }} />
                                )}
                            </div>
                            {event.user?.name && event.accessType === "PLATE" && (
                                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-0.5">
                                    {event.user.name}
                                </p>
                            )}
                            {/* Show user name for TAG events if linked */}
                            {event.user?.name && event.accessType === "TAG" && (
                                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-0.5">
                                    {event.user.name}
                                </p>
                            )}
                        </div>


                        {/* RIGHT: DECISION & TIME */}
                        <div className="flex flex-col items-end gap-1 shrink-0">
                            <div className="flex items-center gap-2">
                                {plateCount > 1 && event.plateDetected !== "NO_LEIDA" && event.plateDetected !== "unknown" && !isCall && (
                                    <Badge className="bg-foreground/10 text-muted-foreground border-border text-[9px] font-bold px-1.5 h-5 flex items-center justify-center">
                                        {plateCount}x Hoy
                                    </Badge>
                                )}
                                <div className={cn(
                                    "px-2 py-1.5 rounded-lg font-bold text-[10px] uppercase text-center tracking-tighter shadow-lg flex items-center justify-center gap-1.5 min-w-[80px]",
                                    isCall
                                        ? "bg-blue-600 text-foreground shadow-blue-900/40 border border-blue-500/30 animate-pulse"
                                        : (event.plateDetected === 'DOOR_OPEN')
                                            ? "bg-emerald-600 text-foreground shadow-emerald-900/40 border border-emerald-500/30"
                                            : (event.plateDetected === 'DOOR_CLOSE')
                                                ? "bg-muted text-foreground shadow-neutral-900/40 border border-border/30"
                                                : event.decision === "GRANT"
                                                    ? "bg-emerald-600 text-foreground shadow-emerald-900/40 border border-emerald-500/30"
                                                    : "bg-red-600 text-foreground shadow-red-900/40 border border-red-500/30"
                                )}>
                                    {isCall
                                        ? <><Phone size={12} fill="currentColor" /> LLAMANDO</>
                                        : (event.plateDetected === 'DOOR_OPEN')
                                            ? <><DoorOpen size={12} /> ABIERTA</>
                                            : (event.plateDetected === 'DOOR_CLOSE')
                                                ? <><LogOut size={12} /> CERRADA</>
                                                : event.decision === "GRANT"
                                                    ? <><CheckCircle2 size={12} /> PERMITIDO</>
                                                    : <><XCircle size={12} /> DENEGADO</>
                                    }
                                </div>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground font-bold">
                                {horaSeg(new Date(event.timestamp))}
                            </span>
                        </div>
                    </div>
                </div>
            </VisorEventoAcceso>
        );
});

export default function UnifiedDashboard({ variant = "acceso" }: DashboardProps) {
    const [events, setEvents] = useState<FullAccessEvent[]>([]);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [activeFilter, setActiveFilter] = useState<"ALL" | "GRANT" | "DENY">("ALL");
    const [activeType, setActiveType] = useState<"ALL" | "PLATE" | "FACE" | "TAG" | "DOOR">("TAG");
    const [stats, setStats] = useState({ total: 0, grants: 0, denies: 0 });

    const lastEntry = events.find(e => e.direction === 'ENTRY');
    const lastExit = events.find(e => e.direction === 'EXIT');

    useEffect(() => {
        const savedFilter = localStorage.getItem('dashboard_activeFilter');
        if (savedFilter) setActiveFilter(savedFilter as any);

        const savedType = localStorage.getItem('dashboard_activeType');
        if (savedType) setActiveType(savedType as any);
    }, []);

    const loadInitialData = async () => {
        try {
            // Filter: Only Current Day
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const data = await getAccessEvents({
                take: 50,
                from: startOfDay
            });
            setEvents(data.events as FullAccessEvent[]);

            const todayStats = await getEventsCountToday();
            setStats(todayStats);
        } catch (error) {
            console.error("Error loading data:", error);
        }
    };

    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        loadInitialData();

        const socketUrl = getSocketUrl();

        const newSocket = io(socketUrl, { path: "/io/socket.io", transports: ["polling"], upgrade: false, 
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 8000,
            timeout: 8000,
        });

        let hadSession = false;
        newSocket.on("connect", () => {
            setIsConnected(true);
            if (hadSession) loadInitialData();
            hadSession = true;
        });

        newSocket.on("disconnect", () => {
            setIsConnected(false);
        });
        newSocket.on("connect_error", () => setIsConnected(false));
        const watchdog = setInterval(() => { if (!newSocket.connected) { try { newSocket.connect(); } catch { } } }, 10000);
        const onVisible = () => { if (document.visibilityState === "visible") { if (!newSocket.connected) { try { newSocket.connect(); } catch { } } loadInitialData(); } };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", onVisible);

        newSocket.on("access_event", (event: FullAccessEvent) => {
            // Filter old ANR events (older than current day)
            const eventTime = new Date(event.timestamp).getTime();
            const startOfDay = new Date().setHours(0, 0, 0, 0);

            if (eventTime < startOfDay) {
                return;
            }

            setEvents((prev) => [event, ...prev].slice(0, 50));
            setStats(prev => ({
                total: prev.total + 1,
                grants: prev.grants + (event.decision === "GRANT" ? 1 : 0),
                denies: prev.denies + (event.decision === "DENY" ? 1 : 0)
            }));
        });

        setSocket(newSocket);
        // Red de seguridad: re-fetch imperceptible cada 12s para sanar cualquier foto que no haya cargado
        const refreshIv = setInterval(() => { loadInitialData(); }, 12000);
        return () => {
            clearInterval(watchdog);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("online", onVisible);
            newSocket.disconnect(); clearInterval(refreshIv);
        };
    }, []);



    const filteredEvents = useMemo(() => {
        const result: (FullAccessEvent & { hasDoorOpen?: boolean; hasDoorClose?: boolean })[] = [];

        // We iterate and process events. We need to skip events that are part of a sequence we already attached to a parent.
        const handledIds = new Set<string>();

        // Pre-sort events by timestampDescending to ensure correct order
        const sortedEvents = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        for (let i = 0; i < sortedEvents.length; i++) {
            const e = sortedEvents[i];

            if (handledIds.has(e.id)) continue;

            // Apply Filters
            if (activeFilter !== "ALL" && e.decision !== activeFilter) continue;
            if (activeType !== "ALL" && e.accessType !== activeType) continue;

            const plate = (e.plateDetected || '').toUpperCase();

            // If this is a Credential Event (Face, Tag, Pin, Plate) - Look for subsequent Door Open/Close events
            // Since list is Newest First, "subsequent" means events with slightly LATER timestamps (which would be lower index? No, wait.)
            // Newest first means index 0 is 12:05, index 1 is 12:04.
            // A "Door Open" triggered by this event would happen AFTER it. So it would be at a LOWER index (Newer).
            // BUT, usually we receive Credential -> then Door Open. So Door Open is NEWER. 
            // So if I am at Credential (older), the Door Open is at i-1 or i-2.

            // Let's look for RELATED events in the vicinity.
            // Actually, usually the order of arrival is:
            // 1. Validation (Credential) -> Saved to DB
            // 2. Door Open -> Saved to DB (Timestamp slightly later)
            // 3. Door Close -> Saved to DB (Timestamp later)

            // So in a DESCENDING list (Newest Top):
            // Row 0: Door Close
            // Row 1: Door Open
            // Row 2: Credential

            // If I am iterating from 0 to N.
            // When I hit "Door Close", I might want to hide it and wait for "Credential".
            // When I hit "Credential", I want to look BACK (at lower indices, newer events) to attribute them to this credential.

            // However, complicating factor: We might simply hide Door Open/Close and attach them to the nearest PARENT credential event found in a small window.
            // Let's try this: Valid Display Events are Credential Events (Type != 'DOOR_OPEN' etc).
            // When we find one, we search `events` array for a DoorOpen/Close that happened shortly AFTER this event.

            if (plate === 'DOOR_OPEN' || plate === 'DOOR_CLOSE') {
                // We typically hide these unless they are orphan (no credential event found nearby).
                // Let's check if there is a Credential event slightly OLDER (higher index) or SAME time that likely triggered this.
                const parentCandidate = sortedEvents.slice(i + 1, i + 10).find(prev =>
                    prev.deviceId === e.deviceId &&
                    ['PLATE', 'FACE', 'TAG', 'PIN'].includes(prev.accessType || '') &&
                    prev.plateDetected !== 'DOOR_OPEN' &&
                    prev.plateDetected !== 'DOOR_CLOSE' &&
                    (Math.abs(new Date(e.timestamp).getTime() - new Date(prev.timestamp).getTime()) < 30000) // 30s window
                );

                if (parentCandidate) {
                    // This event is part of a sequence led by 'parentCandidate'. 
                    // We interpret this as "Hide this row, it will be represented in the parent".
                    // We don't need to do anything here because when we process 'parentCandidate' we will look for this.
                    continue;
                }
                // If orphan, we show it (fall through to push)
            } else {
                // This is a Credential Event (Main).
                // Search for its children (Door Open / Close) that occurred slightly AFTER (newer = lower index).
                const relatedOpen = sortedEvents.slice(Math.max(0, i - 10), i).find(next =>
                    next.deviceId === e.deviceId &&
                    (next.plateDetected === 'DOOR_OPEN' || (next.details && next.details.includes('Door Open'))) &&
                    (new Date(next.timestamp).getTime() - new Date(e.timestamp).getTime() > 0) && // Must be after
                    (new Date(next.timestamp).getTime() - new Date(e.timestamp).getTime() < 30000) // Within 30s
                );

                const relatedClose = sortedEvents.slice(Math.max(0, i - 10), i).find(next =>
                    next.deviceId === e.deviceId &&
                    (next.plateDetected === 'DOOR_CLOSE' || (next.details && next.details.includes('Door Close'))) &&
                    (new Date(next.timestamp).getTime() - new Date(e.timestamp).getTime() > 0) &&
                    (new Date(next.timestamp).getTime() - new Date(e.timestamp).getTime() < 120000) // Open/Close cycle can be longer (e.g. 1 min)
                );

                // Construct enhanced event object
                const enhancedEvent = {
                    ...e,
                    hasDoorOpen: !!relatedOpen,
                    hasDoorClose: !!relatedClose
                };

                result.push(enhancedEvent);
                continue;
            }

            result.push(e);
        }
        return result;
    }, [events, activeFilter, activeType]);

    const plateCountsToday = useMemo(() => {
        const counts: Record<string, number> = {};
        events.forEach(e => {
            const key = e.plateDetected && e.plateDetected !== 'unknown' && e.plateDetected !== 'NO_LEIDA' ? e.plateDetected : (e.user?.id || 'sys');
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }, [events]);

    const calculateDuration = (currentEvent: FullAccessEvent) => {
        const plate = currentEvent.plateDetected;
        if (!plate || plate === 'unknown' || plate === 'NO_LEIDA') return null;

        const currentIndex = events.findIndex(e => e.id === currentEvent.id);
        if (currentIndex === -1) return null;

        const previousEvent = events.slice(currentIndex + 1).find(e =>
            e.plateDetected === plate &&
            e.direction !== currentEvent.direction // Ensure it's the opposite movement for accurate inside/outside
        );

        if (!previousEvent) return null;

        const ms = Math.abs(new Date(currentEvent.timestamp).getTime() - new Date(previousEvent.timestamp).getTime());
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        let duration = "";
        if (days > 0) duration = `${days}d ${hours % 24}h`;
        else if (hours > 0) duration = `${hours}h ${minutes % 60}m`;
        else if (minutes > 0) duration = `${minutes}m ${seconds % 60}s`;
        else duration = `${seconds}s`;

        return {
            label: currentEvent.direction === 'EXIT' ? 'DENTRO' : 'FUERA',
            value: duration,
            color: currentEvent.direction === 'EXIT' ? 'text-indigo-400' : 'text-orange-400'
        };
    };


    const entryEvents = filteredEvents.filter(e => e.direction === 'ENTRY');
    const exitEvents = filteredEvents.filter(e => e.direction === 'EXIT');
    const captureEvents = filteredEvents.filter(e => e.imagePath);

    return (
        <div className="h-full p-6 overflow-hidden animate-in fade-in duration-700 flex flex-col gap-6">

            <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">

                {/* COLUMN 1: ENTRADAS */}
                <div className="flex flex-col h-full bg-card/40 border border-border rounded-xl overflow-hidden shadow-lg min-h-0">
                    <div className="p-5 border-b border-indigo-500/20 bg-indigo-500/5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-indigo-500 font-bold text-foreground flex items-center justify-center text-xs shadow-lg shadow-indigo-900/40 italic">IN</div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground uppercase tracking-tighter">Entradas</h3>
                                    <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest">Flujo de Ingreso</p>
                                </div>
                            </div>
                            <Badge className="bg-indigo-500 text-foreground font-bold text-[10px]">{entryEvents.length}</Badge>
                        </div>
                        <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-xl border border-border">
                            <Filter size={11} className="text-muted-foreground shrink-0 mx-1" />
                            <div className="flex-1 flex justify-center gap-1 border-x border-border px-2">
                                <TooltipProvider>
                                    {(["ALL", "GRANT", "DENY"] as const).map((f) => (
                                        <Tooltip key={f}>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={() => { setActiveFilter(f); localStorage.setItem('dashboard_activeFilter', f); }}
                                                    className={cn(
                                                        "w-7 h-7 flex items-center justify-center rounded-lg transition-all",
                                                        activeFilter === f
                                                            ? (f === 'GRANT' ? 'bg-emerald-500 text-foreground shadow-lg shadow-emerald-900/40' : f === 'DENY' ? 'bg-red-500 text-foreground shadow-lg shadow-red-900/40' : 'bg-indigo-500 text-foreground shadow-lg shadow-indigo-900/40')
                                                            : "text-muted-foreground hover:text-muted-foreground hover:bg-accent"
                                                    )}
                                                >
                                                    {f === 'ALL' ? <Activity size={12} /> : f === 'GRANT' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top">
                                                <p>{f === 'ALL' ? 'Todos los Eventos' : f === 'GRANT' ? 'Solo Permitidos' : 'Solo Denegados'}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    ))}
                                </TooltipProvider>
                            </div>
                            <div className="flex gap-1 pr-1">
                                <TooltipProvider>
                                    {(["ALL", "PLATE", "FACE", "TAG"] as const).map((t) => (
                                        <Tooltip key={t}>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={() => { setActiveType(t); localStorage.setItem('dashboard_activeType', t); }}
                                                    className={cn(
                                                        "w-7 h-7 flex items-center justify-center rounded-lg transition-all",
                                                        activeType === t ? "bg-foreground/10 text-indigo-400 border border-indigo-500/30" : "text-muted-foreground hover:text-muted-foreground hover:bg-accent"
                                                    )}
                                                >
                                                    {t === 'ALL' ? <Zap size={12} /> : t === 'PLATE' ? <Car size={12} /> : t === 'FACE' ? <UserIcon size={12} /> : <CreditCard size={12} />}
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top">
                                                <p>{t === 'ALL' ? 'Todos los Tipos' : t === 'PLATE' ? 'Solo LPR' : t === 'FACE' ? 'Solo Facial' : 'Solo Credenciales'}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    ))}
                                </TooltipProvider>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-white/5 custom-scrollbar min-h-0">
                        {entryEvents.map(event => <EventItem key={event.id} event={event} plateCountsToday={plateCountsToday} calculateDuration={calculateDuration} />)}
                    </div>
                </div>

                {/* COLUMN 2: CAPTURAS */}
                <div className="flex flex-col h-full bg-card/60 border border-indigo-500/20 rounded-xl overflow-hidden shadow-xl scale-[1.02] z-10 min-h-0">
                    <div className="p-5 border-b border-border bg-foreground/10 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/20 rounded-lg"><Camera className="text-indigo-400" size={18} /></div>
                            <div>
                                <h3 className="text-sm font-bold text-foreground uppercase tracking-tighter">Últimas Capturas</h3>
                                <div className="flex items-center gap-2">
                                    <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest">Evidencia Visual</p>
                                    <div className="flex items-center gap-1 bg-black/40 px-1.5 py-0.5 rounded-full border border-border">
                                        <div className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                                        <span className={cn("text-[7px] font-bold uppercase tracking-wider", isConnected ? "text-emerald-500" : "text-red-500")}>
                                            {isConnected ? "LIVE" : "OFFLINE"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 ml-8 pl-8 border-l border-border h-8">
                                <div className="flex flex-col items-start">
                                    <span className="text-[8px] text-indigo-400 font-bold uppercase tracking-widest leading-none mb-0.5">Entrada</span>
                                    {lastEntry ? (
                                        <span className="text-[10px] font-mono font-bold text-foreground"><TimeAgo timestamp={lastEntry.timestamp} /></span>
                                    ) : <span className="text-[10px] font-mono text-muted-foreground">-</span>}
                                </div>
                                <div className="flex flex-col items-start">
                                    <span className="text-[8px] text-orange-400 font-bold uppercase tracking-widest leading-none mb-0.5">Salida</span>
                                    {lastExit ? (
                                        <span className="text-[10px] font-mono font-bold text-foreground"><TimeAgo timestamp={lastExit.timestamp} /></span>
                                    ) : <span className="text-[10px] font-mono text-muted-foreground">-</span>}
                                </div>
                            </div>
                        </div>
                        <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 font-bold">{captureEvents.length}</Badge>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/40 min-h-0">
                        {captureEvents.map(event => {
                            // Parse details
                            const detailsMap: any = {};
                            if (event.details) {
                                event.details.split(',').forEach(p => {
                                    const [k, v] = p.split(':').map(s => s.trim());
                                    if (k && v) detailsMap[k] = v;
                                });
                            }

                            // Retroactive fix for unmapped brands (e.g., "Brand 1123")
                            let marca = detailsMap['Marca'];
                            if (marca?.startsWith("Brand ")) {
                                const code = marca.replace("Brand ", "");
                                const mapped = getVehicleBrandName(code);
                                if (mapped !== marca) marca = mapped;
                            }

                            const color = detailsMap['Color'];
                            let tipo = detailsMap['Tipo']?.toUpperCase();
                            if (tipo === 'VEHICLE' || tipo === 'CAR') tipo = 'AUTO';
                            if (tipo === 'PICKUPTRUCK') tipo = 'PICKUP';

                            const faceCropUrl = getImageUrl(detailsMap['FaceImage']);
                            const similarity = detailsMap['Similitud'];
                            const cameraName = detailsMap['Rostro'];

                            const logoUrl = getCarLogo(marca);
                            const getVehicleIcon = (t: string | undefined) => {
                                if (!t) return <Car size={14} />;
                                if (t.includes('VAN')) return <Bus size={14} />;
                                if (t.includes('TRUCK')) return <Truck size={14} />;
                                if (t.includes('BUS')) return <Bus size={14} />;
                                if (t.includes('MOTO')) return <Bike size={14} />;
                                return <Car size={14} />;
                            };

                            const isFace = event.accessType === 'FACE';
                            const isTag = event.accessType === 'TAG' || event.accessType === 'PIN';
                            const isLPR = !isFace && !isTag;

                            return (
                                <VisorEventoAcceso key={event.id} event={event}>
                                    <div className={cn(
                                        "relative aspect-video rounded-2xl overflow-hidden border group cursor-pointer shadow-lg transition-all duration-500",
                                        event.decision === "GRANT" ? "border-emerald-500/30 shadow-emerald-900/20" : "border-red-500/30 shadow-red-900/20"
                                    )}>
                                        <Image
                                            src={getImageUrl(event.imagePath || event.snapshotPath) || ((event.user?.cara && event.accessType !== 'PLATE') ? getImageUrl(event.user.cara) : "/placeholder-camera.jpg")}
                                            alt="Capture"
                                            fill
                                            className="object-cover group-hover:scale-105 transition-transform duration-700"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

                                        {/* Decision Overlay */}
                                        {/* Decision Overlay */}
                                        <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1.5">
                                            <div className={cn(
                                                "px-3 py-2 rounded-lg font-bold text-[10px] uppercase tracking-tighter shadow-lg backdrop-blur-md border flex items-center gap-2 animate-pulse",
                                                event.decision === "GRANT"
                                                    ? "bg-emerald-600 border-emerald-400 text-foreground shadow-emerald-900/40"
                                                    : "bg-red-600 border-red-400 text-foreground shadow-red-900/40"
                                            )}>
                                                {event.decision === "GRANT"
                                                    ? <><CheckCircle2 size={14} strokeWidth={3} /> AUTORIZADO</>
                                                    : <><XCircle size={14} strokeWidth={3} /> DENEGADO</>
                                                }
                                            </div>



                                            {/* Timestamp */}
                                            <div className="px-2 py-0.5 rounded bg-black/50 backdrop-blur-md border border-border shadow-lg flex items-center gap-1">
                                                <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
                                                <p className="text-[8px] font-mono font-bold text-foreground/70">
                                                    {fecha(new Date(event.timestamp))} • {horaSeg(new Date(event.timestamp))}
                                                </p>
                                            </div>
                                        </div>

                                        {/* FACE CROP OVERLAY (Moved to Bottom Left based on user feedback) */}
                                        {isFace && (faceCropUrl || event.user?.cara) && (
                                            <div className="absolute bottom-3 left-3 z-20 w-16 h-16 rounded-xl overflow-hidden border-2 border-border shadow-lg bg-black animate-in zoom-in slide-in-from-left-4 duration-500">
                                                <Image
                                                    src={faceCropUrl || getImageUrl(event.user?.cara) || ""}
                                                    alt="Face"
                                                    fill
                                                    className="object-cover"
                                                />
                                                {/* Mini similarity badge inside crop */}
                                                {similarity && <div className="absolute bottom-0 inset-x-0 bg-black/80 text-[8px] text-emerald-400 text-center font-bold py-0.5 tracking-tighter">{similarity}%</div>}
                                            </div>
                                        )}

                                        {/* Identity / Plate Overlay */}
                                        {/* Center Overlay: Resident Name & Duration */}
                                        {(event.user?.name || (detailsMap['Name'] && detailsMap['Name'] !== 'unknown') || cameraName) && (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none p-4 text-center gap-2">
                                                <h3 className="text-2xl font-bold text-white uppercase tracking-tighter drop-shadow-[0_4px_4px_rgba(0,0,0,1)] bg-black/40 px-4 py-1 rounded-full backdrop-blur-[2px]">
                                                    {event.user?.name || cameraName || detailsMap['Name']}
                                                </h3>

                                                {/* Duration Badge (smaller) */}
                                                {(() => {
                                                    const duration = calculateDuration(event);
                                                    if (duration) {
                                                        return (
                                                            <div className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-border flex items-center gap-1.5 shadow-xl">
                                                                <span className={cn("text-[9px] font-bold uppercase tracking-widest", duration.color)}>
                                                                    {duration.label}
                                                                </span>
                                                                <span className="text-muted-foreground text-[9px]">•</span>
                                                                <span className="text-[9px] font-mono text-foreground font-bold">
                                                                    {duration.value}
                                                                </span>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                        )}

                                        {/* Duration Badge for events WITHOUT name (show in center) */}
                                        {!(event.user?.name || (detailsMap['Name'] && detailsMap['Name'] !== 'unknown') || cameraName) && (() => {
                                            const duration = calculateDuration(event);
                                            if (duration) {
                                                return (
                                                    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                                                        <div className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-border flex items-center gap-1.5 shadow-xl">
                                                            <span className={cn("text-[9px] font-bold uppercase tracking-widest", duration.color)}>
                                                                {duration.label}
                                                            </span>
                                                            <span className="text-muted-foreground text-[9px]">•</span>
                                                            <span className="text-[9px] font-mono text-foreground font-bold">
                                                                {duration.value}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}

                                        {/* Identity / Plate Overlay (Bottom Left) */}
                                        <div className="absolute bottom-3 left-3 flex flex-col items-start z-10 max-w-[70%]">
                                            {!(event.user?.name || (detailsMap['Name'] && detailsMap['Name'] !== 'unknown') || cameraName) && (() => {
                                                const duration = calculateDuration(event);
                                                if (!duration) return null;
                                                return (
                                                    <div className="flex items-center gap-1.5 mb-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-border">
                                                        <Clock size={8} className={duration.color} />
                                                        <span className="text-[7px] font-bold text-muted-foreground uppercase tracking-widest">{duration.label}:</span>
                                                        <span className={cn("text-[8px] font-bold uppercase tracking-tight", duration.color)}>{duration.value}</span>
                                                    </div>
                                                );
                                            })()}

                                            {(isFace || isTag) ? (
                                                // FACE/TAG IDENTITY STYLE (Only if Unknown, otherwise name is in center)
                                                !(event.user?.name || (detailsMap['Name'] && detailsMap['Name'] !== 'unknown') || cameraName) && (
                                                    <div className="flex flex-col items-start">
                                                        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-xl border border-border rounded-lg px-3 py-1.5 shadow-lg">
                                                            {isFace ? <UserIcon size={14} className="text-foreground" /> : <CreditCard size={14} className="text-foreground" />}
                                                            <div>
                                                                <p className="text-[12px] font-bold text-foreground leading-none uppercase tracking-wide">
                                                                    {isTag ? "Tarjeta" : "Desconocido"}
                                                                </p>
                                                                {isFace && similarity && <p className="text-[8px] text-emerald-400 font-bold uppercase tracking-wider">{similarity}% Similitud</p>}
                                                                {isTag && event.plateDetected && <p className="text-[8px] text-muted-foreground font-mono uppercase tracking-wider">{event.plateDetected}</p>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            ) : (
                                                // PLATE IDENTITY STYLE (Always Show for LPR)
                                                <div className={cn("flex flex-col border-2 border-border rounded-sm overflow-hidden shadow-lg min-w-[100px]",
                                                    event.plateDetected === "NO_LEIDA" ? "bg-red-600 border-red-500" : "bg-white")}>
                                                    <div className="h-1 bg-blue-600 w-full" />
                                                    <p className={cn("text-[16px] font-bold tracking-[0.2em] uppercase px-3 py-0.5 text-center font-mono",
                                                        event.plateDetected === "NO_LEIDA" ? "text-foreground text-[10px]" : "text-black")}>
                                                        {event.plateDetected === "NO_LEIDA" ? "No Leída" : event.plateDetected}
                                                    </p>
                                                </div>
                                            )}

                                            <p className="text-[8px] text-muted-foreground font-bold uppercase tracking-[0.2em] mt-1 drop-shadow-lg truncate w-full pl-0.5">
                                                {event.device?.name}
                                            </p>
                                        </div>

                                        {/* Direction Badge */}
                                        <div className="absolute top-3 right-3">
                                            <Badge className={cn("text-[8px] font-bold px-2 py-1 border-none", event.direction === 'ENTRY' ? "bg-indigo-600" : "bg-orange-600")}>
                                                {event.direction === 'ENTRY' ? "ENTRADA" : "SALIDA"}
                                            </Badge>
                                        </div>

                                        {/* Attributes Overlay (Only for vehicles/tags) */}
                                        {(isLPR || isTag) && (
                                            <div className="absolute top-3 left-3 flex flex-col gap-2">
                                                {/* LPR Logo */}
                                                {isLPR && logoUrl && (
                                                    <div className="bg-white rounded-lg p-1.5 shadow-lg w-10 h-10 flex items-center justify-center">
                                                        <div className="relative w-7 h-7"><Image src={logoUrl} alt="Logo" fill className="object-contain" /></div>
                                                    </div>
                                                )}

                                                {/* Tag Icon */}
                                                {isTag && (
                                                    <div className="bg-black/40 border border-border backdrop-blur-md rounded-lg p-1.5 shadow-lg w-10 h-10 flex items-center justify-center">
                                                        <CreditCard className="text-foreground/70" size={20} />
                                                    </div>
                                                )}
                                                <div className="flex flex-col gap-1 items-start pl-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                                                    {color && (
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-2 h-2 rounded-full border border-border" style={{ backgroundColor: color.toLowerCase() === 'blanco' ? '#fff' : color.toLowerCase() === 'negro' ? '#000' : color }} />
                                                            <span className="text-[9px] font-bold text-foreground uppercase tracking-wider">{color}</span>
                                                        </div>
                                                    )}
                                                    {tipo && (
                                                        <div className="flex items-center gap-1.5 text-foreground">
                                                            {getVehicleIcon(tipo)}
                                                            <span className="text-[9px] font-bold uppercase tracking-wider">{tipo}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </VisorEventoAcceso>
                            );
                        })}
                    </div>
                </div>

                {/* COLUMN 3: SALIDAS */}
                <div className="flex flex-col h-full bg-card/40 border border-border rounded-xl overflow-hidden shadow-lg min-h-0">
                    <div className="p-5 border-b border-orange-500/20 bg-orange-500/5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-orange-600 font-bold text-foreground flex items-center justify-center text-xs shadow-lg shadow-orange-900/40 italic">OUT</div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground uppercase tracking-tighter">Salidas</h3>
                                    <p className="text-[9px] text-orange-400 font-bold uppercase tracking-widest">Flujo de Egreso</p>
                                </div>
                            </div>
                            <Badge className="bg-orange-600 text-foreground font-bold text-[10px]">{exitEvents.length}</Badge>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-white/5 custom-scrollbar min-h-0">
                        {exitEvents.map(event => <EventItem key={event.id} event={event} plateCountsToday={plateCountsToday} calculateDuration={calculateDuration} />)}
                    </div>
                </div>

            </div>
        </div >
    );
}
