"use client";

import { useState } from "react";
import {
    AlertTriangle, BadgeCheck, Check, Clock, Cpu, HardDrive, Link2, Loader2, Radar, Video,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import {
    descubrirRecursos, guardarGrabador, vincularCanal,
    type Hallazgo,
} from "@/app/actions/descubrir";

/**
 * «Preguntale al equipo qué tiene.»
 *
 * Reemplaza a escribir una URL RTSP de memoria. Esa URL cambia con la marca y con el
 * canal, y el error más común —poner el flujo secundario— no da ningún síntoma: la cámara
 * conecta, la imagen se ve, y las matrículas no se leen nunca porque el cuadro no tiene
 * resolución para una chapa. Acá los canales vienen con su resolución al lado y se eligen
 * tocándolos.
 *
 * Y de paso contesta las preguntas que el alta hacía a ciegas: si la cámara sabe avisar
 * por cruce de línea y si lo tiene prendido, si su recurso inteligente está en modo
 * matrícula, qué hora tiene puesta, cuántos discos le quedan al grabador.
 */

const reloj = (desvioSeg: number) => {
    const s = Math.abs(desvioSeg);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${(s / 3600).toFixed(1)} h`;
};

export function Descubridor({ datos, alElegirCanal, alSugerirDisparo, alCompletar, pediCanal, pediGrabador }: {
    datos: { ip: string; username: string; password: string; authType: string; brand: string; deviceType: string };
    /** Poner este flujo como canal de la cámara que se está cargando. */
    alElegirCanal?: (rtsp: string) => void;
    /** Dejar elegido el modo de aviso que la cámara dice tener. */
    alSugerirDisparo?: (clave: "linea" | "zona") => void;
    /** Lo que el equipo contó de sí mismo, para completar lo que esté vacío. */
    alCompletar?: (e: { mac?: string; modelo?: string; autenticacion?: string }) => void;
    /** Si tiene sentido ofrecer "usar este canal". */
    pediCanal?: boolean;
    /** Si tiene sentido ofrecer dejarlo como grabador del sistema. */
    pediGrabador?: boolean;
}) {
    const [buscando, setBuscando] = useState(false);
    const [h, setH] = useState<Hallazgo | null>(null);
    const [guardandoNvr, setGuardandoNvr] = useState(false);
    const [atando, setAtando] = useState<number | null>(null);
    const [atados, setAtados] = useState<number[]>([]);

    const buscar = async () => {
        setBuscando(true); setH(null);
        try {
            const r = await descubrirRecursos(datos);
            setH(r);
            if (r.ok) {
                alCompletar?.({ mac: r.equipo?.mac, modelo: r.equipo?.modelo, autenticacion: r.autenticacion });
                /* Si la cámara ya tiene una analítica prendida, ése es el modo de aviso
                   que corresponde: está configurada para avisar y sería absurdo ponerla a
                   mirar la escena teniendo el aviso disponible. */
                const prendida = r.analiticas.find((a) => a.activa && (a.clave === "linea" || a.clave === "zona"));
                if (prendida) alSugerirDisparo?.(prendida.clave as "linea" | "zona");
            }
        } catch (e: any) {
            setH({ ok: false, error: e?.message || "No se pudo preguntar.", canales: [], analiticas: [], discos: [] });
        } finally { setBuscando(false); }
    };

    const dejarComoGrabador = async () => {
        setGuardandoNvr(true);
        const r = await guardarGrabador({ ip: datos.ip, username: datos.username, password: datos.password });
        setGuardandoNvr(false);
        if (r.ok) toast.success({ title: "Grabador del sistema guardado", description: "Ahora el historial puede pedirle los clips grabados." });
        else toast.error({ title: "No se pudo guardar", description: r.error });
    };

    const atar = async (canal: number, deviceId: string, rtsp: string) => {
        setAtando(canal);
        const r = await vincularCanal({ deviceId, canal, rtsp, usarFlujoDelGrabador: true });
        setAtando(null);
        if (r.ok) {
            setAtados((a) => [...a, canal]);
            toast.success({
                title: `Canal ${canal} vinculado`,
                description: r.flujoPuesto
                    ? "Y le quedó el flujo del grabador como canal de video."
                    : "El equipo ya tenía su propio flujo, así que no se le tocó.",
            });
        } else toast.error({ title: "No se pudo vincular", description: r.error });
    };

    return (
        <div className="space-y-3">
            <Button type="button" variant="outline" className="w-full"
                onClick={buscar} disabled={buscando || !datos.ip}>
                {buscando ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}
                {buscando ? "Preguntándole al equipo…" : "Preguntarle al equipo qué tiene"}
            </Button>

            <AnimatePresence initial={false}>
                {h && (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                        className="space-y-3">

                        {!h.ok ? (
                            <p className="rounded-[10px] border border-[var(--mal)]/35 bg-[var(--mal-suave)] p-3.5 text-[12.5px] text-[var(--mal-texto)]">
                                {h.error}
                            </p>
                        ) : (
                            <>
                                <div className="rounded-[10px] border border-[var(--bien)]/35 bg-[var(--bien-suave)] p-3.5">
                                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--bien-texto)]">
                                        <BadgeCheck size={14} /> Contestó por {h.autenticacion}
                                    </p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[12px] text-muted-foreground">
                                        <span>Modelo: <b className="text-foreground">{h.equipo?.modelo || "—"}</b></span>
                                        <span>Firmware: <b className="text-foreground">{h.equipo?.firmware || "—"}</b></span>
                                        <span>MAC: <b className="text-foreground tabular-nums">{h.equipo?.mac || "—"}</b></span>
                                        <span>Serie: <b className="text-foreground tabular-nums">{h.equipo?.serie || "—"}</b></span>
                                    </div>
                                </div>

                                {h.reloj && Math.abs(h.reloj.desvioSeg) > 60 && (
                                    /* No es un detalle: el playback del grabador se pide por hora. Con el
                                       reloj corrido, el clip que vuelve es de otro momento — o no vuelve. */
                                    <p className="rounded-[10px] border border-[var(--aviso)]/35 bg-[var(--aviso-suave)] p-3 text-[12px] text-[var(--aviso-texto)] flex gap-2">
                                        <Clock size={14} className="shrink-0 mt-px" />
                                        <span>
                                            Su reloj está {h.reloj.desvioSeg > 0 ? "atrasado" : "adelantado"} {reloj(h.reloj.desvioSeg)} respecto
                                            del servidor. Los clips grabados se piden por hora, así que con esto corrido vuelve el
                                            momento equivocado. Se emparejan desde la lista de equipos, con «Poner la hora».
                                        </span>
                                    </p>
                                )}

                                {h.analiticas.some((a) => a.soportada) && (
                                    <div className="rounded-[10px] border border-border bg-card/40 p-3.5 space-y-2.5">
                                        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                                            <Cpu size={14} /> Qué sabe hacer por su cuenta
                                        </p>
                                        {h.analiticas.map((a) => (
                                            <div key={a.clave} className="flex gap-2.5 items-start">
                                                <span className={cn("mt-[3px] shrink-0",
                                                    a.activa ? "text-[var(--bien)]" : a.soportada ? "text-muted-foreground" : "text-muted-foreground/50")}>
                                                    {a.activa ? <BadgeCheck size={14} /> : a.soportada ? <Check size={14} /> : <AlertTriangle size={14} />}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[12.5px] font-medium text-foreground">
                                                        {a.rotulo}
                                                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                                                            {a.activa ? "· prendida" : a.soportada ? "· disponible, apagada" : "· no la tiene"}
                                                        </span>
                                                    </span>
                                                    <span className="block text-[11.5px] text-muted-foreground leading-snug mt-0.5">{a.detalle}</span>
                                                </span>
                                                {a.soportada && (a.clave === "linea" || a.clave === "zona") && alSugerirDisparo && (
                                                    <Button type="button" variant="ghost" size="sm" className="shrink-0"
                                                        onClick={() => alSugerirDisparo(a.clave as "linea" | "zona")}>
                                                        Usar
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {h.canales.length > 0 && (
                                    <div className="rounded-[10px] border border-border bg-card/40 p-3.5 space-y-2">
                                        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                                            <Video size={14} /> {h.canales.length} canal{h.canales.length === 1 ? "" : "es"}
                                        </p>
                                        {h.canales.map((c) => (
                                            <div key={c.canal} className="rounded-[8px] border border-border bg-background/60 p-2.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="min-w-6 h-6 px-1.5 rounded bg-muted flex items-center justify-center text-[11px] font-bold tabular-nums text-foreground">
                                                        {c.canal}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-[12.5px] font-medium text-foreground truncate">
                                                            {c.nombre || `Canal ${c.canal}`}
                                                        </span>
                                                        <span className="block text-[11px] text-muted-foreground tabular-nums truncate">
                                                            {[c.resolucion, c.ip, c.deviceNombre && `ya cargada: ${c.deviceNombre}`].filter(Boolean).join(" · ") || "—"}
                                                        </span>
                                                    </span>
                                                    {pediCanal && alElegirCanal && (
                                                        <Button type="button" variant="outline" size="sm" className="shrink-0"
                                                            onClick={() => { alElegirCanal(c.rtsp); toast.success({ title: `Canal ${c.canal} puesto como flujo` }); }}>
                                                            Usar
                                                        </Button>
                                                    )}
                                                    {c.deviceId && (
                                                        <Button type="button" variant="outline" size="sm" className="shrink-0"
                                                            disabled={atando === c.canal || atados.includes(c.canal)}
                                                            onClick={() => atar(c.canal, c.deviceId!, c.rtsp)}>
                                                            {atando === c.canal ? <Loader2 size={13} className="animate-spin" />
                                                                : atados.includes(c.canal) ? <Check size={13} /> : <Link2 size={13} />}
                                                            {atados.includes(c.canal) ? "Vinculado" : "Vincular"}
                                                        </Button>
                                                    )}
                                                </div>
                                                {/* El flujo, entero y copiable. Es el dato que antes había que escribir de
                                                    memoria y con el que más se erraba. */}
                                                <code className="block mt-1.5 text-[10.5px] text-muted-foreground break-all">
                                                    {c.rtsp.replace(/:\/\/[^@]*@/, "://…@")}
                                                </code>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {h.discos.length > 0 && (
                                    <div className="rounded-[10px] border border-border bg-card/40 p-3.5 space-y-1.5">
                                        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                                            <HardDrive size={14} /> Discos
                                        </p>
                                        {h.discos.map((d) => (
                                            <p key={d.id} className="text-[12px] text-muted-foreground tabular-nums">
                                                Disco {d.id}: {d.capacidadGb} GB, {d.libresGb} GB libres · {d.estado}
                                            </p>
                                        ))}
                                    </div>
                                )}

                                {pediGrabador && (
                                    <Button type="button" variant="outline" className="w-full"
                                        onClick={dejarComoGrabador} disabled={guardandoNvr}>
                                        {guardandoNvr ? <Loader2 size={15} className="animate-spin" /> : <HardDrive size={15} />}
                                        Dejarlo como el grabador del sistema
                                    </Button>
                                )}
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
