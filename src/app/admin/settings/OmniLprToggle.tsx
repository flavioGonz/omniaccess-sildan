"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { sileo as toast } from "sileo";
import { ScanLine, Loader2, ArrowRight, Cpu, Video, Route } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Interruptor del reconocimiento por contenedor (Omni-LPR). Es una función
 * opcional del modo LPR: las cámaras de entrada y salida siguen funcionando
 * igual si está apagada.
 */
export default function OmniLprToggle() {
    const [activo, setActivo] = useState<boolean | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [estado, setEstado] = useState<any>(null);

    const cargar = async () => {
        try {
            const r = await axios.get("/api/tracking/enabled");
            setActivo(!!r.data.activo);
            setEstado(r.data.estado || null);
        } catch { setActivo(false); }
    };

    useEffect(() => { cargar(); }, []);

    const alternar = async () => {
        if (activo === null) return;
        setGuardando(true);
        try {
            const r = await axios.put("/api/tracking/enabled", { activo: !activo });
            setActivo(!!r.data.activo);
            toast.success({
                title: r.data.activo ? "Reconocimiento por contenedor activado" : "Reconocimiento por contenedor apagado",
                description: r.data.activo
                    ? "La pasarela empieza a leer las cámaras interiores."
                    : "Las cámaras de entrada y salida siguen funcionando igual.",
            });
            setTimeout(cargar, 1500);
        } catch (e: any) {
            toast.error({ title: e?.response?.data?.error || "No se pudo cambiar" });
        } finally { setGuardando(false); }
    };

    const on = activo === true;

    return (
        <div className={cn("rounded-2xl border p-5 space-y-4 transition-colors",
            on ? "border-teal-500/30 bg-teal-500/[0.05]" : "border-border bg-card")}>
            <div className="flex items-start gap-3">
                <div className={cn("p-2 rounded-xl border", on ? "bg-teal-500/10 border-teal-500/25" : "bg-muted border-border")}>
                    <ScanLine className={on ? "text-teal-500" : "text-muted-foreground"} size={18} />
                </div>
                <div className="flex-1">
                    <h3 className="font-semibold text-foreground">Reconocimiento por contenedor (Omni-LPR)</h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        Función <b className="text-foreground">opcional</b>. Sin ella, OmniAccess lee matrículas solo con
                        las cámaras LPR de entrada y salida, que traen el lector de fábrica. Activándola, cualquier
                        cámara común de adentro del barrio también sirve como lector: un servicio propio toma cuadros
                        de su RTSP y les lee la matrícula, y con eso se dibuja el recorrido de un vehículo por el barrio.
                    </p>
                </div>
                <button onClick={alternar} disabled={guardando || activo === null}
                    className={cn("relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50",
                        on ? "bg-emerald-500" : "bg-muted")}>
                    <span className={cn("absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-all",
                        on ? "left-[22px]" : "left-0.5", guardando && "animate-pulse")} />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                    { ic: Video, t: "Qué hace falta", d: "Cámaras comunes con RTSP, dadas de alta como Cámara Interior en Dispositivos LPR." },
                    { ic: Cpu, t: "Qué consume", d: "Un contenedor propio que usa la GPU del servidor. Solo procesa cuando la escena cambia." },
                    { ic: Route, t: "Qué te da", d: "El recorrido de una matrícula dentro del barrio, con hora, cámara y foto de cada paso." },
                ].map(({ ic: Ic, t, d }) => (
                    <div key={t} className="rounded-xl border border-border bg-background/40 p-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-foreground"><Ic size={13} className="text-muted-foreground" /> {t}</div>
                        <p className="text-[11.5px] text-muted-foreground mt-1 leading-relaxed">{d}</p>
                    </div>
                ))}
            </div>

            <p className="text-xs text-muted-foreground">
                No cambia nada del control de acceso: la barrera abre por las cámaras LPR de siempre. Si el contenedor
                se cae, el acceso sigue funcionando.
            </p>

            {on && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 p-3">
                    <div className="text-xs text-muted-foreground">
                        {estado === null ? (
                            <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> consultando el servicio…</span>
                        ) : (
                            <>
                                Lector <b className={estado.lpr ? "text-emerald-500" : "text-red-500"}>{estado.lpr ? "en línea" : "sin responder"}</b>
                                {" · "}{estado.camaras} cámara(s) interior(es){" · "}{estado.lecturas24} lecturas en 24 h
                            </>
                        )}
                    </div>
                    <a href="/admin/settings?sec=tracking" className="shrink-0 text-xs font-semibold text-foreground hover:underline flex items-center gap-1">
                        Panel de Omni-LPR <ArrowRight size={12} />
                    </a>
                </div>
            )}
        </div>
    );
}
