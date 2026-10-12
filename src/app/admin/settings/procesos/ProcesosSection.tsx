"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, CalendarClock, Cpu, Database, HardDrive, HelpCircle, MemoryStick, Pause, Play, RotateCcw, Server, Timer } from "lucide-react";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Momento } from "@/components/ui/celdas";
import { cn } from "@/lib/utils";
import { estadoProcesos, vivoServicios, type ServicioFila, type TareaFila, type TipoServicio } from "@/app/actions/procesos";
import { CajonServicio, CajonTarea, duracion, megas } from "./CajonesProcesos";
import { CADA_VIVO_MS, Linea, Pulso, tiempoArriba, useHistorias, useSegundero } from "./vivo";

/**
 * Ajustes → Procesos y tareas: lo que corre de fondo en ESTE servidor, en vivo.
 *
 * ── QUÉ ESTABA MAL ─────────────────────────────────────────────────────────────────
 * - Mostraba PM2 y Docker, y nada de lo de abajo: la base, Redis, el almacenamiento, el video y
 *   el propio Docker no aparecían, así que «todo en línea» podía decirse con la base caída.
 * - De los contenedores no había arranque, reinicios, salud ni consumo («Up 7 hours»).
 * - Los procesos nuevos (OmniVision, Entrenador) salían con su nombre técnico y sin explicar.
 * - Se refrescaba cada 10 s: entre dos vueltas, un proceso podía caerse y volver sin que se viera.
 * - La cola de envíos y la auditoría vivían acá; ahora son secciones propias (Sistema).
 *
 * ── CÓMO QUEDA ─────────────────────────────────────────────────────────────────────
 * Los servicios se piden cada CADA_VIVO_MS y se dibujan como tarjetas por capa (Aplicación,
 * Contenedores, Sistema), cada una con su tiempo arriba corriendo y la línea de CPU y memoria de
 * los últimos minutos. Las tareas programadas (que cambian de a minutos) se piden cada 15 s.
 */

type Estado_ = Awaited<ReturnType<typeof estadoProcesos>>;
/** Las tareas programadas corren de a minutos: no hace falta pedirlas más seguido. */
const CADA_TAREAS_MS = 15_000;

const CAPAS: { tipo: TipoServicio; titulo: string; ayuda: string; icono: React.ComponentType<{ size?: number; className?: string }> }[] = [
    { tipo: "pm2", titulo: "Aplicación", icono: Cpu, ayuda: "Los procesos de OmniAccess, manejados por PM2: si uno se cae, PM2 lo levanta y el vigía avisa." },
    { tipo: "docker", titulo: "Contenedores", icono: Box, ayuda: "El lector de matrículas, OmniVision, WhatsApp y los entrenamientos en curso, en Docker." },
    { tipo: "sistema", titulo: "Sistema", icono: HardDrive, ayuda: "Lo que todo lo demás necesita: base de datos, Redis, almacenamiento, video y Docker. Se miran desde acá; se reinician desde la consola." },
];

export default function ProcesosSection() {
    const [d, setD] = useState<Estado_ | null>(null);
    const [servicios, setServicios] = useState<ServicioFila[] | null>(null);
    const [avisos, setAvisos] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [ultimo, setUltimo] = useState<number | null>(null);
    const [enPausa, setEnPausa] = useState(false);
    const [servicio, setServicio] = useState<string | null>(null);
    const [tarea, setTarea] = useState<string | null>(null);
    const ahora = useSegundero();
    const historia = useHistorias();
    const pidiendo = useRef(false);

    const vivo = useCallback(async () => {
        if (pidiendo.current) return;
        pidiendo.current = true;
        try {
            const r = await vivoServicios();
            for (const s of r.servicios) { historia.sumar(`${s.nombre}:cpu`, s.cpu); historia.sumar(`${s.nombre}:mem`, s.memoria != null ? s.memoria / 1048576 : null); }
            setServicios(r.servicios); setAvisos(r.avisos); setUltimo(Date.now()); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer el estado de los servicios."); }
        finally { pidiendo.current = false; }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const tareas = useCallback(async () => {
        try { setD(await estadoProcesos()); } catch (e: any) { setError(e?.message || "No se pudieron leer las tareas."); }
    }, []);

    useEffect(() => { vivo(); tareas(); }, [vivo, tareas]);
    useEffect(() => {
        if (enPausa) return;
        const a = setInterval(() => { if (document.visibilityState === "visible") vivo(); }, CADA_VIVO_MS);
        const b = setInterval(() => { if (document.visibilityState === "visible") tareas(); }, CADA_TAREAS_MS);
        return () => { clearInterval(a); clearInterval(b); };
    }, [enPausa, vivo, tareas]);

    const lista = servicios || [];
    const caidos = lista.filter((s) => !s.vivo);
    const memTotal = lista.reduce((a, s) => a + (s.vivo ? s.memoria || 0 : 0), 0);
    const cpuTotal = lista.reduce((a, s) => a + (s.vivo ? s.cpu || 0 : 0), 0);
    const conFallas = d?.tareas.filter((t) => t.fallas24 > 0).length || 0;
    const atrasado = ultimo != null && ahora - ultimo > CADA_VIVO_MS * 4;
    const servicioAbierto = lista.find((s) => s.nombre === servicio) || null;
    const tareaAbierta = d?.tareas.find((t) => t.clave === tarea) || null;

    const colTareas = useMemo<ColumnaTabla<TareaFila>[]>(() => [
        {
            clave: "tarea", titulo: "Tarea", ancho: 300, ordenable: true, valor: (t) => t.nombre,
            celda: (t) => (
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{t.nombre}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{t.enUnaFrase}{t.ruta ? ` · ${t.ruta}` : ""}</div>
                </div>
            ),
        },
        {
            clave: "estado", titulo: "Estado", ancho: 110, ordenable: true, valor: (t) => (t.pausada ? "0" : "1"),
            celda: (t) => !t.conocida ? <Estado tono="neutro">Del sistema</Estado> : t.pausada ? <Estado tono="aviso" icono={Pause}>Pausada</Estado> : <Estado tono="bien">Activa</Estado>,
        },
        {
            clave: "ultima", titulo: "Última", ancho: 130, ordenable: true, valor: (t) => t.ultima?.inicio || "",
            celda: (t) => t.ultima ? (
                <span className="flex items-center gap-2">
                    <Pulso activo={false} tono={t.ultima.ok === false ? "mal" : "bien"} />
                    <Momento t={t.ultima.inicio} />
                </span>
            ) : <span className="text-[12px] text-muted-foreground">{t.conocida ? "Sin registro aún" : "—"}</span>,
        },
        {
            clave: "dia", titulo: "En 24 h", ancho: 130, alinear: "der", ordenable: true, valor: (t) => String(t.corridas24).padStart(6, "0"),
            tituloAyuda: "Corridas y fallas del último día", ayuda: "Una tarea de cada minuto debería sumar unas 1.440. Muchas menos: el cron no la está llamando o estuvo pausada.",
            celda: (t) => !t.conocida ? null : (
                <span className="text-[12.5px] tabular-nums">{t.corridas24}{t.fallas24 > 0 && <span className="tono-mal font-semibold"> · {t.fallas24} fallas</span>}</span>
            ),
        },
        { clave: "dura", titulo: "Tarda", ancho: 80, alinear: "der", celda: (t) => <span className="text-[12.5px] tabular-nums">{duracion(t.msPromedio)}</span> },
    ], []);

    return (
        <div className="space-y-6">
            {/* ── Encabezado: qué es y si los datos llegan ── */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-[17px] font-bold">Procesos y tareas</h2>
                    <p className="text-[12.5px] text-muted-foreground max-w-2xl">Lo que corre en este servidor ahora mismo. Tocá un servicio para ver su registro en vivo o reiniciarlo.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Pista titulo={enPausa ? "En pausa" : "En vivo"} texto={enPausa ? "Los datos no se piden. Tocá para seguir." : `Se pide el estado cada ${CADA_VIVO_MS / 1000} s mientras la pestaña está a la vista; el tiempo arriba corre de a un segundo.`}>
                        <button type="button" onClick={() => setEnPausa((v) => !v)} aria-pressed={!enPausa}
                            className="h-8 pl-2.5 pr-3 rounded-full border border-border text-[12px] font-semibold flex items-center gap-2 hover:bg-accent tabular-nums">
                            <Pulso activo={!enPausa && !atrasado && !error} tono={error || atrasado ? "mal" : enPausa ? "quieto" : "bien"} />
                            {enPausa ? "En pausa" : error ? "Sin respuesta" : atrasado ? "Atrasado" : "En vivo"}
                            {enPausa ? <Play size={12} /> : <Pause size={12} className="text-muted-foreground" />}
                        </button>
                    </Pista>
                </div>
            </div>

            {/* ── El resumen: cuatro números ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <Resumen icono={Server} rotulo="Servicios" pista="Todo lo que corre: procesos de la app, contenedores y servicios del sistema."
                    valor={servicios ? <>{lista.length - caidos.length}<span className="text-muted-foreground font-semibold">/{lista.length}</span></> : "—"}
                    estado={!servicios ? null : caidos.length ? <Estado tono="mal">{caidos.length} caído{caidos.length === 1 ? "" : "s"}</Estado> : <Estado tono="bien">En línea</Estado>} />
                <Resumen icono={Cpu} rotulo="CPU" pista="La suma del CPU de todos los servicios. 100 % es un núcleo entero."
                    valor={servicios ? `${Math.round(cpuTotal)} %` : "—"} linea={historia.de("total:cpu")} />
                <Resumen icono={MemoryStick} rotulo="Memoria" pista="La suma de la memoria de todos los servicios en línea."
                    valor={servicios ? megas(memTotal) : "—"} linea={historia.de("total:mem")} />
                <Resumen icono={CalendarClock} rotulo="Tareas programadas" pista="Las que el cron corre solo. Con fallas en las últimas 24 h se marcan."
                    valor={d ? d.tareas.length : "—"}
                    estado={!d ? null : conFallas ? <Estado tono="aviso">{conFallas} con fallas</Estado> : <Estado tono="bien">Sin fallas</Estado>} />
            </div>
            <Totales servicios={servicios} sumar={historia.sumar} />

            {(avisos.length > 0 || (error && servicios)) && (
                <div className="rounded-[10px] border chip-aviso px-4 py-3 text-[12.5px] space-y-1">
                    <p className="font-semibold flex items-center gap-2"><AlertTriangle size={14} /> Hay partes que no se pudieron leer</p>
                    {[...avisos, ...(error ? [error] : [])].map((a) => <p key={a} className="text-foreground/80 break-all">{a}</p>)}
                </div>
            )}

            {/* ── Los servicios, por capa ── */}
            {!servicios && error ? (
                <div className="rounded-[10px] border border-border px-4 py-8 text-center text-[13px]">
                    <p className="tono-mal font-semibold">{error}</p>
                    <button onClick={vivo} className="mt-2 tono-accion font-semibold text-[12.5px]">Reintentar</button>
                </div>
            ) : CAPAS.map((capa) => {
                const deCapa = lista.filter((s) => s.tipo === capa.tipo);
                if (servicios && !deCapa.length) return null;
                const Ic = capa.icono;
                return (
                    <section key={capa.tipo} className="space-y-2.5">
                        <div className="flex items-center gap-2">
                            <Ic size={14} className="text-muted-foreground" />
                            <h3 className="text-[13px] font-bold">{capa.titulo}</h3>
                            <span className="text-[12px] text-muted-foreground tabular-nums">{deCapa.filter((s) => s.vivo).length}/{deCapa.length || "…"}</span>
                            <Pista titulo={capa.titulo} texto={capa.ayuda} ancho={300}><HelpCircle size={12.5} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" /></Pista>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                            {!servicios ? Array.from({ length: capa.tipo === "pm2" ? 6 : 3 }).map((_, i) => <div key={i} className="h-[92px] rounded-[10px] border border-border bg-muted/30 animate-pulse" />)
                                : deCapa.map((s) => (
                                    <TarjetaServicio key={`${s.tipo}:${s.nombre}`} s={s} ahora={ahora} cpu={historia.de(`${s.nombre}:cpu`)} mem={historia.de(`${s.nombre}:mem`)}
                                        onClick={() => setServicio(s.nombre)} />
                                ))}
                        </div>
                    </section>
                );
            })}

            {/* ── Tareas programadas ── */}
            <section className="space-y-2.5">
                <div className="flex items-center gap-2">
                    <CalendarClock size={14} className="text-muted-foreground" />
                    <h3 className="text-[13px] font-bold">Tareas programadas</h3>
                    <Pista titulo="Tareas programadas" texto="Lo que el cron del servidor corre solo. Cada corrida queda registrada; las de OmniAccess se pueden pausar y correr a mano." ancho={300}>
                        <HelpCircle size={12.5} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" />
                    </Pista>
                </div>
                <Tabla<TareaFila> id="procesos-tareas" filas={d?.tareas || []} clave={(t) => t.clave} columnas={colTareas}
                    cargando={!d && !error} error={!d ? error : null} alReintentar={tareas} alClickFila={(t) => setTarea(t.clave)}
                    vacio={{ icono: CalendarClock, titulo: "El cron está vacío", ayuda: "No hay tareas programadas en este servidor: las de OmniAccess (salud de equipos, visitas, filas) no van a correr." }} filasFantasma={3} controles={false} />
            </section>

            <CajonServicio servicio={servicioAbierto} ahora={ahora} cpu={servicioAbierto ? historia.de(`${servicioAbierto.nombre}:cpu`) : []}
                mem={servicioAbierto ? historia.de(`${servicioAbierto.nombre}:mem`) : []} alCerrar={() => setServicio(null)} alCambiar={vivo} />
            <CajonTarea tarea={tareaAbierta} alCerrar={() => setTarea(null)} alCambiar={tareas} />
        </div>
    );
}

/** Suma los totales a la historia cada vez que llegan servicios nuevos (efecto, no en el render). */
function Totales({ servicios, sumar }: { servicios: ServicioFila[] | null; sumar: (k: string, v: number | null) => void }) {
    useEffect(() => {
        if (!servicios) return;
        sumar("total:cpu", servicios.reduce((a, s) => a + (s.vivo ? s.cpu || 0 : 0), 0));
        sumar("total:mem", servicios.reduce((a, s) => a + (s.vivo ? s.memoria || 0 : 0), 0) / 1048576);
    }, [servicios]); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function Resumen({ icono: Ic, rotulo, valor, pista, estado, linea }: {
    icono: React.ComponentType<{ size?: number; className?: string }>; rotulo: string; valor: React.ReactNode; pista: string; estado?: React.ReactNode; linea?: number[];
}) {
    return (
        <div className="rounded-[10px] border border-border bg-card px-3.5 py-3 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Ic size={12.5} /> {rotulo}
                <Pista titulo={rotulo} texto={pista} ancho={260}><HelpCircle size={11.5} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" /></Pista>
            </div>
            <div className="mt-1.5 flex items-end justify-between gap-2">
                <span className="text-[22px] font-bold tabular-nums leading-none tracking-[-0.02em]">{valor}</span>
                {estado}
                {linea && <Linea datos={linea} ancho={110} alto={26} className="tono-accion shrink-0" />}
            </div>
        </div>
    );
}

const ICONO_TIPO: Record<TipoServicio, React.ComponentType<{ size?: number; className?: string }>> = { pm2: Cpu, docker: Box, sistema: Database };

/**
 * Un servicio: quién es, si está, cuánto lleva (corriendo de a un segundo) y cuánto consume, con
 * la línea de los últimos minutos. Un servicio caído no se esconde ni se va al fondo: se pinta de
 * su tono y se dice su estado tal como lo da quien lo maneja.
 */
function TarjetaServicio({ s, ahora, cpu, mem, onClick }: { s: ServicioFila; ahora: number; cpu: number[]; mem: number[]; onClick: () => void }) {
    const Ic = ICONO_TIPO[s.tipo];
    const enferma = s.salud === "unhealthy";
    return (
        <button type="button" onClick={onClick}
            className={cn("group text-left rounded-[10px] border bg-card px-3.5 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-foco)]",
                !s.vivo ? "border-[color-mix(in_oklab,var(--mal)_45%,transparent)]" : enferma ? "border-[color-mix(in_oklab,var(--aviso)_45%,transparent)]" : "border-border")}>
            <div className="flex items-start gap-2.5">
                <span className="w-8 h-8 rounded-[6px] bg-muted border border-border text-muted-foreground grid place-items-center shrink-0"><Ic size={15} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold truncate">{s.titulo}</span>
                        {s.salud && s.salud !== "healthy" && <Estado tono={enferma ? "aviso" : "neutro"}>{s.salud === "starting" ? "arrancando" : s.salud}</Estado>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{s.tipo === "pm2" ? "PM2" : s.tipo === "docker" ? "Docker" : "systemd"} · {s.nombre}</div>
                </div>
                <span className={cn("flex items-center gap-1.5 text-[11px] font-semibold shrink-0", s.vivo ? "tono-bien" : "tono-mal")}>
                    <Pulso activo={s.vivo} tono={s.vivo ? "bien" : "mal"} />
                    {s.vivo ? "En línea" : s.estado}
                </span>
            </div>
            <div className="mt-2.5 grid grid-cols-[1fr_auto_auto] items-end gap-3">
                <Pista titulo="Arriba hace" texto={s.vivo ? "Desde que arrancó por última vez. Si vuelve a cero solo, se está reiniciando." : "Está caído: no hay tiempo arriba."}>
                    <span className="block min-w-0">
                        <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground"><Timer size={11} /> Arriba
                            {s.reinicios ? <span className="ml-1 flex items-center gap-0.5"><RotateCcw size={10} />{s.reinicios}</span> : null}
                        </span>
                        <span className="block text-[13px] font-semibold tabular-nums truncate">{s.vivo ? tiempoArriba(s.desde, ahora) : "—"}</span>
                    </span>
                </Pista>
                <Pista titulo="CPU" texto="Lo que usa ahora (100 % = un núcleo entero) y su línea de los últimos minutos.">
                    <span className="block text-right">
                        <span className="block text-[10.5px] text-muted-foreground">CPU <b className="text-foreground tabular-nums font-semibold">{s.cpu == null ? "—" : `${s.cpu}%`}</b></span>
                        <Linea datos={cpu} ancho={64} alto={18} piso={5} className="tono-accion" />
                    </span>
                </Pista>
                <Pista titulo="Memoria" texto="La memoria que tiene tomada ahora y su línea de los últimos minutos.">
                    <span className="block text-right">
                        <span className="block text-[10.5px] text-muted-foreground">Mem <b className="text-foreground tabular-nums font-semibold">{megas(s.memoria)}</b></span>
                        <Linea datos={mem} ancho={64} alto={18} piso={50} className="text-muted-foreground" />
                    </span>
                </Pista>
            </div>
        </button>
    );
}
