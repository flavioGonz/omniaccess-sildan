"use client";

import { useEffect, useState } from "react";
import { Activity, Camera, LogIn, LogOut, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Seccion } from "@/components/visor/FichaVisor";

/**
 * Los hábitos de una chapa, en la ficha del visor: frecuencia, horarios habituales y cámaras
 * habituales (lo que dice /api/lpr/plate-stats de los últimos DIAS días).
 *
 * 19/10, Nico: el monitor LPR abría la ficha vieja (EventDetailsDialog) y el historial la nueva
 * (el visor); «quiero que quede una única ficha, la nueva, pero no quiero perder los controles de
 * la ficha vieja: horarios habituales, frecuencia, historial». El historial ya estaba (Pasos
 * anteriores y Comportamiento); esto trae las otras dos pestañas de «Perfil», compactas y con el
 * criterio del visor: texto blanco sobre el vidrio (en tema claro lo invierte globals.css).
 */
type Estadisticas = {
    ok: boolean; total: number; today: number; perDay: number; perActiveDay: number; activeDays: number; last7: number; denied: number; days: number;
    firstSeen?: string | null; lastSeen?: string | null;
    daily: { date: string; count: number }[];
    topCameras: { deviceId: string | null; name: string; total: number; entry: number; exit: number; pct: number; last: string }[];
    hourly: { all: number[]; entry: number[]; exit: number[] };
    typicalEntry: { from: number; to: number; count: number; share: number } | null;
    typicalExit: { from: number; to: number; count: number; share: number } | null;
};

const DIAS = 30;
const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
/** plate-stats da los porcentajes ya en 0-100. */
const pct = (x: number) => `${Math.round(x)} %`;
const num = (x: number) => x.toLocaleString("es-UY", { maximumFractionDigits: x < 1 ? 2 : 1 });

export function PerfilChapa({ plate }: { plate: string | null | undefined }) {
    const [s, setS] = useState<Estadisticas | null>(null);
    const [cargando, setCargando] = useState(false);
    useEffect(() => {
        if (!plate) { setS(null); return; }
        let vivo = true;
        setCargando(true);
        fetch(`/api/lpr/plate-stats?plate=${encodeURIComponent(plate)}&days=${DIAS}`, { cache: "no-store" })
            .then((r) => r.json()).then((j) => { if (vivo) setS(j?.ok ? j : null); })
            .catch(() => { if (vivo) setS(null); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [plate]);

    if (!plate) return null;
    if (cargando && !s) return (
        <Seccion titulo="Hábitos" icono={Activity}><div className="h-16 rounded-[8px] bg-white/10 animate-pulse" /></Seccion>
    );
    if (!s || !s.total) return null;

    const maxDia = Math.max(1, ...s.daily.map((d) => d.count));
    const maxHora = Math.max(1, ...s.hourly.entry, ...s.hourly.exit);
    const franja = (t: Estadisticas["typicalEntry"]) => (t ? <>{hh(t.from)}–{hh(t.to)} <span className="font-normal text-white/50">· {pct(t.share)}</span></> : <span className="font-normal text-white/30 italic">sin patrón</span>);
    return (
        <Seccion titulo="Hábitos" icono={Activity} extra={<span className="text-[11px] text-white/45">últimos {s.days} días</span>}>
            {/* Frecuencia: el número, hoy y la semana, y la tira de los últimos días. */}
            <div className="flex items-end gap-3">
                <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                        <b className="text-[22px] leading-none tabular-nums text-white">{num(s.perDay)}</b>
                        <span className="text-[12px] text-white/60">pasadas por día</span>
                    </div>
                    <div className="text-[11.5px] text-white/50 mt-1 tabular-nums">
                        {s.total} en {s.days} días · {s.activeDays} {s.activeDays === 1 ? "día" : "días"} con pasadas ({num(s.perActiveDay)} por día)
                    </div>
                </div>
                <div className="ml-auto flex gap-3 text-right tabular-nums shrink-0">
                    <div><div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/45">Hoy</div><b className={cn("text-[16px]", s.today ? "visor-bien" : "text-white/80")}>{s.today}</b></div>
                    <div><div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/45">7 días</div><b className="text-[16px] text-white/90">{s.last7}</b></div>
                </div>
            </div>
            <div className="mt-2 flex items-end gap-[2px] h-7" aria-label={`Pasadas por día, últimos ${s.days} días`}>
                {s.daily.map((d, i) => (
                    <span key={d.date} title={`${d.date}: ${d.count} ${d.count === 1 ? "pasada" : "pasadas"}`}
                        className={cn("flex-1 rounded-[2px]", d.count ? (i === s.daily.length - 1 ? "bg-[var(--accion-en-oscuro)]" : "bg-white/55") : "bg-white/10")}
                        style={{ height: d.count ? `${Math.max(18, (d.count / maxDia) * 100)}%` : 3 }} />
                ))}
            </div>
            <div className="flex justify-between text-[10px] text-white/40 tabular-nums mt-0.5"><span>hace {s.days} d</span>{s.firstSeen && <span>1ª vez {new Date(s.firstSeen).toLocaleDateString("es-UY", { day: "numeric", month: "short" })}</span>}<span>hoy</span></div>

            {/* Horarios habituales: la franja de entrada y la de salida, y las 24 horas. */}
            <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-[8px] bg-white/[0.07] px-2.5 py-1.5">
                    <div className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--accion-en-oscuro)]"><LogIn size={11} /> Entra</div>
                    <div className="text-[13px] font-bold text-white tabular-nums">{franja(s.typicalEntry)}</div>
                </div>
                <div className="rounded-[8px] bg-white/[0.07] px-2.5 py-1.5">
                    <div className="flex items-center gap-1 text-[10.5px] font-semibold visor-aviso"><LogOut size={11} /> Sale</div>
                    <div className="text-[13px] font-bold text-white tabular-nums">{franja(s.typicalExit)}</div>
                </div>
            </div>
            <div className="mt-2 flex items-end gap-[2px] h-8" aria-label="Pasadas por hora del día">
                {Array.from({ length: 24 }, (_, h) => {
                    const e = s.hourly.entry[h] || 0, x = s.hourly.exit[h] || 0;
                    return (
                        <span key={h} className="flex-1 h-full flex flex-col justify-end gap-px" title={`${hh(h)}: ${e} entradas · ${x} salidas`}>
                            {x > 0 && <span className="rounded-[1px] bg-[var(--aviso)] opacity-80" style={{ height: `${(x / maxHora) * 100}%` }} />}
                            {e > 0 && <span className="rounded-[1px] bg-[var(--accion-en-oscuro)]" style={{ height: `${(e / maxHora) * 100}%` }} />}
                            {!e && !x && <span className="h-[2px] rounded-[1px] bg-white/10" />}
                        </span>
                    );
                })}
            </div>
            <div className="flex justify-between text-[10px] text-white/40 tabular-nums mt-0.5"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>

            {/* Cámaras habituales y lo denegado. */}
            {s.topCameras.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                    {s.topCameras.slice(0, 3).map((c) => (
                        <li key={c.name} className="text-[12px]">
                            <div className="flex items-center gap-2">
                                <Camera size={11} className="text-white/45 shrink-0" />
                                <span className="font-semibold text-white/90 truncate">{c.name}</span>
                                <span className="ml-auto shrink-0 tabular-nums text-white/55 inline-flex items-center gap-1.5">
                                    <span className="text-[var(--accion-en-oscuro)]">↘{c.entry}</span><span className="visor-aviso">↗{c.exit}</span><b className="text-white/90">{pct(c.pct)}</b>
                                </span>
                            </div>
                            <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-[var(--accion-en-oscuro)]" style={{ width: `${Math.min(100, c.pct)}%` }} /></div>
                        </li>
                    ))}
                </ul>
            )}
            {s.denied > 0 && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[12px] font-semibold visor-mal"><ShieldX size={12} /> {s.denied} {s.denied === 1 ? "denegado" : "denegados"} en el período</div>
            )}
        </Seccion>
    );
}
