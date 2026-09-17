"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useSessionRole } from "@/hooks/useSessionRole";
import { Users, ShieldCheck, Monitor, Eye } from "lucide-react";

type Panel = { id: string; name: string; role: string; ts: number };
type Guard = { id: string; name: string; role: string; ts: number };

const rolLabel = (r: string) =>
    r === "OPERATOR" ? "Solo lectura" : r === "GUARD" ? "Guardia" : "Administrador";

export function OnlineUsersWidget({ collapsed }: { collapsed?: boolean }) {
    const { name, role, loaded } = useSessionRole();
    const [data, setData] = useState<{ panel: Panel[]; guards: Guard[]; total: number }>({ panel: [], guards: [], total: 0 });
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!loaded) return;
        const s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling", "websocket"], reconnection: true });
        const hello = () => s.emit("panel_hello", { name: name || "Usuario", role: role || "ADMIN" });
        s.on("connect", () => { hello(); s.emit("get_online_users"); });
        s.on("online_users", (d: any) => setData(d && d.panel ? d : { panel: [], guards: [], total: 0 }));
        const iv = setInterval(() => { if (s.connected) s.emit("panel_ping"); }, 30000);
        return () => { clearInterval(iv); s.disconnect(); };
    }, [loaded, name, role]);

    useEffect(() => {
        const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
        if (open) window.addEventListener("mousedown", close);
        return () => window.removeEventListener("mousedown", close);
    }, [open]);

    const total = data.total || 0;

    return (
        <div ref={boxRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={
                    "w-full flex items-center gap-2 rounded-lg border border-border bg-card/60 hover:bg-accent transition-colors px-2.5 py-1.5 " +
                    (collapsed ? "justify-center" : "")
                }
                title={`${total} en línea`}
            >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                {!collapsed && (
                    <span className="text-xs font-semibold text-foreground/90 flex-1 text-left">
                        {total} en línea
                    </span>
                )}
                {!collapsed && <Users size={14} className="text-muted-foreground" />}
            </button>

            {open && (
                <div className="absolute bottom-full mb-2 left-0 w-64 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl p-2 z-50">
                    <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                        <span>Usuarios en línea</span>
                        <span className="text-emerald-500">{total}</span>
                    </div>

                    {data.panel.length > 0 && (
                        <>
                            <div className="px-2 pt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">Panel</div>
                            {data.panel.map((u) => (
                                <div key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent">
                                    {u.role === "OPERATOR" ? <Eye size={13} className="text-amber-500" /> : <Monitor size={13} className="text-blue-500" />}
                                    <span className="text-xs font-medium text-foreground truncate flex-1">{u.name}</span>
                                    <span className="text-[9px] font-bold uppercase text-muted-foreground">{rolLabel(u.role)}</span>
                                </div>
                            ))}
                        </>
                    )}

                    {data.guards.length > 0 && (
                        <>
                            <div className="px-2 pt-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">Guardias (tablet)</div>
                            {data.guards.map((g) => (
                                <div key={g.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent">
                                    <ShieldCheck size={13} className="text-emerald-500" />
                                    <span className="text-xs font-medium text-foreground truncate flex-1">{g.name}</span>
                                    <span className="text-[9px] font-bold uppercase text-muted-foreground">Guardia</span>
                                </div>
                            ))}
                        </>
                    )}

                    {total === 0 && (
                        <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nadie conectado ahora</div>
                    )}
                </div>
            )}
        </div>
    );
}
