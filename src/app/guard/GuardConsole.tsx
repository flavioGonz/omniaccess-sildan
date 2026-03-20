"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Camera,
    Loader2,
    LogIn,
    LogOut,
    RefreshCcw,
    Trash2,
    User as UserIcon,
    Shield,
    Clock,
    Activity,
    ChevronRight,
    Search,
    History as HistoryIcon,
    FileText,
    Bell,
    Settings,
    CameraOff,
    CheckCircle2,
    X,
    ChevronUp,
    Image as ImageIcon,
    MapPin,
    Mic,
    Square,
    Play,
    Volume2,
    Building2,
    Map as MapIcon,
    ShieldAlert,
    Navigation,
    UserCheck,
    UserX,
    CarFront,
    Briefcase,
    Home,
    Plus,
    Flame,
    Download,
    Siren,
    Landmark,
    Delete,
    Car,
    Bike,
    Zap,
    Monitor,
    Maximize2,
    Calendar,
    Eye,
    UserPlus,
    AlertOctagon,
    ScanFace,
    Upload,
    History
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createBitacoraEntry, deleteBitacoraEntry, getBitacoraPage, searchRecentBitacora } from "@/app/actions/bitacora";
import { getAccessEvents, getPlateAnalysis } from "@/app/actions/history";
import { getQuickCreateData, getGuardsList } from "@/app/actions/users";
import { resolveFaceEventAction } from "@/app/actions/face-resolve";
import { UserFormDialog } from "@/components/UserFormDialog";
import { searchByPhotoAction } from "@/app/actions/face-verify";
import { sileo as toast } from "sileo";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import { useInView } from "react-intersection-observer";
import { saveGuardBranding, uploadBrandingFile } from "@/app/actions/settings";
import axios from "axios";
import { getSocketUrl } from "@/lib/socket-config";

import dynamic from 'next/dynamic';
const LiveGuardMap = dynamic(() => import('@/components/LiveGuardMap'), { ssr: false });
const OCRScanner = dynamic(() => import('@/components/OCRScannerTF'), { ssr: false });
const FaceScannerOverlay = dynamic(() => import('@/components/FaceScannerOverlay'), { ssr: false });

interface GuardConsoleProps {
    initialEntries: any[];
    logo: string;
    headerColor: string;
    initialIcons: Record<string, string>;
    units: any[];
    guards: any[];
}

type TabType = "control" | "history" | "alerts" | "lpr" | "map" | "face";


export default function GuardConsole({ initialEntries, logo, headerColor, initialIcons, units, guards }: GuardConsoleProps) {
    const [activeTab, setActiveTab] = useState<TabType>("control");
    const [entries, setEntries] = useState(initialEntries);
    const [type, setType] = useState<"ENTRY" | "EXIT">("ENTRY");
    const [plate, setPlate] = useState("");
    const [vehicleType, setVehicleType] = useState<"AUTO" | "MOTO">("AUTO");
    const [notes, setNotes] = useState("");
    const [name, setName] = useState("");
    const [dni, setDni] = useState("");
    const [matchingEntry, setMatchingEntry] = useState<any>(null);
    const [showMatchPrompt, setShowMatchPrompt] = useState(false);
    const [originType, setOriginType] = useState<"PARTICULAR" | "EMPRESA" | "IMM" | "POLICIA" | "BOMBEROS" | "AMBULANCIA">("PARTICULAR");
    const [company, setCompany] = useState("");
    const [socket, setSocket] = useState<any>(null);
    const [monitoringMissions, setMonitoringMissions] = useState<any[]>([]); // For observing multiple ongoing alerts
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("environment");
    const [isOCRActive, setIsOCRActive] = useState(false);
    const [currentTime, setCurrentTime] = useState<Date | null>(null);
    const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
    const [showAlarmSplash, setShowAlarmSplash] = useState(false);
    const isFirstAlertStatusReceived = useRef(false);
    const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [isAlertMode, setIsAlertMode] = useState(false);
    const [alertStartTime, setAlertStartTime] = useState<Date | null>(null);
    const [historyPage, setHistoryPage] = useState(0);
    const [historySearch, setHistorySearch] = useState("");
    const [hasMoreHistory, setHasMoreHistory] = useState(true);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [notification, setNotification] = useState<{ type: "success" | "error" | "info" | "alert", title: string, message: string } | null>(null);
    const [selectedEntry, setSelectedEntry] = useState<any>(null);

    // LPR History state
    const [lprEntries, setLprEntries] = useState<any[]>([]);
    const [isLprLoading, setIsLprLoading] = useState(false);
    const [lprSearch, setLprSearch] = useState("");
    const [lprDate, setLprDate] = useState("");
    const [lprDirection, setLprDirection] = useState<"ALL" | "ENTRY" | "EXIT">("ALL");

    // Alerts History state
    const [alertsSearch, setAlertsSearch] = useState("");
    const [alertsDate, setAlertsDate] = useState(new Date().toISOString().split('T')[0]);

    // Filter modal states
    const [showLprFilterModal, setShowLprFilterModal] = useState(false);
    const [showAlertsFilterModal, setShowAlertsFilterModal] = useState(false);
    const [showHistoryFilterModal, setShowHistoryFilterModal] = useState(false);

    // Manual Face Resolve states
    const [faceResultName, setFaceResultName] = useState("");
    const [faceResultDni, setFaceResultDni] = useState("");
    const [faceResultUnit, setFaceResultUnit] = useState("");
    const [faceResultNotes, setFaceResultNotes] = useState("");
    const [isResolvingFace, setIsResolvingFace] = useState(false);

    // Image Viewer state
    const [viewerData, setViewerData] = useState<{
        url: string,
        plate?: string,
        name?: string,
        unit?: string,
        direction?: string,
        confidence?: number,
        timestamp?: string,
        deviceName?: string,
        vehicleBrand?: string,
        vehicleModel?: string,
        device?: any
    } | null>(null);
    const viewerImage = viewerData?.url || null;
    const setViewerImage = (url: string | null) => setViewerData(url ? { url } : null);

    // Plate Analysis state
    const [plateAnalysis, setPlateAnalysis] = useState<any>(null);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);
    const [zoomImage, setZoomImage] = useState<string | null>(null);

    // Quick Create States
    const [showQuickCreate, setShowQuickCreate] = useState(false);
    const [quickCreateContext, setQuickCreateContext] = useState<any>(null);
    const [quickCreateData, setQuickCreateData] = useState<any>(null);
    const [loadingQuickCreateData, setLoadingQuickCreateData] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [showUpdateSplash, setShowUpdateSplash] = useState(false);
    const [recentRecords, setRecentRecords] = useState<any[]>([]);
    const [showSearchFillModal, setShowSearchFillModal] = useState(false);
    const [isSearchingRecords, setIsSearchingRecords] = useState(false);

    // Alert Normalization Modal
    const [showNormalizationModal, setShowNormalizationModal] = useState(false);
    const [normalizationText, setNormalizationText] = useState("");

    // Settings / Configuration
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [customLogo, setCustomLogo] = useState<string | null>(logo);
    const [customHeaderColor, setCustomHeaderColor] = useState<string>(headerColor);
    const [customIcons, setCustomIcons] = useState<Record<string, string>>(initialIcons);
    const [isSavingBranding, setIsSavingBranding] = useState(false);

    // Face Recognition States
    const [isFaceCameraActive, setIsFaceCameraActive] = useState(false);
    const [isAnalyzingFace, setIsAnalyzingFace] = useState(false);
    const [faceMatchResult, setFaceMatchResult] = useState<any>(null);

    useEffect(() => {
        if (faceMatchResult) {
            setFaceResultName(faceMatchResult.user?.name || faceMatchResult.match?.subject || "");
            setFaceResultDni(faceMatchResult.user?.dni || "");
            setFaceResultUnit(faceMatchResult.user?.unit?.name || "");
            setFaceResultNotes("");
        } else {
            setFaceResultName("");
            setFaceResultDni("");
            setFaceResultUnit("");
            setFaceResultNotes("");
        }
    }, [faceMatchResult]);
    const faceVideoRef = useRef<HTMLVideoElement>(null);
    const faceCanvasRef = useRef<HTMLCanvasElement>(null);
    const faceStreamRef = useRef<MediaStream | null>(null);

    // Guard List State
    const [showGuardList, setShowGuardList] = useState(false);
    const [guardsList, setGuardsList] = useState<any[]>([]);
    const [loadingGuards, setLoadingGuards] = useState(false);

    // State for login
    const [loginUser, setLoginUser] = useState("");
    const [loginPass, setLoginPass] = useState("");

    const [guardName, setGuardName] = useState("");
    const [guardPhoto, setGuardPhoto] = useState<string | null>(null);
    const guardNameRef = useRef("");
    const guardPhotoRef = useRef<string | null>(null);

    useEffect(() => {
        guardNameRef.current = guardName;
    }, [guardName]);

    useEffect(() => {
        guardPhotoRef.current = guardPhoto;
    }, [guardPhoto]);

    useEffect(() => {
        // We still support local guard photo, but branding is now server-side
        const savedPhoto = localStorage.getItem("guard_photo");
        if (savedPhoto) setGuardPhoto(savedPhoto);
    }, []);

    // Initial Login Check
    useEffect(() => {
        // If not configured, prompts configuration.
        // Guard name is stored in localStorage by "configuration" flow
        const savedName = localStorage.getItem("guard_name");
        if (savedName) setGuardName(savedName);
    }, []);

    // Refs for socket listeners to access current state
    const lprSearchRef = useRef(lprSearch);
    const lprDateRef = useRef(lprDate);
    const lprDirectionRef = useRef(lprDirection);
    const activeTabRef = useRef(activeTab);

    useEffect(() => { lprSearchRef.current = lprSearch; }, [lprSearch]);
    useEffect(() => { lprDateRef.current = lprDate; }, [lprDate]);
    useEffect(() => { lprDirectionRef.current = lprDirection; }, [lprDirection]);
    useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

    // MAP & GPS STATES
    const [myLocation, setMyLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [otherGuards, setOtherGuards] = useState<any[]>([]);

    // UNIT VEHICLE PROMPT
    const [showVehiclePrompt, setShowVehiclePrompt] = useState(false);
    const [availableVehicles, setAvailableVehicles] = useState<any[]>([]);

    // PROFILE MENU
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showCameraModal, setShowCameraModal] = useState(false);

    // BACKUP REQUEST STATES
    const [backupLocation, setBackupLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [incomingBackup, setIncomingBackup] = useState<any>(null);
    const [activeMission, setActiveMission] = useState<any>(null);
    const [showResolutionModal, setShowResolutionModal] = useState(false);
    const [backupDetail, setBackupDetail] = useState("");

    // Audio States
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // Audio recording timer state
    const [recordingDuration, setRecordingDuration] = useState(0);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Profile Camera Refs
    const profileVideoRef = useRef<HTMLVideoElement>(null);
    const profileCanvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (isRecording) {
            setRecordingDuration(0);
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);
        } else {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        }
        return () => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); };
    }, [isRecording]);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Load plate analysis when viewer opens with a plate
    useEffect(() => {
        if (viewerData?.plate && viewerData.plate !== '--- ---') {
            setLoadingAnalysis(true);
            getPlateAnalysis(viewerData.plate).then(analysis => {
                setPlateAnalysis(analysis);
                setLoadingAnalysis(false);
            }).catch(() => {
                setLoadingAnalysis(false);
            });
        } else {
            setPlateAnalysis(null);
        }
    }, [viewerData?.plate]);

    const { ref: loadMoreRef, inView } = useInView({
        threshold: 0.5,
    });

    const alarmAudioRef = useRef<HTMLAudioElement | null>(null);

    // Show Notification Screen
    const showNotification = (title: string, message: string, type: "success" | "error" | "info" | "alert" = "success", duration: number = 2000) => {
        setNotification({ type, title, message });
        setTimeout(() => setNotification(null), duration);
    };

    // Profile Camera Logic
    useEffect(() => {
        let stream: MediaStream | null = null;
        if (showCameraModal) {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
                .then(s => {
                    stream = s;
                    if (profileVideoRef.current) profileVideoRef.current.srcObject = s;
                })
                .catch(err => console.error("Profile camera error:", err));
        }
        return () => {
            if (stream) stream.getTracks().forEach(track => track.stop());
        };
    }, [showCameraModal]);

    const captureProfilePhoto = () => {
        if (profileVideoRef.current && profileCanvasRef.current) {
            const video = profileVideoRef.current;
            const canvas = profileCanvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
                // Flip horizontally for mirror effect if needed
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(video, 0, 0);
                const dataUrl = canvas.toDataURL("image/jpeg");
                setGuardPhoto(dataUrl);
                localStorage.setItem("guard_photo", dataUrl);
                setShowCameraModal(false);
                playTactileSound();
            }
        }
    };

    useEffect(() => {
        console.log('🔌 Connecting to socket:', getSocketUrl());
        const newSocket = io(getSocketUrl());
        setSocket(newSocket);

        // Attempt to get Local IP via WebRTC
        let detectedLocalIp = '';
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel("");
            pc.createOffer().then(offer => pc.setLocalDescription(offer));
            pc.onicecandidate = (ice) => {
                if (ice && ice.candidate && ice.candidate.candidate) {
                    const myIP = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(ice.candidate.candidate)?.[1];
                    if (myIP && !myIP.startsWith('127.')) {
                        detectedLocalIp = myIP;
                    }
                }
            };
            setTimeout(() => pc.close(), 5000);
        } catch (e) {
            console.error("Local IP detection error", e);
        }

        // Emit presence every 4 seconds for a tighter keepalive
        const heartBeat = setInterval(() => {
            if (newSocket.connected) {
                // Try to extract some useful device info from userAgent
                const ua = navigator.userAgent;
                let deviceInfo = "Tablet";
                if (ua.includes("Samsung")) deviceInfo = "Samsung Tablet";
                else if (ua.includes("Huawei")) deviceInfo = "Huawei Tablet";
                else if (ua.includes("iPad")) deviceInfo = "iPad";
                else if (ua.includes("Android")) {
                    const match = ua.match(/\(([^;]+);/);
                    if (match && match[1]) deviceInfo = match[1].split('Build')[0].trim();
                }

                newSocket.emit('guard_presence', {
                    guardName: guardNameRef.current || localStorage.getItem("guard_name") || 'Invitado',
                    status: 'online',
                    timestamp: new Date().toISOString(),
                    reportedIp: detectedLocalIp, // Send the IP we found
                    deviceInfo: deviceInfo,
                    guardPhoto: guardPhotoRef.current || localStorage.getItem("guard_photo")
                });
            }
        }, 4000);

        newSocket.on('alert_status', (data: any) => {
            const previousState = isAlertMode;
            setIsAlertMode(data.active);

            // Solo mostrar notificaciones si no es la primera vez (evita mensaje al recargar)
            if (!isFirstAlertStatusReceived.current) {
                isFirstAlertStatusReceived.current = true;
                return;
            }

            if (data.active) {
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("⚠️ ALERTA DE SEGURIDAD - OMNIACCESS GUARD", {
                        body: `Modo de alerta activado por ${data.triggeredBy || "un compañero"}.`,
                        icon: "/icons/sildan-icon-dot.png",
                        tag: "security-alert"
                    });
                }
                if ('setAppBadge' in navigator) (navigator as any).setAppBadge(1).catch(() => { });
                setShowAlarmSplash(true);
                setTimeout(() => setShowAlarmSplash(false), 4000);
            } else if (previousState) {
                const message = data.explanation
                    ? `La alerta ha sido desactivada. Motivo: ${data.explanation}`
                    : "La alerta de seguridad ha sido desactivada correctamente.";
                showNotification("SISTEMA NORMALIZADO", message, "success", 50000);
                if ('clearAppBadge' in navigator) (navigator as any).clearAppBadge().catch(() => { });
            }
        });

        newSocket.on('new_bitacora', (entry: any) => {
            setEntries(prev => {
                if (prev.some(e => e.id === entry.id)) return prev;
                return [entry, ...prev];
            });
        });

        newSocket.on('access_event', (event: any) => {
            const isLpr = activeTabRef.current === "lpr";
            // Check if the event matches the current date filter
            const eventDate = new Date(event.timestamp).toISOString().split('T')[0];
            const isSameDate = lprDateRef.current === eventDate;

            // Check search filter
            const search = lprSearchRef.current.toUpperCase();
            const matchesSearch = !search ||
                (event.plateDetected || "").toUpperCase().includes(search) ||
                (event.user?.name || "").toUpperCase().includes(search) ||
                (event.user?.unit?.name || "").toUpperCase().includes(search);

            const dirFilter = lprDirectionRef.current;
            const matchesDirection = dirFilter === "ALL" || event.direction === dirFilter;

            if (isSameDate && matchesSearch && matchesDirection && (event.accessType === "PLATE" || event.plateDetected)) {
                setLprEntries(prev => {
                    if (prev.find(e => e.id === event.id)) return prev;
                    return [event, ...prev];
                });
            }
        });

        // MISSION & BACKUP LISTENERS (CONSOLIDATED)
        newSocket.on('active_missions', (data: any[]) => {
            setMonitoringMissions(data);
        });

        newSocket.on('backup_requested', (data: any) => {
            setIncomingBackup(data);
            setMonitoringMissions(prev => {
                if (prev.find(m => m.id === data.id)) return prev;
                return [...prev, data];
            });
            if ('setAppBadge' in navigator) (navigator as any).setAppBadge(1).catch(() => { });
            if ("vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 500]);
            playTactileSound();
        });

        newSocket.on('backup_status_update', (data: any) => {
            setActiveMission((prev: any) => {
                if (prev && (prev.id === data.requestId)) {
                    return { ...prev, status: data.accepted ? 'ACCEPTED' : 'REJECTED', responderId: data.responderId, responderName: data.responderName };
                }
                return prev;
            });
            setMonitoringMissions(prev => prev.map(m =>
                m.id === data.requestId
                    ? { ...m, status: data.accepted ? 'ACCEPTED' : 'REJECTED', responderId: data.responderId, responderName: data.responderName }
                    : m
            ));
            if (data.accepted) {
                showNotification("APOYO EN CAMINO", `${data.responderName} ha aceptado la solicitud.`, "success");
                setIncomingBackup(null);
            }
        });

        newSocket.on('backup_resolved', (data: any) => {
            setActiveMission((prev: any) => prev?.id === data.requestId ? null : prev);
            setMonitoringMissions(prev => prev.filter(m => m.id !== data.requestId));
            setIncomingBackup(null);
            showNotification("ALERTA FINALIZADA", `El incidente ha sido gestionado por ${data.resolverName}.`, "success", 5000);
            if ('clearAppBadge' in navigator) (navigator as any).clearAppBadge().catch(() => { });
        });

        newSocket.on('backup_cancelled', (data: any) => {
            setActiveMission((prev: any) => prev?.id === data.requestId ? null : prev);
            setMonitoringMissions(prev => prev.filter(m => m.id !== data.requestId));
            setIncomingBackup(null);
            showNotification("ALERTA CANCELADA", `La alerta fue cancelada por ${data.cancelledBy}.`, "info");
        });

        newSocket.on('guard_locations', (data: any) => {
            setOtherGuards(data);
        });

        // GPS WATCHER (CONTINUOUS IN BACKGROUND)
        let watchId: number | null = null;
        if ("geolocation" in navigator) {
            watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const { latitude, longitude, accuracy } = position.coords;
                    setMyLocation({ lat: latitude, lng: longitude });
                    if (newSocket && newSocket.connected) {
                        try {
                            const storedName = localStorage.getItem("guardName");
                            newSocket.emit('guard_location_update', {
                                lat: latitude,
                                lng: longitude,
                                accuracy,
                                guardName: storedName || guardName || "Operario",
                                timestamp: Date.now()
                            });
                        } catch (e) {
                            console.error("Socket emit error", e);
                        }
                    }
                },
                (error) => console.error("GPS Error:", error),
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 10000
                }
            );
        }

        return () => {
            clearInterval(heartBeat);
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            newSocket.disconnect();
        };
    }, []); // Only establish once


    // Notification Permission Request
    useEffect(() => {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    const handleOCRDetected = (detectedPlate: string | null, imageBlob: Blob) => {
        if (detectedPlate !== null) setPlate(detectedPlate);
        const reader = new FileReader();
        reader.onloadend = () => {
            setCapturedPhoto(reader.result as string);
        };
        reader.readAsDataURL(imageBlob);
        setIsOCRActive(false);
        playTactileSound();
        if ("vibrate" in navigator) {
            navigator.vibrate([100, 50, 100]);
        }
    };

    const handleQuickCreateClick = async (data: { plate?: string, cara?: string, name?: string }) => {
        setQuickCreateContext(data);
        if (quickCreateData) {
            setShowQuickCreate(true);
            return;
        }

        setLoadingQuickCreateData(true);
        try {
            const data = await getQuickCreateData();
            setQuickCreateData(data);
            setShowQuickCreate(true);
        } catch (error) {
            console.error("Error fetching quick create data:", error);
            toast.error({ title: "Error al cargar datos de creación rápida" });
        } finally {
            setLoadingQuickCreateData(false);
        }
    };

    const handleOpenGuardList = async () => {
        setLoadingGuards(true);
        setShowGuardList(true);
        try {
            const guards = await getGuardsList();
            setGuardsList(guards);
        } catch (e) {
            console.error(e);
            toast.error({ title: "Error al cargar lista de guardias" });
        } finally {
            setLoadingGuards(false);
        }
    };

    // Alarm Audio Control
    useEffect(() => {
        if (isAlertMode) {
            // Create audio object if not exists
            if (!alarmAudioRef.current) {
                alarmAudioRef.current = new Audio("https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg"); // Standard alert sound
                alarmAudioRef.current.loop = true;
            }
            alarmAudioRef.current.play().catch(e => console.log("Audio play blocked", e));
        } else {
            if (alarmAudioRef.current) {
                alarmAudioRef.current.pause();
                alarmAudioRef.current.currentTime = 0;
            }
        }
    }, [isAlertMode]);

    // Bitacora Search Fill Logic
    useEffect(() => {
        const query = (plate.length >= 3) ? plate : "";
        if (query) {
            const timer = setTimeout(async () => {
                setIsSearchingRecords(true);
                const results = await searchRecentBitacora(query);
                if (results && results.length > 0) {
                    setRecentRecords(results);
                    setShowSearchFillModal(true);
                }
                setIsSearchingRecords(false);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [plate]);

    // Vibration Feedback for Alerts
    useEffect(() => {
        let interval: any;
        if (isAlertMode && "vibrate" in navigator) {
            // Periodic strong vibration while alert is active
            interval = setInterval(() => {
                navigator.vibrate([500, 200, 500]);
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [isAlertMode]);

    const toggleAlertMode = (forcedState?: boolean, explanation?: string) => {
        if (!socket) return;
        const newState = forcedState !== undefined ? forcedState : !isAlertMode;
        socket.emit("alert_toggle", {
            active: newState,
            triggeredBy: guardName || "Invitado",
            explanation: explanation || ""
        });
    };

    // Panic Button Hold Logic
    const [panicHoldProgress, setPanicHoldProgress] = useState(0);
    const [deactivateHoldProgress, setDeactivateHoldProgress] = useState(0);
    const panicHoldRef = useRef<any>(null);
    const deactivateHoldRef = useRef<any>(null);

    const startPanicHold = () => {
        if (isAlertMode) return;
        playTactileSound();
        let start = Date.now();
        panicHoldRef.current = setInterval(() => {
            let elapsed = Date.now() - start;
            let progress = Math.min((elapsed / 1500) * 100, 100); // 1.5 seconds hold
            setPanicHoldProgress(progress);
            if (progress >= 100) {
                clearInterval(panicHoldRef.current);
                toggleAlertMode(true);
                setPanicHoldProgress(0);
                if ("vibrate" in navigator) navigator.vibrate([100, 50, 100, 50, 400]);
            }
        }, 50);
    };

    const cancelPanicHold = () => {
        clearInterval(panicHoldRef.current);
        setPanicHoldProgress(0);
    };

    const startDeactivateHold = () => {
        if (!isAlertMode) return;
        playTactileSound();
        let start = Date.now();
        deactivateHoldRef.current = setInterval(() => {
            let elapsed = Date.now() - start;
            let progress = Math.min((elapsed / 2000) * 100, 100); // 2 seconds hold for deactivation
            setDeactivateHoldProgress(progress);
            if (progress >= 100) {
                clearInterval(deactivateHoldRef.current);
                setDeactivateHoldProgress(0);
                if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
                // Abrir modal para pedir explicación
                setShowNormalizationModal(true);
            }
        }, 50);
    };

    const cancelDeactivateHold = () => {
        clearInterval(deactivateHoldRef.current);
        setDeactivateHoldProgress(0);
    };

    const [showUnitPicker, setShowUnitPicker] = useState(false);
    const [showOriginPicker, setShowOriginPicker] = useState(false);
    const [unitSearch, setUnitSearch] = useState("");
    const [showUnitResults, setShowUnitResults] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<any>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const hiddenInputRef = useRef<HTMLInputElement>(null);

    const handleTabChange = (tab: TabType) => {
        if (tab === activeTab) return;

        // Stop any active cameras when leaving tabs
        if (activeTab === "face") stopFaceCamera();
        if (activeTab === "control") setIsCameraActive(false);

        setIsTransitioning(true);
        setTimeout(() => {
            setActiveTab(tab);

            // Reset face match result when switching to face tab
            if (tab === "face") {
                setFaceMatchResult(null);
            }

            setTimeout(() => {
                setIsTransitioning(false);
            }, 600);
        }, 400);
    };

    // Filtered Units
    const filteredUnits = units.filter(u =>
        u.name.toLowerCase().includes(unitSearch.toLowerCase()) ||
        (u.number && u.number.toLowerCase().includes(unitSearch.toLowerCase()))
    ).slice(0, 5);

    // Identity Management
    const [showIdentityOverlay, setShowIdentityOverlay] = useState(true);
    const [tempGuardName, setTempGuardName] = useState("");

    const handleManualLogin = (e: React.FormEvent) => {
        e.preventDefault();

        const guard = guards.find(g => (g.username || g.name).toLowerCase() === loginUser.toLowerCase());

        if (guard && guard.password === loginPass) {
            setGuardName(guard.name);
            const photoUrl = guard.cara ? (guard.cara.startsWith('/') ? guard.cara : `/api/files/${guard.cara}`) : null;
            setGuardPhoto(photoUrl);
            if (typeof window !== 'undefined') {
                localStorage.setItem("bitacora_guard_name", guard.name);
                if (photoUrl) localStorage.setItem("bitacora_guard_photo", photoUrl);
            }
            playTactileSound();
            toast.success({ title: `Bienvenido, ${guard.name}` });

            setShowIdentityOverlay(false);

            // Reset form
            setLoginUser("");
            setLoginPass("");

        } else {
            playTactileSound();
            toast.error({ title: "Credenciales incorrectas" });
        }
    };

    const handleConfirmIdentity = (guard: any) => {
        const pinCheck = prompt(`Ingrese PIN de seguridad para ${guard.name}:`);
        if (pinCheck && pinCheck === guard.password) {
            setGuardName(guard.name);
            setGuardPhoto(guard.cara);
            localStorage.setItem("bitacora_guard_name", guard.name);
            if (guard.cara) localStorage.setItem("bitacora_guard_photo", guard.cara);
            setShowIdentityOverlay(false);
            setShowProfileMenu(false); // Ensure menu is closed
            showNotification("BIENVENIDO", `Sesión iniciada como ${guard.name}.`, "success");
        } else if (pinCheck) {
            showNotification("PIN INCORRECTO", "El PIN ingresado no es válido.", "error");
        }
    };

    const handleLogout = () => {
        setGuardName("");
        setGuardPhoto(null);
        localStorage.removeItem("bitacora_guard_name");
        localStorage.removeItem("bitacora_guard_photo");
        setShowIdentityOverlay(true);
        showNotification("SESIÓN CERRADA", "Se ha finalizado la sesión del guardia exitosamente.", "info");
    };

    // Clock
    useEffect(() => {
        setCurrentTime(new Date());
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Geolocation
    useEffect(() => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setLocation({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                (error) => {
                    console.error("Geolocation error:", error);
                }
            );
        }
    }, []);

    // Load guard name
    useEffect(() => {
        const savedGuard = localStorage.getItem("bitacora_guard_name");
        if (savedGuard) {
            setGuardName(savedGuard);
            setShowIdentityOverlay(false);
        }
    }, []);

    const saveGuardName = (val: string) => {
        setGuardName(val);
        localStorage.setItem("bitacora_guard_name", val);
    };

    // INFINITE SCROLL EFFECT
    useEffect(() => {
        if (inView && hasMoreHistory && !isHistoryLoading && activeTab === "history") {
            loadMoreHistory();
        }
    }, [inView, hasMoreHistory, isHistoryLoading, activeTab]);

    const loadMoreHistory = async () => {
        setIsHistoryLoading(true);
        try {
            const nextPage = historyPage + 1;
            const newEntries = await getBitacoraPage(nextPage, 20, historySearch);
            if (newEntries.length < 20) setHasMoreHistory(false);
            setEntries(prev => [...prev, ...newEntries]);
            setHistoryPage(nextPage);
        } catch (error) {
            console.error("Error loading more history:", error);
        } finally {
            setIsHistoryLoading(false);
        }
    };

    // SEARCH HISTORY EFFECT
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (activeTab === "history") {
                setIsHistoryLoading(true);
                try {
                    const firstPage = await getBitacoraPage(0, 20, historySearch);
                    setEntries(firstPage);
                    setHistoryPage(0);
                    setHasMoreHistory(firstPage.length === 20);
                } catch (error) {
                    console.error("Search error:", error);
                } finally {
                    setIsHistoryLoading(false);
                }
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [historySearch, activeTab]);

    // FETCH LPR HISTORY EFFECT
    useEffect(() => {
        const fetchLPR = async () => {
            if (activeTab === "lpr") {
                setIsLprLoading(true);
                try {
                    let from = undefined;
                    let to = undefined;
                    if (lprDate) {
                        try {
                            from = new Date(lprDate);
                            from.setHours(0, 0, 0, 0);
                            to = new Date(lprDate);
                            to.setHours(23, 59, 59, 999);
                        } catch (e) { }
                    }

                    const { events } = await getAccessEvents({
                        type: 'PLATE',
                        take: 100, // Pull more for better context
                        search: lprSearch,
                        direction: lprDirection !== "ALL" ? lprDirection : undefined,
                        from,
                        to
                    });
                    
                    // Explicit client-side sort by timestamp desc
                    const sortedEvents = (events || []).sort((a: any, b: any) => 
                        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                    );
                    setLprEntries(sortedEvents);
                } catch (error) {
                    console.error("LPR fetch error:", error);
                } finally {
                    setIsLprLoading(false);
                }
            }
        };
        const timer = setTimeout(fetchLPR, 500);
        return () => clearTimeout(timer);
    }, [activeTab, lprSearch, lprDate, lprDirection]);

    // TACTILE SOUND UTILITY
    const audioContextRef = useRef<AudioContext | null>(null);
    const playTactileSound = useCallback(() => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            const ctx = audioContextRef.current;
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
        } catch (e) { }
    }, []);

    // PLATE MATCH DETECTION
    useEffect(() => {
        const cleanPlate = plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (cleanPlate.length >= 4) {
            const match = entries.find(e => {
                const cleanEntryPlate = (e.plate || "").replace(/[^A-Z0-9]/gi, '').toUpperCase();
                return cleanEntryPlate === cleanPlate;
            });

            if (match && !showMatchPrompt && (name !== match.name || dni !== match.dni)) {
                setMatchingEntry(match);
                setShowMatchPrompt(true);
            }
        } else {
            setShowMatchPrompt(false);
        }
    }, [plate, entries]);

    const handleAutocomplete = () => {
        if (matchingEntry) {
            setName(matchingEntry.name || "");
            setDni(matchingEntry.dni || "");
            if (matchingEntry.company) {
                if (["PARTICULAR", "IMM", "POLICIA", "BOMBEROS", "AMBULANCIA"].includes(matchingEntry.company)) {
                    setOriginType(matchingEntry.company);
                } else {
                    setOriginType("EMPRESA");
                    setCompany(matchingEntry.company);
                }
            }
            // Try to find matching unit
            const unitMatch = units.find(u =>
                (u.name + (u.number ? ` (${u.number})` : "")) === matchingEntry.destination
            );
            if (unitMatch) setSelectedUnit(unitMatch);

            setShowMatchPrompt(false);
            showNotification("DATOS VINCULADOS", `Se ha cargado la identidad de ${matchingEntry.name} automáticamente.`, "info", 2500);
            playTactileSound();
        }
    };

    // Camera Lifecycle
    useEffect(() => {
        async function startCamera() {
            if (!isCameraActive) return;

            // CHECK SECURE CONTEXT
            if (!window.isSecureContext) {
                const msg = "⚠️ NAVEGADOR BLOQUEA CÁMARA: El acceso debe ser por HTTPS para activar la visión artificial.";
                showNotification("ERROR DE SEGURIDAD", msg, "error", 5000);
                // Allow them to continue but warn
                setIsCameraActive(false);
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: cameraFacingMode },
                    audio: false
                });
                streamRef.current = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;
            } catch (err: any) {
                console.error("Camera error:", err);
                const msg = err.name === "NotAllowedError" ? "Permiso de cámara denegado" : "Error de hardware o acceso a cámara";
                showNotification("ERROR DE CÁMARA", msg, "error");
                setIsCameraActive(false);
            }
        }

        startCamera();

        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        };
    }, [isCameraActive, cameraFacingMode]);

    const takePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const context = canvasRef.current.getContext("2d");
            if (context) {
                canvasRef.current.width = videoRef.current.videoWidth;
                canvasRef.current.height = videoRef.current.videoHeight;
                context.drawImage(videoRef.current, 0, 0);
                const dataUrl = canvasRef.current.toDataURL("image/jpeg", 0.85);
                setCapturedPhoto(dataUrl);
                setIsCameraActive(false);
            }
        }
    };

    const toggleCameraFacingMode = () => {
        setCameraFacingMode(prev => prev === "user" ? "environment" : "user");
    };

    // FACE RECOGNITION HELPERS
    const startFaceCamera = async () => {
        if (!window.isSecureContext) {
            showNotification("CONEXIÓN NO SEGURA", "Se requiere HTTPS para el reconocimiento facial neural.", "error");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user" }, // Better for face
                audio: false
            });
            faceStreamRef.current = stream;
            if (faceVideoRef.current) faceVideoRef.current.srcObject = stream;
            setIsFaceCameraActive(true);
        } catch (err) {
            console.error("Face camera error:", err);
            showNotification("ERROR DE CÁMARA", "No se pudo activar el sensor biométrico.", "error");
        }
    };

    const stopFaceCamera = () => {
        if (faceStreamRef.current) {
            faceStreamRef.current.getTracks().forEach(t => t.stop());
            faceStreamRef.current = null;
        }
        if (faceVideoRef.current) faceVideoRef.current.srcObject = null;
        setIsFaceCameraActive(false);
    };

    const captureAndAnalyzeFace = async () => {
        if (!faceVideoRef.current || !faceCanvasRef.current) return;

        setIsAnalyzingFace(true);
        playTactileSound();

        try {
            const canvas = faceCanvasRef.current;
            const video = faceVideoRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.drawImage(video, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

            // Convert dataUrl to Buffer/Uint8Array for action
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);

            const result = await searchByPhotoAction(buffer as any);

            if (result.success) {
                setFaceMatchResult({
                    ...result,
                    capturedImage: dataUrl
                });
                stopFaceCamera();
                if (result.user) {
                    showNotification("SUJETO IDENTIFICADO", `Se ha reconocido a ${result.user.name}`, "success");
                } else if (result.match) {
                    showNotification("COINCIDENCIA EXTERNA", `Reconocido como ${result.match.subject}`, "info");
                } else {
                    showNotification("SIN RESULTADOS", "No se encontraron coincidencias en la base neural.", "info");
                }
            } else {
                showNotification("ERROR DE ANÁLISIS", result.error || "Falla en el motor neural.", "error");
            }

        } catch (err) {
            console.error("Face analysis error:", err);
            showNotification("ERROR CRÍTICO", "Falla al procesar la imagen biométrica.", "error");
        } finally {
            setIsAnalyzingFace(false);
        }
    };

    // Audio recording functions
    const startRecording = async () => {
        if (!window.isSecureContext) {
            const msg = "⚠️ MICRÓFONO BLOQUEADO: Se requiere conexión segura HTTPS para capturar audio de seguridad.";
            showNotification("ERROR DE AUDIO", msg, "error", 5000);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
                setAudioUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err: any) {
            console.error("Mic error:", err);
            const msg = err.name === "NotAllowedError" ? "Permiso de micrófono denegado" : "Error al acceder al micrófono";
            showNotification("ERROR DE MICRÓFONO", msg, "error");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const handleAnnexPanic = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append("type", "ALERTA");
            formData.append("plate", "PÁNICO");
            formData.append("notes", `[ANEXO PÁNICO] ${notes.trim()}`);
            formData.append("name", "ANEXO DE INFORMACIÓN");
            formData.append("guardName", (guardName || "Guardia").trim());

            if (capturedPhoto) {
                const blob = await (await fetch(capturedPhoto)).blob();
                formData.append("photo", blob, "panic_photo.jpg");
            }
            if (audioBlob) {
                formData.append("audio", audioBlob, "panic_audio.webm");
            }

            const finalLocation = myLocation || location;
            if (finalLocation) {
                formData.append("latitude", finalLocation.lat.toString());
                formData.append("longitude", finalLocation.lng.toString());
            }

            await axios.post('/api/bitacora', formData);
            setNotes("");
            setCapturedPhoto(null);
            setAudioBlob(null);
            setAudioUrl(null);
            showNotification("INFORMACIÓN ANEXADA", "Los detalles se han guardado exitosamente.", "success");
        } catch (e) {
            console.error("Error annexing info:", e);
            showNotification("ERROR", "No se pudo guardar la información adicional.", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async () => {
        // Solo validar que haya matrícula
        if (!plate.trim()) {
            showNotification("MATRÍCULA REQUERIDA", "Debe ingresar una matrícula para continuar con el registro.", "error", 2500);
            return;
        }

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append("type", type);
            formData.append("plate", plate.trim());
            formData.append("notes", notes.trim());
            formData.append("name", name.trim());
            formData.append("dni", dni.trim());
            formData.append("company", originType === "EMPRESA" ? company.trim() : originType);
            formData.append("destination", selectedUnit ? selectedUnit.name + (selectedUnit.number ? ` (${selectedUnit.number})` : "") : "");
            formData.append("guardName", guardName.trim());

            const finalLocation = myLocation || location;
            if (finalLocation) {
                formData.append("latitude", finalLocation.lat.toString());
                formData.append("longitude", finalLocation.lng.toString());
            }

            if (capturedPhoto) {
                const res = await fetch(capturedPhoto);
                const blob = await res.blob();
                formData.append("photo", blob, "capture.jpg");
            }

            if (audioBlob) {
                formData.append("audio", audioBlob, "note.webm");
            }

            const newEntry = await createBitacoraEntry(formData);

            setShowSuccessOverlay(true);
            setTimeout(() => {
                setPlate(""); setNotes(""); setName(""); setDni(""); setCompany("");
                setSelectedUnit(null); setUnitSearch("");
                setCapturedPhoto(null);
                setAudioBlob(null);
                setAudioUrl(null);
                setShowSuccessOverlay(false);
            }, 1500);
        } catch (err) {
            console.error("Submit error:", err);
            showNotification("ERROR DE REGISTRO", "No se pudo guardar la información. Intente nuevamente.", "error", 3000);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm("¿Está seguro de eliminar este registro?")) {
            try {
                await deleteBitacoraEntry(id);
                setEntries(prev => prev.filter((e: any) => e.id !== id));
                showNotification("REGISTRO ELIMINADO", "La entrada ha sido removida del historial.", "info");
            } catch (error) {
                showNotification("ERROR AL ELIMINAR", "Hubo un problema al procesar la solicitud.", "error");
            }
        }
    };

    return (
        <div className="h-screen w-screen bg-white text-black flex overflow-hidden font-sans select-none">

            {/* IDENTITY / LOGIN OVERLAY */}
            <AnimatePresence>
                {showIdentityOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] bg-white flex flex-col items-center justify-center p-8"
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="w-full max-w-lg flex flex-col items-center"
                        >
                            {/* Animated Logo Branding */}
                            <motion.div
                                animate={{
                                    scale: [0.98, 1.02, 0.98],
                                    opacity: [0.8, 1, 0.8]
                                }}
                                transition={{
                                    duration: 4,
                                    repeat: Infinity,
                                    ease: "easeInOut"
                                }}
                                className="w-64 h-64 relative mb-12 p-4 flex items-center justify-center bg-white rounded-full shadow-inner"
                            >
                                <Image
                                    src={customLogo || logo || "/logo-transparent.png"}
                                    alt="Logo"
                                    width={200}
                                    height={200}
                                    className="object-contain drop-shadow-xl"
                                    priority
                                />
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                                    className="absolute inset-0 border-t-2 border-r-2 border-[#B20D30]/20 rounded-full"
                                />
                            </motion.div>

                            <div className="bg-white border-2 border-slate-100 transition-all duration-300 p-10 rounded-[4rem] shadow-2xl w-full flex flex-col items-center gap-6">
                                <div className="text-center mb-4">
                                    <div className="flex items-center justify-center gap-3 mb-4">
                                        <div className="w-12 h-12 bg-[#B20D30] rounded-2xl flex items-center justify-center">
                                            <Shield className="text-white" size={24} />
                                        </div>
                                        <h1 className="text-4xl font-black text-black uppercase tracking-tighter">Omniaccess Guard</h1>
                                    </div>
                                    <p className="text-[12px] text-black/40 font-black uppercase tracking-[0.4em]">Consola de Seguridad</p>
                                </div>

                                <div className="w-full max-w-md">
                                    <form onSubmit={handleManualLogin} className="space-y-6">
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">Usuario</label>
                                                <Input
                                                    value={loginUser}
                                                    onChange={(e) => setLoginUser(e.target.value)}
                                                    placeholder="Ingrese su usuario..."
                                                    className="h-16 rounded-2xl bg-slate-50 border-slate-200 font-bold text-lg"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">Contraseña</label>
                                                <Input
                                                    type="password"
                                                    value={loginPass}
                                                    onChange={(e) => setLoginPass(e.target.value)}
                                                    placeholder="Ingrese su clave..."
                                                    className="h-16 rounded-2xl bg-slate-50 border-slate-200 font-bold text-lg"
                                                />
                                            </div>
                                        </div>

                                        <button
                                            type="submit"
                                            className="w-full h-16 bg-[#B20D30] hover:bg-[#d9123c] text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-red-900/20 active:scale-95 transition-all flex items-center justify-center gap-3 text-lg"
                                        >
                                            <LogIn size={24} /> Ingresar
                                        </button>
                                    </form>
                                </div>
                            </div>

                            <p className="mt-12 text-[10px] font-black text-black/20 uppercase tracking-[0.5em]">Security Systems Architecture</p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* LOGO TRANSITION LOADER */}
            <AnimatePresence>
                {isTransitioning && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[120] bg-slate-50 flex flex-col items-center justify-center"
                    >
                        <motion.div
                            animate={{
                                opacity: [0.4, 1, 0.4],
                                scale: [0.95, 1.05, 0.95],
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="w-40 h-40 flex items-center justify-center p-6 mb-4"
                        >
                            <Image src={customLogo || logo || "/logo-transparent.png"} alt="Loading" width={160} height={160} className="object-contain" />
                        </motion.div>
                        <motion.p
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-8 text-[11px] font-black uppercase tracking-[0.4em] text-[#B20D30]"
                        >
                            Cargando {activeTab === "control" ? "Consola" : activeTab === "history" ? "Historial" : "Alertas"}...
                        </motion.p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* SUCCESS OVERLAY ANIMATION */}
            <AnimatePresence>
                {showSuccessOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-[#B20D30] flex flex-col items-center justify-center text-white"
                    >
                        <motion.div
                            initial={{ scale: 0.5, rotate: -45 }}
                            animate={{ scale: 1, rotate: 0 }}
                            className="w-32 h-32 rounded-full border-[6px] border-white flex items-center justify-center mb-6"
                        >
                            <CheckCircle2 size={64} strokeWidth={3} />
                        </motion.div>
                        <motion.h2
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            className="text-4xl font-black uppercase tracking-tighter"
                        >
                            Registro Exitoso
                        </motion.h2>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ALARM ACTIVATION SPLASH - PREMIUM OVERLAY */}
            <AnimatePresence>
                {showAlarmSplash && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[500] bg-[#B20D30] flex flex-col items-center justify-center text-white overflow-hidden"
                    >
                        {/* Dramatic pulsating rings behind the icon */}
                        <motion.div
                            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0.1, 0.3] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                            className="absolute w-[600px] h-[600px] rounded-full border-[1px] border-white/20"
                        />
                        <motion.div
                            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.2, 0.5] }}
                            transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }}
                            className="absolute w-[400px] h-[400px] rounded-full border-[2px] border-white/30"
                        />

                        <motion.div
                            initial={{ scale: 0, rotate: -180 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: "spring", damping: 12 }}
                            className="w-48 h-48 rounded-[3rem] bg-white flex items-center justify-center text-[#B20D30] mb-10 shadow-[0_0_100px_rgba(255,255,255,0.4)] relative z-10"
                        >
                            <Siren size={100} strokeWidth={2.5} className="animate-bounce" />
                        </motion.div>

                        <div className="text-center relative z-10 space-y-4 px-10">
                            <motion.h2
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.2 }}
                                className="text-6xl font-black uppercase tracking-tighter"
                            >
                                Emergencia Activada
                            </motion.h2>
                            <motion.p
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                className="text-xl font-black uppercase tracking-[0.4em] text-white/60"
                            >
                                Centro de Monitoreo Notificado
                            </motion.p>
                        </div>

                        {/* Animated Bottom Bar */}
                        <motion.div
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ duration: 4, ease: "linear" }}
                            className="absolute bottom-0 left-0 right-0 h-4 bg-white/40 origin-left"
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* PANIC / ALERT CRITICAL OVERLAY (Persistent during alert) */}
            <AnimatePresence>
                {isAlertMode && !showAlarmSplash && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[300] bg-red-600/20 backdrop-blur-[2px] flex flex-col items-center justify-center"
                    >
                        <div className="absolute inset-0 border-[20px] border-red-600 animate-pulse pointer-events-none" />
                        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-red-600 to-transparent flex items-center justify-center px-10">
                            <div className="flex items-center gap-6 text-white">
                                <Siren size={48} className="animate-bounce" />
                                <div className="text-center">
                                    <h2 className="text-4xl font-black uppercase tracking-tighter">MODO ALERTA ACTIVO</h2>
                                    <p className="text-sm font-black text-white/80 uppercase tracking-widest mt-1">El centro de monitoreo ha sido notificado</p>
                                </div>
                                <Siren size={48} className="animate-bounce" />
                            </div>
                        </div>

                        {/* CENTRAL DEACTIVATE BUTTON */}
                        <motion.div
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="relative flex flex-col items-center gap-8"
                        >
                            <button
                                onMouseDown={startDeactivateHold}
                                onMouseUp={cancelDeactivateHold}
                                onMouseLeave={cancelDeactivateHold}
                                onTouchStart={startDeactivateHold}
                                onTouchEnd={cancelDeactivateHold}
                                className="w-56 h-56 rounded-full bg-white border-8 border-red-600 shadow-2xl flex flex-col items-center justify-center gap-4 relative overflow-hidden group active:scale-95 transition-transform"
                            >
                                <motion.div
                                    className="absolute bottom-0 left-0 right-0 bg-red-600/10 pointer-events-none"
                                    animate={{ height: `${deactivateHoldProgress}%` }}
                                    transition={{ duration: 0.1 }}
                                />

                                <Shield size={64} className={cn("text-red-600 transition-all duration-300", deactivateHoldProgress > 0 ? "scale-110" : "group-hover:scale-105")} />
                                <div className="text-center px-4 relative z-10">
                                    <p className="text-red-600 font-black text-xs uppercase tracking-widest">Normalizar</p>
                                    <p className="text-red-600 font-black text-[10px] uppercase opacity-40 mt-1">Mantener pulsado</p>
                                </div>

                                {/* Circular progress border */}
                                <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                                    <circle
                                        cx="50"
                                        cy="50"
                                        r="46"
                                        fill="none"
                                        stroke="#dc2626"
                                        strokeWidth="4"
                                        strokeDasharray="289"
                                        strokeDashoffset={289 - (289 * deactivateHoldProgress) / 100}
                                        className="transition-all duration-100"
                                    />
                                </svg>
                            </button>

                            <motion.div
                                animate={{ opacity: [0.4, 1, 0.4] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                                className="px-6 py-2 bg-red-600 text-white rounded-full text-[10px] font-black uppercase tracking-[0.3em] mb-4"
                            >
                                Protocolo de Seguridad Activo
                            </motion.div>

                            {/* PANIC ANNEXING TOOLS */}
                            <div className="flex items-center gap-6 mt-4">
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => setIsOCRActive(true)}
                                    className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-all"
                                >
                                    <Camera size={28} />
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={startRecording}
                                    className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-all"
                                >
                                    <Mic size={28} />
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => {
                                        const note = prompt("Escriba información adicional:");
                                        if (note) setNotes(prev => prev + (prev ? " | " : "") + note);
                                    }}
                                    className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-all"
                                >
                                    <FileText size={28} />
                                </motion.button>
                            </div>

                            {/* PREVIEW OF ANNEXED INFO */}
                            {(capturedPhoto || audioUrl || notes) && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mt-6 flex flex-col items-center gap-4"
                                >
                                    <div className="flex gap-3">
                                        {capturedPhoto && <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg"><Camera size={20} /></div>}
                                        {audioUrl && <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg"><Mic size={20} /></div>}
                                        {notes && <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg"><FileText size={20} /></div>}
                                    </div>
                                    <button
                                        onClick={handleAnnexPanic}
                                        disabled={isSubmitting}
                                        className="px-8 py-3 bg-white text-emerald-600 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                                    >
                                        {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                                        Subir Información
                                    </button>
                                </motion.div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* AUTOCOMPLETE PROMPT MODAL */}
            <AnimatePresence>
                {showMatchPrompt && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="fixed inset-0 z-[150] flex items-center justify-center p-6"
                    >
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm pointer-events-auto"
                            onClick={() => setShowMatchPrompt(false)}
                        />

                        <div className="bg-white border-2 border-[#B20D30] rounded-[2rem] p-10 shadow-[0_40px_120px_rgba(0,0,0,0.15)] max-w-sm w-full relative z-10 pointer-events-auto overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-[#B20D30]/5 rounded-full blur-3xl -mr-16 -mt-16" />

                            <div className="w-16 h-16 bg-[#B20D30]/10 rounded-2xl flex items-center justify-center text-[#B20D30] mb-6 mx-auto relative z-10">
                                <UserCheck size={32} />
                            </div>
                            <h3 className="text-2xl font-black text-center uppercase tracking-tighter mb-4 relative z-10 text-black">¿Autocompletar?</h3>
                            <p className="text-black font-black uppercase text-center text-[11px] font-bold uppercase tracking-widest leading-relaxed mb-10 relative z-10 px-4">
                                Se ha encontrado un registro previo para la matrícula <span className="text-[#B20D30] font-black">{plate}</span>.
                            </p>

                            <div className="space-y-4 relative z-10">
                                <Button onClick={handleAutocomplete} className="w-full h-16 rounded-2xl bg-[#B20D30] hover:bg-[#910a28] text-white font-black uppercase text-[12px] tracking-widest shadow-xl shadow-[#B20D30]/20">
                                    Sí, Cargar Datos
                                </Button>
                                <Button onClick={() => setShowMatchPrompt(false)} variant="ghost" className="w-full h-14 rounded-2xl text-black/40 hover:text-black font-bold uppercase text-[10px] tracking-widest transition-colors">
                                    No, Ingresar Manual
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* MAIN WINDOW */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative pb-24">
                <div className="flex-1 overflow-hidden relative">
                    <AnimatePresence mode="wait">
                        {activeTab === "map" && (
                            <motion.div key="map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full relative z-0">
                                <LiveGuardMap
                                    myLocation={myLocation}
                                    guards={otherGuards}
                                    socketId={socket?.id}
                                    onLongPress={(latlng) => {
                                        setBackupLocation(latlng);
                                        setShowBackupModal(true);
                                        playTactileSound();
                                    }}
                                    backupMissions={monitoringMissions.map(m => ({
                                        ...m,
                                        responderLocation: m.responderId === socket?.id
                                            ? myLocation
                                            : (otherGuards.find(g => g.socketId === m.responderId) || null)
                                    }))}
                                    onAlertClick={(mission) => {
                                        // Any guard can manage if it's PENDING or if they are involved
                                        setActiveMission(mission);
                                        setShowResolutionModal(true);
                                        setBackupDetail(mission.details || "");
                                    }}
                                />
                            </motion.div>
                        )}
                        {activeTab === "face" && (
                            <FaceScannerOverlay
                                onClose={() => handleTabChange("control")}
                                guardName={guardName}
                                location={myLocation}
                                recentEntries={entries}
                                cameraFacingMode={cameraFacingMode}
                                toggleCameraFacingMode={toggleCameraFacingMode}
                            />
                        )}
                        {activeTab === "control" && (
                            <motion.div key="control" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.2 }} className="h-full w-full overflow-y-auto p-4 pr-20 md:p-8 pb-64 custom-scrollbar">

                                <div className="max-w-7xl mx-auto flex flex-col gap-10">
                                    {/* TOP TOGGLE (ENTRY/EXIT) */}
                                    {/* TOP TOGGLE (ENTRY/EXIT) */}
                                    <div className="flex items-center gap-6">
                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() => { playTactileSound(); setType("ENTRY"); }}
                                            className={cn(
                                                "flex-1 h-20 md:h-28 rounded-[1.5rem] md:rounded-[2rem] border-2 flex flex-col items-center justify-center gap-1 md:gap-2 transition-all relative overflow-hidden group",
                                                type === "ENTRY"
                                                    ? "bg-gradient-to-br from-[#B20D30] to-[#E53935] border-[#B20D30] text-white shadow-xl shadow-[#B20D30]/20"
                                                    : "bg-white border-black transition-all duration-300 text-black/40 hover:bg-slate-50"
                                            )}
                                        >
                                            <LogIn size={24} className={cn("md:w-7 md:h-7", type === "ENTRY" ? "text-white" : "text-black/20")} />
                                            <span className="font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] md:tracking-[0.3em]">Registro de Ingreso</span>
                                            {type === "ENTRY" && <div className="absolute top-0 right-0 w-12 h-12 bg-white/10 rounded-full -mr-6 -mt-6" />}
                                        </motion.button>

                                        {/* CENTER LOGO */}
                                        <div className="w-24 h-24 flex items-center justify-center shrink-0">
                                            <Image src={customLogo || logo || "/logo-transparent.png"} alt="Logo" width={100} height={100} className="object-contain drop-shadow-md" />
                                        </div>

                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() => { playTactileSound(); setType("EXIT"); }}
                                            className={cn(
                                                "flex-1 h-20 md:h-28 rounded-[1.5rem] md:rounded-[2rem] border-2 flex flex-col items-center justify-center gap-1 md:gap-2 transition-all relative overflow-hidden group",
                                                type === "EXIT"
                                                    ? "bg-gradient-to-br from-orange-600 to-amber-500 border-orange-600 text-white shadow-xl shadow-orange-600/20"
                                                    : "bg-white border-black transition-all duration-300 text-black/40 hover:bg-slate-50"
                                            )}
                                        >
                                            <LogOut size={24} className={cn("md:w-7 md:h-7", type === "EXIT" ? "text-white" : "text-black/20")} />
                                            <span className="font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] md:tracking-[0.3em]">Registro de Salida</span>
                                            {type === "EXIT" && <div className="absolute top-0 right-0 w-12 h-12 bg-white/10 rounded-full -mr-6 -mt-6" />}
                                        </motion.button>
                                    </div>

                                    {/* CAMERA & CONTROLS */}
                                    <div className="flex flex-col xl:flex-row gap-8">
                                        {/* FORM SECTION (Expanded) */}
                                        <div className="flex-1 space-y-8">
                                            <div className="bg-transparent space-y-10 group transition-all">
                                                <div className="flex flex-col gap-10">
                                                    <div className="flex-1 w-full space-y-6">
                                                        <div className="flex justify-center overflow-hidden py-4">
                                                            <div className="relative flex items-center">
                                                                <TactilePlateInput
                                                                    value={plate}
                                                                    onChange={setPlate}
                                                                    playTactileSound={playTactileSound}
                                                                    onCameraClick={() => { setIsOCRActive(true); playTactileSound(); }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="h-px bg-slate-100" />

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                    <AppField label="Nombre del Visitante" icon={<UserIcon size={14} />} value={name} onChange={setName} placeholder="Visitante..." />
                                                    <AppField label="Cédula / Pasaporte" icon={<FileText size={14} />} value={dni} onChange={setDni} placeholder="Documento..." />

                                                    {originType === "EMPRESA" && (
                                                        <div className="col-span-1 md:col-span-2">
                                                            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                                                                <AppField label="Empresa / Institución" icon={<Briefcase size={14} />} value={company} onChange={setCompany} placeholder="Nombre de la empresa..." />
                                                            </motion.div>
                                                        </div>
                                                    )}

                                                    <div className="col-span-1 md:col-span-2 space-y-3 pt-2 relative">
                                                        <Label className="text-[10px] font-black uppercase text-black font-black uppercase tracking-widest flex items-center gap-1.5 ml-1">
                                                            <Building2 size={14} /> Unidad de Destino
                                                        </Label>

                                                        <motion.button
                                                            whileHover={{ scale: 1.01 }}
                                                            whileTap={{ scale: 0.99 }}
                                                            onClick={() => setShowUnitPicker(true)}
                                                            className={cn(
                                                                "w-full h-16 md:h-24 rounded-[1.5rem] md:rounded-[2rem] border border-black/20 flex items-center justify-between px-6 md:px-8 transition-all relative overflow-hidden group",
                                                                selectedUnit
                                                                    ? "bg-[#B20D30]/5 border-[#B20D30] shadow-lg shadow-[#B20D30]/5"
                                                                    : "bg-white border-black transition-all duration-300"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-4 md:gap-6">
                                                                <div className={cn(
                                                                    "w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl flex items-center justify-center transition-colors",
                                                                    selectedUnit ? "bg-[#B20D30] text-white" : "bg-slate-100 text-black/20"
                                                                )}>
                                                                    <Home size={20} className="md:w-6 md:h-6" />
                                                                </div>
                                                                <div className="text-left">
                                                                    {selectedUnit ? (
                                                                        <>
                                                                            <p className="text-base md:text-xl font-black text-black uppercase tracking-tight">{selectedUnit.name}</p>
                                                                            <p className="text-[9px] md:text-[10px] font-black text-[#B20D30] uppercase tracking-widest">{selectedUnit.number || "LT"}</p>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <p className="text-sm md:text-lg font-black text-black/30 uppercase tracking-tighter">Pendiente Seleccionar</p>
                                                                            <p className="text-[8px] md:text-[9px] font-black text-black/20 uppercase tracking-widest">Toca para abrir el panel de unidades</p>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className={cn(
                                                                "w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-all",
                                                                selectedUnit ? "bg-[#B20D30]/10 text-[#B20D30]" : "bg-slate-50 text-black/10"
                                                            )}>
                                                                <ChevronRight size={16} className="md:w-5 md:h-5" />
                                                            </div>
                                                        </motion.button>
                                                    </div>

                                                    <div className="col-span-1 md:col-span-2 space-y-4">
                                                        <Label className="text-[11px] font-black uppercase text-black font-black uppercase tracking-[0.2em] ml-2">Observaciones</Label>
                                                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo de visita..." className="w-full h-28 bg-white border border-black/20 transition-all duration-300 rounded-2xl p-6 text-sm text-black font-bold placeholder:text-black/30 focus:border-[#B20D30]/50 resize-none transition-all shadow-sm" />
                                                    </div>
                                                </div>

                                                <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-4">
                                                    {/* MEDIA PREVIEWS */}
                                                    <div className="flex items-center gap-4">
                                                        {capturedPhoto && (
                                                            <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-[#B20D30] shadow-lg group">
                                                                <Image src={capturedPhoto} alt="Preview" fill className="object-cover" />
                                                                <button onClick={() => setCapturedPhoto(null)} className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {audioUrl && (
                                                            <div className="flex items-center gap-3 bg-emerald-50 border-2 border-emerald-500/20 px-4 py-3 rounded-2xl shadow-sm">
                                                                <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                                                                    <Volume2 size={16} />
                                                                </div>
                                                                <div className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Audio Grabado</div>
                                                                <button onClick={() => { setAudioUrl(null); setAudioBlob(null); }} className="text-emerald-500/40 hover:text-red-500 transition-colors">
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {!capturedPhoto && !audioUrl && (
                                                            <div className="flex items-center gap-3 bg-slate-50 border border-dashed border-black/20 transition-all duration-300 px-6 py-4 rounded-2xl">
                                                                <CameraOff size={16} className="text-black/10" />
                                                                <span className="text-[9px] font-black text-black/20 uppercase tracking-[0.2em]">Sin Adjuntos Multimedia</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* CAMERA OVERLAY - REPLACED BY OCR */}
                                <AnimatePresence>
                                    {isOCRActive && (
                                        <OCRScanner
                                            onDetected={handleOCRDetected}
                                            onClose={() => setIsOCRActive(false)}
                                            cameraFacingMode={cameraFacingMode}
                                            toggleCameraFacingMode={toggleCameraFacingMode}
                                        />
                                    )}
                                </AnimatePresence>

                                {/* UNIT PICKER OVERLAY */}
                                <AnimatePresence>
                                    {showUnitPicker && (
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="fixed inset-0 bg-black/98 backdrop-blur-3xl z-[250] flex items-center justify-center p-6 md:p-12 lg:p-20"
                                        >
                                            <div className="w-full max-w-7xl h-full flex flex-col gap-10">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-8">
                                                        <div className="w-20 h-20 rounded-[2.5rem] bg-[#B20D30] flex items-center justify-center text-white shadow-[0_20px_60px_rgba(178,13,48,0.4)]">
                                                            <Home size={40} />
                                                        </div>
                                                        <div>
                                                            <h2 className="text-5xl font-black text-white uppercase tracking-tighter">Unidades y Lotes</h2>
                                                            <p className="text-sm font-black text-white/50 uppercase tracking-[0.4em] mt-3">Seleccione el punto de destino final</p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => setShowUnitPicker(false)}
                                                        className="w-20 h-20 bg-white hover:bg-[#B20D30] rounded-[2.5rem] flex items-center justify-center text-black hover:text-white transition-all duration-500 border-2 border-white group"
                                                    >
                                                        <X size={40} className="group-hover:rotate-90 transition-transform duration-500" />
                                                    </button>
                                                </div>

                                                <div className="flex items-center gap-10">
                                                    <Search className="text-white/30" size={32} />
                                                    <Input
                                                        value={unitSearch}
                                                        onChange={(e) => setUnitSearch(e.target.value)}
                                                        placeholder="ESCRIBE PARA BUSCAR LOTE O CASA..."
                                                        className="flex-1 h-20 bg-white/5 border-2 border-white/10 rounded-[2rem] text-3xl font-black text-white placeholder:text-white/20 px-10 focus:border-[#B20D30] transition-all"
                                                    />
                                                </div>

                                                <div className="flex-1 overflow-y-auto pr-6 custom-scrollbar grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-8 pb-10">
                                                    {units.filter(u => u.name.toLowerCase().includes(unitSearch.toLowerCase()) || (u.number && u.number.toLowerCase().includes(unitSearch.toLowerCase()))).map((u) => (
                                                        <motion.button
                                                            key={u.id}
                                                            whileHover={{ scale: 1.05, y: -10 }}
                                                            whileTap={{ scale: 0.95 }}
                                                            onClick={() => {
                                                                setSelectedUnit(u);
                                                                setShowUnitPicker(false);
                                                                playTactileSound();

                                                                // AUTO-FILL LOGIC
                                                                const vehicles: any[] = [];
                                                                if (u.users) {
                                                                    u.users.forEach((user: any) => {
                                                                        if (user.vehicles) {
                                                                            user.vehicles.forEach((v: any) => vehicles.push({ ...v, ownerName: user.name }));
                                                                        }
                                                                    });
                                                                }

                                                                if (vehicles.length > 0) {
                                                                    setAvailableVehicles(vehicles);
                                                                    setShowVehiclePrompt(true);
                                                                }
                                                            }}
                                                            className={cn(
                                                                "min-h-[220px] rounded-[3rem] border-2 flex flex-col items-center justify-center gap-6 transition-all relative overflow-hidden group",
                                                                selectedUnit?.id === u.id
                                                                    ? "bg-white border-white text-black shadow-[0_30px_90px_rgba(255,255,255,0.2)]"
                                                                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:border-white/30"
                                                            )}
                                                        >
                                                            <div className={cn(
                                                                "w-16 h-16 rounded-3xl flex items-center justify-center transition-all duration-500",
                                                                selectedUnit?.id === u.id ? "bg-[#B20D30] text-white" : "bg-white/5 group-hover:bg-white/10"
                                                            )}>
                                                                <Home size={32} />
                                                            </div>
                                                            <div className="text-center px-6">
                                                                <p className={cn(
                                                                    "text-2xl font-black uppercase tracking-tighter leading-none break-words line-clamp-2 transition-colors",
                                                                    selectedUnit?.id === u.id ? "text-black" : "text-white"
                                                                )}>{u.name}</p>
                                                                <p className={cn(
                                                                    "text-xs font-black uppercase tracking-widest mt-4 transition-colors",
                                                                    selectedUnit?.id === u.id ? "text-[#B20D30]" : "text-white/30"
                                                                )}>{u.number || "RESIDENCIA"}</p>
                                                            </div>
                                                            {selectedUnit?.id === u.id && (
                                                                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-6 right-6 text-[#B20D30]">
                                                                    <CheckCircle2 size={24} fill="currentColor" stroke="white" strokeWidth={3} />
                                                                </motion.div>
                                                            )}
                                                        </motion.button>
                                                    ))}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* ORIGIN PICKER OVERLAY */}
                                <AnimatePresence>
                                    {showOriginPicker && (
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="fixed inset-0 bg-black/98 backdrop-blur-3xl z-[250] flex items-center justify-center p-6 md:p-12 lg:p-20"
                                        >
                                            <div className="w-full max-w-5xl flex flex-col gap-10">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-8">
                                                        <div className="w-20 h-20 rounded-[2.5rem] bg-[#B20D30] flex items-center justify-center text-white shadow-[0_20px_60px_rgba(178,13,48,0.4)]">
                                                            <Activity size={40} />
                                                        </div>
                                                        <div>
                                                            <h2 className="text-5xl font-black text-white uppercase tracking-tighter">Clasificación de Origen</h2>
                                                            <p className="text-sm font-black text-white/50 uppercase tracking-[0.4em] mt-3">Indique el tipo de visitante o entidad</p>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => setShowOriginPicker(false)}
                                                        className="w-20 h-20 bg-white hover:bg-[#B20D30] rounded-[2.5rem] flex items-center justify-center text-black hover:text-white transition-all duration-500 border-2 border-white"
                                                    >
                                                        <X size={40} />
                                                    </button>
                                                </div>

                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
                                                    <OriginPickerButton active={originType === "PARTICULAR"} onClick={() => { setOriginType("PARTICULAR"); setShowOriginPicker(false); playTactileSound(); }} icon={<UserCheck size={32} />} label="Particular" sub="Visita Residencial" />
                                                    <OriginPickerButton active={originType === "EMPRESA"} onClick={() => { setOriginType("EMPRESA"); setShowOriginPicker(false); playTactileSound(); }} icon={<Briefcase size={32} />} label="Empresa" sub="Servicios / Delivery" />
                                                    <OriginPickerButton active={originType === "IMM"} onClick={() => { setOriginType("IMM"); setShowOriginPicker(false); playTactileSound(); }} icon={<Landmark size={32} />} label="IMM" sub="Gobierno / Intendencia" />
                                                    <OriginPickerButton active={originType === "POLICIA"} onClick={() => { setOriginType("POLICIA"); setShowOriginPicker(false); playTactileSound(); }} icon={<Shield size={32} />} label="Policía" sub="Seguridad / Oficial" />
                                                    <OriginPickerButton active={originType === "BOMBEROS"} onClick={() => { setOriginType("BOMBEROS"); setShowOriginPicker(false); playTactileSound(); }} icon={<Flame size={32} />} label="Bomberos" sub="Emergencia Fuego" />
                                                    <OriginPickerButton active={originType === "AMBULANCIA"} onClick={() => { setOriginType("AMBULANCIA"); setShowOriginPicker(false); playTactileSound(); }} icon={<Plus size={32} />} label="Ambulancia" sub="Emergencia Médica" />
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* CONTROL BAR (Classification, Unit, Vehicle, Media, Finish) */}
                                <div className="fixed top-1/2 -translate-y-1/2 right-2 md:right-6 z-[90]">
                                    <div className={cn(
                                        "flex flex-col gap-2 md:gap-3 p-2 md:p-3 rounded-[2rem] md:rounded-[3rem] border shadow-[0_10px_60px_-10px_rgba(0,0,0,0.15)] ring-1 ring-black/5 transition-all duration-500",
                                        isAlertMode
                                            ? "bg-red-600 border-red-400 animate-pulse shadow-[0_0_50px_rgba(220,38,38,0.5)]"
                                            : "bg-white/40 backdrop-blur-2xl border-white/40"
                                    )}>


                                        {/* Panic Button REMOVED from Sidebar - Moved to Footer Center */}
                                        {/* <div className="relative">...</div> */}
                                        {/* <div className={cn("h-px mx-2", isAlertMode ? "bg-white/20" : "bg-black/10")} /> */}


                                        {/* Classification Button - Dynamic Icon */}
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => setShowOriginPicker(true)}
                                            className="w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex items-center justify-center transition-all text-black/60 hover:text-black"
                                        >
                                            {originType === "PARTICULAR" && <UserCheck size={20} className="md:w-5.5 md:h-5.5" />}
                                            {originType === "EMPRESA" && <Briefcase size={20} className="md:w-5.5 md:h-5.5" />}
                                            {originType === "IMM" && <Landmark size={20} className="md:w-5.5 md:h-5.5" />}
                                            {originType === "POLICIA" && <Shield size={20} className="md:w-5.5 md:h-5.5" />}
                                            {originType === "BOMBEROS" && <Flame size={20} className="md:w-5.5 md:h-5.5" />}
                                            {originType === "AMBULANCIA" && <Plus size={20} className="md:w-5.5 md:h-5.5" />}
                                        </motion.button>

                                        {/* Unit Picker Button - Dynamic Icon/Number */}
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => setShowUnitPicker(true)}
                                            className="w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex items-center justify-center transition-all text-black/60 hover:text-black relative"
                                        >
                                            {selectedUnit ? (
                                                <span className="text-sm md:text-lg font-black">{selectedUnit.number || selectedUnit.name.substring(0, 2)}</span>
                                            ) : (
                                                <Building2 size={20} className="md:w-5.5 md:h-5.5" />
                                            )}
                                        </motion.button>

                                        <div className="h-px bg-black/10 mx-2" />

                                        {/* Auto Button */}
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => { playTactileSound(); setVehicleType("AUTO"); }}
                                            className={cn(
                                                "w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex flex-col items-center justify-center gap-0.5 md:gap-1 transition-all",
                                                vehicleType === "AUTO"
                                                    ? "text-[#B20D30]"
                                                    : "text-black/20 hover:text-black"
                                            )}
                                        >
                                            <Car size={18} className="md:w-5 md:h-5" />
                                            <span className="text-[6px] md:text-[7px] font-black uppercase tracking-tighter">Auto</span>
                                        </motion.button>

                                        {/* Moto Button */}
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => { playTactileSound(); setVehicleType("MOTO"); }}
                                            className={cn(
                                                "w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex flex-col items-center justify-center gap-0.5 md:gap-1 transition-all",
                                                vehicleType === "MOTO"
                                                    ? "text-[#B20D30]"
                                                    : "text-black/20 hover:text-black"
                                            )}
                                        >
                                            <Bike size={18} className="md:w-5 md:h-5" />
                                            <span className="text-[6px] md:text-[7px] font-black uppercase tracking-tighter">Moto</span>
                                        </motion.button>

                                        <div className="h-px bg-black/10 mx-2" />

                                        {/* Camera Button - Fixed Dark Background */}
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => setIsOCRActive(true)}
                                            className="w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex items-center justify-center transition-all bg-slate-800 text-white hover:bg-slate-700"
                                        >
                                            <Camera size={20} className="md:w-5.5 md:h-5.5" />
                                        </motion.button>

                                        {/* Audio Recording Button - Fixed Dark Background */}
                                        <AudioRecordingFloatingButton
                                            isRecording={isRecording}
                                            audioUrl={audioUrl}
                                            onStart={startRecording}
                                            onStop={stopRecording}
                                            onClear={() => { setAudioUrl(null); setAudioBlob(null); }}
                                        />

                                        <div className="h-px bg-black/10 mx-2" />

                                        {/* Finish Button - Highlighted */}
                                        {/* Finish Button - Highlighted */}
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            disabled={isSubmitting || !plate.trim()}
                                            onClick={() => { playTactileSound(); handleSubmit(); }}
                                            className={cn(
                                                "w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex items-center justify-center transition-all shadow-lg",
                                                type === "ENTRY" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white",
                                                "disabled:opacity-30 disabled:cursor-not-allowed"
                                            )}
                                        >
                                            {isSubmitting ? <Loader2 className="animate-spin" size={22} /> : <CheckCircle2 size={24} />}
                                        </motion.button>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {activeTab === "alerts" && (
                            <motion.div key="alerts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="h-full w-full overflow-y-auto px-8 pt-6 pb-40 custom-scrollbar">
                                <div className="max-w-7xl mx-auto space-y-6">
                                    {/* HEADER + FILTER ICONS */}
                                    <div className="flex items-center justify-between sticky top-0 bg-slate-50/95 backdrop-blur-md py-4 z-30">
                                        <div>
                                            <h2 className="text-3xl font-black uppercase tracking-tighter text-black leading-none">Eventos Críticos</h2>
                                            <p className="text-[10px] text-[#B20D30] font-black uppercase tracking-[0.3em] mt-2">Registro de activación de botón de pánico</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setShowAlertsFilterModal(true); playTactileSound(); }}
                                                className="w-12 h-12 rounded-2xl bg-white border border-black/10 flex items-center justify-center text-black/40 hover:text-[#B20D30] hover:border-[#B20D30]/30 transition-all shadow-sm">
                                                <Search size={20} />
                                            </motion.button>
                                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setShowAlertsFilterModal(true); playTactileSound(); }}
                                                className="w-12 h-12 rounded-2xl bg-white border border-black/10 flex items-center justify-center text-black/40 hover:text-[#B20D30] hover:border-[#B20D30]/30 transition-all shadow-sm">
                                                <Calendar size={20} />
                                            </motion.button>
                                        </div>
                                    </div>

                                    {/* FILTER MODAL */}
                                    <AnimatePresence>
                                        {showAlertsFilterModal && (
                                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowAlertsFilterModal(false)}>
                                                <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl space-y-6" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center justify-between">
                                                        <h3 className="text-xl font-black uppercase tracking-tighter">Filtros</h3>
                                                        <button onClick={() => setShowAlertsFilterModal(false)} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><X size={20} /></button>
                                                    </div>
                                                    <div className="space-y-4">
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest">Fecha</label>
                                                            <Input type="date" value={alertsDate} onChange={(e) => setAlertsDate(e.target.value)} className="h-14 bg-slate-50 border-slate-200 rounded-2xl font-black text-sm" />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest">Operario</label>
                                                            <Input placeholder="Buscar operario..." value={alertsSearch} onChange={(e) => setAlertsSearch(e.target.value)} className="h-14 bg-slate-50 border-slate-200 rounded-2xl font-black text-sm" />
                                                        </div>
                                                    </div>
                                                    <Button onClick={() => setShowAlertsFilterModal(false)} className="w-full h-14 rounded-2xl bg-[#B20D30] hover:bg-[#910a28] text-white font-black uppercase tracking-widest">Aplicar</Button>
                                                </motion.div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* ALERT CARDS */}
                                    <div className="space-y-4">
                                        {(() => {
                                            const alertArr = entries.filter(e => {
                                                const isAlertType = e.type.includes("ALERTA");
                                                const matchesSearch = !alertsSearch || (e.guardName || "").toLowerCase().includes(alertsSearch.toLowerCase());
                                                const alertDate = new Date(e.timestamp || e.createdAt).toISOString().split('T')[0];
                                                const matchesDate = !alertsDate || alertDate === alertsDate;
                                                return isAlertType && matchesSearch && matchesDate;
                                            });

                                            if (alertArr.length === 0) return (
                                                <div className="py-32 flex flex-col items-center gap-6 opacity-20 text-black">
                                                    <Shield size={80} />
                                                    <p className="text-xl font-black uppercase tracking-[0.5em]">Historial de Alertas Limpio</p>
                                                </div>
                                            );

                                            return alertArr.map((alert) => {
                                                if (alert.type !== "ALERTA") return null;
                                                if (alert.plate === "NORMAL" || alert.plate === "Manual") return null;
                                                const deactivationEvent = entries.find(e => e.type === "ALERTA" && (e.plate === "NORMAL" || e.plate === "Manual") && new Date(e.timestamp || e.createdAt).getTime() > new Date(alert.timestamp || alert.createdAt).getTime());
                                                let duration = "---"; let isStillActive = false;
                                                if (deactivationEvent) { const diff = new Date(deactivationEvent.timestamp || deactivationEvent.createdAt).getTime() - new Date(alert.timestamp || alert.createdAt).getTime(); duration = `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`; }
                                                else { duration = "ACTIVA"; isStillActive = true; }
                                                const isSOS = alert.plate === "SOS";

                                                return (
                                                    <motion.button key={alert.id} whileTap={{ scale: 0.98 }} onClick={() => setSelectedEntry(alert)}
                                                        className="w-full bg-white rounded-[1.5rem] border border-slate-100 p-6 flex items-center gap-6 hover:shadow-lg transition-all text-left group active:bg-slate-50">
                                                        <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-sm", isSOS ? "bg-orange-100 text-orange-600" : isStillActive ? "bg-red-600 text-white animate-pulse" : "bg-red-100 text-red-600")}>
                                                            <Siren size={24} />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-black uppercase text-black truncate">{alert.guardName || "Sistema"}</p>
                                                            <p className={cn("text-[10px] font-black uppercase tracking-wider", isSOS ? "text-orange-600" : "text-red-600")}>{isSOS ? "Informó Sospechoso" : isStillActive ? "Alerta Activa" : "Alerta Resuelta"}</p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <div className={cn("px-3 py-1 rounded-lg text-[10px] font-black inline-block mb-1", isStillActive ? "bg-red-600 text-white animate-pulse" : "bg-emerald-50 text-emerald-600")}>{duration}</div>
                                                            <p className="text-[10px] font-bold text-black/40">{new Date(alert.timestamp || alert.createdAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</p>
                                                        </div>
                                                        <ChevronRight size={16} className="text-black/10 group-hover:text-black/30 shrink-0" />
                                                    </motion.button>
                                                );
                                            }).filter(Boolean);
                                        })()}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                        {activeTab === "lpr" && (
                            <motion.div key="lpr" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full w-full overflow-y-auto px-8 pt-6 pb-40 custom-scrollbar">
                                <div className="max-w-7xl mx-auto space-y-6">
                                    <div className="flex items-center justify-between sticky top-0 bg-slate-50/95 backdrop-blur-md py-4 z-30">
                                        <div>
                                            <h2 className="text-3xl font-black uppercase tracking-tighter text-black leading-none">Historial LPR</h2>
                                            <p className="text-[10px] text-[#B20D30] font-black uppercase tracking-[0.3em] mt-2">Reconocimiento automático de matrículas</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setShowLprFilterModal(true); playTactileSound(); }} className="w-12 h-12 rounded-2xl bg-white border border-black/10 flex items-center justify-center text-black/40 hover:text-[#B20D30] hover:border-[#B20D30]/30 transition-all shadow-sm"><Search size={20} /></motion.button>
                                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setShowLprFilterModal(true); playTactileSound(); }} className="w-12 h-12 rounded-2xl bg-white border border-black/10 flex items-center justify-center text-black/40 hover:text-[#B20D30] hover:border-[#B20D30]/30 transition-all shadow-sm"><Calendar size={20} /></motion.button>
                                        </div>
                                    </div>
                                    <AnimatePresence>
                                        {showLprFilterModal && (
                                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowLprFilterModal(false)}>
                                                <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl space-y-6" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center justify-between">
                                                        <h3 className="text-xl font-black uppercase tracking-tighter">Filtros LPR</h3>
                                                        <button onClick={() => setShowLprFilterModal(false)} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><X size={20} /></button>
                                                    </div>
                                                    <div className="space-y-4">
                                                        <div className="space-y-2"><label className="text-[10px] font-black uppercase text-black/40 tracking-widest">Fecha</label><Input type="date" value={lprDate} onChange={(e) => setLprDate(e.target.value)} className="h-14 bg-slate-50 border-slate-200 rounded-2xl font-black text-sm" /></div>
                                                        <div className="space-y-2"><label className="text-[10px] font-black uppercase text-black/40 tracking-widest">Matrícula</label><Input placeholder="Buscar matrícula..." value={lprSearch} onChange={(e) => setLprSearch(e.target.value)} className="h-14 bg-slate-50 border-slate-200 rounded-2xl font-black text-sm" /></div>
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest">Dirección</label>
                                                            <div className="flex gap-2">
                                                                {(["ALL", "ENTRY", "EXIT"] as const).map(dir => (
                                                                    <button key={dir} onClick={() => setLprDirection(dir)} className={cn("flex-1 h-14 rounded-2xl font-black text-sm uppercase tracking-wider transition-all border", lprDirection === dir ? dir === "ENTRY" ? "bg-emerald-500 text-white border-emerald-500" : dir === "EXIT" ? "bg-orange-500 text-white border-orange-500" : "bg-[#B20D30] text-white border-[#B20D30]" : "bg-slate-50 text-black/40 border-slate-200 hover:border-slate-300")}>
                                                                        {dir === "ALL" ? "Todos" : dir === "ENTRY" ? "Entrada" : "Salida"}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Button onClick={() => setShowLprFilterModal(false)} className="w-full h-14 rounded-2xl bg-[#B20D30] hover:bg-[#910a28] text-white font-black uppercase tracking-widest">Aplicar</Button>
                                                </motion.div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                    <div className="space-y-4">
                                        {isLprLoading ? (
                                            <div className="py-32 flex flex-col items-center gap-6 opacity-20"><Loader2 className="animate-spin" size={60} /><p className="text-xl font-black uppercase tracking-[0.5em]">Cargando Eventos LPR...</p></div>
                                        ) : lprEntries.length > 0 ? (
                                            lprEntries.map((event) => {
                                                const vehicle = event.user?.vehicles?.find((v: any) => v.plate?.replace(/[^A-Z0-9]/gi, '') === (event.plateDetected || "").replace(/[^A-Z0-9]/gi, ''));
                                                return (
                                                    <motion.button key={event.id} whileTap={{ scale: 0.98 }} onClick={() => setViewerData({ url: event.snapshotPath || "", plate: event.plateDetected, name: event.user?.name, unit: event.user?.unit?.name, direction: event.direction, confidence: event.confidence, timestamp: event.timestamp, deviceName: event.device?.name, vehicleBrand: vehicle?.brand, vehicleModel: vehicle?.model })} className="w-full bg-white rounded-[1.5rem] border border-slate-100 p-5 flex items-center gap-5 hover:shadow-lg transition-all text-left group active:bg-slate-50">
                                                        <div className="w-16 h-16 rounded-2xl bg-slate-100 overflow-hidden relative border border-black/5 shrink-0">
                                                            {event.snapshotPath ? (<Image src={event.snapshotPath} alt="LPR" fill className="object-cover" />) : (<div className="w-full h-full flex items-center justify-center text-slate-300"><ScanFace size={20} /></div>)}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-sm font-black text-black uppercase tracking-tighter">{event.plateDetected || "--- ---"}</span>
                                                                <span className={cn("px-2 py-0.5 rounded-md text-[9px] font-black uppercase", event.direction === "ENTRY" ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>{event.direction === "ENTRY" ? "Ingreso" : "Egreso"}</span>
                                                            </div>
                                                            <p className="text-xs font-bold text-black/60 truncate">{event.user?.name || "No Identificado"} {event.user?.unit?.name ? `· ${event.user.unit.name}` : ""}</p>
                                                            {vehicle && <p className="text-[10px] text-black/30 font-bold">{`${vehicle.brand || ""} ${vehicle.model || ""}`.trim()}</p>}
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="text-xs font-bold text-black">{new Date(event.timestamp).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' })}</p>
                                                            <p className="text-[10px] font-black text-black/40">{new Date(event.timestamp).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</p>
                                                        </div>
                                                        <ChevronRight size={16} className="text-black/10 group-hover:text-black/30 shrink-0" />
                                                    </motion.button>
                                                );
                                            })
                                        ) : (
                                            <div className="py-32 flex flex-col items-center gap-6 opacity-20"><Search size={80} /><p className="text-xl font-black uppercase tracking-[0.5em]">No se encontraron registros</p></div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                        {activeTab === "history" && (
                            <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full w-full overflow-y-auto px-8 pt-6 pb-40 custom-scrollbar">
                                <div className="max-w-7xl mx-auto space-y-8">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between sticky top-0 bg-slate-50/95 backdrop-blur-md py-6 z-30 gap-6">
                                        <div>
                                            <h2 className="text-3xl font-black uppercase tracking-tighter text-black leading-none">Bitácora Digital</h2>
                                            <p className="text-[10px] text-black/40 font-black uppercase tracking-[0.3em] mt-2">Registros de ingreso y salida en tiempo real</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="relative">
                                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30" size={20} />
                                                <Input
                                                    placeholder="FILTRAR POR MATRÍCULA..."
                                                    className="pl-12 h-14 w-80 bg-white/40 backdrop-blur-md border border-black transition-all duration-300 rounded-2xl font-black text-xs uppercase tracking-widest transition-all focus:border-[#B20D30]/50 shadow-sm"
                                                    value={historySearch}
                                                    onChange={(e) => {
                                                        setHistorySearch(e.target.value);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="w-full">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                            {entries.map((entry) => (
                                                <motion.button
                                                    key={entry.id}
                                                    whileTap={{ scale: 0.98 }}
                                                    onClick={() => setSelectedEntry(entry)}
                                                    className="bg-white rounded-[2rem] border-2 border-slate-100 p-6 flex flex-col gap-5 hover:shadow-xl transition-all text-left group relative overflow-hidden"
                                                >
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-20 h-20 rounded-[1.5rem] bg-slate-50 overflow-hidden relative border border-black/5 shadow-inner">
                                                                {entry.photoPath ? (
                                                                    <Image src={entry.photoPath} alt="Entry" fill className="object-cover group-hover:scale-110 transition-transform duration-500" />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center text-black/10">
                                                                        <Camera size={32} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className="px-3 py-1 bg-black text-white rounded-lg text-lg font-black uppercase tracking-widest font-mono shadow-lg shadow-black/20">
                                                                        {entry.plate || "S/N"}
                                                                    </span>
                                                                    {entry.type === "ALERTA" ? (
                                                                        <Badge className="bg-red-600 text-white font-black animate-pulse border-none text-[10px]">ALERTA</Badge>
                                                                    ) : (
                                                                        <Badge className={cn("font-black text-[10px] border-none", entry.type === "ENTRY" ? "bg-indigo-600 text-white" : "bg-orange-600 text-white")}>
                                                                            {entry.type === "ENTRY" ? "INGRESO" : "SALIDA"}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <p className="text-xs font-black text-black/40 uppercase tracking-widest">
                                                                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(entry.timestamp).toLocaleDateString()}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-4">
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                                                                <p className="text-[10px] font-black text-black/30 uppercase tracking-widest mb-1 flex items-center gap-1.5"><UserIcon size={12} /> Sujeto</p>
                                                                <p className="text-xs font-black text-black truncate uppercase">{entry.name || "Reservado"}</p>
                                                                <p className="text-[10px] font-bold text-black/40 uppercase">{entry.dni || "N/A"}</p>
                                                            </div>
                                                            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                                                                <p className="text-[10px] font-black text-black/30 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Home size={12} /> Destino</p>
                                                                <p className="text-xs font-black text-[#B20D30] truncate uppercase">{entry.destination || "---"}</p>
                                                            </div>
                                                        </div>

                                                        <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 flex items-center justify-between">
                                                            <div className="flex flex-col">
                                                                <p className="text-[10px] font-black text-black/30 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Camera size={12} /> Cámara / Origen</p>
                                                                <p className="text-xs font-black text-black uppercase truncate">
                                                                    {entry.accessEvent?.device?.name || "Registro Manual"}
                                                                </p>
                                                            </div>
                                                            {entry.audioPath && (
                                                                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                                                    <Volume2 size={16} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                                                        <span className="text-[8px] font-black text-black/20 uppercase tracking-[0.3em]">Operador: {entry.guardName || "---"}</span>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                                                                className="w-10 h-10 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-all flex items-center justify-center"
                                                            >
                                                                <Trash2 size={16} /> Eliminar Registro
                                                            </button>
                                                            <ChevronRight size={16} className="text-black/10 group-hover:text-black/30 group-hover:translate-x-1 transition-all" />
                                                        </div>
                                                    </div>
                                                </motion.button>
                                            ))}
                                        </div>

                                        {/* Infinite Scroll Load More Trigger */}
                                        <div ref={loadMoreRef} className="py-20 flex justify-center w-full">
                                            {isHistoryLoading && <Loader2 className="animate-spin text-[#B20D30]" size={32} />}
                                            {!hasMoreHistory && !isHistoryLoading && (
                                                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-black/20">Fin de la bitácora</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )
                        }
                    </AnimatePresence >

                </div >

                {/* ENTRY DETAIL DRAWER */}
                <AnimatePresence>
                    {selectedEntry && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm" onClick={() => setSelectedEntry(null)}>
                            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 300 }} className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
                                {/* Header */}
                                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl border-b border-slate-100 p-6 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xl font-black uppercase tracking-tighter text-black">Detalle de Registro</h3>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-black/30 mt-1">
                                            {selectedEntry.timestamp ? new Date(selectedEntry.timestamp).toLocaleString('es-UY') : '---'}
                                        </p>
                                    </div>
                                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSelectedEntry(null)} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><X size={20} /></motion.button>
                                </div>

                                <div className="p-6 space-y-6">
                                    {/* Photo */}
                                    {selectedEntry.photoPath && (
                                        <div className="w-full aspect-video rounded-2xl bg-slate-100 overflow-hidden relative border border-black/5">
                                            <Image src={selectedEntry.photoPath} alt="Foto" fill className="object-cover" />
                                        </div>
                                    )}

                                    <div className="flex items-center gap-3 flex-wrap">
                                        {(() => {
                                            const isPanic = selectedEntry.type === "ALERTA" && selectedEntry.plate === "PÁNICO";
                                            const isSos = selectedEntry.type === "ALERTA" && selectedEntry.plate === "SOS";
                                            const isDeactivation = selectedEntry.type === "ALERTA" && (selectedEntry.plate === "NORMAL" || selectedEntry.plate === "Manual");

                                            if (isPanic) return (
                                                <div className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl shadow-lg shadow-red-600/20 animate-pulse">
                                                    <Siren size={20} />
                                                    <span className="text-xl font-black uppercase tracking-tighter">Pánico Crítico</span>
                                                </div>
                                            );
                                            if (isSos) return (
                                                <div className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl shadow-lg shadow-orange-500/20">
                                                    <ShieldAlert size={20} />
                                                    <span className="text-xl font-black uppercase tracking-tighter">Reporte S.O.S</span>
                                                </div>
                                            );
                                            if (isDeactivation) return (
                                                <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 border-2 border-slate-200 rounded-xl">
                                                    <CheckCircle2 size={20} />
                                                    <span className="text-xl font-black uppercase tracking-tighter">Manual</span>
                                                </div>
                                            );

                                            return (
                                                <>
                                                    {selectedEntry.plate && (
                                                        <div className="px-4 py-2 bg-slate-100 border-2 border-slate-200 rounded-xl">
                                                            <span className="text-2xl font-black text-black uppercase tracking-tighter">{selectedEntry.plate}</span>
                                                        </div>
                                                    )}
                                                    <div className={cn(
                                                        "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5",
                                                        selectedEntry.type === "ENTRY" ? "bg-blue-600 text-white" : "bg-orange-600 text-white"
                                                    )}>
                                                        {selectedEntry.type === "ENTRY" ? <LogIn size={12} /> : <LogOut size={12} />}
                                                        {selectedEntry.type === "ENTRY" ? "Ingreso Manual" : "Salida Manual"}
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>

                                    {/* Info Grid */}
                                    <div className="grid grid-cols-2 gap-4">
                                        {selectedEntry.name && (
                                            <div className="bg-slate-50 rounded-2xl p-4">
                                                <p className="text-[9px] font-black uppercase text-black/30 tracking-widest mb-1">Nombre</p>
                                                <p className="text-sm font-black text-black uppercase">{selectedEntry.name}</p>
                                            </div>
                                        )}
                                        {selectedEntry.dni && (
                                            <div className="bg-slate-50 rounded-2xl p-4">
                                                <p className="text-[9px] font-black uppercase text-black/30 tracking-widest mb-1">Documento</p>
                                                <p className="text-sm font-black text-black uppercase">{selectedEntry.dni}</p>
                                            </div>
                                        )}
                                        {selectedEntry.destination && (
                                            <div className="bg-slate-50 rounded-2xl p-4">
                                                <p className="text-[9px] font-black uppercase text-black/30 tracking-widest mb-1">Destino</p>
                                                <p className="text-sm font-black text-[#B20D30] uppercase">{selectedEntry.destination}</p>
                                            </div>
                                        )}
                                        {selectedEntry.company && (
                                            <div className="bg-slate-50 rounded-2xl p-4">
                                                <p className="text-[9px] font-black uppercase text-black/30 tracking-widest mb-1">Empresa</p>
                                                <p className="text-sm font-black text-black uppercase">{selectedEntry.company}</p>
                                            </div>
                                        )}
                                        {selectedEntry.guardName && (
                                            <div className="bg-slate-50 rounded-2xl p-4">
                                                <p className="text-[9px] font-black uppercase text-black/30 tracking-widest mb-1">Guardia</p>
                                                <p className="text-sm font-black text-black uppercase">{selectedEntry.guardName}</p>
                                            </div>
                                        )}
                                        {selectedEntry.origin && (
                                            <div className="bg-slate-50 rounded-2xl p-4">
                                                <p className="text-[9px] font-black uppercase text-black/30 tracking-widest mb-1">Origen</p>
                                                <p className="text-sm font-black text-black uppercase">{selectedEntry.origin}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Notes */}
                                    {selectedEntry.observations && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                                            <p className="text-[9px] font-black uppercase text-amber-600 tracking-widest mb-2">Observaciones</p>
                                            <p className="text-sm text-amber-900 font-medium leading-relaxed">{selectedEntry.observations}</p>
                                        </div>
                                    )}

                                    {/* Audio */}
                                    {selectedEntry.audioPath && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                                            <p className="text-[9px] font-black uppercase text-blue-600 tracking-widest mb-3">Audio Grabado</p>
                                            <audio controls src={selectedEntry.audioPath} className="w-full" />
                                        </div>
                                    )}

                                    {/* Delete */}
                                    <button onClick={() => { handleDelete(selectedEntry.id); setSelectedEntry(null); }} className="w-full py-4 rounded-2xl bg-red-50 hover:bg-red-100 text-[#B20D30] font-black uppercase text-xs tracking-widest transition-colors flex items-center justify-center gap-2">
                                        <Trash2 size={16} /> Eliminar Registro
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <footer className={cn(
                    "fixed bottom-0 left-0 right-0 h-20 md:h-24 border-t-2 transition-all duration-500 flex items-center justify-center px-4 md:px-6 z-[100] shadow-[0_-20px_60px_rgba(0,0,0,0.08)]",
                    isAlertMode ? "bg-red-600 border-white" : "bg-white/95 backdrop-blur-3xl border-white/50"
                )}>
                    {/* AVATAR + MENU - absolute left */}
                    <div className="absolute left-4 md:left-6 z-20">
                        <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => { setShowProfileMenu(!showProfileMenu); playTactileSound(); }}
                            className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-slate-100 border-[3px] md:border-4 border-white shadow-xl flex items-center justify-center overflow-hidden relative z-20"
                        >
                            {guardPhoto ? (
                                <Image src={guardPhoto} alt="User" fill className="object-cover" />
                            ) : (
                                <UserIcon className="text-slate-400" size={20} />
                            )}
                        </motion.button>

                        <AnimatePresence>
                            {showProfileMenu && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowProfileMenu(false)} />
                                    <motion.div
                                        initial={{ opacity: 0, y: 20, scale: 0.9 }}
                                        animate={{ opacity: 1, y: -20, scale: 1 }}
                                        exit={{ opacity: 0, y: 20, scale: 0.9 }}
                                        className="absolute bottom-full left-0 mb-4 w-64 bg-white rounded-3xl shadow-2xl border-2 border-slate-100 overflow-hidden p-3 flex flex-col gap-2 z-30"
                                    >
                                        <div className="p-3 bg-slate-50 rounded-2xl mb-2">
                                            <p className="text-xs font-bold uppercase text-slate-400">Sesión iniciada como</p>
                                            <p className="text-sm font-black uppercase text-black truncate">{guardName || "Guardia"}</p>
                                        </div>
                                        <button className="flex items-center gap-3 p-4 hover:bg-slate-50 rounded-2xl transition-colors text-black"
                                            onClick={() => { setShowCameraModal(true); setShowProfileMenu(false); }}>
                                            <Camera size={20} /> <span className="text-xs font-black uppercase tracking-wider">Mi Foto</span>
                                        </button>
                                        <button className="flex items-center gap-3 p-4 hover:bg-slate-50 rounded-2xl transition-colors text-black"
                                            onClick={() => { setShowSettingsModal(true); setShowProfileMenu(false); }}>
                                            <Settings size={20} /> <span className="text-xs font-black uppercase tracking-wider">Configuración</span>
                                        </button>
                                        <div className="h-px bg-slate-100 mx-2" />
                                        <button className="flex items-center gap-3 p-4 hover:bg-slate-50 rounded-2xl transition-colors text-black"
                                            onClick={() => { handleOpenGuardList(); setShowProfileMenu(false); }}>
                                            <Shield size={20} /> <span className="text-xs font-black uppercase tracking-wider">Cambiar Guardia</span>
                                        </button>
                                        <div className="h-px bg-slate-100 mx-2" />
                                        <button className="flex items-center gap-3 p-4 hover:bg-red-50 text-[#B20D30] rounded-2xl transition-colors"
                                            onClick={handleLogout}>
                                            <LogOut size={20} /> <span className="text-xs font-black uppercase tracking-wider">Cerrar Sesión</span>
                                        </button>
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* CENTERED NAV */}
                    <nav className="flex items-center gap-2 md:gap-6">
                        <BottomTab icon={customIcons.control ? <Image src={customIcons.control} width={20} height={20} className="object-contain md:w-6 md:h-6" alt="Icon" /> : <FileText size={20} className="md:w-6 md:h-6" />} active={activeTab === "control"} onClick={() => handleTabChange("control")} label="Acceso" alertActive={isAlertMode} />
                        <BottomTab icon={customIcons.history ? <Image src={customIcons.history} width={20} height={20} className="object-contain md:w-6 md:h-6" alt="Icon" /> : <HistoryIcon size={20} className="md:w-6 md:h-6" />} active={activeTab === "history"} onClick={() => handleTabChange("history")} label="Historial" alertActive={isAlertMode} />

                                <div className="relative -mt-12 md:-mt-14 mx-2 md:mx-4">
                                <motion.div
                                    drag="y"
                                    dragConstraints={{ top: isAlertMode ? 0 : -100, bottom: isAlertMode ? 100 : 0 }}
                                    dragElastic={0.2}
                                    onDragEnd={(_, info) => {
                                        // Slide up to activate
                                        if (info.offset.y < -60) {
                                            if (!isAlertMode) {
                                                toggleAlertMode(true);
                                                toast.error({ title: "¡ALERTA DE PÁNICO ACTIVADA!" });
                                            }
                                        }
                                        // Slide down to deactivate
                                        if (info.offset.y > 60) {
                                            if (isAlertMode) {
                                                toggleAlertMode(false);
                                                toast.success({ title: "PÁNICO DESACTIVADO" });
                                            }
                                        }
                                    }}
                                >
                                    <button
                                        onMouseDown={isAlertMode ? startDeactivateHold : startPanicHold}
                                        onMouseUp={isAlertMode ? cancelDeactivateHold : cancelPanicHold}
                                        onMouseLeave={isAlertMode ? cancelDeactivateHold : cancelPanicHold}
                                        onTouchStart={isAlertMode ? startDeactivateHold : startPanicHold}
                                        onTouchEnd={isAlertMode ? cancelDeactivateHold : cancelPanicHold}
                                        onClick={() => {
                                            if (!isAlertMode) handleTabChange("alerts");
                                            playTactileSound();
                                        }}
                                    className={cn(
                                        "w-20 h-20 md:w-24 md:h-24 rounded-full shadow-2xl flex items-center justify-center transition-all border-4 select-none relative overflow-hidden",
                                        isAlertMode || activeTab === "alerts"
                                            ? "bg-red-600 text-white border-red-700 shadow-red-600/30 animate-pulse"
                                            : "bg-white text-red-600 border-slate-100 hover:border-red-100"
                                    )}
                                >

                                    <Siren size={32} className={cn("md:w-8 md:h-8 relative z-10")} />
                                </button>
                                {!isAlertMode && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 0.4, y: [0, -5, 0] }}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                        className="absolute -top-10 left-1/2 -translate-x-1/2 text-[10px] font-black uppercase text-red-600 whitespace-nowrap pointer-events-none"
                                    >
                                        Slide up <ChevronUp size={10} className="inline" />
                                    </motion.div>
                                )}
                            </motion.div>
                        </div>
                        <BottomTab icon={customIcons.lpr ? <Image src={customIcons.lpr} width={20} height={20} className="object-contain md:w-6 md:h-6" alt="Icon" /> : <Car size={20} className="md:w-6 md:h-6" />} active={activeTab === "lpr"} onClick={() => handleTabChange("lpr")} label="LPR" alertActive={isAlertMode} />

                        <BottomTab icon={customIcons.map ? <Image src={customIcons.map} width={20} height={20} className="object-contain md:w-6 md:h-6" alt="Icon" /> : <MapIcon size={20} className="md:w-6 md:h-6" />} active={activeTab === "map"} onClick={() => handleTabChange("map")} label="Mapa" alertActive={isAlertMode} />
                    </nav>

                    {/* CLOCK - absolute right */}
                    <div className="absolute right-4 md:right-6 hidden lg:flex flex-col items-end">
                        <p className={cn("text-xl font-black tabular-nums tracking-tighter leading-none mb-1", isAlertMode ? "text-white" : "text-[#B20D30]")}>
                            {currentTime ? currentTime.toLocaleTimeString('es-UY', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </p>
                        <p className={cn("text-[8px] font-black uppercase tracking-widest leading-none", isAlertMode ? "text-white/60" : "text-black/40")}>
                            {currentTime ? currentTime.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' }) : '--- -- ---'}
                        </p>
                    </div>
                </footer>

                {/* NOTIFICATION OVERLAY SCREEN */}
                <AnimatePresence>
                    {notification && (
                        <NotificationOverlay
                            {...notification}
                            onClose={() => setNotification(null)}
                        />
                    )}
                </AnimatePresence>

                {/* RESOLUTION / CANCEL MODAL */}
                <AnimatePresence>
                    {showResolutionModal && activeMission && (
                        <div className="fixed inset-0 z-[500] bg-black/80 flex items-center justify-center p-6">
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl text-center space-y-4"
                            >
                                <h2 className="text-2xl font-black uppercase text-black">Gestionar Incidente</h2>
                                <p className="text-sm text-gray-500 uppercase font-bold">Seleccione una acción para finalizar</p>

                                <div className="space-y-2 text-left">
                                    <label className="text-[10px] font-black uppercase text-gray-400 ml-2">Notas / Observaciones</label>
                                    <textarea
                                        value={backupDetail}
                                        onChange={(e) => setBackupDetail(e.target.value)}
                                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 font-bold text-black focus:outline-none focus:border-black transition-all text-sm resize-none h-24 uppercase"
                                        placeholder="Detalles del resultado..."
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-3 mt-4">
                                    <button onClick={() => {
                                        socket?.emit('resolve_backup', {
                                            requestId: activeMission.id,
                                            bitacoraId: activeMission.bitacoraId,
                                            outcome: 'SOLUCIONADO',
                                            guardName: guardName,
                                            notes: backupDetail || 'Intervención completada correctamente.'
                                        });
                                        setShowResolutionModal(false);
                                        setBackupDetail("");
                                    }} className="bg-emerald-600 hover:bg-emerald-700 text-white py-5 rounded-2xl font-black uppercase flex items-center justify-center gap-3 transition-all shadow-xl shadow-emerald-600/20 active:scale-95">
                                        <CheckCircle2 size={24} /> Solucionado (Todo OK)
                                    </button>

                                    <button onClick={() => {
                                        socket?.emit('resolve_backup', {
                                            requestId: activeMission.id,
                                            bitacoraId: activeMission.bitacoraId,
                                            outcome: 'FALSA ALARMA',
                                            guardName: guardName,
                                            notes: backupDetail || 'No se detectó amenaza.'
                                        });
                                        setShowResolutionModal(false);
                                        setBackupDetail("");
                                    }} className="bg-amber-500 hover:bg-amber-600 text-white py-5 rounded-2xl font-black uppercase flex items-center justify-center gap-3 transition-all shadow-xl shadow-amber-500/20 active:scale-95">
                                        <ShieldAlert size={24} /> Falsa Alarma
                                    </button>

                                    <div className="h-px bg-gray-100 my-4" />

                                    <button onClick={() => {
                                        if (activeMission.responderId === socket?.id) {
                                            socket?.emit('cancel_backup', {
                                                requestId: activeMission.id,
                                                guardName: guardName,
                                                reason: 'Apoyo retirado'
                                            });
                                        } else {
                                            socket?.emit('cancel_backup', {
                                                requestId: activeMission.id,
                                                guardName: guardName,
                                                reason: 'Cancelado por usuario'
                                            });
                                        }
                                        setShowResolutionModal(false);
                                        setBackupDetail("");
                                    }} className="bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-600 p-4 rounded-xl font-black uppercase flex items-center justify-center gap-2 transition-colors">
                                        <X size={20} /> {activeMission.responderId === socket?.id ? "Cancelar Apoyo" : "Cancelar Solicitud"}
                                    </button>

                                    <button onClick={() => setShowResolutionModal(false)} className="text-gray-400 font-bold uppercase text-xs py-2">Volver</button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                {/* PROFILE CAMERA MODAL */}
                <AnimatePresence>
                    {showCameraModal && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black z-[2000] flex flex-col items-center justify-center"
                        >
                            <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10">
                                <div className="bg-white/10 backdrop-blur-xl border border-white/20 px-8 py-4 rounded-3xl flex items-center gap-4">
                                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                                    <span className="text-white font-black text-xl uppercase tracking-widest">Mi Foto de Perfil</span>
                                </div>
                            </div>

                            <video ref={profileVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                            <canvas ref={profileCanvasRef} className="hidden" />

                            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex gap-6 z-10">
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={captureProfilePhoto}
                                    className="w-24 h-24 rounded-full bg-white border-8 border-white/30 shadow-2xl flex items-center justify-center hover:scale-110 transition-transform"
                                >
                                    <Camera size={32} className="text-black" />
                                </motion.button>

                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setShowCameraModal(false)}
                                    className="w-20 h-20 rounded-full bg-red-600 border-4 border-white/30 shadow-2xl flex items-center justify-center hover:bg-red-700 transition-colors"
                                >
                                    <X size={28} className="text-white" />
                                </motion.button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* BACKUP REQUEST MODAL (SENDER) */}
                <AnimatePresence>
                    {showBackupModal && (
                        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6 backdrop-blur-sm">
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="bg-white w-full max-w-lg rounded-[2rem] p-8 shadow-2xl relative overflow-hidden"
                            >
                                <div className="text-center mb-6 relative z-10">
                                    <h2 className="text-3xl font-black uppercase text-[#B20D30] tracking-tighter">Reportar Incidente</h2>
                                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Seleccione el tipo de incidente en esta ubicación</p>
                                </div>

                                <div className="mb-6 relative z-10">
                                    <label className="text-[10px] uppercase font-black text-gray-400 mb-2 block tracking-widest">Detalles Adicionales (Opcional)</label>
                                    <input
                                        type="text"
                                        placeholder="Ej: Hombre chaqueta roja, Toyota gris..."
                                        value={backupDetail}
                                        onChange={(e) => setBackupDetail(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-black focus:outline-none focus:border-[#B20D30] transition-colors uppercase text-sm"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4 relative z-10">
                                    <button onClick={() => {
                                        const finalLoc = backupLocation || myLocation;
                                        if (socket && finalLoc) {
                                            const missionByMe = {
                                                id: 'req-' + Date.now(),
                                                type: 'INDIVIDUO SOSPECHOSO',
                                                lat: finalLoc.lat, lng: finalLoc.lng,
                                                requesterName: guardName || "Yo",
                                                requesterId: socket.id,
                                                status: 'PENDING',
                                                details: backupDetail
                                            };
                                            socket.emit('request_backup', missionByMe);
                                            setActiveMission(missionByMe);
                                            setShowBackupModal(false);
                                            setBackupDetail(""); // Reset
                                            showNotification("REPORTE ENVIADO", "Incidente reportado a todas las unidades.", "info");
                                        }
                                    }} className="bg-slate-50 hover:bg-slate-100 border-2 border-transparent hover:border-slate-300 py-6 rounded-2xl flex flex-col items-center gap-3 transition-all group active:scale-95">
                                        <div className="w-16 h-16 bg-white shadow-lg rounded-full flex items-center justify-center text-slate-700 group-hover:scale-110 transition-transform">
                                            <UserX size={32} />
                                        </div>
                                        <span className="text-sm font-black uppercase text-slate-700 leading-tight">Individuo<br />Sospechoso</span>
                                    </button>

                                    <button onClick={() => {
                                        const finalLoc = backupLocation || myLocation;
                                        if (socket && finalLoc) {
                                            const missionByMe = {
                                                id: 'req-' + Date.now(),
                                                type: 'VEHICULO SOSPECHOSO',
                                                lat: finalLoc.lat, lng: finalLoc.lng,
                                                requesterName: guardName || "Yo",
                                                requesterId: socket.id,
                                                status: 'PENDING',
                                                details: backupDetail
                                            };
                                            socket.emit('request_backup', missionByMe);
                                            setActiveMission(missionByMe);
                                            setShowBackupModal(false);
                                            setBackupDetail(""); // Reset
                                            showNotification("REPORTE ENVIADO", "Incidente reportado a todas las unidades.", "info");
                                        }
                                    }} className="bg-slate-50 hover:bg-slate-100 border-2 border-transparent hover:border-slate-300 py-6 rounded-2xl flex flex-col items-center gap-3 transition-all group active:scale-95">
                                        <div className="w-16 h-16 bg-white shadow-lg rounded-full flex items-center justify-center text-slate-700 group-hover:scale-110 transition-transform">
                                            <CarFront size={32} />
                                        </div>
                                        <span className="text-sm font-black uppercase text-slate-700 leading-tight">Vehículo<br />Sospechoso</span>
                                    </button>

                                    {/* Botón de Apoyo (Fuerza Bruta) */}
                                    <button onClick={() => {
                                        const finalLoc = backupLocation || myLocation;
                                        if (socket && finalLoc) {
                                            const missionByMe = {
                                                id: 'req-' + Date.now(),
                                                type: 'SOLICITUD DE APOYO',
                                                lat: finalLoc.lat, lng: finalLoc.lng,
                                                requesterName: guardName || "Yo",
                                                requesterId: socket.id,
                                                status: 'PENDING',
                                                details: backupDetail
                                            };
                                            socket.emit('request_backup', missionByMe);
                                            setActiveMission(missionByMe);
                                            setShowBackupModal(false);
                                            setBackupDetail(""); // Reset
                                            showNotification("SOLICITUD ENVIADA", "Solicitud de apoyo enviada.", "error");
                                        }
                                    }} className="bg-red-50 hover:bg-red-100 border-2 border-transparent hover:border-red-300 py-6 rounded-2xl flex flex-col items-center gap-3 transition-all group active:scale-95 col-span-2">
                                        <div className="w-16 h-16 bg-white shadow-lg rounded-full flex items-center justify-center text-red-600 group-hover:scale-110 transition-transform">
                                            <ShieldAlert size={32} />
                                        </div>
                                        <span className="text-sm font-black uppercase text-red-600 leading-tight">Solicitar Apoyo Necesario</span>
                                    </button>
                                </div>

                                <button onClick={() => setShowBackupModal(false)} className="mt-6 w-full py-3 text-xs font-bold uppercase text-gray-400 hover:text-black transition-colors">
                                    Cancelar Operación
                                </button>
                            </motion.div>

                        </div>
                    )}
                </AnimatePresence >

                {/* INCOMING BACKUP ALERT (RECEIVER) */}
                <AnimatePresence>
                    {
                        incomingBackup && (
                            <div className="fixed inset-0 z-[400] bg-red-600/90 flex flex-col items-center justify-center p-8">
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="bg-white w-full max-w-lg rounded-3xl p-8 shadow-2xl text-center space-y-6 border-4 border-red-500"
                                >
                                    <div className="animate-pulse w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <ShieldAlert size={64} className="text-red-600" />
                                    </div>

                                    <div>
                                        <h1 className="text-3xl font-black uppercase text-red-600 leading-none mb-2">
                                            {incomingBackup.type.includes('SOSPECHOSO') ? 'AVISO DE SOSPECHOSO' : 'SOLICITUD DE APOYO'}
                                        </h1>
                                        <p className="text-xl font-bold text-black uppercase">{incomingBackup.type}</p>
                                        <p className="text-sm font-bold text-gray-500 mt-2 uppercase">Informado por: <span className="text-black">{incomingBackup.requesterName}</span></p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 mt-8">
                                        <button
                                            onClick={() => setIncomingBackup(null)}
                                            className="py-4 rounded-2xl border-2 border-gray-200 text-gray-500 font-black uppercase tracking-widest hover:bg-gray-50"
                                        >
                                            Ignorar
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (socket) {
                                                    socket.emit('respond_backup', {
                                                        requestId: incomingBackup.id,
                                                        accepted: true,
                                                        responderName: guardName || "Guardia"
                                                    });
                                                    setActiveMission({
                                                        ...incomingBackup,
                                                        status: 'ACCEPTED',
                                                        responderId: socket.id
                                                    });
                                                    setIncomingBackup(null);
                                                    handleTabChange('map'); // Switch to map immediately
                                                }
                                            }}
                                            className={cn(
                                                "py-4 rounded-2xl bg-red-600 text-white font-black uppercase tracking-widest hover:bg-red-700 shadow-xl shadow-red-500/30",
                                                socket && incomingBackup.requesterId === socket.id ? "hidden" : ""
                                            )}
                                        >
                                            RESPONDER
                                        </button>
                                        {socket && incomingBackup.requesterId === socket.id && (
                                            <div className="col-span-2 md:col-span-1 flex items-center justify-center p-4 text-center text-black/40 font-bold uppercase text-[10px] tracking-widest bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                                                Esperando apoyo...
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            </div>
                        )
                    }
                </AnimatePresence >

                {/* AUDIO RECORDING HUB - NEW APPROACH */}
                <AnimatePresence>
                    {
                        isRecording && (
                            <motion.div
                                initial={{ opacity: 0, scale: 1.1 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="fixed inset-0 z-[1000] flex flex-col items-center justify-center p-8 backdrop-blur-3xl bg-black/80"
                            >
                                <motion.div
                                    initial={{ opacity: 0, y: 40 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex flex-col items-center gap-12 max-w-2xl w-full"
                                >
                                    {/* REC Status Indicator */}
                                    <div className="flex items-center gap-4 bg-red-600/20 px-8 py-3 rounded-2xl border border-red-500/30">
                                        <motion.div
                                            animate={{ opacity: [1, 0.4, 1] }}
                                            transition={{ repeat: Infinity, duration: 1 }}
                                            className="w-4 h-4 rounded-full bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.8)]"
                                        />
                                        <span className="text-white font-black text-xs uppercase tracking-[0.4em]">REC ON AIR</span>
                                        <div className="h-4 w-px bg-white/10 mx-2" />
                                        <span className="text-white font-black text-xl tabular-nums">{formatDuration(recordingDuration)}</span>
                                    </div>

                                    {/* Dynamic Visualizer */}
                                    <div className="flex gap-2 items-center h-48">
                                        {[...Array(32)].map((_, i) => (
                                            <motion.div
                                                key={i}
                                                animate={{
                                                    height: [10, 40 + Math.random() * 100, 10],
                                                }}
                                                transition={{
                                                    repeat: Infinity,
                                                    duration: 0.4 + Math.random() * 0.4,
                                                    delay: i * 0.02
                                                }}
                                                className="w-1.5 min-h-[10px] bg-gradient-to-t from-red-600 to-white rounded-full opacity-80"
                                            />
                                        ))}
                                    </div>

                                    <div className="text-center">
                                        <h3 className="text-4xl font-black text-white uppercase tracking-tighter mb-4">Capturando Nota de Audio</h3>
                                        <p className="text-white/40 font-black text-[10px] uppercase tracking-[0.5em]">La grabación se adjuntará automáticamente al reporte</p>
                                    </div>

                                    {/* Main Controls */}
                                    <div className="flex items-center gap-10 mt-6">
                                        {/* Stop and Save */}
                                        <motion.button
                                            whileHover={{ scale: 1.1 }}
                                            whileTap={{ scale: 0.9 }}
                                            onClick={stopRecording}
                                            className="w-28 h-28 rounded-[3rem] bg-white text-red-600 flex items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.4)] group"
                                        >
                                            <div className="w-10 h-10 bg-red-600 rounded-xl transition-transform group-hover:scale-90" />
                                        </motion.button>

                                        {/* Cancel */}
                                        <motion.button
                                            whileHover={{ scale: 1.1 }}
                                            whileTap={{ scale: 0.9 }}
                                            onClick={() => { stopRecording(); setAudioUrl(null); setAudioBlob(null); }}
                                            className="w-20 h-20 rounded-[2.5rem] bg-white/10 text-white border border-white/20 flex items-center justify-center hover:bg-white/20 transition-colors"
                                        >
                                            <X size={32} />
                                        </motion.button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )
                    }
                </AnimatePresence >

                {/* IMAGE VIEWER OVERLAY */}
                <AnimatePresence>
                    {
                        viewerImage && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 z-[2000] bg-black/90 backdrop-blur-xl flex items-center justify-center"
                                onClick={() => setViewerImage(null)}
                            >
                                <motion.button
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="absolute top-8 right-8 w-14 h-14 bg-white/10 hover:bg-white/20 rounded-2xl flex items-center justify-center text-white transition-all z-50"
                                    onClick={() => setViewerImage(null)}
                                >
                                    <X size={32} />
                                </motion.button>

                                <motion.div
                                    initial={{ opacity: 0, scale: 1 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="relative w-full h-full"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="relative w-full h-full group/viewer">
                                        <Image
                                            src={viewerImage}
                                            alt="Full view"
                                            fill
                                            className="object-contain cursor-zoom-in"
                                            priority
                                            onClick={() => setZoomImage(viewerImage)}
                                        />

                                        {/* Report Button overlay on image */}
                                        {viewerData?.plate && viewerData.plate !== '--- ---' && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 group-hover/viewer:opacity-100 transition-opacity z-40">
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        setLoadingAnalysis(true);
                                                        const analysis = await getPlateAnalysis(viewerData.plate!);
                                                        setPlateAnalysis(analysis);
                                                        setLoadingAnalysis(false);
                                                    }}
                                                    className="bg-[#B20D30] text-white px-12 py-5 rounded-full font-black uppercase text-lg tracking-widest shadow-2xl flex items-center gap-4 active:scale-95 transition-all"
                                                >
                                                    {loadingAnalysis ? <Loader2 size={24} className="animate-spin" /> : <Activity size={24} />}
                                                    REPORTE HISTÓRICO PATENTE
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* LPR Data Overlay - Only show if we have LPR data */}
                                    {viewerData && (viewerData.plate || viewerData.name || viewerData.unit) && (
                                        <>
                                            {/* Top Left - Plate and Basic Info */}
                                            <motion.div
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: 0.2 }}
                                                className="absolute top-8 left-8 space-y-3"
                                            >
                                                {/* Plate Number - Large and Prominent */}
                                                {viewerData.plate && (
                                                    <div className="bg-gradient-to-br from-white via-slate-100 to-slate-200 px-8 py-4 rounded-2xl border-4 border-black shadow-2xl">
                                                        <div className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] mb-1">Matrícula Detectada</div>
                                                        <div className="text-4xl font-black text-black uppercase tracking-[0.2em]">{viewerData.plate}</div>
                                                    </div>
                                                )}

                                                {/* Direction Badge */}
                                                {viewerData.direction && (
                                                    <div className={cn(
                                                        "inline-flex items-center gap-2 px-4 py-2 rounded-xl font-black text-sm uppercase tracking-wider shadow-lg",
                                                        viewerData.direction === "ENTRY"
                                                            ? "bg-emerald-500 text-white"
                                                            : "bg-orange-500 text-white"
                                                    )}>
                                                        {viewerData.direction === "ENTRY" ? <LogIn size={18} /> : <LogOut size={18} />}
                                                        {viewerData.direction === "ENTRY" ? "Entrada" : "Salida"}
                                                    </div>
                                                )}

                                                {/* Confidence Score */}
                                                {viewerData.confidence !== undefined && (
                                                    <div className="bg-black/80 backdrop-blur-md px-4 py-2 rounded-xl border border-white/20">
                                                        <div className="text-[9px] font-black text-white/60 uppercase tracking-wider mb-1">Confianza</div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden">
                                                                <div
                                                                    className={cn(
                                                                        "h-full rounded-full transition-all",
                                                                        viewerData.confidence >= 90 ? "bg-emerald-500" :
                                                                            viewerData.confidence >= 70 ? "bg-yellow-500" : "bg-red-500"
                                                                    )}
                                                                    style={{ width: `${viewerData.confidence}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-sm font-black text-white">{viewerData.confidence}%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </motion.div>

                                            {/* Top Right - Owner Info */}
                                            <motion.div
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: 0.3 }}
                                                className="absolute top-8 right-8 space-y-3 max-w-sm"
                                            >
                                                {/* Owner Card */}
                                                {viewerData.name && (
                                                    <div className="bg-black/80 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20 shadow-2xl">
                                                        <div className="flex items-center gap-3 mb-3">
                                                            <div className="w-10 h-10 rounded-full bg-blue-500/20 border-2 border-blue-500/50 flex items-center justify-center">
                                                                <UserIcon size={20} className="text-blue-400" />
                                                            </div>
                                                            <div className="text-[10px] font-black text-white/60 uppercase tracking-wider">Propietario</div>
                                                        </div>
                                                        <div className="text-xl font-black text-white uppercase tracking-wide">{viewerData.name}</div>
                                                    </div>
                                                )}

                                                {/* Unit/Lot Info */}
                                                {viewerData.unit && (
                                                    <div className="bg-black/80 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20 shadow-2xl">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <Home size={18} className="text-emerald-400" />
                                                            <div className="text-[10px] font-black text-white/60 uppercase tracking-wider">Lote / Unidad</div>
                                                        </div>
                                                        <div className="text-lg font-black text-white uppercase">{viewerData.unit}</div>
                                                    </div>
                                                )}

                                                {/* Vehicle Info */}
                                                {(viewerData.vehicleBrand || viewerData.vehicleModel) && (
                                                    <div className="bg-black/80 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/20 shadow-2xl">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <Car size={18} className="text-purple-400" />
                                                            <div className="text-[10px] font-black text-white/60 uppercase tracking-wider">Vehículo</div>
                                                        </div>
                                                        <div className="text-lg font-black text-white uppercase">{`${viewerData.vehicleBrand || ""} ${viewerData.vehicleModel || ""}`.trim()}</div>
                                                    </div>
                                                )}

                                                {/* Device Info */}
                                                {(viewerData.deviceName || viewerData.device?.name) && (
                                                    <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
                                                        <div className="flex items-center gap-2">
                                                            <Camera size={14} className="text-white/40" />
                                                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest mr-1">Cámara:</span>
                                                            <span className="text-[10px] font-bold text-white uppercase tracking-wider">{viewerData.deviceName || viewerData.device?.name}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </motion.div>

                                            {/* Bottom - Analysis Summary */}
                                            <motion.div
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.4 }}
                                                className="absolute bottom-8 left-8 right-8"
                                            >
                                                <div className="bg-gradient-to-r from-black/90 via-black/80 to-black/90 backdrop-blur-xl px-8 py-5 rounded-2xl border border-white/20 shadow-2xl">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-6">
                                                            <div>
                                                                <div className="text-[9px] font-black text-white/50 uppercase tracking-wider mb-1">Análisis Rápido</div>
                                                                <div className="text-sm font-bold text-white">
                                                                    {viewerData.name && viewerData.unit
                                                                        ? "✓ Residente Identificado - Acceso Autorizado"
                                                                        : viewerData.name
                                                                            ? "✓ Usuario Registrado"
                                                                            : "⚠ Matrícula No Registrada"}
                                                                </div>
                                                            </div>
                                                            {viewerData.timestamp && (
                                                                <div className="border-l border-white/20 pl-6">
                                                                    <div className="text-[9px] font-black text-white/50 uppercase tracking-wider mb-1">Timestamp</div>
                                                                    <div className="text-sm font-mono font-bold text-white">
                                                                        {new Date(viewerData.timestamp).toLocaleString('es-AR', {
                                                                            day: '2-digit',
                                                                            month: '2-digit',
                                                                            year: 'numeric',
                                                                            hour: '2-digit',
                                                                            minute: '2-digit',
                                                                            second: '2-digit'
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">
                                                            Toca para cerrar
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        </>
                                    )}
                                </motion.div>

                                {/* Actions overlay for Viewer - Only in Control (Home) tab */}
                                {activeTab === 'control' && viewerData && (viewerData.plate || viewerData.name === "Desconocido" || !viewerData.name) && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="absolute left-1/2 -translate-x-1/2 bottom-28 flex gap-4"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onClick={() => handleQuickCreateClick({
                                                plate: viewerData.plate !== '--- ---' ? viewerData.plate : undefined,
                                                cara: viewerData.url.startsWith('/api/files/') ? viewerData.url.replace('/api/files/', '') : viewerData.url
                                            })}
                                            disabled={loadingQuickCreateData}
                                            className="h-20 px-12 rounded-[2rem] bg-emerald-500/40 backdrop-blur-3xl border-2 border-emerald-500/30 text-white font-black text-lg uppercase tracking-widest shadow-2xl flex items-center gap-4 transition-all hover:bg-emerald-500/60 active:scale-95 disabled:opacity-50"
                                        >
                                            {loadingQuickCreateData ? <Loader2 size={32} className="animate-spin" /> : <Plus size={32} />}
                                            Registrar Nuevo Usuario
                                        </button>
                                    </motion.div>
                                )}
                            </motion.div>
                        )
                    }
                </AnimatePresence >

                {/* Normalization Modal */}
                <AnimatePresence>
                    {
                        showNormalizationModal && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 z-[3000] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6"
                                onClick={() => {
                                    setShowNormalizationModal(false);
                                    setNormalizationText("");
                                }}
                            >
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-8"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center">
                                            <CheckCircle2 size={32} className="text-emerald-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-black uppercase tracking-tight text-black">Normalizar Alerta</h2>
                                            <p className="text-sm text-black/60 font-bold">Describe brevemente la situación</p>
                                        </div>
                                    </div>

                                    <div className="mb-6">
                                        <label className="block text-xs font-black uppercase tracking-wider text-black/60 mb-2">
                                            Explicación de la Alerta
                                        </label>
                                        <textarea
                                            value={normalizationText}
                                            onChange={(e) => setNormalizationText(e.target.value)}
                                            placeholder="Ej: Falsa alarma, botón presionado accidentalmente..."
                                            className="w-full h-32 px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl font-medium text-black placeholder:text-black/30 focus:border-emerald-500 focus:outline-none resize-none"
                                            autoFocus
                                        />
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => {
                                                setShowNormalizationModal(false);
                                                setNormalizationText("");
                                            }}
                                            className="flex-1 h-14 bg-slate-100 hover:bg-slate-200 rounded-xl font-black uppercase tracking-wider text-sm text-black transition-all"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={() => {
                                                toggleAlertMode(false, normalizationText);
                                                setShowNormalizationModal(false);
                                                setNormalizationText("");
                                            }}
                                            disabled={!normalizationText.trim()}
                                            className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl font-black uppercase tracking-wider text-sm text-white transition-all shadow-lg shadow-emerald-600/20"
                                        >
                                            Confirmar Normalización
                                        </button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )
                    }
                </AnimatePresence >

                {/* GUARD LIST MODAL */}
                <AnimatePresence>
                    {showGuardList && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[3000] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6"
                            onClick={() => setShowGuardList(false)}
                        >
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full p-8 overflow-hidden flex flex-col max-h-[90vh]"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-2xl bg-[#B20D30] text-white flex items-center justify-center shadow-lg shadow-red-900/20">
                                            <Shield size={32} />
                                        </div>
                                        <div>
                                            <h2 className="text-3xl font-black uppercase tracking-tighter text-black">Guardias Disponibles</h2>
                                            <p className="text-sm text-black/40 font-bold uppercase tracking-widest">Seleccione usuario para operar esta tablet</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setShowGuardList(false)} className="w-12 h-12 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
                                        <X size={24} className="text-black/60" />
                                    </button>
                                </div>

                                {loadingGuards ? (
                                    <div className="flex-1 flex items-center justify-center py-20">
                                        <Loader2 size={48} className="text-black/20 animate-spin" />
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 overflow-y-auto p-2">
                                        {guardsList.map((guard) => (
                                            <button
                                                key={guard.id}
                                                onClick={() => {
                                                    const pinCheck = prompt(`Ingrese PIN de seguridad para ${guard.name}:`);
                                                    if (pinCheck && pinCheck === guard.password) {
                                                        localStorage.setItem("guard_name", guard.name);
                                                        setGuardName(guard.name);
                                                        setGuardPhoto(guard.cara); // Assuming 'cara' is the photo URL
                                                        if (guard.cara) localStorage.setItem("guard_photo", guard.cara);
                                                        setShowGuardList(false);
                                                        toast.success({ title: `Sesión iniciada como ${guard.name}` });
                                                        window.location.reload(); // Refresh to ensure full state reset
                                                    } else if (pinCheck) {
                                                        toast.error({ title: "PIN Incorrecto" });
                                                    }
                                                }}
                                                className="bg-slate-50 hover:bg-slate-100 border-2 border-slate-100 hover:border-[#B20D30]/20 rounded-3xl p-6 flex flex-col items-center gap-4 transition-all group"
                                            >
                                                <div className="relative w-24 h-24 rounded-full overflow-hidden bg-slate-200 shadow-inner">
                                                    {guard.cara ? (
                                                        <Image src={`/api/files/${guard.cara}`} alt={guard.name} fill className="object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                            <UserIcon size={40} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-center">
                                                    <p className="text-lg font-black uppercase text-black group-hover:text-[#B20D30] transition-colors line-clamp-1">{guard.name}</p>
                                                    <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">{guard.role}</p>
                                                </div>
                                            </button>
                                        ))}
                                        {guardsList.length === 0 && (
                                            <div className="col-span-full text-center py-10 text-slate-400 font-bold uppercase text-sm">
                                                No se encontraron guardias registrados
                                            </div>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>



                {/* Settings Modal */}
                <AnimatePresence>
                    {showSettingsModal && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[3000] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6"
                            onClick={() => setShowSettingsModal(false)}
                        >
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-8 overflow-y-auto max-h-[90vh]"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-16 h-16 rounded-2xl bg-black text-white flex items-center justify-center">
                                        <Settings size={32} />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-black uppercase tracking-tight text-black">Configuración</h2>
                                        <p className="text-sm text-black/60 font-bold">Personalización de la interfaz</p>
                                    </div>
                                </div>

                                <div className="mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                                    <h3 className="text-sm font-black uppercase tracking-wider text-black mb-4">Permisos y Diagnóstico</h3>
                                    <button
                                        onClick={() => {
                                            if ("Notification" in window) Notification.requestPermission();
                                            navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                                                .then(stream => {
                                                    stream.getTracks().forEach(t => t.stop());
                                                    toast.success({ title: "Permisos solicitados correctamente" });
                                                })
                                                .catch(() => toast.error({ title: "Permisos denegados o error de hardware" }));
                                        }}
                                        className="w-full py-4 bg-white border-2 border-black/10 rounded-xl text-xs font-bold uppercase tracking-widest text-black hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-all flex items-center justify-center gap-2"
                                    >
                                        <RefreshCcw size={16} /> Reiniciar Solicitud de Permisos
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsCheckingUpdate(true);
                                            setShowUpdateSplash(true);
                                            if ('serviceWorker' in navigator) {
                                                navigator.serviceWorker.getRegistrations().then(async (registrations) => {
                                                    let found = false;
                                                    for (let registration of registrations) {
                                                        await registration.update();
                                                        if (registration.waiting || registration.installing) {
                                                            found = true;
                                                        }
                                                    }
                                                    
                                                    setTimeout(() => {
                                                        setIsCheckingUpdate(false);
                                                        if (found) {
                                                            setUpdateAvailable(true);
                                                        } else {
                                                            toast.info({ title: "La aplicación ya está actualizada" });
                                                            setShowUpdateSplash(false);
                                                        }
                                                    }, 2000);
                                                });
                                            } else {
                                                setTimeout(() => {
                                                    setIsCheckingUpdate(false);
                                                    toast.info({ title: "PWA no soportada en este navegador" });
                                                    setShowUpdateSplash(false);
                                                }, 1500);
                                            }
                                        }}
                                        className="w-full mt-2 py-4 bg-blue-600 border-2 border-blue-700 rounded-xl text-xs font-bold uppercase tracking-widest text-white hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                                    >
                                        <Download size={16} /> Actualizar APP (Proceso Guiado)
                                    </button>
                                </div>

                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <Label className="text-xs font-black uppercase tracking-wider text-black/60">Logo Central (Sin bordes)</Label>
                                        <div className="flex gap-6 items-center bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-100">
                                            <div className="w-24 h-24 relative shrink-0">
                                                <Image src={customLogo || "/logo-transparent.png"} alt="Preview" fill className="object-contain" />
                                            </div>
                                            <div className="flex-1 space-y-3">
                                                <Input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={async (e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            const formData = new FormData();
                                                            formData.append("file", file);
                                                            const res = await uploadBrandingFile(formData);
                                                            if (res.success) setCustomLogo(res.url!);
                                                        }
                                                    }}
                                                    className="h-12 border-2 border-slate-200 rounded-xl bg-white"
                                                />
                                                <p className="text-[10px] text-black/40 font-bold uppercase tracking-widest">Sube tu logo en formato PNG transparente</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <Label className="text-xs font-black uppercase tracking-wider text-black/60">Color de Títulos de Tablas</Label>
                                        <div className="flex gap-4 flex-wrap">
                                            {[
                                                { color: "#000000", name: "Negro (Default)" },
                                                { color: "#B20D30", name: "Rojo Seguridad" },
                                                { color: "#1e293b", name: "Slate 800" },
                                                { color: "#166534", name: "Verde Bosque" },
                                                { color: "#1e40af", name: "Azul Cobalto" },
                                            ].map((c) => (
                                                <button
                                                    key={c.color}
                                                    onClick={() => setCustomHeaderColor(c.color)}
                                                    className={cn(
                                                        "w-12 h-12 rounded-full border-4 shadow-sm transition-all flex items-center justify-center",
                                                        customHeaderColor === c.color ? "border-black scale-110" : "border-white"
                                                    )}
                                                    style={{ backgroundColor: c.color }}
                                                    title={c.name}
                                                >
                                                    {customHeaderColor === c.color && <CheckCircle2 className="text-white" size={20} />}
                                                </button>
                                            ))}
                                            <div className="flex items-center gap-2 ml-4">
                                                <input
                                                    type="color"
                                                    value={customHeaderColor}
                                                    onChange={(e) => setCustomHeaderColor(e.target.value)}
                                                    className="w-12 h-12 rounded-full cursor-pointer border-4 border-white shadow-sm"
                                                />
                                                <span className="text-[10px] font-black uppercase text-black/40">Personalizado</span>
                                            </div>
                                        </div>
                                    </div>


                                </div>

                                <div className="flex gap-4 mt-10">
                                    <button
                                        disabled={isSavingBranding}
                                        onClick={() => {
                                            setCustomLogo(logo);
                                            setCustomHeaderColor(headerColor);
                                            setCustomIcons(initialIcons);
                                            setShowSettingsModal(false);
                                        }}
                                        className="flex-1 h-16 bg-slate-100 hover:bg-slate-200 rounded-2xl font-black uppercase tracking-widest text-xs text-black transition-all disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        disabled={isSavingBranding}
                                        onClick={async () => {
                                            setIsSavingBranding(true);
                                            try {
                                                const res = await saveGuardBranding({
                                                    "GUARD_MAIN_LOGO": customLogo || "",
                                                    "GUARD_TABLE_HEADER_COLOR": customHeaderColor,
                                                    "GUARD_APP_ICONS": JSON.stringify(customIcons)
                                                });
                                                if (res.success) {
                                                    toast.success({ title: "Configuración de marca actualizada con éxito" });
                                                    setShowSettingsModal(false);
                                                    window.location.reload();
                                                } else {
                                                    toast.error({ title: "Error al guardar: " + res.message });
                                                }
                                            } catch (e) {
                                                toast.error({ title: "Error de red al guardar" });
                                            } finally {
                                                setIsSavingBranding(false);
                                            }
                                        }}
                                        className="flex-1 h-16 bg-black hover:bg-neutral-800 rounded-2xl font-black uppercase tracking-widest text-xs text-white transition-all shadow-xl disabled:opacity-50 flex items-center justify-center gap-3"
                                    >
                                        {isSavingBranding ? <Loader2 className="animate-spin" size={18} /> : null}
                                        {isSavingBranding ? "Guardando..." : "Guardar Cambios"}
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {
                    quickCreateData && (
                        <UserFormDialog
                            open={showQuickCreate}
                            onOpenChange={setShowQuickCreate}
                            units={quickCreateData.units}
                            groups={quickCreateData.groups}
                            devices={quickCreateData.devices}
                            parkingSlots={quickCreateData.parkingSlots}
                            onSuccess={() => {
                                setShowQuickCreate(false);
                                toast.success({ title: "Usuario creado con éxito" });
                            }}
                            initialData={quickCreateContext}
                        />
                    )
                }
                {/* FULLSCREEN IMAGE ZOOM MODAL */}
                <AnimatePresence>
                    {zoomImage && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[3000] bg-black flex items-center justify-center p-8"
                            onClick={() => setZoomImage(null)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="relative w-full h-full max-w-7xl max-h-[90vh]"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Image
                                    src={zoomImage}
                                    alt="Zoom"
                                    fill
                                    className="object-contain"
                                    quality={100}
                                    unoptimized
                                />
                                <button
                                    onClick={() => setZoomImage(null)}
                                    className="absolute -top-12 right-0 w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white"
                                >
                                    <X size={24} />
                                </button>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* PLATE REPORT MODAL */}
                <AnimatePresence>
                    {plateAnalysis && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[3000] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6"
                            onClick={() => setPlateAnalysis(null)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                exit={{ scale: 0.9, y: 20 }}
                                className="w-full max-w-4xl bg-white rounded-[3rem] p-12 space-y-10 shadow-2xl relative overflow-hidden"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-[#B20D30]/5 to-transparent pointer-events-none" />

                                <div className="flex justify-between items-start relative">
                                    <div className="space-y-2">
                                        <h3 className="text-5xl font-black tracking-tighter text-slate-900 leading-none uppercase">Reporte de Inteligencia</h3>
                                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.4em]">Historial Cronológico de Accesos LPR</p>
                                    </div>
                                    <div className="bg-[#B20D30] px-10 py-5 rounded-[2rem] shadow-2xl shadow-[#B20D30]/30 border-4 border-white/20">
                                        <span className="text-white font-black text-4xl tracking-widest">{viewerData?.plate}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-8">
                                    <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-100 flex flex-col justify-center">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Pasadas Semanales</p>
                                        <p className="text-5xl font-black text-[#B20D30]">{plateAnalysis.totalEvents}</p>
                                    </div>
                                    <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-100 col-span-2">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Última Actividad</p>
                                        <div className="flex items-center gap-4">
                                            <div className="w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center text-[#B20D30]">
                                                <Clock size={28} />
                                            </div>
                                            <div>
                                                <p className="text-xl font-black text-slate-900">{plateAnalysis.lastVisit ? new Date(plateAnalysis.lastVisit).toLocaleString('es-UY') : "Ninguna"}</p>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Tiempo transcurrido registrado</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div className="flex items-center justify-between ml-4">
                                        <h4 className="text-xs font-black text-slate-900 uppercase tracking-[0.5em]">Línea de Tiempo de Accesos</h4>
                                        <div className="h-0.5 flex-1 bg-slate-100 mx-8" />
                                    </div>

                                    <div className="space-y-4 max-h-[35vh] overflow-y-auto px-4 custom-scrollbar">
                                        {plateAnalysis.events.map((ev: any) => (
                                            <div key={ev.id} className="flex items-center justify-between p-6 rounded-3xl bg-white border-2 border-slate-50 hover:border-[#B20D30]/20 hover:shadow-xl transition-all duration-300 group">
                                                <div className="flex items-center gap-8">
                                                    <div className={cn(
                                                        "w-16 h-16 rounded-[1.25rem] flex items-center justify-center shadow-inner transition-colors",
                                                        ev.direction === 'ENTRY' ? "bg-emerald-100 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white" : "bg-orange-100 text-orange-600 group-hover:bg-orange-500 group-hover:text-white"
                                                    )}>
                                                        {ev.direction === 'ENTRY' ? <LogIn size={24} /> : <LogOut size={24} />}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="text-lg font-black text-slate-900 uppercase tracking-tight">{ev.direction === 'ENTRY' ? 'Ingreso Autorizado' : 'Egreso Autorizado'}</p>
                                                        <p className="text-xs font-bold text-slate-400">{new Date(ev.timestamp).toLocaleString('es-UY')}</p>
                                                    </div>
                                                </div>
                                                <div className={cn(
                                                    "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest border-2",
                                                    ev.decision === 'GRANT' ? "border-emerald-100 text-emerald-600 bg-emerald-50/30" : "border-red-100 text-red-600 bg-red-50/30"
                                                )}>
                                                    {ev.decision === 'GRANT' ? 'Paso Concedido' : 'Paso Denegado'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    onClick={() => setPlateAnalysis(null)}
                                    className="w-full h-20 bg-slate-900 hover:bg-black text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-sm active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-4 border-2 border-white/10"
                                >
                                    SALIR DEL REPORTE
                                </button>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            {/* PWA UPDATE SPLASH */}
            <AnimatePresence>
                {showUpdateSplash && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[5000] bg-blue-600 flex flex-col items-center justify-center p-8 text-white overflow-hidden shadow-2xl"
                    >
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                            className="mb-8 text-white/40"
                        >
                            <RefreshCcw size={100} strokeWidth={3} />
                        </motion.div>
                        <h2 className="text-5xl font-black uppercase tracking-tighter mb-4 text-center">
                            {isCheckingUpdate ? "Verificando Versión" : (updateAvailable ? "Actualización Lista" : "Omniaccess Pro")}
                        </h2>
                        <p className="text-xs font-black text-white/50 uppercase tracking-[0.4em] mb-12 text-center">
                            {isCheckingUpdate ? "Buscando cambios en la red..." : (updateAvailable ? "Se encontró una nueva versión de la plataforma" : "Tu sistema está actualizado")}
                        </p>

                        {updateAvailable && (
                            <div className="w-full max-w-md space-y-4">
                                <button
                                    onClick={() => window.location.reload()}
                                    className="w-full h-20 bg-white text-blue-600 rounded-[2.5rem] font-black uppercase tracking-widest text-sm active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-3"
                                >
                                    <Download size={24} /> Actualizar ahora
                                </button>
                                <button
                                    onClick={() => setShowUpdateSplash(false)}
                                    className="w-full h-20 bg-blue-700 text-white rounded-[2.5rem] font-black uppercase tracking-widest text-sm active:scale-95 transition-all"
                                >
                                    Continuar sin actualizar
                                </button>
                            </div>
                        )}
                        {!updateAvailable && isCheckingUpdate && (
                            <div className="w-64 h-2 bg-white/10 rounded-full overflow-hidden relative">
                                <motion.div 
                                    className="absolute inset-y-0 left-0 bg-white shadow-[0_0_20px_white]"
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 2 }}
                                />
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* SEARCH FILL MODAL */}
            <AnimatePresence>
                {showSearchFillModal && recentRecords.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[4500] bg-black/60 backdrop-blur-md flex items-center justify-center p-8"
                        onClick={() => setShowSearchFillModal(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="w-full max-w-3xl bg-white rounded-[3rem] p-12 shadow-2xl space-y-10 relative overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-blue-50 to-transparent pointer-events-none" />
                            
                            <div className="space-y-3 text-center relative">
                                <div className="w-20 h-20 bg-blue-600 text-white rounded-3xl mx-auto flex items-center justify-center mb-4 shadow-xl shadow-blue-600/20">
                                    <Clock size={40} />
                                </div>
                                <h3 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">Registros Históricos</h3>
                                <p className="text-xs font-black text-slate-400 uppercase tracking-[0.3em]">Encontramos datos previos para esta matrícula</p>
                            </div>

                            <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-4 custom-scrollbar">
                                {recentRecords.map((record) => (
                                    <button
                                        key={record.id}
                                        onClick={() => {
                                            if (record.name) setName(record.name);
                                            if (record.dni) setDni(record.dni);
                                            setShowSearchFillModal(false);
                                            toast.success({ title: "Datos recuperados correctamente" });
                                        }}
                                        className="w-full p-8 rounded-[2.5rem] bg-slate-50 border-2 border-slate-100 flex items-center justify-between text-left active:scale-[0.98] transition-all group hover:bg-white hover:border-blue-400 hover:shadow-2xl hover:shadow-blue-600/10"
                                    >
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-3">
                                                <Badge className="bg-blue-100 text-blue-600 hover:bg-blue-100 border-none px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                                                    Visitó: {new Date(record.timestamp).toLocaleDateString()}
                                                </Badge>
                                                {record.plate && (
                                                    <Badge className="bg-slate-900 text-white hover:bg-slate-900 border-none px-4 py-1 rounded-full text-[10px] font-black tracking-widest">
                                                        {record.plate}
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-2xl font-black text-slate-900 uppercase tracking-tight group-hover:text-blue-600 transition-colors">{record.name || "Sin nombre"}</p>
                                            <div className="flex gap-8">
                                                <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                                    <FileText size={14} className="text-slate-300" /> DNI: {record.dni || "---"}
                                                </span>
                                                <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                                    <Building2 size={14} className="text-slate-300" /> DESTINO: {record.destination || "---"}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="w-16 h-16 rounded-[1.5rem] bg-white shadow-sm border border-slate-100 flex items-center justify-center text-slate-200 group-hover:text-blue-500 group-hover:border-blue-200 group-hover:shadow-lg transition-all">
                                            <CheckCircle2 size={32} />
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button
                                    onClick={() => setShowSearchFillModal(false)}
                                    className="flex-1 h-20 bg-slate-100 text-slate-400 rounded-3xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all"
                                >
                                    INGRESAR DATOS NUEVOS
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            </main >

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.05); border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.1); }
            `}</style>
            {/* FULLSCREEN IMAGE ZOOM MODAL */}
            <AnimatePresence>
                {zoomImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[1000] bg-black flex items-center justify-center p-8"
                        onClick={() => setZoomImage(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="relative w-full h-full max-w-7xl max-h-[90vh]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Image
                                src={zoomImage}
                                alt="Zoom"
                                fill
                                className="object-contain"
                                quality={100}
                                unoptimized
                            />
                            <button
                                onClick={() => setZoomImage(null)}
                                className="absolute -top-12 right-0 w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white"
                            >
                                <X size={24} />
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* PLATE REPORT MODAL */}
            <AnimatePresence>
                {plateAnalysis && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6"
                        onClick={() => setPlateAnalysis(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="w-full max-w-2xl bg-white rounded-[3rem] p-10 space-y-8 shadow-2xl relative overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#B20D30]/5 to-transparent pointer-events-none" />

                            <div className="flex justify-between items-start relative">
                                <div className="space-y-2">
                                    <h3 className="text-4xl font-black tracking-tighter text-slate-900 leading-none">REPORTE DE ACCESOS</h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.3em]">ANÁLISIS DE COMPORTAMIENTO LPR</p>
                                </div>
                                <div className="bg-[#B20D30] px-8 py-4 rounded-2xl shadow-xl shadow-[#B20D30]/20">
                                    <span className="text-white font-black text-3xl tracking-[0.2em]">{plateAnalysis.events[0]?.plateDetected || (viewerData as any).plate}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Última Visita Registrada</p>
                                    <p className="text-lg font-black text-slate-900">{plateAnalysis.lastVisit ? new Date(plateAnalysis.lastVisit).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : "No hay registros previos"}</p>
                                </div>
                                <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Frecuencia Semanal</p>
                                        <p className="text-4xl font-black text-[#B20D30]">{plateAnalysis.totalEvents}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] font-black text-slate-900 uppercase">Pasadas</div>
                                        <div className="text-[9px] font-bold text-slate-400">Últimos 7 días</div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-xs font-black text-slate-900 uppercase tracking-[0.4em] ml-4">Cronología de Eventos</h4>
                                <div className="space-y-3 max-h-[30vh] overflow-y-auto px-2 custom-scrollbar">
                                    {plateAnalysis.events.map((ev: any, i: number) => (
                                        <div key={ev.id} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-white hover:shadow-md transition-all">
                                            <div className="flex items-center gap-6">
                                                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shadow-sm", ev.direction === 'ENTRY' ? "bg-emerald-100 text-emerald-600" : "bg-orange-100 text-orange-600")}>
                                                    {ev.direction === 'ENTRY' ? <LogIn size={20} /> : <LogOut size={20} />}
                                                </div>
                                                <div className="leading-tight">
                                                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{ev.direction === 'ENTRY' ? 'Ingreso detectado' : 'Salida detectada'}</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase">{new Date(ev.timestamp).toLocaleString('es-UY')}</p>
                                                </div>
                                            </div>
                                            <div className={cn("px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest", ev.decision === 'GRANT' ? "bg-emerald-500 text-white" : "bg-red-500 text-white")}>
                                                {ev.decision === 'GRANT' ? 'Autorizado' : 'Denegado'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={() => setPlateAnalysis(null)}
                                className="w-full h-16 bg-slate-900 text-white rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-sm active:scale-95 transition-all shadow-xl"
                            >
                                Finalizar Consulta
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
}

function DetailCard({ label, value, icon }: any) {
    return (
        <div className="flex items-center gap-6 p-6 bg-slate-50 rounded-[1.5rem] border border-slate-100 group hover:bg-white hover:shadow-xl transition-all duration-300">
            <div className="w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-400 group-hover:bg-[#B20D30] group-hover:text-white transition-colors duration-500">
                {icon && React.isValidElement(icon) ? React.cloneElement(icon as any, { size: 24 }) : icon}
            </div>
            <div>
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">{label}</p>
                <p className="text-xl font-black uppercase text-slate-900 tracking-tight">{value || "Sin especificar"}</p>
            </div>
        </div>
    );
}

function BottomTab({ icon, active, onClick, label, small, alertActive }: any) {
    return (
        <motion.button
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
                const audio = new AudioContext();
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                osc.frequency.value = 400;
                gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(audio.destination);
                osc.start();
                osc.stop(audio.currentTime + 0.1);
                onClick();
            }}
            className={cn(
                small ? "w-20 h-14 md:w-24 md:h-16" : "w-16 h-16 md:w-28 md:h-18",
                "rounded-[1rem] md:rounded-[1.25rem] flex flex-col items-center justify-center gap-1 md:gap-1.5 transition-all relative overflow-hidden",
                active
                    ? (alertActive ? "text-red-700 bg-white" : "text-[#B20D30]")
                    : (alertActive ? "text-red-300" : "text-black/40 hover:text-black hover:bg-white/60")
            )}
        >
            <div className={cn("relative z-10 transition-all duration-300", active && "scale-110")}>
                {icon}
            </div>
            <span className={cn(
                small ? "text-[7px] md:text-[8px]" : "text-[8px] md:text-[9px]",
                "font-black uppercase tracking-widest relative z-10 transition-all duration-300",
                active ? "opacity-100 translate-y-0" : "opacity-60 translate-y-1"
            )}>
                {label}
            </span>

            {active && (
                <motion.div
                    layoutId="active-pill"
                    className="absolute inset-0 bg-gradient-to-br from-[#B20D30]/10 to-[#B20D30]/5 rounded-[1.25rem] border-2 border-[#B20D30]/20 shadow-lg"
                    transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
                />
            )}
        </motion.button>
    );
}

function OriginButton({ active, onClick, icon, label, activeClass }: any) {
    return (
        <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
                const audio = new AudioContext();
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                osc.frequency.value = 500;
                gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.1);
                osc.connect(gain);
                gain.connect(audio.destination);
                osc.start();
                osc.stop(audio.currentTime + 0.1);
                onClick();
            }}
            className={cn(
                "h-20 rounded-[1.25rem] border-2 flex flex-col items-center justify-center gap-1.5 transition-all duration-300 relative overflow-hidden shadow-sm",
                active ? activeClass : "bg-white border-black transition-all duration-300 text-black/40 hover:bg-slate-50 hover:border-slate-300"
            )}
        >
            <div className={cn("transition-transform duration-300", active && "scale-110")}>
                {icon}
            </div>
            <span className="font-black text-[10px] uppercase tracking-widest">{label}</span>
            {active && (
                <div className="absolute top-0 right-0 w-8 h-8 bg-white/10 rounded-full -mr-4 -mt-4 transition-all" />
            )}
        </motion.button>
    );
}

function AudioRecordingButton({ isRecording, audioUrl, onStart, onStop, onClear }: any) {
    return (
        <div className="flex flex-col items-center gap-2">
            {!audioUrl ? (
                <button
                    onClick={isRecording ? onStop : onStart}
                    className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center transition-all relative shadow-lg border-2",
                        isRecording ? "bg-[#B20D30] border-[#B20D30]" : "bg-white border-black transition-all duration-300 text-black/40 hover:bg-slate-50"
                    )}
                >
                    {isRecording ? (
                        <>
                            <motion.div
                                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                                className="absolute inset-0 bg-white/40 rounded-2xl"
                            />
                            <Square size={20} className="relative z-10 text-white fill-white" />
                        </>
                    ) : (
                        <Mic size={20} />
                    )}
                </button>
            ) : (
                <div className="flex flex-col gap-3">
                    <button className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg border-2 border-emerald-400 active:scale-95 transition-all">
                        <Volume2 size={20} />
                    </button>
                    <button onClick={onClear} className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-black/40 hover:text-[#B20D30] hover:bg-red-50 transition-colors mx-auto">
                        <X size={16} />
                    </button>
                </div>
            )}
            {isRecording && (
                <div className="flex gap-0.5 items-center h-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <motion.div
                            key={i}
                            animate={{ height: [4, 12, 4] }}
                            transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                            className="w-1 bg-red-400 rounded-full"
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function AppField({ label, icon, value, onChange, placeholder }: any) {
    return (
        <div className="space-y-2 md:space-y-4">
            <Label className="text-[10px] md:text-xs font-black uppercase text-black tracking-[0.2em] md:tracking-[0.3em] flex items-center gap-2 md:gap-3 ml-1 md:ml-2">
                <div className="p-2 md:p-2.5 rounded-lg md:rounded-xl bg-black text-white shadow-md flex items-center justify-center">
                    {icon && React.isValidElement(icon) ? React.cloneElement(icon as any, { size: 12, className: "md:w-3.5 md:h-3.5" }) : icon}
                </div> {label}
            </Label>
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-14 md:h-20 bg-white border border-black/20 focus:ring-4 focus:ring-[#B20D30]/20 rounded-xl md:rounded-2xl text-black font-black text-sm md:text-lg tracking-wide px-6 md:px-10 placeholder:text-black/20 transition-all shadow-sm"
            />
        </div>
    );
}

function SensorStatus({ label, active }: { label: string, active: boolean }) {
    return (
        <div className="flex items-center justify-between group cursor-help">
            <span className="text-[11px] font-black uppercase tracking-tight text-black/40 group-hover:text-black transition-colors">{label}</span>
            <div className={cn("w-2.5 h-2.5 rounded-full border-2 border-white ring-2 transition-all duration-500", active ? "bg-[#B20D30] ring-[#B20D30]/20" : "bg-slate-200 ring-transparent")} />
        </div>
    );
}

function HistoryItem({ entry, onDelete }: any) {
    return (
        <motion.div whileHover={{ y: -8 }} className="bg-white border-2 border-slate-100 rounded-[2.5rem] overflow-hidden group shadow-sm hover:shadow-xl hover:border-[#B20D30]/20 transition-all duration-500">
            <div className="aspect-[4/3] relative overflow-hidden bg-slate-50 border-b-2 border-slate-100">
                {entry.photoPath ? (
                    <Image src={entry.photoPath} alt="Log" fill className="object-cover opacity-90 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700" />
                ) : (
                    <div className="h-full w-full flex items-center justify-center text-black/20">
                        <ImageIcon size={48} strokeWidth={1} />
                    </div>
                )}
                <div className={cn("absolute top-6 left-6 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg backdrop-blur-md", entry.type === "ENTRY" ? "bg-[#B20D30] text-white" : "bg-orange-500 text-white")}>
                    {entry.type === "ENTRY" ? "Ingreso" : "Egreso"}
                </div>
            </div>
            <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                    <h4 className="text-2xl font-black text-black tracking-tighter uppercase">{entry.plate || "S/ Placa"}</h4>
                    <div className="flex items-center gap-2">
                        {entry.audioPath && (
                            <button onClick={() => {
                                const audio = new Audio(entry.audioPath);
                                audio.play().catch(err => {
                                    console.error("Audio playback error:", err);
                                    toast.error({ title: "Error al reproducir audio. El formato podría no ser compatible." });
                                });
                            }} className="w-10 h-10 rounded-xl bg-slate-50 text-black/40 hover:text-blue-500 hover:bg-blue-50 transition-all flex items-center justify-center">
                                <Volume2 size={18} />
                            </button>
                        )}
                        <button onClick={() => onDelete(entry.id)} className="w-10 h-10 rounded-xl bg-slate-50 text-black/40 hover:text-[#B20D30] hover:bg-red-50 transition-all flex items-center justify-center">
                            <Trash2 size={18} />
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                    <div>
                        <p className="text-[10px] font-black text-black/40 uppercase tracking-widest leading-none mb-2">Sujeto</p>
                        <p className="text-xs font-black text-black uppercase truncate">{entry.name || "Identidad Reservada"}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-black/40 uppercase tracking-widest leading-none mb-2">Destino</p>
                        <p className="text-xs font-black text-[#B20D30] uppercase truncate">{entry.destination || "Sin Destino"}</p>
                    </div>
                    {entry.latitude && (
                        <div className="col-span-2 mt-2 pt-4 border-t-2 border-slate-50 flex items-center gap-2 text-[9px] text-black/30 font-black uppercase tracking-widest">
                            <MapPin size={12} className="text-[#B20D30]" />
                            <span>Geo-Data: {entry.latitude.toFixed(4)}, {entry.longitude.toFixed(4)}</span>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

function AudioRecordingFloatingButton({ isRecording, audioUrl, onStart, onStop, onClear }: any) {
    return (
        <>
            {!audioUrl ? (
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={isRecording ? onStop : onStart}
                    className={cn(
                        "w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex items-center justify-center transition-all",
                        isRecording ? "bg-red-600 text-white hover:bg-red-700" : "bg-slate-800 text-white hover:bg-slate-700"
                    )}
                >
                    {isRecording ? (
                        <>
                            <motion.div
                                animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0, 0.3] }}
                                transition={{ repeat: Infinity, duration: 1 }}
                                className="absolute inset-0 bg-white rounded-[1.2rem] md:rounded-[1.8rem]"
                            />
                            <Square size={20} className="relative z-10 fill-white md:w-5 md:h-5" />
                        </>
                    ) : (
                        <Mic size={20} className="md:w-5 md:h-5" />
                    )}
                </motion.button>
            ) : (
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onClear}
                    className="w-12 h-12 md:w-16 md:h-16 rounded-[1.2rem] md:rounded-[1.8rem] flex items-center justify-center transition-all bg-emerald-600 text-white hover:bg-emerald-700"
                >
                    <Volume2 size={20} className="md:w-5 md:h-5" />
                </motion.button>
            )}
        </>
    );
}

function RollingCharacter({ char, isFocused }: { char: string, isFocused: boolean }) {
    return (
        <div className={cn(
            "w-9 h-14 sm:w-12 sm:h-20 md:w-20 md:h-28 bg-white rounded-xl md:rounded-2xl flex items-center justify-center border-[3px] md:border-4 transition-all duration-300",
            isFocused ? "border-[#B20D30] bg-[#B20D30]/5 shadow-[0_10px_30px_rgba(178,13,48,0.15)] scale-110 z-10" : "border-black text-black"
        )}>
            <span className={cn(
                "text-xl sm:text-4xl md:text-6xl font-black tracking-tighter",
                isFocused ? "text-[#B20D30]" : "text-black",
                char === " " && "opacity-10"
            )}>
                {char === " " ? "•" : char}
            </span>
        </div>
    );
}

function TactilePlateInput({ value, onChange, onCameraClick, playTactileSound }: { value: string, onChange: (v: string) => void, onCameraClick?: () => void, playTactileSound?: () => void }) {
    const chars = value.padEnd(7, " ").substring(0, 7).split("");
    const inputRef = useRef<HTMLInputElement>(null);

    // Force cursor to end whenever value changes (critical for mobile keyboards)
    useEffect(() => {
        if (inputRef.current) {
            const len = value.length;
            if (inputRef.current.selectionStart !== len) {
                inputRef.current.setSelectionRange(len, len);
            }
        }
    }, [value]);

    return (
        <div className="w-full flex flex-col gap-4 items-center relative">
            <input
                ref={inputRef}
                type="text"
                value={value}
                onKeyDown={() => {
                    if (playTactileSound) playTactileSound();
                }}
                onFocus={(e) => {
                    const len = value.length;
                    e.target.setSelectionRange(len, len);
                }}
                onChange={(e) => {
                    // Sanitize input: Alphanumeric only, limit to 7 chars
                    const sanitized = (e.target.value.replace(/[^A-Za-z0-9]/g, '')).toUpperCase().substring(0, 7);
                    onChange(sanitized);
                }}
                // Make the hidden input cover the entire visual area for better tablet focus reliability
                className="absolute inset-0 opacity-0 z-20 cursor-pointer"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoCapitalize="characters"
                inputMode="text"
                autoFocus
            />

            <div className="flex gap-1 sm:gap-2 items-center relative z-10 perspective-[1000px]">
                {chars.map((char, i) => (
                    <RollingCharacter
                        key={i}
                        char={char}
                        isFocused={value.length === i && value.length < 7}
                    />
                ))}

                {onCameraClick && (
                    <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onCameraClick();
                        }}
                        className="ml-4 sm:ml-6 md:ml-10 w-12 h-14 sm:w-16 sm:h-20 md:w-24 md:h-28 rounded-xl md:rounded-2xl bg-[#B20D30] text-white flex items-center justify-center shadow-lg hover:bg-[#910a28] transition-all border-none"
                    >
                        <Camera size={24} className="md:w-8 md:h-8" />
                    </motion.button>
                )}
            </div>

            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="px-8 py-3 rounded-2xl"
            >
                <p className="text-[10px] font-black text-[#B20D30] uppercase tracking-[0.4em] animate-pulse">Escribe la matricula en cada casillero</p>
            </motion.div>
        </div>
    );
}

function DeviceEntry({ name, status }: { name: string, status: string }) {
    return (
        <div className="flex items-center gap-4 px-2 py-1 group cursor-default">
            <div className={cn("w-2 h-2 rounded-full border-2 border-white ring-2 ring-transparent transition-all", status === 'active' ? "bg-emerald-500 ring-emerald-500/20" : "bg-blue-500 ring-blue-500/20")} />
            <span className="text-[10px] font-black text-black font-black uppercase tracking-widest group-hover:text-black transition-colors">{name}</span>
        </div>
    );
}

function OriginPickerButton({ active, onClick, icon, label, sub }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, sub: string }) {
    return (
        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className={cn(
                "h-56 rounded-[2.5rem] border-2 flex flex-col items-center justify-center gap-4 transition-all relative overflow-hidden group shadow-xl",
                active
                    ? "bg-black border-white text-white"
                    : "bg-white border-black text-black hover:bg-slate-50"
            )}
        >
            <div className={cn(
                "w-20 h-20 rounded-3xl flex items-center justify-center transition-all",
                active ? "bg-white text-black" : "bg-black text-white group-hover:scale-110"
            )}>
                {icon}
            </div>
            <div className="text-center">
                <p className="text-2xl font-black uppercase tracking-tighter">{label}</p>
                <p className={cn("text-[9px] font-black uppercase tracking-widest mt-1", active ? "text-white/40" : "text-black/30")}>{sub}</p>
            </div>
            {active && (
                <div className="absolute top-4 right-4">
                    <CheckCircle2 size={24} className="text-white" />
                </div>
            )}
        </motion.button>
    );
}

function NotificationOverlay({ type, title, message, onClose }: { type: string, title: string, message: string, onClose: () => void }) {
    const isAlert = type === "alert" || type === "error";

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className={cn(
                "fixed inset-0 z-[1000] flex flex-col items-center justify-center p-8 backdrop-blur-md transition-colors duration-500",
                type === "success" ? "bg-emerald-600/95" : "bg-[#B20D30]/95"
            )}
        >
            <motion.div
                initial={{ scale: 0.8, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.8, y: 20 }}
                className="flex flex-col items-center text-center max-w-2xl"
            >
                <div className="w-32 h-32 rounded-[3rem] flex items-center justify-center mb-10 shadow-2xl relative bg-white text-[#B20D30]">
                    {type === "success" && <CheckCircle2 size={64} strokeWidth={2.5} />}
                    {type === "error" && <X size={64} strokeWidth={2.5} />}
                    {type === "info" && <UserCheck size={64} strokeWidth={2.5} />}
                    {type === "alert" && <Siren size={64} strokeWidth={2.5} className="animate-bounce" />}

                    {/* Pulsating Ring */}
                    <motion.div
                        animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className="absolute inset-0 rounded-[3rem] border-4 border-white"
                    />
                </div>

                <h2 className="text-6xl font-black text-white uppercase tracking-tighter mb-4">
                    {title}
                </h2>
                <p className="text-xl font-black text-white/60 uppercase tracking-widest leading-relaxed">
                    {message}
                </p>

                <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 2, ease: "linear" }}
                    className="h-2 bg-white/20 w-80 mt-12 rounded-full origin-left"
                />
            </motion.div>
        </motion.div>
    );
}
