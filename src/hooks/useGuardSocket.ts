"use client";
import { useState, useRef, useEffect } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { playTactileSound } from "./guard-utils";

interface SocketCallbacks {
    /** Called when socket connects */
    onConnect?: () => void;
    /** Called when socket disconnects */
    onDisconnect?: () => void;
    /** Called when alert state changes */
    onAlertActivated?: (triggeredBy: string) => void;
    onAlertDeactivated?: (explanation?: string) => void;
    /** Called when backup is requested */
    onBackupRequested?: (data: any) => void;
    /** Called when backup status changes */
    onBackupAccepted?: (responderName: string) => void;
    /** Called when backup resolved */
    onBackupResolved?: (resolverName: string) => void;
    /** Called when backup cancelled */
    onBackupCancelled?: (cancelledBy: string) => void;
    /** Called on FACE access events (iPhone only) */
    onFaceEvent?: (event: any) => void;
}

interface UseGuardSocketOptions {
    callbacks: SocketCallbacks;
    /** Guard name for heartbeat */
    guardName: string;
    /** Guard photo URL for heartbeat */
    guardPhoto: string | null;
    /** Enable heartbeat presence (desktop has more device info) */
    enableHeartbeat?: boolean;
    /** Heartbeat interval in ms (default 4000) */
    heartbeatIntervalMs?: number;
}

interface UseGuardSocketReturn {
    socket: any;
    entries: any[];
    setEntries: React.Dispatch<React.SetStateAction<any[]>>;
    lprEntries: any[];
    setLprEntries: React.Dispatch<React.SetStateAction<any[]>>;
    faceEntries: any[];
    setFaceEntries: React.Dispatch<React.SetStateAction<any[]>>;
    isAlertMode: boolean;
    setIsAlertMode: React.Dispatch<React.SetStateAction<boolean>>;
    myLocation: { lat: number; lng: number } | null;
    otherGuards: any[];
    monitoringMissions: any[];
    setMonitoringMissions: React.Dispatch<React.SetStateAction<any[]>>;
    incomingBackup: any;
    setIncomingBackup: (v: any) => void;
}

export function useGuardSocket({
    callbacks,
    guardName,
    guardPhoto,
    enableHeartbeat = true,
    heartbeatIntervalMs = 4000,
}: UseGuardSocketOptions): UseGuardSocketReturn {
    const [socket, setSocket] = useState<any>(null);
    const [entries, setEntries] = useState<any[]>([]);
    const [lprEntries, setLprEntries] = useState<any[]>([]);
    const [faceEntries, setFaceEntries] = useState<any[]>([]);
    const [isAlertMode, setIsAlertMode] = useState(false);
    const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [otherGuards, setOtherGuards] = useState<any[]>([]);
    const [monitoringMissions, setMonitoringMissions] = useState<any[]>([]);
    const [incomingBackup, setIncomingBackup] = useState<any>(null);

    const isFirstAlertRef = useRef(false);
    const guardNameRef = useRef(guardName);
    const guardPhotoRef = useRef(guardPhoto);
    const callbacksRef = useRef(callbacks);

    useEffect(() => { guardNameRef.current = guardName; }, [guardName]);
    useEffect(() => { guardPhotoRef.current = guardPhoto; }, [guardPhoto]);
    useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);

    useEffect(() => {
        const socketUrl = getSocketUrl();
        const newSocket = io(socketUrl, {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            transports: ["websocket", "polling"],
        });
        setSocket(newSocket);

        // Request notification permission
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }

        newSocket.on("connect", () => {
            callbacksRef.current.onConnect?.();
        });

        newSocket.on("disconnect", () => {
            callbacksRef.current.onDisconnect?.();
        });

        // --- Bitacora ---
        newSocket.on("new_bitacora", (entry: any) => {
            setEntries((prev) => {
                if (prev.some((e) => e.id === entry.id)) return prev;
                return [entry, ...prev].slice(0, 200);
            });
        });

        // --- Access Events (LPR + Face) ---
        newSocket.on("access_event", (event: any) => {
            if (event.accessType === "PLATE" || event.plateDetected) {
                setLprEntries((prev) => {
                    if (prev.some((e) => e.id === event.id)) return prev;
                    return [event, ...prev].slice(0, 200);
                });
            }
            if (event.accessType === "FACE") {
                setFaceEntries((prev) => {
                    if (prev.some((e) => e.id === event.id)) return prev;
                    return [event, ...prev].slice(0, 200);
                });
                callbacksRef.current.onFaceEvent?.(event);
            }
        });

        // --- Alert Status ---
        newSocket.on("alert_status", (data: any) => {
            setIsAlertMode((prev) => {
                if (!isFirstAlertRef.current) {
                    isFirstAlertRef.current = true;
                    return data.active;
                }
                if (prev !== data.active) {
                    if (data.active) {
                        callbacksRef.current.onAlertActivated?.(data.triggeredBy || "un compañero");
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("\u26a0\ufe0f ALERTA DE SEGURIDAD - OMNIACCESS GUARD", {
                                body: `Modo de alerta activado por ${data.triggeredBy || "un compañero"}.`,
                                icon: "/icons/sildan-icon-dot.png",
                                tag: "security-alert",
                            });
                        }
                        if ("setAppBadge" in navigator) (navigator as any).setAppBadge(1).catch(() => {});
                    } else {
                        callbacksRef.current.onAlertDeactivated?.(data.explanation);
                        if ("clearAppBadge" in navigator) (navigator as any).clearAppBadge().catch(() => {});
                    }
                }
                return data.active;
            });
        });

        // --- Guard Locations ---
        newSocket.on("guard_locations", (data: any[]) => {
            setOtherGuards(data);
        });

        // --- Mission Listeners ---
        newSocket.on("active_missions", (data: any[]) => {
            setMonitoringMissions(data);
        });

        newSocket.on("backup_requested", (data: any) => {
            setIncomingBackup(data);
            setMonitoringMissions((prev) => {
                if (prev.find((m) => m.id === data.id)) return prev;
                return [...prev, data];
            });
            if ("setAppBadge" in navigator) (navigator as any).setAppBadge(1).catch(() => {});
            if ("vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 500]);
            playTactileSound();
            callbacksRef.current.onBackupRequested?.(data);
        });

        newSocket.on("backup_status_update", (data: any) => {
            setMonitoringMissions((prev) =>
                prev.map((m) =>
                    m.id === data.requestId
                        ? { ...m, status: data.accepted ? "ACCEPTED" : "REJECTED", responderId: data.responderId, responderName: data.responderName }
                        : m
                )
            );
            if (data.accepted) {
                setIncomingBackup(null);
                callbacksRef.current.onBackupAccepted?.(data.responderName);
            }
        });

        newSocket.on("backup_resolved", (data: any) => {
            setMonitoringMissions((prev) => prev.filter((m) => m.id !== data.requestId));
            setIncomingBackup(null);
            if ("clearAppBadge" in navigator) (navigator as any).clearAppBadge().catch(() => {});
            callbacksRef.current.onBackupResolved?.(data.resolverName);
        });

        newSocket.on("backup_cancelled", (data: any) => {
            setMonitoringMissions((prev) => prev.filter((m) => m.id !== data.requestId));
            setIncomingBackup(null);
            callbacksRef.current.onBackupCancelled?.(data.cancelledBy);
        });

        // --- Heartbeat ---
        let heartBeatId: any = null;
        if (enableHeartbeat) {
            heartBeatId = setInterval(() => {
                if (newSocket.connected) {
                    const ua = navigator.userAgent;
                    let deviceInfo = "Tablet";
                    if (ua.includes("iPhone")) deviceInfo = "iPhone";
                    else if (ua.includes("Samsung")) deviceInfo = "Samsung";
                    else if (ua.includes("iPad")) deviceInfo = "iPad";
                    else if (ua.includes("Android")) {
                        const match = ua.match(/\(([^;]+);/);
                        deviceInfo = match?.[1]?.split("Build")[0]?.trim() || "Android";
                    }

                    newSocket.emit("guard_presence", {
                        guardName: guardNameRef.current || "Invitado",
                        status: "online",
                        timestamp: new Date().toISOString(),
                        deviceInfo,
                        guardPhoto: guardPhotoRef.current,
                    });
                }
            }, heartbeatIntervalMs);
        }

        // --- GPS Watcher ---
        let watchId: number | null = null;
        if ("geolocation" in navigator) {
            watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const { latitude, longitude, accuracy } = position.coords;
                    setMyLocation({ lat: latitude, lng: longitude });
                    if (newSocket.connected) {
                        newSocket.emit("guard_location_update", {
                            lat: latitude,
                            lng: longitude,
                            accuracy,
                            guardName: guardNameRef.current || "Operario",
                            timestamp: Date.now(),
                        });
                    }
                },
                () => {},
                { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
            );
        }

        return () => {
            if (heartBeatId) clearInterval(heartBeatId);
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            newSocket.disconnect();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        socket,
        entries,
        setEntries,
        lprEntries,
        setLprEntries,
        faceEntries,
        setFaceEntries,
        isAlertMode,
        setIsAlertMode,
        myLocation,
        otherGuards,
        monitoringMissions,
        setMonitoringMissions,
        incomingBackup,
        setIncomingBackup,
    };
}
