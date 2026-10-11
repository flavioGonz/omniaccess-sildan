"use client";

import { useEffect } from "react";
import { Users, LogIn, LogOut, ShieldX, Ticket, Camera, ShieldAlert, Activity, Clock } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { metaDe } from "@/components/intrusion/comun";
import { cn } from "@/lib/utils";

/** La pantalla del supervisor: números grandes, cada uno con su hora y de dónde sale. */
const INTERVALO_MS = 30_000;

type Kpi = { valor: number; fuente: string; actualizado: string };
type Datos = {
    kpi: { adentro: Kpi; entradas: Kpi; salidas: Kpi; denegados: Kpi; visitas: Kpi & { pases: number }; camaras: { enLinea: number; total: number; caidas: { id: string; nombre: string; desde: string }[]; fuente: string; actualizado: string }; alarmas: { pendientes: number; confirmadas: number; fuente: string; actualizado: string } };
    pulso: { h: number; n: number }[];
    eventos: { id: string; ts: string; clase: "acceso" | "deteccion"; que: string; donde: string; resultado: string; sentido: string | null }[];
    ahora: string;
};

function Tarjeta({ rotulo, valor, sub, Icono, tono, fuente, actualizado }: { rotulo: string; valor: React.ReactNode; sub?: React.ReactNode; Icono: any; tono?: "bien" | "mal" | "aviso" | "info"; fuente: string; actualizado: string }) {
    return (
        <div className={cn("rounded-2xl border p-5 flex flex-col gap-3 min-h-[170px]", tono === "aviso" ? "border-[color-mix(in_oklab,var(--aviso)_50%,transparent)] bg-[var(--aviso-suave)]" : tono === "mal" ? "border-[color-mix(in_oklab,var(--mal)_50%,transparent)] bg-[var(--mal-suave)]" : "border-border bg-card")} title={fuente}>
            <div className="flex items-center gap-3">
                <span className={cn("grid h-11 w-11 place-items-center rounded-full", tono === "bien" ? "pleno-bien" : tono === "mal" ? "pleno-mal" : tono === "aviso" ? "pleno-aviso" : tono === "info" ? "pleno-info" : "bg-muted text-muted-foreground")}><Icono size={22} /></span>
                <span className="text-[17px] font-semibold">{rotulo}</span>
            </div>
            <div className="text-[56px] font-bold leading-none tabular-nums">{valor}</div>
            <div className="text-[14px] text-muted-foreground leading-snug">{sub}</div>
            <div className="mt-auto text-[11.5px] text-muted-foreground/70 leading-snug"><span className="tabular-nums">{hace(actualizado)}</span> · {fuente}</div>
        </div>
    );
}

export function VistaResumen() {
    const { latir, setTitulo } = useMarco();
    useEffect(() => { setTitulo("Resumen del barrio"); }, [setTitulo]);
    usarReloj();
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/resumen", INTERVALO_MS, latir);
    useTiempoReal("access_event", () => { latir(); setTimeout(recargar, 1000); });
    useTiempoReal("general_detection", () => { latir(); setTimeout(recargar, 1000); });
    const k = datos?.kpi;
    const horaAhora = new Date().getHours();
    const max = Math.max(1, ...(datos?.pulso || []).map((p) => p.n));
    const total = (datos?.pulso || []).reduce((a, b) => a + b.n, 0);
    return (
        <div className="absolute inset-0 p-5 grid grid-rows-[auto_1fr] gap-4">
            {!datos && <div className="absolute inset-0 grid place-items-center text-[20px] text-muted-foreground">{error ? `No se pudo leer: ${error}` : "Cargando…"}</div>}
            {k && (
                <div className="grid grid-cols-4 gap-4">
                    <Tarjeta rotulo="Adentro ahora" valor={k.adentro.valor} Icono={Users} tono="info" fuente={k.adentro.fuente} actualizado={k.adentro.actualizado} sub="vehículos con entrada sin salida hoy" />
                    <Tarjeta rotulo="Entradas · salidas" valor={<span>{k.entradas.valor} <span className="text-muted-foreground/50 text-[36px]">/</span> {k.salidas.valor}</span>} Icono={LogIn} tono="bien" fuente={k.entradas.fuente} actualizado={k.entradas.actualizado} sub="accesos permitidos desde las 00:00" />
                    <Tarjeta rotulo="Denegados" valor={k.denegados.valor} Icono={ShieldX} tono={k.denegados.valor > 0 ? "mal" : undefined} fuente={k.denegados.fuente} actualizado={k.denegados.actualizado} sub="desde las 00:00" />
                    <Tarjeta rotulo="Visitas" valor={k.visitas.valor} Icono={Ticket} fuente={k.visitas.fuente} actualizado={k.visitas.actualizado} sub={`${k.visitas.pases} pase${k.visitas.pases === 1 ? "" : "s"} vigente${k.visitas.pases === 1 ? "" : "s"} ahora`} />
                    <Tarjeta rotulo="Cámaras" valor={<span>{k.camaras.enLinea} <span className="text-[26px] text-muted-foreground">/ {k.camaras.total}</span></span>} Icono={Camera} tono={k.camaras.caidas.length ? "aviso" : "bien"} fuente={k.camaras.fuente} actualizado={k.camaras.actualizado}
                        sub={k.camaras.caidas.length ? <span className="font-semibold">{k.camaras.caidas.length} caída{k.camaras.caidas.length === 1 ? "" : "s"}: {k.camaras.caidas.map((c) => `${c.nombre} (${hace(c.desde)})`).join(", ")}</span> : "todas en línea"} />
                    <Tarjeta rotulo="Alarmas de intrusión" valor={<span>{k.alarmas.pendientes} <span className="text-[26px] text-muted-foreground">pend.</span></span>} Icono={ShieldAlert} tono={k.alarmas.pendientes ? "mal" : k.alarmas.confirmadas ? "aviso" : undefined} fuente={k.alarmas.fuente} actualizado={k.alarmas.actualizado}
                        sub={k.alarmas.confirmadas ? `${k.alarmas.confirmadas} confirmada${k.alarmas.confirmadas === 1 ? "" : "s"} sin resolver` : "sin alarmas sin resolver"} />
                    <div className="col-span-2 rounded-2xl border border-border bg-card p-5 flex flex-col gap-2">
                        <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2 text-[17px] font-semibold"><Activity size={20} className="text-muted-foreground" /> Pulso del día</span><span className="text-[14px] text-muted-foreground tabular-nums">{total} lecturas</span></div>
                        {total === 0 ? <div className="flex-1 grid place-items-center text-[16px] text-muted-foreground">Sin lecturas hoy</div> : (
                            <div className="flex-1 flex items-end gap-1 min-h-[70px]">
                                {(datos?.pulso || []).map((p) => (
                                    <div key={p.h} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${String(p.h).padStart(2, "0")}:00 · ${p.n}`}>
                                        <div className={cn("w-full rounded-t-sm", p.h === horaAhora ? "bg-[var(--accion)]" : p.n ? "bg-[var(--info)]/70" : "bg-muted")} style={{ height: `${Math.max(4, Math.round((p.n / max) * 100))}%` }} />
                                        {p.h % 3 === 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{String(p.h).padStart(2, "0")}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
            {datos && (
                <div className="rounded-2xl border border-border bg-card p-5 min-h-0 flex flex-col">
                    <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3 inline-flex items-center gap-2"><Clock size={14} /> Últimos eventos</div>
                    <div className="flex-1 min-h-0 overflow-hidden divide-y divide-border">
                        {datos.eventos.map((e) => {
                            const m = e.clase === "deteccion" ? metaDe(e.que) : null;
                            const tonoRes = e.resultado === "GRANT" ? "chip-bien" : e.resultado === "DENY" || e.resultado === "REAL" ? "chip-mal" : e.resultado === "PENDIENTE" ? "chip-aviso" : "chip-quieto";
                            const textoRes = ({ GRANT: "Permitido", DENY: "Denegado", REAL: "Real", FALSA: "Falsa", PENDIENTE: "Pendiente" } as Record<string, string>)[e.resultado] || e.resultado;
                            return (
                                <div key={e.id} className="flex items-center gap-4 py-2.5 text-[18px]">
                                    <span className="w-[96px] tabular-nums text-muted-foreground">{horaCorta(e.ts)}</span>
                                    <span className="w-[150px] inline-flex items-center gap-2 text-muted-foreground">{e.clase === "acceso" ? (e.sentido === "EXIT" ? <><LogOut size={18} /> Salida</> : <><LogIn size={18} /> Entrada</>) : m ? <><m.Icon size={18} className={m.cls.split(" ")[0]} /> {m.label}</> : e.que}</span>
                                    <span className="font-bold tabular-nums tracking-[0.08em] min-w-[140px]">{e.clase === "acceso" ? e.que : ""}</span>
                                    <span className="text-muted-foreground truncate flex-1">{e.donde}</span>
                                    <span className={cn("px-2.5 py-0.5 rounded-full border text-[13px] font-bold uppercase", tonoRes)}>{textoRes}</span>
                                </div>
                            );
                        })}
                        {datos.eventos.length === 0 && <div className="text-[16px] text-muted-foreground py-4">Sin eventos todavía</div>}
                    </div>
                </div>
            )}
        </div>
    );
}
