"use client";

import React, { useState, useEffect } from "react";
import { pantallaInicio } from "@/lib/landing";
import { useSessionRole } from "@/hooks/useSessionRole";
import { OnlineUsersWidget } from "@/components/OnlineUsersWidget";
import { OmniLogo } from "@/components/brand/OmniLogo";
import LiveEdgeKeeper from "@/components/LiveEdgeKeeper";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    LayoutDashboard,
    Users,
    Car,
    Settings,
    ShieldCheck,
    BookOpen,
    History,
    DoorOpen,
    HelpCircle,
    LayoutGrid,
    Map,
    Video,
    ScanFace,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Menu,
    Activity,
    CreditCard,
    AlignHorizontalJustifyCenter,
    TrendingUp,
    Bell,
    Send,
    FileBarChart,
    Rows3,
    LogOut,
    SlidersHorizontal,
    Building2,
    Map as MapIcon,
    Sparkles,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import AlertBell from "@/components/AlertBell";
import { cn } from "@/lib/utils";
import { getEnabledModules, type ModuleId } from "@/app/actions/modules";
import { hasAcuSeekNvr } from "@/app/actions/acuseek";
import { logout } from "@/app/actions/auth";
import AforoAlertOverlay from "@/components/AforoAlertOverlay";

interface SidebarItemProps {
    icon: React.ReactNode;
    label: string;
    href: string;
    active: boolean;
    collapsed: boolean;
}

function SidebarItem({ icon, label, href, active, collapsed }: SidebarItemProps) {
    return (
        <Link
            href={href}
            className={cn(
                "flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-all group relative",
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                collapsed && "justify-center px-2"
            )}
        >
            <div className={cn("shrink-0", active ? "text-blue-500" : "group-hover:text-blue-400")}>
                {icon}
            </div>
            {!collapsed && (
                <span className="whitespace-nowrap transition-opacity duration-300">{label}</span>
            )}
            {collapsed && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-popover border border-border text-popover-foreground text-[10px] uppercase font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                    {label}
                </div>
            )}
        </Link>
    );
}

import { getSetting } from "@/app/actions/settings";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [collapsed, setCollapsed] = useState(false);
    const { role: sessionRole, loaded: roleLoaded } = useSessionRole();
    const isAdmin = sessionRole === "ADMIN";
    const [loggingOut, setLoggingOut] = useState(false);
    const [acuseekOk, setAcuseekOk] = useState(false);
    const [modules, setModules] = useState<Record<ModuleId, boolean>>({
        MODULE_LPR: true,
        MODULE_FACE: true,
        MODULE_QUEUE: false,
        MODULE_GUARD: false,
    });

    useEffect(() => {
        getEnabledModules().then(setModules);
        hasAcuSeekNvr().then(setAcuseekOk).catch(() => {});
    }, []);

    const handleLogout = async () => {
        setLoggingOut(true);
        try {
            // Limpiar estado local para no arrastrar config/identidad de la sesion anterior
            try {
                Object.keys(localStorage).forEach((k) => {
                    if (/^(dashboard_|guard|bitacora_|oa_|omni_)/i.test(k)) localStorage.removeItem(k);
                });
            } catch {}
            await logout();
            router.push('/login');
        } catch {
            setLoggingOut(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-background text-foreground font-sans">
            {/* Sidebar */}
            <aside
                className={cn(
                    "border-r border-border flex flex-col fixed h-full bg-card/80 backdrop-blur-xl z-20 transition-all duration-300 ease-in-out",
                    collapsed ? "w-[70px]" : "w-64"
                )}
            >
                <div className="p-4 border-b border-border bg-foreground/[0.02] flex items-center justify-between h-[60px]">
                    <div className={cn("flex items-center gap-2 overflow-hidden transition-all", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
                        <OmniLogo size={24} className="shrink-0" />
                        <div className="whitespace-nowrap">
                            <h2 className="text-xs font-bold text-foreground uppercase tracking-[0.2em]">
                                OmniAccess
                            </h2>
                            <p className={cn("text-[8px] font-bold uppercase tracking-widest", modules.MODULE_QUEUE ? "text-violet-500" : "text-muted-foreground")}>
                                {modules.MODULE_QUEUE ? "Control de Filas" : "Control y acceso"}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className={cn(
                            "p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors",
                            collapsed && "mx-auto"
                        )}
                    >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
                    {modules.MODULE_QUEUE ? (
                        <SidebarItem icon={<LayoutDashboard size={18} />} label="Monitor en Vivo" href="/admin/monitor-queue" active={pathname === "/admin/monitor-queue"} collapsed={collapsed} />
                    ) : modules.MODULE_FACE ? (
                        <SidebarItem icon={<LayoutDashboard size={18} />} label="Monitor en Vivo" href="/admin/monitor-face" active={pathname === "/admin/monitor-face"} collapsed={collapsed} />
                    ) : (
                        <SidebarItem icon={<LayoutDashboard size={18} />} label="Monitor en Vivo" href="/admin/monitor-lpr" active={pathname === "/admin/monitor-lpr"} collapsed={collapsed} />
                    )}
                    {modules.MODULE_QUEUE ? (
                        <SidebarItem icon={<TrendingUp size={18} />} label="Flujo de Filas" href="/admin/flujo-filas" active={pathname === "/admin/flujo-filas"} collapsed={collapsed} />
                    ) : (
                        <SidebarItem icon={<History size={18} />} label="Historial de Acceso" href="/admin/history" active={pathname === "/admin/history"} collapsed={collapsed} />
                    )}
                    {modules.MODULE_QUEUE && (
                        <SidebarItem icon={<MapIcon size={18} />} label="Mapas" href="/admin/mapas" active={pathname === "/admin/mapas"} collapsed={collapsed} />
                    )}
                    {!modules.MODULE_QUEUE && (
                        <SidebarItem icon={<MapIcon size={18} />} label="Mapa" href="/admin/mapa" active={pathname === "/admin/mapa"} collapsed={collapsed} />
                    )}

                    {!modules.MODULE_QUEUE && (
                        <>
                            {!collapsed && <div className="pt-3 pb-1 px-3 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider transition-opacity">Gestión</div>}
                            {collapsed && <div className="my-2 border-t border-border" />}
                            {isAdmin && (<SidebarItem icon={<Users size={18} />} label="Usuarios & Residentes" href="/admin/users" active={pathname === "/admin/users"} collapsed={collapsed} />)}
                            {isAdmin && (<SidebarItem icon={<DoorOpen size={18} />} label="Unidades / Lotes" href="/admin/units" active={pathname === "/admin/units"} collapsed={collapsed} />)}
                            <SidebarItem icon={<Calendar size={18} />} label="Calendario" href="/admin/calendar" active={pathname === "/admin/calendar"} collapsed={collapsed} />
                        </>
                    )}

                    {modules.MODULE_LPR && !modules.MODULE_QUEUE && (
                        <>
                            {!collapsed && <div className="pt-2 pb-0.5 px-3 text-[8px] font-bold text-amber-500/60 uppercase tracking-widest">LPR</div>}
                            {isAdmin && (<SidebarItem icon={<Car size={18} />} label="Vehículos / Matrículas" href="/admin/vehicles" active={pathname === "/admin/vehicles" || pathname === "/admin/credentials"} collapsed={collapsed} />)}
                            {isAdmin && (<SidebarItem icon={<Video size={18} />} label="Dispositivos LPR" href="/admin/devices?type=LPR_CAMERA" active={pathname?.includes("devices") && pathname.includes("type=LPR")} collapsed={collapsed} />)}
                            {acuseekOk && <SidebarItem icon={<Sparkles size={18} />} label="Búsqueda inteligente" href="/admin/acuseek" active={pathname === "/admin/acuseek"} collapsed={collapsed} />}
                        </>
                    )}

                    {modules.MODULE_FACE && !modules.MODULE_QUEUE && (
                        <>
                            {!collapsed && <div className="pt-2 pb-0.5 px-3 text-[8px] font-bold text-teal-500/60 uppercase tracking-widest">Face</div>}
                            <SidebarItem icon={<ScanFace size={18} />} label="Dispositivos Faciales" href="/admin/devices?type=FACE_TERMINAL" active={pathname?.includes("devices") && pathname.includes("type=FACE")} collapsed={collapsed} />
                        </>
                    )}

                    {modules.MODULE_QUEUE && (
                        <>
                            {!collapsed && <div className="pt-2 pb-0.5 px-3 text-[8px] font-bold text-violet-500/60 uppercase tracking-widest">Filas</div>}
                            <SidebarItem icon={<Rows3 size={18} />} label="Filas" href="/admin/filas" active={pathname === "/admin/filas"} collapsed={collapsed} />
                            <SidebarItem icon={<Send size={18} />} label="Despachos" href="/admin/despachos" active={pathname === "/admin/despachos"} collapsed={collapsed} />
                            <SidebarItem icon={<FileBarChart size={18} />} label="Reportes" href="/admin/reportes-queue" active={pathname === "/admin/reportes-queue"} collapsed={collapsed} />
                            <SidebarItem icon={<Video size={18} />} label="Dispositivos Conteo" href="/admin/devices?type=QUEUE_COUNTER" active={pathname?.includes("devices") && pathname.includes("type=QUEUE")} collapsed={collapsed} />
                            <SidebarItem icon={<Calendar size={18} />} label="Horarios de Filas" href="/admin/horarios-filas" active={pathname === "/admin/horarios-filas"} collapsed={collapsed} />
                            <SidebarItem icon={<LayoutGrid size={18} />} label="Pantalla / Kiosko" href="/admin/kiosko" active={pathname === "/admin/kiosko"} collapsed={collapsed} />
                            <SidebarItem icon={<SlidersHorizontal size={18} />} label="Calibración" href="/admin/calibracion-aforo" active={pathname === "/admin/calibracion-aforo"} collapsed={collapsed} />
                        </>
                    )}

                    {!modules.MODULE_QUEUE && (
                        <>
                            {isAdmin && (<SidebarItem icon={<CreditCard size={18} />} label="Tags RFID" href="/admin/rfid" active={pathname === "/admin/rfid"} collapsed={collapsed} />)}
                            {isAdmin && (<SidebarItem icon={<Users size={18} />} label="Grupos de Acceso" href="/admin/groups" active={pathname === "/admin/groups"} collapsed={collapsed} />)}
                        </>
                    )}

                    {modules.MODULE_LPR && !modules.MODULE_QUEUE && (
                        <SidebarItem icon={<LayoutGrid size={18} />} label="Plazas de Parking" href="/admin/plazas" active={pathname === "/admin/plazas"} collapsed={collapsed} />
                    )}

                    {modules.MODULE_LPR && modules.MODULE_GUARD && (
                        <>
                            {!collapsed && <div className="pt-3 pb-1 px-3 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider transition-opacity">Guardia</div>}
                            {collapsed && <div className="my-2 border-t border-border" />}
                            <SidebarItem icon={<ShieldCheck size={18} />} label="Consola de Guardia" href="/guard" active={pathname === "/guard"} collapsed={collapsed} />
                            <SidebarItem icon={<FileBarChart size={18} />} label="Bitácora" href="/admin/bitacora" active={pathname === "/admin/bitacora"} collapsed={collapsed} />
                            <SidebarItem icon={<ShieldCheck size={18} />} label="Consola / Puesto" href="/admin/consolas" active={pathname === "/admin/consolas"} collapsed={collapsed} />
                        </>
                    )}

                    <div className="my-2 border-t border-border" />
                    <SidebarItem icon={<BookOpen size={18} />} label="Manuales" href="/admin/manuales" active={pathname === "/admin/manuales"} collapsed={collapsed} />
                            {isAdmin && (<SidebarItem icon={<Settings size={18} />} label="Configuración" href="/admin/settings" active={pathname === "/admin/settings"} collapsed={collapsed} />)}
                </nav>

                <div className="p-3 border-t border-border space-y-2">
                    <OnlineUsersWidget collapsed={collapsed} />
                    <div className={cn("flex items-center gap-3 group p-2 rounded-2xl hover:bg-accent/50 transition-colors", collapsed && "justify-center p-0 hover:bg-transparent")}>
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-blue-500/20 shrink-0">
                            A
                        </div>
                        {!collapsed && (
                            <div className="overflow-hidden">
                                <p className="text-sm font-bold text-foreground leading-tight truncate">Admin User</p>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-tighter truncate">Super Admin</p>
                            </div>
                        )}
                        {!collapsed && (
                            <div className="ml-auto flex items-center gap-1.5">
                                <AlertBell className="cursor-pointer" />
                                <ThemeToggle />
                                <button
                                    onClick={handleLogout}
                                    disabled={loggingOut}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    title="Cerrar sesión"
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                    {collapsed && (
                        <div className="w-full flex justify-center mb-1"><ThemeToggle /></div>
                    )}
                    {collapsed && (
                        <button
                            onClick={handleLogout}
                            disabled={loggingOut}
                            className="w-full flex justify-center p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Cerrar sesión"
                        >
                            <LogOut size={16} />
                        </button>
                    )}
                </div>
            </aside>

            <main
                className={cn(
                    "flex-1 overflow-y-auto custom-scrollbar transition-all duration-300 ease-in-out font-sans h-screen",
                    collapsed ? "ml-[70px]" : "ml-64"
                )}
            >
                {roleLoaded && !isAdmin && ["/admin/settings", "/admin/users", "/admin/units", "/admin/devices", "/admin/groups", "/admin/rfid", "/admin/vehicles"].some((r) => pathname?.startsWith(r)) ? (
                    <div className="flex flex-col items-center justify-center h-[70vh] text-center gap-3 text-muted-foreground p-8">
                        <ShieldCheck size={40} className="text-amber-500" />
                        <h2 className="text-lg font-bold text-foreground">Acceso restringido</h2>
                        <p className="text-sm max-w-sm">Tu cuenta es de solo lectura: podés ver y operar el sistema, pero la gestión de usuarios/dispositivos y la configuración son para administradores.</p>
                    </div>
                ) : children}
            </main>

            <AforoAlertOverlay />
            <LiveEdgeKeeper />

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: var(--border);
                    border-radius: 10px;
                }
            `}</style>
        </div>
    );
}
