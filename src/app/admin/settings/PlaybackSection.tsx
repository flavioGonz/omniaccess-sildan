"use client";

/**
 * Ajustes › Video del evento: cuántos segundos antes y después del evento se muestran
 * cuando se abre o se descarga el clip de una captura o de una detección.
 *
 * Es UN ajuste para todas las pantallas (ficha del evento, monitor de intrusión, mapa,
 * consola del guardia, descargas). Antes cada una traía su número escrito, distinto.
 * Lo que queda fijo a propósito: las miniaturas en bucle de las grillas y la línea de
 * tiempo del grabador, que tienen otro trabajo (ver lib/ventana-playback.ts).
 */
import { useEffect, useState } from "react";
import { Film, Loader2, Save } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EntregaClips from "./EntregaClips";
import { getSetting, updateSetting } from "@/app/actions/settings";
import {
    AJUSTE_SEG_ANTES, AJUSTE_SEG_DESPUES, ANTES_POR_DEFECTO, DESPUES_POR_DEFECTO,
    ANTES_MAX, DESPUES_MAX, DESPUES_MIN,
} from "@/lib/ventana-playback";

export default function PlaybackSection() {
    const [antes, setAntes] = useState(String(ANTES_POR_DEFECTO));
    const [despues, setDespues] = useState(String(DESPUES_POR_DEFECTO));
    const [guardado, setGuardado] = useState({ antes: ANTES_POR_DEFECTO, despues: DESPUES_POR_DEFECTO });
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cargar = async () => {
        setCargando(true); setError(null);
        try {
            const [a, d] = await Promise.all([getSetting(AJUSTE_SEG_ANTES), getSetting(AJUSTE_SEG_DESPUES)]);
            const va = parseInt(a?.value || "", 10); const vd = parseInt(d?.value || "", 10);
            const ga = Number.isFinite(va) ? va : ANTES_POR_DEFECTO;
            const gd = Number.isFinite(vd) ? vd : DESPUES_POR_DEFECTO;
            setAntes(String(ga)); setDespues(String(gd)); setGuardado({ antes: ga, despues: gd });
        } catch (e: any) {
            setError(e?.message || "No se pudo leer la configuración");
        } finally { setCargando(false); }
    };
    useEffect(() => { cargar(); }, []);

    const nAntes = parseInt(antes, 10);
    const nDespues = parseInt(despues, 10);
    const antesOk = Number.isFinite(nAntes) && nAntes >= 0 && nAntes <= ANTES_MAX;
    const despuesOk = Number.isFinite(nDespues) && nDespues >= DESPUES_MIN && nDespues <= DESPUES_MAX;
    const cambio = antesOk && despuesOk && (nAntes !== guardado.antes || nDespues !== guardado.despues);

    const guardar = async () => {
        if (!antesOk || !despuesOk) return;
        setGuardando(true);
        try {
            // updateSetting lanza si la base no acepta: el catch de abajo lo muestra.
            await updateSetting(AJUSTE_SEG_ANTES, String(nAntes));
            await updateSetting(AJUSTE_SEG_DESPUES, String(nDespues));
            setGuardado({ antes: nAntes, despues: nDespues });
            toast.success({ title: "Ventana guardada", description: `${nAntes} s antes y ${nDespues} s después del evento.` });
        } catch (e: any) {
            toast.error({ title: "No se pudo guardar", description: e?.message });
        } finally { setGuardando(false); }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Video del evento</h2>
                    <p className="text-sm text-muted-foreground mt-1">Cuánto video se muestra alrededor de cada captura o detección al abrir o descargar su clip.</p>
                </div>
                <div className="p-2 rounded-xl border border-border bg-card">
                    <Film className="text-muted-foreground" size={24} />
                </div>
            </div>

            {cargando ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={16} /> Leyendo la configuración…</div>
            ) : error ? (
                <div className="rounded-[10px] border border-border bg-card p-4 text-sm">
                    <p className="text-foreground">No se pudo leer la configuración: {error}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={cargar}>Reintentar</Button>
                </div>
            ) : (
                <div className="rounded-[10px] border border-border bg-card p-5 max-w-xl space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Segundos antes</span>
                            <Input type="number" min={0} max={ANTES_MAX} value={antes} onChange={(e) => setAntes(e.target.value)} className="mt-1 tabular-nums" />
                            <span className="block mt-1 text-[11px] text-muted-foreground">De 0 a {ANTES_MAX}. Lo que pasó justo antes de la lectura o del cruce.</span>
                            {!antesOk && <span className="block mt-1 text-[11px] text-[var(--mal)]">Tiene que ser un número entre 0 y {ANTES_MAX}.</span>}
                        </label>
                        <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Segundos después</span>
                            <Input type="number" min={DESPUES_MIN} max={DESPUES_MAX} value={despues} onChange={(e) => setDespues(e.target.value)} className="mt-1 tabular-nums" />
                            <span className="block mt-1 text-[11px] text-muted-foreground">De {DESPUES_MIN} a {DESPUES_MAX}. Cada segundo de acá es un segundo de espera: el video se convierte en el momento.</span>
                            {!despuesOk && <span className="block mt-1 text-[11px] text-[var(--mal)]">Tiene que ser un número entre {DESPUES_MIN} y {DESPUES_MAX}.</span>}
                        </label>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                        Vale para la ficha del evento, el monitor de intrusión, el mapa, la consola del guardia y las descargas de clips.
                        Las miniaturas en bucle de las grillas y la línea de tiempo del grabador tienen su propia duración y no cambian con esto.
                    </p>
                    <div className="flex items-center gap-3">
                        <Button onClick={guardar} disabled={!cambio || guardando}>
                            {guardando ? <Loader2 className="animate-spin mr-2" size={14} /> : <Save className="mr-2" size={14} />}
                            Guardar
                        </Button>
                        <span className="text-[11px] text-muted-foreground tabular-nums">Hoy: {guardado.antes} s antes · {guardado.despues} s después</span>
                    </div>
                </div>
            )}
            {/* Cómo se entrega el clip: resolución, calidad, formato y nombre. Cierra la parte de video. */}
            <EntregaClips />
        </div>
    );
}
