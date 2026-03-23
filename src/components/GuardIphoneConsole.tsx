"use client";
/* eslint-disable */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Activity, History as HistoryIcon, Map as MapIcon,
    Bell, Siren, LogIn, LogOut, Search, User as UserIcon,
    Camera, Mic, Trash2, Volume2, CheckCircle2,
    X, MoreVertical, Shield, Settings, Landmark,
    Building2, FileText, UserCheck, Briefcase, Plus,
    Flame, Home, Download, Clock, ImageIcon, Loader2,
    Car, Bike, Smartphone, ChevronRight, Square,
    ShieldAlert, UserX, CarFront, Filter, RefreshCw, AlertTriangle, Scan,
    ChevronUp
} from "lucide-react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { sileo as toast } from "sileo";
import { createBitacoraEntry, searchRecentBitacora } from "@/app/actions/bitacora";
import { submitRegistrationSuggestion } from "@/app/actions/registrations";
import { getAccessEvents as getLprHistory, getPlateAnalysis } from "@/app/actions/history";
import { searchUsers } from "@/app/actions/search";
import { searchByPhotoAction } from "@/app/actions/face-verify";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

const LiveGuardMap = dynamic(() => import("@/components/LiveGuardMap"), { ssr: false });
const OCRScanner = dynamic(() => import("@/components/OCRScannerTF"), { ssr: false });

type TabType = "control" | "history" | "registro" | "lpr" | "alerts" | "faces";

interface Unit {
    id: string;
    name: string;
    number: string;
}

interface GuardIphoneConsoleProps {
    initialEntries?: any[];
    initialFaceEntries?: any[];
    logo?: string;
    headerColor?: string;
    initialIcons?: Record<string, string>;
    units?: any[];
    guards?: any[];
}

export default function GuardIphoneConsole({
    initialEntries = [],
    initialFaceEntries = [],
    logo = "/logo-transparent.png",
    headerColor = "#000000",
    initialIcons = {},
    units = [],
    guards = []
}: GuardIphoneConsoleProps) {
    const [activeTab, setActiveTab] = useState<TabType>("control");
    const [guardName, setGuardName] = useState("");
    const [guardPhoto, setGuardPhoto] = useState<string | null>(null);
    const [showIdentityOverlay, setShowIdentityOverlay] = useState(true);
    const [isAlertMode, setIsAlertMode] = useState(false);

    // Form States
    const [type, setType] = useState<"ENTRY" | "EXIT">("ENTRY");
    const [plate, setPlate] = useState("");
    const [name, setName] = useState("");
    const [dni, setDni] = useState("");
    const [destination, setDestination] = useState("");
    const [notes, setNotes] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Face States
    const [faceEntries, setFaceEntries] = useState<any[]>(initialFaceEntries);
    const [isSearchingFace, setIsSearchingFace] = useState(false);
    const [faceMatchResult, setFaceMatchResult] = useState<any>(null);
    const [faceSearchMode, setFaceSearchMode] = useState(false);

    // Login State
    const [loginUser, setLoginUser] = useState("");
    const [loginPass, setLoginPass] = useState("");

    // UI Helpers
    const [entries, setEntries] = useState(initialEntries);
    const [lprEntries, setLprEntries] = useState<any[]>([]);
    const [unitsList, setUnitsList] = useState<Unit[]>(units);
    const [selectedEntry, setSelectedEntry] = useState<any>(null);
    const [zoomImage, setZoomImage] = useState<string | null>(null);
    const [lprSearch, setLprSearch] = useState("");
    const [historySearch, setHistorySearch] = useState("");
    const [userSuggestions, setUserSuggestions] = useState<any[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [plateReport, setPlateReport] = useState<any>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    // Media States
    const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);

    // Map & Mission States
    const [monitoringMissions, setMonitoringMissions] = useState<any[]>([]);
    const [incomingBackup, setIncomingBackup] = useState<any>(null);
    const [showReportModal, setShowReportModal] = useState(false);
    const [backupDetail, setBackupDetail] = useState("");
    const [isReporting, setIsReporting] = useState(false);
    const [activeMission, setActiveMission] = useState<any>(null);
    const [showResolutionModal, setShowResolutionModal] = useState(false);
    const [backupLocation, setBackupLocation] = useState<any>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);

    const alarmAudioRef = useRef<HTMLAudioElement | null>(null);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [showUpdateSplash, setShowUpdateSplash] = useState(false);
    const [recentRecords, setRecentRecords] = useState<any[]>([]);
    const [showSearchFillModal, setShowSearchFillModal] = useState(false);
    const [isSearchingRecords, setIsSearchingRecords] = useState(false);
    const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [otherGuards, setOtherGuards] = useState<any[]>([]);
    const [isOCRActive, setIsOCRActive] = useState(false);

    // Registration Suggestion States
    const [regType, setRegType] = useState<"HOUSE" | "PERSON">("HOUSE");
    const [regName, setRegName] = useState("");
    const [regHouseNumber, setRegHouseNumber] = useState("");
    const [regAddress, setRegAddress] = useState("");
    const [regDni, setRegDni] = useState("");
    const [regPhone, setRegPhone] = useState("");
    const [regUnitId, setRegUnitId] = useState("");
    const [isSubmittingReg, setIsSubmittingReg] = useState(false);

    const socketRef = useRef<any>(null);
    const isFirstAlertStatusReceived = useRef(false);

    useEffect(() => {
        const storedGuardName = localStorage.getItem("bitacora_guard_name");
        const storedGuardPhoto = localStorage.getItem("bitacora_guard_photo");
        if (storedGuardName) {
            setGuardName(storedGuardName);
            setGuardPhoto(storedGuardPhoto);
            setShowIdentityOverlay(false);
        }

        const socketUrl = getSocketUrl();
        socketRef.current = io(socketUrl, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            transports: ['websocket', 'polling']
        });

        // Request notification permission for panic and mission alerts
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }

        socketRef.current.on("connect", () => {
            console.log("Socket connected:", socketRef.current?.id);
            toast.success({ title: "Conectado al servidor en tiempo real" });
        });

        socketRef.current.onAny((eventName: string, ...args: any[]) => {
            console.log(`DEBUG-SOCKET [${eventName}]:`, args);
        });

        socketRef.current.on("disconnect", () => {
            console.warn("Socket disconnected");
            toast.show({ title: "Reconectando...", duration: null });
        });

        socketRef.current.on("new_bitacora", (entry: any) => {
            setEntries((prev: any) => {
                if (prev.some((e: any) => e.id === entry.id)) return prev;
                return [entry, ...prev].slice(0, 100);
            });
        });

        socketRef.current.on("access_event", (event: any) => {
            // Handle LPR events
            if (event.accessType === "PLATE" || event.plateDetected) {
                setLprEntries(prev => {
                    if (prev.some(e => e.id === event.id)) return prev;
                    return [event, ...prev].slice(0, 100);
                });
            }
            
            // Handle FACE events (Real-time update)
            if (event.accessType === "FACE") {
                setFaceEntries(prev => {
                    if (prev.some(e => e.id === event.id)) return prev;
                    return [event, ...prev].slice(0, 100);
                });
                
                const person = event.userName || event.user?.name || "Desconocido";
                toast.show({ 
                    title: `ROSTRO DETECTADO: ${person}`,
                    description: `Ubicación: ${event.location || event.device?.name || 'Cámara'}`,
                    duration: 5000 
                });
            }
        });

        socketRef.current.on("alert_status", (data: any) => {
            setIsAlertMode(prev => {
                if (!isFirstAlertStatusReceived.current) {
                    isFirstAlertStatusReceived.current = true;
                    return data.active;
                }

                if (prev !== data.active) {
                    if (data.active) {
                        toast.error({
                            title: `⚠️ ALERTA ACTIVADA${data.triggeredBy ? ` por ${data.triggeredBy}` : ""}`
                        });
                        // Browser push notification
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("⚠️ ALERTA DE SEGURIDAD - OMNIACCESS GUARD", {
                                body: `Modo de alerta activado por ${data.triggeredBy || "un compañero"}.`,
                                icon: "/icons/sildan-icon-dot.png",
                                tag: "security-alert"
                            });
                        }
                        if ('setAppBadge' in navigator) (navigator as any).setAppBadge(1).catch(() => { });
                    } else {
                        const message = data.explanation
                            ? `Sistema normalizado. Motivo: ${data.explanation}`
                            : "Sistema normalizado correctamente.";
                        toast.success({ title: `✅ ${message}` });
                        if ('clearAppBadge' in navigator) (navigator as any).clearAppBadge().catch(() => { });
                    }
                }
                return data.active;
            });
        });

        socketRef.current.on("guard_locations", (guards: any[]) => {
            const currentName = localStorage.getItem("bitacora_guard_name");
            setOtherGuards(guards.filter(g => g.name !== currentName));
        });

        // MISSION LISTENERS
        socketRef.current.on('active_missions', (data: any[]) => {
            setMonitoringMissions(data);
        });

        socketRef.current.on('backup_requested', (data: any) => {
            setIncomingBackup(data);
            setMonitoringMissions(prev => {
                if (prev.find(m => m.id === data.id)) return prev;
                return [...prev, data];
            });
            if ("vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 500]);
            playTactileSound();
            toast.error({ title: `⚠️ ALERTA: ${data.type} por ${data.requesterName}` });

            // Browser push notification (Local)
            if ("Notification" in window && Notification.permission === "granted") {
                new Notification("⚠️ SOLICITUD DE APOYO", {
                    body: `${data.type} reportado por ${data.requesterName}.`,
                    icon: "/iconos/sildan-pwa.png",
                    tag: "mission-alert",
                    requireInteraction: true
                });
            }
        });

        socketRef.current.on('backup_status_update', (data: any) => {
            setMonitoringMissions(prev => prev.map(m =>
                m.id === data.requestId
                    ? { ...m, status: data.accepted ? 'ACCEPTED' : 'REJECTED', responderId: data.responderId, responderName: data.responderName }
                    : m
            ));
            if (data.accepted) {
                toast.success({ title: `${data.responderName} aceptó la solicitud.` });
            }
        });

        socketRef.current.on('backup_resolved', (data: any) => {
            setMonitoringMissions(prev => prev.filter(m => m.id !== data.requestId));
            setIncomingBackup(null);
            toast.success({ title: `Incidente resuelto por ${data.resolverName}.` });
        });

        socketRef.current.on('backup_cancelled', (data: any) => {
            setMonitoringMissions(prev => prev.filter(m => m.id !== data.requestId));
            setIncomingBackup(null);
            toast.info({ title: `Alerta cancelada.` });
        });

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
            if (alarmAudioRef.current) {
                alarmAudioRef.current.pause();
                alarmAudioRef.current.currentTime = 0;
            }
        };
    }, []); // Run only once to establish stable connection

    // Alarm Audio Control
    useEffect(() => {
        if (isAlertMode) {
            if (!alarmAudioRef.current) {
                alarmAudioRef.current = new Audio("https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg");
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
        const query = (plate.length >= 3) ? plate : (destination.length >= 3 ? destination : "");
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
    }, [plate, destination]);

    useEffect(() => {
        if (isRecording) {
            setRecordingDuration(0);
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);
        } else {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        }
    }, [isRecording]);

    useEffect(() => {
        if ("geolocation" in navigator) {
            const watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    setLocation(newLoc);
                    if (socketRef.current) {
                        socketRef.current.emit("guard_location_update", {
                            guardName: guardName,
                            lat: newLoc.lat,
                            lng: newLoc.lng,
                            timestamp: Date.now()
                        });
                    }
                },
                (err) => console.error("Geo error:", err),
                { enableHighAccuracy: true }
            );
            return () => navigator.geolocation.clearWatch(watchId);
        }
    }, [guardName]);

    useEffect(() => {
        return () => {
            if (cameraStreamRef.current) {
                cameraStreamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

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
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            gain.gain.setValueAtTime(0.01, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.05);
        } catch (e) { }
    }, []);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleRegister = async () => {
        if (!plate.trim()) {
            toast.error({ title: "La matrícula es obligatoria" });
            return;
        }

        setIsSubmitting(true);
        playTactileSound();
        try {
            const formData = new FormData();
            formData.append("type", type);
            formData.append("plate", plate);
            formData.append("name", name);
            formData.append("dni", dni);
            formData.append("destination", destination);
            formData.append("notes", notes);
            formData.append("guardName", guardName);
            const finalLocation = location;
            if (finalLocation) {
                formData.append("latitude", finalLocation.lat.toString());
                formData.append("longitude", finalLocation.lng.toString());
            }

            if (capturedPhoto) {
                const res = await fetch(capturedPhoto);
                const blob = await res.blob();
                formData.append("photo", blob, "photo.jpg");
            }

            if (audioBlob) {
                formData.append("audio", audioBlob, "audio.webm");
            }

            const result = await createBitacoraEntry(formData);
            if (result) {
                toast.success({ title: "Acceso registrado correctamente" });
                setPlate("");
                setName("");
                setDni("");
                setDestination("");
                setNotes("");
                setCapturedPhoto(null);
                setAudioBlob(null);
                setEntries((prev: any) => [result, ...prev]);
                setActiveTab("history");
            }
        } catch (error) {
            console.error("Register error:", error);
            toast.error({ title: "Error al registrar el acceso" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFaceSearch = async (imageBlob: Blob) => {
        setIsSearchingFace(true);
        playTactileSound();
        try {
            const arrayBuffer = await imageBlob.arrayBuffer();
            const result = await searchByPhotoAction(new Uint8Array(arrayBuffer));
            if (result.success && result.user) {
                setFaceMatchResult(result);
                toast.success({ title: `Identificado: ${result.user.name}` });
            } else {
                setFaceMatchResult({ success: true, match: null, user: null });
                toast.info({ title: "Persona no identificada en la base de datos" });
            }
        } catch (error) {
            console.error("Face Search error:", error);
            toast.error({ title: "Error en la búsqueda biométrica" });
        } finally {
            setIsSearchingFace(false);
        }
    };

    const handleOCRDetected = (detectedPlate: string | null, imageBlob: Blob) => {
        if (faceSearchMode) {
            handleFaceSearch(imageBlob);
            setFaceSearchMode(false);
            return;
        }

        if (detectedPlate !== null) setPlate(detectedPlate);

        // Convert blob to data URL for preview and existing logic
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

    const handleReportSupport = async (type: string) => {
        if (!socketRef.current || !location) {
            toast.error({ title: "Ubicación GPS no disponible" });
            return;
        }

        setIsReporting(true);
        try {
            const mission = {
                id: 'req-' + Date.now(),
                type: type,
                lat: backupLocation?.lat || location.lat,
                lng: backupLocation?.lng || location.lng,
                requesterName: guardName || "Guardia iPhone",
                requesterId: socketRef.current.id,
                status: 'PENDING',
                details: backupDetail
            };

            socketRef.current.emit('request_backup', mission);
            setShowReportModal(false);
            setBackupDetail("");
            toast.success({ title: "Solicitud de apoyo enviada" });
        } catch (error) {
            console.error("SOS Error:", error);
            toast.error({ title: "Error al enviar SOS" });
        } finally {
            setIsReporting(false);
        }
    };

    const handleConfirmIdentity = (guard: any) => {
        const pinCheck = prompt(`Ingrese PIN de seguridad para ${guard.name}:`);
        if (pinCheck && pinCheck === guard.password) {
            setGuardName(guard.name);
            const photoUrl = guard.cara ? (guard.cara.startsWith('/') ? guard.cara : `/api/files/${guard.cara}`) : null;
            setGuardPhoto(photoUrl);
            localStorage.setItem("bitacora_guard_name", guard.name);
            if (photoUrl) localStorage.setItem("bitacora_guard_photo", photoUrl);
            setShowIdentityOverlay(false);
            toast.success({ title: `Bienvenido, ${guard.name}` });
        } else if (pinCheck) {
            toast.error({ title: "PIN Incorrecto" });
        }
    };

    const handleManualLogin = (e: React.FormEvent) => {
        e.preventDefault();

        const guard = guards.find(g => (g.username || g.name).toLowerCase() === loginUser.toLowerCase());

        if (guard && guard.password === loginPass) {
            setGuardName(guard.name);
            const photoUrl = guard.cara ? (guard.cara.startsWith('/') ? guard.cara : `/api/files/${guard.cara}`) : null;
            setGuardPhoto(photoUrl);
            localStorage.setItem("bitacora_guard_name", guard.name);
            if (photoUrl) localStorage.setItem("bitacora_guard_photo", photoUrl);
            setShowIdentityOverlay(false);
            toast.success({ title: `Bienvenido, ${guard.name}` });

            // Reset form
            setLoginUser("");
            setLoginPass("");
        } else {
            toast.error({ title: "Credenciales incorrectas" });
        }
    };

    // Media Handlers
    const startCamera = async () => {
        stopCamera();
        setIsCameraActive(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            cameraStreamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err) {
            toast.error({ title: "No se pudo acceder a la cámara" });
            setIsCameraActive(false);
        }
    };

    const stopCamera = () => {
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(t => t.stop());
            cameraStreamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        setIsCameraActive(false);
    };

    const takePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d")?.drawImage(video, 0, 0);
            setCapturedPhoto(canvas.toDataURL("image/jpeg"));
            stopCamera();
            toast.success({ title: "Foto capturada" });
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];
            mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                setAudioBlob(blob);
                stream.getTracks().forEach(t => t.stop());
            };
            mediaRecorderRef.current.start();
            setIsRecording(true);
        } catch (err) {
            toast.error({ title: "Permiso de micrófono denegado" });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            toast.success({ title: "Audio grabado" });
        }
    };

    // Correcting LPR and Faces Fetching
    useEffect(() => {
        if (activeTab === "lpr") {
            const fetchLpr = async () => {
                const { events } = await getLprHistory({ take: 100, type: "PLATE" });
                if (events) setLprEntries(events);
            };
            fetchLpr();
        } else if (activeTab === "faces") {
            const fetchFaces = async () => {
                const { events } = await getLprHistory({ take: 100, type: "FACE" });
                if (events) setFaceEntries(events);
            };
            fetchFaces();
        }
    }, [activeTab]);

    // INTELLIGENT AUTOCOMPLETE: Search users when typing
    useEffect(() => {
        const searchQuery = plate || name || dni;
        if (!searchQuery || searchQuery.length < 2) {
            setUserSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        const timer = setTimeout(async () => {
            const results = await searchUsers(searchQuery);
            setUserSuggestions(results);
            setShowSuggestions(results.length > 0);
        }, 500);

        return () => clearTimeout(timer);
    }, [plate, name, dni]);



    const toggleAlertMode = (forcedState?: boolean) => {
        if (!socketRef.current) return;
        const newState = forcedState !== undefined ? forcedState : !isAlertMode;
        socketRef.current.emit("alert_toggle", {
            active: newState,
            triggeredBy: guardName || "Invitado Móvil",
            explanation: ""
        });
    };

    const [panicHoldProgress, setPanicHoldProgress] = useState(0);
    const panicHoldRef = useRef<any>(null);

    const startPanicHold = () => {
        if (isAlertMode) return;
        playTactileSound();
        let start = Date.now();
        panicHoldRef.current = setInterval(() => {
            let elapsed = Date.now() - start;
            let progress = Math.min((elapsed / 2000) * 100, 100);
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
        if (panicHoldRef.current) {
            clearInterval(panicHoldRef.current);
            setPanicHoldProgress(0);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-50 text-slate-900 flex flex-col overflow-hidden font-sans">
            {/* Header - Hidden in Faces tab for full screen effect */}
            {activeTab !== "faces" && (
                <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 z-50">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#B20D30] flex items-center justify-center text-white">
                            <Shield size={16} />
                        </div>
                        <div>
                            <h1 className="text-sm font-black uppercase tracking-tight">Omniaccess Guard</h1>
                            <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-[10px] text-slate-500 font-bold uppercase">Online</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {isAlertMode && (
                            <div className="px-3 py-1 bg-red-600 text-white rounded-full text-[10px] font-black animate-pulse flex items-center gap-1.5">
                                <Siren size={12} /> ALERTA
                            </div>
                        )}
                        <button
                            onClick={() => setShowSettingsModal(true)}
                            className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 overflow-hidden border border-slate-200"
                        >
                            {guardPhoto ? (
                                <Image src={guardPhoto} alt="Guard" width={40} height={40} className="object-cover" />
                            ) : (
                                <UserIcon size={20} />
                            )}
                        </button>
                    </div>
                </header>
            )}

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative">
                <AnimatePresence mode="wait">
                    {activeTab === "control" && (
                        <motion.div
                            key="control"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="h-full overflow-y-auto px-5 pt-6 pb-32 custom-scrollbar"
                        >
                            <div className="space-y-6">
                                {/* Entry/Exit Toggle */}
                                <div className="p-1 bg-slate-200/50 rounded-2xl flex gap-1">
                                    <button
                                        onClick={() => { setType("ENTRY"); playTactileSound(); }}
                                        className={cn(
                                            "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-xs font-black uppercase transition-all",
                                            type === "ENTRY" ? "bg-white text-blue-600 shadow-sm" : "text-slate-400"
                                        )}
                                    >
                                        <LogIn size={16} /> Ingreso
                                    </button>
                                    <button
                                        onClick={() => { setType("EXIT"); playTactileSound(); }}
                                        className={cn(
                                            "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-xs font-black uppercase transition-all",
                                            type === "EXIT" ? "bg-white text-orange-600 shadow-sm" : "text-slate-400"
                                        )}
                                    >
                                        <LogOut size={16} /> Salida
                                    </button>
                                </div>

                                {/* Plate Input */}
                                <div className="space-y-4">
                                    <Label className="text-[10px] font-black uppercase text-slate-400 tracking-widest block text-center">Matrícula Detectada</Label>
                                    <TactilePlateInputMobile
                                        value={plate}
                                        onChange={setPlate}
                                        playTactileSound={playTactileSound}
                                    />
                                </div>

                                {/* Form Fields */}
                                <div className="space-y-4">
                                    <AppFieldMobile
                                        label="Nombre Completo"
                                        icon={<UserIcon size={14} />}
                                        value={name}
                                        onChange={setName}
                                        placeholder="Nombre del visitante..."
                                    />
                                    <AppFieldMobile
                                        label="Documento (DNI/CI)"
                                        icon={<FileText size={14} />}
                                        value={dni}
                                        onChange={setDni}
                                        placeholder="Número de documento..."
                                    />
                                    <AppFieldMobile
                                        label="Unidad o Referente"
                                        icon={<Home size={14} />}
                                        value={destination}
                                        onChange={setDestination}
                                        placeholder="Destino..."
                                    />

                                    {/* AUTOCOMPLETE SUGGESTIONS */}
                                    <AnimatePresence>
                                        {showSuggestions && userSuggestions.length > 0 && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                className="bg-white rounded-2xl border-2 border-blue-200 shadow-lg overflow-hidden"
                                            >
                                                <div className="p-3 bg-blue-50 border-b border-blue-100">
                                                    <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest flex items-center gap-2">
                                                        <UserIcon size={12} /> Usuario(s) Conocido(s)
                                                    </p>
                                                </div>
                                                <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                                                    {userSuggestions.map((user: any) => (
                                                        <button
                                                            key={user.id}
                                                            onClick={() => {
                                                                if (confirm(`¿Autocompletar con ${user.name}?`)) {
                                                                    setName(user.name || "");
                                                                    setDni(user.dni || "");
                                                                    setDestination(user.unit || "");
                                                                    if (user.vehicles?.length > 0 && !plate) {
                                                                        setPlate(user.vehicles[0].plate || "");
                                                                    }
                                                                    setShowSuggestions(false);
                                                                    playTactileSound();
                                                                    toast.success({ title: "✅ Datos autocompletados" });
                                                                }
                                                            }}
                                                            className="w-full p-4 text-left hover:bg-blue-50 transition-colors active:bg-blue-100"
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                                                                    <UserIcon size={18} />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-black text-sm text-slate-900 truncate">{user.name}</p>
                                                                    <p className="text-[10px] text-slate-500 font-bold">DNI: {user.dni || "N/A"}</p>
                                                                    {user.unit && <p className="text-[10px] text-blue-600 font-bold">📍 {user.unit}</p>}
                                                                    {user.vehicles?.length > 0 && (
                                                                        <div className="flex gap-1 mt-1 flex-wrap">
                                                                            {user.vehicles.map((v: any, i: number) => (
                                                                                <span key={i} className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black text-slate-600">
                                                                                    {v.plate}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        setShowSuggestions(false);
                                                        playTactileSound();
                                                    }}
                                                    className="w-full p-3 bg-slate-50 text-[10px] font-black uppercase text-slate-400 hover:bg-slate-100 transition-colors"
                                                >
                                                    Cerrar
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <div className="pt-2 space-y-4">
                                        <div className="flex gap-4">
                                            <button
                                                onClick={() => { setIsOCRActive(true); playTactileSound(); }}
                                                className={cn(
                                                    "flex-1 h-14 rounded-2xl flex items-center justify-center gap-2 border-2 transition-all active:scale-95",
                                                    capturedPhoto ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-white border-slate-100 text-slate-400"
                                                )}
                                            >
                                                <Camera size={20} />
                                                <span className="text-[10px] font-black uppercase tracking-widest">{capturedPhoto ? "Cambiar Foto" : "Tomar Foto"}</span>
                                            </button>
                                            <button
                                                onClick={() => { isRecording ? stopRecording() : startRecording(); playTactileSound(); }}
                                                className={cn(
                                                    "flex-1 h-14 rounded-2xl flex items-center justify-center gap-2 border-2 transition-all active:scale-95",
                                                    isRecording ? "bg-red-50 border-red-200 text-red-600 animate-pulse" :
                                                        audioBlob ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white border-slate-100 text-slate-400"
                                                )}
                                            >
                                                <Mic size={20} />
                                                <span className="text-[10px] font-black uppercase tracking-widest">
                                                    {isRecording ? formatDuration(recordingDuration) : audioBlob ? "Audio Listo" : "Grabar Audio"}
                                                </span>
                                            </button>
                                        </div>

                                        <button
                                            disabled={isSubmitting || !plate.trim()}
                                            onClick={handleRegister}
                                            className={cn(
                                                "w-full h-16 rounded-2xl font-black uppercase tracking-[0.2em] text-sm shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3",
                                                type === "ENTRY"
                                                    ? "bg-blue-600 text-white shadow-blue-500/20"
                                                    : "bg-orange-600 text-white shadow-orange-500/20",
                                                "disabled:bg-slate-200 disabled:text-slate-400"
                                            )}
                                        >
                                            {isSubmitting ? (
                                                <Loader2 size={24} className="animate-spin" />
                                            ) : (
                                                <>
                                                    <Activity size={20} />
                                                    Finalizar Registro
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {activeTab === "history" && (
                        <motion.div
                            key="history"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full overflow-y-auto px-5 pt-6 pb-32"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-black uppercase text-slate-900 tracking-tight">Bitácora</h2>
                            </div>

                            <div className="relative mb-6">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <Input
                                    value={historySearch}
                                    onChange={(e) => setHistorySearch(e.target.value)}
                                    placeholder="Buscar por matrícula, nombre o destino..."
                                    className="h-14 pl-12 rounded-2xl bg-white border-slate-200 font-bold shadow-sm"
                                />
                            </div>

                            <div className="space-y-4">
                                {(() => {
                                    const filteredEntries = entries.filter((e: any) =>
                                        !historySearch ||
                                        e.plate?.toLowerCase().includes(historySearch.toLowerCase()) ||
                                        e.name?.toLowerCase().includes(historySearch.toLowerCase()) ||
                                        e.destination?.toLowerCase().includes(historySearch.toLowerCase()) ||
                                        e.dni?.toLowerCase().includes(historySearch.toLowerCase())
                                    );

                                    if (filteredEntries.length === 0) return (
                                        <div className="py-20 text-center opacity-20">
                                            <FileText size={64} className="mx-auto mb-4" />
                                            <p className="font-black uppercase tracking-widest">Sin registros</p>
                                        </div>
                                    );

                                    return filteredEntries.map((entry: any) => (
                                        <button
                                            key={entry.id}
                                            onClick={() => setSelectedEntry(entry)}
                                            className="bg-white p-5 rounded-[2rem] border-2 border-slate-100 shadow-sm flex flex-col gap-4 active:scale-[0.98] transition-all text-left"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-16 h-16 rounded-2xl bg-slate-50 shrink-0 overflow-hidden relative border border-slate-200">
                                                    {entry.photoPath ? (
                                                        <Image src={entry.photoPath} alt="Entry" fill className="object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-slate-200">
                                                            <ImageIcon size={24} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-0.5">
                                                        <span className="px-2 py-0.5 bg-slate-900 shadow-lg text-white rounded-md text-sm font-black uppercase tracking-tighter">{entry.plate || "S/N"}</span>
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded-md text-[8px] font-black uppercase",
                                                            entry.type === "ENTRY" ? "bg-blue-50 text-blue-600" : entry.type === "ALERTA" ? "bg-red-50 text-red-600 animate-pulse" : "bg-orange-50 text-orange-600"
                                                        )}>
                                                            {entry.type === "ENTRY" ? "Ingreso" : entry.type === "ALERTA" ? "Alerta" : "Egreso"}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs font-black text-slate-800 truncate uppercase">{entry.name || "Reservado"}</p>
                                                    <p className="text-[9px] font-bold text-slate-400">
                                                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(entry.timestamp).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="bg-slate-50 rounded-xl p-2 border border-slate-100 flex flex-col justify-center">
                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Destino</p>
                                                    <p className="text-[10px] font-black text-[#B20D30] uppercase truncate">{entry.destination || "---"}</p>
                                                </div>
                                                <div className="bg-slate-50 rounded-xl p-2 border border-slate-100 flex flex-col justify-center">
                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Cámara / Origen</p>
                                                    <p className="text-[10px] font-black text-slate-800 uppercase truncate">
                                                        {entry.accessEvent?.device?.name || "Registro Manual"}
                                                    </p>
                                                </div>
                                            </div>
                                        </button>
                                    ));
                                })()}
                            </div>
                        </motion.div>
                    )}

                    {activeTab === "lpr" && (
                        <motion.div
                            key="lpr"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full overflow-y-auto px-5 pt-6 pb-32"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-black uppercase text-slate-900 tracking-tight">Matrículas LPR</h2>
                                <button className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                                    <Filter size={18} />
                                </button>
                            </div>

                            <div className="relative mb-6">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <Input
                                    value={lprSearch}
                                    onChange={(e) => setLprSearch(e.target.value)}
                                    placeholder="Buscar por matrícula o nombre..."
                                    className="h-14 pl-12 rounded-2xl bg-white border-slate-200 font-bold shadow-sm"
                                />
                            </div>

                            <div className="space-y-3">
                                {(() => {
                                    const filteredLpr = lprEntries.filter(e =>
                                        !lprSearch ||
                                        e.plateDetected?.toLowerCase().includes(lprSearch.toLowerCase()) ||
                                        e.user?.name?.toLowerCase().includes(lprSearch.toLowerCase())
                                    );
                                    if (filteredLpr.length === 0) return (
                                        <div className="py-20 text-center opacity-20">
                                            <Car size={48} className="mx-auto mb-3" />
                                            <p className="font-black uppercase tracking-widest text-xs">Sin registros LPR</p>
                                        </div>
                                    );
                                    return filteredLpr.map((event: any) => (
                                        <button
                                            key={event.id}
                                            onClick={() => setSelectedEntry({ ...event, _lpr: true })}
                                            className="w-full bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 active:scale-[0.98] transition-all text-left"
                                        >
                                            <div className="w-14 h-14 rounded-xl bg-slate-100 shrink-0 overflow-hidden relative border border-slate-200">
                                                {event.snapshotPath ? (
                                                    <Image src={event.snapshotPath} alt="LPR" fill className="object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                                                        <Car size={20} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="px-2 py-0.5 bg-slate-900 text-white rounded-md text-xs font-black uppercase tracking-tighter">{event.plateDetected || "---"}</span>
                                                    <span className={cn("px-2 py-0.5 rounded-md text-[8px] font-black uppercase", event.direction === "ENTRY" ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>{event.direction === "ENTRY" ? "Ingreso" : "Egreso"}</span>
                                                </div>
                                                <p className="text-[10px] font-bold text-slate-500 truncate">{event.user?.name || "No Identificado"} {event.user?.unit?.name ? `· ${event.user.unit.name}` : ""}</p>
                                                <p className="text-[9px] font-bold text-slate-400">Cámara: {event.deviceName}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[10px] font-bold text-slate-900">{new Date(event.timestamp).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' })}</p>
                                                <p className="text-[9px] font-black text-slate-400">{new Date(event.timestamp).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</p>
                                            </div>
                                            <ChevronRight size={14} className="text-slate-200 shrink-0" />
                                        </button>
                                    ));
                                })()}
                            </div>
                        </motion.div>
                    )}

                    {activeTab === "alerts" && (
                        <motion.div
                            key="alerts"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full overflow-y-auto px-5 pt-6 pb-32"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-black uppercase text-slate-900 tracking-tight">Eventos Críticos</h2>
                                <div className="flex items-center gap-1">
                                    {isAlertMode && (
                                        <div className="px-3 py-1 bg-red-600 text-white rounded-full text-[9px] font-black animate-pulse flex items-center gap-1 shadow-lg shadow-red-600/20">
                                            <Siren size={10} /> ALERTA ACTIVA
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={() => { playTactileSound(); setShowReportModal(true); }}
                                className="w-full h-16 mb-8 bg-orange-600 text-white rounded-[2rem] flex items-center justify-center gap-3 shadow-xl shadow-orange-600/20 active:scale-95 transition-all text-sm font-black uppercase tracking-widest"
                            >
                                <ShieldAlert size={20} /> Reportar SOS
                                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                                    <Plus size={16} />
                                </div>
                            </button>

                            <div className="space-y-3">
                                {(() => {
                                    const alertArr = entries.filter((e: any) => e.type && e.type.includes("ALERTA"));
                                    if (alertArr.length === 0) return (
                                        <div className="py-20 text-center opacity-20">
                                            <Shield size={48} className="mx-auto mb-3" />
                                            <p className="font-black uppercase tracking-widest text-xs">Sin alertas registradas</p>
                                        </div>
                                    );
                                    return alertArr.map((alert: any) => {
                                        if (alert.plate === "NORMAL" || alert.plate === "Manual") return null;
                                        const deactivationEvent = entries.find((e: any) => e.type === "ALERTA" && (e.plate === "NORMAL" || e.plate === "Manual") && new Date(e.timestamp || e.createdAt).getTime() > new Date(alert.timestamp || alert.createdAt).getTime());
                                        let duration = "---"; let isStillActive = false;
                                        if (deactivationEvent) {
                                            const diff = new Date(deactivationEvent.timestamp || deactivationEvent.createdAt).getTime() - new Date(alert.timestamp || alert.createdAt).getTime();
                                            duration = `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
                                        } else { duration = "ACTIVA"; isStillActive = true; }
                                        const isSOS = alert.plate === "SOS";
                                        return (
                                            <button
                                                key={alert.id}
                                                onClick={() => setSelectedEntry(alert)}
                                                className="w-full bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 active:scale-[0.98] transition-all text-left"
                                            >
                                                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", isSOS ? "bg-orange-100 text-orange-600" : isStillActive ? "bg-red-600 text-white animate-pulse" : "bg-red-100 text-red-600")}>
                                                    <Siren size={20} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-black uppercase text-slate-900 truncate">{alert.guardName || "Sistema"}</p>
                                                    <p className={cn("text-[9px] font-black uppercase", isSOS ? "text-orange-600" : "text-red-600")}>{isSOS ? "Sospechoso" : isStillActive ? "Alerta Activa" : "Alerta Resuelta"}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className={cn("px-2 py-0.5 rounded-md text-[8px] font-black inline-block mb-0.5", isStillActive ? "bg-red-600 text-white animate-pulse" : "bg-emerald-50 text-emerald-600")}>{duration}</div>
                                                    <p className="text-[9px] font-bold text-slate-400">{new Date(alert.timestamp || alert.createdAt).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</p>
                                                </div>
                                                <ChevronRight size={14} className="text-slate-200 shrink-0" />
                                            </button>
                                        );
                                    }).filter(Boolean);
                                })()}
                            </div>
                        </motion.div>
                    )}

                    {activeTab === "registro" && (
                        <motion.div
                            key="registro"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="h-full overflow-y-auto px-5 pt-6 pb-32 custom-scrollbar"
                        >
                            <div className="space-y-6">
                                <section className="text-center">
                                    <h2 className="text-xl font-black uppercase text-slate-900">Sugerir Registro</h2>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Registros pendientes de aprobación por admin</p>
                                </section>

                                <div className="p-1 bg-slate-200/50 rounded-2xl flex gap-1">
                                    <button
                                        onClick={() => { setRegType("HOUSE"); playTactileSound(); }}
                                        className={cn(
                                            "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-[10px] font-black uppercase transition-all",
                                            regType === "HOUSE" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400"
                                        )}
                                    >
                                        <Home size={16} /> Casa / Unidad
                                    </button>
                                    <button
                                        onClick={() => { setRegType("PERSON"); playTactileSound(); }}
                                        className={cn(
                                            "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-[10px] font-black uppercase transition-all",
                                            regType === "PERSON" ? "bg-white text-emerald-600 shadow-sm" : "text-slate-400"
                                        )}
                                    >
                                        <UserIcon size={16} /> Persona
                                    </button>
                                </div>

                                <div className="space-y-4 bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                                    {regType === "HOUSE" ? (
                                        <>
                                            <AppFieldMobile
                                                label="Identificación / Nro Casa"
                                                icon={<Home size={14} />}
                                                value={regHouseNumber}
                                                onChange={setRegHouseNumber}
                                                placeholder="Ej: Casa 45 o Unidad B-202"
                                            />
                                            <AppFieldMobile
                                                label="Nombre Descriptivo (Opcional)"
                                                icon={<Building2 size={14} />}
                                                value={regName}
                                                onChange={setRegName}
                                                placeholder="Ej: Familia Rodriguez"
                                            />
                                            <AppFieldMobile
                                                label="Dirección / Referencia"
                                                icon={<MapIcon size={14} />}
                                                value={regAddress}
                                                onChange={setRegAddress}
                                                placeholder="Calle y número o lote..."
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <AppFieldMobile
                                                label="Nombre Completo"
                                                icon={<UserIcon size={14} />}
                                                value={regName}
                                                onChange={setRegName}
                                                placeholder="Nombre de la persona..."
                                            />
                                            <AppFieldMobile
                                                label="Documento (DNI/CI)"
                                                icon={<FileText size={14} />}
                                                value={regDni}
                                                onChange={setRegDni}
                                                placeholder="Nro de identificación..."
                                            />
                                            <AppFieldMobile
                                                label="Teléfono"
                                                icon={<Smartphone size={14} />}
                                                value={regPhone}
                                                onChange={setRegPhone}
                                                placeholder="Contacto..."
                                            />
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-widest pl-1">Asociar a Unidad</Label>
                                                <select
                                                    value={regUnitId}
                                                    onChange={(e) => setRegUnitId(e.target.value)}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl h-14 px-4 text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500/50 appearance-none"
                                                >
                                                    <option value="">Seleccione una unidad...</option>
                                                    {unitsList.map((u) => (
                                                        <option key={u.id} value={u.id}>{u.name || `Casa ${u.number}`}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    )}

                                    <button
                                        disabled={isSubmittingReg}
                                        onClick={async () => {
                                            setIsSubmittingReg(true);
                                            playTactileSound();
                                            const data = regType === "HOUSE" 
                                                ? { houseNumber: regHouseNumber, name: regName, address: regAddress }
                                                : { name: regName, dni: regDni, phone: regPhone, unitId: regUnitId };
                                            
                                            const res = await submitRegistrationSuggestion(regType, data, guardName);
                                            setIsSubmittingReg(false);
                                            if (res.success) {
                                                toast.success({ title: "Sugerencia enviada correctamente", description: "El administrador revisará el registro." });
                                                setRegName(""); setRegHouseNumber(""); setRegAddress(""); setRegDni(""); setRegPhone(""); setRegUnitId("");
                                            } else {
                                                toast.error({ title: "Error al enviar", description: res.error });
                                            }
                                        }}
                                        className={cn(
                                            "w-full h-16 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl transition-all active:scale-[0.98] mt-4 flex items-center justify-center gap-3",
                                            isSubmittingReg ? "bg-slate-100/50 text-slate-300" : (regType === "HOUSE" ? "bg-indigo-600 shadow-indigo-200" : "bg-emerald-600 shadow-emerald-200") + " text-white"
                                        )}
                                    >
                                        {isSubmittingReg ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={24} />}
                                        {isSubmittingReg ? "Enviando..." : "Enviar Sugerencia"}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Map removed in favor of Registro */}
                    {activeTab === "faces" && (
                        <motion.div
                            key="faces"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="h-full flex flex-col pt-6 pb-32"
                        >
                            <div className="px-5 space-y-6">
                                {/* Search Button */}
                                <button
                                    onClick={() => { setFaceSearchMode(true); setIsOCRActive(true); playTactileSound(); }}
                                    className="w-full h-24 bg-[#B20D30] text-white rounded-[2.5rem] flex items-center justify-between px-8 shadow-2xl shadow-red-900/20 active:scale-95 transition-all group"
                                >
                                    <div className="text-left">
                                        <h2 className="text-xl font-black uppercase tracking-tighter">Buscador Biométrico</h2>
                                        <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Identificar Persona con Cámara</p>
                                    </div>
                                    <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <Scan className="w-8 h-8" />
                                    </div>
                                </button>

                                <div className="space-y-4">
                                    <h3 className="text-xs font-black uppercase text-slate-400 tracking-[0.2em] ml-2 flex items-center gap-2">
                                        <Clock size={14} /> Capturas Recientes
                                    </h3>

                                    {/* Gallery Grid */}
                                    <div className="grid grid-cols-2 gap-3">
                                        {faceEntries.length > 0 ? faceEntries.map((event) => (
                                            <button
                                                key={event.id}
                                                onClick={() => setSelectedEntry(event)}
                                                className="aspect-square bg-white rounded-[2rem] border border-slate-100 overflow-hidden relative group active:scale-95 transition-all shadow-sm"
                                            >
                                                <Image
                                                    src={event.snapshotPath || "/placeholder.jpg"}
                                                    alt="Face"
                                                    fill
                                                    className="object-cover"
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                                                <div className="absolute bottom-4 left-4 right-4 text-left leading-tight">
                                                    <p className="text-[10px] font-black text-white uppercase truncate mb-0.5">
                                                        {event.user?.name || event.details?.match(/Persona: ([^,]+)/)?.[1] || "DESCONOCIDO"}
                                                    </p>
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-[8px] font-bold text-white/60 uppercase">
                                                            {new Date(event.timestamp).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}
                                                        </p>
                                                        <p className="text-[8px] font-bold text-white/40 uppercase truncate max-w-[50%]">
                                                            {event.device?.name || "Cámara"}
                                                        </p>
                                                    </div>
                                                </div>
                                            </button>
                                        )) : (
                                            <div className="col-span-2 py-20 flex flex-col items-center justify-center text-slate-300">
                                                <ImageIcon size={48} strokeWidth={1} />
                                                <p className="text-[10px] font-black uppercase tracking-widest mt-4">Sin capturas faciales hoy</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Face Search Result Modal */}
                    <AnimatePresence>
                        {faceMatchResult && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
                                onClick={() => setFaceMatchResult(null)}
                            >
                                <motion.div
                                    initial={{ scale: 0.9, y: 20 }}
                                    animate={{ scale: 1, y: 0 }}
                                    exit={{ scale: 0.9, y: 20 }}
                                    className="w-full max-w-md bg-white rounded-[3rem] p-8 space-y-8 shadow-2xl relative overflow-hidden"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#B20D30]/5 to-transparent pointer-events-none" />

                                    <div className="flex flex-col items-center text-center space-y-4">
                                        <div className="w-32 h-32 rounded-[40px] border-4 border-white shadow-2xl overflow-hidden relative">
                                            {faceMatchResult.user?.cara ? (
                                                <Image src={faceMatchResult.user.cara.startsWith('/') ? faceMatchResult.user.cara : `/api/files/${faceMatchResult.user.cara}`} alt="Match" fill className="object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-300">
                                                    <UserIcon size={48} />
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-1">
                                            {faceMatchResult.user ? (
                                                <>
                                                    <h3 className="text-3xl font-black tracking-tighter text-slate-900 leading-none uppercase">{faceMatchResult.user.name}</h3>
                                                    <p className="text-[10px] font-bold text-[#B20D30] uppercase tracking-[0.2em]">Identidad Confirmada ({(faceMatchResult.match?.similarity * 100).toFixed(1)}%)</p>
                                                </>
                                            ) : (
                                                <>
                                                    <h3 className="text-3xl font-black tracking-tighter text-slate-400 leading-none">NO IDENTIFICADO</h3>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sin coincidencias en la base de datos</p>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {faceMatchResult.user && (
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Unidad</p>
                                                <p className="text-xs font-black text-slate-900 uppercase">{faceMatchResult.user.unit?.name || "---"}</p>
                                            </div>
                                            <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Categoría</p>
                                                <p className="text-xs font-black text-slate-900 uppercase">{faceMatchResult.user.role}</p>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        onClick={() => setFaceMatchResult(null)}
                                        className="w-full h-16 bg-slate-100 text-slate-900 rounded-[2rem] font-black uppercase tracking-widest text-xs active:scale-95 transition-all"
                                    >
                                        Cerrar Buscador
                                    </button>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </AnimatePresence>
            </main>

            {/* Bottom Navigation */}
            <footer className="h-20 md:h-24 bg-white border-t border-slate-200 px-1 shrink-0 z-50 shadow-[0_-10px_30px_rgba(0,0,0,0.03)] pb-safe">
                <div className="grid grid-cols-5 h-full items-center">
                    <BottomNavItem
                        icon={<UserIcon size={18} />}
                        active={activeTab === "control"}
                        onClick={() => setActiveTab("control")}
                        label="Registrar"
                    />
                    <BottomNavItem
                        icon={<HistoryIcon size={18} />}
                        active={activeTab === "history"}
                        onClick={() => setActiveTab("history")}
                        label="Bitácora"
                    />

                    {/* PERFECTLY Centered Panic Button with Slide-up */}
                    <div className="flex justify-center -mt-8">
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
                            className="relative"
                        >
                            <button
                                onMouseDown={startPanicHold}
                                onMouseUp={cancelPanicHold}
                                onMouseLeave={cancelPanicHold}
                                onTouchStart={startPanicHold}
                                onTouchEnd={cancelPanicHold}
                                onClick={() => { playTactileSound(); }}
                                className={cn(
                                    "w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-95 border-4 border-white overflow-hidden relative group",
                                    isAlertMode ? "bg-red-600 text-white animate-pulse" : "bg-white text-red-600 shadow-red-100"
                                )}
                            >

                                <motion.div
                                    animate={isAlertMode ? { scale: [1, 1.2, 1] } : {}}
                                    transition={{ repeat: Infinity, duration: 1 }}
                                >
                                    <Siren size={28} className={cn("relative z-10", isAlertMode && "scale-110")} />
                                </motion.div>
                            </button>
                            {!isAlertMode && (
                                <motion.div 
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 0.4, y: [0, -5, 0] }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                    className="absolute -top-8 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase text-red-600 whitespace-nowrap pointer-events-none"
                                >
                                    Slide up <ChevronUp size={8} className="inline" />
                                </motion.div>
                            )}
                            {isAlertMode && (
                                <motion.div 
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 0.6, y: [0, 5, 0] }}
                                    transition={{ repeat: Infinity, duration: 2 }}
                                    className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase text-white whitespace-nowrap pointer-events-none"
                                >
                                    Slide down <ChevronUp size={8} className="inline rotate-180" />
                                </motion.div>
                            )}
                        </motion.div>
                    </div>

                    <BottomNavItem
                        icon={<Car size={18} />}
                        active={activeTab === "lpr"}
                        onClick={() => setActiveTab("lpr")}
                        label="LPR"
                    />
                    <BottomNavItem
                        icon={<Plus size={18} />}
                        active={activeTab === "registro"}
                        onClick={() => setActiveTab("registro")}
                        label="Registro"
                    />
                </div>
            </footer>

            {/* Identity Overlay */}
            <AnimatePresence>
                {showIdentityOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-8"
                    >
                        <div className="w-32 h-32 relative mb-12 flex items-center justify-center">
                            <Image
                                src={logo || "/logo-transparent.png"}
                                alt="Logo"
                                fill
                                className="object-contain"
                                priority
                            />
                        </div>
                        <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 mb-2">Omniaccess Guard</h2>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em] mb-12 text-center">Consola Móvil de Seguridad</p>

                        <form onSubmit={handleManualLogin} className="w-full max-w-sm space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">Usuario</Label>
                                    <Input
                                        value={loginUser}
                                        onChange={(e) => setLoginUser(e.target.value)}
                                        placeholder="Ingrese su usuario..."
                                        className="h-14 rounded-2xl bg-slate-50 border-slate-200 font-bold"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">Contraseña</Label>
                                    <Input
                                        type="password"
                                        value={loginPass}
                                        onChange={(e) => setLoginPass(e.target.value)}
                                        placeholder="Ingrese su clave..."
                                        className="h-14 rounded-2xl bg-slate-50 border-slate-200 font-bold"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full h-14 bg-[#B20D30] text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-red-900/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <LogIn size={20} /> Ingresar
                            </button>
                        </form>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Detail Overlay */}
            <AnimatePresence>
                {selectedEntry && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] bg-slate-950/40 backdrop-blur-sm flex items-end"
                        onClick={() => setSelectedEntry(null)}
                    >
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="w-full max-h-[85vh] bg-white rounded-t-[40px] p-8 pb-12 shadow-2xl space-y-6 overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex justify-center">
                                <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
                            </div>

                            {/* Header */}
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900">
                                        {selectedEntry._lpr ? (selectedEntry.plateDetected || "--- ---") : (selectedEntry.plate || "---")}
                                    </h2>
                                    <div className="flex gap-2 flex-wrap">
                                        {selectedEntry._lpr ? (
                                            <>
                                                <span className={cn("text-[9px] font-black uppercase px-2 py-0.5 rounded-md", selectedEntry.direction === "ENTRY" ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600")}>
                                                    {selectedEntry.direction === "ENTRY" ? "Ingreso" : "Egreso"}
                                                </span>
                                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-400">
                                                    LPR
                                                </span>
                                            </>
                                        ) : selectedEntry.type === "ALERTA" ? (() => {
                                            const isPanic = selectedEntry.plate === "PÁNICO";
                                            const isSos = selectedEntry.plate === "SOS";
                                            return (
                                                <span className={cn(
                                                    "text-[9px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1",
                                                    isPanic ? "bg-red-600 text-white animate-pulse" :
                                                        isSos ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-500"
                                                )}>
                                                    {isPanic ? <Siren size={10} /> : isSos ? <ShieldAlert size={10} /> : <CheckCircle2 size={10} />}
                                                    {isPanic ? "Pánico" : isSos ? "S.O.S" : "Manual"}
                                                </span>
                                            );
                                        })() : (
                                            <span className={cn("text-[9px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1", selectedEntry.type === "ENTRY" ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-orange-600")}>
                                                {selectedEntry.type === "ENTRY" ? <LogIn size={10} /> : <LogOut size={10} />}
                                                {selectedEntry.type === "ENTRY" ? "Ingreso Manual" : "Salida Manual"}
                                            </span>
                                        )}
                                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-400">
                                            {new Date(selectedEntry.timestamp || selectedEntry.createdAt).toLocaleString('es-UY')}
                                        </span>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedEntry(null)} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 active:scale-90 transition-all shrink-0">
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Photo / Snapshot */}
                            {(selectedEntry.photoPath || selectedEntry.snapshotPath) && (
                                <div className="w-full aspect-video bg-slate-100 rounded-3xl overflow-hidden relative border border-slate-200 group/image">
                                    <Image
                                        src={selectedEntry.photoPath || selectedEntry.snapshotPath}
                                        alt="Foto"
                                        fill
                                        className="object-cover cursor-zoom-in"
                                        onClick={() => setZoomImage(selectedEntry.photoPath || selectedEntry.snapshotPath)}
                                    />

                                    {/* Report Button overlay on image */}
                                    {selectedEntry.plate && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/5 opacity-0 group-hover/image:opacity-100 transition-opacity">
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    setIsAnalyzing(true);
                                                    const analysis = await getPlateAnalysis(selectedEntry.plate || selectedEntry.plateDetected);
                                                    setPlateReport(analysis);
                                                    setIsAnalyzing(false);
                                                }}
                                                className="bg-[#B20D30] text-white px-6 py-2.5 rounded-full font-black uppercase text-[10px] tracking-widest shadow-2xl flex items-center gap-2 active:scale-95 transition-all"
                                            >
                                                {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                                                REPORTE PATENTE
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Detail Fields */}
                            {selectedEntry._lpr ? (
                                <div className="space-y-3">
                                    <DetailFieldMobile label="Propietario" value={selectedEntry.user?.name || "No Identificado"} icon={<UserIcon />} />
                                    <DetailFieldMobile label="Unidad" value={selectedEntry.user?.unit?.name || "---"} icon={<Home />} />
                                    <DetailFieldMobile label="Cámara" value={selectedEntry.deviceName || selectedEntry.device?.name || "Cámara LPR"} icon={<Camera />} />
                                    {selectedEntry.confidence && <DetailFieldMobile label="Confianza" value={`${Math.round(selectedEntry.confidence * 100)}%`} icon={<CheckCircle2 />} />}
                                    {(() => {
                                        // Vehicle enrichment if available
                                        const vehicle = selectedEntry.user?.vehicles?.[0] || selectedEntry.vehicle;
                                        if (vehicle) {
                                            return <DetailFieldMobile label="Vehículo" value={`${vehicle.brand || ""} ${vehicle.model || ""}`.trim() || "---"} icon={<Car />} />;
                                        }
                                        return null;
                                    })()}
                                </div>
                            ) : selectedEntry.type?.includes("ALERTA") ? (
                                <div className="space-y-3">
                                    <DetailFieldMobile label="Guardia" value={selectedEntry.guardName || "Sistema"} icon={<Shield />} />
                                    <DetailFieldMobile label="Tipo" value={selectedEntry.plate === "SOS" ? "Informó Sospechoso" : "Pánico Activado"} icon={<Siren />} />
                                    <DetailFieldMobile label="Ubicación" value={selectedEntry.location || "Patrimonio"} icon={<MapIcon />} />
                                    {selectedEntry.observations && <DetailFieldMobile label="Observaciones" value={selectedEntry.observations} icon={<FileText />} />}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    <DetailFieldMobile label="Visitante" value={selectedEntry.name} icon={<UserIcon />} />
                                    <DetailFieldMobile label="Documento" value={selectedEntry.dni} icon={<FileText />} />
                                    <DetailFieldMobile label="Destino" value={selectedEntry.destination} icon={<Home />} />
                                    <DetailFieldMobile label="Guardia" value={selectedEntry.guardName} icon={<Shield />} />
                                </div>
                            )}

                            {selectedEntry.notes && (
                                <div className="bg-amber-50 p-5 rounded-3xl border border-amber-200">
                                    <p className="text-[9px] font-black uppercase text-amber-600 tracking-widest mb-2">Observaciones</p>
                                    <p className="text-sm font-medium text-amber-900 leading-relaxed">{selectedEntry.notes}</p>
                                </div>
                            )}

                            {selectedEntry.audioPath && (
                                <div className="flex items-center gap-4 bg-blue-50 p-4 rounded-3xl border border-blue-100">
                                    <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white">
                                        <Volume2 size={24} />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-[9px] font-black uppercase text-blue-600 mb-1">Nota de Audio</p>
                                        <audio
                                            src={selectedEntry.audioPath}
                                            controls
                                            className="w-full h-8"
                                            onError={(e) => {
                                                console.error("Audio Load Error:", e);
                                                toast.error({ title: "Error al cargar el audio. El archivo podría estar procesándose." });
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* SOS REPORT MODAL */}
            <AnimatePresence>
                {showReportModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[300] bg-slate-950/60 backdrop-blur-md flex items-end justify-center"
                        onClick={() => setShowReportModal(false)}
                    >
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="w-full max-w-lg bg-white rounded-t-[40px] p-8 pb-12 shadow-2xl space-y-8"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex justify-center">
                                <div className="w-12 h-1.5 bg-slate-100 rounded-full" />
                            </div>

                            <div className="text-center space-y-2">
                                <h3 className="text-3xl font-black tracking-tighter uppercase text-slate-900 leading-none">Reportar Incidente</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Informar a todas las unidades en su ubicación actual</p>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Detalles del Incidente</Label>
                                    <Input
                                        value={backupDetail}
                                        onChange={(e) => setBackupDetail(e.target.value)}
                                        placeholder="Ingrese una breve descripción..."
                                        className="h-16 rounded-2xl bg-slate-50 border-slate-100 font-bold"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => handleReportSupport("INDIVIDUO SOSPECHOSO")}
                                        disabled={isReporting}
                                        className="h-32 bg-slate-50 border-2 border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-center gap-3 transition-all active:scale-95 text-slate-900 group"
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-white shadow-md flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <UserX size={24} />
                                        </div>
                                        <span className="text-[10px] font-black uppercase leading-tight">Individuo<br />Sospechoso</span>
                                    </button>

                                    <button
                                        onClick={() => handleReportSupport("VEHICULO SOSPECHOSO")}
                                        disabled={isReporting}
                                        className="h-32 bg-slate-50 border-2 border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-center gap-3 transition-all active:scale-95 text-slate-900 group"
                                    >
                                        <div className="w-12 h-12 rounded-2xl bg-white shadow-md flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <CarFront size={24} />
                                        </div>
                                        <span className="text-[10px] font-black uppercase leading-tight">Vehículo<br />Sospechoso</span>
                                    </button>

                                    <button
                                        onClick={() => handleReportSupport("SOLICITUD DE APOYO")}
                                        disabled={isReporting}
                                        className="col-span-2 h-20 bg-red-600 text-white rounded-2xl flex items-center justify-center gap-4 transition-all active:scale-95 shadow-lg shadow-red-600/20"
                                    >
                                        <ShieldAlert size={24} />
                                        <span className="text-sm font-black uppercase tracking-widest">Solicitar Apoyo</span>
                                    </button>
                                </div>
                            </div>

                            <button
                                onClick={() => { setShowReportModal(false); setBackupLocation(null); }}
                                className="w-full py-4 text-[10px] font-black uppercase text-slate-400 hover:text-slate-900 transition-colors"
                            >
                                Cancelar
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>


            {/* Resolution Modal */}
            <AnimatePresence>
                {showResolutionModal && activeMission && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            className="bg-white w-full max-w-md rounded-t-[3rem] sm:rounded-[3rem] p-8 pb-12 sm:pb-8 shadow-2xl relative text-left"
                        >
                            <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden" />

                            <div className="text-center mb-8">
                                <h3 className="text-xl font-black uppercase text-slate-900 mb-2">Gestionar Incidente</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{activeMission.type} - {activeMission.requesterName}</p>
                            </div>

                            <div className="space-y-4 mb-8">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Notas de Intervención</label>
                                    <textarea
                                        value={backupDetail}
                                        onChange={(e) => setBackupDetail(e.target.value)}
                                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-all text-sm resize-none h-24 uppercase"
                                        placeholder="Detalles del seguimiento..."
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                    {activeMission.status === 'PENDING' && activeMission.requesterId !== socketRef.current?.id && (
                                        <button
                                            onClick={() => {
                                                socketRef.current?.emit('accept_backup', {
                                                    requestId: activeMission.id,
                                                    guardName: guardName || "Guardia iPhone",
                                                    responderId: socketRef.current.id
                                                });
                                                setShowResolutionModal(false);
                                                toast.success({ title: "Apoyo aceptado" });
                                            }}
                                            className="h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center gap-3 shadow-lg shadow-blue-600/20 active:scale-95 transition-all text-xs font-black uppercase tracking-widest"
                                        >
                                            <Shield size={20} /> Prestar Apoyo
                                        </button>
                                    )}

                                    <button
                                        onClick={() => {
                                            socketRef.current?.emit('resolve_backup', {
                                                requestId: activeMission.id,
                                                outcome: 'SOLUCIONADO',
                                                guardName: guardName || "Guardia iPhone",
                                                notes: backupDetail || 'Intervención completada.'
                                            });
                                            setShowResolutionModal(false);
                                            setBackupDetail("");
                                            toast.success({ title: "Misión completada" });
                                        }}
                                        className="h-16 bg-emerald-600 text-white rounded-2xl flex items-center justify-center gap-3 shadow-lg shadow-emerald-600/20 active:scale-95 transition-all text-xs font-black uppercase tracking-widest"
                                    >
                                        <CheckCircle2 size={20} /> Solucionado
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (activeMission.requesterId === socketRef.current?.id || activeMission.responderId === socketRef.current?.id) {
                                                socketRef.current?.emit('cancel_backup', {
                                                    requestId: activeMission.id,
                                                    guardName: guardName || "Guardia iPhone"
                                                });
                                            }
                                            setShowResolutionModal(false);
                                            setBackupDetail("");
                                            setBackupLocation(null);
                                        }}
                                        className="h-14 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all text-[10px] font-black uppercase tracking-widest"
                                    >
                                        <X size={16} /> {activeMission.requesterId === socketRef.current?.id ? "Cancelar" : "Volver"}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Camera Modal */}
            <AnimatePresence>
                {isCameraActive && (
                    <div className="fixed inset-0 z-[300] bg-black flex flex-col">
                        <div className="relative flex-1 bg-slate-900 flex items-center justify-center overflow-hidden">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover"
                            />
                            <canvas ref={canvasRef} className="hidden" />

                            <div className="absolute top-10 left-6 right-6 flex justify-between items-start pointer-events-none">
                                <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                                    <p className="text-[10px] font-black uppercase text-white tracking-[0.2em]">Cámara En Vivo</p>
                                </div>
                                <button
                                    onClick={stopCamera}
                                    className="pointer-events-auto w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white active:scale-90"
                                >
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="absolute inset-0 pointer-events-none border-[40px] border-black/40">
                                <div className="w-full h-full border-2 border-white/20 rounded-[20px] relative">
                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white/60 -ml-1 -mt-1" />
                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white/60 -mr-1 -mt-1" />
                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white/60 -ml-1 -mb-1" />
                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white/60 -mr-1 -mb-1" />
                                </div>
                            </div>
                        </div>

                        <div className="h-40 bg-black flex items-center justify-center px-10">
                            <button
                                onClick={takePhoto}
                                className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center p-2"
                            >
                                <div className="w-full h-full bg-white rounded-full active:scale-90 transition-all shadow-[0_0_20px_rgba(255,255,255,0.4)]" />
                            </button>
                        </div>
                    </div>
                )}
            </AnimatePresence>
            {/* Settings Overlay */}
            <AnimatePresence>
                {showSettingsModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[250] bg-white flex flex-col"
                    >
                        <header className="h-20 px-8 flex items-center justify-between shrink-0">
                            <h2 className="text-xl font-black uppercase tracking-tight text-slate-900">Configuración</h2>
                            <button onClick={() => setShowSettingsModal(false)} className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                                <X size={24} />
                            </button>
                        </header>

                        <div className="flex-1 overflow-y-auto px-8 py-4 space-y-12">
                            {/* Profile Section */}
                            <div className="flex flex-col items-center gap-6">
                                <div className="relative">
                                    <div className="w-40 h-40 rounded-[40px] overflow-hidden bg-slate-100 border-4 border-white shadow-2xl relative">
                                        {guardPhoto ? (
                                            <Image src={guardPhoto} alt="Guard" fill className="object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                                                <UserIcon size={64} />
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => {
                                            const newPhoto = prompt("Pegue la URL de la nueva imagen (o implementaremos captura luego):");
                                            if (newPhoto) {
                                                setGuardPhoto(newPhoto);
                                                localStorage.setItem("bitacora_guard_photo", newPhoto);
                                                toast.success({ title: "Foto de perfil actualizada" });
                                            }
                                        }}
                                        className="absolute -bottom-2 -right-2 w-12 h-12 rounded-2xl bg-blue-600 text-white shadow-lg flex items-center justify-center border-4 border-white active:scale-90 transition-all"
                                    >
                                        <Camera size={20} />
                                    </button>
                                </div>
                                <div className="text-center">
                                    <h3 className="text-2xl font-black uppercase text-slate-900">{guardName}</h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">Guardia Activo</p>
                                </div>
                            </div>

                            {/* Options List */}
                            <div className="space-y-4">
                                <button className="w-full h-16 bg-slate-50 rounded-3xl px-6 flex items-center justify-between group active:bg-slate-100 transition-all">
                                    <div className="flex items-center gap-4 text-slate-900 font-bold uppercase text-xs">
                                        <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-400">
                                            <Bell size={18} />
                                        </div>
                                        Notificaciones
                                    </div>
                                    <div className="w-10 h-6 bg-emerald-500 rounded-full relative p-1">
                                        <div className="w-4 h-4 bg-white rounded-full ml-auto" />
                                    </div>
                                </button>

                                <button
                                    onClick={() => {
                                        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                                            (DeviceOrientationEvent as any).requestPermission()
                                                .then((permissionState: string) => {
                                                    if (permissionState === 'granted') {
                                                        toast.success({ title: "Sensores activados correctamente" });
                                                    }
                                                })
                                                .catch(console.error);
                                        } else {
                                            toast.info({ title: "Los sensores ya están activos o no requieren permiso manual" });
                                        }
                                    }}
                                    className="w-full h-16 bg-slate-50 rounded-3xl px-6 flex items-center gap-4 group active:bg-slate-100 transition-all"
                                >
                                    <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-blue-500">
                                        <RefreshCw size={18} />
                                    </div>
                                    <span className="text-slate-900 font-bold uppercase text-xs">Activar Sensores</span>
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
                                    className="w-full h-16 bg-blue-50 rounded-3xl px-6 flex items-center gap-4 group active:bg-blue-100 transition-all"
                                >
                                    <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-blue-600">
                                        <Download size={18} />
                                    </div>
                                    <span className="text-blue-700 font-black uppercase text-xs">Actualizar APP</span>
                                </button>

                                <button
                                    onClick={() => {
                                        if (confirm("¿Estás seguro que deseas cerrar sesión?")) {
                                            localStorage.removeItem("bitacora_guard_name");
                                            localStorage.removeItem("bitacora_guard_photo");
                                            window.location.reload();
                                        }
                                    }}
                                    className="w-full h-16 bg-red-50 rounded-3xl px-6 flex items-center gap-4 group active:bg-red-100 transition-all"
                                >
                                    <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-red-500">
                                        <LogOut size={18} />
                                    </div>
                                    <span className="text-red-600 font-black uppercase text-xs">Cerrar Sesión</span>
                                </button>
                            </div>

                            <div className="pt-8 text-center space-y-2">
                                <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">OmniAccess Guard Mobile</p>
                                <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Versión 2.1.0-release</p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>


            {/* FULLSCREEN IMAGE ZOOM MODAL */}
            <AnimatePresence>
                {zoomImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[1000] bg-black flex items-center justify-center p-4"
                        onClick={() => setZoomImage(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="relative w-full h-full max-w-4xl max-h-[80vh]"
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
                                className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white"
                            >
                                <X size={24} />
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* PLATE REPORT MODAL */}
            <AnimatePresence>
                {plateReport && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
                        onClick={() => setPlateReport(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="w-full max-w-md bg-white rounded-[2.5rem] p-8 space-y-6 shadow-2xl relative overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-[#B20D30]/5 to-transparent pointer-events-none" />

                            <div className="flex justify-between items-start relative">
                                <div className="space-y-1">
                                    <h3 className="text-3xl font-black tracking-tighter text-slate-900 leading-none">REPORTE</h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">HISTORIAL RECIENTE LPR</p>
                                </div>
                                <div className="bg-[#B20D30] px-4 py-2 rounded-xl shadow-lg shadow-[#B20D30]/20">
                                    <span className="text-white font-black text-xl tracking-widest">{selectedEntry.plate || selectedEntry.plateDetected}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Última Visita</p>
                                    <p className="text-xs font-black text-slate-900">{plateReport.lastVisit ? new Date(plateReport.lastVisit).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : "Nunca"}</p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Semanal</p>
                                    <p className="text-lg font-black text-[#B20D30]">{plateReport.totalEvents} <span className="text-[10px] text-slate-400">PASADAS</span></p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <p className="text-[9px] font-black text-slate-900 uppercase tracking-[0.3em] ml-2">Últimos Movimientos</p>
                                <div className="space-y-2">
                                    {plateReport.events.map((ev: any, i: number) => (
                                        <div key={ev.id} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100">
                                            <div className="flex items-center gap-3">
                                                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", ev.direction === 'ENTRY' ? "bg-emerald-100 text-emerald-600" : "bg-orange-100 text-orange-600")}>
                                                    {ev.direction === 'ENTRY' ? <LogIn size={14} /> : <LogOut size={14} />}
                                                </div>
                                                <div className="leading-tight">
                                                    <p className="text-[10px] font-black text-slate-900 uppercase">{ev.direction === 'ENTRY' ? 'Entrada' : 'Salida'}</p>
                                                    <p className="text-[9px] font-bold text-slate-400">{new Date(ev.timestamp).toLocaleString('es-UY')}</p>
                                                </div>
                                            </div>
                                            <div className={cn("px-2 py-1 rounded-md text-[8px] font-black uppercase", ev.decision === 'GRANT' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")}>
                                                {ev.decision === 'GRANT' ? 'Autorizado' : 'Denegado'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={() => setPlateReport(null)}
                                className="w-full h-14 bg-slate-100 text-slate-900 rounded-3xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all"
                            >
                                CERRAR REPORTE
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
                        className="fixed inset-0 z-[2000] bg-blue-600 flex flex-col items-center justify-center p-8 text-white overflow-hidden"
                    >
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                            className="mb-8 text-white/40"
                        >
                            <RefreshCw size={80} strokeWidth={3} />
                        </motion.div>
                        <h2 className="text-3xl font-black uppercase tracking-tighter mb-4 text-center">
                            {isCheckingUpdate ? "Verificando Versión" : (updateAvailable ? "Actualización Lista" : "Omniaccess Pro")}
                        </h2>
                        <p className="text-[10px] font-bold text-white/50 uppercase tracking-[0.3em] mb-12 text-center">
                            {isCheckingUpdate ? "Buscando cambios en la nube..." : (updateAvailable ? "Hay una nueva versión estable" : "Sistema al día")}
                        </p>

                        {updateAvailable && (
                            <div className="w-full max-w-sm space-y-4">
                                <button
                                    onClick={() => window.location.reload()}
                                    className="w-full h-18 bg-white text-blue-600 rounded-[2rem] font-black uppercase tracking-widest text-xs active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-3"
                                >
                                    <Download size={18} /> Actualizar ahora
                                </button>
                                <button
                                    onClick={() => setShowUpdateSplash(false)}
                                    className="w-full h-18 bg-blue-700 text-white rounded-[2rem] font-black uppercase tracking-widest text-xs active:scale-95 transition-all"
                                >
                                    Recordar más tarde
                                </button>
                            </div>
                        )}
                        {!updateAvailable && isCheckingUpdate && (
                            <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                                <motion.div 
                                    className="absolute inset-y-0 left-0 bg-white"
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
                        className="fixed inset-0 z-[1800] bg-slate-950/40 backdrop-blur-sm flex items-end"
                        onClick={() => setShowSearchFillModal(false)}
                    >
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            className="w-full bg-white rounded-t-[40px] p-8 pb-12 shadow-2xl space-y-8"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex justify-center">
                                <div className="w-16 h-1.5 bg-slate-100 rounded-full" />
                            </div>
                            <div className="space-y-2 text-center">
                                <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-2">
                                    <Clock size={28} />
                                </div>
                                <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900 leading-none">Registros Encontrados</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">¿Desea autocompletar con datos previos?</p>
                            </div>

                            <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                                {recentRecords.map((record) => (
                                    <button
                                        key={record.id}
                                        onClick={() => {
                                            if (record.name) setName(record.name);
                                            if (record.dni) setDni(record.dni);
                                            if (record.destination) setDestination(record.destination);
                                            setShowSearchFillModal(false);
                                            toast.success({ title: "Datos autocompletados" });
                                        }}
                                        className="w-full p-6 rounded-[2rem] bg-slate-50 border border-slate-100 flex items-center justify-between text-left active:scale-[0.98] transition-all group hover:bg-white hover:border-blue-200"
                                    >
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Última visita: {new Date(record.timestamp).toLocaleDateString()}</p>
                                            <p className="text-lg font-black text-slate-900 uppercase">{record.name || "Sin nombre"}</p>
                                            <div className="flex gap-4">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                                    <FileText size={10} /> {record.dni || "---"}
                                                </span>
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                                    <Building2 size={10} /> {record.destination || "---"}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-slate-300 group-hover:text-blue-500 transition-colors">
                                            <CheckCircle2 size={20} />
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => setShowSearchFillModal(false)}
                                className="w-full h-16 bg-slate-100 text-slate-400 rounded-3xl font-black uppercase tracking-widest text-xs active:bg-slate-200 transition-all"
                            >
                                CONTINUAR MANUALMENTE
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div >
    );
}

function DetailFieldMobile({ label, value, icon }: any) {
    return (
        <div className="space-y-1">
            <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1">
                {icon && React.isValidElement(icon) ? React.cloneElement(icon as any, { size: 10 }) : icon} {label}
            </p>
            <p className="text-xs font-black uppercase text-slate-900 truncate">
                {value || "---"}
            </p>
        </div>
    );
}

function BottomNavItem({ icon, active, onClick, label }: any) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex flex-col items-center gap-0.5 md:gap-1 transition-all duration-300 transform active:scale-90",
                active ? "text-blue-600" : "text-slate-300"
            )}
        >
            <div className={cn(
                "p-1.5 md:p-2 rounded-lg md:rounded-xl transition-colors",
                active ? "bg-blue-50" : "bg-transparent"
            )}>
                {icon}
            </div>
            <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest">{label}</span>
        </button>
    );
}

function AppFieldMobile({ label, icon, value, onChange, placeholder }: any) {
    return (
        <div className="space-y-1 md:space-y-2">
            <Label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5 ml-1">
                {icon && React.isValidElement(icon) ? React.cloneElement(icon as any, { size: 12, className: "md:w-3.5 md:h-3.5" }) : icon} {label}
            </Label>
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="h-12 md:h-14 bg-white border border-slate-200 focus:ring-4 focus:ring-blue-50 rounded-xl md:rounded-2xl text-slate-900 font-bold text-sm px-4 md:px-6 placeholder:text-slate-300 transition-all shadow-sm"
            />
        </div>
    );
}

function RollingCharacterMobile({ char, isFocused }: { char: string, isFocused: boolean }) {
    return (
        <div className={cn(
            "w-8 h-12 md:w-10 md:h-16 bg-white rounded-xl flex items-center justify-center border-2 md:border-4 transition-all duration-300",
            isFocused ? "border-blue-600 bg-blue-50 shadow-lg shadow-blue-500/10 scale-105" : "border-slate-200 text-slate-900"
        )}>
            <span className={cn(
                "text-xl md:text-2xl font-black",
                isFocused ? "text-blue-600" : "text-slate-900",
                char === " " && "opacity-10"
            )}>
                {char === " " ? "•" : char}
            </span>
        </div>
    );
}

function TactilePlateInputMobile({ value, onChange, onCameraClick, playTactileSound }: { value: string, onChange: (v: string) => void, onCameraClick?: () => void, playTactileSound?: () => void }) {
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
        <div className="w-full flex flex-col gap-3 items-center relative">
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
                    // Filter: Only alphanumeric, limit to 7 chars
                    const sanitized = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 7);
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

            <div className="flex gap-1.5 items-center relative z-10">
                {chars.map((char, i) => (
                    <RollingCharacterMobile
                        key={i}
                        char={char}
                        isFocused={value.length === i && value.length < 7}
                    />
                ))}

                {onCameraClick && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onCameraClick();
                        }}
                        className="ml-3 w-10 h-12 md:w-14 md:h-16 rounded-xl bg-[#B20D30] text-white flex items-center justify-center shadow-lg active:scale-90 transition-all z-30 border-none pointer-events-auto"
                    >
                        <Camera size={20} className="md:w-6 md:h-6" />
                    </button>
                )}
            </div>

            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest z-10">Toca los cuadros para escribir</p>
        </div>
    );
}
