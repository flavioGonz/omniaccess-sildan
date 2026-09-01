"use client";

import { useEffect } from "react";

/**
 * Mantiene los <video> de cámaras (streams go2rtc MP4 en vivo) pegados al
 * borde en vivo. Con las horas, el MP4-over-HTTP acumula buffer y la imagen
 * queda atrás del "ahora" (el aforo por socket sí está al día → sensación de
 * desincronización). Cada pocos segundos: si el video quedó muy atrás → salta
 * al vivo; si quedó un poco atrás → acelera levemente para alcanzarlo.
 * Sólo actúa sobre URLs de go2rtc (no toca splash, webcams ni videos en loop).
 */
export default function LiveEdgeKeeper() {
    useEffect(() => {
        const tick = () => {
            const vids = document.querySelectorAll("video");
            vids.forEach((v) => {
                try {
                    const src = v.currentSrc || v.src || "";
                    if (!src.includes("/go2rtc/")) return;      // sólo streams en vivo
                    if (v.loop) return;
                    const b = v.buffered;
                    if (!b || b.length === 0) return;
                    const end = b.end(b.length - 1);
                    if (!isFinite(end) || end <= 0) return;
                    const lag = end - v.currentTime;
                    if (lag > 4) {                              // muy atrasado → saltar al vivo
                        try { v.currentTime = Math.max(0, end - 0.4); } catch {}
                        if (v.playbackRate !== 1) v.playbackRate = 1;
                    } else if (lag > 1.5) {                     // algo atrasado → alcanzar
                        if (v.playbackRate !== 1.07) v.playbackRate = 1.07;
                    } else {
                        if (v.playbackRate !== 1) v.playbackRate = 1;
                    }
                    if (v.paused && !v.ended) v.play().catch(() => {});
                } catch { /* noop */ }
            });
        };
        const id = setInterval(tick, 4000);
        return () => clearInterval(id);
    }, []);
    return null;
}
