"use client";

import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { getSetting, updateSetting } from "@/app/actions/settings";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function AnimatedAlertToggle() {
    const [on, setOn] = useState(false);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => { getSetting("DISPATCH_ANIMATED").then((s: any) => { setOn(s?.value === "true"); setLoaded(true); }).catch(() => setLoaded(true)); }, []);
    const toggle = async () => {
        const next = !on; setOn(next);
        try { await updateSetting("DISPATCH_ANIMATED", next ? "true" : "false"); toast.success(next ? "Clip animado activado" : "Clip animado desactivado"); }
        catch { setOn(!next); toast.error("No se pudo guardar"); }
    };
    return (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-pink-500/10 text-pink-400 flex items-center justify-center shrink-0"><Film size={16} /></div>
            <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-foreground">Clip animado en alertas</div>
                <div className="text-[10px] text-muted-foreground leading-tight">Envía un video corto en vivo de la cámara en lugar de la foto (WhatsApp y Telegram). Si falla, manda la foto.</div>
            </div>
            <button onClick={toggle} disabled={!loaded} role="switch" aria-checked={on}
                className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0", on ? "bg-emerald-500" : "bg-muted-foreground/30")}>
                <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
            </button>
        </div>
    );
}
