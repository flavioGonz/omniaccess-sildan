"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { montarVivo } from "@/lib/vivo";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";

/**
 * La escena del calibrador: la foto de la cámara (por defecto) o su video en vivo, con una capa
 * encima del tamaño EXACTO del cuadro (26/11).
 *
 * Nico: «debe poder dibujar en vivo sobre el video o cambiar a imagen; imagen por defecto». Las
 * dos fuentes comparten la misma caja: el cuadro se encaja («contain») calculado acá y no con
 * `object-fit`, así la capa de dibujo cae justo sobre la imagen y no sobre las bandas negras —que
 * era por qué los puntos se corrían con el video en «contain»—. Lo dibujado se guarda en
 * fracciones del cuadro y es el mismo dibujo en foto o en vivo.
 *
 * La foto es la de la cámara en ese momento: no consume GPU ni ancho de banda mientras se dibuja.
 * El vivo sirve para ver pasar un auto y confirmar.
 */
export type Fondo = "imagen" | "vivo";

export function Escenario({ deviceId, fondo, nonce, children, alCargarFoto }: {
    deviceId: string; fondo: Fondo; nonce: number;
    children?: React.ReactNode;
    /** La URL de la foto que se está mostrando (la lupa del lienzo la usa). */
    alCargarFoto?: (url: string | null) => void;
}) {
    const hueco = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [relacion, setRelacion] = useState(16 / 9);
    const [caja, setCaja] = useState({ w: 0, h: 0 });
    const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
    const foto = `/api/snapshot/${deviceId}?w=1920&t=${nonce}`;

    useEffect(() => { const t = setTimeout(() => setEstado("cargando"), 0); return () => clearTimeout(t); }, [fondo, nonce, deviceId]);
    useEffect(() => { alCargarFoto?.(fondo === "imagen" && estado === "listo" ? foto : null); }, [fondo, estado, foto, alCargarFoto]);

    // El vivo: el mismo montaje que el resto de OmniAccess (lib/vivo), con sus reintentos.
    useEffect(() => {
        if (fondo !== "vivo") return;
        const v = video.current; if (!v) return;
        const alDatos = () => { if (v.videoWidth && v.videoHeight) setRelacion(v.videoWidth / v.videoHeight); setEstado("listo"); };
        const alError = () => setEstado("error");
        v.addEventListener("loadedmetadata", alDatos); v.addEventListener("error", alError);
        const cortar = montarVivo(v, deviceId);
        return () => { v.removeEventListener("loadedmetadata", alDatos); v.removeEventListener("error", alError); cortar(); };
    }, [fondo, deviceId, nonce]);

    const medir = useCallback(() => {
        const el = hueco.current; if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        if (!width || !height) return;
        setCaja(width / relacion <= height ? { w: width, h: width / relacion } : { w: height * relacion, h: height });
    }, [relacion]);
    useEffect(() => {
        const r = requestAnimationFrame(medir);
        const el = hueco.current; if (!el) return () => cancelAnimationFrame(r);
        const ro = new ResizeObserver(medir); ro.observe(el);
        return () => { cancelAnimationFrame(r); ro.disconnect(); };
    }, [medir]);

    return (
        <div ref={hueco} className="relative h-full w-full grid place-items-center">
            <div className="relative" style={{ width: caja.w || "100%", height: caja.h || "100%" }}>
                {fondo === "imagen" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={foto} src={foto} alt="" draggable={false}
                        onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRelacion(i.naturalWidth / i.naturalHeight); setEstado("listo"); }}
                        onError={() => setEstado("error")}
                        className="absolute inset-0 h-full w-full select-none rounded-[10px] bg-neutral-900 object-fill" />
                ) : (
                    <video ref={video} muted playsInline autoPlay className="absolute inset-0 h-full w-full rounded-[10px] bg-neutral-900 object-fill" />
                )}
                {children}
                {estado !== "listo" && (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[10px] bg-black/40">
                        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-white/80">
                            {estado === "cargando" ? <><Loader2 size={15} className="animate-spin" /> {fondo === "vivo" ? "Conectando el vivo…" : "Trayendo la foto de la cámara…"}</> : fondo === "vivo" ? "No llega video de esta cámara." : "La cámara no devolvió una foto."}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
