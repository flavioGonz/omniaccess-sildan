"use client";

/**
 * Ajustes › Video del evento › Al abrir la ficha: cuántos segundos antes y después trae el video
 * que arranca solo, en loop sobre la foto, cuando se abre la ficha de una detección (Monitor de
 * Intrusión, Gestión de alarmas, la ficha que sale de un aviso). 20/10, Nico: «poder indicarle
 * cuánto tiempo antes y después para ese video que se auto carga al abrir la ficha». Antes eran
 * 4 s antes y 1 s después escritos en el código (lib/clip-evento).
 *
 * Es aparte de la ventana del playback: ésta se pide sola cada vez que se abre una ficha, y el
 * grabador entrega a tiempo real, así que cada segundo de acá es espera antes de ver el video.
 */
import { useEffect, useState } from "react";
import { Repeat, Loader2, Save } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSetting, updateSetting } from "@/app/actions/settings";
import {
    AJUSTE_FICHA_ANTES, AJUSTE_FICHA_DESPUES, FICHA_ANTES_POR_DEFECTO, FICHA_DESPUES_POR_DEFECTO,
    ALERTA_ANTES_MAX, ALERTA_DESPUES_MAX,
} from "@/lib/clips";

export default function VentanaFicha() {
    const [antes, setAntes] = useState(String(FICHA_ANTES_POR_DEFECTO));
    const [despues, setDespues] = useState(String(FICHA_DESPUES_POR_DEFECTO));
    const [guardado, setGuardado] = useState({ antes: FICHA_ANTES_POR_DEFECTO, despues: FICHA_DESPUES_POR_DEFECTO });
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cargar = async () => {
        setCargando(true); setError(null);
        try {
            const [a, d] = await Promise.all([getSetting(AJUSTE_FICHA_ANTES), getSetting(AJUSTE_FICHA_DESPUES)]);
            const va = parseInt(a?.value || "", 10); const vd = parseInt(d?.value || "", 10);
            const ga = Number.isFinite(va) ? va : FICHA_ANTES_POR_DEFECTO;
            const gd = Number.isFinite(vd) ? vd : FICHA_DESPUES_POR_DEFECTO;
            setAntes(String(ga)); setDespues(String(gd)); setGuardado({ antes: ga, despues: gd });
        } catch (e: any) { setError(e?.message || "No se pudo leer la configuración"); }
        finally { setCargando(false); }
    };
    useEffect(() => { cargar(); }, []);

    const nA = parseInt(antes, 10), nD = parseInt(despues, 10);
    const aOk = Number.isFinite(nA) && nA >= 0 && nA <= ALERTA_ANTES_MAX;
    const dOk = Number.isFinite(nD) && nD >= 1 && nD <= ALERTA_DESPUES_MAX;
    const cambio = aOk && dOk && (nA !== guardado.antes || nD !== guardado.despues);
    const largo = aOk && dOk ? nA + nD : guardado.antes + guardado.despues;

    const guardar = async () => {
        if (!aOk || !dOk) return;
        setGuardando(true);
        try {
            await updateSetting(AJUSTE_FICHA_ANTES, String(nA));
            await updateSetting(AJUSTE_FICHA_DESPUES, String(nD));
            setGuardado({ antes: nA, despues: nD });
            toast.success({ title: "Video de la ficha guardado", description: `${nA} s antes y ${nD} s después. Las fichas abiertas lo toman al recargar la página.` });
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    return (
        <div className="rounded-[10px] border border-border bg-card p-5 space-y-5">
            <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[6px] bg-muted text-muted-foreground shrink-0"><Repeat size={17} /></span>
                <div>
                    <div className="text-[15px] font-bold text-foreground">Al abrir la ficha</div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">El video que arranca solo, en loop sobre la foto, cuando se abre la ficha de una detección (Monitor de Intrusión, Gestión de alarmas, la ficha que sale de un aviso). El «antes» muestra cómo llegó; el «después», qué hizo.</p>
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
                        Un video de <span className="font-semibold text-foreground tabular-nums">{largo} s</span> en loop. El grabador lo entrega a tiempo real: tarda algo más que eso en aparecer, y mientras tanto se ve la foto. Si el evento es de hace segundos, espera a que pase el «después». Se puede apagar en cada ficha con la tecla C.
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
