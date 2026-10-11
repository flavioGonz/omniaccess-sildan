"use client";

import { useEffect } from "react";
import { Camera, HardDrive, Server, Cpu, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, usarReloj } from "@/lib/monitor/cliente";
import { cn } from "@/lib/utils";

/** Salud del sistema: una tarjeta por componente, y arriba la única frase que importa. */
const INTERVALO_MS = 60_000;

type Estado = "bien" | "degradado" | "caido" | "sinDato";
type Comp = { id: string; grupo: "camaras" | "nvr" | "servicios" | "procesos"; nombre: string; estado: Estado; detalle: string; respondio: string | null; caidoDesde: string | null };
type Datos = { componentes: Comp[]; resumen: { total: number; conProblemas: number; sinDato: number; primero: string[] }; ahora: string };

const TONO: Record<Estado, { fondo: string; borde: string; Icono: any; texto: string }> = {
    bien: { fondo: "bg-card", borde: "border-border", Icono: CheckCircle2, texto: "text-[var(--bien-texto)]" },
    degradado: { fondo: "bg-[var(--aviso-suave)]", borde: "border-[color-mix(in_oklab,var(--aviso)_50%,transparent)]", Icono: AlertTriangle, texto: "text-[var(--aviso-texto)]" },
    caido: { fondo: "bg-[var(--mal-suave)]", borde: "border-[color-mix(in_oklab,var(--mal)_60%,transparent)]", Icono: XCircle, texto: "text-[var(--mal-texto)]" },
    sinDato: { fondo: "bg-muted/30", borde: "border-border", Icono: HelpCircle, texto: "text-muted-foreground" },
};
const GRUPOS: { clave: Comp["grupo"]; rotulo: string; Icono: any }[] = [
    { clave: "servicios", rotulo: "Servicios", Icono: HardDrive }, { clave: "procesos", rotulo: "Procesos", Icono: Cpu },
    { clave: "nvr", rotulo: "Grabadores", Icono: Server }, { clave: "camaras", rotulo: "Cámaras y lectoras", Icono: Camera },
];
const ORDEN: Record<Estado, number> = { caido: 0, degradado: 1, sinDato: 2, bien: 3 };

export function VistaSalud() {
    const { latir, setTitulo } = useMarco();
    useEffect(() => { setTitulo("Salud del sistema"); }, [setTitulo]);
    usarReloj();
    const { datos, error } = usarDatos<Datos>("/api/monitor/salud", INTERVALO_MS, latir);
    const r = datos?.resumen;
    return (
        <div className="absolute inset-0 p-5 flex flex-col gap-4 overflow-hidden">
            <div className={cn("shrink-0 rounded-2xl border px-6 py-5 flex items-center gap-5", !r ? "border-border bg-card" : r.conProblemas ? "border-[color-mix(in_oklab,var(--mal)_60%,transparent)] bg-[var(--mal-suave)]" : "border-[color-mix(in_oklab,var(--bien)_50%,transparent)] bg-[var(--bien-suave)]")}>
                <span className={cn("grid h-16 w-16 place-items-center rounded-full shrink-0", !r ? "bg-muted text-muted-foreground" : r.conProblemas ? "pleno-mal" : "pleno-bien")}>{!r ? <HelpCircle size={32} /> : r.conProblemas ? <XCircle size={32} /> : <CheckCircle2 size={32} />}</span>
                <div className="min-w-0">
                    {/* "Todo en línea" sólo si de verdad se sabe de todos: lo que no se muestrea no se da por bueno. */}
                    <div className="text-[36px] font-bold leading-tight">{!r ? (error ? "No se pudo leer la salud" : "Revisando…") : r.conProblemas ? `${r.conProblemas} componente${r.conProblemas === 1 ? "" : "s"} con problemas` : r.sinDato ? "Sin problemas conocidos" : "Todo en línea"}</div>
                    <div className="text-[17px] text-muted-foreground truncate">{!r ? (error || "") : r.conProblemas ? r.primero.join(" · ") : `${r.total - r.sinDato} de ${r.total} componentes responden${r.sinDato ? ` · ${r.sinDato} sin dato` : ""} · revisado ${hace(datos!.ahora)}`}</div>
                </div>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 overflow-hidden">
                {GRUPOS.map((g) => {
                    const lista = (datos?.componentes || []).filter((c) => c.grupo === g.clave).sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.nombre.localeCompare(b.nombre));
                    return (
                        <section key={g.clave} className="min-h-0 flex flex-col gap-2 overflow-hidden">
                            <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-2"><g.Icono size={14} /> {g.rotulo} <span className="text-muted-foreground/60">· {lista.length}</span></div>
                            <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-2 gap-2 content-start">
                                {lista.map((c) => { const t = TONO[c.estado]; return (
                                    <div key={c.id} className={cn("rounded-xl border px-3.5 py-3 flex items-start gap-3", t.fondo, t.borde)}>
                                        <t.Icono size={22} className={cn("shrink-0 mt-0.5", t.texto)} />
                                        <div className="min-w-0">
                                            <div className="text-[17px] font-semibold leading-tight truncate">{c.nombre}</div>
                                            <div className="text-[13px] text-muted-foreground leading-snug">{c.detalle}</div>
                                            <div className="text-[12px] text-muted-foreground/70 tabular-nums mt-0.5">{c.caidoDesde ? `caído ${hace(c.caidoDesde)}` : c.respondio ? `respondió ${hace(c.respondio)}` : "sin respuesta registrada"}</div>
                                        </div>
                                    </div>
                                ); })}
                                {datos && lista.length === 0 && <div className="text-[15px] text-muted-foreground">Nada en este grupo</div>}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
