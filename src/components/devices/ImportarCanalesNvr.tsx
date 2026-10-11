"use client";

import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import { Car, Radar, Ban, Loader2, Check, Link2, LogIn, LogOut, Download, Info } from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { canalesParaImportar, importarCanalesClasificados, type CanalParaImportar, type RolImport } from "@/app/actions/nvr";

/**
 * Importar las cámaras de un NVR, clasificando cada una ANTES de crearla: LPR (entrada o salida)
 * o intrusión. Lo que ya está dado de alta con esa IP no se duplica: sólo se le vincula la
 * grabación (NVR y canal). La sugerencia sale del nombre del canal; siempre se puede cambiar.
 */
export function ImportarCanalesNvr({ nvr, groups = [], open, onOpenChange, onListo }: { nvr: { id: string; name: string } | null; groups?: any[]; open: boolean; onOpenChange: (v: boolean) => void; onListo: () => void }) {
    const [canales, setCanales] = useState<CanalParaImportar[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState("");
    const [eleccion, setEleccion] = useState<Record<number, { rol: RolImport; direction: "ENTRY" | "EXIT" }>>({});
    const [grupo, setGrupo] = useState("none");
    const [importando, setImportando] = useState(false);

    useEffect(() => {
        if (!open || !nvr) return;
        setCargando(true); setError(""); setCanales([]);
        canalesParaImportar(nvr.id).then((r) => {
            if (!r.ok) { setError(r.error || "No se pudieron leer los canales"); return; }
            setCanales(r.canales);
            setEleccion(Object.fromEntries(r.canales.map((c) => [c.channel, { rol: c.existente ? "omitir" : c.ip ? c.sugerido.rol : "omitir", direction: c.sugerido.direction }])));
        }).catch((e) => setError(e?.message || "Error")).finally(() => setCargando(false));
    }, [open, nvr]);

    const nuevos = canales.filter((c) => !c.existente && c.ip);
    const resumen = useMemo(() => {
        const v = Object.entries(eleccion).filter(([ch]) => nuevos.some((c) => c.channel === Number(ch)));
        return { lpr: v.filter(([, e]) => e.rol === "lpr").length, intr: v.filter(([, e]) => e.rol === "intrusion").length };
    }, [eleccion, nuevos]);
    const set = (ch: number, cambios: Partial<{ rol: RolImport; direction: "ENTRY" | "EXIT" }>) => setEleccion((p) => ({ ...p, [ch]: { ...p[ch], ...cambios } }));

    const importar = async () => {
        if (!nvr) return;
        setImportando(true);
        try {
            const pedidos = canales.map((c) => ({ channel: c.channel, rol: c.existente ? ("intrusion" as RolImport) : eleccion[c.channel]?.rol || "omitir", direction: eleccion[c.channel]?.direction, groupId: grupo }))
                .filter((p, i) => canales[i].existente || p.rol !== "omitir");
            const r = await importarCanalesClasificados(nvr.id, pedidos);
            if (!r.ok) { toast.error({ title: "No se pudo importar", description: r.error }); return; }
            toast.success({ title: `Importación lista: ${r.creadas} nuevas`, description: `${r.mapeadas} ya existían y quedaron vinculadas a su grabación.` });
            onListo(); onOpenChange(false);
        } finally { setImportando(false); }
    };

    return (
        <Cajon open={open} onOpenChange={(v) => !importando && onOpenChange(v)}>
            <CajonContenido ancho="ancho" titulo={`Importar cámaras de ${nvr?.name || "NVR"}`} descripcion="Elegí qué es cada cámara antes de crearla. Las que ya existen sólo se vinculan a su grabación."
                pie={<div className="flex items-center gap-3 w-full">
                    <span className="text-[12px] text-muted-foreground flex-1">{resumen.lpr} LPR · {resumen.intr} intrusión · {canales.filter((c) => c.existente).length} ya existentes (se vinculan)</span>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importando}>Cancelar</Button>
                    <Button onClick={importar} disabled={importando || cargando || !canales.length} className="gap-1.5">{importando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Importar</Button>
                </div>}>
                {cargando && <div className="py-12 grid place-items-center text-muted-foreground text-sm gap-2"><Loader2 size={22} className="animate-spin" /> Leyendo los canales del NVR…</div>}
                {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{error}</div>}
                {!cargando && canales.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <Info size={13} /> Grupo de acceso para las LPR nuevas:
                            <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="h-8 rounded-md bg-card border border-border px-2 text-xs">
                                <option value="none">Sin grupo</option>
                                {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                        </div>
                        <div className="border border-border rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-card/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                                    <tr><th className="text-left py-2.5 pl-4 w-14">Canal</th><th className="text-left">Cámara</th><th className="text-left">IP</th><th className="text-left">Qué es</th><th className="text-left pr-4">Sentido</th></tr>
                                </thead>
                                <tbody>
                                    {canales.map((c) => {
                                        const e = eleccion[c.channel];
                                        return (
                                            <tr key={c.channel} className="border-t border-border/50">
                                                <td className="py-2 pl-4 font-mono text-xs">{c.channel}</td>
                                                <td>
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <div className="flex items-center gap-2"><span className="font-semibold truncate max-w-[220px]">{c.name}</span>{c.model && <span className="text-[10px] text-muted-foreground">{c.model}</span>}</div>
                                                </td>
                                                <td className="font-mono text-xs">{c.ip || <span className="text-muted-foreground">sin IP</span>}</td>
                                                <td>
                                                    {c.existente ? (
                                                        <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold" data-tooltip-id="tt-imp" data-tooltip-content={`Ya existe como «${c.existente.name}» (${c.existente.tipo}). Sólo se le vincula este canal como su grabación.`}><Link2 size={13} /> Ya existe · se vincula</span>
                                                    ) : !c.ip ? <span className="text-[11px] text-muted-foreground">No se puede importar</span> : (
                                                        <div className="inline-flex rounded-lg bg-muted/50 p-0.5" data-tooltip-id="tt-imp" data-tooltip-content={`Sugerido: ${c.sugerido.rol === "lpr" ? "LPR" : "intrusión"} (${c.sugerido.por}).`}>
                                                            {([["lpr", "LPR", Car], ["intrusion", "Intrusión", Radar], ["omitir", "No", Ban]] as const).map(([v, t, I]) => (
                                                                <button key={v} type="button" onClick={() => set(c.channel, { rol: v })}
                                                                    className={cn("h-7 px-2.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1", e?.rol === v ? (v === "lpr" ? "bg-amber-500 text-black" : v === "intrusion" ? "bg-red-500 text-white" : "bg-neutral-600 text-white") : "text-muted-foreground hover:text-foreground")}>
                                                                    <I size={12} /> {t}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="pr-4">
                                                    {!c.existente && e?.rol === "lpr" && (
                                                        <div className="inline-flex rounded-lg bg-muted/50 p-0.5">
                                                            {([["ENTRY", "Entrada", LogIn], ["EXIT", "Salida", LogOut]] as const).map(([v, t, I]) => (
                                                                <button key={v} type="button" onClick={() => set(c.channel, { direction: v })}
                                                                    className={cn("h-7 px-2.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1", e.direction === v ? (v === "ENTRY" ? "bg-emerald-500 text-white" : "bg-orange-500 text-white") : "text-muted-foreground hover:text-foreground")}>
                                                                    <I size={12} /> {t}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {!c.existente && e?.rol === "intrusion" && <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Check size={12} /> se calibra después</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                <Tooltip id="tt-imp" place="top" className="!max-w-[300px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
