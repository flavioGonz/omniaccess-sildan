"use client";

import { useEffect, useState } from "react";
import { Film, Server, HardDrive, ImageOff, Loader2 } from "lucide-react";
import { getSetting, updateSetting } from "@/app/actions/settings";
import { coberturaClipAlertas, type CoberturaCamara } from "@/app/actions/clips";
import { Chip } from "@/components/ui/estados";
import { toast } from "@/lib/avisos";
import { cn } from "@/lib/utils";
import { AJUSTE_ALERTA_ANTES, AJUSTE_ALERTA_DESPUES, ALERTA_ANTES_POR_DEFECTO, ALERTA_DESPUES_POR_DEFECTO } from "@/lib/clips";

/**
 * «Clip animado en alertas».
 *
 * Antes decía "envía un video corto en vivo de la cámara" y en San Nicolás no mandó ninguno:
 * el clip sólo sabía salir de las cámaras de fila del primer barrio, y cada alerta se iba con la foto
 * mientras este interruptor seguía prendido. Ahora dice qué hace de verdad (un clip del
 * momento, desde la grabación) y, debajo, de dónde saldría el video de cada cámara que
 * alcanzan las reglas activas — incluidas las que no tienen y van con foto.
 */
const ICONO: Record<CoberturaCamara["fuente"], any> = { nvr: Server, anillo: HardDrive, "anillo-apagado": HardDrive, "anillo-sin-arrancar": ImageOff };
const TONO: Record<CoberturaCamara["fuente"], "bien" | "neutro" | "aviso"> = { nvr: "bien", anillo: "bien", "anillo-apagado": "neutro", "anillo-sin-arrancar": "aviso" };

export default function AnimatedAlertToggle() {
    const [on, setOn] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [ventana, setVentana] = useState({ antes: ALERTA_ANTES_POR_DEFECTO, despues: ALERTA_DESPUES_POR_DEFECTO });
    const [cobertura, setCobertura] = useState<{ reglasActivas: number; camaras: CoberturaCamara[] } | null>(null);
    const [errorCob, setErrorCob] = useState<string | null>(null);

    const cargarCobertura = () => { setErrorCob(null); coberturaClipAlertas().then(setCobertura).catch((e) => setErrorCob(String(e?.message || e))); };
    useEffect(() => {
        Promise.all([getSetting("DISPATCH_ANIMATED"), getSetting(AJUSTE_ALERTA_ANTES), getSetting(AJUSTE_ALERTA_DESPUES)])
            .then(([s, a, d]: any[]) => {
                setOn(s?.value === "true");
                const na = parseInt(a?.value || "", 10), nd = parseInt(d?.value || "", 10);
                setVentana({ antes: Number.isFinite(na) ? na : ALERTA_ANTES_POR_DEFECTO, despues: Number.isFinite(nd) ? nd : ALERTA_DESPUES_POR_DEFECTO });
                setLoaded(true);
            }).catch(() => setLoaded(true));
        cargarCobertura();
    }, []);
    const toggle = async () => {
        const next = !on; setOn(next);
        try {
            await updateSetting("DISPATCH_ANIMATED", next ? "true" : "false");
            toast.success(next ? "Clip en alertas activado" : "Clip en alertas desactivado");
            // El worker arranca o detiene la grabación local en su próxima vuelta (30 s): volver a mirar después.
            setTimeout(cargarCobertura, 35_000);
            cargarCobertura();
        } catch { setOn(!next); toast.error("No se pudo guardar"); }
    };

    return (
        <div className="rounded-[10px] border border-border bg-card">
            <div className="px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-[6px] bg-muted text-muted-foreground flex items-center justify-center shrink-0"><Film size={16} /></div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-foreground">Clip animado en alertas</div>
                    <div className="text-[11px] text-muted-foreground leading-snug">
                        Los avisos por WhatsApp y Telegram llevan un clip de <span className="font-semibold text-foreground tabular-nums">{ventana.antes} s antes y {ventana.despues} s después</span> del evento, sacado de la grabación, en lugar de la foto.
                        Llegan unos segundos más tarde. Si la cámara no graba o algo falla, van con la foto y Despachos dice por qué. La duración se cambia en Ajustes → Video del evento.
                    </div>
                </div>
                <button onClick={toggle} disabled={!loaded} role="switch" aria-checked={on}
                    className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0", on ? "bg-[var(--accion)]" : "bg-muted-foreground/30")}>
                    <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform", on && "translate-x-5")} />
                </button>
            </div>
            <div className="border-t border-border px-4 py-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">De dónde sale el video</div>
                {errorCob ? (
                    <div className="text-[12px] text-muted-foreground">No se pudo leer: {errorCob} <button onClick={cargarCobertura} className="tono-accion font-semibold ml-1">Reintentar</button></div>
                ) : !cobertura ? (
                    <div className="text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Revisando cámaras…</div>
                ) : cobertura.camaras.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground">{cobertura.reglasActivas ? "Las reglas activas no alcanzan ninguna cámara." : "No hay reglas activas que avisen por WhatsApp o Telegram: no sale ningún aviso, con o sin clip."}</div>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {cobertura.camaras.map((c) => (
                            <span key={c.id} title={c.detalle}>
                                <Chip tono={TONO[c.fuente]} icono={ICONO[c.fuente]} className="normal-case tracking-normal text-[11px] font-semibold">{c.nombre} · {c.fuente === "nvr" ? c.detalle : c.fuente === "anillo" ? "grabación local" : c.fuente === "anillo-apagado" ? "local (apagado)" : "sin video, va con foto"}</Chip>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
