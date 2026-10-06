"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Download, RotateCw } from "lucide-react";

// Reproductor de grabación LIVIANO para la tablet de guardias: clip corto (~14s) centrado en
// el evento, SIN bordes — solo la hora y el video. Usa el MP4 completo (whole=1) para que
// reproduzca en el WebView de Android.
export default function GuardClipViewer({ event, onClose }: { event: any; onClose: () => void }) {
    const deviceId = event?.device?.id;
    const [channel, setChannel] = useState<number | null>(null);
    const [nvrId, setNvrId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [rk, setRk] = useState(0); // reintentar

    useEffect(() => {
        if (!event) return;
        if (!deviceId) { setErr("Sin cámara asociada"); setLoading(false); return; }
        let alive = true; setLoading(true); setErr(null); setChannel(null);
        fetch(`/api/nvr/channel?deviceId=${deviceId}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
                if (!alive) return;
                const ch = d && d.channel != null ? Number(d.channel) : null;
                if (ch == null) setErr("La cámara no tiene canal de grabación");
                setChannel(ch); setNvrId(d && d.nvr ? String(d.nvr) : null); setLoading(false);
            })
            .catch(() => { if (alive) { setErr("No se pudo resolver la cámara"); setLoading(false); } });
        return () => { alive = false; };
    }, [deviceId, event]);

    if (!event) return null;
    const t = new Date(event.timestamp).getTime();
    const nvrQ = nvrId ? `&nvr=${nvrId}` : "";
    const src = channel != null ? `/api/nvr/playback?ch=${channel}&t=${t}&whole=1${nvrQ}&rk=${rk}` : "";
    const dl = channel != null ? `/api/nvr/playback?ch=${channel}&t=${t}&download=1${nvrQ}` : "";
    const hora = new Date(event.timestamp).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    return (
        <div className="fixed inset-0 z-[300] bg-black/95 flex items-center justify-center" onClick={onClose}>
            {/* Hora — arriba izquierda */}
            <div className="absolute top-6 left-6 z-20 flex items-center gap-2 pointer-events-none">
                <span className="text-white text-2xl font-bold tabular-nums tracking-tight drop-shadow">{hora}</span>
                {event.plateDetected && event.plateDetected !== "NO_LEIDA" && (
                    <span className="px-2.5 py-1 rounded-lg bg-white/15 text-white text-sm font-bold uppercase tracking-widest backdrop-blur">{event.plateDetected}</span>
                )}
            </div>

            {/* Cerrar — arriba derecha */}
            <button onClick={onClose} className="absolute top-6 right-6 z-20 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center active:scale-95 transition-all">
                <X size={26} />
            </button>

            {/* Video a sangre, sin bordes */}
            <div className="w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                {loading ? (
                    <div className="flex flex-col items-center gap-3 text-white/70">
                        <Loader2 size={30} className="animate-spin" />
                        <span className="text-[11px] font-bold uppercase tracking-widest">Cargando clip…</span>
                    </div>
                ) : err ? (
                    <div className="flex flex-col items-center gap-3 text-white/70 px-8 text-center">
                        {event.snapshotPath && <img src={event.snapshotPath} className="max-h-[70vh] rounded-2xl opacity-40" alt="" />}
                        <span className="text-xs font-bold uppercase tracking-widest">{err}</span>
                    </div>
                ) : (
                    <video
                        key={src}
                        src={src}
                        className="max-w-full max-h-full"
                        autoPlay
                        muted
                        playsInline
                        controls
                        poster={event.snapshotPath || undefined}
                        onError={() => setErr("No se pudo reproducir el clip")}
                    />
                )}
            </div>

            {/* Acciones — abajo */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                {err && channel != null && (
                    <button onClick={() => { setErr(null); setLoading(false); setRk((x) => x + 1); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider active:scale-95">
                        <RotateCw size={15} /> Reintentar
                    </button>
                )}
                {channel != null && (
                    <a href={dl} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider active:scale-95"><Download size={15} /> Descargar</a>
                )}
            </div>
        </div>
    );
}
