"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { getSocketUrl } from "@/lib/socket-config";
import { getRecentDetections, type DetItem } from "@/app/actions/detections";
import { ShieldAlert, Activity, Radar, LogIn, LogOut, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const META: Record<string, { label: string; cls: string; Icon: any }> = {
    LINECROSS: { label: "Cruce de línea", cls: "text-red-300 border-red-500/40 bg-red-500/10", Icon: Radar },
    INTRUSION: { label: "Intrusión", cls: "text-red-300 border-red-500/40 bg-red-500/10", Icon: ShieldAlert },
    REGION_ENTER: { label: "Entra a zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", Icon: LogIn },
    REGION_EXIT: { label: "Sale de zona", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10", Icon: LogOut },
    MOTION: { label: "Movimiento", cls: "text-sky-300 border-sky-500/40 bg-sky-500/10", Icon: Activity },
    OTHER: { label: "Evento", cls: "text-slate-300 border-slate-500/40 bg-slate-500/10", Icon: Activity },
};

function ago(ts: string) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "hace " + s + "s";
    const m = Math.floor(s / 60); if (m < 60) return "hace " + m + "m";
    const h = Math.floor(m / 60); if (h < 24) return "hace " + h + "h";
    return new Date(ts).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

export function IntrusionPanel() {
    const [items, setItems] = useState<DetItem[]>([]);
    const [open, setOpen] = useState(true);
    const [showMotion, setShowMotion] = useState(false);

    useEffect(() => { getRecentDetections(30, showMotion).then(setItems).catch(() => { }); }, [showMotion]);

    useEffect(() => {
        let s: any;
        try {
            s = io(getSocketUrl(), { transports: ["websocket", "polling"] });
            s.on("general_detection", (d: any) => {
                if (!showMotion && d.type === "MOTION") return;
                setItems((prev) => [{ id: d.id, deviceId: d.deviceId, deviceName: d.deviceName, type: d.type, eventType: d.eventType, snapshotPath: null, timestamp: d.timestamp }, ...prev.filter((x) => x.id !== d.id)].slice(0, 30));
            });
        } catch { /* noop */ }
        return () => { try { s && s.disconnect(); } catch { } };
    }, [showMotion]);

    const nonMotionCount = items.filter((i) => i.type !== "MOTION").length;

    return (
        <div className="shrink-0 border-t border-neutral-800 bg-neutral-900/40">
            <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/5 transition-colors">
                <Radar size={13} className="text-red-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-300">Detecciones</span>
                {nonMotionCount > 0 && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/40">{nonMotionCount}</span>}
                <span className="ml-auto flex items-center gap-2">
                    <span
                        onClick={(e) => { e.stopPropagation(); setShowMotion((v) => !v); }}
                        className={cn("px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide border cursor-pointer", showMotion ? "bg-sky-500/20 text-sky-300 border-sky-500/40" : "text-muted-foreground border-border")}
                        title="Incluir movimiento"
                    >movimiento</span>
                    {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronUp size={14} className="text-muted-foreground" />}
                </span>
            </button>
            {open && (
                <div className="max-h-40 overflow-y-auto custom-scrollbar px-2 pb-2 space-y-1">
                    {items.length === 0 ? (
                        <div className="flex items-center justify-center h-14 text-[11px] text-muted-foreground">Sin detecciones</div>
                    ) : items.map((d) => {
                        const m = META[d.type] || META.OTHER;
                        return (
                            <div key={d.id} className={cn("flex items-center gap-2 px-2.5 py-1.5 rounded-lg border", m.cls)}>
                                <m.Icon size={15} className="shrink-0" />
                                <span className="text-xs font-bold">{m.label}</span>
                                <span className="text-[11px] text-white/70 truncate">{d.deviceName || "Cámara"}</span>
                                <span className="ml-auto text-[10px] text-white/50 shrink-0">{ago(d.timestamp)}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
