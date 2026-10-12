"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Spline, ArrowLeftRight, Timer, Users, Plus, Loader2, Save, Trash2, Activity, Camera, BellRing, BellOff, Type, Fence, ShieldAlert, Clock, Footprints, PackageMinus,
    PersonStanding, Car, Truck, Bus, Motorbike, Bike, Dog, Backpack, ShoppingBag, Luggage, Armchair, Sofa, Sprout, Boxes, Gauge,
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
    TIPOS_REGLA, CLASES_REGLA, CLASES_OBJETO, CON_HORARIO, NOMBRE_CLASE_REGLA, TIPOS_EVENTO, duracionCorta,
    type ReglaVision, type TipoRegla, type Punto,
} from "@/lib/vision-reglas";
import { listaPropias, nombrePropio, useNombresPropios } from "@/lib/nombres-propios";

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

type Evento = { id: string; tipo: string; reglaId: string; regla: string; camara: string; clase: string | null; sentido: string | null; valor: number | null; foto: string | null; fotoAntes?: string | null; caja: [number, number, number, number] | null; avisoId: string | null; ts: string };
type Resumen = { ab: number; ba: number; porClase: Record<string, { ab: number; ba: number }>; porHora: number[]; hoy: number; max: number | null };
type Respuesta = {
    reglas: ReglaVision[]; camaras: { id: string; name: string }[];
    analiticas: Record<TipoRegla, boolean>; rotulado: boolean;
    estado: null | { t: string; reglas: null | { cruces: number; sentido: number; permanencia: number; aglomeracion: number; avisos: number; errores: number; ultimoError: string | null } };
    resumen: Record<string, Resumen>; eventos: Evento[];
};

const ICONO: Record<TipoRegla, LucideIcon> = { conteo: Spline, sentido: ArrowLeftRight, permanencia: Timer, aglomeracion: Users, cruce: Fence, intrusion: ShieldAlert, merodeo: Footprints, retirado: PackageMinus };
/** Lo que se cuenta hoy en la tarjeta de cada tipo que no es conteo. */
const CUENTA_HOY: Partial<Record<TipoRegla, string>> = { sentido: "en contra hoy", permanencia: "se quedaron hoy", aglomeracion: "aglomeraciones hoy", cruce: "cruces hoy", intrusion: "intrusiones hoy", merodeo: "merodeos hoy", retirado: "retirados hoy" };
/**
 * Cómo aparece el nombre de la regla en el aviso, por tipo (los textos los arma vision-reglas.js).
 * Antes la ayuda daba el ejemplo de sentido contrario para cualquier tipo, y en una regla de
 * objeto retirado decía «Salida por la entrada»: no sirve para elegir un nombre.
 * El conteo no avisa, así que su nombre sólo se ve en la tarjeta.
 */
const EJEMPLO_AVISO: Record<TipoRegla, (n: string) => string> = {
    conteo: (n) => `La tarjeta se llama «${n}»`, sentido: (n) => `«Auto en sentido contrario · ${n}»`,
    permanencia: (n) => `«Persona hace 5 min en ${n}»`, aglomeracion: (n) => `«6 personas juntas en ${n}»`,
    cruce: (n) => `«Persona cruzó ${n}»`, intrusion: (n) => `«Persona en ${n}»`,
    merodeo: (n) => `«Persona dando vueltas hace 2 min en ${n}»`, retirado: (n) => `«Se llevaron una bicicleta de ${n}»`,
};
/**
 * El ícono de cada clase en «Qué cuenta»: se reconoce la clase antes de leerla. Las del detector
 * propio (entrenadas en Objetos nuevos) llevan el de cajas, con su marca.
 */
const ICONO_CLASE: Record<string, LucideIcon> = {
    person: PersonStanding, car: Car, truck: Truck, bus: Bus, motorcycle: Motorbike, bicycle: Bike, dog: Dog,
    backpack: Backpack, handbag: ShoppingBag, suitcase: Luggage, chair: Armchair, bench: Sofa, "potted plant": Sprout,
};
/** El horario que se propone al armar de noche: lo más común en un barrio. */
const HORARIO_NOCHE = { desde: "22:00", hasta: "06:00" };
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
        ...(tipo === "cruce" ? { sentidos: "ambos" as const } : {}), ...(CON_HORARIO.includes(tipo) ? { horario: null } : {}),
    };
}

export default function ReglasVision() {
    useNombresPropios();  // para ofrecer y nombrar las clases del detector propio
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editando, setEditando] = useState<ReglaVision | null>(null);
    const [esNueva, setEsNueva] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [ampliado, setAmpliado] = useState<Evento | null>(null);
    const [eligiendo, setEligiendo] = useState(false);
    const [filtroEvento, setFiltroEvento] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/reglas", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

    // «Crear regla» desde Analíticas llega con ?nueva=<tipo>: se abre el cajón una vez y se
    // limpia la dirección, así recargar la página no abre otra regla nueva.
    const pedidaNueva = useRef(false);
    useEffect(() => {
        if (!datos || pedidaNueva.current) return;
        pedidaNueva.current = true;
        const sp = new URLSearchParams(window.location.search);
        // «Editar la regla» desde Accesos llega con ?editar=<id>.
        const aEditar = sp.get("editar") && datos.reglas.find((x) => x.id === sp.get("editar"));
        if (aEditar) { window.history.replaceState(null, "", window.location.pathname); setEsNueva(false); setEditando(aEditar); return; }
        const tipo = sp.get("nueva") as TipoRegla | null;
        if (!tipo || !(tipo in TIPOS_REGLA)) return;
        window.history.replaceState(null, "", window.location.pathname);
        setEsNueva(true);
        setEditando(reglaNueva(tipo, datos.camaras[0]?.id || ""));
    }, [datos]);

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

    const activas = datos.reglas.filter((r) => r.activa && datos.analiticas[r.tipo]).length;
    const camarasConReglas = [...new Set(datos.reglas.map((r) => r.deviceId))];
    const avisos7 = datos.eventos.filter((e) => e.avisoId).length;
    const tiposEnEventos = [...new Set(datos.eventos.map((e) => e.tipo))];
    const eventosVisibles = filtroEvento ? datos.eventos.filter((e) => e.tipo === filtroEvento) : datos.eventos;
    const crear = (tipo: TipoRegla) => { setEligiendo(false); setEsNueva(true); setEditando(reglaNueva(tipo, datos.camaras[0]?.id || "")); };

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            {/* ── Encabezado ── */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Reglas de visión</h1>
                        {sinSenal ? <Chip tono="mal" icono={Activity}>vision-worker no da señal</Chip> : <Chip tono="bien" icono={Activity}>Aplicándose</Chip>}
                        {est?.reglas?.ultimoError && <Chip tono="aviso">Último error: {est.reglas.ultimoError}</Chip>}
                    </div>
                    <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5 max-w-3xl">
                        Una línea o una zona sobre el cuadro de una cámara, y qué hacer cuando algo la cruza o se queda. Se mira cada ~2 s y se sigue a cada objeto por su pie, donde toca el piso.
                    </p>
                </div>
                <Button onClick={() => setEligiendo((v) => !v)} aria-expanded={eligiendo}><Plus size={14} /> Nueva regla</Button>
            </div>

            {/* ── Elegir qué vigilar: los tipos, con lo que hace cada uno ── */}
            {(eligiendo || datos.reglas.length === 0) && (
                <section className="rounded-[10px] border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <h2 className="text-[13px] font-bold">{datos.reglas.length === 0 ? "Elegí qué querés vigilar" : "¿Qué tipo de regla?"}</h2>
                        <span className="text-[12px] text-muted-foreground">Después se elige la cámara y se dibuja la línea o la zona.</span>
                        {eligiendo && datos.reglas.length > 0 && <button type="button" onClick={() => setEligiendo(false)} className="ml-auto text-[12px] text-muted-foreground hover:text-foreground">Cerrar</button>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                        {(Object.keys(TIPOS_REGLA) as TipoRegla[]).map((t) => {
                            const Ic = ICONO[t];
                            const apagada = !datos.analiticas[t];
                            return (
                                <button key={t} type="button" onClick={() => crear(t)}
                                    className="group text-left rounded-[10px] border border-border p-3 hover:border-[var(--accion)] hover:bg-accent/30 transition-colors flex gap-3">
                                    <Esquema tipo={t} />
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Ic size={14} className="text-muted-foreground group-hover:text-[var(--accion)]" /> {TIPOS_REGLA[t].nombre}</span>
                                        <span className="block text-[11.5px] text-muted-foreground leading-snug mt-0.5 line-clamp-3">{TIPOS_REGLA[t].queHace}</span>
                                        {apagada && <span className="block text-[11px] tono-aviso mt-1">Apagada en Analíticas: se puede dibujar, pero no corre.</span>}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ── Los números ── */}
            {datos.reglas.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Numero rotulo="Reglas corriendo" valor={<>{activas}<span className="text-muted-foreground font-semibold">/{datos.reglas.length}</span></>} pista="Prendidas y con su analítica encendida en Analíticas." />
                    <Numero rotulo="Cámaras con reglas" valor={camarasConReglas.length} pista="Cada cámara con al menos una regla se mira cada ~2 s." />
                    <Numero rotulo="Eventos · 7 días" valor={datos.eventos.length} pista="Sentido contrario, permanencias, aglomeraciones, cruces, intrusiones, merodeos y retirados. Los cruces del conteo no se listan: se suman en cada regla." />
                    <Numero rotulo="Avisos a la guardia · 7 días" valor={avisos7} pista="Los eventos de reglas que avisan llegan a la consola, Control LPR y Visitas." />
                </div>
            )}
            <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
                <Type size={13} /> <b className="text-foreground font-semibold">Empresa por rotulado</b> no lleva regla: {datos.rotulado ? "está prendida y lee" : "está apagada en Analíticas; prendida, lee"} el texto de cada vehículo y lo cruza con el catálogo de empresas (se ve en Detecciones).
                {(Object.keys(TIPOS_REGLA) as TipoRegla[]).some((t) => !datos.analiticas[t]) && <span className="ml-1">Apagadas en Analíticas: {(Object.keys(TIPOS_REGLA) as TipoRegla[]).filter((t) => !datos.analiticas[t]).map((t) => TIPOS_REGLA[t].nombre).join(", ")}.</span>}
            </p>

            {/* ── Las reglas, por cámara, sobre su cuadro ── */}
            {camarasConReglas.map((cam) => {
                const deCam = datos.reglas.filter((r) => r.deviceId === cam);
                return (
                    <section key={cam} className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Camera size={14} className="text-muted-foreground" />
                            <h2 className="text-[13px] font-bold">{nombreCamara.get(cam) || "Cámara borrada"}</h2>
                            <span className="text-[12px] text-muted-foreground tabular-nums">{deCam.length} regla{deCam.length === 1 ? "" : "s"}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                            {deCam.map((r) => (
                                <TarjetaRegla key={r.id} r={r} camara={nombreCamara.get(r.deviceId) || "Cámara borrada"} s={datos.resumen[r.id]} apagadaLab={!datos.analiticas[r.tipo]}
                                    alAbrir={() => { setEsNueva(false); setEditando(r); }}
                                    alActivar={(v) => guardarLista(datos.reglas.map((x) => (x.id === r.id ? { ...x, activa: v } : x)), v ? "Regla prendida" : "Regla apagada")} />
                            ))}
                        </div>
                    </section>
                );
            })}

            {/* ── Lo que pasó ── */}
            {datos.reglas.length > 0 && (
            <section className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[13px] font-bold">Eventos · últimos 7 días</h2>
                    {tiposEnEventos.length > 1 && (
                        <span className="flex items-center gap-1 flex-wrap">
                            <button type="button" onClick={() => setFiltroEvento(null)} aria-pressed={!filtroEvento}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", !filtroEvento ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}>Todos</button>
                            {tiposEnEventos.map((t) => (
                                <button key={t} type="button" onClick={() => setFiltroEvento(t)} aria-pressed={filtroEvento === t}
                                    className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", filtroEvento === t ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}>
                                    {(TIPOS_EVENTO[t] || { nombre: t }).nombre} <span className="tabular-nums opacity-70">{datos.eventos.filter((e) => e.tipo === t).length}</span>
                                </button>
                            ))}
                        </span>
                    )}
                    <span className="ml-auto text-[11.5px] text-muted-foreground">Los cruces del conteo se suman en cada regla.</span>
                </div>
                {eventosVisibles.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">Sin eventos todavía. Cuando una regla vea algo, queda acá con su foto.</div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
                        {eventosVisibles.map((e) => {
                            const t = TIPOS_EVENTO[e.tipo] || { nombre: e.tipo, tono: "quieto" as const };
                            return (
                                <button key={e.id} type="button" onClick={() => setAmpliado(e)} className="text-left rounded-[10px] border border-border bg-card overflow-hidden hover:border-[var(--accion)] transition-colors">
                                    <div className="relative aspect-video bg-black">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {e.foto ? <img src={`${e.foto}?w=320`} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Camera size={18} className="absolute inset-0 m-auto text-white/30" />}
                                        {e.caja && <span className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-sm" style={{ left: `${e.caja[0] * 100}%`, top: `${e.caja[1] * 100}%`, width: `${(e.caja[2] - e.caja[0]) * 100}%`, height: `${(e.caja[3] - e.caja[1]) * 100}%` }} />}
                                        <span className="absolute left-1.5 top-1.5"><Chip tono={t.tono}>{t.nombre}</Chip></span>
                                        {e.avisoId && <span className="absolute right-1.5 top-1.5 w-6 h-6 grid place-items-center rounded-full bg-black/60 text-white" title="Avisó a la guardia"><BellRing size={12} /></span>}
                                    </div>
                                    <div className="px-2.5 py-2">
                                        <div className="text-[12px] font-semibold truncate">{e.regla}</div>
                                        <div className="text-[11px] text-muted-foreground truncate tabular-nums">
                                            {e.tipo === "PERMANENCIA" ? `${NOMBRE_CLASE_REGLA[e.clase || ""] || e.clase} · ${duracionCorta(e.valor)}` : e.tipo === "AGLOMERACION" ? `${e.valor} personas` : NOMBRE_CLASE_REGLA[e.clase || ""] || e.clase} · {dia(e.ts)} {hora(e.ts)}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>
            )}

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
                                {/* Objeto retirado: antes y después, lado a lado. */}
                                {ampliado.fotoAntes ? (
                                    <div className="grid grid-cols-2 gap-px bg-border">
                                        <figure className="relative bg-black"><img src={ampliado.fotoAntes} alt="Antes" className="w-full max-h-[70vh] object-contain" /><figcaption className="absolute left-2 top-2 px-2 py-0.5 rounded-md bg-black/70 text-white text-[12px] font-semibold">Antes</figcaption></figure>
                                        <figure className="relative bg-black">{ampliado.foto && <img src={ampliado.foto} alt="Después" className="w-full max-h-[70vh] object-contain" />}<figcaption className="absolute left-2 top-2 px-2 py-0.5 rounded-md bg-black/70 text-white text-[12px] font-semibold">Después</figcaption></figure>
                                    </div>
                                ) : ampliado.foto && <img src={ampliado.foto} alt="" className="w-full max-h-[75vh] object-contain" />}
                                {ampliado.caja && !ampliado.fotoAntes && <span className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-sm" style={{ left: `${ampliado.caja[0] * 100}%`, top: `${ampliado.caja[1] * 100}%`, width: `${(ampliado.caja[2] - ampliado.caja[0]) * 100}%`, height: `${(ampliado.caja[3] - ampliado.caja[1]) * 100}%` }} />}
                            </div>
                            <div className="flex items-center gap-3 px-4 py-2.5 bg-card text-[12.5px]">
                                <Chip tono={(TIPOS_EVENTO[ampliado.tipo] || { tono: "quieto" }).tono as any}>{(TIPOS_EVENTO[ampliado.tipo] || { nombre: ampliado.tipo }).nombre}</Chip>
                                <b>{ampliado.regla}</b>
                                <span className="text-muted-foreground">{ampliado.camara} · {dia(ampliado.ts)} {hora(ampliado.ts)}</span>
                                {ampliado.tipo === "PERMANENCIA" && <span>se quedó {duracionCorta(ampliado.valor)}</span>}
                                {ampliado.tipo === "AGLOMERACION" && <span>{ampliado.valor} personas</span>}
                                {ampliado.tipo === "INTRUSION" && ampliado.valor != null && <span>{ampliado.valor} s adentro al avisar</span>}
                                {ampliado.tipo === "MERODEO" && ampliado.valor != null && <span>{duracionCorta(ampliado.valor)} dando vueltas al avisar</span>}
                                {ampliado.tipo === "RETIRADO" && ampliado.valor != null && <span>estuvo {duracionCorta(ampliado.valor)} a la vista</span>}
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
        <div className={cn("rounded-[10px] border border-border bg-card overflow-hidden flex flex-col", (!r.activa || apagadaLab) && "opacity-60")}>
            {/* El cuadro de la cámara con lo dibujado encima: se reconoce la regla sin leerla. */}
            <button type="button" onClick={alAbrir} className="relative aspect-[16/7] bg-black overflow-hidden" aria-label={`Editar ${r.nombre}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/snapshot/${r.deviceId}?w=480`} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-80" />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                    {r.zona && r.zona.length >= 3 && <polygon points={r.zona.map(([x, y]) => `${x},${y}`).join(" ")} fill="var(--accion-en-oscuro)" fillOpacity={0.22} stroke="var(--accion-en-oscuro)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                    {r.linea && <line x1={r.linea.a[0]} y1={r.linea.a[1]} x2={r.linea.b[0]} y2={r.linea.b[1]} stroke="var(--accion-en-oscuro)" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
                </svg>
                {r.linea && <>
                    <span className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold grid place-items-center" style={{ left: `${r.linea.a[0] * 100}%`, top: `${r.linea.a[1] * 100}%` }}>A</span>
                    <span className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold grid place-items-center" style={{ left: `${r.linea.b[0] * 100}%`, top: `${r.linea.b[1] * 100}%` }}>B</span>
                </>}
                {!r.linea && !(r.zona && r.zona.length >= 3) && <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded-[5px] bg-black/65 text-white text-[11px]">Todo el cuadro</span>}
            </button>
            <div className="p-3.5 flex flex-col gap-2.5">
            <div className="flex items-start gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-muted shrink-0"><Ic size={16} /></span>
                <button type="button" onClick={alAbrir} className="min-w-0 flex-1 text-left">
                    <div className="text-[13.5px] font-semibold truncate">{r.nombre}</div>
                    <div className="text-[11.5px] text-muted-foreground truncate">{TIPOS_REGLA[r.tipo].nombre} · {camara}</div>
                </button>
                <Pista titulo={r.activa ? "Prendida" : "Apagada"} texto={apagadaLab ? "Su analítica está apagada en Analíticas: aunque la regla esté prendida, no corre." : "Apagada no se aplica, pero se guarda lo dibujado."}>
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
                    <div><div className="text-[22px] font-bold tabular-nums leading-none">{s?.hoy ?? 0}</div><div className="text-[11px] text-muted-foreground mt-1">{CUENTA_HOY[r.tipo]}</div></div>
                    {CON_HORARIO.includes(r.tipo) && <div className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1"><Clock size={11} /> {r.horario ? `armada ${r.horario.desde} a ${r.horario.hasta}` : "armada siempre"}{r.tipo === "cruce" && r.sentidos && r.sentidos !== "ambos" ? ` · sólo ${r.sentidos === "ab" ? "de A a B" : "de B a A"}` : ""}</div>}
                    {s?.max != null && (r.tipo === "permanencia" || r.tipo === "aglomeracion") && <div><div className="text-[22px] font-bold tabular-nums leading-none">{r.tipo === "permanencia" ? duracionCorta(s.max) : s.max}</div><div className="text-[11px] text-muted-foreground mt-1">{r.tipo === "permanencia" ? "la más larga" : "el máximo de personas"}</div></div>}
                </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {r.avisar ? <span className="inline-flex items-center gap-1"><BellRing size={11} /> avisa a la guardia</span> : <span className="inline-flex items-center gap-1"><BellOff size={11} /> sólo registra</span>}
                <span className="truncate">· {r.clases.map((c) => NOMBRE_CLASE_REGLA[c] || nombrePropio(c) || c).join(", ")}</span>
            </div>
            </div>
        </div>
    );
}

/** Un número del resumen, con su explicación al pasar el mouse. */
function Numero({ rotulo, valor, pista }: { rotulo: string; valor: React.ReactNode; pista: string }) {
    return (
        <div className="rounded-[10px] border border-border bg-card px-3.5 py-3">
            <Pista titulo={rotulo} texto={pista} ancho={280}><span className="text-[11.5px] text-muted-foreground cursor-help">{rotulo}</span></Pista>
            <div className="text-[22px] font-bold tabular-nums leading-tight tracking-[-0.02em] mt-0.5">{valor}</div>
        </div>
    );
}

/**
 * El dibujo de cada tipo, para elegirlo sin leer: una línea con su sentido o una zona, y los
 * puntitos de lo que se mira. En `currentColor`, así sigue al tema solo.
 */
function Esquema({ tipo }: { tipo: TipoRegla }) {
    const linea = TIPOS_REGLA[tipo].geometria === "linea";
    return (
        <svg viewBox="0 0 64 48" className="w-16 h-12 shrink-0 rounded-[6px] bg-muted text-muted-foreground group-hover:text-[var(--accion)] transition-colors" aria-hidden="true">
            {linea ? (
                <>
                    <line x1="8" y1="38" x2="56" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    {tipo === "sentido" ? <path d="M20 14 l10 0 m-4 -4 l4 4 l-4 4" fill="none" stroke="currentColor" strokeWidth="2" /> : <path d="M26 34 l8 -10 m-6 0 l6 0 l0 6" fill="none" stroke="currentColor" strokeWidth="2" />}
                </>
            ) : (
                <polygon points="12,14 50,10 54,38 10,40" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            )}
            {tipo === "aglomeracion" ? [[22, 24], [30, 28], [38, 22], [28, 32], [36, 32]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.4" fill="currentColor" />)
                : tipo === "merodeo" ? <path d="M20 30 q8 -14 16 -2 t12 -6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 3" />
                : tipo === "retirado" ? <rect x="26" y="20" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 2" />
                : tipo === "permanencia" ? <><circle cx="32" cy="25" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M32 21 v4 l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" /></>
                : <circle cx={linea ? 40 : 32} cy={linea ? 30 : 25} r="3" fill="currentColor" />}
        </svg>
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
    const geometriaLista = t.geometria === "linea" ? !!r.linea : r.tipo === "aglomeracion" || r.tipo === "merodeo" || (r.zona?.length || 0) >= 3;
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
                                    <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{TIPOS_REGLA[k].geometria === "linea" ? (k === "cruce" ? "Con una línea · avisa" : "Con una línea") : k === "aglomeracion" ? "Con una zona (o todo el cuadro)" : k === "merodeo" ? "Zona o cuadro · avisa" : k === "intrusion" || k === "retirado" ? "Con una zona · avisa" : "Con una zona"}</span>
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
                        <CajonCampo etiqueta="Nombre" ayuda={r.tipo === "conteo" ? EJEMPLO_AVISO.conteo(r.nombre || "…") : `Así sale en el aviso: ${EJEMPLO_AVISO[r.tipo](r.nombre || "…")}.`}>
                            <Input value={r.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder={`${t.nombre} · ${camaras.find((c) => c.id === r.deviceId)?.name || ""}`} />
                        </CajonCampo>
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Qué cuenta" icono={Boxes}
                    ayuda={r.clases.length ? `${r.clases.length} ${r.clases.length === 1 ? "clase prendida" : "clases prendidas"}: sólo eso dispara la regla.` : "Prendé al menos una: sin clases la regla no mira nada."}>
                    {/* Una tarjeta con su interruptor por clase. Antes eran píldoras sin ícono, abajo
                        del dibujo: lo que la regla cuenta se elegía al final y se leía mal. Las
                        clases del detector propio se ofrecen en todas: un contenedor puede faltar
                        (retirado), quedarse en una zona o cruzar una línea. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[...(r.tipo === "retirado" ? [...CLASES_REGLA.filter((c) => c.clase !== "person" && c.clase !== "dog"), ...CLASES_OBJETO] : CLASES_REGLA), ...listaPropias()].map((c) => {
                            const on = r.clases.includes(c.clase);
                            const propia = !ICONO_CLASE[c.clase];
                            const Ic = ICONO_CLASE[c.clase] || Boxes;
                            const alternar = () => cambiar({ clases: on ? r.clases.filter((x) => x !== c.clase) : [...r.clases, c.clase] });
                            return (
                                <div key={c.clase} role="button" tabIndex={0} onClick={alternar} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); alternar(); } }}
                                    className={cn("flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2 cursor-pointer select-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion-foco,var(--accion))]",
                                        on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border hover:bg-accent/50")}>
                                    <span className={cn("grid h-9 w-9 place-items-center rounded-[9px] shrink-0 transition-colors", on ? "bg-[var(--accion)] text-[var(--accion-sobre,#fff)]" : "bg-muted text-muted-foreground")}>
                                        <Ic size={18} strokeWidth={2} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className={cn("block text-[12.5px] font-semibold truncate", !on && "text-muted-foreground")}>{c.nombre}</span>
                                        <span className="block text-[10.5px] text-muted-foreground">{propia ? "Entrenado acá · " : ""}{on ? "La cuenta" : "No la mira"}</span>
                                    </span>
                                    {/* El interruptor sólo muestra: el clic lo maneja la tarjeta entera. */}
                                    <span onClick={(e) => e.stopPropagation()}><Switch checked={on} onCheckedChange={alternar} aria-label={`${on ? "Dejar de contar" : "Contar"} ${c.nombre}`} /></span>
                                </div>
                            );
                        })}
                    </div>
                </CajonSeccion>


                <CajonSeccion titulo={t.geometria === "linea" ? "La línea" : "La zona"}
                    ayuda={t.geometria === "linea" ? "Dibujala sobre el piso, de lado a lado de por donde se pasa." : r.tipo === "aglomeracion" || r.tipo === "merodeo" ? "Opcional: sin zona se mira todo el cuadro." : r.tipo === "retirado" ? "Donde están las cosas a cuidar (el bicicletero, la entrada de una casa). Lo quieto adentro se aprende solo en un minuto." : "Sobre el piso: se mide dónde está el pie de cada objeto."}>
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
                    {r.tipo === "cruce" && (
                        <CajonCampo etiqueta="Avisa cuando cruza" ayuda="A y B son los dos lados de la línea, rotulados sobre el cuadro.">
                            <div className="flex items-center h-9 rounded-lg bg-muted/60 p-0.5 w-fit">
                                {(["ambos", "ab", "ba"] as const).map((v) => (
                                    <button key={v} type="button" onClick={() => cambiar({ sentidos: v })}
                                        className={cn("h-8 px-3 rounded-md text-[12.5px] font-semibold", (r.sentidos || "ambos") === v ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                        {v === "ambos" ? "En los dos sentidos" : v === "ab" ? "De A a B" : "De B a A"}
                                    </button>
                                ))}
                            </div>
                        </CajonCampo>
                    )}
                </CajonSeccion>

                {(r.tipo === "merodeo" || r.tipo === "retirado" || r.tipo === "intrusion" || r.tipo === "permanencia" || r.tipo === "aglomeracion") && (
                    <CajonSeccion titulo="Cuándo dispara" icono={Gauge}>
                    {(r.tipo === "merodeo" || r.tipo === "retirado") && (
                        <CajonCampo etiqueta={r.tipo === "merodeo" ? "Avisar después de (segundos)" : "Avisar si falta más de (segundos)"}
                            ayuda={r.tipo === "merodeo" ? "En la zona y caminando: alguien parado esperando no es merodeo. Desde 20 s." : "Sin verse ni estar tapado por una persona. Desde 5 s."}>
                            <Input type="number" min={r.tipo === "merodeo" ? 20 : 5} max={r.tipo === "merodeo" ? 3600 : 600} value={r.segundos ?? (r.tipo === "merodeo" ? 90 : 20)} onChange={(e) => cambiar({ segundos: Number(e.target.value) })} className="w-32" />
                        </CajonCampo>
                    )}
                    {r.tipo === "intrusion" && (
                        <CajonCampo etiqueta="Avisar después de (segundos)" ayuda="Adentro de la zona, seguidos. 2 s alcanza para que una sombra o un paso por el borde no avise; 0 avisa en el primer cuadro.">
                            <Input type="number" min={0} max={120} value={r.segundos ?? 2} onChange={(e) => cambiar({ segundos: Number(e.target.value) })} className="w-32" />
                        </CajonCampo>
                    )}
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
                )}

                {CON_HORARIO.includes(r.tipo) && (
                    <CajonSeccion titulo="Cuándo está armada" icono={Clock}
                        ayuda="Fuera de horario no registra ni avisa: el jardinero que cruza a las 10 no es una intrusión; el que cruza a las 3, sí. Hora del barrio.">
                        <div className="flex items-center h-9 rounded-lg bg-muted/60 p-0.5 w-fit">
                            {([["siempre", "Siempre"], ["horario", "En un horario"]] as const).map(([v, rot]) => (
                                <button key={v} type="button" onClick={() => cambiar({ horario: v === "siempre" ? null : r.horario || HORARIO_NOCHE })}
                                    className={cn("h-8 px-3 rounded-md text-[12.5px] font-semibold", (r.horario ? "horario" : "siempre") === v ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                    {rot}
                                </button>
                            ))}
                        </div>
                        {r.horario && (
                            <div className="flex items-end gap-3">
                                <CajonCampo etiqueta="Desde"><Input type="time" value={r.horario.desde} onChange={(e) => cambiar({ horario: { ...r.horario!, desde: e.target.value } })} className="w-32 tabular-nums" /></CajonCampo>
                                <CajonCampo etiqueta="Hasta"><Input type="time" value={r.horario.hasta} onChange={(e) => cambiar({ horario: { ...r.horario!, hasta: e.target.value } })} className="w-32 tabular-nums" /></CajonCampo>
                                {r.horario.desde > r.horario.hasta && <span className="text-[11.5px] text-muted-foreground pb-2.5">cruza la medianoche</span>}
                            </div>
                        )}
                    </CajonSeccion>
                )}

                <CajonSeccion titulo="Qué hace">
                    <label className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3 py-2.5 cursor-pointer">
                        <span>
                            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><BellRing size={13} /> Avisar a la guardia</span>
                            <span className="block text-[11.5px] text-muted-foreground leading-snug">Crea un aviso con la foto: aparece en la consola del guardia, en Control LPR y en Visitas. Apagado, sólo queda registrado acá.</span>
                        </span>
                        <Switch checked={r.avisar} onCheckedChange={(v) => cambiar({ avisar: v })} />
                    </label>
                    {r.tipo === "conteo" && <p className="text-[11.5px] text-muted-foreground">El conteo no avisa: suma los cruces por sentido, clase y hora. Se guardan 90 días.</p>}
                    {r.tipo === "cruce" && <p className="text-[11.5px] text-muted-foreground">Cada cruce queda registrado con su foto. El aviso se espacia 30 s por regla: cinco que saltan juntos son un aviso, no cinco.</p>}
                    {r.tipo === "intrusion" && <p className="text-[11.5px] text-muted-foreground">Una vez por objeto mientras siga adentro, con su foto. El aviso se espacia 1 min por regla.</p>}
                    {r.tipo === "merodeo" && <p className="text-[11.5px] text-muted-foreground">Una vez por persona, con su foto. El seguimiento no sabe que es la misma si sale del cuadro y vuelve. El aviso se espacia 2 min por regla.</p>}
                    {r.tipo === "retirado" && <p className="text-[11.5px] text-muted-foreground">Con la foto de antes (la última donde estaba) y la de después. Después de reiniciar el proceso, lo aprende de nuevo en un minuto.</p>}
                    <p className="text-[11.5px] text-muted-foreground">Límite: cada cámara se mira cada ~2 s. Personas y autos a paso de barrio se siguen bien; un auto rápido puede perder su número entre dos cuadros y no contarse.</p>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
