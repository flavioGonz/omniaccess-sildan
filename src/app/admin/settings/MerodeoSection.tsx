"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "react-tooltip";
import { Footprints, Save, Loader2, HelpCircle, Repeat, Timer, Layers, BellOff, Home, FlaskConical, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/avisos";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getAjustesMerodeo, guardarAjustesMerodeo, simularMerodeo, type AjustesMerodeo } from "@/app/actions/merodeo";

/**
 * Ajustes › Merodeo. Cuántas pasadas, en cuánto tiempo, y cómo se cuentan. Antes contaba
 * lecturas sueltas: una visita normal (la cámara lee dos veces la entrada y después la salida)
 * ya eran 3 y saltaba como merodeo. Ahora cuenta pasadas y deja simular contra lo real.
 */
const TT = "tt-merodeo";

type Campo = { k: keyof AjustesMerodeo; titulo: string; unidad: string; icon: any; min: number; max: number; ayuda: string };
const CAMPOS: Campo[] = [
    { k: "pasadas", titulo: "Pasadas", unidad: "veces", icon: Repeat, min: 2, max: 50,
        ayuda: "Cuántas pasadas dentro de la ventana hacen falta para marcar merodeo.\nEjemplo: 4 → entra, sale, entra y vuelve a salir en media hora." },
    { k: "ventanaMin", titulo: "Ventana", unidad: "min", icon: Timer, min: 5, max: 720,
        ayuda: "El tiempo en el que se cuentan las pasadas.\nEjemplo: 30 min. Con 4 pasadas en 30 min, una visita de una hora que entra y sale no salta." },
    { k: "agruparSeg", titulo: "Agrupar lecturas", unidad: "seg", icon: Layers, min: 0, max: 900,
        ayuda: "Lecturas a menos de estos segundos de la anterior cuentan como UNA pasada: la cámara que lee dos veces el mismo auto, o la cámara de entrada y la de matrículas del mismo portón.\nEjemplo: 120 s. 0 = cada lectura cuenta." },
    { k: "silencioMin", titulo: "Silencio", unidad: "min", icon: BellOff, min: 0, max: 1440,
        ayuda: "Después de marcar una matrícula, no se vuelve a marcar la misma durante este tiempo.\nEjemplo: 30 min." },
];

export default function MerodeoSection() {
    const [aj, setAj] = useState<AjustesMerodeo | null>(null);
    const [original, setOriginal] = useState("");
    const [guardando, setGuardando] = useState(false);
    const [sim, setSim] = useState<any>(null);
    const [simulando, setSimulando] = useState(false);
    const t = useRef<any>(null);

    useEffect(() => { getAjustesMerodeo().then((a) => { setAj(a); setOriginal(JSON.stringify(a)); }).catch((e) => toast.error(e?.message || "No se pudo leer")); }, []);
    useEffect(() => {
        if (!aj) return;
        clearTimeout(t.current);
        t.current = setTimeout(() => { setSimulando(true); simularMerodeo(aj, 24).then(setSim).catch(() => setSim(null)).finally(() => setSimulando(false)); }, 450);
    }, [aj]);

    if (!aj) return <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>;
    const sucio = JSON.stringify(aj) !== original;
    const set = (p: Partial<AjustesMerodeo>) => setAj({ ...aj, ...p });

    async function guardar() {
        if (!aj) return;
        setGuardando(true);
        try {
            const r = await guardarAjustesMerodeo(aj);
            if (!r.ok) { toast.error("No se pudo guardar", { description: r.error }); return; }
            setAj(r.ajustes); setOriginal(JSON.stringify(r.ajustes));
            toast.success("Merodeo guardado", { description: `${r.ajustes.pasadas} pasadas en ${r.ajustes.ventanaMin} min. Se aplica en menos de un minuto.` });
        } finally { setGuardando(false); }
    }

    return (
        <div className="max-w-5xl space-y-5">
            <Tooltip id={TT} place="top" className="!max-w-[320px] !text-[12px] !rounded-lg !z-[9999] !whitespace-pre-line" />
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg grid place-items-center bg-amber-500/10 text-amber-500 shrink-0"><Footprints size={18} /></div>
                    <div>
                        <h2 className="text-[17px] font-bold">Merodeo</h2>
                        <p className="text-[12.5px] text-muted-foreground max-w-2xl">Cuándo una matrícula que pasa varias veces en poco tiempo se marca como merodeo: queda en la bitácora, aparece en el monitor y, si está encendido, llega a Telegram.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {sucio && <button onClick={() => setAj(JSON.parse(original))} className="h-9 px-3 rounded-lg border border-border text-[13px] font-semibold hover:bg-muted/60">Descartar</button>}
                    <Button onClick={guardar} disabled={guardando || !sucio}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar</Button>
                </div>
            </div>

            <section className="rounded-[10px] border border-border bg-card p-4 flex items-center gap-3">
                <div className="flex-1">
                    <div className="font-semibold text-[14px]">Detectar merodeo</div>
                    <div className="text-[12px] text-muted-foreground">
                        {aj.activo ? <>Se marca cuando una matrícula pasa <b className="text-foreground">{aj.pasadas} veces</b> en <b className="text-foreground">{aj.ventanaMin} min</b>, contando como una sola pasada las lecturas a menos de {aj.agruparSeg} s.</> : "Apagado: no se marca ninguna matrícula."}
                    </div>
                </div>
                <Switch checked={aj.activo} onCheckedChange={(v) => set({ activo: v })} />
            </section>

            <section className={cn("grid grid-cols-2 md:grid-cols-4 gap-3", !aj.activo && "opacity-50 pointer-events-none")}>
                {CAMPOS.map((c) => {
                    const Ic = c.icon;
                    return (
                        <div key={c.k} className="rounded-[10px] border border-border bg-card p-3.5">
                            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                                <Ic size={13} /> {c.titulo}
                                <span data-tooltip-id={TT} data-tooltip-content={c.ayuda} className="ml-auto cursor-help hover:text-foreground"><HelpCircle size={13} /></span>
                            </div>
                            <div className="mt-2 flex items-baseline gap-1.5">
                                <input type="number" min={c.min} max={c.max} value={aj[c.k] as number} onChange={(e) => set({ [c.k]: Number(e.target.value) } as any)}
                                    className="w-full h-10 rounded-lg border border-border bg-background px-2.5 text-[20px] font-bold tabular-nums" />
                                <span className="text-[12px] text-muted-foreground">{c.unidad}</span>
                            </div>
                        </div>
                    );
                })}
            </section>

            <section className={cn("rounded-[10px] border border-border bg-card p-4 flex items-center gap-3", !aj.activo && "opacity-50 pointer-events-none")}>
                <Home size={16} className="text-muted-foreground shrink-0" />
                <div className="flex-1">
                    <div className="font-semibold text-[13px] flex items-center gap-1.5">Incluir residentes
                        <span data-tooltip-id={TT} data-tooltip-content={"Apagado: las matrículas de residentes (registradas a una persona con lote) nunca disparan merodeo. Ejemplo: un residente que entra y sale 5 veces para llevar a los chicos.\nEncendido: también se vigila a los residentes, con las mismas pasadas y ventana."} className="cursor-help text-muted-foreground hover:text-foreground"><HelpCircle size={13} /></span>
                    </div>
                    <div className="text-[12px] text-muted-foreground">{aj.excluirResidentes ? "Apagado: los vehículos de residentes no se marcan como merodeo." : "Encendido: los vehículos de residentes también se marcan como merodeo."}</div>
                </div>
                <Switch checked={!aj.excluirResidentes} onCheckedChange={(v) => set({ excluirResidentes: !v })} />
            </section>

            <section className="rounded-[10px] border border-border bg-card overflow-hidden">
                <div className="p-4 flex items-center gap-3 border-b border-border">
                    <FlaskConical size={16} className="text-muted-foreground" />
                    <div className="flex-1">
                        <div className="font-semibold text-[14px]">Simulación con las últimas 24 h</div>
                        <div className="text-[12px] text-muted-foreground">Lo que habría pasado con estos valores sobre las lecturas reales del barrio. Se recalcula al cambiar un valor.</div>
                    </div>
                    {simulando && <Loader2 size={15} className="animate-spin text-muted-foreground" />}
                </div>
                {sim && (
                    <>
                        <div className="grid grid-cols-3 divide-x divide-border">
                            <div className="p-4"><div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Avisos</div><div className="text-[26px] font-bold tabular-nums">{sim.total}</div></div>
                            <div className="p-4"><div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Matrículas</div><div className="text-[26px] font-bold tabular-nums">{sim.matriculas}</div></div>
                            <div className="p-4" data-tooltip-id={TT} data-tooltip-content="Con la cuenta anterior: 3 lecturas sueltas en 30 min, sin agrupar.">
                                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Con la cuenta anterior</div>
                                <div className="text-[26px] font-bold tabular-nums text-muted-foreground flex items-center gap-2">{sim.antes}{sim.antes > sim.total && <span className="text-[12px] font-semibold tono-bien inline-flex items-center gap-1"><TrendingDown size={13} /> {Math.round((1 - sim.total / Math.max(1, sim.antes)) * 100)}% menos</span>}</div>
                            </div>
                        </div>
                        <div className="max-h-[280px] overflow-auto border-t border-border">
                            <table className="w-full text-[12px]">
                                <thead className="sticky top-0 bg-muted/80 backdrop-blur text-muted-foreground"><tr className="text-left"><th className="px-4 py-2 font-semibold">Hora</th><th className="px-4 py-2 font-semibold">Matrícula</th><th className="px-4 py-2 font-semibold">Pasadas</th><th className="px-4 py-2 font-semibold">Lecturas</th></tr></thead>
                                <tbody>
                                    {sim.avisos.map((x: any, i: number) => (
                                        <tr key={i} className="border-t border-border/60">
                                            <td className="px-4 py-1.5 tabular-nums text-muted-foreground">{new Date(x.hora).toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                                            <td className="px-4 py-1.5 font-mono font-semibold">{x.placa}</td>
                                            <td className="px-4 py-1.5 tabular-nums">{x.pasadas}</td>
                                            <td className="px-4 py-1.5 tabular-nums text-muted-foreground">{x.lecturas}</td>
                                        </tr>
                                    ))}
                                    {!sim.avisos.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Con estos valores no habría habido ningún merodeo en las últimas 24 h.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
