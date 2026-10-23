"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Camera, History, Loader2, Maximize2, Minimize2, Plus, VideoOff, X } from "lucide-react";
import { Vivo, Foto, vivoDe, reproduceH265, usaHls } from "@/components/monitor/camaras/piezas";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { cn } from "@/lib/utils";

/**
 * La video verificación de un evento de central, igual en la ficha del panel y en la pared
 * (openspec alarmas-como-funciones, «verificacion-video-alarmas»; 23/10, Nico: «al abrir el evento,
 * traer cámaras en vivo de ese cliente para video verificación, del evento (playback) y en vivo»).
 *
 *  · Las cámaras de la verificación (zona → área → abonado) arrancan EN VIVO solas. Si el navegador
 *    no puede con H.265 se pide la versión convertida; si a los 12 s no hay imagen, la foto de la
 *    cámara cada 2 s con el rótulo «foto».
 *  · «Ver el momento»: la grabación desde unos segundos antes del evento (el «antes» de Ajustes →
 *    Video del evento lo pone VerGrabacion). Mientras se mira, esa cámara suelta su vivo: una PC de
 *    pared con cuatro vivos y una grabación encima se arrastra. Sin grabador conocido, se dice.
 *  · «Otras cámaras del abonado»: se suman con un toque, en vivo, sin sacar ninguna.
 *  · Tocar una cámara la agranda; otro toque vuelve al mosaico.
 *
 * No decide nada: tomar y tratar son de la ficha. En la pared (`escala="pared"`) ocupa el alto que le
 * den; en el panel las baldosas son 16:9 y la ficha se desplaza.
 */

/** `grabador` sin dato (la cámara llegó por el socket y la consulta todavía no la describió): no se ofrece ni se niega la grabación. */
export type CamVerif = { id: string; nombre: string; stream: string; deviceId?: string | null; nvrId?: string | null; ch?: number | null; grabador?: boolean };
export type OrigenVerif = { origen: "zona" | "area" | "abonado" | "ninguna"; area?: string | null };

/** Sin imagen en este tiempo la baldosa pasa a la foto (lo mismo que espera `Vivo`). */
const FOTO_MS = 2000;
/** Cuántas cámaras a la vez como mucho (las de la zona son hasta 4; con las otras, hasta 6). */
const MAXIMO = 6;

const ORIGEN: Record<OrigenVerif["origen"], (a?: string | null) => string> = {
    zona: () => "Cámaras de la zona",
    area: (a) => `Cámaras del área${a ? ` ${a}` : ""}`,
    abonado: () => "Cámaras del abonado",
    ninguna: () => "Sin cámaras",
};

function Baldosa({ c, h265, hls, pared, sola, quitable, enPausa, alTocar, alMomento, alQuitar }: {
    c: CamVerif; h265: boolean; hls: boolean; pared: boolean; sola: boolean; quitable: boolean; enPausa: boolean;
    alTocar: () => void; alMomento: () => void; alQuitar: () => void;
}) {
    const [vivo, setVivo] = useState<boolean | null>(null);
    useEffect(() => { setVivo(null); }, [c.stream]);
    // La foto de respaldo: la del equipo, o la del canal pedida al NVR (la misma que usa el Monitor CCTV).
    const foto = c.deviceId ? `/api/snapshot/${c.deviceId}?w=1280` : c.nvrId && c.ch != null ? `/api/monitor/camaras/foto?nvr=${encodeURIComponent(c.nvrId)}&ch=${c.ch}&w=1280` : null;
    return (
        <motion.div layout transition={{ duration: 0.22 }} className={cn("relative rounded-xl overflow-hidden bg-black ring-1 ring-white/10 min-h-0", !pared && "aspect-video")}>
            <button type="button" onClick={alTocar} aria-label={sola ? "Volver al mosaico" : `Agrandar ${c.nombre}`} className="absolute inset-0 w-full h-full">
                {enPausa ? <span className="absolute inset-0 grid place-items-center text-white/50 text-[14px]">Mirando la grabación…</span>
                    : vivo !== false
                        ? <Vivo src={vivoDe(c.stream, !h265, hls)} alResultado={setVivo} className="absolute inset-0 w-full h-full object-contain" />
                        : foto ? <Foto src={foto} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-contain" />
                            : <span className="absolute inset-0 grid place-items-center text-white/45 text-[13px]"><VideoOff size={22} className="mx-auto mb-1" />Sin imagen del canal</span>}
                {!enPausa && vivo === null && <span className="absolute inset-0 grid place-items-center text-white/40"><Loader2 size={pared ? 34 : 24} className="animate-spin" /></span>}
            </button>
            <div className={cn("absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 to-transparent flex items-center gap-2 pointer-events-none", pared ? "px-4 pt-3 pb-10" : "px-3 pt-2 pb-6")}>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-[0.1em] shrink-0", pared ? "h-7 px-2.5 text-[12px]" : "h-5 px-2 text-[10px]", vivo === false ? "bg-white/15 text-white/80" : "pleno-mal")}>
                    {vivo === false ? <><Camera size={pared ? 13 : 10} /> Foto</> : <><span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> En vivo</>}
                </span>
                <span className={cn("font-bold text-white drop-shadow truncate", pared ? "text-[19px]" : "text-[13px]")}>{c.nombre}</span>
            </div>
            <div className={cn("absolute bottom-0 inset-x-0 flex items-center gap-1.5 justify-end bg-gradient-to-t from-black/75 to-transparent", pared ? "px-3 pb-3 pt-8" : "px-2 pb-2 pt-6")}>
                {c.grabador
                    ? <button type="button" onClick={alMomento} className={cn("inline-flex items-center gap-1.5 rounded-lg bg-white/90 text-black font-bold hover:bg-white", pared ? "h-10 px-3.5 text-[14px]" : "h-7 px-2.5 text-[11.5px]")}><History size={pared ? 16 : 13} /> Ver el momento</button>
                    : c.grabador === false && <span title="Esta cámara no tiene grabador: sólo hay vivo." className={cn("inline-flex items-center gap-1 rounded-lg bg-black/55 text-white/70", pared ? "h-10 px-3 text-[13px]" : "h-7 px-2 text-[11px]")}><VideoOff size={pared ? 14 : 12} /> Sin grabador: sólo vivo</span>}
                <button type="button" onClick={alTocar} aria-label={sola ? "Volver al mosaico" : "Agrandar"} className={cn("grid place-items-center rounded-lg bg-black/55 text-white/85 hover:bg-black/70", pared ? "h-10 w-10" : "h-7 w-7")}>{sola ? <Minimize2 size={pared ? 17 : 13} /> : <Maximize2 size={pared ? 17 : 13} />}</button>
                {quitable && <button type="button" onClick={alQuitar} aria-label={`Sacar ${c.nombre}`} className={cn("grid place-items-center rounded-lg bg-black/55 text-white/85 hover:bg-black/70", pared ? "h-10 w-10" : "h-7 w-7")}><X size={pared ? 17 : 13} /></button>}
            </div>
        </motion.div>
    );
}

export function VerificacionVideo({ eventoId, instanteMs, camaras, otras = [], origen, escala = "panel", vacio, className }: {
    eventoId: string;
    /** La hora del evento: «Ver el momento» arranca ahí (menos el «antes» de Ajustes). */
    instanteMs: number;
    camaras: CamVerif[];
    /** Las demás cámaras del abonado, que se suman con un toque. */
    otras?: CamVerif[];
    origen?: OrigenVerif | null;
    escala?: "pared" | "panel";
    /** Qué mostrar si no hay ninguna cámara (la pared pone la escena grande). */
    vacio?: React.ReactNode;
    className?: string;
}) {
    const pared = escala === "pared";
    const [h265, setH265] = useState(true);
    const [hls, setHls] = useState(false);
    const [sola, setSola] = useState<string | null>(null);
    const [sumadas, setSumadas] = useState<string[]>([]);
    const [momento, setMomento] = useState<CamVerif | null>(null);
    useEffect(() => { setH265(reproduceH265()); setHls(usaHls()); }, []);
    // Otro evento: se vuelve a las cámaras de ese evento.
    useEffect(() => { setSola(null); setSumadas([]); setMomento(null); }, [eventoId]);

    const base = camaras.slice(0, MAXIMO);
    const extra = otras.filter((o) => sumadas.includes(o.id) && !base.some((c) => c.id === o.id));
    const todas = [...base, ...extra].slice(0, MAXIMO);
    const disponibles = otras.filter((o) => !todas.some((c) => c.id === o.id));
    const vistas = sola ? todas.filter((c) => c.id === sola) : todas;
    const n = vistas.length;
    // En la pared el lugar es más ancho que alto: dos cámaras van una arriba de la otra.
    const cols = n <= 1 ? 1 : pared ? (n === 2 ? 1 : n <= 4 ? 2 : 3) : n <= 4 ? 2 : 3;
    const filas = Math.ceil(n / cols);

    return (
        <section className={cn("flex flex-col gap-2 min-h-0", pared && "h-full", className)}>
            {origen && todas.length > 0 && (
                <div className={cn("flex items-center gap-1.5 text-muted-foreground", pared ? "text-[13px]" : "text-[10px] font-bold uppercase tracking-[0.14em]")}>
                    <Camera size={pared ? 14 : 12} /> {ORIGEN[origen.origen](origen.area)}{extra.length ? ` · y ${extra.length} del abonado` : ""}
                </div>
            )}
            {todas.length === 0 ? (vacio ?? (
                <div className="rounded-[10px] border border-dashed border-border px-4 py-5 text-[12.5px] text-muted-foreground">
                    No hay cámaras para verificar este evento. Se asocian en Dispositivos › la central: a la zona, a su área o al abonado.
                </div>
            )) : (
                <div className={cn("grid gap-2 min-h-0", pared && "flex-1")}
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ...(pared ? { gridTemplateRows: `repeat(${filas}, minmax(0, 1fr))` } : {}) }}>
                    {vistas.map((c) => (
                        <Baldosa key={c.id} c={c} h265={h265} hls={hls} pared={pared} sola={!!sola} enPausa={momento?.id === c.id}
                            quitable={extra.some((x) => x.id === c.id)}
                            alTocar={() => setSola((s) => (s ? null : todas.length > 1 ? c.id : null))}
                            alMomento={() => setMomento(c)}
                            alQuitar={() => { setSumadas((xs) => xs.filter((x) => x !== c.id)); if (sola === c.id) setSola(null); }} />
                    ))}
                </div>
            )}
            {disponibles.length > 0 && todas.length < MAXIMO && (
                <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] shrink-0">
                    <span className={cn("shrink-0 text-muted-foreground", pared ? "text-[13px]" : "text-[11.5px]")}>Otras cámaras del abonado:</span>
                    {disponibles.map((o) => (
                        <button key={o.id} type="button" onClick={() => setSumadas((xs) => [...xs, o.id])}
                            className={cn("shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-card hover:bg-accent font-semibold", pared ? "h-10 px-3.5 text-[14px]" : "h-7 px-2.5 text-[11.5px]")}>
                            <Plus size={pared ? 15 : 12} /> {o.nombre}
                        </button>
                    ))}
                </div>
            )}
            {momento && (
                <VerGrabacion deviceId={momento.deviceId || momento.nvrId || momento.id} nombre={momento.nombre} tab="rec" instanteMs={instanteMs}
                    canal={momento.ch ?? null} nvrId={momento.nvrId ?? null} onClose={() => setMomento(null)} />
            )}
        </section>
    );
}
