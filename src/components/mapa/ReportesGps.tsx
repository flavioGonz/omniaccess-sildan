"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, FileSpreadsheet, FileText, Loader2, MapPin } from "lucide-react";
import { guardarHorarioLaboralGps, horarioLaboralGps, rastreadoresGps, vistaPreviaReportesGps, type Rastreador } from "@/app/actions/gps";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { ErrorEstado, Vacio } from "@/components/ui/estados";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { RangoFechas } from "@/components/mapa/RangoFechas";
import { rangoDeFiltro, RECORRIDO_MAX_DIAS, type PeriodoGps } from "@/lib/gps-filtro";
import { rotuloDeHorario, type HorarioCerca } from "@/lib/gps-geocerca";
import { duracionDeReporte, esLugar, esNumero, REPORTES_GPS, REPORTES_POR_DEFECTO, textoDeCelda, type Celda, type ClaveReporte, type TablaReporte } from "@/lib/gps-reportes-catalogo";
import type { ReporteGps } from "@/lib/gps-reportes-servidor";
import { cn } from "@/lib/utils";

/**
 * Los reportes de rastreo: se elige de qué vehículos, de cuándo y cuáles, se mira lo que va a salir
 * y se baja en Excel o en PDF.
 *
 * Pedido de Nico (22/11): «reportes en Excel y PDF; debe tener todo lo que tiene un soft de rastreo
 * satelital». Había una planilla fija —un vehículo, siete días— detrás de un ícono en Dispositivos.
 *
 * Es un cajón y no una pantalla aparte porque se llega desde dos lados (el mapa, con el recorrido
 * a la vista, y la lista de equipos) y de los dos se quiere volver adonde se estaba.
 *
 * La vista previa no es un adorno: lo que más se repite al bajar un reporte es abrirlo, ver que el
 * período estaba mal y bajarlo de nuevo. Acá se ve antes. Y como sale de la misma cuenta que el
 * archivo (lib/gps-reportes), lo que se ve es lo que baja.
 */

const PERIODOS: { clave: PeriodoGps; rotulo: string }[] = [
    { clave: "hoy", rotulo: "Hoy" }, { clave: "ayer", rotulo: "Ayer" }, { clave: "7d", rotulo: "7 días" }, { clave: "30d", rotulo: "30 días" }, { clave: "rango", rotulo: "Fechas" },
];
const ROTULO = "text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground";
const PILDORA = (on: boolean) => cn("h-7 max-w-full truncate rounded-full border px-2.5 text-[11.5px] font-semibold", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground");
const DIAS = [{ d: 1, r: "L" }, { d: 2, r: "M" }, { d: 3, r: "M" }, { d: 4, r: "J" }, { d: 5, r: "V" }, { d: 6, r: "S" }, { d: 0, r: "D" }];
const nombreDe = (r: Rastreador) => r.nombre || r.matricula || `Rastreador ${r.imei.slice(-6)}`;

export type InicioDeReportes = { imeis?: string[] | null; desde?: string; hasta?: string };

export function ReportesGps({ abierto, alCerrar, rastreadores, inicio }: {
    abierto: boolean; alCerrar: () => void;
    /** Los rastreadores, si quien abre ya los tiene (el mapa). Si no, se piden. */
    rastreadores?: Rastreador[];
    /** Con qué arranca: el vehículo y el período que se estaban mirando. Fechas como las de un campo de fecha y hora. */
    inicio?: InicioDeReportes;
}) {
    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            {abierto && <Adentro rastreadores={rastreadores} inicio={inicio} />}
        </Cajon>
    );
}

function Adentro({ rastreadores, inicio }: { rastreadores?: Rastreador[]; inicio?: InicioDeReportes }) {
    const [propios, setPropios] = useState<Rastreador[] | null>(null);
    useEffect(() => { if (!rastreadores) rastreadoresGps().then(setPropios).catch(() => setPropios([])); }, [rastreadores]);
    const lista = useMemo(() => (rastreadores || propios || []).filter((r) => r.deviceId), [rastreadores, propios]);

    const [imeis, setImeis] = useState<string[] | null>(inicio?.imeis?.length ? inicio.imeis : null);
    const [periodo, setPeriodo] = useState<PeriodoGps>(inicio?.desde ? "rango" : "7d");
    const [fechas, setFechas] = useState({ desde: inicio?.desde || "", hasta: inicio?.hasta || "" });
    const [claves, setClaves] = useState<ClaveReporte[]>(REPORTES_POR_DEFECTO);
    const [viendo, setViendo] = useState<ClaveReporte>("resumen");
    const [vuelta, setVuelta] = useState(0);

    /* La respuesta guarda de qué consulta es: mientras no coincide con lo elegido, se está cargando. */
    const consulta = JSON.stringify([imeis, periodo, periodo === "rango" ? fechas : null, claves, vuelta]);
    const [previa, setPrevia] = useState<{ de: string; reporte: ReporteGps | null; error: string | null } | null>(null);
    useEffect(() => {
        let vivo = true;
        /* Un respiro antes de pedir: tildar cuatro reportes seguidos no son cuatro consultas. */
        const t = setTimeout(() => {
            const r = rangoDeFiltro({ periodo, ...fechas });
            if (r.error || !r.desde) { setPrevia({ de: consulta, reporte: null, error: r.error || "Elegí desde cuándo." }); return; }
            vistaPreviaReportesGps({ imeis, desde: r.desde.toISOString(), hasta: r.hasta ? r.hasta.toISOString() : null, reportes: claves })
                .then((x) => { if (vivo) setPrevia({ de: consulta, reporte: x.ok ? x.reporte : null, error: x.ok ? null : x.error }); })
                .catch((e) => { if (vivo) setPrevia({ de: consulta, reporte: null, error: e instanceof Error ? e.message : "No se pudo armar el reporte." }); });
        }, 350);
        return () => { vivo = false; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `consulta` ya resume todo lo que cambia el pedido
    }, [consulta]);
    const cargando = !previa || previa.de !== consulta;
    const reporte = previa?.reporte || null;
    const tabla = reporte?.tablas.find((t) => t.clave === viendo) || reporte?.tablas[0] || null;

    const alternar = (c: ClaveReporte) => setClaves((x) => (x.includes(c) ? x.filter((y) => y !== c) : REPORTES_GPS.map((r) => r.clave).filter((y) => y === c || x.includes(y))));
    const alternarVehiculo = (imei: string) => setImeis((x) => {
        const sig = !x ? [imei] : x.includes(imei) ? x.filter((y) => y !== imei) : [...x, imei];
        return sig.length === 0 || sig.length === lista.length ? null : sig;     // todos tildados, o ninguno, es «todos»
    });

    /* ── Bajar ── */
    const [bajando, setBajando] = useState<"xlsx" | "pdf" | null>(null);
    const [falla, setFalla] = useState<string | null>(null);
    const bajar = useCallback(async (formato: "xlsx" | "pdf") => {
        const r = rangoDeFiltro({ periodo, ...fechas });
        if (r.error || !r.desde) { setFalla(r.error || "Elegí desde cuándo."); return; }
        setBajando(formato); setFalla(null);
        try {
            const q = new URLSearchParams({ formato, desde: r.desde.toISOString(), reportes: claves.join(",") });
            if (r.hasta) q.set("hasta", r.hasta.toISOString());
            if (imeis) q.set("imeis", imeis.join(","));
            const res = await fetch(`/api/gps/reporte?${q}`);
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `El servidor contestó ${res.status}.`);
            /* Se baja como archivo y no navegando al enlace: si falla, el error se ve acá y no en una hoja en blanco. */
            const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
            a.href = url; a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || `rastreo.${formato}`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } catch (e) { setFalla(e instanceof Error ? e.message : "No se pudo bajar el reporte."); }
        finally { setBajando(null); }
    }, [periodo, fechas, claves, imeis]);

    const sinNada = claves.length === 0, soloListado = claves.length === 1 && claves[0] === "posiciones";
    /* Más ancho que el cajón más ancho: adentro va una tabla de doce columnas al lado de sus opciones. */
    return (
        <CajonContenido ancho="ancho" className="sm:max-w-[min(1320px,96vw)]" titulo="Reportes de rastreo" descripcion="Elegí qué querés ver, miralo y bajalo en Excel o en PDF."
            pie={(
                <div className="flex flex-wrap items-center gap-2">
                    {falla && <p className="tono-mal mr-auto text-[12px] font-semibold" role="alert">{falla}</p>}
                    {!falla && <p className="mr-auto text-[11.5px] text-muted-foreground">El Excel trae todas las filas y se puede filtrar y sumar. El PDF es para mandar o imprimir.</p>}
                    <Button variant="outline" disabled={!!bajando || sinNada || soloListado} onClick={() => bajar("pdf")} title={soloListado ? "El listado de posiciones va sólo al Excel" : undefined}>
                        {bajando === "pdf" ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Bajar PDF
                    </Button>
                    <Button disabled={!!bajando || sinNada} onClick={() => bajar("xlsx")}>
                        {bajando === "xlsx" ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Bajar Excel
                    </Button>
                </div>
            )}>
            <div className="grid min-h-full lg:grid-cols-[292px_minmax(0,1fr)]">
                {/* ── Qué ── */}
                <div className="space-y-5 border-b border-border p-5 lg:border-b-0 lg:border-r">
                    <section>
                        <p className={ROTULO}>Vehículos</p>
                        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Vehículos">
                            <button type="button" aria-pressed={!imeis} onClick={() => setImeis(null)} className={PILDORA(!imeis)}>Todos{lista.length ? ` (${lista.length})` : ""}</button>
                            {lista.map((r) => (
                                <button key={r.imei} type="button" aria-pressed={!!imeis?.includes(r.imei)} onClick={() => alternarVehiculo(r.imei)} className={PILDORA(!!imeis?.includes(r.imei))} title={r.matricula || undefined}>{nombreDe(r)}</button>
                            ))}
                        </div>
                        {!rastreadores && propios && !lista.length && <p className="mt-2 text-[11.5px] text-muted-foreground">No hay rastreadores dados de alta.</p>}
                    </section>

                    <section>
                        <p className={ROTULO}>Período</p>
                        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Período">
                            {PERIODOS.map((p) => <button key={p.clave} type="button" aria-pressed={periodo === p.clave} onClick={() => setPeriodo(p.clave)} className={PILDORA(periodo === p.clave)}>{p.rotulo}</button>)}
                        </div>
                        {periodo === "rango" && <RangoFechas className="mt-2" desde={fechas.desde} hasta={fechas.hasta} alCambiar={setFechas} />}
                        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">Como mucho {RECORRIDO_MAX_DIAS} días por reporte.</p>
                    </section>

                    <section>
                        <div className="flex items-baseline justify-between">
                            <p className={ROTULO}>Reportes</p>
                            <button type="button" className="text-[11px] font-semibold text-[var(--accion)] hover:underline" onClick={() => setClaves(claves.length >= REPORTES_POR_DEFECTO.length ? [] : REPORTES_POR_DEFECTO)}>{claves.length >= REPORTES_POR_DEFECTO.length ? "Ninguno" : "Todos"}</button>
                        </div>
                        <ul className="mt-1.5">
                            {REPORTES_GPS.map((r) => (
                                <li key={r.clave}>
                                    <label className="flex cursor-pointer items-start gap-2 rounded-[6px] px-1.5 py-1.5 hover:bg-accent">
                                        <input type="checkbox" className="mt-[3px] accent-[var(--accion)]" checked={claves.includes(r.clave)} onChange={() => alternar(r.clave)} />
                                        <span className="min-w-0">
                                            <span className="block text-[12.5px] font-semibold leading-tight">{r.titulo}{r.soloExcel && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">sólo Excel</span>}</span>
                                            <span className="block text-[11px] leading-snug text-muted-foreground">{r.ayuda}</span>
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <HorarioLaboral alGuardar={() => setVuelta((n) => n + 1)} />
                </div>

                {/* ── Cómo queda ── */}
                <div className="min-w-0 p-5">
                    {sinNada ? <Vacio icono={FileText} titulo="Elegí al menos un reporte" ayuda="Tildá a la izquierda lo que querés que traiga el archivo." />
                        : previa?.error && !cargando ? <ErrorEstado titulo="No se pudo armar el reporte" mensaje={previa.error} alReintentar={() => setVuelta((n) => n + 1)} />
                        : (
                            <>
                                <Cifras r={reporte} cargando={cargando} />
                                {reporte && reporte.recortado && <p className="tono-aviso mt-2 text-[11.5px] font-semibold">El período era más largo que {RECORRIDO_MAX_DIAS} días: se muestra desde su comienzo.</p>}
                                {reporte && reporte.tablas.length > 0 && (
                                    <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Reporte a la vista">
                                        {reporte.tablas.map((t) => (
                                            <button key={t.clave} type="button" role="tab" aria-selected={tabla?.clave === t.clave} onClick={() => setViendo(t.clave)}
                                                className={cn("h-7 rounded-[6px] px-2.5 text-[11.5px] font-semibold tabular-nums", tabla?.clave === t.clave ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                                {t.hoja} <span className="font-normal opacity-70">{t.filasTotales.toLocaleString("es-UY")}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {soloListado ? <Vacio className="mt-4" icono={FileSpreadsheet} titulo="El listado de posiciones no tiene vista previa" ayuda="Son miles de renglones: bajalo en Excel." />
                                    : <VistaDeTabla tabla={tabla} cargando={cargando} />}
                                {claves.includes("posiciones") && !soloListado && <p className="mt-2 text-[11px] text-muted-foreground">El detalle de posiciones va en una hoja aparte del Excel; no se muestra acá ni en el PDF.</p>}
                            </>
                        )}
                </div>
            </div>
        </CajonContenido>
    );
}

/** Las cifras del período, arriba de todo: lo que se quiere saber antes de leer ninguna tabla. */
function Cifras({ r, cargando }: { r: ReporteGps | null; cargando: boolean }) {
    const t = r?.totales;
    const cifras: [string, string, string?][] = [
        [t ? `${t.km.toFixed(1).replace(".", ",")} km` : "—", "recorridos"], [t ? String(t.viajes) : "—", "viajes"], [t ? duracionDeReporte(t.andandoMin) : "—", "andando"],
        [t && t.ralentiMin !== null ? duracionDeReporte(t.ralentiMin) : "—", "en ralentí"], [t?.velMax ? `${t.velMax} km/h` : "—", "vel. máxima"],
        [t ? String(t.excesos) : "—", "excesos", t?.excesos ? "tono-mal" : undefined], [t ? String(t.alarmas) : "—", "alarmas", t?.alarmas ? "tono-aviso" : undefined],
    ];
    return (
        <div className={cn("flex flex-wrap gap-x-7 gap-y-3", cargando && "opacity-50")} aria-busy={cargando}>
            {cifras.map(([v, que, tono]) => (
                <div key={que} className="whitespace-nowrap">
                    <p className={cn("text-[16px] font-bold tabular-nums tracking-tight", tono)}>{v}</p>
                    <p className="text-[10.5px] text-muted-foreground">{que}</p>
                </div>
            ))}
        </div>
    );
}

type FilaVista = { n: number; f: Celda[] };

function VistaDeTabla({ tabla, cargando }: { tabla: TablaReporte | null; cargando: boolean }) {
    const columnas = useMemo<ColumnaTabla<FilaVista>[]>(() => (tabla?.columnas || []).map((c, i) => ({
        clave: `c${i}`, titulo: <span className="whitespace-nowrap">{c.rotulo}</span>, alinear: esNumero(c.formato) ? "der" : "izq",
        valor: (x) => { const v = x.f[i]; return esLugar(v) ? textoDeCelda(c.formato, v) : v; },
        celda: (x) => {
            const v = x.f[i];
            if (esLugar(v)) return <a href={`https://maps.google.com/?q=${v.lat},${v.lon}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] text-[var(--accion)] hover:underline"><MapPin size={11} className="shrink-0" />{textoDeCelda(c.formato, v)}</a>;
            return <span className={cn("whitespace-nowrap text-[12.5px]", esNumero(c.formato) && "tabular-nums", v === "Fuera de horario" && "tono-aviso font-semibold", (v === null || v === "") && "text-muted-foreground")}>{textoDeCelda(c.formato, v)}</span>;
        },
    })), [tabla]);
    const filas = useMemo<FilaVista[]>(() => (tabla?.filas || []).map((f, n) => ({ n, f })), [tabla]);
    const total = tabla?.total ? tabla.columnas.map((c, i) => (i > 1 && tabla.total![i] !== null ? `${c.rotulo.toLowerCase()} ${textoDeCelda(c.formato, tabla.total![i])}` : null)).filter(Boolean).join(" · ") : "";
    return (
        <div className="mt-2">
            {tabla && <p className="mb-2 text-[11.5px] leading-snug text-muted-foreground">{tabla.nota || tabla.ayuda}</p>}
            <Tabla<FilaVista> filas={cargando ? [] : filas} clave={(x) => String(x.n)} columnas={columnas} cargando={cargando || !tabla} controles={false} alto="calc(100dvh - 372px)" filasFantasma={6}
                vacio={{ titulo: tabla?.vacio || "Sin datos" }}
                pie={tabla && !cargando && tabla.filas.length > 0 ? (
                    <p className="px-3 py-2 text-[11.5px] text-muted-foreground">
                        {tabla.filasTotales > tabla.filas.length ? <>Se ven las primeras <b className="text-foreground">{tabla.filas.length}</b> de <b className="text-foreground">{tabla.filasTotales.toLocaleString("es-UY")}</b> filas; el archivo las trae todas.</> : <>{tabla.filasTotales} {tabla.filasTotales === 1 ? "fila" : "filas"}.</>}
                        {total && <> <span className="text-foreground">Total: {total}.</span></>}
                    </p>
                ) : undefined} />
        </div>
    );
}

/**
 * El horario laboral. Vive acá porque es el único lugar donde se usa: es la vara contra la que se
 * mide el «uso fuera de horario». Sin horario cargado, ese reporte no puede decir nada, y lo dice.
 */
function HorarioLaboral({ alGuardar }: { alGuardar: () => void }) {
    /* `undefined` es «todavía no se sabe»; `null`, que no hay ninguno cargado. */
    const [guardado, setGuardado] = useState<HorarioCerca | null | undefined>(undefined);
    useEffect(() => { horarioLaboralGps().then(setGuardado).catch(() => setGuardado(null)); }, []);
    const horario = guardado ?? null, sabido = guardado !== undefined;
    const [borrador, setBorrador] = useState<HorarioCerca | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const guardar = async (h: HorarioCerca | null) => {
        setGuardando(true); setError(null);
        try {
            const r = await guardarHorarioLaboralGps(h);
            if (!r.ok) { setError(r.error || "No se pudo guardar."); return; }
            setGuardado(r.horario ?? null); setBorrador(null); alGuardar();
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
        finally { setGuardando(false); }
    };
    const CAMPO = "h-7 rounded-[6px] border border-border bg-background px-1.5 text-[12px] tabular-nums outline-none focus:border-[var(--accion)]";
    return (
        <section>
            <p className={ROTULO}>Horario laboral</p>
            {!borrador ? (
                <div className="mt-1.5 flex items-start gap-2 text-[12px]">
                    <Clock size={13} className="mt-[2px] shrink-0 text-muted-foreground" />
                    <p className="min-w-0 flex-1 leading-snug">{!sabido ? <span className="text-muted-foreground">…</span> : horario ? rotuloDeHorario(horario) : <span className="text-muted-foreground">Sin cargar: el reporte de uso fuera de horario no tiene contra qué medir.</span>}</p>
                    <button type="button" disabled={!sabido} className="shrink-0 text-[11.5px] font-semibold text-[var(--accion)] hover:underline disabled:opacity-40" onClick={() => { setError(null); setBorrador(horario || { dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "18:00" }); }}>{horario ? "Cambiar" : "Cargar"}</button>
                </div>
            ) : (
                <div className="mt-2 space-y-2">
                    <div className="flex gap-1" role="group" aria-label="Días laborales">
                        {DIAS.map((x, i) => {
                            const on = borrador.dias.includes(x.d);
                            return <button key={i} type="button" aria-pressed={on} onClick={() => setBorrador({ ...borrador, dias: on ? borrador.dias.filter((d) => d !== x.d) : [...borrador.dias, x.d] })}
                                className={cn("h-7 w-7 rounded-full border text-[11px] font-bold", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground")}>{x.r}</button>;
                        })}
                    </div>
                    <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        de <input type="time" value={borrador.desde} onChange={(e) => setBorrador({ ...borrador, desde: e.target.value })} className={CAMPO} aria-label="Desde" />
                        a <input type="time" value={borrador.hasta} onChange={(e) => setBorrador({ ...borrador, hasta: e.target.value })} className={CAMPO} aria-label="Hasta" />
                    </div>
                    {error && <p className="tono-mal text-[11.5px] font-semibold" role="alert">{error}</p>}
                    <div className="flex items-center gap-1.5">
                        <Button size="sm" className="h-7 px-2.5 text-[11.5px]" disabled={guardando || !borrador.dias.length} onClick={() => guardar(borrador)}>{guardando && <Loader2 size={12} className="animate-spin" />} Guardar</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[11.5px]" disabled={guardando} onClick={() => setBorrador(null)}>Cancelar</Button>
                        {horario && <button type="button" disabled={guardando} className="ml-auto text-[11.5px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => guardar(null)}>Quitar el horario</button>}
                    </div>
                </div>
            )}
        </section>
    );
}
