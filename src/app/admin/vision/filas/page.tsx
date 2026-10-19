"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ListOrdered, Activity, Info, Plus, ArrowDownToLine, ArrowUpFromLine, Hourglass, Clock, Settings2, BellRing, ShieldAlert, CheckCircle2, TriangleAlert, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, ErrorEstado, Cargando, Vacio } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import type { Punto } from "@/lib/vision-reglas";

/**
 * OmniVision › Filas: el aforo de las filas que cuenta OmniVision (reglas «Conteo de fila»).
 *
 * 19/10, Nico: «ya tenemos el modo fila con cámaras Bosch hecho en un modo dedicado; no quiero
 * cambiar el modo de filas, quiero que copies lo que tiene ese modo para desarrollar nuestra
 * analítica de OmniVision». Esta pantalla es lo del Monitor de filas y los reportes del modo
 * Filas, para las filas de OmniVision y sin tocar aquel módulo:
 *  · cada fila con su cuadro en vivo y la zona pintada según la banda (bien / aviso / llena),
 *    el aforo contra el límite, las entradas y salidas desde que abrió, la espera estimada;
 *  · el cajón con la curva del día contra el límite, el flujo por hora, los avisos con su foto
 *    y cómo está configurada (límite, rebote, supervisor, horario).
 * Se configura en Visión → Reglas. Se refresca cada REFRESCO_MS; la foto, cada FOTO_MS.
 */

type Banda = "bien" | "aviso" | "mal";
type Fila = {
    id: string; nombre: string; deviceId: string; camara: string; activa: boolean; analiza: boolean;
    zona: Punto[] | null; limite: number | null; rebote: number; escalarMin: number; enfrioMin: number; avisar: boolean;
    horario: { desde: string; hasta: string } | null; abierta: boolean; inicio: string;
    aforo: number; desde: string | null; banda: Banda; maximo: number; entradas: number; salidas: number;
    porHora: { entran: number; salen: number }[]; esperaMin: number | null;
    serie: { t: string; v: number }[];
    avisos: { id: string; tipo: string; valor: number | null; ts: string; foto: string | null }[];
};
type Respuesta = { prendida: boolean; ventanaEsperaMin: number; filas: Fila[] };

const REFRESCO_MS = 5_000;
const FOTO_MS = 5_000;
const COLOR: Record<Banda, string> = { bien: "var(--bien)", aviso: "var(--aviso)", mal: "var(--mal)" };
const ROTULO_BANDA: Record<Banda, string> = { bien: "Con lugar", aviso: "Cerca del límite", mal: "Llena" };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: "America/Montevideo" });
const CANAL = /^nvrch-([\w-]+)-(\d{1,4})$/;
/** El cuadro de ahora de la cámara (un canal de NVR sale por el monitor de cámaras). */
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

/** El cuadro en vivo con la zona de la fila pintada del color de su banda. */
function Cuadro({ f, w, tic, className }: { f: Fila; w: number; tic: number; className?: string }) {
    const [ok, setOk] = useState(true);
    return (
        <span className={cn("relative block bg-black overflow-hidden", className)}>
            {ok ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fotoCamara(f.deviceId, w, tic)} alt="" className="absolute inset-0 w-full h-full object-cover" onError={() => setOk(false)} onLoad={() => setOk(true)} />
            ) : <Camera size={20} className="absolute inset-0 m-auto text-white/30" />}
            {f.zona && f.zona.length >= 3 && (
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                    <polygon points={f.zona.map(([x, y]) => `${x},${y}`).join(" ")} fill={COLOR[f.banda]} fillOpacity={0.18} stroke={COLOR[f.banda]} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </svg>
            )}
        </span>
    );
}

/** El aforo contra el límite, como barra: con las marcas del 70 % y del 100 %. */
function Medidor({ f, alto = 6 }: { f: Fila; alto?: number }) {
    const lim = f.limite || Math.max(1, f.maximo);
    const pct = Math.min(1, f.aforo / lim);
    return (
        <span className="relative block w-full rounded-full bg-white/20 overflow-hidden" style={{ height: alto }}>
            <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: COLOR[f.banda] }} />
            {f.limite && <span className="absolute inset-y-0 w-px bg-white/50" style={{ left: "70%" }} />}
        </span>
    );
}

/** La curva de hoy: el aforo en escalones, con la línea del límite. */
function Curva({ f, alto = 44, ejes = false }: { f: Fila; alto?: number; ejes?: boolean }) {
    const ancho = 600;
    const t0 = new Date(f.inicio).getTime(), t1 = Date.now();
    const tope = Math.max(1, f.limite || 0, f.maximo) * 1.1;
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * ancho;
    const y = (v: number) => alto - (v / tope) * (alto - 2) - 1;
    const pts: string[] = [];
    let ant: number | null = null;
    for (const p of f.serie) {
        const tx = x(Math.max(t0, new Date(p.t).getTime()));
        if (ant != null) pts.push(`${tx.toFixed(1)},${y(ant).toFixed(1)}`);
        pts.push(`${tx.toFixed(1)},${y(p.v).toFixed(1)}`);
        ant = p.v;
    }
    if (ant != null) pts.push(`${ancho},${y(ant).toFixed(1)}`);
    return (
        <svg viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" className="block w-full" style={{ height: alto }} aria-label="Aforo de hoy">
            {ejes && [0.25, 0.5, 0.75].map((k) => <line key={k} x1={0} x2={ancho} y1={alto * k} y2={alto * k} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            {f.limite && <line x1={0} x2={ancho} y1={y(f.limite)} y2={y(f.limite)} stroke="var(--mal)" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
            {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke="var(--accion)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        </svg>
    );
}

function Tarjeta({ f, tic, alAbrir }: { f: Fila; tic: number; alAbrir: () => void }) {
    return (
        <button type="button" onClick={alAbrir}
            className={cn("group text-left rounded-[10px] border border-border bg-card overflow-hidden outline-none hover:border-[var(--accion)] focus-visible:ring-2 focus-visible:ring-[var(--accion)] transition-colors",
                (!f.activa || !f.analiza) && "opacity-60", f.banda === "mal" && f.abierta && "ring-2 ring-[var(--mal)]")}>
            <span className="relative block">
                <Cuadro f={f} w={480} tic={tic} className="aspect-video" />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold max-w-[70%] truncate"><ListOrdered size={12} /> {f.nombre}</span>
                <span className={cn("absolute right-2 top-2 inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold", f.abierta ? "bg-black/60 text-white backdrop-blur-sm" : "bg-white/85 text-black")}>
                    {f.horario ? (f.abierta ? `abierta · hasta ${f.horario.hasta}` : `cerrada · abre ${f.horario.desde}`) : "siempre"}
                </span>
                <span className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-8 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-1.5">
                    <span className="flex items-baseline gap-1.5 text-white">
                        <b className="text-[26px] leading-none tabular-nums">{f.aforo}</b>
                        {f.limite && <span className="text-[13px] text-white/70 tabular-nums">/ {f.limite}</span>}
                        <span className="ml-auto text-[11.5px] font-semibold" style={{ color: COLOR[f.banda] }}>{ROTULO_BANDA[f.banda]}</span>
                    </span>
                    <Medidor f={f} />
                </span>
            </span>
            <span className="grid grid-cols-4 divide-x divide-border border-b border-border text-center">
                <Mini icono={ArrowDownToLine} n={f.entradas} r="entraron" />
                <Mini icono={ArrowUpFromLine} n={f.salidas} r="salieron" />
                <Mini icono={Hourglass} n={f.esperaMin != null ? `~${f.esperaMin}′` : "—"} r="espera" />
                <Mini icono={Activity} n={f.maximo} r="máx. hoy" />
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

function Mini({ icono: I, n, r }: { icono: typeof Clock; n: number | string; r: string }) {
    return (
        <span className="py-2 px-1 min-w-0">
            <b className="block text-[14px] tabular-nums leading-tight">{n}</b>
            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><I size={10} /> {r}</span>
        </span>
    );
}

/** Entradas y salidas por hora: dos barras finas por hora, entran en el azul y salen en gris. */
function Flujo({ f }: { f: Fila }) {
    const horas = f.porHora.map((x, h) => ({ ...x, h })).filter((x) => x.entran || x.salen);
    if (!horas.length) return <p className="text-[12.5px] text-muted-foreground">Nadie cruzó el borde de la zona desde que abrió.</p>;
    const desde = Math.min(...horas.map((x) => x.h)), hasta = Math.max(...horas.map((x) => x.h));
    const rango = f.porHora.slice(desde, hasta + 1).map((x, i) => ({ ...x, h: desde + i }));
    const max = Math.max(1, ...rango.map((x) => Math.max(x.entran, x.salen)));
    return (
        <div>
            <div className="flex items-end gap-1 h-24">
                {rango.map((x) => (
                    <div key={x.h} className="flex-1 h-full flex items-end justify-center gap-[2px]" title={`${String(x.h).padStart(2, "0")} h: ${x.entran} entraron · ${x.salen} salieron`}>
                        <span className="w-[42%] max-w-3 rounded-t-[3px] bg-[var(--accion)]" style={{ height: `${(x.entran / max) * 100}%`, minHeight: x.entran ? 2 : 0 }} />
                        <span className="w-[42%] max-w-3 rounded-t-[3px] bg-muted-foreground/45" style={{ height: `${(x.salen / max) * 100}%`, minHeight: x.salen ? 2 : 0 }} />
                    </div>
                ))}
            </div>
            <div className="flex gap-1 mt-1">{rango.map((x) => <span key={x.h} className="flex-1 text-center text-[10px] text-muted-foreground tabular-nums">{x.h}</span>)}</div>
            <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-[2px] bg-[var(--accion)]" /> entraron</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-[2px] bg-muted-foreground/45" /> salieron</span>
            </div>
        </div>
    );
}

function CajonFila({ f, tic, ventana, alCerrar }: { f: Fila | null; tic: number; ventana: number; alCerrar: () => void }) {
    if (!f) return null;
    const franja = f.banda === "mal" ? "pleno-mal" : f.banda === "aviso" ? "pleno-aviso" : "pleno-bien";
    const I = f.banda === "mal" ? ShieldAlert : f.banda === "aviso" ? TriangleAlert : CheckCircle2;
    return (
        <Cajon open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={f.nombre} descripcion={`${f.camara} · ${f.horario ? `atiende de ${f.horario.desde} a ${f.horario.hasta}` : "sin horario"} · cuenta desde ${hora(f.inicio)}${dia(f.inicio) !== dia(new Date().toISOString()) ? ` del ${dia(f.inicio)}` : ""}`}
                encabezado={<Cuadro f={f} w={960} tic={tic} className="aspect-video" />}
                pie={<Link href="/admin/vision/reglas" className="h-9 px-3.5 rounded-[8px] border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent"><Settings2 size={14} /> Cambiar en Reglas</Link>}>
                <div className="px-6 py-5 space-y-5">
                    <div className={cn("flex items-center gap-3 rounded-[12px] px-4 py-3", franja)}>
                        <I size={20} className="shrink-0" />
                        <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-extrabold leading-tight">{ROTULO_BANDA[f.banda]}{!f.abierta ? " · fuera de horario" : ""}</div>
                            <div className="text-[12.5px] opacity-90 tabular-nums">{f.aforo} {f.aforo === 1 ? "persona" : "personas"}{f.limite ? ` de ${f.limite}` : ""}{f.desde ? ` · desde las ${hora(f.desde)}` : ""}</div>
                        </div>
                        <b className="text-[30px] leading-none tabular-nums">{f.aforo}</b>
                    </div>

                    <div className="grid grid-cols-4 rounded-[10px] border border-border divide-x divide-border text-center">
                        <Mini icono={ArrowDownToLine} n={f.entradas} r="entraron" />
                        <Mini icono={ArrowUpFromLine} n={f.salidas} r="salieron" />
                        <Mini icono={Hourglass} n={f.esperaMin != null ? `~${f.esperaMin} min` : "—"} r="espera" />
                        <Mini icono={Activity} n={f.maximo} r="máximo" />
                    </div>

                    <section className="space-y-2">
                        <Titulo texto="El aforo desde que abrió" pista={`La línea punteada es el límite (${f.limite ?? "—"}). Cada escalón es un cambio que se sostuvo el tiempo de rebote (${f.rebote} s).`} />
                        <div className="rounded-[10px] border border-border p-2.5">
                            <Curva f={f} alto={110} ejes />
                            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-1"><span>{hora(f.inicio)}</span><span>ahora</span></div>
                        </div>
                    </section>

                    <section className="space-y-2">
                        <Titulo texto="Entradas y salidas por hora" pista="Las personas que cruzaron el borde de la zona hacia adentro (entraron) o hacia afuera (salieron), desde la apertura." />
                        <Flujo f={f} />
                    </section>

                    {f.esperaMin != null && (
                        <p className="text-[12px] text-muted-foreground leading-snug">La espera es una estimación, como la del kiosco de Filas: las {f.aforo} personas de la fila, al ritmo de salidas de los últimos {ventana} min.</p>
                    )}

                    <section className="space-y-2">
                        <Titulo texto="Avisos" pista="Fila llena (a la guardia) y supervisor (si siguió llena), de los últimos 7 días." />
                        {!f.avisos.length ? <p className="text-[12.5px] text-muted-foreground">{f.avisar ? "No llegó al límite en los últimos 7 días." : "La regla no avisa."}</p> : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {f.avisos.map((a) => (
                                    <a key={a.id} href={a.foto || undefined} target="_blank" rel="noreferrer" className="relative block aspect-video rounded-[8px] overflow-hidden bg-black">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {a.foto && <img src={`${a.foto}?w=320`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
                                        <span className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-5 bg-gradient-to-t from-black/90 to-transparent text-white text-[11px] font-semibold flex items-center gap-1">
                                            {a.tipo === "FILA_ESCALADA" ? <ShieldAlert size={11} /> : <BellRing size={11} />}
                                            <span className="truncate">{a.tipo === "FILA_ESCALADA" ? "Supervisor" : "Llena"} · {a.valor}</span>
                                            <span className="ml-auto tabular-nums text-white/75">{hora(a.ts)}</span>
                                        </span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </section>

                    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                        <dt className="text-muted-foreground">Límite</dt><dd className="tabular-nums">{f.limite ?? "—"} personas (aviso desde el 70 %)</dd>
                        <dt className="text-muted-foreground">Rebote</dt><dd className="tabular-nums">{f.rebote} s</dd>
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

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/filas", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);
    useEffect(() => { const iv = setInterval(() => setTic(Date.now()), FOTO_MS); return () => clearInterval(iv); }, []);

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las filas…" /></div>;

    const vivas = datos.filas.filter((f) => f.activa);
    const abiertas = vivas.filter((f) => f.abierta);
    const ahora = abiertas.reduce((s, f) => s + f.aforo, 0);
    const llenas = abiertas.filter((f) => f.banda === "mal").length;
    const cerca = abiertas.filter((f) => f.banda === "aviso").length;
    const entradas = vivas.reduce((s, f) => s + f.entradas, 0), salidas = vivas.reduce((s, f) => s + f.salidas, 0);
    const fila = datos.filas.find((f) => f.id === abierta) || null;

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-2.5 flex-wrap">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted shrink-0"><ListOrdered size={16} /></span>
                <h1 className="text-[17px] font-bold leading-tight">Filas</h1>
                <Pista titulo="Qué es esto" ancho={340} texto="El aforo de las filas que cuenta OmniVision, como la analítica de aforo de las cámaras Bosch del modo Filas pero con cualquier cámara: cuántas personas hay en la zona, cuántas entraron y salieron, la espera estimada y los avisos al llegar al límite. Cada fila es una regla «Conteo de fila» de Visión → Reglas.">
                    <Info size={15} className="text-muted-foreground cursor-help" />
                </Pista>
                {datos.prendida ? <Chip tono="bien" icono={Activity}>Prendida</Chip> : <Chip tono="quieto">Apagada en Analíticas</Chip>}
                <Link href="/admin/vision/reglas?nueva=fila" className="ml-auto h-8 px-3 rounded-[8px] bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"><Plus size={14} /> Nueva fila</Link>
            </div>

            {datos.filas.length > 0 && (
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
            {datos.filas.length === 0 ? (
                <Vacio icono={ListOrdered} titulo="Todavía no hay filas" ayuda="Creá una regla «Conteo de fila» en Visión → Reglas: elegís la cámara, dibujás la zona de la fila y le ponés el límite." />
            ) : (
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
                    {datos.filas.map((f) => <Tarjeta key={f.id} f={f} tic={tic} alAbrir={() => setAbierta(f.id)} />)}
                </div>
            )}

            <CajonFila f={fila} tic={tic} ventana={datos.ventanaEsperaMin} alCerrar={() => setAbierta(null)} />
        </div>
    );
}
