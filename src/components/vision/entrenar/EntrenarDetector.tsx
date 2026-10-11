"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Clock, Cpu, Loader2, Moon, Play, Power, Square, Zap } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, ErrorEstado } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { MODELOS_ENTRENAMIENTO, PARAMETROS_DEFECTO, PARIDAD_MIN, type ClaseResumen } from "@/lib/detector-propio";
import { fechaHoraSeg } from "@/lib/fechas";

/**
 * El entrenamiento del detector propio: ponerlo en cola, seguirlo y ver qué salió.
 *
 * Lo corre scripts/entrenador.js en el CT, no la app. Mientras entrena, omni-vision está parado
 * (la GPU no alcanza para los dos), y eso se dice ANTES de pedirlo: qué deja de andar y por
 * cuánto. Por defecto va a la ventana de la noche.
 */
type Entrenamiento = {
    id: string; estado: string; cuando: string; parametros: any; conjunto: any; progreso: any; resultado: any; error: string | null;
    pedidoPor: string | null; cancelar: boolean; createdAt: string; iniciadoAt: string | null; terminadoAt: string | null;
};
type Entrenador = { vivo: boolean; imagen?: boolean; ventana?: string; enVentana?: boolean; latido?: string };

const ACTIVOS = ["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"];
const ESTADO: Record<string, { t: string; tono: "bien" | "aviso" | "mal" | "info" | "quieto" }> = {
    EN_COLA: { t: "En cola", tono: "info" }, PREPARANDO: { t: "Preparando las fotos", tono: "info" }, ENTRENANDO: { t: "Entrenando", tono: "aviso" },
    EXPORTANDO: { t: "Exportando", tono: "aviso" }, LISTO: { t: "Listo", tono: "bien" }, FALLO: { t: "Falló", tono: "mal" }, CANCELADO: { t: "Cancelado", tono: "quieto" },
};
/** Lo que se pausa mientras se entrena, en las palabras de las pantallas que lo muestran. */
const SE_PAUSA = "la verificación de intrusión, el registro de detecciones, la búsqueda, las zonas entrenables y las fotos de Accesos";
const REFRESCO_MS = 10_000;
/**
 * Cómo se lee el resultado, en palabras. F1 junta las dos maneras de equivocarse (lo que se le
 * escapa y lo que marca de más): con 0,8 o más se puede usar tranquilo; entre 0,6 y 0,8 sirve
 * mirando lo que marca; debajo, todavía no.
 */
const F1_BUENO = 0.8;
const F1_SIRVE = 0.6;
function veredicto(f1: number) {
    return f1 >= F1_BUENO ? { t: "Listo para usar", tono: "bien" as const, d: "Encuentra casi todos y casi no marca de más." }
        : f1 >= F1_SIRVE ? { t: "Sirve, con cuidado", tono: "aviso" as const, d: "Anda, pero conviene revisar lo que marca en Detecciones los primeros días." }
            : { t: "Todavía no", tono: "mal" as const, d: "Se equivoca demasiado: hacen falta más fotos dibujadas." };
}
/** El consejo que sale de los números: qué tipo de foto sumar. */
function consejo(escapados: number, deMas: number) {
    if (!escapados && !deMas) return null;
    return escapados >= deMas
        ? "Se le escapan: sumá fotos donde el objeto se vea chico, lejos, de noche o tapado en parte."
        : "Marca de más: sumá fotos del mismo lugar SIN el objeto, y marcalas con «No hay ninguno».";
}

const pct = (v: any) => (typeof v === "number" ? `${Math.round(v * 100)} %` : "—");

export function EntrenarDetector({ clases, falta }: { clases: ClaseResumen[]; falta: string[] }) {
    const [datos, setDatos] = useState<{ entrenamientos: Entrenamiento[]; entrenador: Entrenador } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [modelo, setModelo] = useState(MODELOS_ENTRENAMIENTO[0].id);
    const [cuando, setCuando] = useState<"noche" | "ahora">("noche");
    const [aunAsi, setAunAsi] = useState(false);
    const [mandando, setMandando] = useState(false);
    const [activo, setActivo] = useState<{ activo: any; enVision: any } | null>(null);
    const [activando, setActivando] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/objetos/entrenamientos", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
            fetch("/api/vision/objetos/activo", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).then((a) => a && setActivo(a)).catch(() => { });
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

    async function usar(id: string | null) {
        setActivando(id || "sacar");
        try {
            const r = await fetch("/api/vision/objetos/activo", id ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entrenamiento: id }) } : { method: "DELETE" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success(id ? { title: "En uso en las cámaras", description: "omni-vision lo toma en menos de 20 s, en todas las cámaras que analiza." } : { title: "Ya no se usa", description: "Lo registrado con él queda." });
            await cargar();
        } catch (e: any) { toast.error({ title: id ? "No se activó" : "No se sacó", description: e?.message }); }
        finally { setActivando(null); }
    }

    async function pedir() {
        setMandando(true);
        try {
            const r = await fetch("/api/vision/objetos/entrenamientos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cuando, modelo, aunAsi }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: cuando === "ahora" ? "Entrenamiento pedido" : "Queda para esta noche", description: cuando === "ahora" ? "Arranca en menos de un minuto." : `Arranca en la ventana ${datos?.entrenador.ventana || ""}.` });
            await cargar();
        } catch (e: any) { toast.error({ title: "No se pidió", description: e?.message }); }
        finally { setMandando(false); }
    }
    async function cancelar(id: string) {
        const r = await fetch(`/api/vision/objetos/entrenamientos/${id}`, { method: "DELETE" });
        if (!r.ok) toast.error({ title: "No se canceló", description: (await r.json().catch(() => ({})))?.error });
        else toast.success({ title: "Se cancela", description: "Termina la época en curso, guarda lo aprendido y vuelve a levantar omni-vision." });
        cargar();
    }

    if (error && !datos) return <ErrorEstado mensaje={error} alReintentar={cargar} />;
    if (!datos) return null;
    const ent = datos.entrenador;
    const enCurso = datos.entrenamientos.find((t) => ACTIVOS.includes(t.estado));
    const nombre = (id: string) => clases.find((c) => c.id === id)?.nombre || id;

    return (
        <section className="rounded-[10px] border border-border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-foreground text-background"><Cpu size={16} /></span>
                <h2 className="text-[15px] font-bold">Entrenar</h2>
                {!ent.vivo ? <Chip tono="mal" icono={CircleAlert}>El entrenador no está corriendo</Chip>
                    : ent.imagen === false ? <Chip tono="aviso" icono={CircleAlert}>Falta construir el entrenador en el servidor</Chip>
                        : <Chip tono="bien">Entrenador listo · ventana {ent.ventana}</Chip>}
            </div>

            {activo?.activo && (
                <div className="rounded-[10px] border chip-bien px-3.5 py-2.5 flex items-center gap-2 flex-wrap text-[12.5px]">
                    <CircleCheck size={15} />
                    <span><b>En uso en las cámaras:</b> {activo.activo.clases.map((c: any) => c.nombre).join(", ")} · umbral {activo.activo.umbral}</span>
                    <span className="text-foreground/70">{activo.enVision?.activo && activo.enVision.entrenamiento === activo.activo.entrenamiento ? "· omni-vision lo cargó" : activo.enVision?.error ? `· omni-vision no lo pudo cargar: ${activo.enVision.error}` : "· omni-vision lo toma en menos de 20 s"}</span>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => usar(null)} disabled={activando === "sacar"}><Power size={13} /> Dejar de usar</Button>
                </div>
            )}

            {!enCurso && (
                <ol className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[12px]">
                    {[
                        ["Junta las fotos", "Las dibujadas, y las marcadas «no hay ninguno»."],
                        ["Aprende", "Repasa las fotos muchas veces. Mientras tanto se pausa OmniVision."],
                        ["Se toma un examen", "Con 1 de cada 7 fotos que aparta y no le muestra al aprender."],
                        ["Te dice cuánto acierta", "Por clase: cuántos encontró y cuántos marcó de más."],
                    ].map(([t, d], i) => (
                        <li key={t} className="rounded-[8px] bg-muted/50 px-3 py-2">
                            <div className="font-bold"><span className="tabular-nums text-muted-foreground mr-1">{i + 1}.</span>{t}</div>
                            <div className="text-muted-foreground leading-snug mt-0.5">{d}</div>
                        </li>
                    ))}
                </ol>
            )}

            {enCurso ? <EnCurso t={enCurso} alCancelar={() => cancelar(enCurso.id)} /> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Qué tan fino</div>
                        {MODELOS_ENTRENAMIENTO.map((m) => (
                            <button key={m.id} type="button" onClick={() => setModelo(m.id)} className={cn("w-full text-left rounded-[10px] border px-3 py-2 transition-colors", modelo === m.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                <div className="text-[13px] font-semibold">{m.rotulo}</div><div className="text-[11.5px] text-muted-foreground">{m.detalle}</div>
                            </button>
                        ))}
                    </div>
                    <div className="space-y-1.5">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cuándo</div>
                        <button type="button" onClick={() => setCuando("noche")} className={cn("w-full text-left rounded-[10px] border px-3 py-2 transition-colors", cuando === "noche" ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                            <div className="text-[13px] font-semibold inline-flex items-center gap-1.5"><Moon size={14} /> Esta noche ({ent.ventana || "02:00-06:00"})</div>
                            <div className="text-[11.5px] text-muted-foreground">Cuando menos se usa. Recomendado.</div>
                        </button>
                        <button type="button" onClick={() => setCuando("ahora")} className={cn("w-full text-left rounded-[10px] border px-3 py-2 transition-colors", cuando === "ahora" ? "border-[var(--aviso)] bg-[var(--aviso-suave)]" : "border-border hover:bg-accent")}>
                            <div className="text-[13px] font-semibold inline-flex items-center gap-1.5"><Zap size={14} /> Ahora</div>
                            <div className="text-[11.5px] text-muted-foreground">Mientras entrena se pausan {SE_PAUSA}. Hasta {PARAMETROS_DEFECTO.max_minutos / 60} horas; suele ser bastante menos.</div>
                        </button>
                    </div>
                    <div className="md:col-span-2 flex items-center gap-3 flex-wrap">
                        {falta.length > 0 && (
                            <label className="flex items-start gap-2 text-[12px] text-muted-foreground max-w-[640px]">
                                <input type="checkbox" checked={aunAsi} onChange={(e) => setAunAsi(e.target.checked)} className="mt-0.5" />
                                <span>Entrenar igual, para probar. Con menos de lo pedido el modelo aprende esas fotos y no mucho más: sirve para ver que todo funcione, no para usarlo.</span>
                            </label>
                        )}
                        <Button className="ml-auto" onClick={pedir} disabled={mandando || !ent.vivo || ent.imagen === false || (falta.length > 0 && !aunAsi) || !clases.some((c) => c.cajas > 0)}>
                            {mandando ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {cuando === "ahora" ? "Entrenar ahora" : "Dejar para esta noche"}
                        </Button>
                    </div>
                </div>
            )}

            {datos.entrenamientos.filter((t) => !ACTIVOS.includes(t.estado)).length > 0 && (
                <div className="space-y-2">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Resultados</div>
                    {datos.entrenamientos.filter((t) => !ACTIVOS.includes(t.estado)).map((t) => (
                        <Terminado key={t.id} t={t} nombre={nombre} enUso={activo?.activo?.entrenamiento === t.id} ocupado={activando === t.id}
                            alUsar={() => usar(t.id)} />
                    ))}
                </div>
            )}
        </section>
    );
}

function EnCurso({ t, alCancelar }: { t: Entrenamiento; alCancelar: () => void }) {
    const p = t.progreso || {};
    const m = p.metricas || {};
    const frac = p.de ? Math.min(1, (p.epoca || 0) / p.de) : 0;
    const e = ESTADO[t.estado];
    return (
        <div className="rounded-[10px] border border-border p-3.5 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
                <Chip tono={e.tono}>{e.t}</Chip>
                {t.estado === "EN_COLA" && <span className="text-[12px] text-muted-foreground inline-flex items-center gap-1"><Clock size={13} /> {t.cuando === "ahora" ? "arranca en menos de un minuto" : "espera la ventana de la noche"}</span>}
                {t.estado !== "EN_COLA" && <span className="text-[12px] text-muted-foreground">omni-vision en pausa mientras dura</span>}
                {t.cancelar ? <span className="ml-auto text-[12px] text-muted-foreground">cancelando…</span>
                    : <Button size="sm" variant="outline" className="ml-auto" onClick={alCancelar}><Square size={13} /> Cancelar</Button>}
            </div>
            {t.estado === "ENTRENANDO" && (
                <>
                    <div className="flex items-center gap-3">
                        <span className="relative flex-1 h-2 rounded-full bg-muted overflow-hidden"><span className="absolute inset-y-0 left-0 bg-[var(--accion)] rounded-full transition-all" style={{ width: `${frac * 100}%` }} /></span>
                        <span className="text-[12px] tabular-nums text-muted-foreground">época {p.epoca || 0} de {p.de || "?"}{p.segundos ? ` · ${Math.round(p.segundos / 60)} min` : ""}</span>
                    </div>
                    {m["val/mAP_50"] != null && (
                        <div className="flex gap-4 text-[12px] tabular-nums">
                            <Pista texto="De las cajas que dio el detector en las fotos de validación, cuántas eran un objeto dibujado."><span>Precisión <b>{pct(m["val/precision"])}</b></span></Pista>
                            <Pista texto="De los objetos dibujados en las fotos de validación, cuántos encontró."><span>Encuentra <b>{pct(m["val/recall"])}</b></span></Pista>
                            <Pista texto="mAP 50 de COCO: la medida estándar (0 a 100 %)."><span>mAP 50 <b>{pct(m["val/mAP_50"])}</b></span></Pista>
                        </div>
                    )}
                    <p className="text-[11.5px] text-muted-foreground">Para solo si deja de mejorar {PARAMETROS_DEFECTO.paciencia} épocas seguidas: puede terminar mucho antes del total.</p>
                </>
            )}
        </div>
    );
}

function Terminado({ t, nombre, enUso, ocupado, alUsar }: {
    t: Entrenamiento; nombre: (id: string) => string; enUso: boolean; ocupado: boolean; alUsar: () => void;
}) {
    const [abierto, setAbierto] = useState(false);
    const r = t.resultado;
    const e = ESTADO[t.estado] || { t: t.estado, tono: "quieto" as const };
    const med = r?.medicion;
    return (
        <div className="rounded-[10px] border border-border p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                <Chip tono={e.tono}>{e.t}</Chip>
                <span className="tabular-nums text-muted-foreground">{fechaHoraSeg(t.createdAt)}</span>
                <span className="text-muted-foreground">· {MODELOS_ENTRENAMIENTO.find((m) => m.id === t.parametros?.modelo)?.rotulo || t.parametros?.modelo}</span>
                {r?.segundos != null && <span className="text-muted-foreground tabular-nums">· {Math.round(r.segundos / 60)} min</span>}
                {t.conjunto?.corto?.length > 0 && <Chip tono="quieto">de prueba: conjunto chico</Chip>}
                {med && <span className="ml-auto font-semibold tabular-nums">acierta {pct(med.f1)}</span>}
                {/* Se puede usar si dejó modelo y el ONNX da lo mismo que lo entrenado (lo medido vale). */}
                {enUso ? <Chip tono="bien" icono={CircleCheck}>En uso</Chip>
                    : r?.ok && (r.paridad == null || r.paridad >= PARIDAD_MIN) && (t.estado === "LISTO" || t.estado === "CANCELADO") && (
                        <Button size="sm" variant={med?.f1 ? "default" : "outline"} onClick={alUsar} disabled={ocupado} title={t.conjunto?.corto?.length ? "Se entrenó con un conjunto chico: sirve para probar" : undefined}>
                            {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} Usar en las cámaras
                        </Button>
                    )}
            </div>
            {med && (() => {
                const v = veredicto(med.f1 || 0);
                return (
                    <>
                        <div className={cn("rounded-[8px] border px-3 py-2 text-[12.5px]", `chip-${v.tono}`)}>
                            <b>{v.t}.</b> {v.d}
                            <span className="text-foreground/70"> Acierta {pct(med.f1)} en el examen{r?.conjunto?.validacion ? ` (${r.conjunto.validacion} fotos que no vio al aprender)` : ""}.</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {Object.entries(med.por_clase || {}).map(([id, c]: [string, any]) => {
                                const escapados = c.recuadros - c.encontrados;
                                const tip = consejo(escapados, c.de_mas);
                                return (
                                    <div key={id} className="rounded-[8px] bg-muted/50 px-3 py-2.5 text-[12px] space-y-1">
                                        <div className="font-bold text-[13px]">{nombre(id)}</div>
                                        <div className="tabular-nums"><b>Encontró {c.encontrados} de {c.recuadros}</b>{escapados ? ` · se le escaparon ${escapados}` : " · no se le escapó ninguno"}</div>
                                        <div className="tabular-nums">{c.de_mas ? <>Marcó <b>{c.de_mas}</b> donde no había</> : "No marcó nada donde no había"}</div>
                                        {tip && <div className="text-muted-foreground leading-snug">{tip}</div>}
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-[11.5px] text-muted-foreground leading-snug">
                            Umbral {med.umbral}: qué tan seguro tiene que estar para marcar uno. Se eligió el que mejor anduvo en el examen; más bajo encuentra más pero se equivoca más.
                        </p>
                    </>
                );
            })()}
            {r && r.paridad != null && r.paridad < PARIDAD_MIN && <p className="text-[12px] tono-aviso">El ONNX no da lo mismo que el modelo entrenado (paridad {pct(r.paridad)}): no conviene usarlo.</p>}
            {r && r.paridad == null && t.estado === "LISTO" && <p className="text-[12px] text-muted-foreground">No se pudo comprobar la paridad del ONNX: el modelo no dio ninguna detección en validación.</p>}
            {r?.conjunto?.valida_sobre_las_mismas && <p className="text-[12px] text-muted-foreground">Con tan pocas fotos se validó sobre las mismas del entrenamiento: la medición es optimista.</p>}
            {t.error && (
                <div>
                    <button type="button" onClick={() => setAbierto((x) => !x)} className="text-[12px] tono-mal underline underline-offset-2">{abierto ? "Ocultar el error" : "Ver el error"}</button>
                    {abierto && <pre className="mt-1.5 text-[11px] whitespace-pre-wrap bg-muted rounded-md p-2 max-h-64 overflow-auto">{t.error}</pre>}
                </div>
            )}
        </div>
    );
}
