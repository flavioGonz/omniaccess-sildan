"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Camera, ChevronDown, CircleCheck, GraduationCap, Loader2, Settings2, Sparkles, TriangleAlert, Undo2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CajonZona, aFormulario, aCuerpo, type FormZona } from "@/components/vision/FormZonaEntrenable";
import { EstadoAhora, haceCuanto, type ZonaLista } from "@/components/vision/ZonaComun";
import { MuestraVista, Escaneo, Medidor, ZonaSobreCuadro } from "@/components/vision/entrenar/Piezas";
import { EtiquetadoRapido } from "@/components/vision/entrenar/EtiquetadoRapido";
import { ComoSeEntrena } from "@/components/vision/entrenar/ComoSeEntrena";
import { MIN_POR_CLASE, RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";
import type { Analisis } from "@/lib/vision-capa";

/**
 * Una analítica entrenable, de arriba abajo en el orden en que se piensa:
 *  · Dónde mira y qué ve ahora (la zona sobre la cámara, el recorte con las siluetas, el medidor).
 *  · Enseñarle: el etiquetado rápido (una por vez, con teclado) y el entrenamiento con su acierto.
 *  · Cómo se entrena, contado con sus nombres y sus fotos (abierto mientras no esté entrenada).
 *  · Todas las muestras, para revisar.
 */
type Zona = ZonaLista & {
    zona: [number, number][]; frasesPositivo: string[]; frasesNegativo: string[]; horario: { desde: string; hasta: string } | null;
    modelo: (ZonaLista["modelo"] & { matriz: { vp: number; fp: number; vn: number; fn: number } | null; pliegues: number; por: string | null; guia?: number }) | null;
    estado: (ZonaLista["estado"] & { analisis?: Analisis | null }) | null;
};
type Muestra = { id: string; url: string; prob: number | null; probTomada: number | null; fuente: string; etiqueta: "pos" | "neg" | null; etiquetadoPor: string | null; ts: string; analisis?: Analisis | null };
type Evento = { id: string; ts: string; prob: number | null; foto: string | null; avisado: boolean };

const pct = (v: number) => `${Math.round(v * 100)} %`;
const hora = (iso: string) => new Date(iso).toLocaleString("es-UY", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
/** Cuántas muestras se cargan al abrir el etiquetado rápido: una sentada. */
const TANDA_RAPIDA = 48;

function Avance({ n, rotulo, tono }: { n: number; rotulo: string; tono: "aviso" | "bien" }) {
    const ok = n >= RECOMENDADO_POR_CLASE, I = tono === "aviso" ? TriangleAlert : CircleCheck;
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className={cn("font-semibold inline-flex items-center gap-1 min-w-0", tono === "aviso" ? "tono-aviso" : "tono-bien")}><I size={12} className="shrink-0" /><span className="truncate">{rotulo}</span></span>
                <span className="tabular-nums text-muted-foreground shrink-0">{n} / {RECOMENDADO_POR_CLASE}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
                <motion.div className={cn("h-full rounded-full", ok ? "bg-[var(--bien)]" : tono === "aviso" ? "bg-[var(--aviso)]" : "bg-[var(--accion)]")}
                    initial={{ width: 0 }} animate={{ width: `${Math.min(100, (n / RECOMENDADO_POR_CLASE) * 100)}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
            </div>
        </div>
    );
}

export default function ZonaEntrenable() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [zona, setZona] = useState<Zona | null>(null);
    const [eventos, setEventos] = useState<Evento[]>([]);
    const [camaras, setCamaras] = useState<{ id: string; name: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [vista, setVista] = useState("todas");
    const [muestras, setMuestras] = useState<Muestra[] | null>(null);
    const [hayMas, setHayMas] = useState(false);
    const [errorMuestras, setErrorMuestras] = useState<string | null>(null);
    const [ejemplos, setEjemplos] = useState<{ pos: Muestra[]; neg: Muestra[] }>({ pos: [], neg: [] });
    const [rapido, setRapido] = useState<Muestra[] | null>(null);
    const [guia, setGuia] = useState<boolean | null>(null);
    const [editando, setEditando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [entrenando, setEntrenando] = useState(false);
    const [mirando, setMirando] = useState(false);

    const leer = useCallback(async (q: string) => {
        const r = await fetch(`/api/vision/zonas/${id}/muestras?${q}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
        return j as { muestras: Muestra[]; hayMas: boolean };
    }, [id]);

    const cargar = useCallback(async () => {
        try {
            const [r, rc] = await Promise.all([fetch(`/api/vision/zonas/${id}`, { cache: "no-store" }), fetch("/api/vision/zonas", { cache: "no-store" })]);
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setZona(j.zona); setEventos(j.eventos || []); setError(null);
            setGuia((g) => (g == null ? !j.zona.modelo : g));
            const jc = await rc.json().catch(() => ({}));
            if (rc.ok) setCamaras(jc.camaras || []);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, [id]);

    const cargarEjemplos = useCallback(async () => {
        try { const [p, n] = await Promise.all([leer("vista=pos&limite=2"), leer("vista=neg&limite=2")]); setEjemplos({ pos: p.muestras, neg: n.muestras }); }
        catch { setEjemplos({ pos: [], neg: [] }); /* sin ejemplos, la guía muestra «todavía no hay»: no es un error de la pantalla */ }
    }, [leer]);

    const cargarMuestras = useCallback(async (mas = false) => {
        try {
            const antes = mas && muestras?.length ? `&antes=${encodeURIComponent(muestras[muestras.length - 1].ts)}` : "";
            const j = await leer(`vista=${vista}${antes}`);
            setMuestras((m) => (mas && m ? [...m, ...j.muestras] : j.muestras)); setHayMas(!!j.hayMas); setErrorMuestras(null);
        } catch (e: any) { setErrorMuestras(e?.message || "No se pudieron traer las muestras"); }
    }, [leer, vista, muestras]);

    useEffect(() => { cargar(); cargarEjemplos(); }, [cargar, cargarEjemplos]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setMuestras(null); cargarMuestras(false); }, [id, vista]);
    useTiempoReal<{ id: string; estado: any }>("zona_estado", (d) => {
        if (d.id !== id) return;
        setZona((z) => (z ? { ...z, estado: { ...d.estado, muestraUrl: d.estado?.muestra ? `/api/vision/imagen/${d.estado.muestra}` : null }, conteo: { ...z.conteo, sin: z.conteo.sin + 1 } } : z));
        setMirando(false);
        if (vista === "todas" || vista === "sin") cargarMuestras(false);
    });

    /** Etiquetar (o quitar la etiqueta). Devuelve si se guardó: el etiquetado rápido no avanza si no. */
    const etiquetar = useCallback(async (mid: string, etiqueta: "pos" | "neg" | null, antes: "pos" | "neg" | null = null) => {
        try {
            const r = await fetch(`/api/vision/zonas/${id}/muestras`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [mid], etiqueta }) });
            if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `El servidor respondió ${r.status}`);
            setZona((z) => {
                if (!z) return z;
                const c = { ...z.conteo };
                if (antes) c[antes]--; else c.sin--;
                if (etiqueta) c[etiqueta]++; else c.sin++;
                return { ...z, conteo: c };
            });
            setMuestras((l) => l && (vista === "todas" ? l.map((x) => (x.id === mid ? { ...x, etiqueta } : x)) : l.filter((x) => x.id !== mid)));
            return true;
        } catch (e: any) { toast.error({ title: "No se guardó la etiqueta", description: e?.message }); return false; }
    }, [id, vista]);

    async function abrirRapido() {
        try { setRapido((await leer(`vista=dudosas&limite=${TANDA_RAPIDA}`)).muestras); }
        catch (e: any) { toast.error({ title: "No se pudieron traer las muestras", description: e?.message }); }
    }

    async function entrenar() {
        setEntrenando(true);
        try {
            const r = await fetch(`/api/vision/zonas/${id}/entrenar`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({
                title: "Entrenada",
                description: [j.modelo?.exactitud != null ? `Acierta ${pct(j.modelo.exactitud)} en ejemplos que no vio.` : null, j.sinFrases ? `Sin las frases (${j.sinFrases}): sólo con los ejemplos.` : null].filter(Boolean).join(" ") || undefined,
            });
            await cargar(); cargarEjemplos(); setMuestras(null); cargarMuestras(false);
        } catch (e: any) { toast.error({ title: "No se entrenó", description: e?.message }); }
        finally { setEntrenando(false); }
    }

    async function mirarAhora() {
        setMirando(true);
        const r = await fetch(`/api/vision/zonas/${id}/probar`, { method: "POST" }).catch(() => null);
        if (!r || !r.ok) { setMirando(false); toast.error({ title: "No se pudo pedir la muestra" }); }
        // La respuesta llega por el socket (zona_estado). Si en 40 s no llegó, se deja de animar: el
        // estado de la pantalla dice cuándo fue la última y si hubo un error.
        setTimeout(() => setMirando(false), 40_000);
    }

    async function guardar(f: FormZona) {
        setGuardando(true);
        try {
            const r = await fetch(`/api/vision/zonas/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(aCuerpo(f)) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: "Guardada", description: j.modeloDescartado ? "Cambió la zona: lo entrenado se descartó; las etiquetas quedan." : undefined });
            setEditando(false); cargar();
        } catch (e: any) { toast.error({ title: "No se guardó", description: e?.message }); }
        finally { setGuardando(false); }
    }

    async function borrar() {
        const r = await fetch(`/api/vision/zonas/${id}`, { method: "DELETE" }).catch(() => null);
        if (!r || !r.ok) { toast.error({ title: "No se borró" }); return; }
        const j = await r.json().catch(() => ({}));
        toast.success({ title: "Analítica borrada", description: j.recortesBorrados === false ? "Las fotos quedaron en el almacenamiento: no se pudieron borrar." : undefined });
        router.push("/admin/vision/entrenar");
    }

    const vistas = useMemo(() => zona ? [
        { valor: "todas", rotulo: "Todas" }, { valor: "sin", rotulo: `Sin etiquetar · ${zona.conteo.sin}` },
        { valor: "pos", rotulo: `${zona.positivo} · ${zona.conteo.pos}` }, { valor: "neg", rotulo: `${zona.negativo} · ${zona.conteo.neg}` },
    ] : [], [zona]);

    if (error && !zona) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!zona) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo la analítica…" /></div>;

    const e = zona.estado;
    const puedeEntrenar = zona.conteo.pos >= MIN_POR_CLASE && zona.conteo.neg >= MIN_POR_CLASE;
    const m = zona.modelo;
    const sostenidoMin = e?.positivoDesde ? Math.round((Date.now() - Date.parse(e.positivoDesde)) / 60000) : null;
    const falta = { pos: Math.max(0, MIN_POR_CLASE - zona.conteo.pos), neg: Math.max(0, MIN_POR_CLASE - zona.conteo.neg) };

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            {/* Encabezado */}
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-start gap-3 flex-wrap">
                <Link href="/admin/vision/entrenar" className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0 hover:bg-accent" aria-label="Volver"><ArrowLeft size={18} /></Link>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">{zona.nombre}</h1>
                        <EstadoAhora z={zona} />
                        {!zona.activa && <Chip tono="quieto">Pausada</Chip>}
                        {!zona.avisar && <Chip tono="quieto">No avisa: sólo registra</Chip>}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">{zona.camara} · mira cada {Math.round(zona.cadaSeg / 60)} min · avisa con «{zona.positivo}» sostenido {Math.round(zona.sostenerSeg / 60)} min desde {pct(zona.umbral)}{zona.horario ? ` · de ${zona.horario.desde} a ${zona.horario.hasta}` : ""}</p>
                </div>
                <Button variant="outline" onClick={mirarAhora} disabled={mirando || !zona.activa}>{mirando ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />} Mirar ahora</Button>
                <Button variant="outline" onClick={() => setEditando(true)}><Settings2 size={15} /> Configurar</Button>
            </div>

            {/* Dónde mira · qué ve · qué decide */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.35fr] gap-3">
                <section className="rounded-[10px] border border-border bg-card overflow-hidden flex flex-col">
                    <div className="px-4 pt-3 pb-2 text-[12px] font-bold text-muted-foreground">Dónde mira · {zona.camara}</div>
                    <ZonaSobreCuadro deviceId={zona.deviceId} zona={zona.zona} className="aspect-video" />
                    <p className="px-4 py-2.5 text-[11.5px] text-muted-foreground">Sólo importa lo de adentro del recuadro: se recorta y se clasifica cada {Math.round(zona.cadaSeg / 60)} min.</p>
                </section>
                <section className="rounded-[10px] border border-border bg-card overflow-hidden">
                    <div className="px-4 pt-3 pb-2 flex items-center gap-2 text-[12px] font-bold text-muted-foreground">
                        <Sparkles size={13} /> Lo que ve ahora
                        {e?.al && <span className="ml-auto font-normal tabular-nums">{haceCuanto(e.al)}</span>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 px-4 pb-4">
                        <div className="relative aspect-[4/3] rounded-md overflow-hidden bg-black">
                            <AnimatePresence mode="wait">
                                {e?.muestraUrl ? (
                                    <motion.div key={e.muestraUrl} className="absolute inset-0" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
                                        <MuestraVista url={e.muestraUrl} analisis={e.analisis} ancho={960} className="absolute inset-0" />
                                    </motion.div>
                                ) : <div className="absolute inset-0 grid place-items-center text-[12px] text-white/60">{zona.activa ? "Tomando la primera muestra…" : "Pausada"}</div>}
                            </AnimatePresence>
                            {mirando && <Escaneo />}
                        </div>
                        <div className="flex md:flex-col items-center md:items-stretch gap-4 md:w-48">
                            <Medidor prob={e?.prob ?? null} umbral={zona.umbral} positivo={zona.positivo} negativo={zona.negativo} />
                            <div className="text-[12px] space-y-1.5 text-muted-foreground">
                                <div>Decide {e?.fuente === "entrenado" ? <b className="text-foreground">con lo que aprendió</b> : <b className="text-foreground">con las frases</b>}{e?.fuente === "entrenado" && m?.exactitud != null ? ` (${pct(m.exactitud)} de acierto)` : ""}.</div>
                                {sostenidoMin != null && <div className="text-foreground font-semibold">«{zona.positivo}» hace {sostenidoMin} min{e?.avisado ? " · ya avisó" : ` · avisa a los ${Math.round(zona.sostenerSeg / 60)}`}</div>}
                                {e?.armada === false && <div>Fuera de horario: no avisa.</div>}
                                {e?.error && <div className="tono-mal">{e.error}</div>}
                                <div className="text-[11px]">La marca del anillo es el umbral ({pct(zona.umbral)}).</div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            {/* Enseñar y entrenar */}
            <section className="rounded-[10px] border border-border bg-card p-4 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-5">
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <GraduationCap size={17} />
                        <h2 className="text-[15px] font-bold">Enseñale</h2>
                        {m ? <Chip tono="bien">Entrenada</Chip> : <Chip tono="info">Con frases</Chip>}
                    </div>
                    <Avance n={zona.conteo.pos} rotulo={zona.positivo} tono="aviso" />
                    <Avance n={zona.conteo.neg} rotulo={zona.negativo} tono="bien" />
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button onClick={abrirRapido} disabled={!zona.conteo.sin}><Sparkles size={15} /> Etiquetar {zona.conteo.sin ? `· ${zona.conteo.sin} esperando` : ""}</Button>
                        <Button variant="outline" onClick={entrenar} disabled={!puedeEntrenar || entrenando}>{entrenando ? <Loader2 size={15} className="animate-spin" /> : <GraduationCap size={15} />} {m ? "Volver a entrenar" : "Entrenar"}</Button>
                    </div>
                    {!puedeEntrenar && (
                        <p className="text-[12px] text-muted-foreground">
                            Para entrenar faltan {[falta.pos ? `${falta.pos} de «${zona.positivo}»` : null, falta.neg ? `${falta.neg} de «${zona.negativo}»` : null].filter(Boolean).join(" y ")}.
                            {falta.pos > 0 && <> Si casi no pasa, <b className="text-foreground">provocalo</b> y tocá «Mirar ahora» (abajo está cómo).</>}
                        </p>
                    )}
                </div>
                <div>
                    {m ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-md bg-muted p-4 space-y-2 h-full">
                            <div className="flex items-baseline gap-2">
                                <span className="text-[30px] font-bold tabular-nums leading-none">{m.exactitud != null ? pct(m.exactitud) : "—"}</span>
                                <Pista titulo="Cómo se mide" texto={`Validación cruzada en ${m.pliegues} partes: cada ejemplo se predice con un modelo que no lo vio. Es el promedio del acierto en «${zona.positivo}» y en «${zona.negativo}», para que tener muchos más de uno no lo infle.`}>
                                    <span className="text-[12px] text-muted-foreground underline decoration-dotted cursor-help">de acierto en ejemplos que no vio</span>
                                </Pista>
                            </div>
                            {m.matriz && (
                                <div className="text-[12.5px] tabular-nums space-y-0.5">
                                    <div>De {m.matriz.vp + m.matriz.fn} «{zona.positivo}», reconoció <b>{m.matriz.vp}</b>{m.matriz.fn ? ` · se le escaparon ${m.matriz.fn}` : ""}</div>
                                    <div>De {m.matriz.vn + m.matriz.fp} «{zona.negativo}», {m.matriz.fp ? <>marcó <b>{m.matriz.fp}</b> como «{zona.positivo}»</> : "no confundió ninguno"}</div>
                                </div>
                            )}
                            <div className="text-[11px] text-muted-foreground">
                                Entrenada {hora(m.entrenado)}{m.por ? ` por ${m.por}` : ""} con {m.n.pos} + {m.n.neg} ejemplos
                                {m.guia != null && ` · ${m.guia >= 0.75 ? "se apoyó sobre todo en las frases" : m.guia > 0 ? "mezcló las frases con los ejemplos" : "sólo con los ejemplos"}`}
                            </div>
                        </motion.div>
                    ) : (
                        <div className="rounded-md border border-dashed border-border p-4 h-full grid place-items-center text-center text-[12.5px] text-muted-foreground">
                            Todavía no está entrenada: decide con las frases. Cuando la entrenes, acá vas a ver cuánto acierta.
                        </div>
                    )}
                </div>
            </section>

            {/* Cómo se entrena */}
            <section className="space-y-3">
                <button type="button" onClick={() => setGuia((g) => !g)} className="flex items-center gap-2 text-[14px] font-bold">
                    <motion.span animate={{ rotate: guia ? 0 : -90 }}><ChevronDown size={16} /></motion.span> Cómo se entrena
                </button>
                <AnimatePresence initial={false}>
                    {guia && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <ComoSeEntrena positivo={zona.positivo} negativo={zona.negativo} frasesPositivo={zona.frasesPositivo} frasesNegativo={zona.frasesNegativo}
                                ejemplosPos={ejemplos.pos} ejemplosNeg={ejemplos.neg} conteo={zona.conteo} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </section>

            {/* Todas las muestras */}
            <section className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-[14px] font-bold">Muestras</h2>
                    <Filtros grupos={[{ clave: "v", titulo: "Ver", valor: vista, alElegir: setVista, opciones: vistas }]} />
                </div>
                {errorMuestras && !muestras ? <ErrorEstado mensaje={errorMuestras} alReintentar={() => cargarMuestras(false)} />
                    : !muestras ? <Cargando texto="Trayendo las muestras…" />
                        : muestras.length === 0 ? <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">No hay muestras acá.</div>
                            : (
                                <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                                    <AnimatePresence initial={false}>
                                        {muestras.map((s) => (
                                            <motion.div key={s.id} layout initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.25 }}
                                                className={cn("rounded-[10px] border-2 bg-card overflow-hidden", s.etiqueta === "pos" ? "border-[var(--aviso)]" : s.etiqueta === "neg" ? "border-[var(--bien)]" : "border-transparent ring-1 ring-border")}>
                                                <a href={s.url} target="_blank" rel="noreferrer" className="block relative">
                                                    <MuestraVista url={s.url} analisis={s.analisis} ancho={320} etiquetas={false} className="aspect-[4/3]" />
                                                    {s.prob != null && <span className="absolute top-1.5 right-1.5"><Chip tono={s.prob >= zona.umbral ? "aviso" : "quieto"} pleno>{pct(s.prob)}</Chip></span>}
                                                </a>
                                                <div className="p-2 space-y-1.5">
                                                    <div className="text-[11px] text-muted-foreground tabular-nums">{hora(s.ts)}</div>
                                                    {s.etiqueta ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={cn("text-[12px] font-semibold flex-1 truncate inline-flex items-center gap-1", s.etiqueta === "pos" ? "tono-aviso" : "tono-bien")}>
                                                                {s.etiqueta === "pos" ? <TriangleAlert size={12} className="shrink-0" /> : <CircleCheck size={12} className="shrink-0" />}
                                                                <span className="truncate">{s.etiqueta === "pos" ? zona.positivo : zona.negativo}</span>
                                                            </span>
                                                            <button type="button" onClick={() => etiquetar(s.id, null, s.etiqueta)} className="h-7 w-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground" title="Quitar la etiqueta"><Undo2 size={13} /></button>
                                                        </div>
                                                    ) : (
                                                        // Uno por renglón: los nombres los elige cada uno y pueden ser largos.
                                                        <div className="grid gap-1">
                                                            <button type="button" onClick={() => etiquetar(s.id, "pos")} title={zona.positivo} className="h-7 rounded-md border border-border text-[11.5px] font-semibold hover:bg-[var(--aviso-suave)] inline-flex items-center gap-1.5 px-2 min-w-0"><TriangleAlert size={12} className="shrink-0 tono-aviso" /><span className="truncate">{zona.positivo}</span></button>
                                                            <button type="button" onClick={() => etiquetar(s.id, "neg")} title={zona.negativo} className="h-7 rounded-md border border-border text-[11.5px] font-semibold hover:bg-[var(--bien-suave)] inline-flex items-center gap-1.5 px-2 min-w-0"><CircleCheck size={12} className="shrink-0 tono-bien" /><span className="truncate">{zona.negativo}</span></button>
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </motion.div>
                            )}
                {hayMas && <div className="text-center"><Button variant="outline" onClick={() => cargarMuestras(true)}>Ver más</Button></div>}
            </section>

            {eventos.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-[14px] font-bold">Veces que se sostuvo «{zona.positivo}»</h2>
                    <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                        {eventos.map((ev) => (
                            <div key={ev.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {ev.foto && <a href={ev.foto} target="_blank" rel="noreferrer"><img src={`${ev.foto}?w=160`} alt="" className="h-10 w-16 rounded object-cover bg-black" /></a>}
                                <span className="tabular-nums">{hora(ev.ts)}</span>
                                {ev.prob != null && <span className="tabular-nums text-muted-foreground">{pct(ev.prob)}</span>}
                                <span className="ml-auto">{ev.avisado ? <Chip tono="aviso">Avisó a la guardia</Chip> : <Chip tono="quieto">Sólo registrado</Chip>}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <EtiquetadoRapido abierto={!!rapido} alCerrar={() => { setRapido(null); setMuestras(null); cargarMuestras(false); cargarEjemplos(); }} cola={rapido || []}
                positivo={zona.positivo} negativo={zona.negativo} umbral={zona.umbral}
                alEtiquetar={(mid, et, antes) => etiquetar(mid, et, antes)} alEntrenar={entrenar} puedeEntrenar={puedeEntrenar} />

            {editando && <CajonZona inicial={aFormulario(zona)} nueva={false} camaras={camaras} guardando={guardando} alCerrar={() => setEditando(false)} alGuardar={guardar} alBorrar={borrar} />}
        </div>
    );
}
