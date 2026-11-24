"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { MapPinOff } from "lucide-react";
import { Girando as Loader2 } from "@/components/brand/CargaOmni";
import { OmniLogo } from "@/components/brand/OmniLogo";
import { quedaLegible, type VistaCompartida } from "@/lib/gps-compartir";
import { hace, hora } from "@/lib/fechas";

const Mapa = dynamic(() => import("./MapaSeguir"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-white/70"><Loader2 className="animate-spin" /></div> });

/** Cada cuánto se vuelve a pedir: el rastreador manda cada diez segundos cuando anda. */
const CADA_MS = 10_000;

export function Seguir({ token }: { token: string }) {
    /* `null` = todavía no contestó; `false` = el enlace no sirve (o dejó de servir mientras se miraba). */
    const [v, setV] = useState<VistaCompartida | false | null>(null);
    const [sinRed, setSinRed] = useState(false);
    useEffect(() => {
        let vivo = true;
        const pedir = () => fetch(`/api/gps/seguir/${encodeURIComponent(token)}`, { cache: "no-store" })
            .then(async (r) => { if (!vivo) return; if (r.status === 404) { setV(false); return; } if (r.ok) { setV(await r.json()); setSinRed(false); } else setSinRed(true); })
            .catch(() => { if (vivo) setSinRed(true); });
        pedir();
        const iv = setInterval(pedir, CADA_MS);
        return () => { vivo = false; clearInterval(iv); };
    }, [token]);

    if (v === false) return (
        <main className="grid min-h-dvh place-items-center bg-[#0a0e14] p-6 text-center text-white">
            <div>
                <MapPinOff size={30} className="mx-auto text-white/50" />
                <h1 className="mt-4 text-[20px] font-bold tracking-[-0.02em]">Este enlace ya no sirve</h1>
                <p className="mx-auto mt-2 max-w-[320px] text-[13.5px] leading-snug text-white/60">Venció o quien lo compartió lo cortó. Si todavía lo necesitás, pedile uno nuevo.</p>
            </div>
        </main>
    );
    const conPunto = !!v && v.lat !== null && v.lon !== null;
    return (
        <main className="relative h-dvh w-full overflow-hidden bg-[#0a0e14] text-white">
            {conPunto ? <Mapa v={v as VistaCompartida} /> : <div className="grid h-full place-items-center px-6 text-center text-[13.5px] text-white/70">{v ? "Todavía no hay una posición de este vehículo." : <Loader2 className="animate-spin" />}</div>}

            {/* Flota sobre el mapa: lo único que hay que saber, arriba. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-3 p-3">
                <div className="pointer-events-auto max-w-[78%] rounded-[14px] bg-[#0a0e14]/88 px-3.5 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,.45)] backdrop-blur">
                    <p className="truncate text-[15px] font-bold tracking-[-0.01em]">{v ? v.nombre : "Buscando…"}</p>
                    {v && (
                        <p className="mt-0.5 text-[12px] leading-snug text-white/70 tabular-nums">
                            <span className={v.enLinea ? "text-emerald-400" : "text-amber-400"}>{v.enLinea ? "● En línea" : "● Sin reportar"}</span>
                            {v.cuando && <> · {v.velocidad ? `${v.velocidad} km/h` : "detenido"} · {hora(v.cuando)} ({hace(v.cuando)})</>}
                        </p>
                    )}
                    {sinRed && <p className="mt-0.5 text-[11.5px] text-amber-400">Sin conexión: se muestra lo último que llegó.</p>}
                </div>
                <div className="pointer-events-auto flex items-center gap-1.5 rounded-[14px] bg-[#0a0e14]/88 px-2.5 py-2 text-white shadow-[0_6px_24px_rgba(0,0,0,.45)] backdrop-blur"><OmniLogo size={18} /><span className="hidden text-[12px] font-bold sm:inline">OmniAccess</span></div>
            </div>
            {v && <p className="pointer-events-none absolute inset-x-0 bottom-3 z-[1000] text-center text-[11.5px] text-white/75 [text-shadow:0_1px_3px_rgba(0,0,0,.9)]">Este enlace deja de funcionar en {quedaLegible(v.venceAt)}.</p>}
        </main>
    );
}
