"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Users,
    Car,
    Settings,
    ShieldCheck,
    History,
    DoorOpen,
    HelpCircle,
    LayoutGrid,
    Map as LucideMap,
    Video,
    ScanFace,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Menu,
    Activity,
    CreditCard,
    FileText,
    Monitor,
    Camera,
    Shield,
    Siren,
    CheckCircle2,
    X,
    Home
} from "lucide-react";
import { io } from "socket.io-client";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HelpMenu } from "@/components/HelpMenu";
import { cn } from "@/lib/utils";

interface SidebarItemProps {
    icon: React.ReactNode;
    label: string;
    href: string;
    active: boolean;
    collapsed: boolean;
    target?: string;
    badge?: number;
}

function SidebarItem({ icon, label, href, active, collapsed, target, badge }: SidebarItemProps) {
    return (
        <Link
            href={href}
            target={target}
            className={cn(
                "flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-all group relative",
                active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-white",
                collapsed && "justify-center px-2"
            )}
        >
            <div className={cn("shrink-0 relative", active ? "text-[#8b5cf6]" : "group-hover:text-[#8b5cf6]")}>
                {icon}
                {badge !== undefined && badge > 0 && (
                    <div className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center border-2 border-neutral-900 shadow-lg">
                        {badge}
                    </div>
                )}
            </div>
            {!collapsed && (
                <span className="whitespace-nowrap transition-opacity duration-300">{label}</span>
            )}
            {collapsed && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-neutral-900 border border-neutral-800 text-white text-[10px] uppercase font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                    {label}
                </div>
            )}
        </Link>
    );
}

import { getSocketUrl } from "@/lib/socket-config";
import { getSetting } from "@/app/actions/settings";

function MinIORetentionBadge() {
    const [days, setDays] = useState<string | null>(null);

    React.useEffect(() => {
        getSetting("S3_LIFECYCLE_DAYS").then(s => setDays(s?.value || "30"));
    }, []);

    if (!days) return null;

    return (
        <div className="px-4 pb-2 mt-auto">
            <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-2.5 flex flex-col items-center gap-0.5">
                <p className="text-[8px] text-orange-400 font-bold uppercase tracking-widest text-center leading-tight opacity-80">
                    Retención MinIO
                </p>
                <p className="text-xs text-orange-300 font-black">
                    {days} Días
                </p>
            </div>
        </div>
    );
}

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [activeConsolesCount, setActiveConsolesCount] = useState(0);
    const [isAlertActive, setIsAlertActive] = useState(false);
    const socketRef = React.useRef<any>(null);
    const alarmAudioRef = React.useRef<HTMLAudioElement | null>(null);

    React.useEffect(() => {
        const socketUrl = getSocketUrl();
        const socket = io(socketUrl);

        const activeConsolesRef = new Map<string, any>();

        socket.on('guard_presence', (data: any) => {
            activeConsolesRef.set(data.guardName, { ...data, lastSeen: Date.now() });
            setActiveConsolesCount(activeConsolesRef.size);
        });

        socket.on('alert_status', (data: any) => {
            setIsAlertActive(data.active);
            if (data.active) {
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
        });

        socketRef.current = socket;

        // Cleanup stale console presence locally in layout for the badge
        const timer = setInterval(() => {
            const now = Date.now();
            let changed = false;
            for (const [name, data] of activeConsolesRef.entries()) {
                if (now - data.lastSeen > 30000) {
                    activeConsolesRef.delete(name);
                    changed = true;
                }
            }
            if (changed) setActiveConsolesCount(activeConsolesRef.size);
        }, 10000);

        return () => {
            socket.disconnect();
            clearInterval(timer);
        };
    }, []);

    // Special layout for Face Dashboard (Standalone Mode)
    // Only for the main map view. Sub-pages (whitelist, blacklist, etc.) should use the standard admin layout.
    if (pathname === "/admin/dashboard-face") {
        return <>{children}</>;
    }

    return (
        <div className="flex min-h-screen bg-[#0a0a0a] text-neutral-100 font-sans selection:bg-[#8b5cf6]/30">
            {/* Sidebar */}
            <aside
                className={cn(
                    "border-r border-[#262626] flex flex-col fixed h-full bg-[#141414] backdrop-blur-xl z-30 transition-all duration-300 ease-in-out shadow-2xl",
                    collapsed ? "w-[70px]" : "w-64"
                )}
            >
                <div className="p-4 border-b border-neutral-800/50 bg-black/20 flex items-center justify-between h-[60px]">
                    <div className={cn("flex items-center gap-2 overflow-hidden transition-all", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
                        <div className="w-7 h-7 bg-[#8b5cf6] rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-[#8b5cf6]/20">
                            <ShieldCheck size={16} className="text-white" />
                        </div>
                        <div className="whitespace-nowrap">
                            <h2 className="text-sm font-black text-white uppercase tracking-tighter italic">
                                OmniAccess
                            </h2>
                            <p className="text-[8px] font-bold text-[#8b5cf6] uppercase tracking-[0.2em] opacity-80">Security Hub</p>
                        </div>
                    </div>

                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className={cn(
                            "p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-500 transition-colors",
                            collapsed && "mx-auto"
                        )}
                    >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
                    <SidebarItem icon={<Monitor size={18} />} label="Monitor LPR" href="/admin/dashboard" active={pathname === "/admin/dashboard"} collapsed={collapsed} />
                    <SidebarItem icon={<Camera size={18} />} label="Monitor Facial" href="/admin/dashboard-face" active={pathname === "/admin/dashboard-face"} collapsed={collapsed} />
                    <SidebarItem icon={<History size={18} />} label="Historial Acceso" href="/admin/history" active={pathname === "/admin/history"} collapsed={collapsed} />
                    <SidebarItem icon={<Monitor size={18} />} label="Consola Guardia" href="/admin/bitacora" active={pathname === "/admin/bitacora"} collapsed={collapsed} badge={activeConsolesCount} />
                    <SidebarItem icon={<CheckCircle2 size={18} />} label="Solicitudes PWA" href="/admin/registrations" active={pathname === "/admin/registrations"} collapsed={collapsed} />

                    {!collapsed && <div className="pt-3 pb-1 px-3 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider transition-opacity">Gestión</div>}
                    {collapsed && <div className="my-2 border-t border-neutral-800" />}

                    <SidebarItem icon={<Users size={18} />} label="Usuarios & Residentes" href="/admin/users" active={pathname === "/admin/users"} collapsed={collapsed} />
                    <SidebarItem icon={<DoorOpen size={18} />} label="Unidades / Lotes" href="/admin/units" active={pathname === "/admin/units"} collapsed={collapsed} />
                    <SidebarItem icon={<Car size={18} />} label="Vehículos / Matrículas" href="/admin/vehicles" active={pathname === "/admin/vehicles" || pathname === "/admin/credentials"} collapsed={collapsed} />
                    <SidebarItem icon={<LayoutGrid size={18} />} label="Plazas de Parking" href="/admin/plazas" active={pathname === "/admin/plazas"} collapsed={collapsed} />
                    <SidebarItem icon={<Video size={18} />} label="Dispositivos" href="/admin/devices" active={pathname?.includes("devices")} collapsed={collapsed} />
                    <SidebarItem icon={<Users size={18} />} label="Grupos de Acceso" href="/admin/groups" active={pathname === "/admin/groups"} collapsed={collapsed} />

                    {!collapsed && <div className="pt-3 pb-1 px-3 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider transition-opacity">Reportes</div>}
                    {collapsed && <div className="my-2 border-t border-neutral-800" />}

                    <SidebarItem icon={<Calendar size={18} />} label="Calendario" href="/admin/calendar" active={pathname === "/admin/calendar"} collapsed={collapsed} />
                    <SidebarItem icon={<Settings size={18} />} label="Configuración" href="/admin/settings" active={pathname === "/admin/settings"} collapsed={collapsed} />
                    <SidebarItem icon={<Activity size={18} />} label="Debug Webhooks" href="/admin/debug" active={pathname === "/admin/debug"} collapsed={collapsed} />
                    <SidebarItem icon={<FileText size={18} />} label="Changelog" href="/admin/changelog" active={pathname === "/admin/changelog"} collapsed={collapsed} />
                </nav>

                {/* MinIO Retention Badge */}
                {!collapsed && <MinIORetentionBadge />}

                <div className="p-3 border-t border-neutral-800 space-y-2">
                    {!collapsed && <HelpMenu />}
                    {collapsed && (
                        <div className="flex justify-center">
                            <div className="p-2 rounded-lg bg-neutral-800 text-neutral-400">
                                <HelpCircle size={18} />
                            </div>
                        </div>
                    )}

                    <div className={cn("flex items-center gap-3 group cursor-pointer p-2 rounded-2xl hover:bg-[#8b5cf6]/10 transition-colors", collapsed && "justify-center p-0 hover:bg-transparent")}>
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#7c3aed] flex items-center justify-center text-white font-black text-xs shadow-lg shadow-[#8b5cf6]/20 shrink-0">
                            A
                        </div>
                        {!collapsed && (
                            <div className="overflow-hidden">
                                <p className="text-sm font-black text-white leading-tight truncate">Admin User</p>
                                <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-tighter truncate">Super Admin</p>
                            </div>
                        )}
                        {!collapsed && <Settings size={14} className="ml-auto text-neutral-600 group-hover:text-white transition-colors" />}
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main
                className={cn(
                    "flex-1 overflow-y-auto custom-scrollbar transition-all duration-300 ease-in-out font-sans h-screen",
                    collapsed ? "ml-[70px]" : "ml-64"
                )}
            >
                {/* GLOBAL ALERT SYSTEM - SHARED ACROSS ALL ADMIN PAGES */}
                <AnimatePresence>
                    {isAlertActive && (
                        <>
                            {/* Persistent Border Pulse */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 pointer-events-none z-[200] border-[12px] border-red-600 animate-pulse bg-red-600/5"
                            />

                            {/* Top Ticker */}
                            <div className="fixed top-0 left-0 right-0 h-10 bg-red-600 z-[300] overflow-hidden flex items-center border-b border-white/20 shadow-2xl">
                                <motion.div
                                    animate={{ x: ["0%", "-50%"] }}
                                    transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                    className="whitespace-nowrap flex gap-10"
                                >
                                    {Array(20).fill(0).map((_, i) => (
                                        <span key={i} className="text-white text-[12px] font-black uppercase tracking-[0.4em] flex items-center gap-4">
                                            <Siren size={14} /> ALERTA DE SEGURIDAD - RESPUESTA INMEDIATA REQUERIDA
                                        </span>
                                    ))}
                                </motion.div>
                            </div>

                            {/* Shared Quick Action Overlay */}
                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: 20, opacity: 0 }}
                                className="fixed bottom-6 right-6 z-[300] bg-red-600 border-2 border-white p-6 rounded-[2.5rem] shadow-[0_0_80px_rgba(220,38,38,0.6)] max-w-sm"
                            >
                                <div className="flex items-center justify-between gap-6 mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-red-600 shadow-xl">
                                            <Siren className="animate-bounce" size={24} />
                                        </div>
                                        <span className="text-xs font-black uppercase tracking-widest text-white">Incidente Activo</span>
                                    </div>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => socketRef.current?.emit("alert_toggle", { active: false, triggeredBy: "Administrador" })}
                                        className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/20 backdrop-blur-md transition-all"
                                    >
                                        Normalizar
                                    </motion.button>
                                </div>
                                <p className="text-[11px] font-bold leading-relaxed text-white">
                                    Modo de emergencia detectado. Monitoreo activado en todas las consolas administrativas.
                                </p>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>

                {children}
            </main>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #262626;
                    border-radius: 10px;
                }
            `}</style>
        </div>
    );
}
