"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Cpu, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getDevices } from "@/app/actions/devices";

/**
 * Filtrar por equipo (16/10, Nico: «Origen debe poder seleccionar todos los dispositivos del
 * sistema, para filtrar las alarmas del mismo»). Los cuatro orígenes dicen de QUÉ clase es la
 * alarma; esto dice DE DÓNDE: una cámara, una lectora, un NVR.
 *
 * La lista es la de todos los equipos (getDevices, sin credenciales), agrupada por tipo, con
 * cuántas alarmas de la lista tiene cada uno; los que tienen van primero. Elegir uno acota la
 * tabla; la X lo saca.
 */
export type Equipo = { id: string; name: string; deviceType: string };

const TIPO: Record<string, string> = {
    LPR_CAMERA: "Lectoras de matrícula", LPR_INTERIOR: "Cámaras interiores", CAMERA: "Cámaras", NVR: "Grabadores",
    FACE_TERMINAL: "Terminales faciales", ACCESS_CONTROL: "Control de acceso", DOOR_INTERCOM: "Porteros", QUEUE_COUNTER: "Contadores de filas",
};

export function ElegirDispositivo({ valor, alElegir, cuenta }: { valor: Equipo | null; alElegir: (e: Equipo | null) => void; cuenta: (e: Equipo) => number }) {
    const [abierto, setAbierto] = useState(false);
    const [buscar, setBuscar] = useState("");
    const [equipos, setEquipos] = useState<Equipo[] | null>(null);
    useEffect(() => {
        if (!abierto || equipos) return;
        getDevices().then((d: any[]) => setEquipos((d || []).map((x) => ({ id: x.id, name: x.name, deviceType: String(x.deviceType) })))).catch(() => setEquipos([]));
    }, [abierto, equipos]);

    const q = buscar.trim().toLowerCase();
    const grupos = useMemo(() => {
        const m = new Map<string, (Equipo & { n: number })[]>();
        for (const e of equipos || []) {
            if (q && !e.name.toLowerCase().includes(q)) continue;
            const k = e.deviceType;
            m.set(k, [...(m.get(k) || []), { ...e, n: cuenta(e) }]);
        }
        return [...m.entries()].map(([tipo, xs]) => ({ tipo, xs: xs.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)) }))
            .sort((a, b) => b.xs.reduce((s, x) => s + x.n, 0) - a.xs.reduce((s, x) => s + x.n, 0));
    }, [equipos, q, cuenta]);

    return (
        <Popover open={abierto} onOpenChange={(o) => { setAbierto(o); if (!o) setBuscar(""); }}>
            <span className="inline-flex items-center">
                <PopoverTrigger asChild>
                    <button type="button" title="Acotar a un equipo"
                        className={cn("h-[30px] pl-2.5 pr-2 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors max-w-[260px]",
                            valor ? "bg-[var(--accion)] border-[var(--accion)] text-white" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                        <Cpu size={13} className="shrink-0" />
                        <span className="truncate">{valor ? valor.name : "Todos los equipos"}</span>
                        {!valor && <ChevronDown size={13} className="shrink-0 opacity-70" />}
                    </button>
                </PopoverTrigger>
                {valor && <button type="button" onClick={() => alElegir(null)} aria-label="Todos los equipos" title="Todos los equipos" className="ml-1 h-[26px] w-[26px] grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"><X size={13} /></button>}
            </span>
            <PopoverContent align="start" className="p-0 w-[340px] overflow-hidden">
                <div className="flex items-center gap-2 px-3 h-10 border-b border-border">
                    <Search size={14} className="text-muted-foreground shrink-0" />
                    <input autoFocus value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar equipo" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
                </div>
                <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
                    <button type="button" onClick={() => { alElegir(null); setAbierto(false); }}
                        className={cn("w-full flex items-center gap-2 rounded-[6px] px-2 h-8 text-left text-[12.5px] hover:bg-accent", !valor && "font-semibold")}>
                        <span className="flex-1">Todos los equipos</span>{!valor && <Check size={13} className="text-[var(--accion)]" />}
                    </button>
                    {!equipos ? <div className="px-3 py-4 text-[12px] text-muted-foreground">Trayendo los equipos…</div>
                        : grupos.length === 0 ? <div className="px-3 py-4 text-[12px] text-muted-foreground">Ningún equipo con ese nombre.</div>
                            : grupos.map((g) => (
                                <div key={g.tipo} className="pt-1.5">
                                    <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{TIPO[g.tipo] || g.tipo}</div>
                                    {g.xs.map((e) => {
                                        const on = valor?.id === e.id;
                                        return (
                                            <button key={e.id} type="button" onClick={() => { alElegir(e); setAbierto(false); }}
                                                className={cn("w-full flex items-center gap-2 rounded-[6px] px-2 h-8 text-left text-[12.5px] hover:bg-accent", on && "bg-accent/60 font-semibold", !e.n && "text-muted-foreground")}>
                                                <span className="flex-1 truncate">{e.name}</span>
                                                {e.n > 0 && <span className="tabular-nums text-[11.5px] font-semibold">{e.n}</span>}
                                                {on && <Check size={13} className="text-[var(--accion)]" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
