"use client";

import React, { useState, useEffect } from "react";
import { sileo } from "sileo";
import {
    Siren,
    MapPin,
    X,
    CarFront,
    History,
    PlusCircle,
    ShieldAlert,
    Users,
    Grid,
    List,
    Search,
    RefreshCcw,
    FileSpreadsheet,
    UserX,
} from "lucide-react";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { io } from "socket.io-client";
import dynamic from "next/dynamic";
import { getBitacoraPage } from "@/app/actions/bitacora";
import BitacoraCard from "@/components/bitacora/BitacoraCard";
import BitacoraTable from "@/components/bitacora/BitacoraTable";
import ManualRegisterForm from "@/components/bitacora/ManualRegisterForm";
import GuardManagement from "@/components/bitacora/GuardManagement";
import PanicButtonTab from "@/components/bitacora/PanicButtonTab";
import { ExportBitacoraDialog } from "@/components/bitacora/ExportBitacoraDialog";
import { getSocketUrl } from "@/lib/socket-config";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

const LiveGuardMap = dynamic(() => import("@/components/LiveGuardMap"), { ssr: false });

// Notificaciones unificadas con el toaster de la app (sileo), sin overlay a pantalla completa
const notify = (title: string, message: string, type: "success" | "error" | "info" | "alert" = "success") => {
    if (type === "alert" || type === "error") sileo.error({ title, description: message });
    else if (type === "success") sileo.success({ title, description: message });
    else sileo.info({ title, description: message });
};

const TABS = [
    { value: "historial", label: "Historial", icon: History },
    { value: "manual", label: "Registro Manual", icon: PlusCircle },
    { value: "guards", label: "Guardias", icon: Users },
    { value: "panic", label: "Pánico", icon: ShieldAlert },
];

export default function ConsolasAdminPage() {
    const [isAlertMode, setIsAlertMode] = useState(false);
    const [guardLocations, setGuardLocations] = useState<any[]>([]);
    const [showFullMap, setShowFullMap] = useState(false);
    const socketRef = React.useRef<any>(null);
    const [socketId, setSocketId] = useState<string | null>(null);
    const isFirstRun = React.useRef(true);
    const [activeMissions, setActiveMissions] = useState<any[]>([]);
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [backupLocation, setBackupLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [backupDetail, setBackupDetail] = useState("");
    const [viewMode, setViewMode] = useState<"grid" | "table">("table");
    const [entries, setEntries] = useState<any[]>([]);
    const [loadingEntries, setLoadingEntries] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

    const loadEntries = async () => {
        setLoadingEntries(true);
        try {
            const data = await getBitacoraPage(0, 50, searchQuery);
            setEntries(data);
        } catch (error) {
            console.error("Error loading bitacora:", error);
        } finally {
            setLoadingEntries(false);
        }
    };

    useEffect(() => { loadEntries(); }, [searchQuery]);

    useEffect(() => {
        const socketUrl = getSocketUrl();
        const socket = io(socketUrl, { path: "/io/socket.io", transports: ["polling"], upgrade: false,  path: "/io/socket.io", transports: ["polling"], upgrade: false, });
        socketRef.current = socket;

        socket.on("connect", () => { setSocketId(socket.id || null); });
        socket.on("guard_locations", (data: any[]) => { setGuardLocations(data); });

        socket.on("alert_status", (data: { active: boolean, triggeredBy?: string }) => {
            if (isFirstRun.current) { setIsAlertMode(data.active); isFirstRun.current = false; return; }
            setIsAlertMode(prevMode => {
                if (prevMode && !data.active) {
                    notify("Sistema normalizado", "La alerta de seguridad fue desactivada.", "success");
                } else if (!prevMode && data.active) {
                    notify("Alerta activada", `Modo de alerta activado por ${data.triggeredBy || "un compañero"}.`, "alert");
                    try { const audio = new Audio("/sounds/alert.mp3"); audio.volume = 1.0; audio.play().catch(() => { }); } catch { }
                    if ("vibrate" in navigator) { navigator.vibrate([200, 100, 200, 100, 200]); }
                    if ("Notification" in window && Notification.permission === "granted") {
                        new Notification("ALERTA DE SEGURIDAD", { body: `Modo de alerta activado por ${data.triggeredBy || "un compañero"}`, icon: "/icon-192.png", badge: "/icon-192.png", requireInteraction: true, tag: "security-alert" });
                    } else if ("Notification" in window && Notification.permission !== "denied") {
                        Notification.requestPermission().then(permission => {
                            if (permission === "granted") {
                                new Notification("ALERTA DE SEGURIDAD", { body: `Modo de alerta activado por ${data.triggeredBy || "un compañero"}`, icon: "/icon-192.png", badge: "/icon-192.png", requireInteraction: true, tag: "security-alert" });
                            }
                        });
                    }
                }
                return data.active;
            });
        });

        socket.on("active_missions", (data: any[]) => { setActiveMissions(data); });
        socket.on("backup_requested", (data: { id: string, type: string }) => {
            setActiveMissions(prev => { if (prev.some(m => m.id === data.id)) return prev; return [...prev, data]; });
            notify("Nueva alerta", "Se reportó un incidente.", "alert");
        });
        socket.on("backup_status_update", (data: { requestId: string, accepted: boolean, responderId: string, responderName: string }) => {
            setActiveMissions(prev => prev.map(m => m.id === data.requestId ? { ...m, status: data.accepted ? "ACCEPTED" : "REJECTED", responderId: data.responderId, responderName: data.responderName } : m));
        });
        socket.on("backup_resolved", (data: { requestId: string, resolverName: string }) => {
            setActiveMissions(prev => prev.filter(m => m.id !== data.requestId));
            notify("Resuelto", `Incidente cerrado por ${data.resolverName}`, "success");
        });
        socket.on("backup_cancelled", (data: { requestId: string }) => { setActiveMissions(prev => prev.filter(m => m.id !== data.requestId)); });
        socket.on("backup_cancelled_by_user", (data: { requestId: string }) => { setActiveMissions(prev => prev.filter(m => m.id !== data.requestId)); });

        return () => { socket.disconnect(); };
    }, []);

    useEffect(() => {
        if (!socketRef.current) return;
        socketRef.current.on("guard_presence", (data: any) => {
            setGuardLocations(prev => {
                const others = prev.filter((g: any) => g.guardName !== data.guardName);
                return [...others, { ...data, lastSeen: new Date() }];
            });
        });
        return () => { socketRef.current?.off("guard_presence"); };
    }, [socketRef.current]);

    return (
        <div className="p-6 space-y-4 animate-in fade-in duration-500">
            {/* Header uniforme (estilo Dispositivos) */}
            <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-red-500/10 rounded-lg border border-red-500/20">
                        <History className="text-red-400" size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Consola de Guardia</h1>
                        <p className="text-[11px] text-muted-foreground">Centro de control y bitácora operativa</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full lg:w-auto">
                    {isAlertMode && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] font-bold text-red-400 uppercase tracking-widest">
                            <Siren size={13} className="animate-pulse" /> Alerta activa
                        </span>
                    )}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button onClick={() => setShowFullMap(true)} variant="outline"
                                    className="h-9 px-3 rounded-lg text-xs gap-1.5 border-border/60 bg-card/80 hover:bg-accent">
                                    <MapPin size={15} /> <span className="hidden sm:inline">Mapa táctico</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent><p className="text-xs">Mapa de guardias en tiempo real</p></TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    <Button
                        onClick={() => { if (socketRef.current) socketRef.current.emit("alert_toggle", { active: !isAlertMode, triggeredBy: "Administrador" }); }}
                        className={cn("h-9 px-4 rounded-lg text-xs font-bold gap-1.5 transition-all active:scale-95",
                            isAlertMode ? "bg-white text-red-600 border border-red-600 hover:bg-neutral-100" : "bg-red-600 hover:bg-red-500 text-white")}>
                        <Siren size={15} /> {isAlertMode ? "Desactivar alerta" : "Activar alerta"}
                    </Button>
                </div>
            </header>

            {/* Tabs segmentadas uniformes */}
            <Tabs defaultValue="historial" className="space-y-4">
                <TabsList className="bg-card/80 p-1 rounded-lg border border-border/60 h-auto inline-flex gap-1">
                    {TABS.map(({ value, label, icon: Icon }) => (
                        <TabsTrigger key={value} value={value}
                            className="h-8 px-3 rounded-md text-[11px] font-semibold uppercase tracking-wide gap-1.5 text-muted-foreground data-[state=active]:bg-foreground/10 data-[state=active]:text-foreground data-[state=active]:shadow-none transition-all">
                            <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value="historial" className="mt-0 space-y-4 focus-visible:outline-none">
                    {/* Toolbar estándar */}
                    <div className="flex flex-col sm:flex-row items-center gap-2">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Buscar por matrícula, nombre o destino..."
                                className="w-full bg-card/80 border border-border/60 h-9 rounded-lg pl-9 pr-3 text-xs font-medium focus:ring-1 focus:ring-red-500/30 focus:border-red-500/30 outline-none transition-all placeholder:text-muted-foreground text-foreground"
                            />
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <div className="flex items-center gap-1 bg-card/80 p-1 rounded-lg border border-border/60">
                                <button onClick={() => setViewMode("table")} className={cn("h-7 w-7 rounded-md flex items-center justify-center transition-all", viewMode === "table" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}><List size={15} /></button>
                                <button onClick={() => setViewMode("grid")} className={cn("h-7 w-7 rounded-md flex items-center justify-center transition-all", viewMode === "grid" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}><Grid size={15} /></button>
                            </div>
                            <Button onClick={loadEntries} variant="outline" className="h-9 px-3 rounded-lg text-xs gap-1.5 border-border/60 bg-card/80 hover:bg-accent">
                                <RefreshCcw size={14} className={loadingEntries ? "animate-spin" : ""} /> <span className="hidden sm:inline">Refrescar</span>
                            </Button>
                            <Button onClick={() => setIsExportDialogOpen(true)} className="h-9 px-4 rounded-lg text-xs font-bold gap-1.5 bg-red-600 hover:bg-red-500 text-white">
                                <FileSpreadsheet size={14} /> Exportar
                            </Button>
                        </div>
                    </div>

                    {loadingEntries ? (
                        viewMode === "grid" ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (<div key={i} className="h-56 bg-card/60 rounded-lg animate-pulse" />))}
                            </div>
                        ) : (
                            <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                                {[1, 2, 3, 4, 5, 6].map((i) => (<div key={i} className="h-14 border-b border-border/40 bg-card/30 animate-pulse" />))}
                            </div>
                        )
                    ) : entries.length === 0 ? (
                        <div className="border border-border/60 rounded-lg bg-background/50 flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                            <div className="p-5 bg-card/50 rounded-lg border border-dashed border-border">
                                <History size={32} className="opacity-40" />
                            </div>
                            <p className="text-sm font-semibold">Sin registros en la bitácora</p>
                            <p className="text-xs">Los eventos de guardia aparecerán aquí.</p>
                        </div>
                    ) : viewMode === "grid" ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {entries.map((entry) => (<BitacoraCard key={entry.id} entry={entry} />))}
                        </div>
                    ) : (
                        <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50 overflow-x-auto">
                            <BitacoraTable entries={entries} />
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="manual" className="mt-0 focus-visible:outline-none">
                    <ManualRegisterForm />
                </TabsContent>

                <TabsContent value="guards" className="mt-0 focus-visible:outline-none">
                    <GuardManagement />
                </TabsContent>

                <TabsContent value="panic" className="mt-0 focus-visible:outline-none">
                    <PanicButtonTab />
                </TabsContent>
            </Tabs>

            {/* Mapa táctico (pantalla completa) */}
            {showFullMap && (
                <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-200">
                    <div className="flex-1 w-full h-full relative">
                        <button onClick={() => setShowFullMap(false)} className="absolute top-4 right-4 z-[200] h-10 w-10 rounded-full bg-black/60 backdrop-blur-md text-white/90 hover:bg-black/80 flex items-center justify-center transition-colors"><X size={20} /></button>
                        <LiveGuardMap myLocation={null} guards={guardLocations} socketId={socketId}
                            onLongPress={(latlng: any) => { setBackupLocation(latlng); setShowBackupModal(true); }}
                            backupMissions={activeMissions} />
                        <div className="absolute top-4 left-4 z-[100] bg-black/50 backdrop-blur-xl px-5 py-3 rounded-xl border border-white/10 border-l-4 border-l-red-600">
                            <h2 className="text-lg font-bold text-white">Mapa táctico</h2>
                            <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mt-0.5">Monitoreo en tiempo real</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Reportar incidente */}
            {showBackupModal && (
                <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-150">
                    <div className="bg-card w-full max-w-lg rounded-2xl p-6 shadow-xl border border-border">
                        <div className="text-center mb-5">
                            <h2 className="text-lg font-bold text-foreground">Reportar incidente</h2>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-1">Consola de administración</p>
                        </div>
                        <div className="mb-5">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground mb-2 block tracking-widest">Detalles adicionales</label>
                            <input type="text" placeholder="Descripción del sospechoso..." value={backupDetail} onChange={(e) => setBackupDetail(e.target.value)}
                                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-red-500/30 focus:border-red-500/30 transition-colors" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { type: "INDIVIDUO SOSPECHOSO", label: "Individuo sospechoso", Icon: UserX },
                                { type: "VEHICULO SOSPECHOSO", label: "Vehículo sospechoso", Icon: CarFront },
                            ].map(({ type, label, Icon }) => (
                                <button key={type} onClick={() => {
                                    if (socketRef.current && backupLocation) {
                                        const mission = { id: "req-admin-" + Date.now(), type, lat: backupLocation.lat, lng: backupLocation.lng, requesterName: "Administrador", requesterId: socketRef.current.id, status: "PENDING", details: backupDetail };
                                        socketRef.current.emit("request_backup", mission);
                                        setActiveMissions(prev => (prev.some(m => m.id === mission.id) ? prev : [...prev, mission]));
                                        setShowBackupModal(false); setBackupDetail("");
                                        notify("Enviado", "Alerta administrativa generada.", "info");
                                    }
                                }} className="bg-card border border-border hover:border-red-500/40 hover:bg-red-500/5 py-5 rounded-xl flex flex-col items-center gap-2.5 transition-all group active:scale-95">
                                    <div className="w-11 h-11 bg-background border border-border rounded-full flex items-center justify-center text-red-500 group-hover:scale-110 transition-transform"><Icon size={20} /></div>
                                    <span className="text-xs font-semibold text-foreground leading-tight text-center px-2">{label}</span>
                                </button>
                            ))}
                        </div>
                        <button onClick={() => setShowBackupModal(false)} className="mt-5 w-full py-2.5 text-xs font-bold uppercase text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                    </div>
                </div>
            )}

            <ExportBitacoraDialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen} searchQuery={searchQuery} />
        </div>
    );
}
