"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Spline, ArrowLeftRight, Timer, Users, Plus, Loader2, Save, Trash2, ScanEye, ListVideo, Activity, Camera, BellRing, BellOff, Type,
    type LucideIcon,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Pista } from "@/components/ui/pista";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EditorGeometria } from "@/components/vision/EditorGeometria";
import {
    TIPOS_REGLA, CLASES_REGLA, NOMBRE_CLASE_REGLA, TIPOS_EVENTO, duracionCorta,
    type ReglaVision, type TipoRegla, type Punto,
} from "@/lib/vision-reglas";

/**
 * Reglas de visión: conteo por línea, sentido contrario, tiempo de permanencia y aglomeración.
 *
 * Una regla es una cámara, una línea o una zona dibujada sobre su cuadro y unos números.
 * vision-worker la aplica sobre el seguimiento de esa cámara (cada ~2 s) y lo que pasa queda
 * acá: los números de hoy de cada regla y los eventos con su foto. Las que avisan crean un aviso
 * a la guardia (consola, Control LPR y Visitas), igual que los avisos de visitas.
 *
 * Sin entrada en el menú, bajo el permiso Ajustes, como el resto de Visión.
 */

type Evento = { id: string; tipo: string; reglaId: string; regla: string; camara: string; clase: string | null; sentido: string | null; valor: number | null; foto: string | null; caja: [number, number, number, number] | null; avisoId: string | null; ts: string };
type Resumen = { ab: number; ba: number; porClase: Record<string, { ab: number; ba: number }>; porHora: number[]; hoy: number; max: number | null };
type Respuesta = {
    reglas: ReglaVision[]; camaras: { id: string; name: string }[];
    analiticas: Record<TipoRegla, boolean>; rotulado: boolean;
    estado: null | { t: string; reglas: null | { cruces: number; sentido: number; permanencia: number; aglomeracion: number; avisos: number; errores: number; ultimoError: string | null } };
    resumen: Record<string, Resumen>; eventos: Evento[];
};

const ICONO: Record<TipoRegla, LucideIcon> = { conteo: Spline, sentido: ArrowLeftRight, permanencia: Timer, aglomeracion: Users };
const REFRESCO_MS = 15_000;
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Montevideo" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-UY", { day: "numeric", month: "short", timeZone: "America/Montevideo" });
const nuevaId = () => Math.random().toString(36).slice(2, 12);

function reglaNueva(tipo: TipoRegla, deviceId: string): ReglaVision {
    const t = TIPOS_REGLA[tipo];
    return {
        id: nuevaId(), tipo, deviceId, nombre: "", activa: true, clases: [...t.clasesDefecto], avisar: t.avisarDefecto,
        linea: null, zona: [], ...(tipo === "sentido" ? { permitido: "ab" as const } : {}),
        ...(t.segundosDefecto ? { segundos: t.segundosDefecto } : {}), ...(t.maximoDefecto ? { maximo: t.maximoDefecto } : {}),
    };
}

export default function ReglasVision() {
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editando, setEditando] = useState<ReglaVision | null>(null);
    const [esNueva, setEsNueva] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [ampliado, setAmpliado] = useState<Evento | null>(null);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/reglas", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

    /** Guarda la lista entera con un cambio. Devuelve si salió. */
    const guardarLista = async (reglas: ReglaVision[], texto: string) => {
        setGuardando(true);
        try {
            const r = await fetch("/api/vision/reglas", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reglas }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { toast.error({ title: "No se guardó", description: j.error || `El servidor respondió ${r.status}` }); return false; }
            toast.success({ title: texto, description: "vision-worker la toma en menos de 30 s." });
            await cargar();
            return true;
        } finally { setGuardando(false); }
    };

    const nombreCamara = useMemo(() => new Map((datos?.camaras || []).map((c) => [c.id, c.name])), [datos?.camaras]);

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las reglas…" /></div>;

    const est = datos.estado;
    const sinSenal = !est || Date.now() - new Date(est.t).getTime() > 60_000;

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto">
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><Spline size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Reglas de visión</h1>
                        {sinSenal ? <Chip tono="mal" icono={Activity}>vision-worker no da señal</Chip> : <Chip tono="bien" icono={Activity}>Aplicándose</Chip>}
                        {(Object.keys(TIPOS_REGLA) as TipoRegla[]).filter((t) => !datos.analiticas[t]).map((t) => <Chip key={t} tono="quieto">{TIPOS_REGLA[t].nombre}: apagada en el laboratorio</Chip>)}
                        {est?.reglas?.ultimoError && <Chip tono="aviso">Último error: {est.reglas.ultimoError}</Chip>}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        Una línea o una zona sobre el cuadro de una cámara, y qué hacer cuando algo la cruza o se queda. Se mira cada cámara con regla cada ~2 s y se sigue a cada objeto: lo que se mide es su pie, donde toca el piso.
                    </p>
                </div>
                <a href="/admin/vision/detecciones" className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-semibold hover:bg-accent"><ListVideo size={15} /> Detecciones</a>
                <a href="/admin/vision" className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-semibold hover:bg-accent"><ScanEye size={15} /> Laboratorio</a>
                <Button onClick={() => { setEsNueva(true); setEditando(reglaNueva("conteo", datos.camaras[0]?.id || "")); }}><Plus size={14} /> Nueva regla</Button>
            </div>

            <div className="rounded-[10px] border border-border bg-card px-4 py-2.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                <Type size={14} />
                <span><b className="text-foreground">Empresa por rotulado</b> no lleva regla: {datos.rotulado ? "está prendida y" : "está apagada en el laboratorio; prendida,"} lee el texto de cada vehículo del registro de detecciones y lo cruza con el catálogo de empresas. Se ve en Detecciones.</span>
            </div>

            {/* Las reglas */}
            {datos.reglas.length === 0 ? (
                <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">
                    Todavía no hay reglas. «Nueva regla» para dibujar la primera: una línea para contar o vigilar el sentido, o una zona para el tiempo de permanencia o la aglomeración.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {datos.reglas.map((r) => (
                        <TarjetaRegla key={r.id} r={r} camara={nombreCamara.get(r.deviceId) || "Cámara borrada"} s={datos.resumen[r.id]} apagadaLab={!datos.analiticas[r.tipo]}
                            alAbrir={() => { setEsNueva(false); setEditando(r); }}
                            alActivar={(v) => guardarLista(datos.reglas.map((x) => (x.id === r.id ? { ...x, activa: v } : x)), v ? "Regla prendida" : "Regla apagada")} />
                    ))}
                </div>
            )}

            {/* Lo que pasó */}
            <section>
                <div className="flex items-baseline justify-between mb-2">
                    <h2 className="text-[13px] font-bold">Eventos · últimos 7 días</h2>
                    <span className="text-[11.5px] text-muted-foreground">Los cruces del conteo no se listan: se suman en cada regla.</span>
                </div>
                {datos.eventos.length === 0 ? (
                    <div className="rounded-[10px] border border-border bg-card p-8 text-center text-[13px] text-muted-foreground">Sin eventos todavía.</div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                        {datos.eventos.map((e) => {
                            const t = TIPOS_EVENTO[e.tipo] || { nombre: e.tipo, tono: "quieto" as const };
                            return (
                                <button key={e.id} type="button" onClick={() => setAmpliado(e)} className="text-left rounded-[10px] border border-border bg-card overflow-hidden hover:border-[var(--accion)] transition-colors">
                                    <div className="relative aspect-video bg-black">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {e.foto ? <img src={`${e.foto}?w=320`} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Camera size={18} className="absolute inset-0 m-auto text-white/30" />}
                                        {e.caja && <span className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-sm" style={{ left: `${e.caja[0] * 100}%`, top: `${e.caja[1] * 100}%`, width: `${(e.caja[2] - e.caja[0]) * 100}%`, height: `${(e.caja[3] - e.caja[1]) * 100}%` }} />}
                                    </div>
                                    <div className="p-2.5 space-y-1">
                                        <div className="flex items-center gap-1.5"><Chip tono={t.tono}>{t.nombre}</Chip>{e.avisoId && <BellRing size={12} className="text-muted-foreground" />}</div>
                                        <div className="text-[12px] font-semibold truncate">{e.regla}</div>
                                        <div className="text-[11px] text-muted-foreground truncate">
                                            {e.tipo === "PERMANENCIA" ? `${NOMBRE_CLASE_REGLA[e.clase || ""] || e.clase} · ${duracionCorta(e.valor)}` : e.tipo === "AGLOMERACION" ? `${e.valor} personas` : NOMBRE_CLASE_REGLA[e.clase || ""] || e.clase} · {dia(e.ts)} {hora(e.ts)}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>

            {editando && (
                <CajonRegla regla={editando} nueva={esNueva} camaras={datos.camaras} guardando={guardando}
                    alCerrar={() => setEditando(null)}
                    alGuardar={async (r) => { if (await guardarLista(esNueva ? [...datos.reglas, r] : datos.reglas.map((x) => (x.id === r.id ? r : x)), esNueva ? "Regla creada" : "Regla guardada")) setEditando(null); }}
                    alBorrar={async () => { if (await guardarLista(datos.reglas.filter((x) => x.id !== editando.id), "Regla borrada")) setEditando(null); }} />
            )}

            <Dialog open={!!ampliado} onOpenChange={(o) => { if (!o) setAmpliado(null); }}>
                <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden bg-black border-border">
                    <DialogTitle className="sr-only">Evento {ampliado?.regla}</DialogTitle>
                    <DialogDescription className="sr-only">La foto del evento</DialogDescription>
                    {ampliado && (
                        <>
                            <div className="relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {ampliado.foto && <img src={ampliado.foto} alt="" className="w-full max-h-[75vh] object-contain" />}
                                {ampliado.caja && <span className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-sm" style={{ left: `${ampliado.caja[0] * 100}%`, top: `${ampliado.caja[1] * 100}%`, width: `${(ampliado.caja[2] - ampliado.caja[0]) * 100}%`, height: `${(ampliado.caja[3] - ampliado.caja[1]) * 100}%` }} />}
                            </div>
                            <div className="flex items-center gap-3 px-4 py-2.5 bg-card text-[12.5px]">
                                <Chip tono={(TIPOS_EVENTO[ampliado.tipo] || { tono: "quieto" }).tono as any}>{(TIPOS_EVENTO[ampliado.tipo] || { nombre: ampliado.tipo }).nombre}</Chip>
                                <b>{ampliado.regla}</b>
                                <span className="text-muted-foreground">{ampliado.camara} · {dia(ampliado.ts)} {hora(ampliado.ts)}</span>
                                {ampliado.tipo === "PERMANENCIA" && <span>se quedó {duracionCorta(ampliado.valor)}</span>}
                                {ampliado.tipo === "AGLOMERACION" && <span>{ampliado.valor} personas</span>}
                                {ampliado.avisoId && <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground"><BellRing size={12} /> avisó a la guardia</span>}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function TarjetaRegla({ r, camara, s, apagadaLab, alAbrir, alActivar }: { r: ReglaVision; camara: string; s?: Resumen; apagadaLab: boolean; alAbrir: () => void; alActivar: (v: boolean) => void }) {
    const Ic = ICONO[r.tipo];
    const max = Math.max(1, ...(s?.porHora || [0]));
    return (
        <div className={cn("rounded-[10px] border border-border bg-card p-3.5 flex flex-col gap-2.5", (!r.activa || apagadaLab) && "opacity-60")}>
            <div className="flex items-start gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-muted shrink-0"><Ic size={16} /></span>
                <button type="button" onClick={alAbrir} className="min-w-0 flex-1 text-left">
                    <div className="text-[13.5px] font-semibold truncate">{r.nombre}</div>
                    <div className="text-[11.5px] text-muted-foreground truncate">{TIPOS_REGLA[r.tipo].nombre} · {camara}</div>
                </button>
                <Pista titulo={r.activa ? "Prendida" : "Apagada"} texto={apagadaLab ? "Su analítica está apagada en el laboratorio: aunque la regla esté prendida, no corre." : "Apagada no se aplica, pero se guarda lo dibujado."}>
                    <span><Switch checked={r.activa} onCheckedChange={alActivar} aria-label="Prender o apagar la regla" /></span>
                </Pista>
            </div>
            {r.tipo === "conteo" ? (
                <div className="space-y-2">
                    <div className="flex items-baseline gap-4">
                        <div><div className="text-[22px] font-bold tabular-nums leading-none">{s?.ab ?? 0}</div><div className="text-[11px] text-muted-foreground mt-1">de A a B hoy</div></div>
                        <div><div className="text-[22px] font-bold tabular-nums leading-none">{s?.ba ?? 0}</div><div className="text-[11px] text-muted-foreground mt-1">de B a A hoy</div></div>
                    </div>
                    {/* Por hora de hoy: barras finas, sin ejes; el número exacto al pasar el mouse. */}
                    <div className="flex items-end gap-[2px] h-8" aria-label="Cruces por hora de hoy">
                        {(s?.porHora || Array(24).fill(0)).map((n, h) => (
                            <span key={h} title={`${String(h).padStart(2, "0")} h: ${n} cruces`} className="flex-1 rounded-t-[2px] bg-[var(--accion)]" style={{ height: `${Math.max(n ? 8 : 2, (n / max) * 100)}%`, opacity: n ? 0.85 : 0.18 }} />
                        ))}
                    </div>
                    {s && Object.keys(s.porClase).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            {Object.entries(s.porClase).map(([c, v]) => <span key={c} className="tabular-nums">{NOMBRE_CLASE_REGLA[c] || c}: {v.ab} / {v.ba}</span>)}
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex items-baseline gap-4">
                    <div><div className="text-[22px] font-bold tabular-nums leading-none">{s?.hoy ?? 0}</div><div className="text-[11px] text-muted-foreground mt-1">{r.tipo === "sentido" ? "en contra hoy" : r.tipo === "permanencia" ? "se quedaron hoy" : "aglomeraciones hoy"}</div></div>
                    {s?.max != null && r.tipo !== "sentido" && <div><div className="text-[22px] font-bold tabular-nums leading-none">{r.tipo === "permanencia" ? duracionCorta(s.max) : s.max}</div><div className="text-[11px] text-muted-foreground mt-1">{r.tipo === "permanencia" ? "la más larga" : "el máximo de personas"}</div></div>}
                </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {r.avisar ? <span className="inline-flex items-center gap-1"><BellRing size={11} /> avisa a la guardia</span> : <span className="inline-flex items-center gap-1"><BellOff size={11} /> sólo registra</span>}
                <span>· {r.clases.map((c) => NOMBRE_CLASE_REGLA[c] || c).join(", ")}</span>
            </div>
        </div>
    );
}

function CajonRegla({ regla, nueva, camaras, guardando, alCerrar, alGuardar, alBorrar }: {
    regla: ReglaVision; nueva: boolean; camaras: { id: string; name: string }[]; guardando: boolean;
    alCerrar: () => void; alGuardar: (r: ReglaVision) => void; alBorrar: () => void;
}) {
    const [r, setR] = useState<ReglaVision>(regla);
    const t = TIPOS_REGLA[r.tipo];
    const cambiar = (x: Partial<ReglaVision>) => setR((v) => ({ ...v, ...x }));
    const cambiarTipo = (tipo: TipoRegla) => {
        const base = { ...r, ...reglaNueva(tipo, r.deviceId), id: r.id, nombre: r.nombre };
        // La geometría se conserva si el tipo nuevo usa la misma.
        if (TIPOS_REGLA[tipo].geometria === t.geometria) { base.linea = r.linea; base.zona = r.zona; }
        setR(base);
    };
    const geometriaLista = t.geometria === "linea" ? !!r.linea : r.tipo === "aglomeracion" || (r.zona?.length || 0) >= 3;
    const listo = !!r.deviceId && geometriaLista && r.clases.length > 0;
    const final = (): ReglaVision => ({ ...r, nombre: r.nombre.trim() || `${t.nombre} · ${camaras.find((c) => c.id === r.deviceId)?.name || ""}`, zona: (r.zona?.length || 0) >= 3 ? r.zona : null });

    return (
        <Cajon open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={nueva ? "Nueva regla" : r.nombre || t.nombre} descripcion={t.queHace}
                pie={
                    <>
                        {!nueva && <Button variant="outline" className="mr-auto tono-mal" onClick={alBorrar} disabled={guardando}><Trash2 size={15} /> Borrar</Button>}
                        <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                        <Button onClick={() => alGuardar(final())} disabled={!listo || guardando}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {nueva ? "Crear regla" : "Guardar"}</Button>
                    </>
                }>
                <CajonSeccion titulo="Qué mira">
                    <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(TIPOS_REGLA) as TipoRegla[]).map((k) => {
                            const Ic = ICONO[k]; const sel = r.tipo === k;
                            return (
                                <button key={k} type="button" onClick={() => cambiarTipo(k)} aria-pressed={sel}
                                    className={cn("rounded-[10px] border p-3 text-left transition-colors", sel ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border hover:bg-accent")}>
                                    <span className="flex items-center gap-1.5 text-[13px] font-bold"><Ic size={14} /> {TIPOS_REGLA[k].nombre}</span>
                                    <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{TIPOS_REGLA[k].geometria === "linea" ? "Con una línea" : k === "aglomeracion" ? "Con una zona (o todo el cuadro)" : "Con una zona"}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <CajonCampo etiqueta="Cámara">
                            <Select value={r.deviceId} onValueChange={(v) => cambiar({ deviceId: v, linea: null, zona: [] })}>
                                <SelectTrigger><SelectValue placeholder="Elegí la cámara" /></SelectTrigger>
                                <SelectContent>{camaras.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </CajonCampo>
                        <CajonCampo etiqueta="Nombre" ayuda="Lo que dice el aviso: «… en sentido contrario · Salida por la entrada».">
                            <Input value={r.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder={`${t.nombre} · ${camaras.find((c) => c.id === r.deviceId)?.name || ""}`} />
                        </CajonCampo>
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo={t.geometria === "linea" ? "La línea" : "La zona"}
                    ayuda={t.geometria === "linea" ? "Dibujala sobre el piso, de lado a lado de por donde se pasa." : r.tipo === "aglomeracion" ? "Opcional: sin zona se cuenta todo el cuadro." : "Sobre el piso: se mide dónde está el pie de cada objeto."}>
                    {r.deviceId ? (
                        <EditorGeometria deviceId={r.deviceId} modo={t.geometria} linea={r.linea || null} zona={r.zona || []}
                            permitido={r.tipo === "sentido" ? r.permitido : undefined}
                            alCambiarLinea={(l) => cambiar({ linea: l })} alCambiarZona={(z: Punto[]) => cambiar({ zona: z })} />
                    ) : <p className="text-[12px] text-muted-foreground">Elegí la cámara primero.</p>}
                    {r.tipo === "sentido" && (
                        <CajonCampo etiqueta="Sentido permitido" ayuda="La flecha verde: por ahí se pasa. Avisa cuando algo cruza como la roja.">
                            <div className="flex items-center h-9 rounded-lg bg-muted/60 p-0.5 w-fit">
                                {(["ab", "ba"] as const).map((v) => (
                                    <button key={v} type="button" onClick={() => cambiar({ permitido: v })}
                                        className={cn("h-8 px-3 rounded-md text-[12.5px] font-semibold", r.permitido === v ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                        {v === "ab" ? "De A a B" : "De B a A"}
                                    </button>
                                ))}
                            </div>
                        </CajonCampo>
                    )}
                </CajonSeccion>

                <CajonSeccion titulo="Qué cuenta">
                    <div className="flex flex-wrap gap-1.5">
                        {CLASES_REGLA.map((c) => {
                            const on = r.clases.includes(c.clase);
                            return (
                                <button key={c.clase} type="button" aria-pressed={on} onClick={() => cambiar({ clases: on ? r.clases.filter((x) => x !== c.clase) : [...r.clases, c.clase] })}
                                    className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold", on ? "bg-[var(--accion)] text-[var(--accion-texto)] border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                                    {c.nombre}
                                </button>
                            );
                        })}
                    </div>
                    {(r.tipo === "permanencia" || r.tipo === "aglomeracion") && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {r.tipo === "aglomeracion" && (
                                <CajonCampo etiqueta="Desde cuántas personas" ayuda="A la vez, dentro de la zona.">
                                    <Input type="number" min={2} max={200} value={r.maximo ?? 5} onChange={(e) => cambiar({ maximo: Number(e.target.value) })} />
                                </CajonCampo>
                            )}
                            <CajonCampo etiqueta={r.tipo === "permanencia" ? "Avisar después de (minutos)" : "Durante cuánto (segundos)"}
                                ayuda={r.tipo === "permanencia" ? "Desde que el pie entra en la zona." : "Una reunión de paso no avisa; una que se queda, sí."}>
                                <Input type="number" min={r.tipo === "permanencia" ? 1 : 5}
                                    value={r.tipo === "permanencia" ? Math.round((r.segundos ?? 300) / 60) : r.segundos ?? 30}
                                    onChange={(e) => cambiar({ segundos: r.tipo === "permanencia" ? Number(e.target.value) * 60 : Number(e.target.value) })} />
                            </CajonCampo>
                        </div>
                    )}
                </CajonSeccion>

                <CajonSeccion titulo="Qué hace">
                    <label className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3 py-2.5 cursor-pointer">
                        <span>
                            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><BellRing size={13} /> Avisar a la guardia</span>
                            <span className="block text-[11.5px] text-muted-foreground leading-snug">Crea un aviso con la foto: aparece en la consola del guardia, en Control LPR y en Visitas. Apagado, sólo queda registrado acá.</span>
                        </span>
                        <Switch checked={r.avisar} onCheckedChange={(v) => cambiar({ avisar: v })} />
                    </label>
                    {r.tipo === "conteo" && <p className="text-[11.5px] text-muted-foreground">El conteo no avisa: suma los cruces por sentido, clase y hora. Se guardan 90 días.</p>}
                    <p className="text-[11.5px] text-muted-foreground">Límite: cada cámara se mira cada ~2 s. Personas y autos a paso de barrio se siguen bien; un auto rápido puede perder su número entre dos cuadros y no contarse.</p>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
