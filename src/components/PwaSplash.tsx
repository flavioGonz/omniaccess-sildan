"use client";

import { useEffect, useState } from "react";
import { getSplashConfig } from "@/app/actions/settings";

const PRESET: Record<string, { color1: string; color2: string; subtitle: string }> = {
    filas: { color1: "#6d28d9", color2: "#0a0a0b", subtitle: "Control de Fila" },
    lpr: { color1: "#1d4ed8", color2: "#0a0a0b", subtitle: "Control LPR" },
    face: { color1: "#047857", color2: "#0a0a0b", subtitle: "Control Facial" },
    global: { color1: "#6d28d9", color2: "#0a0a0b", subtitle: "" },
};

export default function PwaSplash({ target }: { target: string }) {
    const [cfg, setCfg] = useState<any>(null);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        let alive = true;
        getSplashConfig(target).then((c: any) => {
            if (!alive) return;
            // Si nunca se configuró, usar preset por modo (color + subtítulo)
            if (c && !c._stored) {
                const p = PRESET[target] || PRESET.global;
                c = { ...c, color1: p.color1, color2: p.color2, subtitle: c.subtitle || p.subtitle };
            }
            setCfg(c || {});
        }).catch(() => setCfg({}));
    }, [target]);

    useEffect(() => {
        if (!cfg) return;
        const d = Math.max(600, cfg.duration ?? 1700);
        const t = setTimeout(() => setGone(true), d + 500);
        return () => clearTimeout(t);
    }, [cfg]);

    if (gone || !cfg) return null;

    const bg = cfg.bgType === "color"
        ? (cfg.gradient ? `linear-gradient(${cfg.angle ?? 160}deg, ${cfg.color1}, ${cfg.color2})` : cfg.color1)
        : cfg.color2 || "#0a0a0b";
    const fadeAt = Math.max(300, (cfg.duration ?? 1700) - 300);

    return (
        <div className="absolute inset-0 z-[120] flex flex-col items-center justify-center overflow-hidden"
            style={{ background: bg, animation: "pwaSplashOut .5s ease forwards", animationDelay: `${fadeAt}ms` }}>
            {cfg.bgType === "image" && cfg.imageUrl && <img src={cfg.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            {cfg.bgType === "video" && cfg.videoUrl && <video src={cfg.videoUrl} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />}
            {cfg.overlay > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${(cfg.overlay || 0) / 100})` }} />}

            <div className="relative flex flex-col items-center gap-4 px-8 text-center animate-in fade-in zoom-in-95 duration-500">
                {cfg.showLogo && cfg.logoUrl && (
                    <img src={cfg.logoUrl} alt="" style={{ width: cfg.logoSize || 96, height: cfg.logoSize || 96, objectFit: "contain" }} className="drop-shadow-lg" />
                )}
                {cfg.title && <h1 className="text-3xl font-bold tracking-tight" style={{ color: cfg.titleColor || "#fff" }}>{cfg.title}</h1>}
                {cfg.subtitle && <p className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: cfg.subtitleColor || "#ffffffb3" }}>{cfg.subtitle}</p>}
                {cfg.spinner && (
                    <div className="mt-3 w-7 h-7 rounded-full animate-spin"
                        style={{ border: `2px solid ${(cfg.spinnerColor || "#fff") + "44"}`, borderTopColor: cfg.spinnerColor || "#fff" }} />
                )}
            </div>
            <style>{`@keyframes pwaSplashOut{to{opacity:0;visibility:hidden}}`}</style>
        </div>
    );
}
