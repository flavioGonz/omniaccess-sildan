"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, RefreshCw, Images, TriangleAlert, Camera, Users, ArrowDownToLine, ArrowUpFromLine, Gauge, Timer, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Miniatura, Momento, Estado } from "@/components/ui/celdas";
import { VivoConPlay } from "@/components/queue/VivoConPlay";
import { tonoFila, ROTULO_TONO } from "@/components/queue/CajonFila";
import { CajonCaptura as CajonDetalle, type Captura as Detalle } from "@/components/queue/CajonCaptura";
import { getFlujoFilas, getLecturasFilas, type Rango, type PuntoFlujo, type Episodio, type Lectura } from "@/app/actions/flujo-filas";
import { hora, horaSeg, fechaCorta, duracion } from "@/lib/fechas";
import { nombreStreamFila } from "@/lib/stream-fila";
import { DibujoPersonas, desdeGuardadas } from "@/components/queue/SiluetasBosch";
import { cn } from "@/lib/utils";

/**
 * Flujo de filas (HB, 19/10). Lo que se pidió:
 *  · el detalle de una lectura en un cajón, no en un modal centrado;
 *  · pararse en un punto de la gráfica y ver en el cuadro del video la foto de ese momento;
 *  · una fila de tabla por cada vez que se superó el límite, con un contador bien visible.
 *
 * Y lo que estaba mal y se arregló al pasar: la gráfica mezclaba el aforo con los contadores de
 * Entrada/Salida (acumulados de la cámara) y por eso decía «pico 93» en una fila que nunca pasó
 * de 7; el encabezado mostraba «31 dic. 1969 eventos» (el total pasado por el formato de fecha);
 * y se dibujaban como cortes cientos de demoras de segundos del sondeo (ahora sólo ≥ 2 min).
 */

const RANGOS: { k: Rango; rotulo: string }[] = [{ k: "24h", rotulo: "24 h" }, { k: "7d", rotulo: "7 días" }, { k: "30d", rotulo: "30 días" }];
/** Cada cuánto se refresca sola la gráfica (y la tabla de veces sobre el límite). */
const REFRESCO_MS = 30_000;
const POR_PAGINA = 50;

type Flujo = Awaited<ReturnType<typeof getFlujoFilas>>;

export default function FlujoFilasPage() {
    const [rango, setRango] = useState<Rango>("24h");
    const [deviceId, setDeviceId] = useState<string>("");
    const [flujo, setFlujo] = useState<Flujo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [punto, setPunto] = useState<PuntoFlujo | null>(null);
    const [detalle, setDetalle] = useState<Detalle | null>(null);

    const cargar = useCallback(async () => {
        try { setFlujo(await getFlujoFilas({ deviceId: deviceId || null, rango })); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo leer el flujo"); }
        finally { setCargando(false); }
    }, [deviceId, rango]);
    useEffect(() => { setCargando(true); cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);

    const filas = flujo?.filas || [];
    const filaVisor = filas.find((f) => f.id === deviceId) || filas[0] || null;
    const r = flujo?.resumen;

    return (
        <div className="p-6 space-y-5 max-w-[1680px] mx-auto">
            {/* Encabezado: título y, en la misma línea, los filtros. */}
            <div className="flex flex-wrap items-end gap-3">
                <div className="mr-auto">
                    <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Flujo de filas</h1>
                    <p className="text-[13px] text-muted-foreground">Aforo, entradas y salidas en el tiempo. Pasá por la gráfica para ver la foto de cada momento.</p>
                </div>
                {filas.length > 1 && (
                    <Pastillas valor={deviceId} alCambiar={setDeviceId} opciones={[{ k: "", rotulo: "Todas" }, ...filas.map((f) => ({ k: f.id, rotulo: f.name }))]} />
                )}
                <Pastillas valor={rango} alCambiar={(v) => setRango(v as Rango)} opciones={RANGOS.map((x) => ({ k: x.k, rotulo: x.rotulo }))} />
                <Button variant="ghost" size="sm" onClick={cargar} title="Actualizar"><RefreshCw size={14} /></Button>
            </div>

            {error && (
                <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-center gap-3 text-[13px]">
                    <TriangleAlert size={16} className="tono-mal" /> <span className="flex-1">{error}</span>
                    <Button size="sm" variant="outline" onClick={cargar}>Reintentar</Button>
                </div>
            )}

            {/* Contadores del rango. «Superó el límite» va primero y con tono: es lo que se vino a mirar. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
                <Cifra icono={TriangleAlert} rotulo="Superó el límite" valor={r?.vecesSobre ?? "—"} pie={r ? (r.vecesSobre === 1 ? "vez" : "veces") : ""} tono={r && r.vecesSobre > 0 ? "mal" : undefined} cargando={cargando && !flujo} />
                <Cifra icono={Timer} rotulo="Tiempo sobre el límite" valor={r ? duracion(r.sobreSeg) || "0 s" : "—"} cargando={cargando && !flujo} />
                <Cifra icono={TrendingUp} rotulo="Pico" valor={r?.pico ?? "—"} pie={r?.picoA ? `a las ${hora(r.picoA)}` : ""} cargando={cargando && !flujo} />
                <Cifra icono={Gauge} rotulo="Promedio" valor={r?.prom ?? "—"} pie="personas" cargando={cargando && !flujo} />
                <Cifra icono={ArrowDownToLine} rotulo="Entradas" valor={r?.entradas ?? "—"} cargando={cargando && !flujo} />
                <Cifra icono={ArrowUpFromLine} rotulo="Atendidos" valor={r?.salidas ?? "—"} pie="salidas" cargando={cargando && !flujo} />
                <Cifra icono={Activity} rotulo="Lecturas de aforo" valor={r?.lecturas ?? "—"} cargando={cargando && !flujo} />
            </div>

            {/* Gráfica + visor. El visor muestra el vivo, o la foto del punto donde está el mouse. */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
                <GraficaFlujo flujo={flujo} cargando={cargando && !flujo} alPasar={setPunto}
                    alElegir={(p) => p.foto && setDetalle({ foto: p.foto.ruta, t: p.foto.t, fila: filaVisor?.name || "", personas: p.foto.personas, limite: flujo?.limite ?? 0, titulo: "Foto del momento", siluetas: p.foto.siluetas })} />
                <Visor fila={filaVisor} punto={punto} limite={flujo?.limite ?? 0} tramoMs={flujo?.tramoMs ?? 0} />
            </div>

            <TablaEpisodios episodios={flujo?.episodios || []} cargando={cargando && !flujo} error={error} alReintentar={cargar}
                alAbrir={(e) => setDetalle({
                    foto: e.foto, t: e.picoA || e.desde, fila: e.fila, personas: e.pico, limite: e.limite, titulo: `Vez nº ${e.numero} sobre el límite`, siluetas: e.siluetas,
                    extra: <span>Desde {horaSeg(e.desde)} {e.hasta ? `hasta ${horaSeg(e.hasta)}` : "· sigue sobre el límite"} · {duracion(e.segundos) || "menos de 1 s"}</span>,
                })} />

            <TablaLecturas deviceId={deviceId} alAbrir={(l) => setDetalle({ foto: l.foto, t: l.t, fila: l.fila, personas: l.personas, limite: l.limite, canal: l.canal, titulo: "Lectura", siluetas: l.siluetas })} />

            <CajonDetalle detalle={detalle} alCerrar={() => setDetalle(null)} />
        </div>
    );
}

/* ── Piezas ─────────────────────────────────────────────────────────────────── */

function Pastillas({ valor, alCambiar, opciones }: { valor: string; alCambiar: (v: string) => void; opciones: { k: string; rotulo: string }[] }) {
    return (
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
            {opciones.map((o) => (
                <button key={o.k || "todas"} type="button" onClick={() => alCambiar(o.k)}
                    className={cn("rounded-full px-3 py-1 text-[12px] font-semibold transition-colors",
                        valor === o.k ? "bg-[var(--accion)] text-[var(--accion-texto)]" : "text-muted-foreground hover:text-foreground")}>
                    {o.rotulo}
                </button>
            ))}
        </div>
    );
}

function Cifra({ icono: I, rotulo, valor, pie, tono, cargando }: { icono: any; rotulo: string; valor: React.ReactNode; pie?: string; tono?: "mal"; cargando?: boolean }) {
    return (
        <div className={cn("rounded-[10px] border bg-card px-4 py-3", tono ? "border-[var(--mal)]/40 bg-[var(--mal-suave)]" : "border-border")}>
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><I size={13} className={tono ? "tono-mal" : ""} /> {rotulo}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
                {cargando ? <span className="h-7 w-12 rounded bg-muted animate-pulse" />
                    : <span className={cn("text-[24px] font-bold tabular-nums leading-none", tono && "tono-mal")}>{valor}</span>}
                {pie && !cargando && <span className="text-[11.5px] text-muted-foreground">{pie}</span>}
            </div>
        </div>
    );
}

/* ── La gráfica ─────────────────────────────────────────────────────────────── */

const W = 1000, H = 260, IZQ = 34, DER = 10, ARR = 14, ABA = 26;

function GraficaFlujo({ flujo, cargando, alPasar, alElegir }: {
    flujo: Flujo | null; cargando: boolean; alPasar: (p: PuntoFlujo | null) => void; alElegir: (p: PuntoFlujo) => void;
}) {
    const [modo, setModo] = useState<"aforo" | "flujo">("aforo");
    const [sobre, setSobre] = useState<number | null>(null);
    const [listo, setListo] = useState(false);
    const svg = useRef<SVGSVGElement>(null);
    useEffect(() => { setListo(false); const t = setTimeout(() => setListo(true), 60); return () => clearTimeout(t); }, [flujo?.rango, modo]);

    const puntos = flujo?.puntos || [];
    const N = Math.max(1, puntos.length);
    const limite = flujo?.limite ?? 0;
    const max = modo === "aforo"
        ? Math.max(4, limite + 1, ...puntos.map((p) => p.max))
        : Math.max(4, ...puntos.map((p) => Math.max(p.entradas, p.salidas)));
    const x = (i: number) => IZQ + (N > 1 ? i / (N - 1) : 0) * (W - IZQ - DER);
    const y = (v: number) => ARR + (1 - v / max) * (H - ARR - ABA);
    const base = y(0);

    const curva = (vals: number[]) => {
        if (vals.length < 2) return "";
        const pts = vals.map((v, i) => [x(i), y(v)]);
        let d = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
            // Catmull-Rom acotado: sin pasar por debajo de cero entre dos puntos en cero.
            const c1y = Math.min(base, p1[1] + (p2[1] - p0[1]) / 6), c2y = Math.min(base, p2[1] - (p3[1] - p1[1]) / 6);
            d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${c1y}, ${p2[0] - (p3[0] - p1[0]) / 6} ${c2y}, ${p2[0]} ${p2[1]}`;
        }
        return d;
    };
    const lPico = curva(puntos.map((p) => p.max));
    const lProm = curva(puntos.map((p) => p.prom));
    const area = lPico ? `${lPico} L ${x(N - 1)} ${base} L ${x(0)} ${base} Z` : "";

    const desde = puntos[0] ? new Date(puntos[0].t).getTime() : 0;
    const paso = flujo?.tramoMs || 1;
    const xT = (t: string | null) => x(Math.min(N - 1, Math.max(0, ((t ? new Date(t).getTime() : Date.now()) - desde) / paso)));
    const cadaEtiqueta = Math.max(1, Math.ceil(N / 8));
    const etiqueta = (t: string) => (flujo?.rango === "24h" ? hora(t) : fechaCorta(t));

    const mover = (ev: React.PointerEvent) => {
        if (!svg.current || !puntos.length) return;
        const rect = svg.current.getBoundingClientRect();
        const fx = ((ev.clientX - rect.left) / rect.width) * W;
        const i = Math.round(((fx - IZQ) / (W - IZQ - DER)) * (N - 1));
        const j = Math.min(N - 1, Math.max(0, i));
        setSobre(j); alPasar(puntos[j]);
    };
    const salir = () => { setSobre(null); alPasar(null); };
    const p = sobre != null ? puntos[sobre] : null;

    return (
        <div className="rounded-[14px] border border-border bg-card p-5 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-3">
                <Pastillas valor={modo} alCambiar={(v) => setModo(v as any)} opciones={[{ k: "aforo", rotulo: "Aforo" }, { k: "flujo", rotulo: "Entradas y salidas" }]} />
                <div className="ml-auto flex items-center gap-4 text-[11.5px] text-muted-foreground">
                    {modo === "aforo" ? (<>
                        <Leyenda clase="bg-[var(--accion)]">Pico</Leyenda>
                        <Leyenda clase="bg-foreground/50">Promedio</Leyenda>
                        <Leyenda clase="bg-[var(--mal)]" punteada>Límite {limite}</Leyenda>
                        {!!flujo?.cortes.length && <Leyenda clase="bg-[var(--mal-suave)]">Cámara sin datos</Leyenda>}
                    </>) : (<>
                        <Leyenda clase="bg-[var(--info)]">Entradas</Leyenda>
                        <Leyenda clase="bg-[var(--bien)]">Atendidos</Leyenda>
                    </>)}
                </div>
            </div>
            <div className="relative">
                {cargando && <div className="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground">Cargando…</div>}
                <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-none select-none" onPointerMove={mover} onPointerLeave={salir}
                    onClick={() => p && alElegir(p)} style={{ cursor: p?.foto ? "pointer" : "default" }}>
                    <defs>
                        <linearGradient id="flujo-pico" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--accion)" stopOpacity="0.32" />
                            <stop offset="100%" stopColor="var(--accion)" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                        <g key={g}>
                            <line x1={IZQ} x2={W - DER} y1={ARR + g * (H - ARR - ABA)} y2={ARR + g * (H - ARR - ABA)} className="stroke-border" strokeDasharray={g === 1 ? undefined : "3 5"} />
                            <text x={IZQ - 6} y={ARR + g * (H - ARR - ABA) + 3} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{Math.round(max * (1 - g))}</text>
                        </g>
                    ))}
                    {modo === "aforo" && (flujo?.cortes || []).map((c, i) => {
                        const a = xT(c.desde), b = xT(c.hasta);
                        return <rect key={i} x={a} y={ARR} width={Math.max(2, b - a)} height={base - ARR} fill="var(--mal-suave)" />;
                    })}
                    {modo === "aforo" ? (<>
                        {area && <path d={area} fill="url(#flujo-pico)" style={{ opacity: listo ? 1 : 0, transition: "opacity 900ms ease" }} />}
                        {lPico && <path d={lPico} fill="none" stroke="var(--accion)" strokeWidth={2.2} strokeLinejoin="round"
                            pathLength={1} strokeDasharray={1} strokeDashoffset={listo ? 0 : 1} style={{ transition: "stroke-dashoffset 1100ms ease" }} />}
                        {lProm && <path d={lProm} fill="none" className="stroke-foreground/50" strokeWidth={1.4} style={{ opacity: listo ? 1 : 0, transition: "opacity 900ms ease 200ms" }} />}
                        {limite > 0 && limite <= max && <line x1={IZQ} x2={W - DER} y1={y(limite)} y2={y(limite)} stroke="var(--mal)" strokeWidth={1.2} strokeDasharray="6 4" />}
                        {/* Dónde hay foto: una marca chica en el piso de la gráfica. */}
                        {puntos.map((q, i) => q.foto ? <rect key={i} x={x(i) - 1} y={base + 3} width={2} height={4} rx={1} className="fill-muted-foreground/60" /> : null)}
                    </>) : (
                        puntos.map((q, i) => {
                            const ancho = Math.max(1.5, ((W - IZQ - DER) / N) * 0.36);
                            const he = listo ? base - y(q.entradas) : 0, hs = listo ? base - y(q.salidas) : 0;
                            return (
                                <g key={i}>
                                    <rect x={x(i) - ancho} y={base - he} width={ancho} height={he} rx={1.5} fill="var(--info)" style={{ transition: "all 600ms ease" }} />
                                    <rect x={x(i)} y={base - hs} width={ancho} height={hs} rx={1.5} fill="var(--bien)" style={{ transition: "all 600ms ease" }} />
                                </g>
                            );
                        })
                    )}
                    {puntos.map((q, i) => i % cadaEtiqueta === 0 ? (
                        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px] tabular-nums">{etiqueta(q.t)}</text>
                    ) : null)}
                    {p && sobre != null && (
                        <g pointerEvents="none">
                            <line x1={x(sobre)} x2={x(sobre)} y1={ARR} y2={base} className="stroke-foreground/30" />
                            {modo === "aforo" && <circle cx={x(sobre)} cy={y(p.max)} r={4.5} fill="var(--accion)" className="stroke-card" strokeWidth={2} />}
                        </g>
                    )}
                </svg>
            </div>
            <div className="mt-1 min-h-[18px] text-[12px] text-muted-foreground tabular-nums">
                {p ? (
                    <span><b className="text-foreground">{etiqueta(p.t)}{flujo?.rango === "24h" ? "" : ` ${hora(p.t)}`}</b>
                        {modo === "aforo" ? ` · pico ${p.max} · promedio ${p.prom} · ${p.lecturas} lecturas` : ` · ${p.entradas} entradas · ${p.salidas} atendidos`}
                        {p.foto ? " · clic para abrir la foto" : " · sin foto en este tramo"}</span>
                ) : <span>Pasá el mouse por la gráfica: la foto de cada momento aparece al lado.</span>}
            </div>
        </div>
    );
}

function Leyenda({ clase, punteada, children }: { clase: string; punteada?: boolean; children: React.ReactNode }) {
    return <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-[3px] w-3.5 rounded-full", clase, punteada && "opacity-80")} />{children}</span>;
}

/* ── El visor: vivo, o la foto del punto ─────────────────────────────────────── */

function Visor({ fila, punto, limite, tramoMs }: { fila: { id: string; name: string; ip: string | null } | null; punto: PuntoFlujo | null; limite: number; tramoMs: number }) {
    const foto = punto?.foto || null;
    const t = foto ? tonoFila(foto.personas, limite) : null;
    return (
        <div className="rounded-[14px] border border-border bg-card overflow-hidden flex flex-col">
            <div className="relative aspect-video bg-black">
                {fila ? (
                    <>
                        <VivoConPlay deviceId={fila.id}>
                            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                            <video className="absolute inset-0 w-full h-full object-cover" autoPlay muted playsInline
                                src={fila.ip ? `/go2rtc/api/stream.mp4?src=${encodeURIComponent(nombreStreamFila(fila.ip))}` : undefined} />
                        </VivoConPlay>
                        {punto && (
                            <div className="absolute inset-0 z-30 bg-black">
                                {foto ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <>
                                        <img src={foto.ruta} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                        {!!foto.siluetas?.length && <DibujoPersonas personas={desdeGuardadas(foto.siluetas)} etiquetas={false} />}
                                    </>
                                ) : (
                                    <div className="absolute inset-0 grid place-items-center text-white/70 text-[12.5px] text-center px-6">
                                        <span className="flex flex-col items-center gap-2"><Camera size={20} /> Sin foto en este tramo</span>
                                    </div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 px-3 py-2.5 bg-gradient-to-t from-black/85 to-transparent flex items-end justify-between text-white">
                                    <div className="leading-tight">
                                        <div className="text-[12px] font-semibold tabular-nums">{foto ? horaSeg(foto.t) : hora(punto.t)} · {fechaCorta(foto?.t || punto.t)}</div>
                                        <div className="text-[10.5px] text-white/70">{foto ? "la foto con más gente del tramo" : `tramo de ${Math.round(tramoMs / 60_000)} min`}</div>
                                    </div>
                                    {foto && <span className={cn("text-[12px] font-bold px-2 py-0.5 rounded-full border tabular-nums", `chip-${t}`)}>{foto.personas} {foto.personas === 1 ? "persona" : "personas"}</span>}
                                </div>
                            </div>
                        )}
                    </>
                ) : <div className="absolute inset-0 grid place-items-center text-white/60 text-[12.5px]">Sin cámaras de fila</div>}
            </div>
            <div className="px-4 py-3 flex items-center gap-2 text-[12.5px]">
                <Users size={14} className="text-muted-foreground" />
                <span className="font-semibold truncate">{fila?.name || "—"}</span>
                <span className="ml-auto text-muted-foreground">{punto ? "Foto del momento" : "Vivo (pausado)"}</span>
            </div>
        </div>
    );
}

/* ── Veces sobre el límite ──────────────────────────────────────────────────── */

function TablaEpisodios({ episodios, cargando, error, alReintentar, alAbrir }: {
    episodios: Episodio[]; cargando: boolean; error: string | null; alReintentar: () => void; alAbrir: (e: Episodio) => void;
}) {
    const columnas: ColumnaTabla<Episodio>[] = [
        { clave: "n", titulo: "#", ancho: 60, alinear: "der", valor: (e) => e.numero, celda: (e) => <span className="tabular-nums font-semibold text-muted-foreground">{e.numero}</span> },
        { clave: "foto", titulo: "Foto", ancho: 100, auxiliar: true, celda: (e) => <Miniatura src={e.foto} alAbrir={() => alAbrir(e)} /> },
        { clave: "fila", titulo: "Fila", valor: (e) => e.fila, celda: (e) => <span className="font-semibold">{e.fila}</span> },
        { clave: "desde", titulo: "Llegó al límite", ancho: 140, valor: (e) => e.desde, celda: (e) => <Momento t={e.desde} /> },
        { clave: "hasta", titulo: "Bajó", ancho: 120, valor: (e) => e.hasta || "", celda: (e) => e.hasta ? <span className="tabular-nums">{horaSeg(e.hasta)}</span> : <Estado tono="mal">Sigue llena</Estado> },
        { clave: "dur", titulo: "Duración", ancho: 110, alinear: "der", valor: (e) => e.segundos, celda: (e) => <span className="tabular-nums">{duracion(e.segundos) || "< 1 s"}</span> },
        { clave: "pico", titulo: "Pico", ancho: 120, alinear: "der", valor: (e) => e.pico,
            celda: (e) => <span className="tabular-nums"><b className="tono-mal">{e.pico}</b><span className="text-muted-foreground"> / {e.limite}</span>{e.picoA && <span className="text-[11px] text-muted-foreground"> · {hora(e.picoA)}</span>}</span> },
    ];
    return (
        <section className="space-y-2">
            <div className="flex items-baseline gap-3">
                <h2 className="text-[17px] font-bold tracking-[-0.01em]">Veces que se superó el límite</h2>
                <span className={cn("text-[12px] font-bold px-2 py-0.5 rounded-full border tabular-nums", episodios.length ? "chip-mal" : "chip-bien")}>{episodios.length}</span>
                <span className="text-[12px] text-muted-foreground">Desde que la fila llega a su límite hasta que baja (bajadas de menos de un minuto no cortan).</span>
            </div>
            <Tabla<Episodio> id="flujo-episodios" filas={episodios} clave={(e) => `${e.deviceId}-${e.desde}`} columnas={columnas}
                cargando={cargando} error={error} alReintentar={alReintentar} alClickFila={alAbrir} filasFantasma={2} nombreArchivo="veces-sobre-el-limite"
                vacio={{ icono: TriangleAlert, titulo: "Ninguna fila llegó a su límite en este período", ayuda: "Cuando pase, cada vez queda acá con su foto." }} />
        </section>
    );
}

/* ── Lecturas ───────────────────────────────────────────────────────────────── */

function TablaLecturas({ deviceId, alAbrir }: { deviceId: string; alAbrir: (l: Lectura) => void }) {
    const [lecturas, setLecturas] = useState<Lectura[]>([]);
    const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [soloFoto, setSoloFoto] = useState(false);
    const [soloAforo, setSoloAforo] = useState(true);

    const traer = useCallback(async (pag: number) => {
        setCargando(true);
        try {
            const r = await getLecturasFilas({ deviceId: deviceId || null, soloConFoto: soloFoto, soloAforo, pagina: pag, porPagina: POR_PAGINA });
            setLecturas((prev) => (pag === 0 ? r.lecturas : [...prev, ...r.lecturas])); setTotal(r.total); setPagina(pag); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudieron leer las lecturas"); }
        finally { setCargando(false); }
    }, [deviceId, soloFoto, soloAforo]);
    useEffect(() => { traer(0); }, [traer]);

    const columnas: ColumnaTabla<Lectura>[] = useMemo(() => [
        { clave: "foto", titulo: "Foto", ancho: 100, auxiliar: true, celda: (l) => <Miniatura src={l.foto} alAbrir={l.foto ? () => alAbrir(l) : undefined} /> },
        { clave: "t", titulo: "Hora", ancho: 130, valor: (l) => l.t, celda: (l) => <Momento t={l.t} /> },
        { clave: "fila", titulo: "Fila", valor: (l) => l.fila },
        { clave: "canal", titulo: "Contador", ancho: 130, valor: (l) => l.canal },
        { clave: "p", titulo: "Personas", ancho: 110, alinear: "der", valor: (l) => l.personas,
            celda: (l) => <span className={cn("text-[16px] font-bold tabular-nums", esAforo(l) && `tono-${tonoFila(l.personas, l.limite)}`)}>{l.personas}</span> },
        { clave: "estado", titulo: "Estado", ancho: 110, valor: (l) => (esAforo(l) ? ROTULO_TONO[tonoFila(l.personas, l.limite)] : "Acumulado"),
            celda: (l) => esAforo(l) ? <Estado tono={tonoFila(l.personas, l.limite) as any}>{ROTULO_TONO[tonoFila(l.personas, l.limite)]}</Estado> : <span className="text-[11.5px] text-muted-foreground">acumulado</span> },
    ], [alAbrir]);

    return (
        <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-[17px] font-bold tracking-[-0.01em]">Lecturas</h2>
                <span className="text-[12px] text-muted-foreground tabular-nums">{total.toLocaleString("es-UY")} en total</span>
                <div className="ml-auto flex items-center gap-2">
                    <Pastillas valor={soloAforo ? "aforo" : "todo"} alCambiar={(v) => setSoloAforo(v === "aforo")} opciones={[{ k: "aforo", rotulo: "Sólo aforo" }, { k: "todo", rotulo: "Con entradas y salidas" }]} />
                    <Pastillas valor={soloFoto ? "si" : "no"} alCambiar={(v) => setSoloFoto(v === "si")} opciones={[{ k: "no", rotulo: "Todas" }, { k: "si", rotulo: "Con foto" }]} />
                    <Button variant="outline" size="sm" asChild className="gap-1.5"><Link href="/admin/capturas-filas"><Images size={14} /> Historial de capturas</Link></Button>
                </div>
            </div>
            <Tabla<Lectura> id="flujo-lecturas" filas={lecturas} clave={(l) => l.id} columnas={columnas} cargando={cargando && !lecturas.length}
                error={error} alReintentar={() => traer(0)} alClickFila={(l) => l.foto && alAbrir(l)} filasFantasma={4} nombreArchivo="lecturas-filas"
                masFilas={{ hay: lecturas.length < total, cargando, traer: () => traer(pagina + 1), modo: "boton" }}
                vacio={{ icono: Activity, titulo: "No hay lecturas", ayuda: soloFoto ? "Ninguna lectura con foto con estos filtros." : "La cámara todavía no mandó datos." }} />
        </section>
    );
}

const esAforo = (l: Lectura) => l.canal !== "Entrada" && l.canal !== "Salida";

