"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    Clock, Car, Camera, Activity, ChevronRight, Loader2, Inbox,
    LogIn, LogOut, ParkingCircle, ShieldCheck, ShieldX, Route as RouteIco,
    ShieldAlert, MoreHorizontal,
} from "lucide-react";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { cn } from "@/lib/utils";
import { Pista, Columna } from "@/components/ui/pista";
import { VisorCuadro } from "@/components/VisorCuadro";
import { FlujoMatricula, type PasoFlujo } from "@/components/history/FlujoMatricula";

export type FilaHistorial = {
    id: string;
    tipo: "ACCESO" | "PASO" | "ESTACIONADO";
    momento: string;
    plate: string | null;
    persona: string | null;
    camara: string | null;
    deviceId: string | null;
    decision: string | null;
    sentido: string | null;
    confianza: number | null;
    lecturas: number | null;
    foto: string | null;
    estDesde: string | null;
    estHasta: string | null;
    detalles: string | null;
    permanencia: number | null;
    raw: any | null;
};

const POR_PAGINA = 60;

const lapso = (seg: number) => {
    if (seg < 60) return "< 1 min";
    if (seg < 3600) return `${Math.round(seg / 60)} min`;
    const h = Math.floor(seg / 3600);
    return `${h} h ${Math.round((seg % 3600) / 60)} min`;
};

/**
 * Cómo se presenta cada clase de fila.
 *
 * El tipo no es decorativo: un acceso decidió si la barrera abría, un avistamiento solo
 * dejó constancia, y una estadía ni siquiera es un momento sino un intervalo. Mezclarlos
 * en una tabla sin que cada uno se distinga a simple vista sería peor que tenerlos
 * separados, que es de donde venimos.
 */
export const RASGOS: Record<string, { Ico: any; rotulo: string; ayuda: string; chip: string; punto: string }> = {
    ACCESO_ENTRY: {
        Ico: LogIn, rotulo: "Entrada", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", punto: "bg-emerald-400",
        ayuda: "Una cámara LPR de entrada leyó la matrícula y el sistema decidió si abría la barrera.",
    },
    ACCESO_EXIT: {
        Ico: LogOut, rotulo: "Salida", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", punto: "bg-amber-400",
        ayuda: "Una cámara LPR de salida leyó la matrícula y el sistema decidió si abría la barrera.",
    },
    PASO: {
        Ico: Camera, rotulo: "Avistamiento", chip: "bg-violet-500/15 text-violet-300 border-violet-500/30", punto: "bg-violet-400",
        ayuda: "Una cámara interior vio pasar el vehículo. No abre barrera: sólo deja constancia de por dónde pasó.",
    },
    ESTACIONADO: {
        Ico: ParkingCircle, rotulo: "Estacionado", chip: "bg-slate-500/20 text-slate-200 border-slate-400/30", punto: "bg-slate-400",
        ayuda: "El vehículo se quedó quieto en el mismo lugar del cuadro. Es UNA fila por estadía, con su intervalo, no una fila por relectura.",
    },
};

export const rasgoDe = (f: { tipo: string; sentido: string | null }) =>
    f.tipo === "ACCESO" ? RASGOS[f.sentido === "EXIT" ? "ACCESO_EXIT" : "ACCESO_ENTRY"] : RASGOS[f.tipo];

function FilaFantasma() {
    return (
        <tr className="border-b border-border/30">
            {Array.from({ length: 7 }).map((_, i) => (
                <td key={i} className="px-5 py-3">
                    <div className="h-3 rounded bg-muted/40 animate-pulse" style={{ width: `${45 + (i * 13) % 45}%` }} />
                </td>
            ))}
        </tr>
    );
}

export function TablaUnificada({ buscar, desde, hasta, tipos, merodeo, onMerodeo }: {
    buscar: string; desde: string; hasta: string; tipos: string[];
    /** Matrículas marcadas por merodeo; si viene vacío no se filtra. */
    merodeo?: Set<string>;
    onMerodeo?: (chapas: Set<string>) => void;
}) {
    const [filas, setFilas] = useState<FilaHistorial[]>([]);
    const [hay, setHay] = useState(false);
    const [cargando, setCargando] = useState(false);
    const [pagina, setPagina] = useState(0);
    const [abierta, setAbierta] = useState<string | null>(null);
    const [viendo, setViendo] = useState<{ foto: string; plate: string; camara: string | null; momento: string; confianza: number | null } | null>(null);
    const clave = useRef("");

    useEffect(() => { setPagina(0); }, [buscar, desde, hasta, tipos.join(",")]);

    useEffect(() => {
        let vivo = true;
        setCargando(true);
        const q = new URLSearchParams({ take: String(POR_PAGINA), skip: String(pagina * POR_PAGINA) });
        if (buscar) q.set("search", buscar);
        if (desde) q.set("from", desde);
        if (hasta) q.set("to", hasta);
        if (tipos.length) q.set("tipos", tipos.join(","));
        const esta = q.toString();
        clave.current = esta;

        fetch(`/api/history/unified?${esta}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((j) => {
                if (!vivo || clave.current !== esta) return;
                setFilas((prev) => (pagina === 0 ? (j.filas || []) : [...prev, ...(j.filas || [])]));
                setHay(!!j.hay);
            })
            .catch(() => { })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [buscar, desde, hasta, tipos, pagina]);

    const alternar = useCallback((f: FilaHistorial) => {
        if (!f.plate) return;
        setAbierta((a) => (a === f.id ? null : f.id));
    }, []);

    /**
     * Merodeo: la misma matrícula muchas veces en poco tiempo sin llegar a entrar.
     *
     * Se calcula sobre lo que hay cargado, que es una aproximación honesta: con paginado
     * no se puede afirmar más que eso, y decirlo con la mitad de los datos sería peor que
     * no decirlo.
     */
    useEffect(() => {
        if (!onMerodeo) return;
        const porChapa = new Map<string, number>();
        for (const f of filas) {
            if (!f.plate) continue;
            if (f.tipo === "ACCESO" && f.decision !== "DENY") continue;
            porChapa.set(f.plate, (porChapa.get(f.plate) || 0) + 1);
        }
        onMerodeo(new Set([...porChapa.entries()].filter(([, n]) => n >= 4).map(([p]) => p)));
    }, [filas, onMerodeo]);

    const visibles = merodeo && merodeo.size ? filas.filter((f) => f.plate && merodeo.has(f.plate)) : filas;
    const vacio = !cargando && visibles.length === 0;

    return (
        <div className="bg-card/60 border border-border/50 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                        <tr className="border-b border-border/50">
                            <Columna icono={Clock} titulo="Cuándo"
                                ayuda="El momento del evento, no el de su registro. En una estadía es el intervalo completo: desde que el vehículo se detuvo hasta la última vez que se lo vio ahí.">Momento</Columna>
                            <Columna icono={Activity} titulo="Qué clase de registro es"
                                ayuda="Entrada y salida las decide una cámara LPR y abren barrera. Un avistamiento lo hace una cámara interior y sólo deja constancia. Estacionado es un vehículo quieto dentro del encuadre.">Tipo</Columna>
                            <Columna icono={Car} titulo="Matrícula o persona"
                                ayuda="Lo que identificó el sistema. Hacé clic en la fila para ver el flujo completo de esa matrícula: por qué cámaras pasó y cuánto tardó entre una y otra.">Identificación</Columna>
                            <Columna icono={Camera} titulo="Qué equipo lo registró"
                                ayuda="La cámara o el dispositivo de acceso que generó el registro.">Cámara</Columna>
                            <Columna icono={ShieldCheck} titulo="Cómo salió"
                                ayuda="En un acceso, si se permitió o se denegó. En un avistamiento, qué tan segura fue la lectura: verde arriba de 85%, ámbar entre 65 y 85, rojo debajo.">Resultado</Columna>
                            <Columna icono={ShieldAlert} titulo="Señales y permanencia"
                                ayuda="Permanencia es cuánto estuvo adentro el vehículo, y sale solo en las salidas. Merodeo marca una matrícula que aparece muchas veces en poco tiempo sin llegar a entrar.">Señales</Columna>
                            <Columna icono={Camera} alinear="right" titulo="El cuadro y la ficha"
                                ayuda="La foto del momento: hacé clic para verla grande y acercarla, que es como se juzga una matrícula chica. En los accesos, el botón de puntos abre la ficha completa.">Cuadro</Columna>
                        </tr>
                    </thead>
                    <tbody>
                        {visibles.length === 0 && cargando && (
                            <>{Array.from({ length: 8 }).map((_, i) => <FilaFantasma key={i} />)}</>
                        )}

                        {vacio && (
                            <tr>
                                <td colSpan={7} className="py-16 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <Inbox className="w-8 h-8 text-muted-foreground/50" />
                                        <p className="text-sm text-muted-foreground">Nada en este período</p>
                                        <p className="text-xs text-muted-foreground/70 max-w-sm mx-auto">
                                            Probá ampliar el rango de fechas, o quitar algún filtro de tipo.
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        )}

                        {visibles.map((f, i) => {
                            const r = rasgoDe(f);
                            const conf = f.confianza != null ? Math.round(f.confianza * 100) : null;
                            const quieto = f.tipo === "ESTACIONADO";
                            const estadia = quieto && f.estDesde
                                ? lapso((new Date(f.estHasta || f.momento).getTime() - new Date(f.estDesde).getTime()) / 1000)
                                : null;
                            const abierto = abierta === f.id;

                            return (
                                <>
                                    <motion.tr key={f.id}
                                        initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.16, delay: Math.min(i % POR_PAGINA, 12) * 0.012 }}
                                        onClick={() => alternar(f)}
                                        className={cn("border-b border-border/30 transition-colors",
                                            f.plate ? "cursor-pointer hover:bg-muted/30" : "",
                                            abierto && "bg-muted/25")}>

                                        <td className="px-5 py-3">
                                            <p className="text-sm font-medium text-foreground tabular-nums">
                                                {new Date(f.momento).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                {quieto && f.estDesde
                                                    ? <>desde {new Date(f.estDesde).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {new Date(f.momento).toLocaleDateString("es-UY", { day: "2-digit", month: "short" })}</>
                                                    : new Date(f.momento).toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" })}
                                            </p>
                                        </td>

                                        <td className="px-5 py-3">
                                            <Pista titulo={r.rotulo} texto={r.ayuda}>
                                                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-bold", r.chip)}>
                                                    <r.Ico className="w-3 h-3" />
                                                    {r.rotulo}
                                                    {estadia && <span className="font-semibold opacity-80">· {estadia}</span>}
                                                </span>
                                            </Pista>
                                        </td>

                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2">
                                                {f.plate ? (
                                                    <span className={cn("px-2.5 py-0.5 rounded-md font-mono text-sm font-bold tracking-widest text-foreground border",
                                                        quieto ? "bg-slate-500/15 border-slate-400/30" : "bg-violet-500/15 border-violet-500/30")}>
                                                        {f.plate}
                                                    </span>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">{f.persona || "—"}</span>
                                                )}
                                                {f.plate && f.persona && (
                                                    <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">{f.persona}</span>
                                                )}
                                                {f.plate && (
                                                    <motion.span animate={{ rotate: abierto ? 90 : 0 }} transition={{ duration: 0.18 }}
                                                        className="text-muted-foreground/45 shrink-0">
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </motion.span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="px-5 py-3 text-sm text-foreground">{f.camara || "—"}</td>

                                        <td className="px-5 py-3">
                                            {f.tipo === "ACCESO" ? (
                                                f.decision === "DENY" ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400">
                                                        <ShieldX className="w-3.5 h-3.5" /> Denegado
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                                                        <ShieldCheck className="w-3.5 h-3.5" /> Permitido
                                                    </span>
                                                )
                                            ) : conf == null ? (
                                                <span className="text-muted-foreground text-xs">—</span>
                                            ) : (
                                                <span className={cn("text-xs font-semibold tabular-nums",
                                                    conf >= 85 ? "text-emerald-400" : conf >= 65 ? "text-amber-400" : "text-red-400")}>
                                                    {conf}%
                                                    {f.lecturas != null && <span className="text-muted-foreground/60 font-normal"> · {f.lecturas} cuadros</span>}
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-5 py-3">
                                            <div className="flex flex-col gap-0.5">
                                                {f.permanencia != null && (
                                                    <Pista titulo="Permanencia"
                                                        texto="Cuánto estuvo adentro este vehículo, desde su propia entrada hasta esta salida.">
                                                        <span className="inline-flex items-center gap-1 text-[11px] text-sky-300/85 tabular-nums">
                                                            <Clock className="w-3 h-3 opacity-70" /> {lapso(f.permanencia)}
                                                        </span>
                                                    </Pista>
                                                )}
                                                {f.plate && merodeo?.has(f.plate) && (
                                                    <Pista titulo="Merodeo"
                                                        texto="Esta matrícula aparece muchas veces en poco tiempo sin llegar a entrar. Es una señal para mirar, no una conclusión.">
                                                        <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-rose-300">
                                                            <ShieldAlert className="w-3 h-3" /> Merodeo
                                                        </span>
                                                    </Pista>
                                                )}
                                                {f.permanencia == null && !(f.plate && merodeo?.has(f.plate)) && (
                                                    <span className="text-muted-foreground/40 text-xs">—</span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="px-5 py-3 text-right">
                                            {f.raw && (
                                                <EventDetailsDialog event={f.raw}>
                                                    <button onClick={(e) => e.stopPropagation()}
                                                        title="Ficha completa del acceso"
                                                        className="inline-flex mr-1.5 w-7 h-7 rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent items-center justify-center align-middle transition-colors">
                                                        <MoreHorizontal className="w-3.5 h-3.5" />
                                                    </button>
                                                </EventDetailsDialog>
                                            )}
                                            {f.foto ? (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src={f.foto} alt={f.plate || ""}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setViendo({ foto: f.foto!, plate: f.plate || "—", camara: f.camara, momento: f.momento, confianza: f.confianza });
                                                    }}
                                                    className="h-12 w-20 object-cover rounded border border-border/50 ml-auto hover:border-violet-400/60 transition-colors" />
                                            ) : !f.raw ? <span className="text-muted-foreground text-xs">—</span> : null}
                                        </td>
                                    </motion.tr>

                                    <AnimatePresence initial={false}>
                                        {abierto && f.plate && (
                                            <tr key={f.id + "_flujo"}>
                                                <td colSpan={7} className="p-0">
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: "auto", opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                                                        className="overflow-hidden border-b border-border/30 bg-background/40">
                                                        <FlujoMatricula
                                                            plate={f.plate}
                                                            at={f.momento}
                                                            onVerFoto={(p: PasoFlujo) => p.foto && setViendo({
                                                                foto: p.foto, plate: f.plate!, camara: p.camara, momento: p.momento, confianza: p.confianza,
                                                            })}
                                                        />
                                                    </motion.div>
                                                </td>
                                            </tr>
                                        )}
                                    </AnimatePresence>
                                </>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {(hay || (cargando && filas.length > 0)) && (
                <div className="p-3 border-t border-border/50 flex justify-center">
                    <button onClick={() => setPagina((p) => p + 1)} disabled={cargando}
                        className="h-8 px-4 rounded-lg border border-border text-[12px] font-bold flex items-center gap-1.5 hover:bg-accent disabled:opacity-50 transition-colors">
                        {cargando ? <><Loader2 size={13} className="animate-spin" /> Cargando…</> : <><RouteIco size={13} /> Ver más</>}
                    </button>
                </div>
            )}

            {viendo && (
                <VisorCuadro
                    fila={{
                        plate: viendo.plate,
                        cameraName: viendo.camara,
                        timestamp: viendo.momento,
                        confidence: viendo.confianza,
                        snapshotUrl: viendo.foto,
                    }}
                    onCerrar={() => setViendo(null)}
                />
            )}
        </div>
    );
}
