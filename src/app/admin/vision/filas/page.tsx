"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ListOrdered, Activity, Info, Plus, ArrowDownToLine, ArrowUpFromLine, Hourglass, Timer, Settings2, BellRing, ShieldAlert, Camera, X, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, ErrorEstado, Cargando, Vacio } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonCerrar, CajonContenido } from "@/components/ui/cajon";
import { useTiempoReal, useDestello } from "@/lib/tiempo-real";
import { bandaFila, type Punto } from "@/lib/vision-reglas";

/**
 * OmniVision › Filas: el aforo de las filas que cuenta OmniVision (reglas «Conteo de fila»).
 *
 * 19/10, Nico: «no quiero cambiar el modo de filas, quiero que copies lo que tiene ese modo para
 * desarrollar nuestra analítica de OmniVision». Esta pantalla es lo del Monitor de filas y los
 * reportes del modo Filas, para las filas de OmniVision y sin tocar aquel módulo.
 *
 * Refinada el mismo día («refiná esta analítica, mejorá todo lo que se te ocurra; la foto con la
 * escena debe ser sin marcos superiores»):
 *  · El cajón abre con la escena a sangre, sin la franja del título encima: el nombre y el cerrar
 *    van sobre la foto, en vidrio oscuro, y el aforo grande abajo, sobre la escena.
 *  · En vivo: el worker manda por socket dónde está el pie de cada persona y si cuenta; sobre la
 *    escena se ve un punto por persona (lleno si cuenta, hueco si no). Así se entiende POR QUÉ el
 *    número es el que es. El aforo también llega por socket, sin esperar la próxima vuelta.
 *  · La foto conserva la forma de la cámara (antes se recortaba a 16:9 y la zona dibujada se
 *    corría si la cámara no era 16:9), y se cambia sin parpadeo: la nueva se carga antes de
 *    reemplazar a la anterior.
 *  · La espera MEDIDA (cuánto estuvieron adentro los que salieron) al lado de la estimada del
 *    kiosco; desde cuándo está llena; el aforo promedio y máximo por hora, como los reportes; la
 *    curva con el valor y la hora al pasar el mouse; las llenas primero; un destello al cambiar.
 */

type Banda = "bien" | "aviso" | "mal";
type Fila = {
    id: string; nombre: string; deviceId: string; camara: string; activa: boolean; analiza: boolean;
    zona: Punto[] | null; limite: number | null; rebote: number; permanencia: number; escalarMin: number; enfrioMin: number; avisar: boolean;
    horario: { desde: string; hasta: string } | null; abierta: boolean; inicio: string;
    aforo: number; desde: string | null; banda: Banda; maximo: number; entradas: number; salidas: number; llenaDesde: string | null;
    porHora: { entran: number; salen: number }[]; aforoPorHora: ({ prom: number; max: number } | null)[];
    esperaMin: number | null; esperaMedidaMin: number | null; esperaMedidaN: number;
    serie: { t: string; v: number }[];
    avisos: { id: string; tipo: string; valor: number | null; ts: string; foto: string | null }[];
};
type Respuesta = { prendida: boolean; ventanaEsperaMin: number; ventanaMedidaMin: number; filas: Fila[] };
/** Lo que manda el worker cada segundo: el pie de cada persona (x, y, 1 si cuenta). */
type Vivo = { aforo: number | null; candidato: number | null; pies: [number, number, number][]; t: number };

const REFRESCO_MS = 10_000;
const FOTO_MS = 3_000;
/** Sin noticias del worker durante esto, los puntos en vivo se apagan (no se dibuja algo viejo). */
const VIVO_VIEJO_MS = 6_000;
const COLOR: Record<Banda, string> = { bien: "var(--bien)", aviso: "var(--aviso)", mal: "var(--mal)" };
const ROTULO_BANDA: Record<Banda, string> = { bien: "Con lugar", aviso: "Cerca del límite", mal: "Llena" };
const ORDEN_BANDA: Record<Banda, number> = { mal: 0, aviso: 1, bien: 2 };
const hora = (iso: string | number) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: "America/Montevideo" });
const hace = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)); return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };
const minutos = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${m.toLocaleString("es-UY", { maximumFractionDigits: 1 })} min`);
const CANAL = /^nvrch-([\w-]+)-(\d{1,4})$/;
function fotoCamara(id: string, w: number, t: number) {
    const m = CANAL.exec(id);
    return m ? `/api/monitor/camaras/foto?nvr=${encodeURIComponent(m[1])}&ch=${m[2]}&w=${w}&t=${t}` : `/api/snapshot/${id}?w=${w}&t=${t}`;
}

function Cifra({ n, rotulo, pista, tono }: { n: number | string; rotulo: string; pista: string; tono?: Banda }) {
    return (
        <Pista titulo={rotulo} texto={pista} ancho={280}>
            <span className="inline-flex items-baseline gap-1.5 px-3 py-2 cursor-help whitespace-nowrap">
                <b className={cn("text-[16px] tabular-nums leading-none", tono && `tono-${tono}`)}>{n}</b>
                <span className="text-[11.5px] text-muted-foreground">{rotulo}</span>
            </span>
        </Pista>
    );
}

/**
 * La escena: el cuadro de ahora, con la forma de la cámara, la zona del color de su banda y un
 * punto por persona. La foto nueva se carga aparte y reemplaza a la anterior ya decodificada.
 */
function Escena({ f, w, tic, vivo, children, className }: { f: Fila; w: number; tic: number; vivo?: Vivo; children?: React.ReactNode; className?: string }) {
    const [src, setSrc] = useState<string | null>(null);
    const [aspecto, setAspecto] = useState(16 / 9);
    const [falla, setFalla] = useState(false);
    useEffect(() => {
        const url = fotoCamara(f.deviceId, w, tic);
        const im = new Image();
        im.onload = () => { setSrc(url); setFalla(false); if (im.naturalWidth && im.naturalHeight) setAspecto(im.naturalWidth / im.naturalHeight); };
        im.onerror = () => setFalla(true);
        im.src = url;
        return () => { im.onload = null; im.onerror = null; };
    }, [f.deviceId, w, tic]);
    const pies = vivo && Date.now() - vivo.t < VIVO_VIEJO_MS ? vivo.pies : [];
    return (
        <div className={cn("relative bg-black overflow-hidden", className)} style={{ aspectRatio: aspecto }}>
            {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="absolute inset-0 w-full h-full" />
            ) : !falla ? <span className="absolute inset-0 animate-pulse bg-white/5" /> : null}
            {falla && !src && <Camera size={20} className="absolute inset-0 m-auto text-white/30" />}
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                {f.zona && f.zona.length >= 3 && (
                    <polygon points={f.zona.map(([x, y]) => `${x},${y}`).join(" ")} fill={COLOR[f.banda]} fillOpacity={0.16} stroke={COLOR[f.banda]} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                )}
            </svg>
            {/* Los pies en HTML y no en el SVG estirado: así son círculos y no óvalos. */}
            {pies.map(([x, y, cuenta], i) => (
                <span key={i} className="absolute h-2.5 w-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-black/60 transition-[left,top] duration-700"
                    style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: cuenta ? COLOR[f.banda] : "transparent", boxShadow: cuenta ? undefined : "inset 0 0 0 2px rgba(255,255,255,.85)" }} />
            ))}
            {children}
        </div>
    );
}

/** El aforo contra el límite, como barra, con la marca del 70 %. */
function Medidor({ f, aforo, alto = 6 }: { f: Fila; aforo: number; alto?: number }) {
    const lim = f.limite || Math.max(1, f.maximo);
    return (
        <span className="relative block w-full rounded-full bg-white/20 overflow-hidden" style={{ height: alto }}>
            <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(1, aforo / lim) * 100}%`, background: COLOR[f.banda] }} />
            {f.limite && <span className="absolute inset-y-0 w-px bg-white/60" style={{ left: "70%" }} />}
        </span>
    );
}

/** La curva desde que abrió: el aforo en escalones y el límite punteado. Con `tocable`, valor y hora al pasar el mouse. */
function Curva({ f, alto = 44, tocable = false }: { f: Fila; alto?: number; tocable?: boolean }) {
    const ancho = 600;
    const caja = useRef<HTMLDivElement>(null);
    const [mira, setMira] = useState<{ x: number; t: number; v: number } | null>(null);
    const t0 = new Date(f.inicio).getTime(), t1 = Date.now();
    const tope = Math.max(1, f.limite || 0, f.maximo) * 1.1;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * ancho;
    const y = (v: number) => alto - (v / tope) * (alto - 3) - 1.5;
    const puntos = f.serie.map((p) => ({ t: Math.max(t0, new Date(p.t).getTime()), v: p.v }));
    const pts: string[] = [];
    puntos.forEach((p, i) => {
        if (i) pts.push(`${x(p.t).toFixed(1)},${y(puntos[i - 1].v).toFixed(1)}`);
        pts.push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
    });
    if (puntos.length) pts.push(`${ancho},${y(puntos[puntos.length - 1].v).toFixed(1)}`);
    const mover = (e: React.MouseEvent) => {
        const r = caja.current?.getBoundingClientRect(); if (!r || !puntos.length) return;
        const fr = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), t = t0 + fr * (t1 - t0);
        let p = puntos[0]; for (const q of puntos) { if (q.t <= t) p = q; else break; }
        setMira({ x: fr, t, v: p.v });
    };
    return (
        <div ref={caja} className="relative" onMouseMove={tocable ? mover : undefined} onMouseLeave={() => setMira(null)}>
            <svg viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" className="block w-full" style={{ height: alto }} aria-label="El aforo desde que abrió">
                {tocable && [0.25, 0.5, 0.75].map((k) => <line key={k} x1={0} x2={ancho} y1={alto * k} y2={alto * k} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
                {f.limite && <line x1={0} x2={ancho} y1={y(f.limite)} y2={y(f.limite)} stroke="var(--mal)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
                {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke="var(--accion)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
                {mira && <line x1={mira.x * ancho} x2={mira.x * ancho} y1={0} y2={alto} stroke="var(--muted-foreground)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            </svg>
            {mira && (
                <span className="absolute -top-1 -translate-y-full px-2 py-1 rounded-md bg-popover text-popover-foreground border border-border text-[11.5px] tabular-nums whitespace-nowrap pointer-events-none"
                    style={{ left: `${mira.x * 100}%`, transform: `translate(${mira.x > 0.8 ? "-100%" : mira.x < 0.2 ? "0" : "-50%"}, -100%)` }}>
                    <b>{mira.v}</b> {mira.v === 1 ? "persona" : "personas"} · {hora(mira.t)}
                </span>
            )}
        </div>
    );
}

function Tarjeta({ f, aforo, tic, vivo, destello, alAbrir }: { f: Fila; aforo: number; tic: number; vivo?: Vivo; destello: boolean; alAbrir: () => void }) {
    return (
        <button type="button" onClick={alAbrir}
            className={cn("group text-left rounded-[10px] border border-border bg-card overflow-hidden outline-none hover:border-[var(--accion)] focus-visible:ring-2 focus-visible:ring-[var(--accion)] transition-[border-color,box-shadow]",
                (!f.activa || !f.analiza) && "opacity-60", f.banda === "mal" && f.abierta && "ring-2 ring-[var(--mal)]", destello && "ring-2 ring-[var(--accion)]")}>
            <Escena f={f} w={480} tic={tic} vivo={vivo}>
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold max-w-[62%]"><ListOrdered size={12} className="shrink-0" /> <span className="truncate">{f.nombre}</span></span>
                <span className={cn("absolute right-2 top-2 inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold", f.abierta ? "bg-black/60 text-white backdrop-blur-sm" : "bg-white/85 text-black")}>
                    {f.horario ? (f.abierta ? `abierta · hasta ${f.horario.hasta}` : `cerrada · abre ${f.horario.desde}`) : "siempre"}
                </span>
                <span className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-8 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-1.5">
                    <span className="flex items-baseline gap-1.5 text-white">
                        <b className="text-[26px] leading-none tabular-nums">{aforo}</b>
                        {f.limite && <span className="text-[13px] text-white/70 tabular-nums">/ {f.limite}</span>}
                        <span className="ml-auto text-[11.5px] font-semibold" style={{ color: COLOR[f.banda] }}>{ROTULO_BANDA[f.banda]}{f.llenaDesde ? ` · ${hace(f.llenaDesde)}` : ""}</span>
                    </span>
                    <Medidor f={f} aforo={aforo} />
                </span>
            </Escena>
            <span className="grid grid-cols-4 divide-x divide-border border-b border-border text-center">
                <Mini icono={ArrowDownToLine} n={f.entradas} r="entraron" />
                <Mini icono={ArrowUpFromLine} n={f.salidas} r="salieron" />
                <Mini icono={Hourglass} n={f.esperaMedidaMin != null ? minutos(f.esperaMedidaMin) : f.esperaMin != null ? `~${f.esperaMin} min` : "—"} r={f.esperaMedidaMin != null ? "espera" : "espera est."} />
                <Mini icono={Activity} n={f.maximo} r="máximo" />
            </span>
            <span className="block px-2.5 pt-2 pb-1"><Curva f={f} /></span>
            <span className="flex items-center gap-1.5 px-2.5 pb-2 text-[11px] text-muted-foreground min-w-0">
                <span className="truncate">{f.camara}</span>
                {!f.analiza && <span className="shrink-0 tono-aviso font-semibold">· OmniVision no la mira</span>}
                {!f.activa && <span className="shrink-0 font-semibold">· apagada</span>}
                <span className="ml-auto shrink-0 tabular-nums">{f.desde ? `cambió ${hora(f.desde)}` : "sin datos"}</span>
            </span>
        </button>
    );
}

function Mini({ icono: I, n, r }: { icono: typeof Timer; n: number | string; r: string }) {
    return (
        <span className="py-2 px-1 min-w-0">
            <b className="block text-[14px] tabular-nums leading-tight truncate">{n}</b>
            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><I size={10} className="shrink-0" /> {r}</span>
        </span>
    );
}

/** Barras por hora, para las horas que tienen algo. `series`: dos valores por hora con su color. */
function PorHora({ horas, series, vacio }: {
    horas: { h: number; a: number; b: number; titulo: string }[];
    series: [{ rotulo: string; clase: string }, { rotulo: string; clase: string }];
    vacio: string;
}) {
    const con = horas.filter((x) => x.a || x.b);
    if (!con.length) return <p className="text-[12.5px] text-muted-foreground">{vacio}</p>;
    const desde = Math.min(...con.map((x) => x.h)), hasta = Math.max(...con.map((x) => x.h));
    const rango = horas.filter((x) => x.h >= desde && x.h <= hasta);
    const max = Math.max(1, ...rango.map((x) => Math.max(x.a, x.b)));
    return (
        <div>
            <div className="flex items-end gap-1 h-24">
                {rango.map((x) => (
                    <div key={x.h} className="flex-1 h-full flex items-end justify-center gap-[2px]" title={x.titulo}>
                        <span className={cn("w-[42%] max-w-3 rounded-t-[3px]", series[0].clase)} style={{ height: `${(x.a / max) * 100}%`, minHeight: x.a ? 2 : 0 }} />
                        <span className={cn("w-[42%] max-w-3 rounded-t-[3px]", series[1].clase)} style={{ height: `${(x.b / max) * 100}%`, minHeight: x.b ? 2 : 0 }} />
                    </div>
                ))}
            </div>
            <div className="flex gap-1 mt-1">{rango.map((x) => <span key={x.h} className="flex-1 text-center text-[10px] text-muted-foreground tabular-nums">{x.h}</span>)}</div>
            <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
                {series.map((s) => <span key={s.rotulo} className="inline-flex items-center gap-1"><span className={cn("h-2 w-2 rounded-[2px]", s.clase)} /> {s.rotulo}</span>)}
            </div>
        </div>
    );
}

function CajonFila({ f, aforo, tic, vivo, datos, alCerrar }: { f: Fila | null; aforo: number; tic: number; vivo?: Vivo; datos: Respuesta; alCerrar: () => void }) {
    if (!f) return null;
    const enVivo = !!vivo && Date.now() - vivo.t < VIVO_VIEJO_MS;
    const horasFlujo = f.porHora.map((x, h) => ({ h, a: x.entran, b: x.salen, titulo: `${String(h).padStart(2, "0")} h: ${x.entran} entraron · ${x.salen} salieron` }));
    const horasAforo = f.aforoPorHora.map((x, h) => ({ h, a: x?.prom ?? 0, b: x?.max ?? 0, titulo: x ? `${String(h).padStart(2, "0")} h: ${x.prom.toLocaleString("es-UY")} en promedio · máximo ${x.max}` : "" }));
    return (
        <Cajon open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" sinCabecera titulo={f.nombre} descripcion={`${f.camara} · ${aforo} personas`}
                pie={<Link href="/admin/vision/reglas" className="h-9 px-3.5 rounded-[8px] border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent"><Settings2 size={14} /> Cambiar en Reglas</Link>}>
                {/* La escena a sangre, arriba de todo: el título y el cerrar van sobre ella. */}
                <Escena f={f} w={1280} tic={tic} vivo={vivo}>
                    <span className="absolute inset-x-0 top-0 px-4 pt-3 pb-8 bg-gradient-to-b from-black/70 to-transparent flex items-start gap-3">
                        <span className="min-w-0 flex-1 text-white">
                            <span className="block text-[16px] font-bold leading-tight truncate">{f.nombre}</span>
                            <span className="block text-[12px] text-white/75 truncate">{f.camara} · {f.horario ? `atiende de ${f.horario.desde} a ${f.horario.hasta}` : "sin horario"} · cuenta desde {hora(f.inicio)}{dia(f.inicio) !== dia(new Date().toISOString()) ? ` del ${dia(f.inicio)}` : ""}</span>
                        </span>
                        <CajonCerrar className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/55 backdrop-blur-sm text-white hover:bg-black/75" aria-label="Cerrar"><X size={16} /></CajonCerrar>
                    </span>
                    <span className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-10 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-2">
                        <span className="flex items-end gap-2 text-white">
                            <b className="text-[44px] leading-[0.9] tabular-nums">{aforo}</b>
                            {f.limite && <span className="text-[15px] text-white/70 tabular-nums mb-0.5">/ {f.limite}</span>}
                            <span className="ml-auto flex flex-col items-end gap-1">
                                <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-bold text-black" style={{ background: COLOR[f.banda] }}>
                                    {ROTULO_BANDA[f.banda]}{!f.abierta ? " · fuera de horario" : ""}
                                </span>
                                <span className="text-[11.5px] text-white/75 tabular-nums">
                                    {f.llenaDesde ? `llena desde las ${hora(f.llenaDesde)} (${hace(f.llenaDesde)})` : f.desde ? `cambió a las ${hora(f.desde)}` : "sin datos"}
                                </span>
                            </span>
                        </span>
                        <Medidor f={f} aforo={aforo} alto={7} />
                    </span>
                    {enVivo && (
                        <span className="absolute right-4 top-14 inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] font-semibold">
                            <Radio size={12} className="text-[var(--bien)]" /> en vivo{vivo!.candidato != null && vivo!.candidato !== aforo ? ` · ve ${vivo!.candidato}` : ""}
                        </span>
                    )}
                </Escena>
                <div className="px-6 py-5 space-y-5">
                    <div className="grid grid-cols-5 rounded-[10px] border border-border divide-x divide-border text-center">
                        <Mini icono={ArrowDownToLine} n={f.entradas} r="entraron" />
                        <Mini icono={ArrowUpFromLine} n={f.salidas} r="salieron" />
                        <Mini icono={Timer} n={f.esperaMedidaMin != null ? minutos(f.esperaMedidaMin) : "—"} r="espera medida" />
                        <Mini icono={Hourglass} n={f.esperaMin != null ? `~${f.esperaMin} min` : "—"} r="espera estimada" />
                        <Mini icono={Activity} n={f.maximo} r="máximo" />
                    </div>
                    <p className="text-[11.5px] text-muted-foreground leading-snug -mt-2">
                        <b className="font-semibold">Medida:</b> la mediana de cuánto estuvieron en la zona los que salieron en los últimos {datos.ventanaMedidaMin} min{f.esperaMedidaN ? ` (${f.esperaMedidaN})` : ""}. <b className="font-semibold">Estimada:</b> la del kiosco de Filas, las {aforo} de la fila al ritmo de salidas de los últimos {datos.ventanaEsperaMin} min.
                    </p>

                    <section className="space-y-2">
                        <Titulo texto="El aforo desde que abrió" pista={`La línea punteada es el límite (${f.limite ?? "—"}). Cada escalón es un cambio que se sostuvo el tiempo de rebote (${f.rebote} s). Pasá el mouse para ver el valor y la hora.`} />
                        <div className="rounded-[10px] border border-border p-2.5 pt-3">
                            <Curva f={f} alto={120} tocable />
                            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-1"><span>{hora(f.inicio)}</span><span>ahora</span></div>
                        </div>
                    </section>

                    <section className="space-y-2">
                        <Titulo texto="Aforo por hora" pista="Como los reportes de Filas: el promedio (pesado por el tiempo) y el máximo de cada hora, desde la apertura." />
                        <PorHora horas={horasAforo} series={[{ rotulo: "promedio", clase: "bg-[var(--accion)]" }, { rotulo: "máximo", clase: "bg-muted-foreground/45" }]} vacio="Todavía no hay horas con aforo." />
                    </section>

                    <section className="space-y-2">
                        <Titulo texto="Entradas y salidas por hora" pista="Las personas que cruzaron el borde de la zona hacia adentro (entraron) o hacia afuera (salieron), desde la apertura." />
                        <PorHora horas={horasFlujo} series={[{ rotulo: "entraron", clase: "bg-[var(--accion)]" }, { rotulo: "salieron", clase: "bg-muted-foreground/45" }]} vacio="Nadie cruzó el borde de la zona desde que abrió." />
                    </section>

                    <section className="space-y-2">
                        <Titulo texto="Avisos" pista="Fila llena (a la guardia) y supervisor (si siguió llena), de los últimos 7 días." />
                        {!f.avisos.length ? <p className="text-[12.5px] text-muted-foreground">{f.avisar ? "No llegó al límite en los últimos 7 días." : "La regla no avisa: prendé «Avisar» en Reglas."}</p> : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {f.avisos.map((a) => (
                                    <a key={a.id} href={a.foto || undefined} target="_blank" rel="noreferrer" className="relative block aspect-video rounded-[8px] overflow-hidden bg-black">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {a.foto && <img src={`${a.foto}?w=320`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                                        <span className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-5 bg-gradient-to-t from-black/90 to-transparent text-white text-[11px] font-semibold flex items-center gap-1">
                                            {a.tipo === "FILA_ESCALADA" ? <ShieldAlert size={11} /> : <BellRing size={11} />}
                                            <span className="truncate">{a.tipo === "FILA_ESCALADA" ? "Supervisor" : "Llena"} · {a.valor}</span>
                                            <span className="ml-auto tabular-nums text-white/75">{dia(a.ts) !== dia(new Date().toISOString()) ? `${dia(a.ts)} ` : ""}{hora(a.ts)}</span>
                                        </span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </section>

                    <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                        <dt className="text-muted-foreground">Límite</dt><dd className="tabular-nums">{f.limite ?? "—"} personas (aviso desde el 70 %)</dd>
                        <dt className="text-muted-foreground">Rebote</dt><dd className="tabular-nums">{f.rebote} s</dd>
                        <dt className="text-muted-foreground">Cuenta desde</dt><dd className="tabular-nums">{f.permanencia ? `${f.permanencia} s adentro de la zona` : "que entra a la zona"}</dd>
                        <dt className="text-muted-foreground">Avisa</dt><dd>{f.avisar ? `a la guardia al llegar · al supervisor a los ${f.escalarMin} min llena · cada ${f.enfrioMin} min como mucho` : "no"}</dd>
                        <dt className="text-muted-foreground">Horario</dt><dd>{f.horario ? `${f.horario.desde} a ${f.horario.hasta}; al abrir empiezan de cero las entradas y salidas` : "siempre; las entradas y salidas son del día"}</dd>
                    </dl>
                </div>
            </CajonContenido>
        </Cajon>
    );
}

function Titulo({ texto, pista }: { texto: string; pista: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground">{texto}</span>
            <Pista titulo={texto} texto={pista} ancho={300}><Info size={12} className="text-muted-foreground/60 cursor-help" /></Pista>
        </div>
    );
}

export default function FilasVision() {
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<string | null>(null);
    const [tic, setTic] = useState(() => Date.now());
    /** El aforo que llegó por socket, más nuevo que el de la última vuelta. */
    const [aforoVivo, setAforoVivo] = useState<Record<string, number>>({});
    const [vivo, setVivo] = useState<Record<string, Vivo>>({});
    const { nuevas: cambiaron, marcar } = useDestello(2500);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/filas", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null); setAforoVivo({});
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);
    useEffect(() => { const iv = setInterval(() => setTic(Date.now()), FOTO_MS); return () => clearInterval(iv); }, []);
    // Un cambio de aforo: se muestra ya, destella, y se pide la vuelta (curva, banda, avisos) enseguida.
    const pedir = useRef<ReturnType<typeof setTimeout> | null>(null);
    useTiempoReal<{ reglaId: string; valor: number }>("vision_fila", (d) => {
        if (!d?.reglaId) return;
        setAforoVivo((a) => ({ ...a, [d.reglaId]: d.valor }));
        marcar(d.reglaId);
        if (pedir.current) clearTimeout(pedir.current);
        pedir.current = setTimeout(() => void cargar(), 800);
    });
    useTiempoReal<{ reglaId: string; aforo: number | null; candidato: number | null; pies: [number, number, number][] }>("vision_fila_vivo", (d) => {
        if (d?.reglaId) setVivo((v) => ({ ...v, [d.reglaId]: { aforo: d.aforo, candidato: d.candidato, pies: d.pies || [], t: Date.now() } }));
    });

    const filas = useMemo(() => {
        // El aforo que llegó por socket manda sobre el de la vuelta, y con él la banda.
        const l = (datos?.filas || []).map((f) => (aforoVivo[f.id] == null ? f : { ...f, aforo: aforoVivo[f.id], banda: bandaFila(aforoVivo[f.id], f.limite) }));
        // Las llenas primero, después las que están cerca; las demás, en el orden de las reglas.
        return l.sort((a, b) => Number(!a.activa) - Number(!b.activa) || (a.abierta && b.abierta ? ORDEN_BANDA[a.banda] - ORDEN_BANDA[b.banda] : Number(!a.abierta) - Number(!b.abierta)));
    }, [datos, aforoVivo]);

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las filas…" /></div>;

    const aforoDe = (f: Fila) => f.aforo;
    const vivas = filas.filter((f) => f.activa);
    const abiertas = vivas.filter((f) => f.abierta);
    const ahora = abiertas.reduce((s, f) => s + aforoDe(f), 0);
    const llenas = abiertas.filter((f) => f.banda === "mal").length;
    const cerca = abiertas.filter((f) => f.banda === "aviso").length;
    const entradas = vivas.reduce((s, f) => s + f.entradas, 0), salidas = vivas.reduce((s, f) => s + f.salidas, 0);
    const fila = filas.find((f) => f.id === abierta) || null;

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-2.5 flex-wrap">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted shrink-0"><ListOrdered size={16} /></span>
                <h1 className="text-[17px] font-bold leading-tight">Filas</h1>
                <Pista titulo="Qué es esto" ancho={340} texto="El aforo de las filas que cuenta OmniVision, como la analítica de aforo de las cámaras Bosch del modo Filas pero con cualquier cámara: cuántas personas hay en la zona, cuántas entraron y salieron, cuánto esperaron y los avisos al llegar al límite. Sobre la escena, un punto por persona: lleno si cuenta, hueco si no. Cada fila es una regla «Conteo de fila» de Visión → Reglas.">
                    <Info size={15} className="text-muted-foreground cursor-help" />
                </Pista>
                {datos.prendida ? <Chip tono="bien" icono={Activity}>Prendida</Chip> : <Chip tono="quieto">Apagada en Analíticas</Chip>}
                <Link href="/admin/vision/reglas?nueva=fila" className="ml-auto h-8 px-3 rounded-[8px] bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"><Plus size={14} /> Nueva fila</Link>
            </div>

            {filas.length > 0 && (
                <section className="rounded-[10px] border border-border bg-card flex flex-wrap items-center divide-x divide-border">
                    <Cifra n={`${abiertas.length}/${vivas.length}`} rotulo="abiertas" pista="Filas prendidas y dentro de su horario de atención." />
                    <Cifra n={ahora} rotulo="personas ahora" pista="La suma del aforo de las filas abiertas." />
                    <Cifra n={llenas} rotulo="llenas" tono={llenas ? "mal" : undefined} pista="En el límite o más." />
                    <Cifra n={cerca} rotulo="cerca del límite" tono={cerca ? "aviso" : undefined} pista="Del 70 % del límite para arriba." />
                    <Cifra n={entradas} rotulo="entraron" pista="Desde la apertura de cada fila (o desde la medianoche, sin horario)." />
                    <Cifra n={salidas} rotulo="salieron" pista="Desde la apertura de cada fila (o desde la medianoche, sin horario)." />
                </section>
            )}

            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-2.5 text-[12.5px] text-[var(--mal-texto)]">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
            {filas.length === 0 ? (
                <Vacio icono={ListOrdered} titulo="Todavía no hay filas" ayuda="Creá una regla «Conteo de fila» en Visión → Reglas: elegís la cámara, dibujás la zona de la fila y le ponés el límite." />
            ) : (
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
                    {filas.map((f) => <Tarjeta key={f.id} f={f} aforo={aforoDe(f)} tic={tic} vivo={vivo[f.id]} destello={cambiaron.has(f.id)} alAbrir={() => setAbierta(f.id)} />)}
                </div>
            )}

            <CajonFila f={fila} aforo={fila ? aforoDe(fila) : 0} tic={tic} vivo={fila ? vivo[fila.id] : undefined} datos={datos} alCerrar={() => setAbierta(null)} />
        </div>
    );
}
