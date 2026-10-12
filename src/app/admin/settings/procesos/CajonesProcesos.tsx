"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Box, HelpCircle, CalendarClock, Cpu, FileText, History, Info, Loader2, MemoryStick, Pause, Play, RefreshCw, RotateCcw, Server, Terminal, Timer } from "lucide-react";
import { Linea, Pulso, tiempoArriba } from "./vivo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { ConfirmarEnCajon } from "@/components/ui/cajon-confirmar";
import { Estado, Momento } from "@/components/ui/celdas";
import { toast } from "@/lib/avisos";
import { cn } from "@/lib/utils";
import { corridasDeTarea, ejecutarTarea, logsDeServicio, pausarTarea, reiniciarServicio, type ServicioFila, type TareaFila } from "@/app/actions/procesos";

/** Las opciones de cuántas líneas traer. Más de mil ya no se leen en una pantalla. */
const LINEAS = [100, 300, 1000];

export const haceCuanto = (iso: string | null) => {
    if (!iso) return "—";
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h ${m % 60} min`;
    return `${Math.floor(h / 24)} días`;
};
export const megas = (b: number | null) => (b == null ? "—" : `${Math.round(b / 1024 / 1024)} MB`);
export const duracion = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Un renglón de log que dice error o advertencia se pinta con su tono: se busca eso primero. */
const tonoDeLinea = (l: string) => /\b(error|err!|fatal|exception|✗|failed|falló|no se pudo)\b/i.test(l) ? "tono-mal"
    : /\b(warn|warning|aviso|advertencia)\b/i.test(l) ? "tono-aviso" : "";

function Dato({ rotulo, valor, pista }: { rotulo: string; valor: React.ReactNode; pista?: string }) {
    // La pista va en el rótulo y no envolviendo el recuadro: envuelto, el globo es un
    // `span` en línea y el recuadro se achica al ancho de su número.
    return (
        <div className="rounded-[10px] border border-border bg-card px-3 py-2.5 min-w-0">
            <p className="text-[15px] font-bold tabular-nums leading-tight truncate">{valor}</p>
            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                {rotulo}
                {pista && (
                    <Pista titulo={rotulo} texto={pista} ancho={260}>
                        <HelpCircle size={11.5} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" />
                    </Pista>
                )}
            </p>
        </div>
    );
}

// ───────────────────────────── Servicio ─────────────────────────────

/** Mientras «Seguir» está prendido, el registro se vuelve a pedir cada esto. */
const SEGUIR_LOG_MS = 2_000;

/**
 * El cajón de un servicio. Era de ancho «ancho» (el de una tabla) con cinco recuadros sueltos en
 * fila y el registro abajo de todo: la mitad de la pantalla para mostrar cinco números. Ahora es
 * angosto, en el orden en que se lee —cómo está, qué hace, qué pasa si se cae, su registro— y el
 * registro puede seguirse en vivo como un `tail -f`.
 */
export function CajonServicio({ servicio, ahora, cpu, mem, alCerrar, alCambiar }: {
    servicio: ServicioFila | null; ahora: number; cpu: number[]; mem: number[]; alCerrar: () => void; alCambiar: () => void;
}) {
    const s = servicio;
    const [cual, setCual] = useState<"salida" | "errores">("salida");
    const [lineas, setLineas] = useState(300);
    const [filtro, setFiltro] = useState("");
    const [seguir, setSeguir] = useState(true);
    const [log, setLog] = useState<{ lineas: string[]; archivo: string | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const caja = useRef<HTMLDivElement>(null);
    const alFondo = useRef(true);

    const traer = async () => {
        if (!s) return;
        setCargando(true);
        const r = await logsDeServicio(s.tipo, s.nombre, cual, lineas);
        setCargando(false);
        if (!r.ok) { setError(r.error); return; }
        setError(null);
        setLog({ lineas: r.lineas, archivo: r.archivo });
    };
    // Al final, que es donde está lo último — salvo que el operador haya subido a leer algo.
    useEffect(() => { if (caja.current && alFondo.current) caja.current.scrollTop = caja.current.scrollHeight; }, [log]);
    useEffect(() => { setLog(null); setFiltro(""); alFondo.current = true; if (s?.conLogs) traer(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [s?.nombre, cual, lineas]);
    useEffect(() => { setCual("salida"); setSeguir(true); }, [s?.nombre]);
    useEffect(() => {
        if (!s?.conLogs || !seguir) return;
        const i = setInterval(() => { if (document.visibilityState === "visible") traer(); }, SEGUIR_LOG_MS);
        return () => clearInterval(i);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [s?.nombre, cual, lineas, seguir]);

    const visibles = useMemo(() => {
        const q = filtro.trim().toLowerCase();
        return (log?.lineas || []).filter((l) => !q || l.toLowerCase().includes(q));
    }, [log, filtro]);
    const errores = useMemo(() => visibles.filter((l) => tonoDeLinea(l) === "tono-mal").length, [visibles]);
    const IconoTipo = s?.tipo === "pm2" ? Cpu : s?.tipo === "docker" ? Box : Server;

    return (
        <Cajon open={!!s} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            {s && (
                <CajonContenido ancho="intermedio" titulo={s.titulo}
                    descripcion={`${s.tipo === "pm2" ? "Proceso PM2" : s.tipo === "docker" ? "Contenedor Docker" : "Servicio del sistema"} · ${s.nombre}`}
                    pie={s.reiniciable ? (
                        <ConfirmarEnCajon
                            id={s.nombre}
                            title={`Reiniciar ${s.titulo}`}
                            description={s.siCae ? `Mientras arranca: ${s.siCae}` : "El servicio se detiene y vuelve a arrancar."}
                            pasos={[
                                s.tipo === "pm2" ? `PM2 detiene «${s.nombre}» y lo vuelve a levantar con la misma configuración.` : `Docker detiene el contenedor «${s.nombre}» y lo vuelve a arrancar.`,
                                "Suele tardar entre 2 y 20 segundos.",
                                ...(s.cortaElPanel ? ["Es el propio panel: esta página va a dejar de contestar unos segundos y vuelve sola."] : []),
                                "Queda anotado en la auditoría con tu nombre.",
                            ]}
                            siFalla="Si no arranca, queda con su estado en rojo y el motivo en el registro de errores. Se puede reintentar desde acá."
                            escribir="REINICIAR"
                            etiquetaAccion="Reiniciar"
                            onDelete={async () => {
                                const r = await reiniciarServicio(s.tipo, s.nombre);
                                if (r.ok) toast.success(r.mensaje);
                                return r.ok ? { success: true } : { success: false, error: r.error };
                            }}
                            onSuccess={() => { alCambiar(); if (s.conLogs) setTimeout(traer, 2500); }}
                            onFallo={alCambiar}>
                            <Button variant="outline" className="h-9 px-4 rounded-md text-[13px] font-semibold gap-1.5 tono-mal">
                                <RotateCcw size={14} /> Reiniciar
                            </Button>
                        </ConfirmarEnCajon>
                    ) : (
                        <p className="mr-auto text-[12px] text-muted-foreground flex items-center gap-1.5">
                            <Terminal size={13} /> Los servicios del sistema se reinician desde la consola del servidor.
                        </p>
                    )}>

                    {/* Cómo está, ahora. */}
                    <div className="px-6 pt-5 pb-4 border-b border-border space-y-3">
                        <div className="flex items-center gap-3">
                            <span className="w-10 h-10 rounded-[10px] bg-muted border border-border text-muted-foreground grid place-items-center shrink-0"><IconoTipo size={18} /></span>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <Estado tono={s.vivo ? "bien" : "mal"}>{s.vivo ? "En línea" : s.estado}</Estado>
                                    {s.salud && <Estado tono={s.salud === "healthy" ? "bien" : s.salud === "unhealthy" ? "aviso" : "neutro"}>{s.salud === "healthy" ? "Sano" : s.salud === "starting" ? "Arrancando" : s.salud}</Estado>}
                                </div>
                                <p className="mt-1 text-[12px] text-muted-foreground">{s.vivo ? <>Arriba hace <b className="text-foreground tabular-nums font-semibold">{tiempoArriba(s.desde, ahora)}</b></> : s.detalle}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <Medida icono={Activity} rotulo="CPU" valor={s.cpu == null ? "—" : `${s.cpu}%`} pista="Lo que usa ahora. 100 % es un núcleo entero. La línea son los últimos minutos.">
                                <Linea datos={cpu} ancho={120} alto={24} piso={5} className="tono-accion" />
                            </Medida>
                            <Medida icono={MemoryStick} rotulo="Memoria" valor={megas(s.memoria)} pista="La memoria que tiene tomada ahora. Si sube y no baja nunca, puede estar perdiendo memoria.">
                                <Linea datos={mem} ancho={120} alto={24} piso={50} className="text-muted-foreground" />
                            </Medida>
                            <Medida icono={RotateCcw} rotulo="Reinicios" valor={s.reinicios ?? "—"}
                                pista={s.tipo === "pm2" ? "Las veces que PM2 lo levantó de nuevo desde que se creó, a mano o porque se cayó. Si sube solo entre una visita y otra, se está cayendo." : s.tipo === "docker" ? "Las veces que Docker lo reinició solo (política unless-stopped)." : "Las veces que systemd lo reinició solo."}>
                                <span className="block h-6" />
                            </Medida>
                        </div>
                    </div>

                    {/* Qué es y qué pasa si se cae. */}
                    <div className="px-6 py-4 border-b border-border space-y-3">
                        <Renglon icono={Info} titulo="Qué hace">{s.queHace || "Sin descripción en el catálogo de OmniAccess."}</Renglon>
                        <Renglon icono={AlertTriangle} tono="tono-aviso" titulo="Si se cae">{s.siCae || "—"}</Renglon>
                        {s.origen && <Renglon icono={s.tipo === "pm2" ? FileText : s.tipo === "docker" ? Box : Server} titulo={s.tipo === "pm2" ? "Programa" : s.tipo === "docker" ? "Imagen" : "Unidad"}><span className="break-all tabular-nums">{s.origen}</span></Renglon>}
                        {s.internas.length > 0 && (
                            <Renglon icono={Timer} titulo="Lo que hace solo, cada tanto">
                                <span className="mt-1 grid grid-cols-1 gap-1">
                                    {s.internas.map((t) => (
                                        <span key={t.nombre} className="flex items-center justify-between gap-3">
                                            <span>{t.nombre}</span>
                                            <span className="text-muted-foreground tabular-nums shrink-0">cada {t.cada}</span>
                                        </span>
                                    ))}
                                </span>
                            </Renglon>
                        )}
                    </div>

                    {/* El registro, en vivo. */}
                    <div className="px-6 py-4 space-y-2.5">
                        <div className="flex items-center gap-2">
                            <FileText size={14} className="text-muted-foreground" />
                            <span className="text-[13px] font-bold">Registro</span>
                            {errores > 0 && <Estado tono="mal">{errores} con error</Estado>}
                            <Pista titulo={seguir ? "Siguiendo" : "Quieto"} texto={seguir ? `Se vuelve a leer cada ${SEGUIR_LOG_MS / 1000} s y baja solo a lo último (si subís a leer, se queda donde estás).` : "Tocá para seguirlo en vivo."}>
                                <button type="button" onClick={() => setSeguir((v) => !v)} aria-pressed={seguir}
                                    className="ml-auto h-7 pl-2 pr-2.5 rounded-full border border-border text-[11.5px] font-semibold flex items-center gap-1.5 hover:bg-accent">
                                    <Pulso activo={seguir && !cargando} tono={seguir ? "bien" : "quieto"} /> {seguir ? "En vivo" : "Quieto"}
                                </button>
                            </Pista>
                        </div>
                        {!s.conLogs ? <p className="text-[12.5px] text-muted-foreground">Este proceso no tiene archivo de registro.</p> : (
                            <>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {s.tipo === "pm2" && (
                                        <span className="flex items-center rounded-full border border-border p-0.5">
                                            {(["salida", "errores"] as const).map((k) => (
                                                <button key={k} type="button" onClick={() => setCual(k)} aria-pressed={cual === k}
                                                    className={cn("h-6 px-2.5 rounded-full text-[11.5px] font-semibold transition-colors", cual === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                                                    {k === "salida" ? "Salida" : "Errores"}
                                                </button>
                                            ))}
                                        </span>
                                    )}
                                    <span className="flex items-center rounded-full border border-border p-0.5">
                                        {LINEAS.map((n) => (
                                            <button key={n} type="button" onClick={() => setLineas(n)} aria-pressed={lineas === n}
                                                className={cn("h-6 px-2 rounded-full text-[11.5px] font-semibold tabular-nums transition-colors", lineas === n ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                                                {n}
                                            </button>
                                        ))}
                                    </span>
                                    <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar" className="h-7 w-32 ml-auto text-[12px]" />
                                </div>
                                <div ref={caja} onScroll={(e) => { const el = e.currentTarget; alFondo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
                                    className="rounded-[10px] border border-border bg-muted/40 h-[380px] overflow-auto px-3 py-2">
                                    {error ? (
                                        <p className="text-[12px] tono-mal py-4">{error} <button onClick={traer} className="tono-accion font-semibold ml-1">Reintentar</button></p>
                                    ) : !log ? (
                                        <p className="text-[12px] text-muted-foreground py-4 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Leyendo…</p>
                                    ) : !visibles.length ? (
                                        <p className="text-[12px] text-muted-foreground py-4">{filtro ? "Ninguna línea coincide." : "El registro está vacío."}</p>
                                    ) : visibles.map((l, i) => (
                                        <p key={i} className={cn("text-[11px] leading-[1.55] tabular-nums whitespace-pre-wrap break-all text-foreground/80", tonoDeLinea(l))}>{l}</p>
                                    ))}
                                </div>
                                {log && <p className="text-[11px] text-muted-foreground tabular-nums truncate">{visibles.length} de {log.lineas.length} líneas{log.archivo ? ` · ${log.archivo}` : ""}</p>}
                            </>
                        )}
                    </div>
                </CajonContenido>
            )}
        </Cajon>
    );
}

function Medida({ icono: Ic, rotulo, valor, pista, children }: { icono: React.ComponentType<{ size?: number; className?: string }>; rotulo: string; valor: React.ReactNode; pista: string; children?: React.ReactNode }) {
    return (
        <div className="rounded-[10px] border border-border bg-card px-3 py-2.5 min-w-0">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Ic size={11.5} /> {rotulo}
                <Pista titulo={rotulo} texto={pista} ancho={260}><HelpCircle size={11} className="text-muted-foreground/60 hover:text-[var(--accion)] cursor-help" /></Pista>
            </p>
            <p className="text-[16px] font-bold tabular-nums leading-tight mt-0.5 truncate">{valor}</p>
            <div className="mt-1">{children}</div>
        </div>
    );
}

function Renglon({ icono: Ic, titulo, tono, children }: { icono: React.ComponentType<{ size?: number; className?: string }>; titulo: string; tono?: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[18px_1fr] gap-2.5">
            <Ic size={14} className={cn("mt-0.5", tono || "text-muted-foreground")} />
            <div className="min-w-0">
                <p className="text-[11.5px] font-semibold text-muted-foreground">{titulo}</p>
                <div className="text-[12.5px] leading-relaxed text-foreground/85">{children}</div>
            </div>
        </div>
    );
}

// ───────────────────────────── Tarea programada ─────────────────────────────

type Corrida = Awaited<ReturnType<typeof corridasDeTarea>>[number];

export function CajonTarea({ tarea, alCerrar, alCambiar }: { tarea: TareaFila | null; alCerrar: () => void; alCambiar: () => void }) {
    const t = tarea;
    const [corridas, setCorridas] = useState<Corrida[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [corriendo, setCorriendo] = useState(false);
    const [pausando, setPausando] = useState(false);
    const [soloFallas, setSoloFallas] = useState(false);

    const traer = async () => {
        if (!t) return;
        setError(null);
        try { setCorridas(await corridasDeTarea(t.clave)); } catch (e: any) { setError(e?.message || "No se pudieron traer las corridas"); }
    };
    useEffect(() => { setCorridas(null); setSoloFallas(false); if (t?.conocida) traer(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [t?.clave]);

    const correr = async () => {
        if (!t) return;
        setCorriendo(true);
        const r = await ejecutarTarea(t.clave);
        setCorriendo(false);
        if (r.ok) toast.success(`${t.nombre}: corrió bien`, { description: r.detalle });
        else toast.error(`${t.nombre}: no salió`, { description: r.error });
        traer(); alCambiar();
    };
    const pausar = async () => {
        if (!t) return;
        setPausando(true);
        const r = await pausarTarea(t.clave, !t.pausada);
        setPausando(false);
        if (!r.ok) { toast.error("No se pudo cambiar", { description: r.error }); return; }
        toast.success(t.pausada ? `${t.nombre} reanudada` : `${t.nombre} pausada`, { description: t.pausada ? "Vuelve a correr en el próximo minuto." : "El cron la sigue llamando, pero no hace nada hasta que la reanudes." });
        alCambiar();
    };

    const lista = (corridas || []).filter((c) => !soloFallas || c.ok === false);

    return (
        <Cajon open={!!t} onOpenChange={(o) => { if (!o && !corriendo) alCerrar(); }}>
            {t && (
                <CajonContenido ancho="medio" titulo={t.nombre} descripcion={t.enUnaFrase}
                    pie={t.conocida ? (
                        <>
                            <Pista texto={t.pausada ? "Vuelve a hacer su trabajo desde el próximo minuto." : "El cron la sigue llamando, pero la tarea contesta «pausada» sin hacer nada. Se deshace con un clic."}>
                                <Button variant="outline" onClick={pausar} disabled={pausando || corriendo}
                                    className="h-9 px-4 rounded-md text-[13px] font-semibold gap-1.5">
                                    {pausando ? <Loader2 size={14} className="animate-spin" /> : t.pausada ? <Play size={14} /> : <Pause size={14} />}
                                    {t.pausada ? "Reanudar" : "Pausar"}
                                </Button>
                            </Pista>
                            <Button onClick={correr} disabled={corriendo || t.pausada}
                                className="accion h-9 px-4 rounded-md text-[13px] font-semibold gap-1.5">
                                {corriendo ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                {corriendo ? "Corriendo…" : "Ejecutar ahora"}
                            </Button>
                        </>
                    ) : undefined}>

                    <CajonSeccion titulo="Qué hace" icono={Info}>
                        {t.conocida ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <p className="text-[12.5px] leading-relaxed text-foreground/80">{t.queHace}</p>
                                <div>
                                    <p className="text-[12px] font-semibold text-foreground/85 mb-1 flex items-center gap-1.5"><AlertTriangle size={12.5} className="tono-aviso" /> Si falla o se pausa</p>
                                    <p className="text-[12.5px] leading-relaxed text-foreground/80">{t.siFalla}</p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-[12.5px] leading-relaxed text-foreground/80">Una línea del cron del servidor que no es de OmniAccess. Se muestra para saber que existe; no se corre ni se pausa desde acá.</p>
                        )}
                        {t.pausada && <div className="rounded-[10px] border chip-aviso px-3 py-2.5 text-[12.5px] flex items-center gap-2"><Pause size={14} /> Pausada: el cron la llama pero no hace nada.</div>}
                    </CajonSeccion>

                    <CajonSeccion titulo="Cuándo corre" icono={CalendarClock}
                        pista="El horario sale del crontab del servidor. Para cambiarlo hay que editar el cron en el CT: desde una página web sería darle permiso de correr cualquier comando como root.">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <Dato rotulo="Horario" valor={t.enUnaFrase} />
                            <Dato rotulo="Corridas en 24 h" valor={t.corridas24} />
                            <Dato rotulo="Fallas en 24 h" valor={<span className={cn(t.fallas24 > 0 && "tono-mal")}>{t.fallas24}</span>} />
                            <Dato rotulo="Tarda en promedio" valor={duracion(t.msPromedio)} />
                        </div>
                        <div className="rounded-[10px] border border-border bg-muted/40 px-3 py-2.5">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mb-1"><Terminal size={12} /> Línea del cron <span className="font-normal">(sin secretos)</span></p>
                            <p className="text-[11.5px] tabular-nums break-all text-foreground/80"><span className="text-muted-foreground">{t.horario}</span> {t.comando}</p>
                        </div>
                    </CajonSeccion>

                    {t.conocida && (
                        <CajonSeccion titulo="Corridas" icono={History}
                            ayuda="Cada vez que corrió, cuánto tardó y qué contestó. Se guardan los últimos 7 días.">
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setSoloFallas((v) => !v)} aria-pressed={soloFallas}
                                    className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold transition-colors",
                                        soloFallas ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
                                    Sólo las que fallaron
                                </button>
                                <Button variant="ghost" size="sm" onClick={traer} className="h-8 px-2.5 gap-1.5 text-[12px] font-semibold ml-auto">
                                    <RefreshCw size={13} /> Actualizar
                                </Button>
                            </div>
                            <div className="rounded-[10px] border border-border divide-y divide-border max-h-[420px] overflow-y-auto">
                                {error ? <p className="px-3 py-4 text-[12px] tono-mal">{error} <button onClick={traer} className="tono-accion font-semibold ml-1">Reintentar</button></p>
                                    : !corridas ? <p className="px-3 py-4 text-[12px] text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Trayendo…</p>
                                    : !lista.length ? <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">{soloFallas ? "Ninguna falló en estos días." : "Todavía no hay corridas registradas: aparecen desde la primera vez que corre con esta versión."}</p>
                                    : lista.map((c) => (
                                        <div key={c.id} className="grid grid-cols-[96px_70px_86px_1fr] items-start gap-3 px-3 py-2">
                                            <Momento t={c.inicio} />
                                            <span className="text-[12px] tabular-nums text-muted-foreground pt-0.5">{duracion(c.ms)}</span>
                                            <span className="pt-0.5"><Estado tono={c.ok === false ? "mal" : c.ok ? "bien" : "neutro"}>{c.ok === false ? "Falló" : c.ok ? "Bien" : "—"}</Estado></span>
                                            <span className="min-w-0">
                                                <span className="block text-[11.5px] text-foreground/80 break-all tabular-nums">{c.detalle || "Sin novedades"}</span>
                                                {c.origen !== "cron" && <span className="block text-[11px] tono-accion">{c.origen}</span>}
                                            </span>
                                        </div>
                                    ))}
                            </div>
                        </CajonSeccion>
                    )}
                </CajonContenido>
            )}
        </Cajon>
    );
}
