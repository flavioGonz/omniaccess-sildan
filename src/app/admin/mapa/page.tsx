"use client";

import dynamic from "next/dynamic";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";

const BarrioMap = dynamic(() => import("@/components/BarrioMap"), {
    ssr: false,
    loading: () => (
        <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={18} /> Cargando mapa…
        </div>
    ),
});

export default function MapaPage() {
    const [kiosk, setKiosk] = useState(false);

    // Deep-link: /admin/mapa?kiosk=1 abre directo en modo kiosko (oculta el chrome admin).
    useEffect(() => {
        try { if (new URLSearchParams(window.location.search).get("kiosk") === "1") setKiosk(true); } catch { }
    }, []);

    const enterKiosk = async () => {
        setKiosk(true);
        try { await document.documentElement.requestFullscreen?.(); } catch { }
    };
    const exitKiosk = async () => {
        setKiosk(false);
        try { if (document.fullscreenElement) await document.exitFullscreen?.(); } catch { }
    };

    // Esc sale del kiosko; si el navegador sale de fullscreen (F11/Esc), también salimos.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitKiosk(); };
        const onFs = () => { if (!document.fullscreenElement) setKiosk((k) => (k ? false : k)); };
        window.addEventListener("keydown", onKey);
        document.addEventListener("fullscreenchange", onFs);
        return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFs); };
    }, []);

    return (
        <div className={kiosk ? "fixed inset-0 z-[9998] bg-black" : "relative h-[calc(100vh-0px)] w-full"}>
            <BarrioMap />
            {!kiosk ? (
                <button onClick={enterKiosk} title="Modo kiosko — pantalla completa para el puesto de monitoreo (sin menú)"
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[700] h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-black/55 backdrop-blur-sm text-white text-xs font-bold shadow-lg hover:bg-black/75 transition-colors">
                    <Maximize2 size={14} /> Kiosko
                </button>
            ) : (
                <button onClick={exitKiosk} title="Salir del kiosko (Esc)"
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[9999] h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-black/55 backdrop-blur-sm text-white text-xs font-bold shadow-lg hover:bg-black/75 transition-colors">
                    <Minimize2 size={14} /> Salir del kiosko
                </button>
            )}
        </div>
    );
}
