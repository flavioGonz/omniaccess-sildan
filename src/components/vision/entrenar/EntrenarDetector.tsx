"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, CircleCheck, Cpu, Loader2, Moon, Pause, Play, Power, Square, Thermometer, Trash2, Zap } from "lucide-react";
import { Cerebro, type EstadoCerebro } from "./Cerebro";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip, ErrorEstado } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { MODELOS_ENTRENAMIENTO, MODELOS_GUARDADOS, PARAMETROS_DEFECTO, PARIDAD_MIN, type ClaseResumen } from "@/lib/detector-propio";
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
type Entrenador = { vivo: boolean; imagen?: boolean; ventana?: string; enVentana?: boolean; latido?: string; libreGB?: number | null; minimoGB?: number; /** Por qué un entrenamiento en cola no arranca todavía (el equipo está caliente). */ espera?: string | null };

const ACTIVOS = ["EN_COLA", "PREPARANDO", "ENTRENANDO", "EXPORTANDO"];
const ESTADO: Record<string, { t: string; tono: "bien" | "aviso" | "mal" | "info" | "quieto" }> = {
    EN_COLA: { t: "En cola", tono: "info" }, PREPARANDO: { t: "Preparando las fotos", tono: "info" }, ENTRENANDO: { t: "Entrenando", tono: "aviso" },
    EXPORTANDO: { t: "Exportando", tono: "aviso" }, PAUSADO: { t: "En pausa", tono: "quieto" }, LISTO: { t: "Listo", tono: "bien" }, FALLO: { t: "Falló", tono: "mal" }, CANCELADO: { t: "Cancelado", tono: "quieto" },
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
/** Debajo de esta proporción de errores (sobre los recuadros de la clase) no vale la pena aconsejar nada. */
const ERROR_PARA_CONSEJO = 0.1;
/** El consejo que sale de los números: qué tipo de foto sumar. */
function consejo(escapados: number, deMas: number, recuadros: number) {
    if (Math.max(escapados, deMas) <= Math.max(1, recuadros * ERROR_PARA_CONSEJO)) return null;
    return escapados >= deMas
        ? "Se le escapan: sumá fotos donde el objeto se vea chico, lejos, de noche o tapado en parte."
        : "Marca de más: sumá fotos del mismo lugar SIN el objeto, y marcalas con «No hay ninguno».";
}

const pct = (v: any) => (typeof v === "number" ? `${Math.round(v * 100)} %` : "—");

/** Mientras hay algo en curso se mira más seguido: la pantalla es «en vivo», no una foto de hace 10 s. */
const REFRESCO_ACTIVO_MS = 3_000;
/** La medida de la GPU de este momento (nvidia-smi, con caché de 1,5 s en el servidor). */
const VIVO_MS = 2_000;

export type DatosEntrenar = {
    datos: { entrenamientos: Entrenamiento[]; entrenador: Entrenador } | null;
    error: string | null; activo: { activo: any; enVision: any } | null; cargar: () => Promise<void>;
    enCurso: Entrenamiento | null; pausado: Entrenamiento | null;
};

/**
 * Los entrenamientos y el modelo en uso, para el panel y para la lista de resultados: una sola
 * consulta para los dos (antes la página y el panel pedían lo mismo cada uno por su lado).
 */
export function useEntrenamientos(): DatosEntrenar {
    const [datos, setDatos] = useState<DatosEntrenar["datos"]>(null);
    const [error, setError] = useState<string | null>(null);
    const [activo, setActivo] = useState<DatosEntrenar["activo"]>(null);
    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/objetos/entrenamientos", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
            fetch("/api/vision/objetos/activo", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).then((a) => a && setActivo(a)).catch(() => { });
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, []);
    const enCurso = datos?.entrenamientos.find((t) => ACTIVOS.includes(t.estado)) || null;
    const pausado = datos?.entrenamientos.find((t) => t.estado === "PAUSADO") || null;
    useEffect(() => {
        cargar();
        const iv = setInterval(cargar, enCurso ? REFRESCO_ACTIVO_MS : REFRESCO_MS);
        return () => clearInterval(iv);
    }, [cargar, !!enCurso]); // eslint-disable-line react-hooks/exhaustive-deps
    return { datos, error, activo, cargar, enCurso, pausado };
}

/** El estado del cerebro, a partir de la fila. */
function estadoCerebro(t: Entrenamiento | null, enUso: boolean): EstadoCerebro {
    if (!t) return enUso ? "listo" : "reposo";
    if (t.estado === "EN_COLA") return "cola";
    if (t.estado === "PREPARANDO") return "preparando";
    if (t.estado === "EXPORTANDO") return "exportando";
    if (t.estado === "PAUSADO") return "pausado";
    if (t.estado === "ENTRENANDO") return t.progreso?.salud?.estado === "enfriando" ? "enfriando" : "entrenando";
    return "reposo";
}

const minutos = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

/**
 * El panel fijo de la derecha: entrenar, seguirlo en vivo, pausarlo y usarlo en las cámaras.
 * Acompaña el scroll (sticky) porque es lo que se mira mientras se dibuja: cuánto falta, si ya
 * se puede entrenar, cómo va el que corre.
 */
export function PanelEntrenar({ clases, falta, e }: { clases: ClaseResumen[]; falta: string[]; e: DatosEntrenar }) {
    const { datos, error, activo, cargar, enCurso, pausado } = e;
    const [modelo, setModelo] = useState(MODELOS_ENTRENAMIENTO[0].id);
    const [cuando, setCuando] = useState<"noche" | "ahora">("noche");
    const [aunAsi, setAunAsi] = useState(false);
    const [mandando, setMandando] = useState<string | null>(null);
    const [vivo, setVivo] = useState<any>(null);
    const entrenando = enCurso?.estado === "ENTRENANDO";

    // La GPU en vivo, sólo mientras entrena (fuera de eso no hay nada que mirar segundo a segundo).
    useEffect(() => {
        if (!entrenando) { setVivo(null); return; }
        let vale = true;
        const leer = () => fetch("/api/vision/entrenar/salud?vivo=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (vale && j) setVivo(j.ahora || j); }).catch(() => { });
        leer(); const iv = setInterval(leer, VIVO_MS);
        return () => { vale = false; clearInterval(iv); };
    }, [entrenando]);

    async function accion(clave: string, url: string, init: RequestInit, ok: { title: string; description?: string }) {
        setMandando(clave);
        try {
            const r = await fetch(url, init);
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success(ok); await cargar();
        } catch (x: any) { toast.error({ title: "No se pudo", description: x?.message }); }
        finally { setMandando(null); }
    }
    const json = (b: any): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

    if (error && !datos) return <ErrorEstado mensaje={error} alReintentar={cargar} />;
    if (!datos) return <div className="rounded-[14px] border border-border bg-card p-6 grid place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;

    const ent = datos.entrenador;
    const sinEspacio = ent.libreGB != null && ent.minimoGB != null && ent.libreGB < ent.minimoGB;
    const t = enCurso || pausado;
    const p = t?.progreso || {};
    const enUso = activo?.activo || null;
    const frac = t ? (p.de ? Math.min(1, (p.epoca || 0) / p.de) : 0) : enUso ? 1 : 0;
    const est = estadoCerebro(t, !!enUso);
    const e2 = t ? ESTADO[t.estado] : null;
    const salud = p.salud;
    const m = p.metricas || {};
    // Cuánto falta: lo que tardó cada época hasta ahora × las que quedan. Es un techo: si deja de
    // mejorar, para antes (paciencia), y eso se dice.
    const porEpoca = p.epoca && p.segundos ? p.segundos / p.epoca : null;
    const falta_s = porEpoca && p.de ? (p.de - p.epoca) * porEpoca : null;
    const puedePedir = ent.vivo && ent.imagen !== false && !sinEspacio && !pausado && (falta.length === 0 || aunAsi) && clases.some((c) => c.cajas > 0);
    const ultimo = datos.entrenamientos.find((x) => x.estado === "LISTO");

    return (
        <section id="entrenar" className="scroll-mt-4 rounded-[14px] border border-border bg-card overflow-hidden">
            <div className="px-4 pt-3.5 pb-2 flex items-center gap-2">
                <h2 className="text-[14px] font-bold flex-1">Entrenar y usar en las cámaras</h2>
                <Pista ancho={300} texto={!ent.vivo ? "El proceso que entrena (omniaccess-entrenador) no da señales: lo pedido queda en cola." : ent.imagen === false ? "Falta construir la imagen omni-entrenador en el servidor." : sinEspacio ? `Quedan ${ent.libreGB} GB donde se entrena y hacen falta ${ent.minimoGB}.` : `El entrenador está listo. Sin que nadie lo pida, entrena en la ventana ${ent.ventana}.`}>
                    <span className={cn("h-2.5 w-2.5 rounded-full", !ent.vivo || sinEspacio ? "bg-[var(--mal)]" : ent.imagen === false ? "bg-[var(--aviso)]" : "bg-[var(--bien)]")} aria-label="Estado del entrenador" />
                </Pista>
            </div>

            {/* El cerebro y el número. */}
            <div className="px-4 flex flex-col items-center text-center">
                <Cerebro progreso={frac} estado={est} tamano={230} />
                <div className="-mt-1 text-[30px] font-bold tabular-nums leading-none tracking-[-0.02em]">
                    {t ? `${Math.round(frac * 100)} %` : enUso ? "En uso" : "Listo para aprender"}
                </div>
                <div className="mt-1.5 text-[12px] text-muted-foreground tabular-nums min-h-[18px]">
                    {t?.estado === "EN_COLA" ? (ent.espera || (t.cuando === "ahora" ? "Arranca en menos de un minuto" : `Espera la ventana ${ent.ventana}`))
                        : t?.estado === "PREPARANDO" ? "Juntando las fotos dibujadas…"
                            : t?.estado === "EXPORTANDO" ? "Rindiendo el examen y exportando…"
                                : t?.estado === "PAUSADO" ? `En pausa en la época ${p.epoca || 0} de ${p.de || "?"} · OmniVision volvió`
                                    : t ? <>época {p.epoca || 0} de {p.de || "?"}{falta_s != null ? ` · como mucho ${minutos(falta_s)}` : ""}</>
                                        : enUso ? `${enUso.clases.map((c: any) => c.nombre).join(", ")} · umbral ${enUso.umbral}`
                                            : clases.length ? `${clases.length} ${clases.length === 1 ? "clase" : "clases"} · ${clases.reduce((n, c) => n + c.cajas, 0)} recuadros` : "Primero, qué querés enseñarle"}
                </div>
                {e2 && <div className="mt-2 flex items-center gap-1.5"><Chip tono={salud?.estado === "enfriando" ? "aviso" : e2.tono}>{salud?.estado === "enfriando" ? "Enfriando el equipo" : e2.t}</Chip>{t?.cancelar && <Chip tono="quieto">cancelando…</Chip>}{p.retomado && t?.estado === "ENTRENANDO" && <Chip tono="quieto">retomado</Chip>}</div>}
            </div>

            <div className="p-4 space-y-3">
                {/* En curso o en pausa: lo vivo, los controles y lo consumido. */}
                {t ? (
                    <>
                        {entrenando && (
                            <div className="grid grid-cols-4 gap-1.5">
                                <Medida rotulo="GPU" valor={vivo?.gpu?.uso ?? salud?.ahora?.uso} unidad="%" />
                                <Medida rotulo="Temp." valor={vivo?.gpu?.t ?? salud?.ahora?.gpu} unidad="°C" tono={(vivo?.gpu?.t ?? salud?.ahora?.gpu) >= 83 ? "aviso" : undefined} />
                                <Medida rotulo="Consumo" valor={vivo?.gpu?.w != null ? Math.round(vivo.gpu.w) : salud?.ahora?.w != null ? Math.round(salud.ahora.w) : null} unidad="W" />
                                <Medida rotulo="Memoria" valor={vivo?.gpu?.mem != null ? (vivo.gpu.mem / 1024).toFixed(1) : null} unidad="GB" />
                            </div>
                        )}
                        {m["val/mAP_50"] != null && (
                            <div className="space-y-1.5">
                                <Barra rotulo="Encuentra" pista="De los objetos dibujados en las fotos de examen, cuántos encontró." v={m["val/recall"]} />
                                <Barra rotulo="Precisión" pista="De lo que marcó en las fotos de examen, cuánto era de verdad un objeto dibujado." v={m["val/precision"]} />
                                <Barra rotulo="mAP 50" pista="La medida estándar de COCO, de 0 a 100 %." v={m["val/mAP_50"]} />
                            </div>
                        )}
                        <div className="flex gap-2">
                            {t.estado === "ENTRENANDO" && !t.cancelar && (
                                <Button variant="outline" className="flex-1" disabled={!!mandando || !!t.parametros?.pausar}
                                    onClick={() => accion("pausar", `/api/vision/objetos/entrenamientos/${t.id}`, json({ accion: "pausar" }), { title: "Se pausa al terminar la época", description: "Guarda lo aprendido, libera la GPU y vuelve OmniVision." })}>
                                    {mandando === "pausar" || t.parametros?.pausar ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} {t.parametros?.pausar ? "Pausando…" : "Pausar"}
                                </Button>
                            )}
                            {t.estado === "PAUSADO" && (
                                <>
                                    <Button className="flex-1" disabled={!!mandando} onClick={() => accion("retomar", `/api/vision/objetos/entrenamientos/${t.id}`, json({ accion: "retomar", cuando: "ahora" }), { title: "Se retoma", description: `Sigue desde la época ${p.epoca || 0}.` })}>
                                        {mandando === "retomar" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Retomar ahora
                                    </Button>
                                    <Button variant="outline" disabled={!!mandando} title={`Retomar en la ventana ${ent.ventana}`} onClick={() => accion("noche", `/api/vision/objetos/entrenamientos/${t.id}`, json({ accion: "retomar", cuando: "noche" }), { title: "Se retoma esta noche", description: `En la ventana ${ent.ventana}.` })}>
                                        <Moon size={14} /> Esta noche
                                    </Button>
                                </>
                            )}
                            {!t.cancelar && (
                                <DeleteConfirmDialog id={t.id} title={t.estado === "PAUSADO" ? "Descartar el entrenamiento en pausa" : "Cancelar el entrenamiento"}
                                    description={t.estado === "PAUSADO" ? "Se tira lo aprendido hasta acá (no hay modelo todavía). Las fotos dibujadas no se tocan." : t.estado === "EN_COLA" ? "Sale de la cola. Las fotos dibujadas no se tocan." : "Termina la época en curso, exporta lo aprendido hasta ahí y vuelve OmniVision. Si querés seguir después, mejor pausalo."}
                                    onDelete={async (id: string) => { const r = await fetch(`/api/vision/objetos/entrenamientos/${id}`, { method: "DELETE" }); return r.ok ? { success: true } : { success: false, error: (await r.json().catch(() => ({})))?.error || `El servidor respondió ${r.status}` }; }}
                                    onSuccess={cargar}>
                                    <Button variant="ghost" className="text-muted-foreground" title={t.estado === "PAUSADO" ? "Descartar" : "Cancelar"}><Square size={14} /> {t.estado === "PAUSADO" ? "Descartar" : "Cancelar"}</Button>
                                </DeleteConfirmDialog>
                            )}
                        </div>
                        {t.estado === "ENTRENANDO" && <p className="text-[11.5px] text-muted-foreground leading-snug">Mientras entrena se pausan {SE_PAUSA}. <b>Pausar</b> guarda en el fin de la época y los devuelve; al retomar sigue desde ahí. Para solo si deja de mejorar {PARAMETROS_DEFECTO.paciencia} épocas seguidas.</p>}
                        {salud && <Consumo s={salud} />}
                    </>
                ) : (
                    /* Nada en curso: pedir uno. */
                    <>
                        <div className="space-y-1.5">
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Qué tan fino</div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {MODELOS_ENTRENAMIENTO.map((mo) => (
                                    <Pista key={mo.id} texto={mo.detalle} ancho={240}>
                                        <button type="button" onClick={() => setModelo(mo.id)} aria-pressed={modelo === mo.id}
                                            className={cn("w-full rounded-full border h-8 px-3 text-[12px] font-semibold transition-colors", modelo === mo.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)] text-[var(--accion-texto,var(--accion))]" : "border-border hover:bg-accent")}>
                                            {mo.rotulo}
                                        </button>
                                    </Pista>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cuándo</div>
                            <div className="grid grid-cols-2 gap-1.5">
                                <Opcion activa={cuando === "noche"} onClick={() => setCuando("noche")} icono={Moon} titulo="Esta noche" detalle={`${ent.ventana || "02:00-06:00"}, sin que nadie lo note`} />
                                <Opcion activa={cuando === "ahora"} onClick={() => setCuando("ahora")} icono={Zap} titulo="Ahora" detalle="Pausa OmniVision mientras dura" aviso />
                            </div>
                        </div>
                        {falta.length > 0 && (
                            <label className="flex items-start gap-2 text-[11.5px] text-muted-foreground leading-snug">
                                <input type="checkbox" checked={aunAsi} onChange={(x) => setAunAsi(x.target.checked)} className="mt-0.5" />
                                <span>Entrenar igual, para probar: con menos de lo pedido aprende esas fotos y no mucho más.</span>
                            </label>
                        )}
                        <Button className="w-full h-10" disabled={!!mandando || !puedePedir}
                            onClick={() => accion("pedir", "/api/vision/objetos/entrenamientos", json({ cuando, modelo, aunAsi }), cuando === "ahora" ? { title: "Entrenamiento pedido", description: "Arranca en menos de un minuto." } : { title: "Queda para esta noche", description: `Arranca en la ventana ${ent.ventana || ""}.` })}>
                            {mandando === "pedir" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {cuando === "ahora" ? "Entrenar ahora" : "Dejar para esta noche"}
                        </Button>
                        {!clases.some((c) => c.cajas > 0) && <p className="text-[11.5px] text-muted-foreground text-center">Se puede entrenar cuando haya recuadros dibujados.</p>}
                        {ultimo?.resultado?.medicion && !enUso && (
                            <a href="#resultados" className="block rounded-[10px] bg-muted/60 px-3 py-2 text-[12px] hover:bg-accent transition-colors">
                                Último: acierta <b className="tabular-nums">{pct(ultimo.resultado.medicion.f1)}</b> · {veredicto(ultimo.resultado.medicion.f1 || 0).t}. <span className="text-[var(--accion-texto,var(--accion))] font-semibold">Ver y usar</span>
                            </a>
                        )}
                    </>
                )}

                {enUso && (
                    <div className="rounded-[10px] border chip-bien px-3 py-2.5 text-[12px] space-y-1.5">
                        <div className="flex items-center gap-1.5 font-semibold"><CircleCheck size={14} /> En uso en las cámaras</div>
                        <div className="text-foreground/75 leading-snug">{enUso.clases.map((c: any) => c.nombre).join(", ")} · {activo?.enVision?.activo && activo.enVision.entrenamiento === enUso.entrenamiento ? "omni-vision lo cargó" : activo?.enVision?.error ? `omni-vision no lo pudo cargar: ${activo.enVision.error}` : "omni-vision lo toma en menos de 20 s"}</div>
                        <Button size="sm" variant="outline" className="w-full" disabled={!!mandando}
                            onClick={() => accion("sacar", "/api/vision/objetos/activo", { method: "DELETE" }, { title: "Ya no se usa", description: "Lo registrado con él queda." })}>
                            <Power size={13} /> Dejar de usar
                        </Button>
                    </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-1 text-[11.5px] text-muted-foreground">
                    <Pista ancho={300} texto={`Al terminar, el modelo va al almacenamiento de objetos (MinIO) y lo intermedio se borra. Se guardan los últimos ${MODELOS_GUARDADOS}, más el que esté en uso. Una pausa sí guarda su punto de guardado hasta que se retome o se descarte.`}>
                        <span className="inline-flex items-center gap-1"><Archive size={12} /> Últimos {MODELOS_GUARDADOS} modelos</span>
                    </Pista>
                    <Link href="/admin/vision/entrenar/salud" className="inline-flex items-center gap-1 hover:text-foreground"><Thermometer size={12} /> Salud del equipo</Link>
                </div>
            </div>
        </section>
    );
}

/** Una medida en vivo: número grande, rótulo chico. */
function Medida({ rotulo, valor, unidad, tono }: { rotulo: string; valor: any; unidad: string; tono?: "aviso" }) {
    return (
        <div className="rounded-[8px] bg-muted/60 px-2 py-1.5 text-center">
            <div className={cn("text-[15px] font-bold tabular-nums leading-tight", tono && "tono-aviso")}>{valor ?? "—"}<span className="text-[10px] font-semibold text-muted-foreground ml-0.5">{valor != null ? unidad : ""}</span></div>
            <div className="text-[10px] text-muted-foreground">{rotulo}</div>
        </div>
    );
}

/** Una métrica de examen como barra: se lee de un vistazo si sube. */
function Barra({ rotulo, v, pista }: { rotulo: string; v: any; pista: string }) {
    const n = typeof v === "number" ? Math.max(0, Math.min(1, v)) : 0;
    return (
        <Pista texto={pista} ancho={260}>
            <div className="flex items-center gap-2 text-[11.5px]">
                <span className="w-[66px] text-muted-foreground">{rotulo}</span>
                <span className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><span className="absolute inset-y-0 left-0 rounded-full bg-[var(--info)] transition-all duration-700" style={{ width: `${n * 100}%` }} /></span>
                <span className="w-[38px] text-right font-semibold tabular-nums">{pct(v)}</span>
            </div>
        </Pista>
    );
}

/** Una opción de «cuándo»: tarjetita elegible. */
function Opcion({ activa, onClick, icono: Icono, titulo, detalle, aviso }: { activa: boolean; onClick: () => void; icono: any; titulo: string; detalle: string; aviso?: boolean }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={activa}
            className={cn("text-left rounded-[10px] border px-2.5 py-2 transition-colors",
                activa ? (aviso ? "border-[var(--aviso)] bg-[var(--aviso-suave)]" : "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]") : "border-border hover:bg-accent")}>
            <div className="text-[12.5px] font-semibold inline-flex items-center gap-1.5"><Icono size={13} /> {titulo}</div>
            <div className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">{detalle}</div>
        </button>
    );
}

/**
 * Lo que costó el entrenamiento, sumando los tramos si se pausó: tiempo de reloj, energía de la
 * GPU (integrada muestra a muestra por el entrenador, no estimada), y los picos.
 */
function Consumo({ s }: { s: any }) {
    const filas: [string, string, string?][] = [
        ["Tiempo", s.segundos != null ? minutos(s.segundos) : s.minutos != null ? `${s.minutos} min` : "—", s.tramos > 1 ? `en ${s.tramos} tramos` : undefined],
        ["Energía GPU", s.wh != null ? (s.wh >= 1000 ? `${(s.wh / 1000).toFixed(2)} kWh` : `${Math.round(s.wh)} Wh`) : "—", s.wPromedio != null ? `${s.wPromedio} W promedio` : undefined],
        ["Pico GPU", s.max?.gpu != null ? `${s.max.gpu} °C` : "—", s.max?.w != null ? `${Math.round(s.max.w)} W` : undefined],
        ["Pico CPU", s.max?.cpu != null ? `${Math.round(s.max.cpu)} °C` : "—", s.max?.mem != null ? `GPU ${(s.max.mem / 1024).toFixed(1)} GB` : undefined],
    ];
    return (
        <div className="rounded-[10px] border border-border">
            <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5"><Cpu size={11} /> Lo que lleva consumido</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 pb-2.5">
                {filas.map(([r, v, d]) => (
                    <div key={r}>
                        <dt className="text-[10.5px] text-muted-foreground">{r}</dt>
                        <dd className="text-[13px] font-bold tabular-nums leading-tight">{v}</dd>
                        {d && <dd className="text-[10.5px] text-muted-foreground tabular-nums">{d}</dd>}
                    </div>
                ))}
            </dl>
            {(s.pausas > 0 || s.enfriadoSeg > 0) && <div className="px-3 pb-2.5 text-[11px] tono-info">Se congeló {s.pausas} {s.pausas === 1 ? "vez" : "veces"} para enfriar ({minutos(s.enfriadoSeg || 0)} en total).</div>}
        </div>
    );
}

/** Los terminados, con su veredicto y para usarlos o borrarlos. Va en la columna principal: ocupa. */
export function ResultadosEntrenamiento({ clases, e }: { clases: ClaseResumen[]; e: DatosEntrenar }) {
    const [activando, setActivando] = useState<string | null>(null);
    const { datos, activo, cargar } = e;
    const lista = (datos?.entrenamientos || []).filter((t) => !ACTIVOS.includes(t.estado) && t.estado !== "PAUSADO");
    if (!lista.length) return null;
    const nombre = (id: string) => clases.find((c) => c.id === id)?.nombre || id;
    async function usar(id: string) {
        setActivando(id);
        try {
            const r = await fetch("/api/vision/objetos/activo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entrenamiento: id }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: "En uso en las cámaras", description: "omni-vision lo toma en menos de 20 s, en todas las cámaras que analiza." });
            await cargar();
        } catch (x: any) { toast.error({ title: "No se activó", description: x?.message }); }
        finally { setActivando(null); }
    }
    return (
        <section id="resultados" className="scroll-mt-4 space-y-2">
            <div className="flex items-baseline gap-2"><h2 className="text-[15px] font-bold">Entrenamientos</h2><span className="text-[12px] text-muted-foreground">Cada uno con su examen. El mejor se usa en las cámaras.</span></div>
            {lista.map((t) => <Terminado key={t.id} t={t} nombre={nombre} enUso={activo?.activo?.entrenamiento === t.id} ocupado={activando === t.id} alUsar={() => usar(t.id)} alBorrado={cargar} />)}
        </section>
    );
}

/** El botón flotante en pantallas chicas: el panel queda abajo de todo, esto dice cómo va. */
export function CerebroFlotante({ e }: { e: DatosEntrenar }) {
    const t = e.enCurso || e.pausado;
    if (!t) return null;
    const p = t.progreso || {};
    const frac = p.de ? Math.min(1, (p.epoca || 0) / p.de) : 0;
    return (
        <a href="#entrenar" className="lg:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3.5 py-1 [box-shadow:var(--sombra-flotante)]">
            <Cerebro progreso={frac} estado={estadoCerebro(t, false)} tamano={44} />
            <span className="text-[13px] font-bold tabular-nums">{Math.round(frac * 100)} %</span>
        </a>
    );
}


export function Terminado({ t, nombre, enUso, ocupado, alUsar, alBorrado }: {
    t: Entrenamiento; nombre: (id: string) => string; enUso: boolean; ocupado: boolean; alUsar: () => void;
    /** Con esto aparece «Eliminar» (no en el que está en uso: primero hay que dejar de usarlo). */
    alBorrado?: () => void;
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
                    : r?.archivo?.borradoAt ? <Pista texto={`Se guardan los últimos ${MODELOS_GUARDADOS} modelos; este se borró el ${fechaHoraSeg(r.archivo.borradoAt)}. Lo medido queda para comparar.`} ancho={280}><Chip tono="quieto">Modelo borrado</Chip></Pista>
                    : r?.ok && (r.paridad == null || r.paridad >= PARIDAD_MIN) && (t.estado === "LISTO" || t.estado === "CANCELADO") && (
                        <Button size="sm" variant={(med?.f1 || 0) >= F1_SIRVE ? "default" : "outline"} onClick={alUsar} disabled={ocupado} title={t.conjunto?.corto?.length ? "Se entrenó con un conjunto chico: sirve para probar" : undefined}>
                            {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} Usar en las cámaras
                        </Button>
                    )}
                {alBorrado && !enUso && (
                    <DeleteConfirmDialog id={t.id} title={`Entrenamiento del ${fechaHoraSeg(t.createdAt)}`}
                        description="Se borra de la lista, con su modelo y su carpeta de trabajo. Las fotos dibujadas no se tocan: se pueden volver a entrenar."
                        onDelete={async (id: string) => {
                            const r = await fetch(`/api/vision/objetos/entrenamientos/${id}?borrar=1`, { method: "DELETE" });
                            const j = await r.json().catch(() => ({}));
                            if (r.ok && j.avisos?.length) toast.warning({ title: "Borrado, con avisos", description: j.avisos.join(" · ") });
                            return r.ok ? { success: true } : { success: false, error: j.error || `El servidor respondió ${r.status}` };
                        }}
                        onSuccess={alBorrado}>
                        <button type="button" title="Eliminar este entrenamiento" aria-label="Eliminar este entrenamiento"
                            className={cn("w-8 h-8 rounded-md grid place-items-center text-muted-foreground hover:text-[var(--mal-texto)] hover:bg-[var(--mal-suave)] transition-colors", !med && "ml-auto")}>
                            <Trash2 size={14} />
                        </button>
                    </DeleteConfirmDialog>
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
                                const tip = consejo(escapados, c.de_mas, c.recuadros);
                                return (
                                    <div key={id} className="rounded-[8px] bg-muted/50 px-3 py-2.5 text-[12px] space-y-1">
                                        <div className="font-bold text-[13px]">{nombre(id)}</div>
                                        <div className="tabular-nums"><b>Encontró {c.encontrados} de {c.recuadros}</b>{escapados ? ` · se le ${escapados === 1 ? "escapó 1" : `escaparon ${escapados}`}` : " · no se le escapó ninguno"}</div>
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
