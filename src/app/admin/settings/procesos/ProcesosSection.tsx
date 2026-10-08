"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Box, CalendarClock, Cpu, Pause, RefreshCw, ScrollText, Send, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Momento } from "@/components/ui/celdas";
import { cn } from "@/lib/utils";
import { estadoProcesos, type AccionFila, type ServicioFila, type TareaFila } from "@/app/actions/procesos";
import { CajonServicio, CajonTarea, duracion, haceCuanto, megas } from "./CajonesProcesos";

/**
 * Ajustes → Procesos y tareas: todo lo que corre de fondo en el servidor, en una pantalla.
 *
 * Hasta acá, saber si el receptor de eventos se estaba reiniciando solo, si el cron de
 * visitas fallaba o qué decía el log del lector era entrar por consola al CT. Ahora se ve
 * acá: los servicios (PM2 y Docker) con su estado y su registro, las tareas del cron con
 * cada corrida, la cola de envíos, y la auditoría de lo que se tocó desde esta pantalla.
 */

type Estado_ = Awaited<ReturnType<typeof estadoProcesos>>;

/** Cada cuánto se refresca sola. Un proceso que se cae se ve en menos que esto. */
const REFRESCO_MS = 10_000;

function Bloque({ titulo, ayuda, icono: Icono, derecha, children }: { titulo: string; ayuda?: string; icono: React.ComponentType<{ size?: number; className?: string }>; derecha?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-[14px] font-bold"><Icono size={15} className="text-muted-foreground" /> {titulo}</h3>
                    {ayuda && <p className="text-[12px] text-muted-foreground mt-0.5 max-w-3xl">{ayuda}</p>}
                </div>
                {derecha}
            </div>
            {children}
        </section>
    );
}

export default function ProcesosSection() {
    const [d, setD] = useState<Estado_ | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [servicio, setServicio] = useState<string | null>(null);
    const [tarea, setTarea] = useState<string | null>(null);
    const [, tic] = useState(0);

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setD(await estadoProcesos()); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo leer el estado de los procesos."); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => {
        cargar();
        const iv = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, REFRESCO_MS);
        const reloj = setInterval(() => tic((x) => x + 1), 1000);
        return () => { clearInterval(iv); clearInterval(reloj); };
    }, [cargar]);

    const servicioAbierto = d?.servicios.find((s) => s.nombre === servicio) || null;
    const tareaAbierta = d?.tareas.find((t) => t.clave === tarea) || null;
    const caidos = d?.servicios.filter((s) => !s.vivo).length || 0;
    const conFallas = d?.tareas.filter((t) => t.fallas24 > 0).length || 0;

    const colServicios = useMemo<ColumnaTabla<ServicioFila>[]>(() => [
        {
            clave: "servicio", titulo: "Servicio", ancho: 280, ordenable: true, valor: (s) => s.titulo,
            celda: (s) => (
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-md bg-muted border border-border text-muted-foreground flex items-center justify-center shrink-0">
                        {s.tipo === "pm2" ? <Cpu size={15} /> : <Box size={15} />}
                    </span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate">{s.titulo}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{s.tipo === "pm2" ? "PM2" : "Docker"} · {s.nombre}</div>
                    </div>
                </div>
            ),
        },
        {
            clave: "estado", titulo: "Estado", ancho: 120, ordenable: true, valor: (s) => (s.vivo ? "1" : "0"),
            celda: (s) => <Estado tono={s.vivo ? "bien" : "mal"}>{s.vivo ? "En línea" : s.estado}</Estado>,
        },
        {
            clave: "desde", titulo: "Activo hace", ancho: 130, ordenable: true, valor: (s) => s.desde || s.detalle,
            tituloAyuda: "Desde cuándo está arriba", ayuda: "Para los contenedores es lo que dice Docker.",
            celda: (s) => <span className="text-[12.5px] tabular-nums">{s.tipo === "pm2" ? haceCuanto(s.desde) : s.detalle}</span>,
        },
        {
            clave: "reinicios", titulo: "Reinicios", ancho: 100, alinear: "der", ordenable: true, valor: (s) => String(s.reinicios ?? -1).padStart(6, "0"),
            tituloAyuda: "Cuántas veces volvió a arrancar", ayuda: "Desde que PM2 lo creó, a mano o porque se cayó. Si sube solo, se está cayendo.",
            celda: (s) => <span className="text-[12.5px] tabular-nums">{s.reinicios ?? "—"}</span>,
        },
        { clave: "memoria", titulo: "Memoria", ancho: 100, alinear: "der", ordenable: true, valor: (s) => String(s.memoria ?? -1).padStart(14, "0"), celda: (s) => <span className="text-[12.5px] tabular-nums">{megas(s.memoria)}</span> },
        { clave: "cpu", titulo: "CPU", ancho: 80, alinear: "der", ordenable: true, valor: (s) => String(s.cpu ?? -1).padStart(6, "0"), celda: (s) => <span className="text-[12.5px] tabular-nums">{s.cpu == null ? "—" : `${s.cpu}%`}</span> },
        { clave: "quehace", titulo: "Qué hace", ancho: 340, celda: (s) => <span className="text-[12px] text-muted-foreground line-clamp-1">{s.queHace || "—"}</span> },
    ], []);

    const colTareas = useMemo<ColumnaTabla<TareaFila>[]>(() => [
        {
            clave: "tarea", titulo: "Tarea", ancho: 260, ordenable: true, valor: (t) => t.nombre,
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
            clave: "ultima", titulo: "Última corrida", ancho: 150, ordenable: true, valor: (t) => t.ultima?.inicio || "",
            celda: (t) => t.ultima ? <Momento t={t.ultima.inicio} /> : <span className="text-[12px] text-muted-foreground">{t.conocida ? "Sin registro aún" : "—"}</span>,
        },
        {
            clave: "resultado", titulo: "Resultado", ancho: 110,
            celda: (t) => !t.ultima ? null : <Estado tono={t.ultima.ok === false ? "mal" : "bien"}>{t.ultima.ok === false ? "Falló" : "Bien"}</Estado>,
        },
        {
            clave: "dia", titulo: "En 24 h", ancho: 140, alinear: "der", ordenable: true, valor: (t) => String(t.corridas24).padStart(6, "0"),
            tituloAyuda: "Corridas y fallas del último día", ayuda: "Una tarea de cada minuto debería sumar unas 1.440. Muchas menos: el cron no la está llamando o estuvo pausada.",
            celda: (t) => !t.conocida ? null : (
                <span className="text-[12.5px] tabular-nums">{t.corridas24}{t.fallas24 > 0 && <span className="tono-mal font-semibold"> · {t.fallas24} fallas</span>}</span>
            ),
        },
        { clave: "dura", titulo: "Tarda", ancho: 90, alinear: "der", celda: (t) => <span className="text-[12.5px] tabular-nums">{duracion(t.msPromedio)}</span> },
    ], []);

    const colAcciones = useMemo<ColumnaTabla<AccionFila>[]>(() => [
        { clave: "cuando", titulo: "Cuándo", ancho: 120, ordenable: true, valor: (a) => a.cuando, celda: (a) => <Momento t={a.cuando} /> },
        { clave: "quien", titulo: "Quién", ancho: 160, ordenable: true, valor: (a) => a.quien, celda: (a) => <span className="text-[12.5px] font-semibold">{a.quien}</span> },
        { clave: "accion", titulo: "Qué hizo", ancho: 200, ordenable: true, valor: (a) => a.accion, celda: (a) => <span className="text-[12.5px]">{a.accion} <span className="text-muted-foreground">· {a.objetivo}</span></span> },
        { clave: "ok", titulo: "Resultado", ancho: 100, celda: (a) => <Estado tono={a.ok ? "bien" : "mal"}>{a.ok ? "Bien" : "Falló"}</Estado> },
        { clave: "detalle", titulo: "Detalle", ancho: 360, celda: (a) => <span className="text-[12px] text-muted-foreground line-clamp-1 break-all">{a.detalle || "—"}</span> },
    ], []);

    return (
        <div className="max-w-6xl space-y-8">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-[17px] font-bold">Procesos y tareas</h2>
                    <p className="text-[12.5px] text-muted-foreground max-w-2xl">Lo que corre de fondo en el servidor: los servicios, las tareas programadas, la cola de envíos y quién tocó qué. Tocá una fila para ver su registro, reiniciarla o correrla a mano.</p>
                </div>
                <div className="flex items-center gap-3">
                    {d && (
                        <span className="flex items-center gap-2">
                            {caidos > 0 ? <Estado tono="mal">{caidos} caído{caidos === 1 ? "" : "s"}</Estado> : <Estado tono="bien">Todo en línea</Estado>}
                            {conFallas > 0 && <Estado tono="aviso">{conFallas} tarea{conFallas === 1 ? "" : "s"} con fallas</Estado>}
                        </span>
                    )}
                    <Pista texto={`Se actualiza sola cada ${REFRESCO_MS / 1000} s mientras la pestaña está a la vista.`}>
                        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="h-8 px-3 gap-1.5 text-[12px] font-semibold tabular-nums">
                            <RefreshCw size={13} className={cn(cargando && "animate-spin")} /> {d ? `hace ${haceCuanto(d.al)}` : "Actualizar"}
                        </Button>
                    </Pista>
                </div>
            </div>

            {d && d.avisos.length > 0 && (
                <div className="rounded-[10px] border chip-aviso px-4 py-3 text-[12.5px] space-y-1">
                    <p className="font-semibold flex items-center gap-2"><AlertTriangle size={14} /> Hay partes que no se pudieron leer</p>
                    {d.avisos.map((a) => <p key={a} className="text-foreground/80 break-all">{a}</p>)}
                </div>
            )}

            <Bloque titulo="Servicios" icono={Server} ayuda="Los procesos de OmniAccess (PM2) y los contenedores (Docker). Si uno se cae, el vigía avisa; acá se ve por qué y se puede reiniciar.">
                <Tabla<ServicioFila> id="procesos-servicios" filas={d?.servicios || []} clave={(s) => `${s.tipo}:${s.nombre}`} columnas={colServicios}
                    cargando={!d && !error} error={!d ? error : null} alReintentar={cargar} alClickFila={(s) => setServicio(s.nombre)}
                    vacio={{ icono: Server, titulo: "No se encontró ningún servicio", ayuda: "PM2 y Docker no devolvieron nada." }} filasFantasma={5} controles={false} />
            </Bloque>

            <Bloque titulo="Tareas programadas" icono={CalendarClock} ayuda="Lo que el cron del servidor corre solo. Cada corrida queda registrada; las de OmniAccess se pueden pausar y correr a mano.">
                <Tabla<TareaFila> id="procesos-tareas" filas={d?.tareas || []} clave={(t) => t.clave} columnas={colTareas}
                    cargando={!d && !error} error={!d ? error : null} alReintentar={cargar} alClickFila={(t) => setTarea(t.clave)}
                    vacio={{ icono: CalendarClock, titulo: "El cron está vacío", ayuda: "No hay tareas programadas en este servidor." }} filasFantasma={3} controles={false} />
            </Bloque>

            <Bloque titulo="Cola de envíos" icono={Send} ayuda="Los avisos por WhatsApp y Telegram esperan acá a que «Envíos y grabación» los mande."
                derecha={<Link href="/admin/despachos" className="text-[12px] font-semibold tono-accion flex items-center gap-1 hover:underline">Ver cada envío <ArrowUpRight size={13} /></Link>}>
                {!d ? null : !d.cola ? <p className="text-[12.5px] text-muted-foreground">No se pudo leer la cola (Redis).</p> : (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {([
                            ["Esperando", d.cola.espera, d.cola.espera > 20 ? "tono-aviso" : ""],
                            ["Enviándose", d.cola.activos, ""],
                            ["Demorados", d.cola.demorados, ""],
                            ["Fallidos", d.cola.fallidos, d.cola.fallidos > 0 ? "tono-mal" : ""],
                            ["Enviados (en Redis)", d.cola.completos, ""],
                        ] as const).map(([r, v, tono]) => (
                            <div key={r} className="rounded-[10px] border border-border bg-card px-3 py-2.5">
                                <p className={cn("text-[20px] font-bold tabular-nums leading-none", tono)}>{v}</p>
                                <p className="text-[11px] text-muted-foreground mt-1.5">{r}</p>
                            </div>
                        ))}
                    </div>
                )}
            </Bloque>

            <Bloque titulo="Auditoría" icono={ScrollText} ayuda="Lo que se hizo desde esta pantalla: reinicios, tareas corridas a mano, pausas. Con quién y cómo salió.">
                <Tabla<AccionFila> id="procesos-auditoria" nombreArchivo="auditoria-procesos" filas={d?.acciones || []} clave={(a) => a.id} columnas={colAcciones}
                    cargando={!d && !error} error={!d ? error : null} alReintentar={cargar}
                    vacio={{ icono: ScrollText, titulo: "Nadie tocó nada todavía", ayuda: "Cada reinicio, pausa o corrida a mano queda anotado acá." }} filasFantasma={3} alto="360px" />
            </Bloque>

            <CajonServicio servicio={servicioAbierto} alCerrar={() => setServicio(null)} alCambiar={cargar} />
            <CajonTarea tarea={tareaAbierta} alCerrar={() => setTarea(null)} alCambiar={cargar} />
        </div>
    );
}
