"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save, Siren } from "lucide-react";
import { toast } from "@/lib/avisos";
import { Button } from "@/components/ui/button";
import { ChipPrioridad } from "@/components/alarmas/MensajesCentrales";
import { CLASES, NIVELES, PRIORIDADES_DEFECTO, type ClaseEvento, type Prioridades } from "@/lib/centrales/prioridades";
import { cn } from "@/lib/utils";

/**
 * Ajustes › Centrales de alarma (22/10, Nico: «clasificar los eventos en grado de importancia,
 * editables del lado del administrador: robo y pánico 1, sabotaje 2, fallos del sistema 4»).
 *
 * Una fila por clase de evento, no por código: «Robo» cubre el robo perimetral, interior, de 24 h…
 * La prioridad se ve en Gestión de alarmas (pestaña Centrales y las alarmas de central). Cambiarla
 * no toca lo ya recibido: se recalcula al mostrar, así que vale también para lo de antes.
 */
export default function PrioridadesCentralesSection() {
    const [guardadas, setGuardadas] = useState<Prioridades | null>(null);
    const [p, setP] = useState<Prioridades>(PRIORIDADES_DEFECTO);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);

    const cargar = () => fetch("/api/centrales/prioridades", { cache: "no-store" })
        .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j.prioridades as Prioridades; })
        .then((x) => { setGuardadas(x); setP(x); setError(null); })
        .catch((e) => setError(e?.message || "No se pudieron leer las prioridades."));
    useEffect(() => { cargar(); }, []);

    const cambiadas = useMemo(() => !!guardadas && CLASES.some((c) => guardadas[c.clase] !== p[c.clase]), [guardadas, p]);
    const deFabrica = CLASES.every((c) => p[c.clase] === c.defecto);

    const guardar = async (restaurar = false) => {
        setGuardando(true);
        try {
            const r = await fetch("/api/centrales/prioridades", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(restaurar ? { restaurar: true } : { prioridades: p }) });
            const j = await r.json().catch(() => null);
            if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
            setGuardadas(j.prioridades); setP(j.prioridades);
            toast.success(restaurar ? "Prioridades de fábrica restauradas" : "Prioridades guardadas");
        } catch (e: any) { toast.error(e?.message || "No se pudieron guardar."); }
        finally { setGuardando(false); }
    };

    return (
        <div className="max-w-3xl space-y-6">
            <div className="flex items-start gap-3">
                <span className="grid place-items-center w-10 h-10 rounded-[10px] bg-muted/60 shrink-0"><Siren size={18} className="text-muted-foreground" /></span>
                <div className="min-w-0">
                    <h2 className="text-lg font-bold tracking-tight">Prioridad de los eventos de las centrales</h2>
                    <p className="text-[12.5px] text-muted-foreground mt-0.5 max-w-prose">
                        Qué tan urgente es cada clase de evento que mandan las centrales de alarma, de 1 (crítica) a 5 (informativa).
                        Se ve en Gestión de alarmas, en la pestaña Centrales y en cada alarma de central. Vale también para lo ya recibido. Sólo un administrador puede cambiarlas.
                    </p>
                </div>
            </div>

            {error ? (
                <div className="rounded-[10px] chip-mal px-3 py-2.5 text-[12.5px] flex items-center gap-3"><span className="flex-1">{error}</span><Button size="sm" variant="outline" onClick={cargar}>Reintentar</Button></div>
            ) : !guardadas ? (
                <div className="py-10 grid place-items-center"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
            ) : (
                <>
                    <div className="rounded-[10px] border border-border divide-y divide-border">
                        {CLASES.map((c) => (
                            <div key={c.clase} className="flex items-center gap-4 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[13.5px] font-semibold flex items-center gap-2">{c.nombre}{p[c.clase] !== c.defecto && <span className="text-[11px] font-normal text-muted-foreground">de fábrica: P{c.defecto}</span>}</div>
                                    <div className="text-[12px] text-muted-foreground truncate">{c.ejemplos}</div>
                                </div>
                                {/* Píldoras: es una elección entre cinco, no una acción. */}
                                <div className="flex items-center rounded-full border border-border p-0.5 shrink-0" role="radiogroup" aria-label={`Prioridad de ${c.nombre}`}>
                                    {NIVELES.map((n) => (
                                        <button key={n.n} type="button" role="radio" aria-checked={p[c.clase] === n.n} title={`P${n.n} · ${n.nombre}`}
                                            onClick={() => setP((x) => ({ ...x, [c.clase as ClaseEvento]: n.n }))}
                                            className={cn("h-7 w-9 rounded-full text-[12px] font-semibold tabular-nums transition-colors",
                                                p[c.clase] === n.n ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                                            {n.n}
                                        </button>
                                    ))}
                                </div>
                                <span className="w-[112px] shrink-0 flex justify-end"><ChipPrioridad n={p[c.clase]} /></span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                        <Button variant="outline" onClick={() => guardar(true)} disabled={guardando || deFabrica} className="gap-1.5"><RotateCcw size={14} /> Volver a las de fábrica</Button>
                        <Button onClick={() => guardar(false)} disabled={guardando || !cambiadas} className="gap-1.5">{guardando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar</Button>
                    </div>
                </>
            )}
        </div>
    );
}
