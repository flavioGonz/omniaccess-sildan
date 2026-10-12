"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Crosshair } from "lucide-react";
import { getIntrusionCameras, getVisualTrackLinks, type IntrusionCam, type TrackLink } from "@/app/actions/detections";

/**
 * El seguimiento visual sobre el vivo del visor: los íconos de cámara que se cargaron en el
 * visor de intrusión (VISUAL_TRACK_LINKS) en el punto de la escena por donde se pasa a cada
 * cámara vecina. Tocar uno cambia el vivo a esa cámara: el auto que salió de cuadro se sigue
 * en la siguiente sin cambiar de ventana. Mismos íconos y misma vista previa que LiveModal; los
 * enlaces se editan allá (el lápiz del vivo completo), acá sólo se usan.
 *
 * Va dentro de la caja de la imagen: las posiciones son fracciones de la escena.
 */
let camarasCache: Promise<IntrusionCam[]> | null = null;
const camaras = () => (camarasCache ||= getIntrusionCameras().catch(() => { camarasCache = null; return []; }));

export function SeguimientoVivo({ deviceId, onSeguir }: { deviceId: string; onSeguir: (c: { id: string; nombre: string }) => void }) {
    const [links, setLinks] = useState<TrackLink[]>([]);
    const [cams, setCams] = useState<IntrusionCam[]>([]);
    const [hover, setHover] = useState<number | null>(null);
    useEffect(() => { let on = true; getVisualTrackLinks(deviceId).then((l) => { if (on) setLinks(l); }).catch(() => { }); return () => { on = false; }; }, [deviceId]);
    useEffect(() => { let on = true; camaras().then((c) => { if (on) setCams(c); }); return () => { on = false; }; }, []);
    const destinos = useMemo(() => links.map((l) => ({ l, c: cams.find((c) => c.id === l.to) })).filter((x): x is { l: TrackLink; c: IntrusionCam } => !!x.c), [links, cams]);
    if (!destinos.length) return null;
    return (
        <div className="absolute inset-0 z-[7] pointer-events-none">
            {destinos.map(({ l, c }, i) => (
                <div key={c.id} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }} className="absolute -translate-x-1/2 -translate-y-1/2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onSeguir({ id: c.id, nombre: c.name }); }}
                        onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                        onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
                        title={`Seguir a ${c.name}`} aria-label={`Seguir a ${c.name}`}
                        className="pointer-events-auto relative grid place-items-center w-11 h-11 rounded-full text-white backdrop-blur-md ring-1 shadow-xl transition-all active:scale-90 bg-black/50 hover:bg-amber-500/90 ring-white/25 hover:ring-white/80">
                        <span className="absolute inset-0 rounded-full animate-ping bg-amber-400/40" />
                        <Camera size={18} className="relative" />
                        {hover === i && (
                            <div className={`absolute w-52 rounded-xl overflow-hidden bg-black/85 backdrop-blur-md ring-1 ring-white/20 shadow-2xl pointer-events-none z-10 ${l.y < 0.42 ? "top-full mt-2" : "bottom-full mb-2"} ${l.x < 0.2 ? "left-0" : l.x > 0.8 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
                                <div className="relative aspect-video bg-black">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={`/api/snapshot/${c.id}?w=320&t=hover`} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                    <video autoPlay muted playsInline src={`/go2rtc/api/stream.mp4?src=${encodeURIComponent(`lpr_${c.id}`)}&video=h264`} className="absolute inset-0 w-full h-full object-cover" />
                                    <span className="absolute top-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/55 text-[8px] font-extrabold uppercase tracking-wide text-amber-300"><Crosshair size={7} /> Seguir</span>
                                </div>
                                <div className="px-2 py-1.5 text-white text-[11px] font-bold truncate text-left">{c.name}</div>
                            </div>
                        )}
                    </button>
                </div>
            ))}
        </div>
    );
}
