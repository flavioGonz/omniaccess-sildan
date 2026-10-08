"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, HelpCircle, CalendarClock, Cpu, FileText, History, Info, Loader2, Pause, Play, RefreshCw, RotateCcw, Terminal, Timer } from "lucide-react";
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

export function CajonServicio({ servicio, alCerrar, alCambiar }: { servicio: ServicioFila | null; alCerrar: () => void; alCambiar: () => void }) {
    const s = servicio;
    const [cual, setCual] = useState<"salida" | "errores">("salida");
    const [lineas, setLineas] = useState(300);
    const [filtro, setFiltro] = useState("");
    const [log, setLog] = useState<{ lineas: string[]; archivo: string | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const caja = useRef<HTMLDivElement>(null);

    const traer = async () => {
        if (!s) return;
        setCargando(true); setError(null);
        const r = await logsDeServicio(s.tipo, s.nombre, cual, lineas);
        setCargando(false);
        if (!r.ok) { setError(r.error); return; }
        setLog({ lineas: r.lineas, archivo: r.archivo });
    };
    // Al final, que es donde está lo último que pasó. En un efecto y no al recibir: recién
    // después de dibujar las líneas la caja tiene su alto real.
    useEffect(() => { if (caja.current) caja.current.scrollTop = caja.current.scrollHeight; }, [log]);
    useEffect(() => { setLog(null); setFiltro(""); if (s?.conLogs) traer(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [s?.nombre, cual, lineas]);
    useEffect(() => { setCual("salida"); }, [s?.nombre]);

    const visibles = useMemo(() => {
        const q = filtro.trim().toLowerCase();
        return (log?.lineas || []).filter((l) => !q || l.toLowerCase().includes(q));
    }, [log, filtro]);

    return (
        <Cajon open={!!s} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            {s && (
                <CajonContenido ancho="ancho" titulo={s.titulo}
                    descripcion={`${s.tipo === "pm2" ? "Proceso PM2" : "Contenedor Docker"} · ${s.nombre}`}
                    pie={
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
                            siFalla="Si no arranca, queda en la tabla con su estado en rojo y el motivo en el registro de errores. Se puede reintentar desde acá."
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
                    }>

                    <CajonSeccion titulo="Qué es" icono={Info}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <p className="text-[12px] font-semibold text-foreground/85 mb-1">Qué hace</p>
                                <p className="text-[12.5px] leading-relaxed text-foreground/80">{s.queHace || "Proceso sin descripción en el catálogo de OmniAccess."}</p>
                            </div>
                            <div>
                                <p className="text-[12px] font-semibold text-foreground/85 mb-1 flex items-center gap-1.5"><AlertTriangle size={12.5} className="tono-aviso" /> Si se cae</p>
                                <p className="text-[12.5px] leading-relaxed text-foreground/80">{s.siCae || "—"}</p>
                            </div>
                        </div>
                        {s.origen && <p className="text-[11.5px] text-muted-foreground break-all">{s.tipo === "pm2" ? "Programa" : "Imagen"}: <span className="text-foreground/80">{s.origen}</span></p>}
                    </CajonSeccion>

                    <CajonSeccion titulo="Estado" icono={s.tipo === "pm2" ? Cpu : Box}>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <Dato rotulo="Estado" valor={<Estado tono={s.vivo ? "bien" : "mal"}>{s.vivo ? "En línea" : s.estado}</Estado>} />
                            <Dato rotulo={s.tipo === "pm2" ? "Activo hace" : "Docker dice"} valor={s.tipo === "pm2" ? haceCuanto(s.desde) : s.detalle} />
                            <Dato rotulo="Reinicios" valor={s.reinicios ?? "—"} pista="Las veces que PM2 lo levantó de nuevo desde que se creó, a mano o porque se cayó. Si sube solo entre una visita y otra, se está cayendo." />
                            <Dato rotulo="Memoria" valor={megas(s.memoria)} />
                            <Dato rotulo="CPU" valor={s.cpu == null ? "—" : `${s.cpu}%`} />
                        </div>
                    </CajonSeccion>

                    {s.internas.length > 0 && (
                        <CajonSeccion titulo="Tareas internas" icono={Timer}
                            pista="Lo que este proceso hace solo, cada tanto, mientras está en línea. No se pausan por separado: si el proceso se reinicia, vuelven a arrancar con él.">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                {s.internas.map((t) => (
                                    <div key={t.nombre} className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border text-[12.5px]">
                                        <span className="text-foreground/85">{t.nombre}</span>
                                        <span className="text-muted-foreground tabular-nums shrink-0">cada {t.cada}</span>
                                    </div>
                                ))}
                            </div>
                        </CajonSeccion>
                    )}

                    <CajonSeccion titulo="Registro" icono={FileText}
                        ayuda={log?.archivo ? `Las últimas líneas de ${log.archivo}` : s.tipo === "docker" ? "Las últimas líneas que escribió el contenedor." : undefined}>
                        {!s.conLogs ? <p className="text-[12.5px] text-muted-foreground">Este proceso no tiene archivo de registro.</p> : (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    {s.tipo === "pm2" && (["salida", "errores"] as const).map((k) => (
                                        <button key={k} type="button" onClick={() => setCual(k)} aria-pressed={cual === k}
                                            className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold transition-colors",
                                                cual === k ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
                                            {k === "salida" ? "Salida" : "Errores"}
                                        </button>
                                    ))}
                                    <span className="w-px h-5 bg-border mx-1" />
                                    {LINEAS.map((n) => (
                                        <button key={n} type="button" onClick={() => setLineas(n)} aria-pressed={lineas === n}
                                            className={cn("h-8 px-2.5 rounded-full border text-[12px] font-semibold tabular-nums transition-colors",
                                                lineas === n ? "border-[var(--accion)] tono-accion" : "border-border text-muted-foreground hover:bg-accent")}>
                                            {n}
                                        </button>
                                    ))}
                                    <Input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar líneas" className="h-8 w-44 ml-auto text-[12px]" />
                                    <Button variant="ghost" size="sm" onClick={traer} disabled={cargando} className="h-8 px-2.5 gap-1.5 text-[12px] font-semibold">
                                        <RefreshCw size={13} className={cn(cargando && "animate-spin")} /> Actualizar
                                    </Button>
                                </div>
                                <div ref={caja} className="rounded-[10px] border border-border bg-muted/40 h-[420px] overflow-auto px-3 py-2">
                                    {error ? (
                                        <p className="text-[12px] tono-mal py-4">{error} <button onClick={traer} className="tono-accion font-semibold ml-1">Reintentar</button></p>
                                    ) : !log ? (
                                        <p className="text-[12px] text-muted-foreground py-4 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Leyendo…</p>
                                    ) : !visibles.length ? (
                                        <p className="text-[12px] text-muted-foreground py-4">{filtro ? "Ninguna línea coincide." : "El registro está vacío."}</p>
                                    ) : visibles.map((l, i) => (
                                        <p key={i} className={cn("text-[11.5px] leading-[1.55] tabular-nums whitespace-pre-wrap break-all text-foreground/80", tonoDeLinea(l))}>{l}</p>
                                    ))}
                                </div>
                                {log && <p className="text-[11px] text-muted-foreground tabular-nums">{visibles.length} de {log.lineas.length} líneas</p>}
                            </>
                        )}
                    </CajonSeccion>
                </CajonContenido>
            )}
        </Cajon>
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
