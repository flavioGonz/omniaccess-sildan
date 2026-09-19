"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Clock, Car, Camera, Activity, ChevronRight, Inbox,
    LogIn, LogOut, ParkingCircle, ShieldCheck, ShieldX,
    ShieldAlert, MoreHorizontal, Wifi, WifiOff,
} from "lucide-react";
import { EventDetailsDialog } from "@/components/dashboard/EventDetailsDialog";
import { cn } from "@/lib/utils";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Momento, Matricula, Miniatura, Nada } from "@/components/ui/celdas";
import { useTiempoReal, useDestello } from "@/lib/tiempo-real";
import { VisorCuadro } from "@/components/VisorCuadro";
import { FlujoMatricula, type PasoFlujo } from "@/components/history/FlujoMatricula";
import { parseVehicleMeta } from "@/lib/vehicle-details";

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
        Ico: LogIn, rotulo: "Entrada", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30", punto: "bg-emerald-400",
        ayuda: "Una cámara LPR de entrada leyó la matrícula y el sistema decidió si abría la barrera.",
    },
    ACCESO_EXIT: {
        Ico: LogOut, rotulo: "Salida", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", punto: "bg-amber-400",
        ayuda: "Una cámara LPR de salida leyó la matrícula y el sistema decidió si abría la barrera.",
    },
    PASO: {
        Ico: Camera, rotulo: "Avistamiento", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30", punto: "bg-violet-400",
        ayuda: "Una cámara interior vio pasar el vehículo. No abre barrera: sólo deja constancia de por dónde pasó.",
    },
    ESTACIONADO: {
        Ico: ParkingCircle, rotulo: "Estacionado", chip: "bg-slate-500/20 text-slate-700 dark:text-slate-200 border-slate-400/30", punto: "bg-slate-400",
        ayuda: "El vehículo se quedó quieto en el mismo lugar del cuadro. Es UNA fila por estadía, con su intervalo, no una fila por relectura.",
    },
};

export const rasgoDe = (f: { tipo: string; sentido: string | null }) =>
    f.tipo === "ACCESO" ? RASGOS[f.sentido === "EXIT" ? "ACCESO_EXIT" : "ACCESO_ENTRY"] : RASGOS[f.tipo];

/** Un evento del socket, con la forma que usa esta tabla. */
function desdeEvento(ev: any): FilaHistorial | null {
    const plate = (ev?.plateDetected || "").toUpperCase();
    if (!ev?.id || !ev?.timestamp) return null;
    return {
        id: ev.id,
        tipo: "ACCESO",
        momento: ev.timestamp,
        plate: plate || null,
        persona: ev.user?.name || null,
        camara: ev.device?.name || null,
        deviceId: ev.device?.id || ev.deviceId || null,
        decision: ev.decision || null,
        sentido: ev.direction || null,
        confianza: null,
        lecturas: null,
        foto: ev.snapshotPath || ev.imagePath || null,
        estDesde: null, estHasta: null, detalles: ev.details || null, permanencia: null,
        raw: ev,
    };
}

export function TablaUnificada({ buscar, desde, hasta, tipos, merodeo, color, tipoVeh, onMerodeo, onResumen }: {
    buscar: string; desde: string; hasta: string; tipos: string[];
    /** Matrículas marcadas por merodeo; si viene vacío no se filtra. */
    merodeo?: Set<string>;
    /** Color y tipo de vehículo, sacados de los detalles de cada registro. */
    color?: string;
    tipoVeh?: string;
    onMerodeo?: (chapas: Set<string>) => void;
    /**
     * Lo que se puede decir de lo que está cargado: cuántos permitidos, cuántos denegados,
     * y qué colores y tipos de vehículo aparecen.
     *
     * Sale de la tabla y no de la página a propósito. La página calculaba estos números de
     * OTRA consulta — la vieja, la que ya no alimenta nada — así que los selectores
     * ofrecían colores que no estaban en pantalla y los contadores hablaban de un conjunto
     * distinto del que se estaba mirando. Un filtro tiene que ofrecer lo que hay.
     */
    onResumen?: (r: { grant: number; deny: number; colores: string[]; tipos: string[] }) => void;
}) {
    const [filas, setFilas] = useState<FilaHistorial[]>([]);
    const [hay, setHay] = useState(false);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pagina, setPagina] = useState(0);
    const [abierta, setAbierta] = useState<string | null>(null);
    const [viendo, setViendo] = useState<{ foto: string; plate: string; camara: string | null; momento: string; confianza: number | null } | null>(null);
    const clave = useRef("");
    const [recargar, setRecargar] = useState(0);
    const { marcar, es: esNueva } = useDestello();

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
            .then(async (r) => {
                if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`);
                return r.json();
            })
            .then((j) => {
                if (!vivo || clave.current !== esta) return;
                setError(null);
                setFilas((prev) => (pagina === 0 ? (j.filas || []) : [...prev, ...(j.filas || [])]));
                setHay(!!j.hay);
            })
            .catch((e) => {
                if (!vivo || clave.current !== esta) return;
                // Antes esto era un catch vacío: un servidor caído y un período sin
                // registros se veían exactamente igual, y de uno se espera mientras que
                // del otro se reintenta.
                setError(e?.message || "No hubo respuesta.");
                if (pagina === 0) setFilas([]);
            })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [buscar, desde, hasta, tipos, pagina, recargar]);

    /**
     * En vivo.
     *
     * La página ya abría un socket, pero lo que escuchaba iba a un estado que dejó de
     * alimentar la tabla cuando se unificó: el historial no se enteraba de un acceso nuevo
     * hasta recargar, y nadie lo notaba porque el socket "estaba puesto".
     *
     * La fila nueva se mete arriba SOLO si pasa los filtros que el operador eligió. Meterla
     * igual sería pasar por encima de lo que pidió, y encima de la peor manera: apareciendo
     * sola en una lista que estaba filtrada.
     */
    const { conectado } = useTiempoReal("access_event", useCallback((ev: any) => {
        if (pagina !== 0) return;
        if (ev?.accessType && ev.accessType !== "PLATE") return;
        if (tipos.length && !tipos.includes("ACCESO")) return;
        // Un evento es de ahora: sólo entra si el rango llega hasta hoy.
        if (hasta && new Date(hasta) < new Date(new Date().toDateString())) return;
        const f = desdeEvento(ev);
        if (!f) return;
        if (buscar) {
            const q = buscar.toLowerCase();
            const pega = [f.plate, f.persona, f.camara].some((v) => (v || "").toLowerCase().includes(q));
            if (!pega) return;
        }
        setFilas((prev) => (prev.some((x) => x.id === f.id) ? prev : [f, ...prev]));
        marcar(f.id);
    }, [pagina, tipos, hasta, buscar, marcar]));

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

    /**
     * El resumen de lo cargado, para los contadores y para los selectores de color y tipo.
     * Se emite sólo cuando cambia de verdad: el padre lo guarda en estado, y un objeto
     * nuevo en cada render sería un ciclo padre↔hijo.
     */
    const firma = useRef("");
    useEffect(() => {
        if (!onResumen) return;
        let grant = 0, deny = 0;
        const colores = new Set<string>(), tiposVeh = new Set<string>();
        for (const f of filas) {
            if (f.tipo === "ACCESO") (f.decision === "DENY" ? deny++ : grant++);
            const m = parseVehicleMeta(f.detalles);
            if (m.color) colores.add(m.color);
            if (m.typeLabel) tiposVeh.add(m.typeLabel);
        }
        const r = { grant, deny, colores: [...colores].sort(), tipos: [...tiposVeh].sort() };
        const nueva = JSON.stringify(r);
        if (nueva === firma.current) return;
        firma.current = nueva;
        onResumen(r);
    }, [filas, onResumen]);

    /**
     * Color y tipo se filtran acá, sobre lo cargado.
     *
     * Estos dos selectores existían en la pantalla, se veían, se podían cambiar, mostraban
     * su chip de "quitar filtro"... y no filtraban nada: el arreglo que filtraban dejó de
     * alimentar la tabla cuando se unificó el historial. Un control que no hace nada es
     * peor que no tenerlo, porque el operador cree que ya descartó lo que no buscaba.
     */
    const visibles = useMemo(() => {
        let v = merodeo && merodeo.size ? filas.filter((f) => f.plate && merodeo.has(f.plate)) : filas;
        const porColor = color && color !== "ALL";
        const porTipo = tipoVeh && tipoVeh !== "ALL";
        if (porColor || porTipo) {
            v = v.filter((f) => {
                const m = parseVehicleMeta(f.detalles);
                if (porColor && m.color !== color) return false;
                if (porTipo && m.typeLabel !== tipoVeh) return false;
                return true;
            });
        }
        return v;
    }, [filas, merodeo, color, tipoVeh]);

    const columnas = useMemo<ColumnaTabla<FilaHistorial>[]>(() => [
        {
            clave: "momento", titulo: "Momento", icono: Clock, ancho: 140, ordenable: true,
            tituloAyuda: "Cuándo",
            ayuda: "El momento del evento, no el de su registro. En una estadía es el intervalo completo: desde que el vehículo se detuvo hasta la última vez que se lo vio ahí.",
            valor: (f) => f.momento,
            celda: (f) => (
                f.tipo === "ESTACIONADO" && f.estDesde ? (
                    <div className="leading-tight">
                        <div className="text-[13px] font-semibold tabular-nums text-foreground">
                            {new Date(f.momento).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground tabular-nums">
                            desde {new Date(f.estDesde).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}
                            {" · "}{new Date(f.momento).toLocaleDateString("es-UY", { day: "2-digit", month: "short" })}
                        </div>
                    </div>
                ) : <Momento t={f.momento} />
            ),
        },
        {
            clave: "cuadro", titulo: "Cuadro", icono: Camera, ancho: 110, auxiliar: true,
            tituloAyuda: "El cuadro guardado",
            /* El cuadro va segundo, pegado al momento: estaba último, al final de una fila
               ancha, y la foto es lo primero que alguien mira para saber si una lectura es
               la que busca. */
            ayuda: "La foto del momento: hacé clic para verla grande y acercarla, que es como se juzga una matrícula chica.",
            celda: (f) => (
                <Miniatura src={f.foto} alt={f.plate || ""}
                    alAbrir={f.foto ? () => setViendo({ foto: f.foto!, plate: f.plate || "—", camara: f.camara, momento: f.momento, confianza: f.confianza }) : undefined} />
            ),
        },
        {
            clave: "tipo", titulo: "Tipo", icono: Activity, ancho: 190, ordenable: true,
            tituloAyuda: "Qué clase de registro es",
            ayuda: "Entrada y salida las decide una cámara LPR y abren barrera. Un avistamiento lo hace una cámara interior y sólo deja constancia. Estacionado es un vehículo quieto dentro del encuadre.",
            valor: (f) => rasgoDe(f)?.rotulo,
            celda: (f) => {
                const r = rasgoDe(f);
                const estadia = f.tipo === "ESTACIONADO" && f.estDesde
                    ? lapso((new Date(f.estHasta || f.momento).getTime() - new Date(f.estDesde).getTime()) / 1000)
                    : null;
                return (
                    <Pista titulo={r.rotulo} texto={r.ayuda}>
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-bold", r.chip)}>
                            <r.Ico className="w-3 h-3" />
                            {r.rotulo}
                            {estadia && <span className="font-semibold opacity-80">· {estadia}</span>}
                        </span>
                    </Pista>
                );
            },
        },
        {
            clave: "identificacion", titulo: "Identificación", icono: Car, ordenable: true,
            tituloAyuda: "Matrícula o persona",
            ayuda: "Lo que identificó el sistema. Hacé clic en la fila para ver el flujo completo de esa matrícula: por qué cámaras pasó y cuánto tardó entre una y otra.",
            valor: (f) => f.plate || f.persona,
            celda: (f) => (
                <div className="flex items-center gap-2">
                    {f.plate ? <Matricula p={f.plate} /> : <span className="text-[13px] text-muted-foreground">{f.persona || "—"}</span>}
                    {f.plate && f.persona && <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">{f.persona}</span>}
                    {f.plate && (
                        <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground/45 shrink-0 transition-transform", abierta === f.id && "rotate-90")} />
                    )}
                </div>
            ),
        },
        {
            clave: "camara", titulo: "Cámara", icono: Camera, ordenable: true,
            tituloAyuda: "Qué equipo lo registró",
            ayuda: "La cámara o el dispositivo de acceso que generó el registro.",
            valor: (f) => f.camara,
            celda: (f) => f.camara ? <span className="text-[13px]">{f.camara}</span> : <Nada />,
        },
        {
            clave: "resultado", titulo: "Resultado", icono: ShieldCheck, ancho: 150,
            tituloAyuda: "Cómo salió",
            ayuda: "En un acceso, si se permitió o se denegó. En un avistamiento, qué tan segura fue la lectura: verde arriba de 85%, ámbar entre 65 y 85, rojo debajo.",
            valor: (f) => f.tipo === "ACCESO"
                ? (f.decision === "DENY" ? "Denegado" : "Permitido")
                : (f.confianza != null ? `${Math.round(f.confianza * 100)}%` : ""),
            celda: (f) => {
                if (f.tipo === "ACCESO") {
                    return f.decision === "DENY" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 dark:text-rose-400"><ShieldX className="w-3.5 h-3.5" /> Denegado</span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><ShieldCheck className="w-3.5 h-3.5" /> Permitido</span>
                    );
                }
                const conf = f.confianza != null ? Math.round(f.confianza * 100) : null;
                if (conf == null) return <Nada />;
                return (
                    <span className={cn("text-xs font-semibold tabular-nums",
                        conf >= 85 ? "text-emerald-600 dark:text-emerald-400" : conf >= 65 ? "text-amber-600 dark:text-amber-400" : "text-rose-500 dark:text-red-400")}>
                        {conf}%
                        {f.lecturas != null && <span className="text-muted-foreground/60 font-normal"> · {f.lecturas} cuadros</span>}
                    </span>
                );
            },
        },
        {
            clave: "senales", titulo: "Señales", icono: ShieldAlert, ancho: 140,
            tituloAyuda: "Señales y permanencia",
            ayuda: "Permanencia es cuánto estuvo adentro el vehículo, y sale solo en las salidas. Merodeo marca una matrícula que aparece muchas veces en poco tiempo sin llegar a entrar.",
            valor: (f) => [
                f.permanencia != null ? lapso(f.permanencia) : null,
                f.plate && merodeo?.has(f.plate) ? "Merodeo" : null,
            ].filter(Boolean).join(" · "),
            celda: (f) => {
                const merodea = !!(f.plate && merodeo?.has(f.plate));
                if (f.permanencia == null && !merodea) return <Nada />;
                return (
                    <div className="flex flex-col gap-0.5">
                        {f.permanencia != null && (
                            <Pista titulo="Permanencia" texto="Cuánto estuvo adentro este vehículo, desde su propia entrada hasta esta salida.">
                                <span className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-300/85 tabular-nums">
                                    <Clock className="w-3 h-3 opacity-70" /> {lapso(f.permanencia)}
                                </span>
                            </Pista>
                        )}
                        {merodea && (
                            <Pista titulo="Merodeo" texto="Esta matrícula aparece muchas veces en poco tiempo sin llegar a entrar. Es una señal para mirar, no una conclusión.">
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-rose-500 dark:text-rose-300">
                                    <ShieldAlert className="w-3 h-3" /> Merodeo
                                </span>
                            </Pista>
                        )}
                    </div>
                );
            },
        },
        {
            clave: "ficha", titulo: "Ficha", icono: MoreHorizontal, alinear: "der", ancho: 80, auxiliar: true,
            tituloAyuda: "La ficha completa",
            ayuda: "En los accesos, abre el detalle: fotos, datos del vehículo, permisos y por qué se decidió lo que se decidió.",
            celda: (f) => f.raw ? (
                <EventDetailsDialog event={f.raw}>
                    <button onClick={(e) => e.stopPropagation()} title="Ficha completa del acceso"
                        className="inline-flex w-7 h-7 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent items-center justify-center transition-colors">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                </EventDetailsDialog>
            ) : <Nada />,
        },
    ], [abierta, merodeo]);

    return (
        <>
            <Tabla<FilaHistorial>
                filas={visibles}
                clave={(f) => f.id}
                columnas={columnas}
                cargando={cargando}
                error={error}
                alReintentar={() => { setError(null); setRecargar((n) => n + 1); }}
                vacio={{ icono: Inbox, titulo: "Nada en este período", ayuda: "Probá ampliar el rango de fechas, o quitar algún filtro de tipo." }}
                alClickFila={alternar}
                filaActiva={(f) => abierta === f.id}
                filaDestacada={(f) => esNueva(f.id)}
                expandir={(f) => (abierta === f.id && f.plate) ? (
                    <FlujoMatricula
                        plate={f.plate}
                        at={f.momento}
                        onVerFoto={(p: PasoFlujo) => p.foto && setViendo({
                            foto: p.foto, plate: f.plate!, camara: p.camara, momento: p.momento, confianza: p.confianza,
                        })}
                    />
                ) : null}
                masFilas={{ hay, cargando, traer: () => setPagina((p) => p + 1), modo: "boton" }}
                alto="calc(100vh - 300px)"
                pie={
                    <span className="flex items-center gap-1.5">
                        {conectado
                            ? <><Wifi size={11} className="text-emerald-500" /> En vivo</>
                            : <><WifiOff size={11} className="text-muted-foreground/60" /> Sin conexión en vivo</>}
                        <span className="opacity-50">·</span>
                        <span className="tabular-nums">{visibles.length} registros</span>
                    </span>
                }
            />

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
        </>
    );
}
