"use client";

import { useEffect, useState, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { getAccessEvents, getEventsCountToday, getAccessEvent } from "@/app/actions/history";
import { getSetting, updateSetting, testFaceEngineConnection } from "@/app/actions/settings";
import { searchByPhotoAction } from "@/app/actions/face-verify";
import {
    SlidersHorizontal, Upload, Trash2, Map as MapIcon, Bell, Settings,
    Users, UserPlus, Ban, ArrowLeft, MoreVertical, Check, X,
    ScanFace, Cpu, ShieldAlert, ShieldCheck, Info, Activity,
    Search, RefreshCcw, UserSearch, Loader2, Maximize2, ChevronUp
} from "lucide-react";
import { sileo as toast } from "sileo";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AccessEvent, Device, Unit } from "@prisma/client";
import { getSocketUrl } from "@/lib/socket-config";
import { getImagePath } from "@/lib/image-path";
import SecuritySidebar from "@/components/dashboard/SecuritySidebar";
import SecurityFeed from "@/components/dashboard/SecurityFeed";
import { AnimatePresence, motion } from "framer-motion";
import { verifyFaceAction } from "@/app/actions/face-verify";
import { FaceMatchModal } from "@/components/dashboard/FaceMatchModal";
import FaceDashboardMap from "@/components/dashboard/FaceDashboardMap";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import Link from "next/link";

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
        role: string | null;
        observations: string | null;
        createdAt: Date;
    } | null;
    device: Device | null;
}

export default function FaceDashboard() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className="animate-spin text-red-600" /></div>}>
            <FaceDashboardContent />
        </Suspense>
    );
}

function FaceDashboardContent() {
    const searchParams = useSearchParams();
    const [events, setEvents] = useState<FullAccessEvent[]>([]);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [stats, setStats] = useState({ total: 0, grants: 0, denies: 0 });
    const [lastEvent, setLastEvent] = useState<FullAccessEvent | null>(null);
    const [similarityThreshold, setSimilarityThreshold] = useState(85);
    const [isSavingThreshold, setIsSavingThreshold] = useState(false);
    const [showThresholdConfig, setShowThresholdConfig] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [verifications, setVerifications] = useState<Record<string, any>>({});
    const [neuralDetections, setNeuralDetections] = useState<FullAccessEvent[]>([]);
    const [entryIndex, setEntryIndex] = useState(0);
    const [exitIndex, setExitIndex] = useState(0);
    const [neuralIndex, setNeuralIndex] = useState(0);
    const [isAutoPopupEnabled, setIsAutoPopupEnabled] = useState(true);
    const [selectedViewEvent, setSelectedViewEvent] = useState<FullAccessEvent | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [blacklistEvents, setBlacklistEvents] = useState<FullAccessEvent[]>([]);
    const [showModeConfirm, setShowModeConfirm] = useState(false);
    const [pendingMode, setPendingMode] = useState<"BLACKLIST" | "WHITELIST" | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const entryFeedRef = useRef<HTMLDivElement>(null);
    const exitFeedRef = useRef<HTMLDivElement>(null);

    // Floor Plan State
    const [floorPlans, setFloorPlans] = useState<any[]>([]);
    const [currentFloorPlan, setCurrentFloorPlan] = useState<any | null>(null);
    const [isUploadingMap, setIsUploadingMap] = useState(false);
    const mapFileInputRef = useRef<HTMLInputElement>(null);

    // AI Config State
    const [faceMode, setFaceMode] = useState("BLACKLIST");
    const [aiConfig, setAiConfig] = useState({ endpoint: "", apiKey: "", minSimilarity: 0.8 });
    const [savingAi, setSavingAi] = useState(false);
    const [testingAi, setTestingAi] = useState(false);
    const [isSearchingFace, setIsSearchingFace] = useState(false);
    const [searchResult, setSearchResult] = useState<any>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const loadInitialData = async () => {
            const threshold = await getSetting("COMPAREFACE_MIN_SIM");
            if (threshold?.value) {
                setSimilarityThreshold(Math.round(parseFloat(threshold.value) * 100));
            }

            const mode = await getSetting("MODE_FACE");
            if (mode) setFaceMode(mode.value);

            const urlSet = await getSetting("COMPAREFACE_URL");
            const keySet = await getSetting("COMPAREFACE_KEY");
            setAiConfig({
                endpoint: urlSet?.value || "",
                apiKey: keySet?.value || "",
                minSimilarity: threshold ? parseFloat(threshold.value) : 0.8
            });

            // Load Floor Plans
            const { getFloorPlans } = await import("@/app/actions/floorplans");
            const fps = await getFloorPlans();
            setFloorPlans(fps);
            if (fps.length > 0) setCurrentFloorPlan(fps[0]);

            // Handle URL Search Params for specific event
            const eventId = searchParams.get('event');
            if (eventId) {
                const event = await getAccessEvent(eventId);
                if (event) {
                    setSelectedViewEvent(event as FullAccessEvent);
                }
            }
        };
        loadInitialData();
    }, [searchParams]);

    const handleMapUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploadingMap(true);
        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const url = reader.result as string;
                const { createFloorPlan } = await import("@/app/actions/floorplans");
                const newFP = await createFloorPlan(`Plano ${floorPlans.length + 1}`, url);
                setFloorPlans(prev => [...prev, newFP]);
                setCurrentFloorPlan(newFP);
                toast.success({ title: "Nuevo plano añadido" });
            };
            reader.readAsDataURL(file);
        } catch (err) {
            toast.error({ title: "Error al subir plano" });
        } finally {
            setIsUploadingMap(false);
            if (mapFileInputRef.current) mapFileInputRef.current.value = "";
        }
    };

    const handleSaveThreshold = async (val: number) => {
        setIsSavingThreshold(true);
        await updateSetting("COMPAREFACE_MIN_SIM", (val / 100).toString());
        setIsSavingThreshold(false);
    };

    const handleHorizontalScroll = (e: React.WheelEvent<HTMLDivElement>) => {
        const container = e.currentTarget;
        const scrollAmount = e.deltaY;
        container.scrollTo({
            left: container.scrollLeft + scrollAmount,
            behavior: 'auto'
        });
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsSearchingFace(true);
        const toastId = toast.show({ title: "Buscando rostro en base de datos...", duration: null });

        try {
            const buffer = await file.arrayBuffer();
            const result = await searchByPhotoAction(new Uint8Array(buffer));

            if (result.success && result.match) {
                // To show in Splash Screen, we create a 'Phantom Event'
                const phantomEvent: any = {
                    id: `search-${Date.now()}`,
                    timestamp: new Date(),
                    snapshotPath: result.match.snapshot_path || result.match.preview_url, // Path to image used for match
                    accessType: 'FACE',
                    details: `Manual Search: ${result.match.subject}, Similarity: ${(result.match.similarity * 100).toFixed(1)}%`,
                    user: result.user || null,
                    deviceId: 'manual-search',
                    device: { name: 'Terminal de Búsqueda Manual' }
                };

                // Add to neural detections to persist the finding 
                setNeuralDetections(prev => [phantomEvent, ...prev].slice(0, 5));

                // Add verification state for this phantom event
                setVerifications(prev => ({
                    ...prev,
                    [phantomEvent.id]: {
                        success: true,
                        verified: result.match.similarity > 0.8,
                        similarity: result.match.similarity,
                        recognizedAs: result.match.subject,
                        user: result.user,
                        loading: false
                    }
                }));

                // Open Splash Screen immediately
                setSelectedViewEvent(phantomEvent);
                toast.success({ title: `Rostro identificado: ${result.match.subject}` });
                toast.dismiss(toastId);
            } else {
                toast.error({ title: "No se encontraron coincidencias para este rostro" });
                toast.dismiss(toastId);
            }
        } catch (err) {
            toast.error({ title: "Error al procesar la búsqueda" });
            toast.dismiss(toastId);
        } finally {
            setIsSearchingFace(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);

        const setupDrag = (ref: React.RefObject<HTMLDivElement | null>) => {
            const ele = ref.current;
            if (!ele) return;
            let isDown = false;
            let startX: number;
            let scrollLeft: number;

            const onMouseDown = (e: MouseEvent) => {
                isDown = true;
                ele.classList.add('cursor-grabbing');
                startX = e.pageX - ele.offsetLeft;
                scrollLeft = ele.scrollLeft;
            };
            const onMouseLeave = () => {
                isDown = false;
                ele.classList.remove('cursor-grabbing');
            };
            const onMouseUp = () => {
                isDown = false;
                ele.classList.remove('cursor-grabbing');
            };
            const onMouseMove = (e: MouseEvent) => {
                if (!isDown) return;
                e.preventDefault();
                const x = e.pageX - ele.offsetLeft;
                const walk = (x - startX) * 2;
                ele.scrollLeft = scrollLeft - walk;
            };

            ele.addEventListener('mousedown', onMouseDown);
            ele.addEventListener('mouseleave', onMouseLeave);
            ele.addEventListener('mouseup', onMouseUp);
            ele.addEventListener('mousemove', onMouseMove);

            return () => {
                ele.removeEventListener('mousedown', onMouseDown);
                ele.removeEventListener('mouseleave', onMouseLeave);
                ele.removeEventListener('mouseup', onMouseUp);
                ele.removeEventListener('mousemove', onMouseMove);
            };
        };

        const cleanupEntry = setupDrag(entryFeedRef);
        const cleanupExit = setupDrag(exitFeedRef);

        return () => {
            clearInterval(timer);
            cleanupEntry?.();
            cleanupExit?.();
        };
    }, []);

    const handleVerification = async (event: FullAccessEvent) => {
        if (!event.snapshotPath) return;

        setVerifications(prev => ({
            ...prev,
            [event.id]: { loading: true }
        }));

        try {
            const result = await verifyFaceAction(event.snapshotPath, event.userId || "", event.user?.name);
            setVerifications(prev => ({
                ...prev,
                [event.id]: { ...result, loading: false }
            }));

            setLastEvent(event);

            // If it matched someone in Neural Engine OR Camera, add to detections list (bubbles)
            if (result && ((result.similarity || 0) > 0 || result.recognizedAs !== 'Desconocido')) {
                setNeuralDetections(prev => {
                    // Avoid duplicates and keep last 5
                    const filtered = prev.filter(e => e.id !== event.id);
                    return [event, ...filtered].slice(0, 5);
                });
                setNeuralIndex(0);
            }

            if (result?.verified) {
                toast.success({
                    title: `STATUS: IDENTIDAD VERIFICADA`,
                    description: `${result.recognizedAs} | Confianza: ${((result.similarity || 0) * 100).toFixed(1)}%`
                });
            }

            return result;
        } catch (err) {
            console.error("Verification failed", err);
            setVerifications(prev => ({
                ...prev,
                [event.id]: { loading: false, error: true }
            }));
            return null;
        }
    };

    const dismissAlarm = () => {
        // Function kept for compatibility if needed elsewhere, but logic removed
    };

    useEffect(() => {
        setMounted(true);
        const loadInitialData = async () => {
            try {
                const data = await getAccessEvents({ take: 30, type: 'FACE' });
                const fetchedEvents = data.events as FullAccessEvent[];
                setEvents(fetchedEvents);

                // Initialize blacklist events for the map from recent history
                const activeBlacklist = fetchedEvents.filter(e => {
                    const cameraPersonMatch = e.details?.match(/Persona:\s*([^,|]+)/)?.[1]?.trim();
                    const isCameraRecognized = cameraPersonMatch && !['Desconocido', 'N/A', 'Persona'].some(s => cameraPersonMatch.includes(s));

                    return isCameraRecognized && e.user?.role === 'BLACKLISTED' &&
                        // Optional: only show alerts from the last 2 hours 
                        (new Date().getTime() - new Date(e.timestamp).getTime()) < (2 * 60 * 60 * 1000);
                });
                setBlacklistEvents(activeBlacklist);

                const todayStats = await getEventsCountToday('FACE');
                setStats(todayStats);

                // PERSISTENCE: Populate neural detections from history
                // We consider "neural detection" any face event where the subject is not 'Unknown' or has a match in details
                const historyNeural = fetchedEvents.filter(e => {
                    const hasSubject = e.details?.includes('Persona:') && !e.details?.includes('Persona: Desconocido');
                    return hasSubject || e.user;
                }).slice(0, 5);

                setNeuralDetections(historyNeural);

                // Also pre-populate verifications for these historical events
                const initialVerifs: Record<string, any> = {};
                historyNeural.forEach(e => {
                    const match = e.details?.match(/Persona: ([^,]+)/)?.[1];
                    const simMatch = e.details?.match(/CamMatch: ([\d.]+)%/);
                    const similarity = simMatch ? parseFloat(simMatch[1]) / 100 : 0.9; // Default high if identified

                    initialVerifs[e.id] = {
                        success: true,
                        verified: true,
                        similarity: similarity,
                        recognizedAs: e.user?.name || match || "Identificado",
                        loading: false
                    };
                });
                setVerifications(prev => ({ ...initialVerifs, ...prev }));

            } catch (error) {
                console.error("Error loading data:", error);
            }
        };

        loadInitialData();

        const socketUrl = getSocketUrl();
        const newSocket = io(socketUrl, { path: "/io/socket.io", transports: ["polling"], upgrade: false,  });

        newSocket.on("connect", () => setIsConnected(true));
        newSocket.on("disconnect", () => setIsConnected(false));

        const handleNewEvent = async (event: FullAccessEvent) => {
            if (event.accessType !== 'FACE' && !event.snapshotPath?.includes('face')) return;

            setEvents((prev) => {
                // Deduplicate by ID
                if (prev.find(e => e.id === event.id)) return prev;

                // Deduplicate by Content (Plate/Subject) within a 3-second window
                const isDuplicate = prev.some(e => {
                    const sameSubject = event.details && e.details && (event.details.split(',')[1] === e.details.split(',')[1]);
                    const closeTime = Math.abs(new Date(e.timestamp).getTime() - new Date(event.timestamp).getTime()) < 3000;
                    return sameSubject && closeTime;
                });

                if (isDuplicate) return prev;
                return [event, ...prev].slice(0, 30);
            });

            // Update stats
            setStats(prev => ({
                total: prev.total + 1,
                grants: prev.grants + (event.decision === "GRANT" ? 1 : 0),
                denies: prev.denies + (event.decision === "DENY" ? 1 : 0)
            }));

            if (event.direction === 'EXIT') setExitIndex(0);
            else setEntryIndex(0);

            // COMPROBAR SI LA CÁMARA RECONOCIÓ INTERNAMENTE:
            const cameraPersonName = event.details?.match(/Persona:\s*([^,|]+)/)?.[1]?.trim();
            const isCameraRecognized = cameraPersonName && !['Desconocido', 'N/A', 'Persona'].some(s => cameraPersonName.includes(s));

            // OPTIMIZATION: Check if server already identified the subject (Instant UI)
            const neuralMatch = event.details?.match(/Neural ID: (.+?) \((\d+\.?\d*)%\)/);
            let result: any = null;

            if (neuralMatch) {
                const subject = neuralMatch[1];
                const sim = parseFloat(neuralMatch[2]) / 100;
                result = {
                    success: true,
                    verified: true,
                    similarity: sim,
                    recognizedAs: subject,
                    user: event.user,
                    loading: false
                };
                setVerifications(prev => ({ ...prev, [event.id]: result }));

                // Add to bubbles if it's a valid identification
                if (subject !== 'Desconocido') {
                    setNeuralDetections(prev => [event, ...prev.filter(e => e.id !== event.id)].slice(0, 5));
                    setNeuralIndex(0);
                }
            } else {
                // Background identification for events missing neural data
                result = await handleVerification(event);
            }

            // AUTO-POPUP Y MAP ALERTS
            // SOLO si la cámara reconoció a la persona internamente, disparamos las alertas/popups
            if (isCameraRecognized) {
                // Si la persona de la alerta/reconocimiento está en Lista Negra (ALERTA ROJA MAPA)
                if (event.user?.role === 'BLACKLISTED' || result?.user?.role === 'BLACKLISTED') {
                    setBlacklistEvents(prev => {
                        const filtered = prev.filter(e => e.id !== event.id);
                        return [event, ...filtered];
                    });
                }

                if (isAutoPopupEnabled) {
                    setSelectedViewEvent(event);
                }
            }
        };

        newSocket.on("access_event", handleNewEvent);
        newSocket.on("NEW_ACCESS", handleNewEvent); // Support Hikvision driver event name

        setSocket(newSocket);
        return () => { newSocket.disconnect(); };
    }, []);



    return (
        <div className="flex h-screen bg-black text-white overflow-hidden font-sans selection:bg-red-500/30">
            {/* Left Sidebar */}
            <SecuritySidebar />

            <div className="flex-1 flex flex-col relative overflow-hidden">
                {/* Full Screen Map Background */}
                <div className="absolute inset-0 z-0">
                    <FaceDashboardMap
                        lastEventId={lastEvent?.id}
                        lastEvent={lastEvent}
                        blacklistPopups={blacklistEvents}
                        onClosePopup={(id) => setBlacklistEvents(prev => prev.filter(e => e.id !== id))}
                        currentFloorPlan={currentFloorPlan}
                        floorPlans={floorPlans}
                    />
                </div>

                {/* Floating UI Layer */}
                <div className="relative z-10 flex flex-col h-full pointer-events-none">
                    {/* Top Floating Feed: ENTRADA */}
                    <div className="w-full p-6 pb-0 pointer-events-auto">
                        <div className="h-[160px] w-full bg-transparent overflow-hidden relative">
                            <div className="absolute top-3 left-6 flex items-center gap-2 z-10">
                                <Activity size={12} className="text-muted-foreground animate-pulse" />
                                <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground">Monitor En Vivo (ENTRADA)</span>
                            </div>

                            <div
                                ref={entryFeedRef}
                                className="flex items-center gap-4 px-6 pt-12 pb-4 h-full overflow-x-auto custom-scrollbar pointer-events-auto cursor-grab select-none"
                            >
                                {events.filter(e => e.snapshotPath && (e.direction === 'ENTRY' || !e.direction)).slice(0, 15).map(event => (
                                    <FeedCard
                                        key={event.id}
                                        event={event}
                                        verification={verifications[event.id]}
                                        currentTime={currentTime}
                                        onClick={() => setSelectedViewEvent(event)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1" />

                    {/* Right Toolbar Area */}
                    <div className="absolute top-1/2 -translate-y-1/2 right-6 flex flex-col gap-4 pointer-events-auto z-40 items-end">
                        <div className="flex flex-col gap-2 p-1.5 bg-black/40 backdrop-blur-md border border-border rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.4)]">
                            <Link href="/admin/dashboard-face/whitelist" title="Lista Blanca" className="w-10 h-10 rounded-full flex items-center justify-center text-emerald-500 hover:bg-emerald-500/10 transition-colors">
                                <Users size={18} />
                            </Link>
                            <Link href="/admin/dashboard-face/blacklist" title="Lista Negra" className="w-10 h-10 rounded-full flex items-center justify-center text-red-500 hover:bg-red-500/10 transition-colors">
                                <Ban size={18} />
                            </Link>
                            <Link href="/admin/dashboard-face/upload" title="Inscribir" className="w-10 h-10 rounded-full flex items-center justify-center text-blue-500 hover:bg-blue-500/10 transition-colors">
                                <UserPlus size={18} />
                            </Link>



                            <div className="h-[1px] w-6 bg-foreground/10 mx-auto my-1" />

                            <button
                                onClick={() => {
                                    const newMode = faceMode === "BLACKLIST" ? "WHITELIST" : "BLACKLIST";
                                    setPendingMode(newMode);
                                    setShowModeConfirm(true);
                                }}
                                className={cn(
                                    "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                                    faceMode === "WHITELIST" ? "bg-emerald-500 text-foreground shadow-[0_0_15px_rgba(16,185,129,0.5)]" : "bg-red-600 text-foreground shadow-[0_0_15px_rgba(220,38,38,0.5)]"
                                )}
                                title={`Modo actual: ${faceMode === "BLACKLIST" ? "LISTA NEGRA" : "LISTA BLANCA"}`}
                            >
                                {faceMode === "WHITELIST" ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
                            </button>

                            <div className="h-[1px] w-6 bg-foreground/10 mx-auto my-1" />

                            <Popover>
                                <PopoverTrigger asChild>
                                    <button className="w-10 h-10 rounded-full flex items-center justify-center text-foreground/70 hover:text-foreground hover:bg-accent transition-all" title="Gestionar Planos">
                                        <MapIcon size={18} />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent side="left" className="w-64 bg-black/90 border-border backdrop-blur-xl p-4 rounded-2xl shadow-lg z-[100]">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b border-border pb-2">
                                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none">PLANOS DISPONIBLES</span>
                                            <button
                                                onClick={() => mapFileInputRef.current?.click()}
                                                className="w-6 h-6 rounded-full bg-foreground/10 hover:bg-accent flex items-center justify-center transition-all text-foreground"
                                            >
                                                <Upload size={12} />
                                            </button>
                                        </div>
                                        <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                                            {floorPlans.map(fp => (
                                                <button
                                                    key={fp.id}
                                                    onClick={() => setCurrentFloorPlan(fp)}
                                                    className={cn(
                                                        "w-full text-left px-3 py-2 text-[9px] font-bold uppercase tracking-widest rounded-lg transition-all",
                                                        currentFloorPlan?.id === fp.id ? "bg-[#B20D30] text-foreground" : "text-muted-foreground hover:bg-accent"
                                                    )}
                                                >
                                                    {fp.name}
                                                </button>
                                            ))}
                                            {floorPlans.length === 0 && (
                                                <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-widest text-center py-4">Sin planos cargados</p>
                                            )}
                                        </div>
                                        <input
                                            type="file"
                                            ref={mapFileInputRef}
                                            className="hidden"
                                            accept="image/*"
                                            onChange={handleMapUpload}
                                        />
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="bg-black/60 backdrop-blur-xl border border-border p-3 rounded-3xl shadow-lg flex flex-col items-center gap-2">
                            <Switch
                                id="auto-popup-float"
                                checked={isAutoPopupEnabled}
                                onCheckedChange={setIsAutoPopupEnabled}
                                className="scale-75 data-[state=checked]:bg-[#B20D30]"
                            />
                            <Label htmlFor="auto-popup-float" className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground cursor-pointer text-center leading-none">
                                AUTO
                            </Label>
                        </div>

                        <div className="flex flex-col items-center gap-1 mt-2">
                            <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", isConnected ? "bg-emerald-500 shadow-[0_0_10px_#10b981]" : "bg-red-600 shadow-[0_0_10px_#dc2626]")} />
                            <span className="text-[7px] font-bold text-muted-foreground uppercase tracking-tighter">{isConnected ? "ONLINE" : "OFFLINE"}</span>
                        </div>
                    </div>

                    {/* Bottom Floating Feed: SALIDA */}
                    <div className="w-full p-6 pt-0 pointer-events-auto">
                        <div className="h-[160px] w-full bg-transparent overflow-hidden relative">
                            <div className="absolute top-3 left-6 flex items-center gap-2 z-10">
                                <Activity size={12} className="text-muted-foreground animate-pulse" />
                                <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground">Monitor En Vivo (SALIDA)</span>
                            </div>

                            <div
                                ref={exitFeedRef}
                                className="flex items-center gap-4 px-6 pt-12 pb-4 h-full overflow-x-auto custom-scrollbar pointer-events-auto cursor-grab select-none"
                            >
                                {events.filter(e => e.snapshotPath && e.direction === 'EXIT').slice(0, 15).map(event => (
                                    <FeedCard
                                        key={event.id}
                                        event={event}
                                        verification={verifications[event.id]}
                                        currentTime={currentTime}
                                        onClick={() => setSelectedViewEvent(event)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {selectedViewEvent && (
                <FaceMatchModal
                    event={selectedViewEvent}
                    verification={selectedViewEvent ? verifications[selectedViewEvent.id] : null}
                    isOpen={!!selectedViewEvent}
                    onClose={() => {
                        setSelectedViewEvent(null);
                        dismissAlarm();
                    }}
                />
            )}

            <AnimatePresence>
                {showModeConfirm && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                            onClick={() => setShowModeConfirm(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-md bg-[#0A0A0A] border border-border rounded-2xl overflow-hidden shadow-lg"
                        >
                            <div className={cn(
                                "p-6 flex flex-col items-center text-center",
                                pendingMode === 'WHITELIST' ? "bg-emerald-950/20" : "bg-red-950/20"
                            )}>
                                <div className={cn(
                                    "w-16 h-16 rounded-full flex items-center justify-center mb-4 border",
                                    pendingMode === 'WHITELIST' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-red-500/10 border-red-500/20 text-red-500"
                                )}>
                                    {pendingMode === 'WHITELIST' ? <ShieldCheck size={32} /> : <ShieldAlert size={32} />}
                                </div>
                                <h3 className="text-xl font-bold uppercase tracking-widest text-foreground mb-2">
                                    ¿Activar Modo {pendingMode === 'WHITELIST' ? 'Lista Blanca' : 'Lista Negra'}?
                                </h3>
                                <p className="text-sm text-muted-foreground mb-6 px-4 leading-relaxed">
                                    {pendingMode === 'WHITELIST'
                                        ? "Este modo prioriza la detección de residentes autorizados. El sistema registrará ingresos cotidianos y alertará solo en casos de discrepancias críticas con la base de datos de confianza."
                                        : "Este modo es restrictivo. El sistema buscará activamente sujetos marcados en la Lista Negra y disparará una alerta sensorial inmediata (visual y sonora) al detectar coincidencias."
                                    }
                                </p>
                                <div className="flex gap-3 w-full">
                                    <button
                                        onClick={() => setShowModeConfirm(false)}
                                        className="flex-1 h-12 bg-foreground/10 hover:bg-accent text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-all rounded-xl"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (pendingMode) {
                                                setFaceMode(pendingMode);
                                                await updateSetting("MODE_FACE", pendingMode);
                                                toast.success({ title: `PROTOCOLO ACTUALIZADO: ${pendingMode}` });
                                            }
                                            setShowModeConfirm(false);
                                        }}
                                        className={cn(
                                            "flex-1 h-12 text-[10px] font-bold uppercase tracking-widest text-foreground transition-all rounded-xl",
                                            pendingMode === 'WHITELIST' ? "bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]" : "bg-red-600 hover:bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.3)]"
                                        )}
                                    >
                                        Confirmar Protocolo
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <style jsx global>{`
                body {
                    background: #000;
                    overflow: hidden;
                }
                * {
                    border-radius: 0.5rem !important;
                }
                header, nav, button, .rounded-2xl {
                    border-radius: 1rem !important;
                }
                .custom-scrollbar::-webkit-scrollbar { height: 2px; width: 4px; display: block; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
            `}</style>
        </div>
    );
}

function StatusRow({ label, value, color = "text-foreground" }: any) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
            <span className={cn("text-[11px] font-bold uppercase tracking-tight", color)}>{value}</span>
        </div>
    );
}

function NavButton({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
    return (
        <button className={cn(
            "h-12 px-6 flex items-center gap-3 transition-all border-none",
            active ? "bg-[#B20D30] text-foreground shadow-[0_0_20px_rgba(178,13,48,0.3)]" : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}>
            {icon}
            <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
        </button>
    );
}

interface FeedCardProps {
    event: FullAccessEvent;
    verification: any;
    currentTime: Date;
    onClick: () => void;
}

function FeedCard({ event, verification, currentTime, onClick }: FeedCardProps) {
    const camMatch = event.details?.match(/CamMatch: ([\d.]+)%/);
    const cameraSimilarity = camMatch ? camMatch[1] : null;

    const similarity = verification?.similarity
        ? (verification.similarity * 100).toFixed(0)
        : cameraSimilarity;

    const timeStr = new Date(event.timestamp).toLocaleString('es-ES', {
        hour: '2-digit', minute: '2-digit', hour12: false
    });

    const personaName = event.details?.match(/Persona: ([^,]+)/)?.[1];

    // Identity logic: Use neural identification if available, fallback to camera identify
    const displayName = verification?.recognizedAs && verification.recognizedAs !== 'Desconocido'
        ? verification.recognizedAs
        : (personaName && !['Desconocido', 'N/A', 'Persona'].some(s => personaName.includes(s)) ? personaName : "Sujeto Desconocido");

    const isIdentified = (verification?.recognizedAs && verification.recognizedAs !== 'Desconocido') || (personaName && !['Desconocido', 'N/A', 'Persona'].some(s => personaName.includes(s)));
    const isWhiteList = event.user?.role === 'WHITELISTED';
    const isBlacklisted = event.user?.role === 'BLACKLISTED' || verification?.alertTriggered;
    const isAlert = isBlacklisted || isIdentified; // Everyone recognized is an "Alert" to verify
    const isConflict = verification?.isConflict;
    const isSuspicious = verification?.isSuspicious;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ y: -2 }}
            onClick={onClick}
            className="flex flex-col gap-2 shrink-0 group cursor-pointer"
        >
            {/* Image Container */}
            <div className={cn(
                "w-24 h-24 bg-card relative rounded-xl overflow-hidden border transition-all duration-300",
                isBlacklisted ? "border-red-600 shadow-[0_0_15px_rgba(220,38,38,0.3)]" :
                    isWhiteList ? "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.2)]" :
                        isConflict || isSuspicious ? "border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]" :
                            "border-border opacity-80 group-hover:opacity-100 group-hover:border-border"
            )}>
                <img
                    src={getImagePath(event.snapshotPath) || ""}
                    className={cn(
                        "w-full h-full object-cover transition-transform duration-500 group-hover:scale-110",
                        !isBlacklisted && !isWhiteList && "grayscale group-hover:grayscale-0"
                    )}
                    alt=""
                />

                {/* Time Overlay (Top Right) */}
                <div className="absolute top-1 right-1 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded-md border border-border z-10">
                    <span className="text-[8px] font-bold text-foreground/70 font-mono tracking-tighter">
                        {timeStr}
                    </span>
                </div>

                {/* Red Alert Overlay for ANY Identification */}
                <AnimatePresence>
                    {isAlert && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0.2, 0.5, 0.2] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute inset-0 bg-red-600 pointer-events-none z-0"
                        />
                    )}
                </AnimatePresence>

                {/* Status Indicator (Dot) */}
                <div className="absolute top-1 left-1">
                    <div className={cn(
                        "w-2 h-2 rounded-full",
                        isBlacklisted ? "bg-red-600 animate-pulse" :
                            isWhiteList ? "bg-emerald-500" :
                                isConflict || isSuspicious ? "bg-amber-500 animate-pulse" : "bg-muted"
                    )} />
                </div>

                {/* Similarity tag if identified */}
                {similarity && similarity !== "0" && (
                    <div className="absolute bottom-1 right-1 bg-black/40 backdrop-blur-sm px-1 rounded border border-border">
                        <span className="text-[7px] font-bold text-foreground/70">{similarity}%</span>
                    </div>
                )}
            </div>

            {/* Identity Info (Below Image) */}
            <div className="flex flex-col items-center gap-0.5 w-24">
                <span className={cn(
                    "text-[9px] font-bold uppercase text-center leading-tight truncate w-full px-1",
                    isBlacklisted ? "text-red-500" :
                        isWhiteList ? "text-emerald-500" :
                            isConflict || isSuspicious ? "text-amber-500" : "text-foreground/70 group-hover:text-foreground"
                )}>
                    {displayName.split(' ')[0]} {/* Show first name only if too long */}
                </span>

                {/* Tactical Role Label (Tiny) */}
                <span className="text-[6px] font-bold tracking-widest text-muted-foreground uppercase leading-none truncate w-full text-center">
                    {event.device?.name?.replace('Terminal ', '') || (event.direction === 'EXIT' ? 'SALIDA' : 'ENTRADA')}
                </span>
            </div>
        </motion.div>
    );
}
