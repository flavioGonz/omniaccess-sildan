"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Camera, Check, GraduationCap, Loader2, Settings2, Undo2, X } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CajonZona, aFormulario, aCuerpo, type FormZona } from "@/components/vision/FormZonaEntrenable";
import { EstadoAhora, haceCuanto, type ZonaLista } from "@/components/vision/ZonaComun";
import { MIN_POR_CLASE, RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";

/**
 * Una analítica entrenable: cómo está ahora, cuánto sabe, y la grilla para enseñarle.
 *
 * La grilla arranca en «Para etiquetar»: las muestras sin etiqueta más cerca del umbral, que
 * son las que el modelo no sabe decidir. Etiquetar ésas mejora más que etiquetar cien que ya
 * acierta con 99 %.
 */
type Zona = ZonaLista & {
    zona: [number, number][]; frasesPositivo: string[]; frasesNegativo: string[]; horario: { desde: string; hasta: string } | null;
    modelo: (ZonaLista["modelo"] & { matriz: { vp: number; fp: number; vn: number; fn: number } | null; pliegues: number; por: string | null }) | null;
};
type Muestra = { id: string; url: string; prob: number | null; probTomada: number | null; fuente: string; etiqueta: "pos" | "neg" | null; etiquetadoPor: string | null; ts: string };
type Evento = { id: string; ts: string; prob: number | null; foto: string | null; avisado: boolean };

const pct = (v: number) => `${Math.round(v * 100)} %`;
const hora = (iso: string) => new Date(iso).toLocaleString("es-UY", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function Avance({ n, rotulo }: { n: number; rotulo: string }) {
    const ok = n >= RECOMENDADO_POR_CLASE;
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-[12px]"><span className="font-semibold">{rotulo}</span><span className="tabular-nums text-muted-foreground">{n} / {RECOMENDADO_POR_CLASE}</span></div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn("h-full", ok ? "bg-[var(--bien)]" : "bg-[var(--accion)]")} style={{ width: `${Math.min(100, (n / RECOMENDADO_POR_CLASE) * 100)}%` }} /></div>
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
    const [vista, setVista] = useState("dudosas");
    const [muestras, setMuestras] = useState<Muestra[] | null>(null);
    const [hayMas, setHayMas] = useState(false);
    const [errorMuestras, setErrorMuestras] = useState<string | null>(null);
    const [editando, setEditando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [entrenando, setEntrenando] = useState(false);
    const [mirando, setMirando] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [r, rc] = await Promise.all([fetch(`/api/vision/zonas/${id}`, { cache: "no-store" }), fetch("/api/vision/zonas", { cache: "no-store" })]);
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setZona(j.zona); setEventos(j.eventos || []); setError(null);
            const jc = await rc.json().catch(() => ({}));
            if (rc.ok) setCamaras(jc.camaras || []);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, [id]);

    const cargarMuestras = useCallback(async (mas = false) => {
        try {
            const antes = mas && muestras?.length ? `&antes=${encodeURIComponent(muestras[muestras.length - 1].ts)}` : "";
            const r = await fetch(`/api/vision/zonas/${id}/muestras?vista=${vista}${antes}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setMuestras((m) => (mas && m ? [...m, ...j.muestras] : j.muestras)); setHayMas(!!j.hayMas); setErrorMuestras(null);
        } catch (e: any) { setErrorMuestras(e?.message || "No se pudieron traer las muestras"); }
    }, [id, vista, muestras]);

    useEffect(() => { cargar(); }, [cargar]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setMuestras(null); cargarMuestras(false); }, [id, vista]);
    useTiempoReal<{ id: string; estado: any }>("zona_estado", (d) => {
        if (d.id !== id) return;
        setZona((z) => (z ? { ...z, estado: { ...d.estado, muestraUrl: d.estado?.muestra ? `/api/vision/imagen/${d.estado.muestra}` : null } } : z));
        setMirando(false);
    });

    async function etiquetar(m: Muestra, etiqueta: "pos" | "neg" | null) {
        const antes = muestras;
        // En las vistas filtradas, la que cambió de grupo sale de la grilla; en «todas» se queda con su etiqueta nueva.
        setMuestras((l) => l && (vista === "todas" ? l.map((x) => (x.id === m.id ? { ...x, etiqueta } : x)) : l.filter((x) => x.id !== m.id)));
        try {
            const r = await fetch(`/api/vision/zonas/${id}/muestras`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [m.id], etiqueta }) });
            if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `El servidor respondió ${r.status}`);
            setZona((z) => {
                if (!z) return z;
                const c = { ...z.conteo };
                if (m.etiqueta) c[m.etiqueta]--; else c.sin--;
                if (etiqueta) c[etiqueta]++; else c.sin++;
                return { ...z, conteo: c };
            });
        } catch (e: any) { setMuestras(antes); toast.error({ title: "No se guardó la etiqueta", description: e?.message }); }
    }

    async function entrenar() {
        setEntrenando(true);
        try {
            const r = await fetch(`/api/vision/zonas/${id}/entrenar`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: "Entrenada", description: j.modelo?.exactitud != null ? `Acierta ${pct(j.modelo.exactitud)} en muestras que no vio.` : undefined });
            await cargar(); setMuestras(null); cargarMuestras(false);
        } catch (e: any) { toast.error({ title: "No se entrenó", description: e?.message }); }
        finally { setEntrenando(false); }
    }

    async function mirarAhora() {
        setMirando(true);
        const r = await fetch(`/api/vision/zonas/${id}/probar`, { method: "POST" }).catch(() => null);
        if (!r || !r.ok) { setMirando(false); toast.error({ title: "No se pudo pedir la muestra" }); }
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

    if (error && !zona) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!zona) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo la analítica…" /></div>;

    const e = zona.estado;
    const puedeEntrenar = zona.conteo.pos >= MIN_POR_CLASE && zona.conteo.neg >= MIN_POR_CLASE;
    const m = zona.modelo;
    const sostenidoMin = e?.positivoDesde ? Math.round((Date.now() - Date.parse(e.positivoDesde)) / 60000) : null;
    const VISTAS = [
        { valor: "dudosas", rotulo: "Para etiquetar" }, { valor: "sin", rotulo: `Sin etiquetar · ${zona.conteo.sin}` },
        { valor: "pos", rotulo: `${zona.positivo} · ${zona.conteo.pos}` }, { valor: "neg", rotulo: `${zona.negativo} · ${zona.conteo.neg}` }, { valor: "todas", rotulo: "Todas" },
    ];

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-start gap-3">
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

            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
                <section className="rounded-[10px] border border-border bg-card overflow-hidden">
                    <div className="relative aspect-[16/10] bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {e?.muestraUrl ? <img src={`${e.muestraUrl}?w=960`} alt="" className="absolute inset-0 w-full h-full object-contain" />
                            : <div className="absolute inset-0 grid place-items-center text-[12px] text-white/50">{zona.activa ? "Tomando la primera muestra…" : "Pausada"}</div>}
                    </div>
                    <div className="p-3 space-y-2">
                        {e?.prob != null && (
                            <div className="space-y-1">
                                <div className="flex justify-between text-[12px]"><span className="text-muted-foreground">{zona.negativo}</span><span className="font-semibold tabular-nums">{pct(e.prob)} {zona.positivo.toLowerCase()}</span><span className="text-muted-foreground">{zona.positivo}</span></div>
                                <div className="relative h-2 rounded-full bg-muted">
                                    <div className={cn("absolute inset-y-0 left-0 rounded-full", e.prob >= zona.umbral ? "bg-[var(--aviso)]" : "bg-muted-foreground/50")} style={{ width: `${e.prob * 100}%` }} />
                                    <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground" style={{ left: `${zona.umbral * 100}%` }} title={`umbral ${pct(zona.umbral)}`} />
                                </div>
                            </div>
                        )}
                        <div className="text-[12px] text-muted-foreground flex flex-wrap gap-x-3">
                            {e?.al && <span>Última muestra {haceCuanto(e.al)}</span>}
                            {e?.fuente && <span>decidió {e.fuente === "entrenado" ? "con lo entrenado" : "con las frases"}</span>}
                            {sostenidoMin != null && <span className="text-foreground font-semibold">«{zona.positivo}» hace {sostenidoMin} min{e?.avisado ? " · ya avisó" : ` · avisa a los ${Math.round(zona.sostenerSeg / 60)}`}</span>}
                            {e?.armada === false && <span>fuera de horario: no avisa</span>}
                        </div>
                    </div>
                </section>

                <section className="rounded-[10px] border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <GraduationCap size={16} />
                        <h2 className="text-[14px] font-bold">Entrenamiento</h2>
                        {m ? <Chip tono="bien">Entrenada</Chip> : <Chip tono="info">Con frases</Chip>}
                    </div>
                    <Avance n={zona.conteo.pos} rotulo={zona.positivo} />
                    <Avance n={zona.conteo.neg} rotulo={zona.negativo} />
                    <p className="text-[11.5px] text-muted-foreground">Desde {MIN_POR_CLASE} de cada uno se puede entrenar; con {RECOMENDADO_POR_CLASE} el acierto suele estabilizarse. Conviene que haya de día y de noche, con lluvia y con sol.</p>
                    <Button onClick={entrenar} disabled={!puedeEntrenar || entrenando} className="w-full">{entrenando ? <Loader2 size={15} className="animate-spin" /> : <GraduationCap size={15} />} {m ? "Volver a entrenar" : "Entrenar"}</Button>
                    {m && (
                        <div className="rounded-md bg-muted p-3 space-y-2">
                            <div className="flex items-baseline gap-2">
                                <span className="text-[22px] font-bold tabular-nums">{m.exactitud != null ? pct(m.exactitud) : "—"}</span>
                                <Pista titulo="Cómo se mide" texto={`Validación cruzada en ${m.pliegues} partes: cada ejemplo se predice con un modelo que no lo vio. Es el promedio del acierto en «${zona.positivo}» y en «${zona.negativo}», para que tener muchos más de uno no lo infle.`}>
                                    <span className="text-[12px] text-muted-foreground underline decoration-dotted cursor-help">de acierto en ejemplos que no vio</span>
                                </Pista>
                            </div>
                            {m.matriz && (
                                <div className="text-[12px] tabular-nums space-y-0.5">
                                    <div>De {m.matriz.vp + m.matriz.fn} «{zona.positivo}», reconoció <b>{m.matriz.vp}</b>{m.matriz.fn ? ` · se le escaparon ${m.matriz.fn}` : ""}</div>
                                    <div>De {m.matriz.vn + m.matriz.fp} «{zona.negativo}», {m.matriz.fp ? <>marcó <b>{m.matriz.fp}</b> como «{zona.positivo}»</> : "no confundió ninguno"}</div>
                                    <div className="text-muted-foreground">al umbral de {pct(zona.umbral)}</div>
                                </div>
                            )}
                            <div className="text-[11px] text-muted-foreground">Entrenada {hora(m.entrenado)}{m.por ? ` por ${m.por}` : ""} con {m.n.pos} + {m.n.neg} ejemplos</div>
                        </div>
                    )}
                </section>
            </div>

            <section className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-[14px] font-bold">Muestras</h2>
                    <Filtros grupos={[{ clave: "v", titulo: "Ver", valor: vista, alElegir: setVista, opciones: VISTAS }]} />
                </div>
                {vista === "dudosas" && <p className="text-[12px] text-muted-foreground">Las que menos sabe decidir: etiquetar éstas es lo que más le enseña.</p>}
                {errorMuestras && !muestras ? <ErrorEstado mensaje={errorMuestras} alReintentar={() => cargarMuestras(false)} />
                    : !muestras ? <Cargando texto="Trayendo las muestras…" />
                        : muestras.length === 0 ? <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">{vista === "dudosas" || vista === "sin" ? "No hay muestras sin etiquetar." : "No hay muestras acá."}</div>
                            : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                                    {muestras.map((s) => (
                                        <div key={s.id} className={cn("rounded-[10px] border bg-card overflow-hidden", s.etiqueta === "pos" ? "border-[var(--aviso)]" : s.etiqueta === "neg" ? "border-[var(--bien)]" : "border-border")}>
                                            <a href={s.url} target="_blank" rel="noreferrer" className="block relative aspect-[4/3] bg-black">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={`${s.url}?w=320`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-contain" />
                                                {s.prob != null && <span className="absolute top-1.5 right-1.5"><Chip tono={s.prob >= zona.umbral ? "aviso" : "quieto"} pleno>{pct(s.prob)}</Chip></span>}
                                            </a>
                                            <div className="p-2 space-y-1.5">
                                                <div className="text-[11px] text-muted-foreground tabular-nums">{hora(s.ts)}</div>
                                                {s.etiqueta ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[12px] font-semibold flex-1 truncate">{s.etiqueta === "pos" ? zona.positivo : zona.negativo}</span>
                                                        <button type="button" onClick={() => etiquetar(s, null)} className="h-7 w-7 grid place-items-center rounded-md hover:bg-accent text-muted-foreground" title="Quitar la etiqueta"><Undo2 size={13} /></button>
                                                    </div>
                                                ) : (
                                                    // Uno por renglón: los nombres de los estados los elige cada uno y pueden ser largos
                                                    // («Vehículo en el carril»); lado a lado se cortaban por el principio.
                                                    <div className="grid gap-1">
                                                        <button type="button" onClick={() => etiquetar(s, "pos")} title={zona.positivo} className="h-7 rounded-md border border-border text-[11.5px] font-semibold hover:bg-accent inline-flex items-center gap-1.5 px-2 min-w-0"><Check size={12} className="shrink-0" /><span className="truncate">{zona.positivo}</span></button>
                                                        <button type="button" onClick={() => etiquetar(s, "neg")} title={zona.negativo} className="h-7 rounded-md border border-border text-[11.5px] font-semibold hover:bg-accent inline-flex items-center gap-1.5 px-2 min-w-0"><X size={12} className="shrink-0" /><span className="truncate">{zona.negativo}</span></button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
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

            {editando && <CajonZona inicial={aFormulario(zona)} nueva={false} camaras={camaras} guardando={guardando} alCerrar={() => setEditando(false)} alGuardar={guardar} alBorrar={borrar} />}
        </div>
    );
}
