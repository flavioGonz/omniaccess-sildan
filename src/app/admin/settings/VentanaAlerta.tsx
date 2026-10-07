"use client";

/**
 * Ajustes › Video del evento › Clip de las alertas: cuántos segundos antes y después del
 * evento lleva el video que sale por WhatsApp/Telegram cuando "Clip animado en alertas"
 * está prendido (Centro de Notificaciones).
 *
 * Es una ventana APARTE de la del playback a propósito: la alerta espera a que exista el
 * tramo posterior y el grabador lo entrega a tiempo real, así que cada segundo de acá es un
 * segundo más que tarda en llegar el aviso. 10 s alcanzan para entender qué pasó en un teléfono.
 */
import { useEffect, useState } from "react";
import { BellRing, Loader2, Save } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSetting, updateSetting } from "@/app/actions/settings";
import {
    AJUSTE_ALERTA_ANTES, AJUSTE_ALERTA_DESPUES, ALERTA_ANTES_POR_DEFECTO, ALERTA_DESPUES_POR_DEFECTO,
    ALERTA_ANTES_MAX, ALERTA_DESPUES_MAX, MARGEN_GRABACION_SEG,
} from "@/lib/clips";

export default function VentanaAlerta() {
    const [antes, setAntes] = useState(String(ALERTA_ANTES_POR_DEFECTO));
    const [despues, setDespues] = useState(String(ALERTA_DESPUES_POR_DEFECTO));
    const [guardado, setGuardado] = useState({ antes: ALERTA_ANTES_POR_DEFECTO, despues: ALERTA_DESPUES_POR_DEFECTO });
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cargar = async () => {
        setCargando(true); setError(null);
        try {
            const [a, d] = await Promise.all([getSetting(AJUSTE_ALERTA_ANTES), getSetting(AJUSTE_ALERTA_DESPUES)]);
            const va = parseInt(a?.value || "", 10); const vd = parseInt(d?.value || "", 10);
            const ga = Number.isFinite(va) ? va : ALERTA_ANTES_POR_DEFECTO;
            const gd = Number.isFinite(vd) ? vd : ALERTA_DESPUES_POR_DEFECTO;
            setAntes(String(ga)); setDespues(String(gd)); setGuardado({ antes: ga, despues: gd });
        } catch (e: any) { setError(e?.message || "No se pudo leer la configuración"); }
        finally { setCargando(false); }
    };
    useEffect(() => { cargar(); }, []);

    const nA = parseInt(antes, 10), nD = parseInt(despues, 10);
    const aOk = Number.isFinite(nA) && nA >= 0 && nA <= ALERTA_ANTES_MAX;
    const dOk = Number.isFinite(nD) && nD >= 1 && nD <= ALERTA_DESPUES_MAX;
    const cambio = aOk && dOk && (nA !== guardado.antes || nD !== guardado.despues);
    const demora = (dOk ? nD : guardado.despues) + MARGEN_GRABACION_SEG + (aOk && dOk ? nA + nD : guardado.antes + guardado.despues);

    const guardar = async () => {
        if (!aOk || !dOk) return;
        setGuardando(true);
        try {
            await updateSetting(AJUSTE_ALERTA_ANTES, String(nA));
            await updateSetting(AJUSTE_ALERTA_DESPUES, String(nD));
            setGuardado({ antes: nA, despues: nD });
            toast.success({ title: "Clip de alertas guardado", description: `${nA} s antes y ${nD} s después del evento.` });
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    return (
        <div className="rounded-[10px] border border-border bg-card p-5 max-w-xl space-y-5">
            <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[6px] bg-muted text-muted-foreground shrink-0"><BellRing size={17} /></span>
                <div>
                    <div className="text-[15px] font-bold text-foreground">Clip de las alertas</div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">El video que lleva un aviso por WhatsApp o Telegram cuando está prendido «Clip animado en alertas» (Centro de Notificaciones). Es aparte de la ventana de arriba: acá cada segundo es demora del aviso.</p>
                </div>
            </div>
            {cargando ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={16} /> Leyendo la configuración…</div>
            ) : error ? (
                <div className="text-sm"><p className="text-foreground">No se pudo leer la configuración: {error}</p><Button variant="outline" size="sm" className="mt-3" onClick={cargar}>Reintentar</Button></div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Segundos antes</span>
                            <Input type="number" min={0} max={ALERTA_ANTES_MAX} value={antes} onChange={(e) => setAntes(e.target.value)} className="mt-1 tabular-nums" />
                            {!aOk && <span className="block mt-1 text-[11px] text-[var(--mal)]">Entre 0 y {ALERTA_ANTES_MAX}.</span>}
                        </label>
                        <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Segundos después</span>
                            <Input type="number" min={1} max={ALERTA_DESPUES_MAX} value={despues} onChange={(e) => setDespues(e.target.value)} className="mt-1 tabular-nums" />
                            {!dOk && <span className="block mt-1 text-[11px] text-[var(--mal)]">Entre 1 y {ALERTA_DESPUES_MAX}.</span>}
                        </label>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                        Con estos valores el aviso llega unos <span className="font-semibold text-foreground tabular-nums">{demora} s</span> después del evento: espera {aOk && dOk ? nD : guardado.despues} s a que pase el «después», {MARGEN_GRABACION_SEG} s a que el grabador lo tenga, y el grabador entrega el video a tiempo real. Si la cámara no graba o algo falla, el aviso sale con la foto y Despachos dice por qué.
                    </p>
                    <div className="flex items-center gap-3">
                        <Button onClick={guardar} disabled={!cambio || guardando}>
                            {guardando ? <Loader2 className="animate-spin mr-2" size={14} /> : <Save className="mr-2" size={14} />}
                            Guardar
                        </Button>
                        <span className="text-[11px] text-muted-foreground tabular-nums">Hoy: {guardado.antes} s antes · {guardado.despues} s después</span>
                    </div>
                </>
            )}
        </div>
    );
}
