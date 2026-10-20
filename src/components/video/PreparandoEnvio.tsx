"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, horaSeg } from "@/lib/fechas";

/**
 * Mientras se arma y se manda un clip (Exportar clip, Compartir el evento), lo mismo que se ve al
 * abrir una grabación (20/10, Nico: «cuando se está preparando el video debe ser similar a la
 * animación del playback, trayendo imagen del NVR»): la foto del evento detrás y los pasos del
 * pedido, cada uno se tilda al pasar y el que está en curso dice cuánto lleva.
 *
 * Qué es medido y qué estimado, para no mentir: dónde está la cámara (canal del NVR) se pregunta de
 * verdad; el resto corre en el servidor en un solo pedido, así que el avance sale del tiempo — el
 * NVR entrega a tiempo real (un clip de 20 s tarda unos 20 s), y la intro ~EDICION_SEG. El
 * contador de segundos sí es real.
 */

/** Lo que tarda la intro y el logo (lib/clip-editado): ~10 s por minuto de video. */
const EDICION_SEG = 8;
/** Lo que el NVR tarda en empezar a mandar, más la espera del tramo posterior. */
const ARRANQUE_SEG = 4;

type Paso = { texto: string; estado: "hecho" | "ahora" | "luego"; nota?: string; sub?: string };

export function PreparandoEnvio({ poster, camara, instante, segundos, antes, canal, deviceId, desde, conClip = true, conIntro = true, enCola = false }: {
    poster?: string | null;
    camara?: string | null;
    /** El instante del evento (ms). */
    instante: number;
    /** Cuánto dura el clip, y cuánto de eso es antes del instante. */
    segundos: number;
    antes?: number;
    canal: "WhatsApp" | "Telegram";
    deviceId?: string | null;
    /** Cuándo empezó (ms). */
    desde: number;
    conClip?: boolean;
    conIntro?: boolean;
    /** Compartir: el envío todavía espera en la cola de despachos. */
    enCola?: boolean;
}) {
    const [ahora, setAhora] = useState(Date.now());
    useEffect(() => { const i = setInterval(() => setAhora(Date.now()), 250); return () => clearInterval(i); }, []);
    // Dónde graba la cámara: lo que el playback muestra primero («Cámara ubicada · canal 7»).
    const [ubicada, setUbicada] = useState<{ ch: number } | null | undefined>(conClip && deviceId ? undefined : null);
    useEffect(() => {
        if (!conClip || !deviceId) return;
        let vivo = true;
        fetch(`/api/nvr/channel?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (vivo) setUbicada(j && j.channel != null ? { ch: j.channel } : null); })
            .catch(() => { if (vivo) setUbicada(null); });
        return () => { vivo = false; };
    }, [conClip, deviceId]);

    const el = Math.max(0, (ahora - desde) / 1000);
    const finTramo = segundos + ARRANQUE_SEG;
    const finIntro = finTramo + (conIntro ? EDICION_SEG : 0);
    const total = conClip ? finIntro + 4 : 6;
    const a = antes ?? Math.floor(segundos / 2);
    const tramo = `${horaSeg(instante - a * 1000)} → ${horaSeg(instante + (segundos - a) * 1000)}`;

    const pasos: Paso[] = [];
    if (enCola) pasos.push({ texto: "En la cola de envíos", estado: "ahora" });
    if (conClip) {
        const fase = enCola ? -1 : el < finTramo ? 0 : el < finIntro ? 1 : 2;
        pasos.push({
            texto: ubicada === undefined ? "Ubicando la cámara en el NVR" : ubicada ? `Cámara ubicada · canal ${ubicada.ch}` : "Sin NVR: sale de la grabación local",
            estado: ubicada === undefined && !enCola ? "ahora" : enCola ? "luego" : "hecho",
        });
        pasos.push({ texto: "Pidiendo el tramo al NVR", sub: tramo, estado: fase < 0 || ubicada === undefined ? "luego" : fase === 0 ? "ahora" : "hecho", nota: fase === 0 ? `${Math.floor(el)} s de ~${finTramo}` : undefined });
        if (conIntro) pasos.push({ texto: "Sumando la intro y el logo de OmniAccess", estado: fase < 1 ? "luego" : fase === 1 ? "ahora" : "hecho" });
        pasos.push({ texto: `Enviando por ${canal}`, estado: fase < 2 ? "luego" : "ahora", nota: fase === 2 ? `${Math.floor(el)} s` : undefined });
    } else {
        pasos.push({ texto: "Preparando la foto y el texto", estado: enCola ? "luego" : el < 2 ? "ahora" : "hecho" });
        pasos.push({ texto: `Enviando por ${canal}`, estado: enCola || el < 2 ? "luego" : "ahora" });
    }
    const p = Math.min(0.95, el / total);

    return (
        <div className="relative w-full aspect-video rounded-[10px] overflow-hidden bg-black border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {poster && <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover opacity-45 scale-105 blur-[1.5px]" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/40" />
            <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 grid place-items-center px-4">
                <div className="cajon-vidrio w-[min(360px,100%)] rounded-[14px] border border-border shadow-xl px-5 py-4 text-foreground">
                    <div className="flex items-center gap-3">
                        <span className="relative w-10 h-10 shrink-0 grid place-items-center rounded-full bg-[var(--accion)]/12 text-[var(--accion)]">
                            <Send size={17} />
                            <span className="absolute inset-0 rounded-full border-2 border-[var(--accion)]/25 border-t-[var(--accion)] animate-spin [animation-duration:1.1s]" />
                        </span>
                        <div className="min-w-0 leading-tight">
                            <div className="text-[14px] font-bold truncate">{conClip ? "Clip" : "Foto"}{camara ? ` · ${camara}` : ""}</div>
                            <div className="text-[12px] text-muted-foreground tabular-nums">{fechaCorta(instante)} · {horaSeg(instante)}{conClip ? ` · ${segundos} s` : ""}</div>
                        </div>
                    </div>
                    <ol className="mt-3.5 space-y-2">
                        {pasos.map((x, i) => (
                            <li key={i} className={cn("flex items-start gap-2.5 text-[12.5px]", x.estado === "luego" ? "text-muted-foreground/60" : x.estado === "ahora" ? "font-semibold" : "text-muted-foreground")}>
                                <span className="w-4 h-4 mt-px shrink-0 grid place-items-center">
                                    {x.estado === "hecho" ? <Check size={14} className="tono-bien" strokeWidth={3} />
                                        : x.estado === "ahora" ? <Loader2 size={14} className="animate-spin text-[var(--accion)]" />
                                            : <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate">{x.texto}</span>
                                    {x.sub && <span className="block text-[11px] font-normal text-muted-foreground tabular-nums">{x.sub}</span>}
                                </span>
                                {x.nota && <span className="ml-auto pl-2 text-[11px] text-muted-foreground font-normal tabular-nums shrink-0">{x.nota}</span>}
                            </li>
                        ))}
                    </ol>
                    <div className="mt-3.5 h-1 rounded-full bg-muted overflow-hidden"><motion.div className="h-full bg-[var(--accion)]" animate={{ width: `${p * 100}%` }} transition={{ ease: "linear", duration: 0.25 }} /></div>
                </div>
            </motion.div>
        </div>
    );
}
