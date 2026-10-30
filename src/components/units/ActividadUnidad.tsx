"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpLeft, Loader2, Ticket, Activity, Car, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bloque } from "@/components/ui/cajon-campos";
import { getActividadUnidad, type ActividadUnidad as Datos, type PresenciaUnidad } from "@/app/actions/unidades-actividad";

/** Pestaña Actividad del cajón de la unidad: quién está adentro, últimos pasos con foto e invitaciones vigentes. */
const hace = (iso: string) => {
    const m = Math.round((Date.now() - +new Date(iso)) / 60000);
    if (m < 1) return "recién"; if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24); return `hace ${d} día${d > 1 ? "s" : ""}`;
};
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ActividadUnidad({ unitId, presencia, tt }: { unitId: string; presencia?: PresenciaUnidad | null; tt: string }) {
    const [d, setD] = useState<Datos | null>(null);
    const [cargando, setCargando] = useState(true);
    useEffect(() => { setCargando(true); getActividadUnidad(unitId).then(setD).catch(() => setD(null)).finally(() => setCargando(false)); }, [unitId]);

    const Placa = ({ p, dentro }: { p: string; dentro?: boolean }) => (
        <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-mono font-black tracking-[0.1em] text-[13px] border", dentro ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "bg-muted border-border text-muted-foreground")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", dentro ? "bg-emerald-500" : "bg-muted-foreground/50")} />{p}
        </span>
    );

    return (<>
        <Bloque titulo="Presencia" icono={Car} tt={tt} ayuda={"Según la última lectura de cada matrícula: si fue en una cámara de entrada, el vehículo está adentro.\nUna matrícula que nunca pasó por las cámaras figura sin lectura."}>
            {!presencia || (presencia.adentro.length + presencia.afuera.length + presencia.sinLectura.length) === 0
                ? <p className="p-5 text-center text-[12.5px] text-muted-foreground rounded-xl border border-dashed border-border">La unidad no tiene matrículas cargadas.</p>
                : (
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            {([["Adentro", presencia.adentro.length, "tono-bien"], ["Afuera", presencia.afuera.length, ""], ["Sin lectura", presencia.sinLectura.length, "text-muted-foreground"]] as const).map(([t, n, c]) => (
                                <div key={t} className="rounded-xl border border-border px-3 py-2"><div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-bold">{t}</div><div className={cn("text-[22px] font-black tabular-nums", c)}>{n}</div></div>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {presencia.adentro.map((p) => <Placa key={p} p={p} dentro />)}
                            {presencia.afuera.map((p) => <Placa key={p} p={p} />)}
                            {presencia.sinLectura.map((p) => <span key={p} className="px-2 py-1 rounded-md font-mono text-[12px] border border-dashed border-border text-muted-foreground/70" data-tooltip-id={tt} data-tooltip-content="Nunca pasó por una cámara LPR">{p}</span>)}
                        </div>
                        {presencia.ultimo && <p className="text-[12px] text-muted-foreground">Último movimiento: <b className="text-foreground font-mono">{presencia.ultimo.plate}</b> {presencia.ultimo.dir === "ENTRY" ? "entró" : "salió"} {hace(presencia.ultimo.ts)}{presencia.ultimo.camara ? ` por ${presencia.ultimo.camara}` : ""}.</p>}
                    </div>
                )}
        </Bloque>

        <Bloque titulo="Últimos pasos" icono={Activity} tt={tt} ayuda="Lecturas de las matrículas de la unidad en las cámaras LPR, con la foto de la captura.">
            {cargando ? <div className="p-6 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" size={18} /></div>
                : !d || d.movimientos.length === 0 ? <p className="p-5 text-center text-[12.5px] text-muted-foreground rounded-xl border border-dashed border-border">Sin pasos registrados.</p>
                    : (<div className="space-y-2">
                        <div className="flex gap-2 text-[12px]">
                            <span className="px-2 py-1 rounded-md border border-border"><b className="tabular-nums">{d.pasosHoy}</b> hoy</span>
                            <span className="px-2 py-1 rounded-md border border-border"><b className="tabular-nums">{d.pasos7d}</b> en 7 días</span>
                        </div>
                        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                            {d.movimientos.map((m) => {
                                const entra = m.dir === "ENTRY";
                                return (
                                    <div key={m.id} className="flex items-center gap-3 p-2 hover:bg-muted/40">
                                        <div className="w-20 h-12 rounded-md bg-muted overflow-hidden shrink-0">
                                            {m.foto && <img src={`${m.foto}?w=160`} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                                        </div>
                                        <span className={cn("h-7 w-7 rounded-lg grid place-items-center shrink-0", entra ? "bg-emerald-500/10 text-emerald-500" : "bg-sky-500/10 text-sky-500")}>{entra ? <ArrowDownRight size={15} /> : <ArrowUpLeft size={15} />}</span>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[13px] font-semibold"><span className="font-mono">{m.plate}</span> <span className="text-muted-foreground font-normal">· {entra ? "Entrada" : "Salida"}</span></div>
                                            <div className="text-[11px] text-muted-foreground truncate">{m.camara || "Cámara"} · {fechaHora(m.ts)}</div>
                                        </div>
                                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded border", m.decision === "GRANT" ? "chip-bien" : "chip-mal")}>{m.decision === "GRANT" ? "Autorizado" : "Denegado"}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>)}
        </Bloque>

        <Bloque titulo="Invitaciones vigentes" icono={Ticket} tt={tt} ayuda="Invitaciones activas de la unidad (por WhatsApp, portal o guardia). Las matrículas de los invitados pasan mientras la invitación esté vigente.">
            {cargando ? null : !d || d.invitaciones.length === 0
                ? <p className="p-5 text-center text-[12.5px] text-muted-foreground rounded-xl border border-dashed border-border">Sin invitaciones vigentes.</p>
                : (<div className="space-y-2">
                    {d.invitaciones.map((i) => (
                        <div key={i.id} className="rounded-xl border border-border p-3">
                            <div className="flex items-center gap-2">
                                <CalendarClock size={14} className="text-violet-500 shrink-0" />
                                <span className="text-[13px] font-semibold truncate">{i.titulo}</span>
                                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border chip-info">{i.via === "WHATSAPP" ? "WhatsApp" : i.via === "PORTAL" ? "Portal" : "Guardia"}</span>
                            </div>
                            <div className="text-[11.5px] text-muted-foreground mt-1">{fechaHora(i.desde)} a {fechaHora(i.hasta)}{i.anfitrion ? ` · invita ${i.anfitrion}` : ""}</div>
                            {i.invitados.length > 0 && <div className="text-[12px] mt-1">{i.invitados.slice(0, 4).join(", ")}{i.invitados.length > 4 ? ` y ${i.invitados.length - 4} más` : ""}</div>}
                        </div>
                    ))}
                </div>)}
        </Bloque>
    </>);
}
