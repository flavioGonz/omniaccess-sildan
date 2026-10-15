"use client";

import { useEffect, useState } from "react";
import { Cpu, MemoryStick, Gauge, Video } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lo que cuesta la pared ahora, en una tira: CPU, memoria, GPU y los vivos que sirve go2rtc.
 *
 * Por qué está en la pared (pedido 15/10): convertir video es lo único de la pared que le
 * cuesta CPU al servidor, y esa CPU es la misma que usa la lectura de matrículas. Quien arma
 * una vista de 25 canales tiene que ver el precio mientras la arma, no enterarse después por
 * una barrera que tarda.
 *
 * Cada medidor lleva su tono por umbral (ver UMBRALES), nunca un color suelto: verde es «sobra»,
 * ámbar «se está usando mucho», rojo «está al límite».
 */
type Medida = {
    ts: number;
    cpu: { uso: number | null; carga: number; nucleos: number; temp: number | null };
    memoria: { usada: number; total: number };
    gpu: { uso: number | null; mem: number | null; memTotal: number | null; temp: number | null; w: number | null } | null;
    gpuFalla: "sin-placa" | "sin-driver" | null;
    video: { activos: number; convertidos: number; directos: number; espectadores: number } | null;
};

/** Cada cuánto se pregunta. La ruta guarda la medida 2,5 s: más seguido no trae nada nuevo. */
const INTERVALO_MS = 3000;
/** Porcentaje desde el que un medidor pasa a ámbar y a rojo. */
const UMBRALES = { aviso: 70, mal: 90 };
/** Temperatura (°C) desde la que el número pasa a ámbar y a rojo. */
const TEMP = { aviso: 80, mal: 90 };

/** «quieto» acá es «sin dato»: la barra va gris, no en el violeta del tono quieto. */
const tono = (pct: number | null | undefined) => pct == null ? "quieto" : pct >= UMBRALES.mal ? "mal" : pct >= UMBRALES.aviso ? "aviso" : "bien";
const tonoTemp = (t: number | null | undefined) => t == null ? null : t >= TEMP.mal ? "tono-mal" : t >= TEMP.aviso ? "tono-aviso" : null;
const gb = (b: number) => (b / 1024 ** 3).toLocaleString("es-UY", { maximumFractionDigits: 1 });

function Medidor({ Icono, rotulo, pct, valor, extra, titulo, className }: { Icono: any; rotulo: string; pct: number | null; valor: string; extra?: React.ReactNode; titulo: string; className?: string }) {
    const t = tono(pct);
    return (
        <div title={titulo} className={cn("flex items-center gap-2 h-10 pl-2.5 pr-3 rounded-[10px] bg-muted/60 min-w-0 shrink-0", className)}>
            <Icono size={15} className="text-muted-foreground shrink-0" />
            <div className="min-w-0">
                <div className="flex items-baseline gap-1.5 leading-none">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</span>
                    <span className="text-[13px] font-semibold tabular-nums">{valor}</span>
                    {extra}
                </div>
                <div className="mt-1 h-[3px] w-16 rounded-full bg-border overflow-hidden">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(2, Math.min(100, pct ?? 0))}%`, background: t === "quieto" ? "var(--muted-foreground)" : `var(--${t})` }} />
                </div>
            </div>
        </div>
    );
}

export function Recursos({ h265, directosOk, directosMal, envolver }: { h265: boolean | null; directosOk: number; directosMal: number; envolver?: boolean }) {
    const [m, setM] = useState<Medida | null>(null);
    const [error, setError] = useState(false);
    useEffect(() => {
        let vivo = true;
        const pedir = () => fetch("/api/monitor/camaras/recursos", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((j) => { if (vivo) { setM(j); setError(false); } })
            .catch(() => { if (vivo) setError(true); });
        pedir();
        const iv = setInterval(pedir, INTERVALO_MS);
        return () => { vivo = false; clearInterval(iv); };
    }, []);

    const memPct = m ? Math.round((m.memoria.usada / m.memoria.total) * 100) : null;
    const gpuMemPct = m?.gpu?.mem != null && m.gpu.memTotal ? Math.round((m.gpu.mem / m.gpu.memTotal) * 100) : null;
    const v = m?.video;
    // En el navegador: lo que dice saber y lo que de verdad arrancó.
    const navegador = h265 === null ? null : h265 && !(directosMal && !directosOk) ? "bien" : "aviso";
    return (
        <div className={cn("flex items-center gap-1.5 min-w-0", envolver ? "flex-wrap" : "overflow-x-auto [scrollbar-width:none]")}>
            {error && !m && <span className="text-[12px] text-muted-foreground px-2">Sin medida de recursos</span>}
            {m && (<>
                <Medidor Icono={Cpu} rotulo="CPU" pct={m.cpu.uso} valor={m.cpu.uso != null ? `${m.cpu.uso} %` : "—"}
                    extra={m.cpu.temp != null ? <span className={cn("text-[12px] tabular-nums text-muted-foreground", tonoTemp(m.cpu.temp))}>{Math.round(m.cpu.temp)}°</span> : null}
                    titulo={`Procesador del servidor: ${m.cpu.uso ?? "—"} % de ${m.cpu.nucleos} núcleos (carga ${m.cpu.carga.toLocaleString("es-UY")}). Es la que se usa para convertir video y la que comparte con la lectura de matrículas.`} />
                <Medidor Icono={MemoryStick} rotulo="RAM" className={envolver ? undefined : "hidden min-[1750px]:flex"} pct={memPct} valor={`${gb(m.memoria.usada)}/${gb(m.memoria.total)} GB`}
                    titulo={`Memoria en uso del servidor: ${memPct} %. No cuenta la caché que el sistema suelta cuando hace falta.`} />
                {m.gpu ? (
                    <Medidor Icono={Gauge} rotulo="GPU" pct={m.gpu.uso} valor={`${m.gpu.uso ?? "—"} %`}
                        extra={<span className="text-[12px] tabular-nums text-muted-foreground">{gpuMemPct != null ? `· ${gb((m.gpu.mem || 0) * 1024 ** 2)} GB` : ""}{m.gpu.temp != null ? <span className={cn("ml-1", tonoTemp(m.gpu.temp))}>{Math.round(m.gpu.temp)}°</span> : null}</span>}
                        titulo={`Placa de video: ${m.gpu.uso ?? "—"} % de uso, ${m.gpu.mem ?? "—"} de ${m.gpu.memTotal ?? "—"} MB de memoria${m.gpu.w != null ? `, ${Math.round(m.gpu.w)} W` : ""}. La usan el lector de matrículas y OmniVision; la pared no la usa.`} />
                ) : (
                    <span title={m.gpuFalla === "sin-driver" ? "Hay placa pero no responde (driver)" : "Este servidor no tiene placa de video NVIDIA"}
                        className={cn("h-10 px-3 rounded-[10px] inline-flex items-center gap-1.5 text-[12px] font-semibold", m.gpuFalla === "sin-driver" ? "chip-mal border" : "bg-muted/60 text-muted-foreground")}>
                        <Gauge size={15} /> {m.gpuFalla === "sin-driver" ? "GPU sin driver" : "Sin GPU"}
                    </span>
                )}
                {v && (
                    <div title={`go2rtc está sirviendo ${v.activos} vivos a ${v.espectadores} navegadores: ${v.directos} directos (sólo reempaqueta, casi no cuesta) y ${v.convertidos} convertidos a H.264 (cada uno usa CPU).`}
                        className="flex items-center gap-2 h-10 pl-2.5 pr-3 rounded-[10px] bg-muted/60 whitespace-nowrap shrink-0">
                        <Video size={15} className="text-muted-foreground shrink-0" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Vivos</span>
                        <span className="text-[13px] font-semibold tabular-nums">{v.directos}</span><span className="text-[12px] text-muted-foreground">{envolver ? "directos" : "dir."}</span>
                        <span className={cn("text-[13px] font-semibold tabular-nums", v.convertidos > 0 && "tono-aviso")}>{v.convertidos}</span><span className="text-[12px] text-muted-foreground">{envolver ? "convertidos" : "conv."}</span>
                    </div>
                )}
            </>)}
            {navegador && (
                <span title={h265 ? "Este navegador decodifica H.265: sus vivos no le cuestan nada al servidor." : "Este navegador no reproduce H.265: el servidor convierte unos pocos canales y el resto son fotos. Chrome o Edge en Windows con aceleración por hardware lo reproducen directo."}
                    className={cn("h-10 px-3 rounded-[10px] border inline-flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap shrink-0", `chip-${navegador}`)}>
                    {h265 ? (directosMal && !directosOk ? "H.265 no reproduce" : `H.265${directosMal ? ` · ${directosMal} fallaron` : envolver ? " en este equipo" : ""}`) : envolver ? "Sin H.265 en este equipo" : "Sin H.265"}
                </span>
            )}
        </div>
    );
}
