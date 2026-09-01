"use client";

import React, { useState } from "react";
import {
    LayoutDashboard, Users, Car, Settings, ShieldCheck, History,
    DoorOpen, HelpCircle, LayoutGrid, Video, Calendar,
    ChevronLeft, ChevronRight, Activity, FileText, Monitor, ScanFace
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export default function SecuritySidebar() {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    const items = [
        { icon: LayoutDashboard, label: "Monitor en Vivo LPR", href: "/admin/dashboard" },
        { icon: ScanFace, label: "Monitor en Vivo Face", href: "/admin/dashboard-face" },
        { icon: History, label: "Historial de Acceso", href: "/admin/history" },
        { icon: Monitor, label: "Consola de Guardia", href: "/admin/consolas" },
        { divider: true, label: "Gestión" },
        { icon: Users, label: "Usuarios & Residentes", href: "/admin/users" },
        { icon: DoorOpen, label: "Unidades / Lotes", href: "/admin/units" },
        { icon: Car, label: "Vehículos / Matrículas", href: "/admin/vehicles" },
        { icon: LayoutGrid, label: "Plazas de Parking", href: "/admin/plazas" },
        { icon: Video, label: "Dispositivos", href: "/admin/devices" },
        { divider: true, label: "Reportes" },
        { icon: Calendar, label: "Calendario", href: "/admin/calendar" },
        { icon: Settings, label: "Configuración", href: "/admin/settings" },
        { icon: Activity, label: "Debug Webhooks", href: "/admin/debug" }
    ];

    return (
        <aside
            className={cn(
                "border-r border-border flex flex-col h-full bg-[#050505] backdrop-blur-xl z-[150] transition-all duration-300 ease-in-out shrink-0",
                collapsed ? "w-[70px]" : "w-64"
            )}
        >
            <div className="p-4 border-b border-border bg-black/20 flex items-center justify-between h-[60px]">
                <div className={cn("flex items-center gap-2 overflow-hidden transition-all", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
                    <div className="w-6 h-6 bg-red-600 rounded flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(220,38,38,0.5)]">
                        <ShieldCheck size={14} className="text-foreground" />
                    </div>
                    <div className="whitespace-nowrap">
                        <h2 className="text-xs font-bold text-foreground uppercase tracking-[0.2em]">OmniAccess</h2>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest leading-none">Sentinel Pro</p>
                    </div>
                </div>

                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className={cn("p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors", collapsed && "mx-auto")}
                >
                    {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
                {items.map((item, id) => {
                    if (item.divider) {
                        return !collapsed ? (
                            <div key={id} className="pt-3 pb-1 px-3 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                {item.label}
                            </div>
                        ) : <div key={id} className="my-2 border-t border-border" />;
                    }

                    const Icon = item.icon!;
                    const active = pathname === item.href;

                    return (
                        <Link
                            key={id}
                            href={item.href || "#"}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 text-xs font-medium rounded-xl transition-all group relative",
                                active ? "bg-red-600/10 text-foreground border border-red-600/20 shadow-[inset_0_0_10px_rgba(220,38,38,0.1)]" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                                collapsed && "justify-center px-2"
                            )}
                        >
                            <div className={cn("shrink-0 relative", active ? "text-red-500" : "group-hover:text-red-400")}>
                                <Icon size={18} />
                            </div>
                            {!collapsed && <span className="whitespace-nowrap truncate">{item.label}</span>}
                            {collapsed && (
                                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 bg-black border border-border text-white text-[10px] uppercase font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-[200]">
                                    {item.label}
                                </div>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Profile */}
            <div className="p-3 border-t border-border bg-black/40">
                <div className={cn("flex items-center gap-3 p-2 rounded-2xl hover:bg-accent transition-colors cursor-pointer", collapsed && "justify-center p-0")}>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-foreground font-bold text-xs shadow-lg shrink-0">A</div>
                    {!collapsed && (
                        <div className="overflow-hidden">
                            <p className="text-[10px] font-bold text-foreground leading-tight truncate">Admin Sentinel</p>
                            <p className="text-[8px] text-muted-foreground font-bold uppercase tracking-tighter truncate">Tactical Unit</p>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}
