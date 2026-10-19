"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Activity, Camera, ScanEye, Info, Sparkles, UserCheck, BellOff, CheckCircle2, ShieldAlert, X, Maximize2, ThumbsUp, ThumbsDown, Clock } from "lucide-react";
import { getImagePath } from "@/lib/image-path";
import { conAncho } from "@/lib/ancho-foto";
import { CapaAnalisis, COLOR_GRUPO, COLOR_OTRO, ICONO_GRUPO } from "@/components/vision/CapaAnalisis";
import { useSiluetas } from "@/lib/use-siluetas";
import { geomDeIntrusion, VEREDICTOS, FILTROS_VISION, pasaVision, type Analisis, type Veredicto, type GeomNorm, type FiltroVision } from "@/lib/vision-capa";
import { describirObjeto } from "@/components/visor/FichaVisor";
import { metaDe, type Geom } from "@/components/intrusion/comun";
import { FichaDeteccion } from "@/components/intrusion/FichaDeteccion";
import { marcarDeteccion } from "@/app/actions/detections";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Lupa } from "@/components/lpr/CajonComparacion";

/**
 * OmniVision › Verificación: la doble verificación de intrusión, comparada detección por detección.
 *
 * 18/10, Nico: «esta sección debe ser similar a la de doble verificación LPR». Antes eran sólo
 * matrices por cámara: decían que una cámara daba mal, pero no mostraban ninguna detección, y para
 * saber por qué había que ir a buscarlas al monitor una por una. Ahora tiene la forma de Relecturas:
 *
 *  · Arriba, los números de todo el rango en una tira (lo que ahorraría, lo que se le escapa).
 *  · Una grilla comparativa: a la izquierda lo que dijo la CÁMARA («alguien cruzó», con su línea),
 *    a la derecha lo que vio OMNIVISION (la foto donde lo vio, con las siluetas) y abajo si coincide
 *    con lo que decidió el guardia.
 *  · Un cajón con la comparación contada en palabras, la captura y el cuadro propio, los objetos
 *    y las acciones (marcar real o falsa, abrir la ficha con la grabación).
 *  · La matriz por cámara sigue —es lo que decide si una regla de aviso conviene que espere a
 *    omni-vision (Ajustes → Notificaciones → la regla → Doble verificación)— pero en una tabla, y
 *    apretar una cámara filtra la grilla.
 */

type Decision = "real" | "falsa" | "pendiente";
type Fila = {
    id: string; ts: string; deviceId: string | null; camara: string | null; tipo: string; clase: string | null; foto: string | null;
    estado: string | null; error: string | null; ms: number | null;
    veredicto: Veredicto | null; fuente: "captura" | "propio" | null; tocan: boolean[];
    analisis: Analisis | null;
    propio: { veredicto: Veredicto; despuesS: number; analisis: Analisis } | null;
    decision: Decision; decididaAt: string | null; aviso: string | null;
};
type Matriz = Record<string, Record<Decision, number>>;
type Camara = { id: string; nombre: string; total: number; matriz: Matriz; retenidos: number; enviados: number; sinVeredicto: number; conLinea: boolean };
type Respuesta = { h: number; activa: boolean; total: number; filasMax: number; filas: Fila[]; geom: Record<string, Geom>; camaras: Camara[] };

const RANGOS = [{ v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }, { v: "720", r: "30 días" }];
const REFRESCO_MS = 15_000;
const CLASE: Record<string, string> = { human: "persona", vehicle: "vehículo" };
const DECISIONES = [{ v: "", r: "Todas" }, { v: "real", r: "Real" }, { v: "falsa", r: "Falsa" }, { v: "pendiente", r: "Sin decidir" }];
const COMPARACIONES = [{ v: "", r: "Todas" }, { v: "coinciden", r: "Coinciden" }, { v: "difieren", r: "Difieren" }];
const PLENO: Record<string, string> = { bien: "pleno-bien", aviso: "pleno-aviso", mal: "pleno-mal" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: "America/Montevideo" });
const alguien = (v: Veredicto | null) => v === "CONFIRMADA" || v === "PRESENTE";

/**
 * Lo que omni-vision dijo contra lo que decidió el guardia. Es la pregunta de esta pantalla: si
 * coinciden, retener avisos en esa cámara ahorra trabajo sin perder nada; si «se le escapó» una
 * real, no conviene.
 */
type Cruce = { clave: "acierto" | "ahorro" | "escapo" | "demas"; r: string; tono: "bien" | "aviso" | "mal"; explica: string };
function cruce(f: Fila): Cruce | null {
    if (!f.veredicto || f.decision === "pendiente") return null;
    if (alguien(f.veredicto)) return f.decision === "real"
        ? { clave: "acierto", r: "coinciden", tono: "bien", explica: "omni-vision vio a alguien y el guardia la confirmó como real." }
        : { clave: "demas", r: "vio alguien · falsa", tono: "aviso", explica: "omni-vision vio a alguien, pero el guardia la marcó falsa: no se habría ahorrado (puede ser alguien que pasa sin cruzar, o personal propio)." };
    return f.decision === "falsa"
        ? { clave: "ahorro", r: "coinciden · ahorrable", tono: "bien", explica: "omni-vision no vio a nadie y el guardia la marcó falsa: es un aviso que la verificación habría ahorrado." }
        : { clave: "escapo", r: "se le escapó", tono: "mal", explica: "El guardia la confirmó como real y omni-vision no vio a nadie: con la regla esperando a omni-vision, este aviso se habría retenido." };
}

function pasa(f: Fila, camara: string, vision: FiltroVision, decision: string, comparacion: string): boolean {
    if (camara && f.deviceId !== camara) return false;
    if (!pasaVision(f.veredicto, vision)) return false;
    if (decision && f.decision !== decision) return false;
    const c = cruce(f);
    if (comparacion === "coinciden") return c?.tono === "bien";
    if (comparacion === "difieren") return !!c && c.tono !== "bien";
    return true;
}

/** Cuántos de cada grupo vio, en pocas palabras: «2 personas · 1 vehículo». */
function resumen(a: Analisis | null | undefined): string {
    if (!a) return "";
    const n = (g: string) => a.objetos.filter((o) => o.grupo === g).length;
    const p = n("persona"), v = n("vehiculo"), an = n("animal");
    return [p && `${p} ${p === 1 ? "persona" : "personas"}`, v && `${v} ${v === 1 ? "vehículo" : "vehículos"}`, an && `${an} ${an === 1 ? "animal" : "animales"}`].filter(Boolean).join(" · ");
}
const sinObjetos = (a: Analisis): Analisis => ({ ...a, objetos: [] });

function Cifra({ n, rotulo, pista, tono }: { n: number | string; rotulo: string; pista: string; tono?: "bien" | "aviso" | "mal" }) {
    return (
        <Pista titulo={rotulo} texto={pista} ancho={300}>
            <span className="inline-flex items-baseline gap-1.5 px-3 py-2 cursor-help whitespace-nowrap">
                <b className={cn("text-[16px] tabular-nums leading-none", tono && `tono-${tono}`)}>{n}</b>
                <span className="text-[11.5px] text-muted-foreground">{rotulo}</span>
            </span>
        </Pista>
    );
}

function Quien({ icono: Ic, texto }: { icono: typeof Camera; texto: string }) {
    return <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-[5px] bg-black/65 text-white text-[10px] font-semibold"><Ic size={11} /> {texto}</span>;
}

function ChipDecision({ d }: { d: Decision }) {
    if (d === "pendiente") return <span className="shrink-0 inline-flex items-center gap-0.5 text-muted-foreground font-semibold"><Clock size={11} /> sin decidir</span>;
    return <span className={cn("shrink-0 inline-flex items-center gap-0.5 font-semibold", d === "real" ? "tono-mal" : "tono-bien")} title={`El guardia la marcó ${d}`}><UserCheck size={11} /> {d}</span>;
}

/** La foto de la que sale el veredicto: el cuadro propio si de ahí salió, si no la captura. */
const fotoOmni = (f: Fila, ancho?: number) => {
    if (f.fuente === "propio" && f.propio) return ancho ? `/api/monitor/intrusion/verificacion/${f.id}?w=${ancho}` : `/api/monitor/intrusion/verificacion/${f.id}`;
    const u = getImagePath(f.foto);
    return ancho ? conAncho(u, ancho) : u;
};
const analisisOmni = (f: Fila) => (f.fuente === "propio" && f.propio ? f.propio.analisis : f.analisis);

/**
 * Una detección, comparada: lo que dijo la cámara y lo que vio OmniVision.
 *  · Izquierda, la cámara: su captura con SU línea o zona, y qué dijo (cruce de línea · persona).
 *  · Derecha, OmniVision: la foto donde vio lo que vio (la captura o el cuadro propio, el que
 *    dio el veredicto), con las siluetas, y su veredicto.
 *  · Abajo: si coincide con el guardia, qué decidió el guardia, si el aviso se retuvo, y cuándo.
 */
function Tarjeta({ f, g, siluetas, alAbrir }: { f: Fila; g: GeomNorm | null; siluetas: boolean; alAbrir: () => void }) {
    const [cargadaCam, setCargadaCam] = useState(false);
    const [cargadaOmni, setCargadaOmni] = useState(false);
    const m = metaDe(f.tipo);
    const cam = conAncho(getImagePath(f.foto), 320);
    const omni = f.analisis ? fotoOmni(f, 320) : null;
    const aOmni = analisisOmni(f);
    const ver = f.veredicto ? VEREDICTOS[f.veredicto] : null;
    const c = cruce(f);
    const sinOmni = f.estado === "SIN_FOTO" ? "Sin foto para mirar" : f.estado === "ERROR" ? "omni-vision dio error" : "Sin analizar";
    return (
        <button type="button" onClick={alAbrir} title={`${f.camara || ""} · ${hora(f.ts)}`}
            className={cn("group text-left rounded-[10px] border border-border bg-card overflow-hidden outline-none hover:border-[var(--accion)] focus-visible:ring-2 focus-visible:ring-[var(--accion)] [content-visibility:auto] transition-colors",
                c?.clave === "escapo" && "ring-2 ring-[var(--mal)]")}>
            <span className="grid grid-cols-2 gap-px bg-border">
                {/* La cámara */}
                <span className="relative block aspect-[4/3] bg-black overflow-hidden">
                    {!cargadaCam && cam && <span className="absolute inset-0 animate-pulse bg-white/5" />}
                    {cam ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cam} alt="" loading="lazy" decoding="async" onLoad={() => setCargadaCam(true)} onError={() => setCargadaCam(true)}
                            className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", cargadaCam ? "opacity-100" : "opacity-0")} />
                    ) : <Camera size={18} className="absolute inset-0 m-auto text-white/30" />}
                    {/* La línea de la cámara, sin siluetas: es lo que la cámara «sabe». */}
                    {cargadaCam && cam && g && f.analisis && <CapaAnalisis analisis={sinObjetos(f.analisis)} geom={g} ajuste="cover" etiquetas={false} />}
                    <Quien icono={Camera} texto="Cámara" />
                    <span className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/90 to-transparent flex items-end gap-1.5 min-w-0">
                        <m.Icon size={13} className="text-white/80 shrink-0 mb-0.5" />
                        <span className="min-w-0 flex-1 text-[12.5px] font-bold text-white truncate">{m.label}{f.clase && CLASE[f.clase] ? ` · ${CLASE[f.clase]}` : ""}</span>
                    </span>
                </span>
                {/* OmniVision */}
                <span className="relative block aspect-[4/3] bg-black overflow-hidden">
                    {omni ? (<>
                        {!cargadaOmni && <span className="absolute inset-0 animate-pulse bg-white/5" />}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={omni} alt="" loading="lazy" decoding="async" onLoad={() => setCargadaOmni(true)} onError={() => setCargadaOmni(true)}
                            className={cn("absolute inset-0 w-full h-full object-cover transition-opacity", cargadaOmni ? "opacity-100" : "opacity-0")} />
                        {siluetas && cargadaOmni && aOmni && <CapaAnalisis analisis={aOmni} geom={g} ajuste="cover" etiquetas={false} />}
                    </>) : <span className="absolute inset-0 grid place-items-center px-3 text-center text-[11px] text-white/40">{sinOmni}</span>}
                    <Quien icono={ScanEye} texto="OmniVision" />
                    {f.fuente === "propio" && f.propio && <span className="absolute right-1.5 top-1.5 h-5 px-1.5 rounded-[5px] bg-black/65 text-white text-[10px] font-bold tabular-nums inline-flex items-center" title="Lo vio en el cuadro propio que sacó del canal">+{f.propio.despuesS} s</span>}
                    <span className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/90 to-transparent flex flex-col min-w-0">
                        {ver ? <span className="text-[12.5px] font-bold text-white truncate">{ver.rotulo}</span> : <span className="text-[12px] font-semibold text-white/60 italic">—</span>}
                        {aOmni && <span className="text-[10.5px] text-white/70 truncate">{resumen(aOmni) || "nadie en la foto"}</span>}
                    </span>
                </span>
            </span>
            <span className="flex items-center gap-1.5 px-2.5 h-8 text-[11px] min-w-0">
                {c ? <span className={cn("shrink-0 inline-flex items-center h-5 px-1.5 rounded-[5px] font-semibold", PLENO[c.tono])}>{c.r}</span>
                    : ver ? <span className={cn("shrink-0 inline-flex items-center h-5 px-1.5 rounded-[5px] font-semibold", `chip-${ver.tono}`)}>{ver.rotulo.toLowerCase()}</span>
                        : <span className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-[5px] font-semibold chip-quieto">sin verificar</span>}
                <ChipDecision d={f.decision} />
                {f.aviso === "RETENIDO" && <span className="shrink-0 inline-flex items-center gap-0.5 tono-aviso font-semibold" title="La regla esperó a omni-vision y no avisó"><BellOff size={11} /> retenido</span>}
                <span className="ml-auto min-w-0 truncate text-muted-foreground tabular-nums">{f.camara || "—"} · {hora(f.ts)}</span>
            </span>
        </button>
    );
}

/** Lo que pasó con una detección, en frases: qué dijo cada uno y qué habría pasado con el aviso. */
function relato(f: Fila): string[] {
    const m = metaDe(f.tipo);
    const out: string[] = [];
    out.push(`La cámara informó «${m.label.toLowerCase()}»${f.clase && CLASE[f.clase] ? ` de una ${CLASE[f.clase]}` : ""} y mandó su captura.`);
    if (!f.veredicto) {
        out.push(f.estado === "SIN_FOTO" ? "No había foto para que omni-vision la mirara." : f.estado === "ERROR" ? `omni-vision no pudo mirarla${f.error ? `: ${f.error}` : ""}.` : "omni-vision no la miró: la verificación estaba apagada, es anterior o sigue en cola.");
    } else {
        const ver = VEREDICTOS[f.veredicto];
        const que = resumen(analisisOmni(f));
        out.push(`omni-vision miró la captura${f.propio ? ` y un cuadro propio del canal ${f.propio.despuesS} s después` : ""}: ${ver.rotulo.toLowerCase()}${que ? ` (${que})` : ""}${f.fuente === "propio" ? ", en el cuadro propio" : ""}.`);
        if (f.propio && f.fuente === "captura" && f.propio.veredicto !== f.veredicto) out.push(`En el cuadro propio: ${VEREDICTOS[f.propio.veredicto].rotulo.toLowerCase()}. Vale la captura, que es la más fuerte de las dos.`);
        out.push(ver.explica);
    }
    if (f.decision === "pendiente") out.push("El guardia todavía no la decidió.");
    else out.push(`El guardia la marcó ${f.decision === "real" ? "real" : "falsa alarma"}${f.decididaAt ? ` a las ${hora(f.decididaAt)}` : ""}.`);
    const c = cruce(f);
    if (c) out.push(c.explica);
    if (f.aviso === "RETENIDO") out.push("Una regla de aviso esperaba a omni-vision y lo retuvo: no salió.");
    else if (f.aviso === "ENVIADO") out.push("Una regla de aviso esperó a omni-vision y lo mandó.");
    else if (f.aviso === "SIN_VEREDICTO") out.push("Una regla de aviso esperaba a omni-vision, pero no llegó a tiempo: se avisó igual.");
    return out;
}

/** Los objetos que vio, en renglones con el color de su silueta (claro u oscuro, el del cajón). */
function Objetos({ a }: { a: Analisis }) {
    if (!a.objetos.length) return <div className="text-[12.5px] text-muted-foreground">No encontró personas, vehículos ni animales.</div>;
    return (
        <ul className="space-y-1">
            {[...a.objetos].sort((x, y) => y.confianza - x.confianza).slice(0, 10).map((o, i) => {
                const Ico = ICONO_GRUPO[o.grupo] || Sparkles;
                return (
                    <li key={i} className="grid grid-cols-[16px_1fr_auto] items-baseline gap-2 text-[12.5px]">
                        <Ico size={13} className="self-center" style={{ color: COLOR_GRUPO[o.grupo] || COLOR_OTRO }} />
                        <span className="min-w-0 first-letter:uppercase">{describirObjeto(o)}</span>
                        <span className="text-[11.5px] text-muted-foreground tabular-nums">{Math.round(o.confianza * 100)} %</span>
                    </li>
                );
            })}
        </ul>
    );
}

function CajonVerificacion({ f, g, siluetas, alCerrar, alMarcar, alFicha }: {
    f: Fila | null; g: GeomNorm | null; siluetas: boolean; alCerrar: () => void;
    alMarcar: (f: Fila, kind: "real" | "false") => Promise<void>; alFicha: (f: Fila) => void;
}) {
    const [cual, setCual] = useState<"captura" | "propio">("captura");
    const [marcando, setMarcando] = useState(false);
    useEffect(() => { setCual(f?.fuente === "propio" ? "propio" : "captura"); }, [f?.id, f?.fuente]);
    if (!f) return null;
    const m = metaDe(f.tipo);
    const enPropio = cual === "propio" && !!f.propio;
    const foto = enPropio ? `/api/monitor/intrusion/verificacion/${f.id}` : getImagePath(f.foto);
    const a = enPropio ? f.propio!.analisis : f.analisis;
    const ver = f.veredicto ? VEREDICTOS[f.veredicto] : null;
    const c = cruce(f);
    const titulo = c ? (c.clave === "acierto" ? "OmniVision y el guardia coinciden: era real" : c.clave === "ahorro" ? "OmniVision y el guardia coinciden: era falsa" : c.clave === "escapo" ? "Se le escapó una real a OmniVision" : "OmniVision vio a alguien en una falsa")
        : ver ? (alguien(f.veredicto) ? "OmniVision vio a alguien" : "OmniVision no vio a nadie") : "OmniVision no la verificó";
    const tono = c ? c.tono : ver ? (ver.tono === "mal" ? "aviso" : "quieto") : "quieto";
    const franja = PLENO[tono] || "bg-muted text-foreground";
    const I = tono === "bien" ? CheckCircle2 : tono === "quieto" ? Info : ShieldAlert;
    const marcar = async (k: "real" | "false") => { setMarcando(true); try { await alMarcar(f, k); } finally { setMarcando(false); } };
    return (
        <Cajon open={!!f} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={`${f.camara || "Cámara"} · ${hora(f.ts)}`} descripcion={`${dia(f.ts)} · ${m.label}${f.clase && CLASE[f.clase] ? ` · ${CLASE[f.clase]}` : ""}`}
                encabezado={foto ? (
                    <div className="relative bg-black">
                        {siluetas && a ? (<>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={foto} alt={enPropio ? "Cuadro propio de OmniVision" : "Captura de la cámara"} className="block w-full max-h-[46vh] object-contain" />
                            <CapaAnalisis analisis={a} geom={g} ajuste="contain" />
                        </>) : <Lupa src={foto} alt="Captura de la cámara" />}
                        {f.propio && (
                            <span className="absolute left-2 top-2 inline-flex rounded-[8px] bg-black/60 p-0.5 backdrop-blur-sm">
                                {(["captura", "propio"] as const).map((k) => (
                                    <button key={k} type="button" onClick={() => setCual(k)} aria-pressed={cual === k}
                                        className={cn("h-7 px-2.5 rounded-[6px] text-[11.5px] font-semibold", cual === k ? "bg-white/90 text-black" : "text-white/80 hover:text-white")}>
                                        {k === "captura" ? "Captura de la cámara" : `Cuadro propio · +${f.propio!.despuesS} s`}
                                    </button>
                                ))}
                            </span>
                        )}
                    </div>
                ) : <div className="h-40 grid place-items-center bg-muted/40 text-[12.5px] text-muted-foreground">La detección no tiene foto</div>}>
                <div className="px-6 py-5 space-y-5">
                    <div className={cn("flex items-start gap-3 rounded-[12px] px-4 py-3", franja)}>
                        <I size={20} className="shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <div className="text-[15px] font-extrabold leading-tight">{titulo}</div>
                            <div className="text-[12.5px] opacity-90">{ver ? ver.rotulo : "sin veredicto"} · el guardia: {f.decision === "pendiente" ? "sin decidir" : f.decision}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-[12px] bg-muted/40 p-4 flex flex-col items-center text-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><Camera size={13} /> Dijo la cámara</span>
                            <m.Icon size={22} className="text-foreground/80" />
                            <span className="text-[14px] font-bold">{m.label}</span>
                            <span className="text-[11.5px] text-muted-foreground">{f.clase && CLASE[f.clase] ? `Clasificó: ${CLASE[f.clase]}` : "Sin clasificar"}</span>
                        </div>
                        <div className="rounded-[12px] bg-muted/40 p-4 flex flex-col items-center text-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><ScanEye size={13} /> Vio OmniVision</span>
                            <ScanEye size={22} className={ver ? `tono-${ver.tono}` : "text-muted-foreground"} />
                            <span className="text-[14px] font-bold">{ver ? ver.rotulo : "—"}</span>
                            <span className="text-[11.5px] text-muted-foreground">{f.veredicto ? (resumen(analisisOmni(f)) || "nadie en la foto") + (f.fuente === "propio" ? " · cuadro propio" : "") : f.estado === "ERROR" ? "dio error" : "no la miró"}</span>
                        </div>
                    </div>

                    <div>
                        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Qué pasó</div>
                        <ul className="space-y-1.5">
                            {relato(f).map((t, k) => (
                                <li key={k} className="flex items-start gap-2 text-[13px] leading-snug"><span className="mt-[0.5em] h-1.5 w-1.5 rounded-full bg-[var(--accion)] shrink-0" />{t}</li>
                            ))}
                        </ul>
                    </div>

                    {a && (
                        <div>
                            <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Lo que vio en {enPropio ? "el cuadro propio" : "la captura"}</div>
                            <Objetos a={a} />
                        </div>
                    )}

                    <div className="rounded-[12px] border border-border p-3.5 space-y-2.5">
                        <div className="text-[12.5px] text-muted-foreground">{f.decision === "pendiente" ? "¿Qué era?" : "Corregir la decisión del guardia"}</div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={marcando || f.decision === "real"} onClick={() => marcar("real")}
                                className="h-9 px-3.5 rounded-[8px] border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"><ThumbsUp size={14} /> Era real</button>
                            <button type="button" disabled={marcando || f.decision === "falsa"} onClick={() => marcar("false")}
                                className="h-9 px-3.5 rounded-[8px] border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"><ThumbsDown size={14} /> Falsa alarma</button>
                            <button type="button" onClick={() => alFicha(f)}
                                className="h-9 px-3.5 rounded-[8px] bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 ml-auto"><Maximize2 size={14} /> Ficha y grabación</button>
                        </div>
                    </div>

                    <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                        <dt className="text-muted-foreground">Cámara</dt><dd>{f.camara || "—"}{!g ? " · sin línea leída" : ""}</dd>
                        <dt className="text-muted-foreground">Cuándo</dt><dd className="tabular-nums">{dia(f.ts)} {hora(f.ts)}</dd>
                        <dt className="text-muted-foreground">omni-vision tardó</dt><dd className="tabular-nums">{f.ms != null ? `${(f.ms / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1 })} s` : "—"}</dd>
                        <dt className="text-muted-foreground">Aviso</dt><dd>{f.aviso === "RETENIDO" ? "retenido" : f.aviso === "ENVIADO" ? "enviado tras verificar" : f.aviso === "SIN_VEREDICTO" ? "enviado sin veredicto" : "ninguna regla esperaba a omni-vision"}</dd>
                        {f.error && <><dt className="text-muted-foreground">Error</dt><dd className="tono-mal">{f.error}</dd></>}
                    </dl>
                </div>
            </CajonContenido>
        </Cajon>
    );
}

/** Los dos números de una cámara, desde su matriz. */
function numeros(m: Matriz) {
    const suma = (fs: string[], col: Decision) => fs.reduce((s, f) => s + (m[f]?.[col] || 0), 0);
    const VISTAS = ["CONFIRMADA", "PRESENTE", "ANIMAL", "NADA"];
    return {
        falsas: suma(VISTAS, "falsa"), falsasSinNadie: suma(["ANIMAL", "NADA"], "falsa"),
        reales: suma(VISTAS, "real"), realesVistas: suma(["CONFIRMADA", "PRESENTE"], "real"),
        verificadas: VISTAS.reduce((s, f) => s + (m[f]?.real || 0) + (m[f]?.falsa || 0) + (m[f]?.pendiente || 0), 0),
        conAlguien: ["CONFIRMADA", "PRESENTE"].reduce((s, f) => s + (m[f]?.real || 0) + (m[f]?.falsa || 0) + (m[f]?.pendiente || 0), 0),
    };
}

const FILAS_MATRIZ: { k: string; r: string; tono: "mal" | "aviso" | "quieto" }[] = [
    { k: "CONFIRMADA", r: "Confirmada", tono: "mal" }, { k: "PRESENTE", r: "Hay alguien", tono: "aviso" },
    { k: "ANIMAL", r: "Animal", tono: "quieto" }, { k: "NADA", r: "No se ve a nadie", tono: "quieto" }, { k: "SIN", r: "Sin verificar", tono: "quieto" },
];
const COLUMNAS_MATRIZ = [{ k: "real", r: "Real" }, { k: "falsa", r: "Falsa" }, { k: "pendiente", r: "Sin decidir" }] as const;

function MatrizCamara({ c }: { c: Camara }) {
    return (
        <table className="w-full max-w-[520px] text-[12.5px] tabular-nums">
            <thead><tr className="text-[11px] text-muted-foreground text-right"><th className="text-left font-semibold py-1">omni-vision \ guardia</th>{COLUMNAS_MATRIZ.map((x) => <th key={x.k} className="font-semibold">{x.r}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
                {FILAS_MATRIZ.map((f) => (
                    <tr key={f.k}>
                        <td className="py-1.5"><Chip tono={f.tono}>{f.r}</Chip></td>
                        {COLUMNAS_MATRIZ.map((x) => <td key={x.k} className={cn("text-right", !(c.matriz[f.k]?.[x.k]) && "text-muted-foreground/50")}>{c.matriz[f.k]?.[x.k] || 0}</td>)}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function VerificacionVision() {
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [h, setH] = useState("24");
    const [camara, setCamara] = useState("");
    const [vision, setVision] = useState<FiltroVision>("todas");
    const [decision, setDecision] = useState("");
    const [comparacion, setComparacion] = useState("");
    const [abierta, setAbierta] = useState<Fila | null>(null);
    const [ficha, setFicha] = useState<Fila | null>(null);
    const [expandida, setExpandida] = useState<string | null>(null);
    const [siluetas, setSiluetas] = useSiluetas();

    const cargar = useCallback(async () => {
        try {
            const r = await fetch(`/api/vision/verificacion?h=${h}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
            // El cajón abierto sigue la fila nueva (la decisión pudo cambiar en otro puesto).
            setAbierta((a) => (a ? (j.filas as Fila[]).find((x) => x.id === a.id) || a : a));
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, [h]);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

    const geomNorm = useMemo(() => {
        const out: Record<string, GeomNorm | null> = {};
        for (const [id, g] of Object.entries(datos?.geom || {})) out[id] = geomDeIntrusion(g as any);
        return out;
    }, [datos?.geom]);

    const marcar = async (f: Fila, kind: "real" | "false") => {
        const r = await marcarDeteccion(f.id, kind);
        if (!r.ok) { toast.error({ title: "No se guardó", description: r.error || "Probá de nuevo." }); return; }
        toast.success({ title: kind === "real" ? "Marcada real" : "Marcada falsa alarma" });
        await cargar();
    };

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Cruzando lo que vio omni-vision con lo que decidió la guardia…" /></div>;

    // Los números de la tira: todo el rango, todas las cámaras (la matriz cuenta todo, las filas no).
    const t = datos.camaras.reduce((acc, c) => {
        const n = numeros(c.matriz);
        acc.falsas += n.falsas; acc.falsasSinNadie += n.falsasSinNadie; acc.reales += n.reales; acc.realesVistas += n.realesVistas;
        acc.verificadas += n.verificadas; acc.conAlguien += n.conAlguien; acc.retenidos += c.retenidos; acc.enviados += c.enviados; acc.sinVeredicto += c.sinVeredicto;
        return acc;
    }, { falsas: 0, falsasSinNadie: 0, reales: 0, realesVistas: 0, verificadas: 0, conAlguien: 0, retenidos: 0, enviados: 0, sinVeredicto: 0 });
    const escapadas = t.reales - t.realesVistas;
    const filas = datos.filas.filter((f) => pasa(f, camara, vision, decision, comparacion));
    const nombreCamara = datos.camaras.find((c) => c.id === camara)?.nombre;
    const rango = RANGOS.find((r) => r.v === h)?.r;

    const columnas: ColumnaTabla<Camara>[] = [
        { clave: "nombre", titulo: "Cámara", valor: (c) => c.nombre, celda: (c) => (
            <span className="inline-flex items-center gap-1.5 min-w-0">
                <span className="font-semibold truncate">{c.nombre}</span>
                {!c.conLinea && <Pista titulo="Sin geometría" texto="La cámara no informa su línea o su zona (o no se pudo leer): omni-vision puede decir si hay alguien, pero no si toca la línea. Nunca sale «confirmada»."><span><Chip tono="quieto">sin línea</Chip></span></Pista>}
            </span>
        ) },
        { clave: "total", titulo: "Detecciones", alinear: "der", valor: (c) => c.total },
        { clave: "ahorro", titulo: "Falsas sin nadie", alinear: "der", ayuda: "De las que el guardia marcó falsas, cuántas omni-vision no vio a nadie: es lo que la verificación ahorraría.",
            valor: (c) => { const n = numeros(c.matriz); return n.falsas ? n.falsasSinNadie / n.falsas : -1; },
            celda: (c) => { const n = numeros(c.matriz); return <span className="tabular-nums">{pct(n.falsasSinNadie, n.falsas)} <span className="text-muted-foreground">({n.falsasSinNadie}/{n.falsas})</span></span>; } },
        { clave: "vistas", titulo: "Reales vistas", alinear: "der", ayuda: "De las que el guardia confirmó reales, cuántas omni-vision sí vio. Si se le escapa una, en esa cámara no conviene retener avisos.",
            valor: (c) => { const n = numeros(c.matriz); return n.reales ? n.realesVistas / n.reales : -1; },
            celda: (c) => { const n = numeros(c.matriz); return <span className={cn("tabular-nums", n.reales && n.realesVistas < n.reales && "tono-mal font-semibold")}>{pct(n.realesVistas, n.reales)} <span className="text-muted-foreground font-normal">({n.realesVistas}/{n.reales})</span></span>; } },
        { clave: "avisos", titulo: "Avisos retenidos", alinear: "der", valor: (c) => c.retenidos,
            celda: (c) => c.retenidos + c.enviados + c.sinVeredicto ? <span className="tabular-nums"><b>{c.retenidos}</b> <span className="text-muted-foreground">de {c.retenidos + c.enviados + c.sinVeredicto}</span></span> : <span className="text-muted-foreground">—</span> },
        { clave: "matriz", titulo: "", alinear: "der", celda: (c) => (
            <button type="button" onClick={(e) => { e.stopPropagation(); setExpandida(expandida === c.id ? null : c.id); }} className="text-[12px] font-semibold text-[var(--accion)] hover:underline">
                {expandida === c.id ? "Ocultar matriz" : "Matriz"}
            </button>
        ) },
    ];

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-2.5 flex-wrap">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted shrink-0"><ShieldCheck size={16} /></span>
                <h1 className="text-[17px] font-bold leading-tight">Doble verificación de intrusión</h1>
                <Pista titulo="Qué es esto" ancho={340} texto="La cámara dice «alguien cruzó» y omni-vision mira su captura y un cuadro propio del canal sacado unos segundos después. Acá se ve, detección por detección, lo que dijo cada uno y lo que decidió el guardia. Es lo que dice si conviene que los avisos esperen a omni-vision (Ajustes → Notificaciones → la regla → Doble verificación).">
                    <Info size={15} className="text-muted-foreground cursor-help" />
                </Pista>
                {datos.activa ? <Chip tono="bien" icono={Activity}>Prendida</Chip> : <Chip tono="quieto">Apagada en Analíticas</Chip>}
            </div>

            <section className="rounded-[10px] border border-border bg-card flex flex-wrap items-center divide-x divide-border">
                <span className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">OmniVision</span>
                <Cifra n={datos.total} rotulo="detecciones" pista={`Cruces de línea, intrusiones y entradas a zona en ${rango}.`} />
                <Cifra n={t.verificadas} rotulo={`verificadas · ${pct(t.verificadas, datos.total)}`} pista="Las que omni-vision miró. El resto: sin foto, con error, en cola o anteriores a la verificación." />
                <Cifra n={t.conAlguien} rotulo={`con alguien · ${pct(t.conAlguien, t.verificadas)}`} pista="Vio una persona o un vehículo: confirmada (toca la línea) o «hay alguien»." />
                <Cifra n={t.verificadas - t.conAlguien} rotulo="sin nadie" pista="Sólo un animal o la escena vacía: probablemente falsas." />
                <span className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Contra el guardia</span>
                <Cifra n={pct(t.falsasSinNadie, t.falsas)} rotulo={`falsas sin nadie (${t.falsasSinNadie}/${t.falsas})`} tono="bien" pista="De las que el guardia marcó falsas, cuántas omni-vision no vio a nadie: los avisos que la verificación ahorraría." />
                <Cifra n={pct(t.realesVistas, t.reales)} rotulo={`reales vistas (${t.realesVistas}/${t.reales})`} tono={escapadas ? "mal" : "bien"} pista={escapadas ? `Se le escaparon ${escapadas}: con la regla esperando a omni-vision, esos avisos se habrían retenido. Filtrá «Difieren» para verlas.` : "No se le escapó ninguna real."} />
                {t.retenidos + t.enviados + t.sinVeredicto > 0 && (<>
                    <span className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Avisos</span>
                    <Cifra n={t.retenidos} rotulo="retenidos" tono="aviso" pista="Una regla esperaba a omni-vision y no avisó (sólo un animal o nada)." />
                    <Cifra n={t.enviados + t.sinVeredicto} rotulo="enviados" pista={`${t.enviados} tras verificar · ${t.sinVeredicto} sin veredicto a tiempo (se avisó igual).`} />
                </>)}
            </section>

            <div className="flex items-center gap-2 flex-wrap">
                <Filtros solido grupos={[
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "v", titulo: "OmniVision", valor: vision, alElegir: (x) => setVision(x as FiltroVision), opciones: FILTROS_VISION.map((x) => ({ valor: x.v, rotulo: x.rotulo })) },
                    { clave: "d", titulo: "El guardia", valor: decision, alElegir: setDecision, opciones: DECISIONES.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "c", titulo: "Comparación", valor: comparacion, alElegir: setComparacion, opciones: COMPARACIONES.map((x) => ({ valor: x.v, rotulo: x.r, tono: x.v === "difieren" ? "aviso" as const : x.v === "coinciden" ? "bien" as const : undefined })) },
                ]} />
                {nombreCamara && (
                    <button type="button" onClick={() => setCamara("")} className="h-[34px] px-2.5 rounded-full chip-info inline-flex items-center gap-1.5 text-[12px] font-semibold">
                        <Camera size={13} /> {nombreCamara} <X size={13} />
                    </button>
                )}
                <Pista titulo="Siluetas de OmniVision" texto="Dibuja sobre cada foto lo que vio OmniVision. Es la misma opción que en el historial, Buscar y el visor.">
                    <button type="button" onClick={() => setSiluetas(!siluetas)} aria-pressed={siluetas} aria-label="Siluetas de OmniVision"
                        className={cn("ml-auto h-[34px] px-2.5 rounded-lg border inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors",
                            siluetas ? "accion border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                        <Sparkles size={14} /> Siluetas
                    </button>
                </Pista>
            </div>

            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-2.5 text-[12.5px] text-[var(--mal-texto)]">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
            {filas.length === 0 ? (
                <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">
                    {datos.filas.length === 0 ? "No hubo cruces ni intrusiones de cámara en este rango." : "Nada con este filtro."}
                </div>
            ) : (<>
                <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                    {filas.map((f) => <Tarjeta key={f.id} f={f} g={f.deviceId ? geomNorm[f.deviceId] || null : null} siluetas={siluetas} alAbrir={() => setAbierta(f)} />)}
                </div>
                {datos.total > datos.filas.length && <div className="text-center text-[12px] text-muted-foreground">Se muestran las {datos.filasMax} más nuevas de {datos.total}. Los números de arriba y la tabla por cámara cuentan todas.</div>}
            </>)}

            {datos.camaras.length > 0 && (
                <section className="space-y-2">
                    <div className="flex items-center gap-2">
                        <h2 className="text-[14px] font-bold">Por cámara</h2>
                        <span className="text-[12px] text-muted-foreground">Apretá una cámara para ver sólo sus detecciones.</span>
                    </div>
                    <Tabla filas={datos.camaras} clave={(c) => c.id} columnas={columnas} controles={false} seleccionCeldas={false}
                        alClickFila={(c) => setCamara(camara === c.id ? "" : c.id)} filaActiva={(c) => c.id === camara}
                        expandir={(c) => (expandida === c.id ? <div className="px-4 py-3"><MatrizCamara c={c} /></div> : null)} />
                </section>
            )}

            <CajonVerificacion f={abierta} g={abierta?.deviceId ? geomNorm[abierta.deviceId] || null : null} siluetas={siluetas}
                alCerrar={() => setAbierta(null)} alMarcar={marcar} alFicha={(f) => { setAbierta(null); setFicha(f); }} />
            {ficha && (
                <FichaDeteccion
                    det={{ id: ficha.id, deviceId: ficha.deviceId, deviceName: ficha.camara, type: ficha.tipo, label: ficha.clase, snapshotPath: ficha.foto, timestamp: ficha.ts, acknowledged: ficha.decision !== "pendiente", ackKind: ficha.decision === "falsa" ? "false" : ficha.decision === "real" ? "real" : null }}
                    geom={ficha.deviceId ? datos.geom[ficha.deviceId] : undefined}
                    onMarcar={async (id, k) => { const r = await marcarDeteccion(id, k); void cargar(); return r; }}
                    onClose={() => setFicha(null)} />
            )}
        </div>
    );
}
