"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, Clock, Maximize, Loader2, List, Check } from "lucide-react";
import { getQueueWaitEstimate, getQueueAlerts, getQueueDevices } from "@/app/actions/queue";
import { getAppBranding } from "@/app/actions/settings";

type Status = "ok" | "warn" | "full";

const THEME: Record<Status, { bg: string; light: string; label: string; sub: string }> = {
    ok:   { bg: "from-emerald-600 to-green-700", light: "#34d399", label: "PASE",           sub: "Hay lugar disponible" },
    warn: { bg: "from-amber-500 to-orange-600",  light: "#fbbf24", label: "AGUARDE",        sub: "Fila moderada" },
    full: { bg: "from-red-600 to-rose-700",      light: "#f87171", label: "AFORO COMPLETO", sub: "Por favor espere su turno" },
};

export default function KioskoPage() {
    const [aforo, setAforo] = useState(0);
    const [waitMin, setWaitMin] = useState<number | null>(null);
    const [limit, setLimit] = useState(8);
    const [devices, setDevices] = useState<any[]>([]);
    const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
    const [deviceName, setDeviceName] = useState("Fila");
    const [brand, setBrand] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(new Date());
    const [pickerOpen, setPickerOpen] = useState(false);

    // init: branding + devices + URL param (?device=<id>)
    useEffect(() => {
        (async () => {
            try {
                const [devs, b] = await Promise.all([getQueueDevices(), getAppBranding().catch(() => null)]);
                setBrand(b);
                const list = (devs as any[]) || [];
                setDevices(list);
                const urlId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("device") : null;
                const chosen = (urlId && list.find((d) => d.id === urlId)) || list[0] || null;
                if (chosen) { setDeviceId(chosen.id); setDeviceName(chosen.name || "Fila"); }
                else setLoading(false);
            } catch (e) { console.error(e); setLoading(false); }
        })();
    }, []);

    const load = useCallback(async () => {
        if (!deviceId) return;
        try {
            const [w, alerts] = await Promise.all([getQueueWaitEstimate(deviceId), getQueueAlerts()]);
            setAforo((w as any)?.aforo ?? 0);
            setWaitMin((w as any)?.waitMin ?? null);
            const ths = (alerts as any[]).map((a) => a.threshold).filter((n: number) => n > 0);
            if (ths.length) setLimit(Math.max(...ths));
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [deviceId]);

    useEffect(() => {
        if (!deviceId) return;
        setLoading(true);
        load();
        const t = setInterval(load, 5000);
        return () => clearInterval(t);
    }, [deviceId, load]);

    useEffect(() => { const c = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(c); }, []);

    const pick = (d: any) => {
        setDeviceId(d.id); setDeviceName(d.name || "Fila"); setPickerOpen(false);
        try { window.history.replaceState(null, "", `?device=${d.id}`); } catch { }
    };

    const ratio = limit > 0 ? aforo / limit : 0;
    const status: Status = ratio >= 1 ? "full" : ratio >= 0.7 ? "warn" : "ok";
    const th = THEME[status];

    const goFullscreen = () => { const el: any = document.documentElement; if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); };

    return (
        <div className={`fixed inset-0 bg-gradient-to-br ${th.bg} text-white flex flex-col items-center justify-center overflow-hidden transition-colors duration-700`}>
            <style>{`@keyframes kpulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.04);opacity:.92}}`}</style>

            {/* brand accent strip */}
            {brand?.primary && <div className="absolute top-0 left-0 right-0 h-1.5 z-30" style={{ background: brand.primary }} />}

            {/* top bar */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 py-5 z-20">
                <div className="flex items-center gap-3 min-w-0">
                    {brand?.logoUrl ? (
                        <div className="w-12 h-12 rounded-xl bg-white/90 flex items-center justify-center overflow-hidden shadow-lg shrink-0">
                            <img src={brand.logoUrl} alt="" className="w-full h-full object-contain p-1" />
                        </div>
                    ) : null}
                    <div className="leading-tight min-w-0">
                        <div className="text-lg font-black uppercase tracking-wide opacity-95 truncate">{brand?.name || "OmniAccess"}</div>
                        <div className="text-sm font-semibold opacity-80 truncate">{deviceName}</div>
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <div className="text-xl font-mono font-bold tabular-nums opacity-90">{now.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}</div>
                    {devices.length > 1 && (
                        <div className="relative">
                            <button onClick={() => setPickerOpen((o) => !o)} className="p-2 rounded-lg bg-white/15 hover:bg-white/25 transition" title="Elegir fila"><List size={18} /></button>
                            {pickerOpen && (
                                <>
                                    <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
                                    <div className="absolute right-0 mt-2 z-40 w-56 rounded-xl bg-black/80 backdrop-blur border border-border p-1.5 shadow-2xl">
                                        <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/50">Mostrar fila</div>
                                        {devices.map((d) => (
                                            <button key={d.id} onClick={() => pick(d)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-white/15 text-left text-sm">
                                                <span className="truncate">{d.name || "Fila"}</span>{d.id === deviceId && <Check size={15} className="shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <button onClick={goFullscreen} className="p-2 rounded-lg bg-white/15 hover:bg-white/25 transition" title="Pantalla completa"><Maximize size={18} /></button>
                </div>
            </div>

            {loading ? (
                <Loader2 size={48} className="animate-spin opacity-80" />
            ) : (
                <>
                    {/* Big semáforo status */}
                    <div className="text-center" style={{ animation: status === "full" ? "kpulse 1.2s ease-in-out infinite" : undefined }}>
                        <div className="mx-auto mb-8 rounded-full flex items-center justify-center shadow-2xl"
                            style={{ width: 220, height: 220, background: "rgba(255,255,255,0.14)", boxShadow: `0 0 80px ${th.light}88, inset 0 0 0 6px rgba(255,255,255,0.25)` }}>
                            {brand?.logoUrl ? <img src={brand.logoUrl} alt="" className="w-28 h-28 object-contain drop-shadow-lg" /> : <Users size={96} className="text-white drop-shadow-lg" />}
                        </div>
                        <div className="text-7xl xl:text-8xl font-black tracking-tighter leading-none drop-shadow-xl">{th.label}</div>
                        <div className="text-2xl xl:text-3xl font-medium mt-4 opacity-90">{th.sub}</div>
                    </div>

                    {/* metrics row */}
                    <div className="absolute bottom-0 left-0 right-0 grid grid-cols-2 divide-x divide-white/20 border-t border-border bg-black/15 backdrop-blur-sm">
                        <div className="flex flex-col items-center justify-center py-7">
                            <div className="flex items-center gap-2 text-sm uppercase tracking-widest font-bold opacity-80"><Users size={16} /> Personas en fila</div>
                            <div className="text-6xl font-black tabular-nums mt-1">{aforo}<span className="text-2xl font-medium opacity-70"> / {limit}</span></div>
                        </div>
                        <div className="flex flex-col items-center justify-center py-7">
                            <div className="flex items-center gap-2 text-sm uppercase tracking-widest font-bold opacity-80"><Clock size={16} /> Espera estimada</div>
                            <div className="text-6xl font-black tabular-nums mt-1">
                                {waitMin == null ? "—" : waitMin < 1 ? "<1" : `~${waitMin}`}<span className="text-2xl font-medium opacity-70"> min</span>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
