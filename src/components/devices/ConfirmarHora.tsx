"use client";

import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import { Clock, TimerReset, Loader2, Check, X, Info, AlertTriangle, Server, Car, Radar } from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Antes de tocar la hora de los equipos, preguntar: cuáles, qué hora tienen ahora y cuánto
 * se corrigen. Recién con «Aplicar» se escribe. Después se muestra el resultado equipo por
 * equipo (el que falló, con el motivo).
 */
type Equipo = { id: string; name: string; ip: string; brand: string; deviceType: string };
type Res = { id: string; ok: boolean; error?: string; localTime?: string };

const ICONO: Record<string, any> = { NVR: Server, LPR_CAMERA: Car, CAMERA: Radar };
const desfase = (s?: number | null) => (typeof s === "number" ? `${s > 0 ? "+" : ""}${s} s` : "—");

export function ConfirmarHora({ equipos, health, open, onOpenChange, onListo }: {
    equipos: Equipo[]; health: Record<string, any>; open: boolean; onOpenChange: (v: boolean) => void; onListo: () => void;
}) {
    const [elegidos, setElegidos] = useState<Set<string>>(new Set());
    const [aplicando, setAplicando] = useState(false);
    const [res, setRes] = useState<Record<string, Res> | null>(null);

    useEffect(() => {
        if (!open) return;
        setRes(null); setAplicando(false);
        // Por defecto: todos los que responden. Los que no responden quedan sin marcar (fallarían).
        setElegidos(new Set(equipos.filter((e) => health[e.id]?.reachable !== false).map((e) => e.id)));
    }, [open, equipos, health]);

    const corridos = useMemo(() => equipos.filter((e) => Math.abs(health[e.id]?.driftSec ?? 0) > 90).length, [equipos, health]);
    const ahora = new Date().toLocaleString("es-UY", { timeZone: "America/Montevideo", hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit" });
    const alternar = (id: string) => setElegidos((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

    const aplicar = async () => {
        if (!elegidos.size) return;
        setAplicando(true);
        try {
            const r = await fetch("/api/devices/sync-time", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...elegidos], mode: "now" }) });
            const j = await r.json();
            const m: Record<string, Res> = {};
            for (const x of j.results || []) m[x.id] = x;
            setRes(m);
            const ok = (j.results || []).filter((x: Res) => x.ok).length;
            if (ok === elegidos.size) toast.success({ title: `Hora puesta en ${ok} equipo${ok !== 1 ? "s" : ""}`, description: "Hora del servidor (Montevideo)" });
            else toast.error({ title: `Hora puesta en ${ok} de ${elegidos.size}`, description: "Los que fallaron quedan marcados con el motivo." });
            onListo();
        } catch (e: any) { toast.error({ title: "No se pudo sincronizar", description: e?.message }); }
        finally { setAplicando(false); }
    };

    return (
        <Cajon open={open} onOpenChange={(v) => !aplicando && onOpenChange(v)}>
            <CajonContenido ancho="medio" titulo="Sincronizar la hora" descripcion="Se pone la hora del servidor en los equipos elegidos. No se aplica nada hasta que confirmes."
                pie={<div className="flex items-center gap-2 w-full">
                    <span className="flex-1 text-[12px] text-muted-foreground">{res ? "Listo. Podés cerrar." : `${elegidos.size} de ${equipos.length} elegidos`}</span>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={aplicando}>{res ? "Cerrar" : "Cancelar"}</Button>
                    {!res && <Button onClick={aplicar} disabled={aplicando || !elegidos.size} className="gap-1.5">{aplicando ? <Loader2 size={15} className="animate-spin" /> : <TimerReset size={15} />} Aplicar en {elegidos.size}</Button>}
                </div>}>
                <div className="px-6 py-5 space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-border bg-card/50 px-3 py-2.5">
                            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Hora del servidor</div>
                            <div className="text-[15px] font-bold font-mono tabular-nums">{ahora}</div>
                        </div>
                        <div className="rounded-xl border border-border bg-card/50 px-3 py-2.5" data-tooltip-id="tt-hora" data-tooltip-content="Equipos con más de 90 segundos de diferencia con el servidor.">
                            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Corridos</div>
                            <div className={cn("text-[15px] font-bold tabular-nums", corridos ? "text-amber-500" : "text-emerald-500")}>{corridos}</div>
                        </div>
                        <div className="rounded-xl border border-border bg-card/50 px-3 py-2.5">
                            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Equipos</div>
                            <div className="text-[15px] font-bold tabular-nums">{equipos.length}</div>
                        </div>
                    </div>
                    <p className="text-[12px] text-muted-foreground flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" /> Hikvision por ISAPI (modo manual) y Dahua por CGI. Funciona sin internet. Si un NVR está en NTP, queda en manual con la hora del servidor.</p>
                    <div className="border border-border rounded-xl overflow-hidden">
                        <div className="grid grid-cols-[28px_1fr_110px_90px_120px] gap-2 px-3 py-2 bg-card/60 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                            <input type="checkbox" checked={elegidos.size === equipos.length && equipos.length > 0} onChange={(e) => setElegidos(new Set(e.target.checked ? equipos.map((x) => x.id) : []))} className="accent-[var(--accion)]" aria-label="Todos" />
                            <span>Equipo</span><span>Hora del equipo</span><span>Desfase</span><span>Resultado</span>
                        </div>
                        <div className="max-h-[52vh] overflow-y-auto">
                            {equipos.map((e) => {
                                const h = health[e.id]; const I = ICONO[e.deviceType] || Clock; const r = res?.[e.id];
                                const corrido = Math.abs(h?.driftSec ?? 0) > 90;
                                return (
                                    <label key={e.id} className="grid grid-cols-[28px_1fr_110px_90px_120px] gap-2 items-center px-3 py-2 border-t border-border/50 text-[12.5px] cursor-pointer hover:bg-accent/40">
                                        <input type="checkbox" checked={elegidos.has(e.id)} onChange={() => alternar(e.id)} disabled={!!res || aplicando} className="accent-[var(--accion)]" />
                                        <span className="min-w-0 flex items-center gap-2">
                                            <I size={14} className="text-muted-foreground shrink-0" />
                                            <span className="min-w-0"><span className={cn("block font-semibold truncate", h?.reachable === false && "text-red-500")}>{e.name}</span><span className="block text-[10.5px] font-mono text-muted-foreground">{e.ip} · {e.brand === "DAHUA" ? "Dahua" : "Hikvision"}</span></span>
                                        </span>
                                        <span className="font-mono text-[11.5px] text-muted-foreground">{h?.localTime ? (String(h.localTime).match(/(\d{2}:\d{2}:\d{2})/)?.[1] || "—") : h?.reachable === false ? "sin respuesta" : "—"}</span>
                                        <span className={cn("font-mono text-[11.5px] tabular-nums", corrido ? "text-amber-500 font-bold" : "text-muted-foreground")}>{desfase(h?.driftSec)}</span>
                                        <span className="text-[11px]">
                                            {r ? (r.ok ? <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold"><Check size={13} /> Aplicada</span>
                                                : <span className="inline-flex items-center gap-1 text-red-500 font-semibold" data-tooltip-id="tt-hora" data-tooltip-content={r.error || "error"}><X size={13} /> Falló</span>)
                                                : aplicando && elegidos.has(e.id) ? <Loader2 size={13} className="animate-spin text-muted-foreground" />
                                                    : h?.reachable === false ? <span className="inline-flex items-center gap-1 text-muted-foreground"><AlertTriangle size={12} /> no responde</span> : null}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <Tooltip id="tt-hora" place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
