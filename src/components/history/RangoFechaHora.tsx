"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Clock, X, Check, History as HistoryIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Rango de fecha y hora en un solo control: atajos (última hora, hoy, ayer, 7 días…), un
 * calendario para marcar desde/hasta con dos clics y la hora de inicio y de fin con deslizador.
 * Devuelve los mismos cuatro textos que usaba el historial (yyyy-mm-dd y HH:MM), así el filtro
 * del servidor no cambia: desde = fecha+hora inicio, hasta = fecha+hora fin (rango continuo).
 */
export type Rango = { desde: string; hasta: string; horaDesde: string; horaHasta: string };
export const RANGO_VACIO: Rango = { desde: "", hasta: "", horaDesde: "", horaHasta: "" };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const deIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
const aMin = (h: string) => { if (!h) return 0; const [a, b] = h.split(":").map(Number); return a * 60 + (b || 0); };
const deMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

type Atajo = { id: string; rotulo: string; rango: () => Rango };
const ATAJOS: Atajo[] = [
    { id: "1h", rotulo: "Última hora", rango: () => { const h = new Date(), d = new Date(Date.now() - 3600_000); return { desde: iso(d), horaDesde: hhmm(d), hasta: iso(h), horaHasta: hhmm(h) }; } },
    { id: "6h", rotulo: "Últimas 6 h", rango: () => { const h = new Date(), d = new Date(Date.now() - 6 * 3600_000); return { desde: iso(d), horaDesde: hhmm(d), hasta: iso(h), horaHasta: hhmm(h) }; } },
    { id: "24h", rotulo: "Últimas 24 h", rango: () => { const h = new Date(), d = new Date(Date.now() - 24 * 3600_000); return { desde: iso(d), horaDesde: hhmm(d), hasta: iso(h), horaHasta: hhmm(h) }; } },
    { id: "hoy", rotulo: "Hoy", rango: () => { const h = iso(new Date()); return { desde: h, hasta: h, horaDesde: "", horaHasta: "" }; } },
    { id: "ayer", rotulo: "Ayer", rango: () => { const a = iso(new Date(Date.now() - 86400_000)); return { desde: a, hasta: a, horaDesde: "", horaHasta: "" }; } },
    { id: "noche", rotulo: "Anoche (20 a 06 h)", rango: () => { const a = new Date(Date.now() - 86400_000), h = new Date(); return { desde: iso(a), horaDesde: "20:00", hasta: iso(h), horaHasta: "06:00" }; } },
    { id: "7d", rotulo: "Últimos 7 días", rango: () => ({ desde: iso(new Date(Date.now() - 6 * 86400_000)), hasta: iso(new Date()), horaDesde: "", horaHasta: "" }) },
    { id: "30d", rotulo: "Últimos 30 días", rango: () => ({ desde: iso(new Date(Date.now() - 29 * 86400_000)), hasta: iso(new Date()), horaDesde: "", horaHasta: "" }) },
    { id: "mes", rotulo: "Este mes", rango: () => { const n = new Date(); return { desde: iso(new Date(n.getFullYear(), n.getMonth(), 1)), hasta: iso(n), horaDesde: "", horaHasta: "" }; } },
];

const corto = (s: string) => { const d = deIso(s); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
export function rotuloRango(r: Rango): string {
    if (!r.desde && !r.hasta) return "Cualquier fecha";
    const hoy = iso(new Date()), ayer = iso(new Date(Date.now() - 86400_000));
    const dia = (s: string) => (s === hoy ? "Hoy" : s === ayer ? "Ayer" : corto(s));
    if (r.desde && r.desde === r.hasta && !r.horaDesde && !r.horaHasta) return dia(r.desde);
    const a = r.desde ? `${dia(r.desde)}${r.horaDesde ? ` ${r.horaDesde}` : ""}` : "…";
    const b = r.hasta ? `${r.hasta === r.desde ? "" : dia(r.hasta) + " "}${r.horaHasta || (r.hasta === r.desde ? "23:59" : "")}`.trim() : "ahora";
    return `${a} → ${b}`;
}

export function RangoFechaHora({ valor, alCambiar }: { valor: Rango; alCambiar: (r: Rango) => void }) {
    const [abierto, setAbierto] = useState(false);
    const [borrador, setBorrador] = useState<Rango>(valor);
    const [mes, setMes] = useState(() => { const d = valor.desde ? deIso(valor.desde) : new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
    useEffect(() => { if (abierto) { setBorrador(valor); const d = valor.desde ? deIso(valor.desde) : new Date(); setMes(new Date(d.getFullYear(), d.getMonth(), 1)); } }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

    const activo = !!(valor.desde || valor.hasta);
    const hoy = iso(new Date());
    const celdas = useMemo(() => {
        const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
        const offset = (primero.getDay() + 6) % 7; // lunes primero
        const dias = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
        return Array.from({ length: Math.ceil((offset + dias) / 7) * 7 }, (_, i) => { const n = i - offset + 1; return n >= 1 && n <= dias ? iso(new Date(mes.getFullYear(), mes.getMonth(), n)) : null; });
    }, [mes]);

    const tocarDia = (d: string) => {
        if (d > hoy) return;
        setBorrador((b) => {
            if (!b.desde || (b.desde && b.hasta && b.desde !== b.hasta) ) return { ...b, desde: d, hasta: d };
            if (d < b.desde) return { ...b, desde: d };
            return { ...b, hasta: d };
        });
    };
    const aplicar = (r: Rango) => { alCambiar(r); setAbierto(false); };
    const atajoActivo = ATAJOS.find((a) => { const r = a.rango(); return r.desde === valor.desde && r.hasta === valor.hasta && (a.id.endsWith("h") ? true : r.horaDesde === valor.horaDesde && r.horaHasta === valor.horaHasta); })?.id;

    const minDesde = aMin(borrador.horaDesde || "00:00");
    const minHasta = borrador.horaHasta ? aMin(borrador.horaHasta) : 24 * 60 - 1;

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" className={cn("h-9 inline-flex items-center gap-2 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors max-w-[300px]",
                    activo ? "border-blue-500/60 bg-blue-500/10 text-foreground" : "border-border bg-card hover:bg-accent text-muted-foreground")}>
                    <CalendarRange size={15} className={activo ? "text-blue-500" : ""} />
                    <span className="truncate">{rotuloRango(valor)}</span>
                    {activo && <span role="button" tabIndex={0} aria-label="Quitar fecha" onClick={(e) => { e.stopPropagation(); alCambiar(RANGO_VACIO); }}
                        className="-mr-1 grid h-5 w-5 place-items-center rounded-md hover:bg-foreground/10"><X size={12} /></span>}
                </button>
            </PopoverTrigger>
            <PopoverContent align="center" sideOffset={8} className="w-[640px] max-w-[96vw] p-0 overflow-hidden rounded-2xl">
                <div className="flex">
                    {/* Atajos */}
                    <div className="w-[170px] shrink-0 border-r border-border bg-muted/30 p-2 flex flex-col gap-0.5">
                        <div className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1.5"><HistoryIcon size={12} /> Atajos</div>
                        {ATAJOS.map((a) => (
                            <button key={a.id} type="button" onClick={() => aplicar(a.rango())}
                                className={cn("h-8 px-2.5 rounded-lg text-left text-[12.5px] font-medium transition-colors flex items-center justify-between",
                                    atajoActivo === a.id ? "bg-blue-600 text-white" : "hover:bg-accent text-foreground/85")}>
                                {a.rotulo}{atajoActivo === a.id && <Check size={13} />}
                            </button>
                        ))}
                        <button type="button" onClick={() => aplicar(RANGO_VACIO)} className="mt-auto h-8 px-2.5 rounded-lg text-left text-[12.5px] text-muted-foreground hover:bg-accent">Cualquier fecha</button>
                    </div>

                    {/* Calendario + horas */}
                    <div className="flex-1 p-4 flex flex-col gap-4">
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <button type="button" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-accent"><ChevronLeft size={16} /></button>
                                <span className="text-[13px] font-bold capitalize">{MESES[mes.getMonth()]} {mes.getFullYear()}</span>
                                <button type="button" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} disabled={iso(new Date(mes.getFullYear(), mes.getMonth() + 1, 1)) > hoy}
                                    className="h-8 w-8 grid place-items-center rounded-lg hover:bg-accent disabled:opacity-30"><ChevronRight size={16} /></button>
                            </div>
                            <div className="grid grid-cols-7 gap-y-1 text-center">
                                {DIAS.map((d) => <span key={d} className="text-[10px] font-bold text-muted-foreground pb-1">{d}</span>)}
                                {celdas.map((d, i) => {
                                    if (!d) return <span key={i} />;
                                    const ini = d === borrador.desde, fin = d === borrador.hasta;
                                    const dentro = borrador.desde && borrador.hasta && d > borrador.desde && d < borrador.hasta;
                                    const futuro = d > hoy;
                                    return (
                                        <span key={d} className={cn("relative h-9 grid place-items-center", dentro && "bg-blue-500/12", ini && borrador.hasta > borrador.desde && "bg-gradient-to-r from-transparent from-50% to-blue-500/12 to-50%", fin && borrador.hasta > borrador.desde && "bg-gradient-to-l from-transparent from-50% to-blue-500/12 to-50%")}>
                                            <button type="button" disabled={futuro} onClick={() => tocarDia(d)}
                                                className={cn("relative h-8 w-8 rounded-lg text-[12.5px] tabular-nums transition-colors",
                                                    ini || fin ? "bg-blue-600 text-white font-bold" : dentro ? "text-foreground" : "hover:bg-accent",
                                                    futuro && "opacity-25 cursor-not-allowed", d === hoy && !(ini || fin) && "ring-1 ring-blue-500/60 font-semibold")}>
                                                {Number(d.slice(8))}
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            {([["desde", "Hora de inicio", minDesde, (m: number) => setBorrador((b) => ({ ...b, horaDesde: m === 0 ? "" : deMin(m) }))],
                               ["hasta", "Hora de fin", minHasta, (m: number) => setBorrador((b) => ({ ...b, horaHasta: m >= 24 * 60 - 1 ? "" : deMin(m) }))]] as const).map(([k, rot, v, set]) => (
                                <div key={k} className="rounded-xl border border-border p-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground inline-flex items-center gap-1"><Clock size={11} /> {rot}</span>
                                        <input type="time" value={k === "desde" ? (borrador.horaDesde || "00:00") : (borrador.horaHasta || "23:59")}
                                            onChange={(e) => set(aMin(e.target.value))}
                                            className="h-7 rounded-md border border-border bg-background px-1.5 text-[12.5px] font-semibold tabular-nums outline-none focus:border-blue-500" />
                                    </div>
                                    <input type="range" min={0} max={24 * 60 - 1} step={15} value={v} onChange={(e) => set(Number(e.target.value))}
                                        className="mt-2 w-full accent-blue-600 cursor-pointer" />
                                    <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
                                </div>
                            ))}
                        </div>

                        <div className="flex items-center gap-2 border-t border-border pt-3">
                            <span className="flex-1 text-[12px] text-muted-foreground truncate">{rotuloRango(borrador)}</span>
                            <button type="button" onClick={() => setBorrador(RANGO_VACIO)} className="h-8 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-accent">Limpiar</button>
                            <button type="button" onClick={() => aplicar(borrador)} className="h-8 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"><Check size={14} /> Aplicar</button>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
