"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, HelpCircle, Hourglass, Pause, Play, Send, XCircle } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";
import { estadoCola } from "@/app/actions/procesos";
import { CADA_VIVO_MS, Linea, Pulso, useHistorias, useSegundero } from "./vivo";

/**
 * Ajustes → Sistema → Colas y envíos.
 *
 * Vivía como un bloque al pie de Procesos, con cinco números que se refrescaban cada 10 s. Es
 * otra cosa: no es un proceso sino lo que espera a uno («Envíos y grabación»). Acá se ve en vivo,
 * con la línea de cada estado de los últimos minutos: una cola que sólo sube es un envío trabado,
 * y eso se ve en la forma de la línea antes que en el número.
 */

type Cola = Awaited<ReturnType<typeof estadoCola>>;

const ESTADOS = [
    { k: "espera", rotulo: "Esperando", icono: Hourglass, pista: "Avisos en la cola que todavía no tomó el proceso «Envíos y grabación». Si sube y no baja, ese proceso está caído o trabado.", aviso: (n: number) => n > 20 },
    { k: "activos", rotulo: "Enviándose", icono: Send, pista: "Los que se están mandando ahora (armando el clip o esperando a WhatsApp/Telegram)." },
    { k: "demorados", rotulo: "Demorados", icono: Clock, pista: "Los que se reintentan más tarde: el canal contestó con error y se espera antes de volver a probar." },
    { k: "fallidos", rotulo: "Fallidos", icono: XCircle, pista: "Los que se dieron por perdidos después de los reintentos. El detalle de cada uno está en Despachos.", mal: (n: number) => n > 0 },
    { k: "completos", rotulo: "Enviados", icono: CheckCircle2, pista: "Los que salieron bien y Redis todavía guarda (se van borrando solos). El historial completo está en Despachos." },
] as const;

export default function ColasSection() {
    const [c, setC] = useState<Cola | null>(null);
    const [enPausa, setEnPausa] = useState(false);
    const historia = useHistorias();
    const ahora = useSegundero();
    const pidiendo = useRef(false);

    const traer = useCallback(async () => {
        if (pidiendo.current) return;
        pidiendo.current = true;
        try {
            const r = await estadoCola();
            if (r.ok) for (const e of ESTADOS) historia.sumar(e.k, (r as any)[e.k]);
            setC(r);
        } catch (e: any) { setC({ ok: false, al: new Date().toISOString(), error: e?.message || "No se pudo leer la cola" }); }
        finally { pidiendo.current = false; }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { traer(); }, [traer]);
    useEffect(() => {
        if (enPausa) return;
        const i = setInterval(() => { if (document.visibilityState === "visible") traer(); }, CADA_VIVO_MS);
        return () => clearInterval(i);
    }, [enPausa, traer]);

    const atrasado = c && ahora - Date.parse(c.al) > CADA_VIVO_MS * 4;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-[17px] font-bold">Colas y envíos</h2>
                    <p className="text-[12.5px] text-muted-foreground max-w-2xl">Los avisos por WhatsApp y Telegram esperan acá a que «Envíos y grabación» los mande. Cada envío, con su destinatario y su resultado, está en Despachos.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setEnPausa((v) => !v)} aria-pressed={!enPausa}
                        className="h-8 pl-2.5 pr-3 rounded-full border border-border text-[12px] font-semibold flex items-center gap-2 hover:bg-accent">
                        <Pulso activo={!enPausa && !!c?.ok && !atrasado} tono={c && !c.ok ? "mal" : enPausa ? "quieto" : "bien"} />
                        {enPausa ? "En pausa" : c && !c.ok ? "Sin respuesta" : "En vivo"}
                        {enPausa ? <Play size={12} /> : <Pause size={12} className="text-muted-foreground" />}
                    </button>
                    <Link href="/admin/despachos" className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold flex items-center gap-1.5 hover:bg-accent">
                        Despachos <ArrowUpRight size={13} />
                    </Link>
                </div>
            </div>

            {c && !c.ok ? (
                <div className="rounded-[10px] border chip-mal px-4 py-3 text-[12.5px] flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span><b>No se pudo leer la cola.</b> {c.error}. La cola vive en Redis: si Redis está caído, los avisos no salen. Mirá Procesos y tareas → Sistema.
                        <button onClick={traer} className="tono-accion font-semibold ml-2">Reintentar</button></span>
                </div>
            ) : null}

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
                {ESTADOS.map((e) => {
                    const n = c?.ok ? (c as any)[e.k] as number : null;
                    const Ic = e.icono;
                    const tono = n == null ? "" : "mal" in e && e.mal(n) ? "tono-mal" : "aviso" in e && e.aviso(n) ? "tono-aviso" : "";
                    return (
                        <div key={e.k} className="rounded-[10px] border border-border bg-card px-3.5 py-3">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Ic size={12.5} /> {e.rotulo}
                                <Pista titulo={e.rotulo} texto={e.pista} ancho={260}><HelpCircle size={11.5} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" /></Pista>
                            </div>
                            <div className="mt-1.5 flex items-end justify-between gap-2">
                                <span className={cn("text-[24px] font-bold tabular-nums leading-none tracking-[-0.02em]", tono)}>{n == null ? "—" : n}</span>
                                <Linea datos={historia.de(e.k)} ancho={84} alto={24} piso={3} className={tono || "tono-accion"} />
                            </div>
                        </div>
                    );
                })}
            </div>
            <p className="text-[11.5px] text-muted-foreground">Se lee de Redis cada {CADA_VIVO_MS / 1000} s mientras la pestaña está a la vista. Las líneas son los últimos minutos.</p>
        </div>
    );
}
