"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Video, Download } from "lucide-react";

// Reproductor de grabación LIVIANO para la tablet de guardias: un clip corto (~14s)
// centrado en el evento, sin timeline ni calendario. Pensado para rendimiento.
export default function GuardClipViewer({ event, onClose }: { event: any; onClose: () => void }) {
    const deviceId = event?.device?.id;
    const [channel, setChannel] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

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
                setChannel(ch); setLoading(false);
            })
            .catch(() => { if (alive) { setErr("No se pudo resolver la cámara"); setLoading(false); } });
        return () => { alive = false; };
    }, [deviceId, event]);

    if (!event) return null;
    const t = new Date(event.timestamp).getTime();
    const src = channel != null ? `/api/nvr/playback?ch=${channel}&t=${t}&pre=6&dur=14` : "";
    const dl = channel != null ? `/api/nvr/playback?ch=${channel}&t=${t}&pre=6&dur=14&download=1` : "";

    return (
        <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-5" onClick={onClose}>
            <div className="bg-white rounded-3xl overflow-hidden w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0"><Video size={16} /></div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-black uppercase tracking-tight leading-none truncate">{event.plateDetected || "Grabación"}</p>
                            <p className="text-[10px] text-black/40 font-bold uppercase tracking-widest mt-1 truncate">
                                {event.device?.name || "Cámara"} · {new Date(event.timestamp).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center active:scale-95 shrink-0"><X size={18} /></button>
                </div>

                <div className="relative bg-black aspect-video flex items-center justify-center">
                    {loading ? (
                        <div className="flex flex-col items-center gap-2 text-white/70">
                            {event.snapshotPath && <img src={event.snapshotPath} className="absolute inset-0 w-full h-full object-cover opacity-25" alt="" />}
                            <Loader2 size={26} className="animate-spin relative" />
                            <span className="text-[10px] font-bold uppercase tracking-widest relative">Cargando clip…</span>
                        </div>
                    ) : err ? (
                        <div className="flex flex-col items-center gap-2 text-white/70 px-6 text-center">
                            {event.snapshotPath && <img src={event.snapshotPath} className="absolute inset-0 w-full h-full object-cover opacity-30" alt="" />}
                            <span className="relative text-xs font-bold uppercase tracking-widest">{err}</span>
                        </div>
                    ) : (
                        <video key={src} src={src} className="w-full h-full object-contain" autoPlay muted playsInline controls poster={event.snapshotPath || undefined} />
                    )}
                </div>

                <div className="flex items-center justify-between px-5 py-3">
                    <span className="text-[10px] font-bold text-black/30 uppercase tracking-widest">Clip de ~14 s</span>
                    {channel != null && !err && (
                        <a href={dl} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#B20D30] uppercase tracking-wider active:scale-95"><Download size={13} /> Descargar</a>
                    )}
                </div>
            </div>
        </div>
    );
}
