"use client";

import { ComoFunciona } from "@/components/vision/ComoFunciona";
import type { ClaveComportamiento } from "@/lib/comportamientos";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Spline, ArrowLeftRight, Timer, Users, Plus, Loader2, Save, Trash2, Activity, Camera, BellRing, BellOff, Fence, ShieldAlert, Clock, Footprints, PackageMinus,
    PersonStanding, Car, Bike, Dog, Backpack, Boxes, Gauge, ListOrdered, Luggage, Ambulance, HardHat, ArrowUpToLine,
    TriangleAlert, ScanEye, ChevronDown, Check, Layers, Maximize2, Copy, PanelRight, X, type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
    TIPOS_REGLA, CLASES_OBJETO, CON_HORARIO, TIPOS_EVENTO, duracionCorta, FILA, TIPOS_RETIRADOS,
    type ReglaVision, type TipoRegla, type Punto,
} from "@/lib/vision-reglas";
import { listaPropias, useNombresPropios } from "@/lib/nombres-propios";
import { ElegirClases, nombreClase } from "@/components/vision/ElegirClases";
import { CLASES as CLASES_CATALOGO, CLASE_POR_NOMBRE } from "@/lib/vision-catalogo";

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
    /** `analiza`: si está en OmniVision. Una regla en una cámara afuera se guarda y NO corre. */
    reglas: ReglaVision[]; camaras: { id: string; name: string; analiza: boolean }[];
    analiticas: Record<TipoRegla, boolean>; rotulado: boolean;
    estado: null | { t: string; reglas: null | { cruces: number; sentido: number; permanencia: number; aglomeracion: number; avisos: number; errores: number; ultimoError: string | null } };
    resumen: Record<string, Resumen>; eventos: Evento[];
    /** Objetos vistos por cámara y clase en los últimos `vistosDias`: para proponer cámaras. */
    vistos?: { deviceId: string; clase: string; n: number }[]; vistosDias?: number;
};
/**
 * Lo que se está editando: una regla sola o un grupo (la misma vigilancia en varias cámaras).
 * `originales` son las reglas guardadas que se reemplazan al guardar (ninguna si es nueva);
 * `foco`, la cámara que se muestra primero.
 */
type Edicion = { base: ReglaVision; deviceIds: string[]; originales: ReglaVision[]; nueva: boolean; foco?: string };
type Geo = { linea: { a: Punto; b: Punto } | null; zona: Punto[] };
/** «Todo el cuadro» como zona: un margen mínimo para que el polígono se vea y se pueda tomar del borde. */
const TODO_EL_CUADRO: Punto[] = [[0.005, 0.005], [0.995, 0.005], [0.995, 0.995], [0.005, 0.995]];
/** Cuántos vistos por cámara de las clases elegidas, para el asistente y el selector de cámaras. */
function vistosPorCamara(vistos: Respuesta["vistos"], clases: string[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const v of vistos || []) if (clases.includes(v.clase)) m.set(v.deviceId, (m.get(v.deviceId) || 0) + v.n);
    return m;
}

const ICONO: Record<TipoRegla, LucideIcon> = { conteo: Spline, sentido: ArrowLeftRight, permanencia: Timer, aglomeracion: Users, fila: ListOrdered, cruce: Fence, intrusion: ShieldAlert, merodeo: Footprints, retirado: PackageMinus, animal: Dog, dejado: Luggage, suelo: Ambulance, trepar: ArrowUpToLine, epp: HardHat };
/** Lo que se cuenta hoy en la tarjeta de cada tipo que no es conteo. */
const CUENTA_HOY: Partial<Record<TipoRegla, string>> = { fila: "en la fila ahora", sentido: "en contra hoy", permanencia: "se quedaron hoy", aglomeracion: "aglomeraciones hoy", cruce: "cruces hoy", intrusion: "intrusiones hoy", merodeo: "merodeos hoy", retirado: "retirados hoy", animal: "animales hoy", dejado: "dejados hoy", suelo: "en el suelo hoy", trepar: "trepadas hoy", epp: "sin casco o chaleco hoy" };
/**
 * Cómo aparece el nombre de la regla en el aviso, por tipo (los textos los arma vision-reglas.js).
 * Antes la ayuda daba el ejemplo de sentido contrario para cualquier tipo, y en una regla de
 * objeto retirado decía «Salida por la entrada»: no sirve para elegir un nombre.
 * El conteo no avisa, así que su nombre sólo se ve en la tarjeta.
 */
const EJEMPLO_AVISO: Record<TipoRegla, (n: string) => string> = {
    conteo: (n) => `La tarjeta se llama «${n}»`, sentido: (n) => `«Auto en sentido contrario · ${n}»`,
    permanencia: (n) => `«Persona hace 5 min en ${n}»`, aglomeracion: (n) => `«6 personas juntas en ${n}»`,
    fila: (n) => `«${n}: 12 personas en la fila (límite 10)»`,
    cruce: (n) => `«Persona cruzó ${n}»`, intrusion: (n) => `«Persona en ${n}»`,
    merodeo: (n) => `«Persona dando vueltas hace 2 min en ${n}»`, retirado: (n) => `«Se llevaron una bicicleta de ${n}»`,
    animal: (n) => `«Perro suelto en ${n}»`, dejado: (n) => `«Mochila sin dueño hace 2 min en ${n}»`,
    suelo: (n) => `«Persona en el suelo hace 20 s en ${n}»`, trepar: (n) => `«Persona trepando en ${n}»`, epp: (n) => `«Persona sin casco en ${n}»`,
};
/** El horario que se propone al armar de noche: lo más común en un barrio. */
const HORARIO_NOCHE = { desde: "22:00", hasta: "06:00" };
/** El horario de atención que se propone a una fila. */
const HORARIO_ATENCION = { desde: "08:00", hasta: "20:00" };
const REFRESCO_MS = 15_000;
const CLAVE_PANEL = "reglas-vision:panel-eventos";
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
        ...(tipo === "animal" ? { sinPersona: true } : {}),
    };
}

export default function ReglasVision() {
    useNombresPropios();  // para ofrecer y nombrar las clases del detector propio
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editando, setEditando] = useState<Edicion | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [ampliado, setAmpliado] = useState<Evento | null>(null);
    const [eligiendo, setEligiendo] = useState(false);
    // El panel de eventos: abierto por defecto, y se recuerda en este navegador.
    const [panel, setPanel] = useState(true);
    useEffect(() => { try { const v = localStorage.getItem(CLAVE_PANEL); if (v != null) setPanel(v === "1"); } catch { } }, []);
    const cambiarPanel = (v: boolean) => { setPanel(v); try { localStorage.setItem(CLAVE_PANEL, v ? "1" : "0"); } catch { } };

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
        if (aEditar) { window.history.replaceState(null, "", window.location.pathname); abrir(aEditar); return; }
        const tipo = sp.get("nueva") as TipoRegla | null;
        if (!tipo || !(tipo in TIPOS_REGLA)) return;
        window.history.replaceState(null, "", window.location.pathname);
        const cam = datos.camaras[0]?.id || "";
        setEditando({ base: reglaNueva(tipo, cam), deviceIds: cam ? [cam] : [], originales: [], nueva: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [datos]);

    /** Abrir una regla guardada: si es de un grupo, se abre el grupo entero parado en su cámara. */
    const abrir = (r: ReglaVision) => {
        const hermanas = r.grupo ? (datos?.reglas || []).filter((x) => x.grupo?.id === r.grupo!.id) : [r];
        setEditando({ base: r, deviceIds: hermanas.map((x) => x.deviceId), originales: hermanas, nueva: false, foco: r.deviceId });
    };
    /** Reemplaza `fuera` por `nuevas` en la lista, en el lugar de la primera (el orden de las tarjetas no salta). */
    const reemplazar = (lista: ReglaVision[], fuera: Set<string>, nuevas: ReglaVision[]) => {
        const i = lista.findIndex((x) => fuera.has(x.id));
        const resto = lista.filter((x) => !fuera.has(x.id));
        if (i < 0) return [...resto, ...nuevas];
        const antes = lista.slice(0, i).filter((x) => !fuera.has(x.id)).length;
        return [...resto.slice(0, antes), ...nuevas, ...resto.slice(antes)];
    };

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
    const analizaCamara = useMemo(() => new Map((datos?.camaras || []).map((c) => [c.id, c.analiza])), [datos?.camaras]);
    const [agregando, setAgregando] = useState<string | null>(null);
    const agregarAVision = async (id: string) => {
        setAgregando(id);
        try {
            const r = await fetch(`/api/vision/camaras/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ analiza: true, nombre: nombreCamara.get(id) || null }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) toast.error({ title: "No se pudo agregar", description: j.error || `El servidor respondió ${r.status}` });
            else { toast.success({ title: "Entra a OmniVision", description: "Sus reglas empiezan a correr en la próxima vuelta del motor (menos de 30 s)." }); cargar(); }
        } finally { setAgregando(null); }
    };

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las reglas…" /></div>;

    const est = datos.estado;
    const sinSenal = !est || Date.now() - new Date(est.t).getTime() > 60_000;

    // Los grupos van primero, cada uno en su sección; el resto de las reglas, por cámara como antes.
    const grupos = [...new Map(datos.reglas.filter((r) => r.grupo).map((r) => [r.grupo!.id, r.grupo!])).values()];
    const camarasSueltas = [...new Set(datos.reglas.filter((r) => !r.grupo).map((r) => r.deviceId))];

    return (
        // Con el panel de eventos abierto, la página le deja su lugar a la derecha: queda acoplado,
        // no tapa las reglas (16/10, Nico: «Eventos debe ser un slide acoplable a la derecha»).
        <div className={cn("transition-[padding] duration-300", panel && "lg:pr-[380px]")}>
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
                {datos.reglas.length > 0 && (
                    <Button variant="outline" onClick={() => cambiarPanel(!panel)} aria-pressed={panel}>
                        <PanelRight size={14} /> Eventos <span className="tabular-nums text-muted-foreground">{datos.eventos.length}</span>
                    </Button>
                )}
                <Button onClick={() => setEligiendo(true)}><Plus size={14} /> Nueva regla</Button>
            </div>

            {/* Sin reglas: lo que se puede vigilar y un botón. El asistente (cajón) pregunta el resto. */}
            {datos.reglas.length === 0 && (
                <section className="rounded-[10px] border border-dashed border-border p-6 flex flex-col items-center text-center gap-3">
                    <div className="flex items-center gap-2 text-muted-foreground">{(Object.keys(TIPOS_REGLA) as TipoRegla[]).slice(0, 6).map((t) => { const Ic = ICONO[t]; return <Ic key={t} size={18} />; })}</div>
                    <div>
                        <div className="text-[14px] font-bold">Todavía no hay reglas</div>
                        <p className="text-[12.5px] text-muted-foreground max-w-lg">Una persona en el jardín de noche, un auto en contramano, alguien dando vueltas, un contenedor que se mueve: elegí qué y qué pasa, y la regla sale sola.</p>
                    </div>
                    <Button onClick={() => setEligiendo(true)}><Plus size={14} /> Crear la primera regla</Button>
                </section>
            )}

            {/* ── Los grupos: la misma vigilancia en varias cámaras ── */}
            {grupos.map((g) => {
                const deGrupo = datos.reglas.filter((r) => r.grupo?.id === g.id);
                const prendidas = deGrupo.filter((r) => r.activa).length;
                const afuera = deGrupo.filter((r) => nombreCamara.has(r.deviceId) && !analizaCamara.get(r.deviceId)).length;
                const Ic = ICONO[deGrupo[0].tipo];
                return (
                    <section key={g.id} className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Layers size={14} className="text-muted-foreground" />
                            <h2 className="text-[13px] font-bold">{g.nombre}</h2>
                            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Ic size={12} /> {TIPOS_REGLA[deGrupo[0].tipo].nombre} · <span className="tabular-nums">{deGrupo.length} cámaras</span></span>
                            {afuera > 0 && <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full chip-aviso text-[11.5px] font-semibold"><TriangleAlert size={12} /> {afuera} fuera de OmniVision: ahí no corre</span>}
                            <span className="ml-auto flex items-center gap-2">
                                <Pista titulo={prendidas === deGrupo.length ? "Prendidas todas" : prendidas ? `${prendidas} de ${deGrupo.length} prendidas` : "Apagadas todas"} texto="Prende o apaga la regla en todas las cámaras del grupo. Cada una se puede apagar sola desde su tarjeta.">
                                    <span><Switch checked={prendidas === deGrupo.length} onCheckedChange={(v) => guardarLista(datos.reglas.map((x) => (x.grupo?.id === g.id ? { ...x, activa: v } : x)), v ? `${g.nombre}: prendida en ${deGrupo.length} cámaras` : `${g.nombre}: apagada en ${deGrupo.length} cámaras`)} aria-label="Prender o apagar el grupo" /></span>
                                </Pista>
                                <Button variant="outline" size="sm" onClick={() => abrir(deGrupo[0])}>Editar el grupo</Button>
                            </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
                            {deGrupo.map((r) => (
                                <TarjetaRegla key={r.id} r={r} enGrupo camara={nombreCamara.get(r.deviceId) || "Cámara borrada"} s={datos.resumen[r.id]} apagadaLab={!datos.analiticas[r.tipo]}
                                    alAbrir={() => abrir(r)}
                                    alActivar={(v) => guardarLista(datos.reglas.map((x) => (x.id === r.id ? { ...x, activa: v } : x)), v ? "Regla prendida" : "Regla apagada")} />
                            ))}
                        </div>
                    </section>
                );
            })}

            {/* ── Las reglas sueltas, por cámara, sobre su cuadro ── */}
            {camarasSueltas.map((cam) => {
                const deCam = datos.reglas.filter((r) => r.deviceId === cam && !r.grupo);
                return (
                    <section key={cam} className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Camera size={14} className="text-muted-foreground" />
                            <h2 className="text-[13px] font-bold">{nombreCamara.get(cam) || "Cámara borrada"}</h2>
                            <span className="text-[12px] text-muted-foreground tabular-nums">{deCam.length} regla{deCam.length === 1 ? "" : "s"}</span>
                            {/* Desde el 15/10 la lista de OmniVision decide todo: afuera, la regla no corre. */}
                            {nombreCamara.has(cam) && !analizaCamara.get(cam) && (<>
                                <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full chip-aviso text-[11.5px] font-semibold"><TriangleAlert size={12} /> OmniVision no analiza esta cámara: sus reglas no corren</span>
                                <button type="button" onClick={() => agregarAVision(cam)} disabled={agregando === cam}
                                    className="h-7 px-2.5 rounded-full bg-[var(--accion)] text-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-60">
                                    {agregando === cam ? <Loader2 size={12} className="animate-spin" /> : <ScanEye size={12} />} Agregar a OmniVision
                                </button>
                            </>)}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
                            {deCam.map((r) => (
                                <TarjetaRegla key={r.id} r={r} camara={nombreCamara.get(r.deviceId) || "Cámara borrada"} s={datos.resumen[r.id]} apagadaLab={!datos.analiticas[r.tipo]}
                                    alAbrir={() => abrir(r)}
                                    alActivar={(v) => guardarLista(datos.reglas.map((x) => (x.id === r.id ? { ...x, activa: v } : x)), v ? "Regla prendida" : "Regla apagada")} />
                            ))}
                        </div>
                    </section>
                );
            })}

            <AsistenteRegla abierto={eligiendo} camaras={datos.camaras} analiticas={datos.analiticas} vistos={datos.vistos} vistosDias={datos.vistosDias || 7} alCerrar={() => setEligiendo(false)}
                alListo={(r, ids) => { setEligiendo(false); setEditando({ base: r, deviceIds: ids, originales: [], nueva: true }); }} />
            {editando && (
                <CajonRegla key={`${editando.base.id}-${editando.originales.length}`} edicion={editando} camaras={datos.camaras} vistos={datos.vistos} guardando={guardando}
                    alCerrar={() => setEditando(null)}
                    alGuardar={async (nuevas) => {
                        const n = nuevas.length;
                        const texto = editando.nueva ? (n > 1 ? `Regla creada en ${n} cámaras` : "Regla creada") : n > 1 ? `Guardada en ${n} cámaras` : "Regla guardada";
                        if (await guardarLista(reemplazar(datos.reglas, new Set(editando.originales.map((x) => x.id)), nuevas), texto)) setEditando(null);
                    }}
                    alBorrar={async () => {
                        const fuera = new Set(editando.originales.map((x) => x.id));
                        if (await guardarLista(datos.reglas.filter((x) => !fuera.has(x.id)), fuera.size > 1 ? `Borrada en ${fuera.size} cámaras` : "Regla borrada")) setEditando(null);
                    }} />
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
            <PanelEventos abierto={panel} eventos={datos.eventos} alCerrar={() => cambiarPanel(false)} alAbrir={setAmpliado} />
        </div>
    );
}

/**
 * Lo que pasó, en un panel acoplado a la derecha (16/10, Nico). Antes era una grilla de fotos al
 * pie de la página: con varias reglas quedaba debajo de todo, y para ver si una regla disparó
 * había que bajar hasta el final y volver. Acoplado, se ve al lado de las reglas que lo
 * producen y se pliega cuando no hace falta. Se recuerda abierto o cerrado en este navegador.
 */
function PanelEventos({ abierto, eventos, alCerrar, alAbrir }: { abierto: boolean; eventos: Evento[]; alCerrar: () => void; alAbrir: (e: Evento) => void }) {
    const [tipo, setTipo] = useState<string | null>(null);
    const tipos = [...new Set(eventos.map((e) => e.tipo))];
    const visibles = tipo ? eventos.filter((e) => e.tipo === tipo) : eventos;
    return (
        <aside aria-hidden={!abierto}
            className={cn("fixed right-0 top-0 z-30 h-dvh w-full sm:w-[380px] bg-card border-l border-border flex flex-col transition-transform duration-300",
                abierto ? "translate-x-0" : "translate-x-full pointer-events-none", "max-lg:shadow-2xl")}>
            <div className="flex items-center gap-2 px-4 h-14 border-b border-border shrink-0">
                <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold leading-tight">Eventos</div>
                    <div className="text-[11px] text-muted-foreground">Últimos 7 días · {eventos.length}</div>
                </div>
                <button type="button" onClick={alCerrar} aria-label="Cerrar el panel" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><X size={16} /></button>
            </div>
            {tipos.length > 1 && (
                <div className="flex items-center gap-4 px-4 border-b border-border overflow-x-auto shrink-0 text-[12px]">
                    {[null, ...tipos].map((t) => {
                        const on = tipo === t;
                        const n = t ? eventos.filter((e) => e.tipo === t).length : eventos.length;
                        return (
                            <button key={t || "todos"} type="button" onClick={() => setTipo(t)} aria-pressed={on}
                                className={cn("relative h-10 whitespace-nowrap font-semibold transition-colors", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                {t ? (TIPOS_EVENTO[t] || { nombre: t }).nombre : "Todos"} <span className="tabular-nums opacity-60">{n}</span>
                                {on && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--accion)]" />}
                            </button>
                        );
                    })}
                </div>
            )}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                {visibles.length === 0 ? (
                    <div className="h-full grid place-items-center px-6 text-center text-[12.5px] text-muted-foreground">Sin eventos todavía. Cuando una regla vea algo, queda acá con su foto.</div>
                ) : visibles.map((e) => {
                    const t = TIPOS_EVENTO[e.tipo] || { nombre: e.tipo, tono: "quieto" as const };
                    return (
                        <button key={e.id} type="button" onClick={() => alAbrir(e)} className="w-full flex items-center gap-3 rounded-[8px] p-1.5 text-left hover:bg-accent transition-colors">
                            <span className="relative block w-[112px] aspect-video shrink-0 rounded-[6px] overflow-hidden bg-black">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {e.foto ? <img src={`${e.foto}?w=320`} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Camera size={16} className="absolute inset-0 m-auto text-white/30" />}
                                {e.caja && <span className="absolute border-[1.5px] border-[var(--accion-en-oscuro)] rounded-[2px]" style={{ left: `${e.caja[0] * 100}%`, top: `${e.caja[1] * 100}%`, width: `${(e.caja[2] - e.caja[0]) * 100}%`, height: `${(e.caja[3] - e.caja[1]) * 100}%` }} />}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.tono === "mal" ? "bg-[var(--mal)]" : t.tono === "aviso" ? "bg-[var(--aviso)]" : t.tono === "info" ? "bg-[var(--info)]" : "bg-muted-foreground/50")} />
                                    <span className="text-[11.5px] font-semibold">{t.nombre}</span>
                                    {e.avisoId && <BellRing size={11} className="text-muted-foreground" aria-label="Avisó a la guardia" />}
                                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{hora(e.ts)}</span>
                                </span>
                                <span className="block text-[12px] truncate mt-0.5">{e.regla}</span>
                                <span className="block text-[11px] text-muted-foreground truncate tabular-nums">
                                    {e.tipo === "PERMANENCIA" ? `${nombreClase(e.clase || "")} · ${duracionCorta(e.valor)}` : e.tipo === "AGLOMERACION" ? `${e.valor} personas` : e.clase ? nombreClase(e.clase) : ""} · {dia(e.ts)}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground shrink-0">Los cruces del conteo no se listan: se suman en cada regla.</div>
        </aside>
    );
}

/** La foto de la cámara de una regla: un canal de NVR (nvrch-<nvr>-<ch>) no tiene /api/snapshot. */
const CANAL = /^nvrch-([\w-]+)-(\d{1,4})$/;
function fotoCamara(id: string, w: number) {
    const m = CANAL.exec(id);
    return m ? `/api/monitor/camaras/foto?nvr=${encodeURIComponent(m[1])}&ch=${m[2]}&w=${w}` : `/api/snapshot/${id}?w=${w}`;
}

/**
 * Una regla, en un bloque chico (16/10, Nico: «cada regla su bloque más chico»): el cuadro con lo
 * dibujado —se reconoce sin leer—, el nombre, el número de hoy y el interruptor. Lo demás está en
 * el cajón.
 */
function TarjetaRegla({ r, camara, s, apagadaLab, alAbrir, alActivar, enGrupo }: { r: ReglaVision; camara: string; s?: Resumen; apagadaLab: boolean; alAbrir: () => void; alActivar: (v: boolean) => void; enGrupo?: boolean }) {
    const Ic = ICONO[r.tipo];
    const max = Math.max(1, ...(s?.porHora || [0]));
    const retirada = TIPOS_RETIRADOS.includes(r.tipo);
    return (
        <div className={cn("rounded-[10px] border border-border bg-card overflow-hidden flex flex-col", (!r.activa || apagadaLab || retirada) && "opacity-60")}>
            <button type="button" onClick={alAbrir} className="relative aspect-video bg-black overflow-hidden" aria-label={`Editar ${r.nombre}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fotoCamara(r.deviceId, 320)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-80" />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                    {r.zona && r.zona.length >= 3 && <polygon points={r.zona.map(([x, y]) => `${x},${y}`).join(" ")} fill="var(--accion-en-oscuro)" fillOpacity={0.22} stroke="var(--accion-en-oscuro)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                    {r.linea && <line x1={r.linea.a[0]} y1={r.linea.a[1]} x2={r.linea.b[0]} y2={r.linea.b[1]} stroke="var(--accion-en-oscuro)" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
                </svg>
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/65 text-white text-[10.5px] font-semibold"><Ic size={11} /> {TIPOS_REGLA[r.tipo].nombre}</span>
                {retirada && <span className="absolute right-1.5 top-1.5 h-6 px-2 rounded-full bg-black/65 text-white text-[10.5px] font-semibold inline-flex items-center" title="Esta analítica se retiró: la regla queda guardada pero no corre.">Retirada · no corre</span>}
                {!r.linea && !(r.zona && r.zona.length >= 3) && <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded-[5px] bg-black/65 text-white text-[10px]">Todo el cuadro</span>}
            </button>
            <div className="p-2.5 flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                    <button type="button" onClick={alAbrir} className="min-w-0 flex-1 text-left">
                        {/* En un grupo el nombre ya está en el título de la sección: la tarjeta es la cámara. */}
                        <div className="text-[12.5px] font-semibold truncate leading-tight">{enGrupo ? camara : r.nombre}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{enGrupo ? TIPOS_REGLA[r.tipo].nombre : camara}</div>
                    </button>
                    <Pista titulo={r.activa ? "Prendida" : "Apagada"} texto={apagadaLab ? "Su analítica está apagada en Analíticas: aunque la regla esté prendida, no corre." : "Apagada no se aplica, pero se guarda lo dibujado."}>
                        <span><Switch checked={r.activa} onCheckedChange={alActivar} aria-label="Prender o apagar la regla" /></span>
                    </Pista>
                </div>
                {r.tipo === "conteo" ? (
                    <div className="flex items-end gap-3">
                        <span className="tabular-nums leading-none"><b className="text-[17px]">{s?.ab ?? 0}</b><span className="text-[10.5px] text-muted-foreground"> A→B</span></span>
                        <span className="tabular-nums leading-none"><b className="text-[17px]">{s?.ba ?? 0}</b><span className="text-[10.5px] text-muted-foreground"> B→A</span></span>
                        <span className="flex-1 flex items-end gap-px h-5" aria-label="Cruces por hora de hoy">
                            {(s?.porHora || Array(24).fill(0)).map((n, h) => (
                                <span key={h} title={`${String(h).padStart(2, "0")} h: ${n} cruces`} className="flex-1 rounded-t-[1px] bg-[var(--accion)]" style={{ height: `${Math.max(n ? 10 : 4, (n / max) * 100)}%`, opacity: n ? 0.85 : 0.18 }} />
                            ))}
                        </span>
                    </div>
                ) : (
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <b className="text-[17px] tabular-nums leading-none">{s?.hoy ?? 0}</b>
                        <span className="text-[10.5px] text-muted-foreground">{CUENTA_HOY[r.tipo]}</span>
                        {s?.max != null && (r.tipo === "permanencia" || r.tipo === "aglomeracion" || r.tipo === "fila") && <span className="text-[10.5px] text-muted-foreground">· máx. {r.tipo === "permanencia" ? duracionCorta(s.max) : s.max}{r.tipo === "fila" ? " hoy" : ""}</span>}
                    </div>
                )}
                <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground min-w-0">
                    {r.avisar ? <BellRing size={11} className="shrink-0" /> : <BellOff size={11} className="shrink-0" />}
                    {r.tipo === "fila" && <span className="shrink-0">límite {r.maximo ?? 10}</span>}
                    {CON_HORARIO.includes(r.tipo) && <span className="shrink-0 inline-flex items-center gap-0.5"><Clock size={10} /> {r.horario ? `${r.horario.desde}–${r.horario.hasta}` : "siempre"}</span>}
                    <span className="truncate">· {r.clases.map(nombreClase).join(", ")}</span>
                </div>
            </div>
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
                : tipo === "fila" ? [18, 26, 34, 42].map((x, i) => <circle key={i} cx={x} cy={30 - i * 3} r="2.4" fill="currentColor" />)
                : tipo === "merodeo" ? <path d="M20 30 q8 -14 16 -2 t12 -6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 3" />
                : tipo === "retirado" ? <rect x="26" y="20" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 2" />
                : tipo === "suelo" ? <><line x1="22" y1="30" x2="42" y2="30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="46" cy="29" r="2.6" fill="currentColor" /></>
                : tipo === "trepar" ? <><line x1="32" y1="34" x2="32" y2="22" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><path d="M26 17 l6 5 l6 -5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="32" cy="19" r="2.2" fill="currentColor" /></>
                : tipo === "epp" ? <path d="M24 28 a8 8 0 0 1 16 0 z M22 28 h20" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                : tipo === "dejado" ? <><rect x="26" y="20" width="12" height="10" rx="1.5" fill="currentColor" /><circle cx="44" cy="16" r="2" fill="currentColor" fillOpacity="0.45" /></>
                : tipo === "animal" ? <><ellipse cx="32" cy="28" rx="5" ry="4" fill="currentColor" />{[[25, 21], [30, 18], [35, 18], [40, 21]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.8" fill="currentColor" />)}</>
                : tipo === "permanencia" ? <><circle cx="32" cy="25" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M32 21 v4 l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" /></>
                : <circle cx={linea ? 40 : 32} cy={linea ? 30 : 25} r="3" fill="currentColor" />}
        </svg>
    );
}

/**
 * Configuraciones de uso común, listas para usar (16/10, Nico: «precargar algunas config de
 * analíticas estándar con información clara de qué hace, ejemplos simples activables»). Elegir
 * una pone el tipo, lo que cuenta, los tiempos, el horario y el aviso; la cámara y lo dibujado se
 * conservan si el tipo nuevo usa la misma forma (línea o zona).
 */
type Plantilla = { id: string; nombre: string; tipo: TipoRegla; que: string; ejemplo: string; aplicar: Partial<ReglaVision> };
const PLANTILLAS: Plantilla[] = [
    { id: "intrusion-noche", nombre: "Intrusión de noche", tipo: "intrusion", que: "Avisa si una persona entra a la zona entre las 22 y las 6 y se queda 2 s.", ejemplo: "El fondo de un lote, el jardín de la garita.", aplicar: { clases: ["person"], segundos: 2, horario: HORARIO_NOCHE, avisar: true } },
    { id: "cerco", nombre: "Cruce del cerco", tipo: "cruce", que: "Avisa cuando una persona cruza la línea del perímetro, en cualquier sentido, de noche.", ejemplo: "La línea sobre el alambrado de una perimetral.", aplicar: { clases: ["person"], sentidos: "ambos", horario: HORARIO_NOCHE, avisar: true } },
    { id: "merodeo", nombre: "Alguien dando vueltas", tipo: "merodeo", que: "Avisa si una persona anda caminando por la zona más de 90 s.", ejemplo: "Alguien que recorre la vereda mirando las casas.", aplicar: { clases: ["person"], segundos: 90, avisar: true } },
    { id: "contramano", nombre: "Auto en contramano", tipo: "sentido", que: "Avisa cuando un vehículo cruza la línea en el sentido prohibido.", ejemplo: "La salida de la garita usada como entrada.", aplicar: { clases: ["car", "truck", "bus", "motorcycle"], permitido: "ab", avisar: true } },
    { id: "detenido", nombre: "Vehículo detenido mucho rato", tipo: "permanencia", que: "Avisa si un auto o una camioneta se queda más de 15 min en la zona.", ejemplo: "Un auto parado frente a la garita o en la banquina.", aplicar: { clases: ["car", "truck"], segundos: 900, avisar: true } },
    { id: "aforo", nombre: "Contar los que pasan", tipo: "conteo", que: "Cuenta los vehículos que cruzan la línea, por sentido, clase y hora. No avisa.", ejemplo: "Cuántos autos entran por la calle principal cada hora.", aplicar: { clases: ["car", "truck", "bus", "motorcycle"], avisar: false } },
    { id: "grupo", nombre: "Grupo de personas", tipo: "aglomeracion", que: "Avisa si hay 6 personas o más juntas durante 1 min.", ejemplo: "Una reunión en la plaza o frente a la garita de noche.", aplicar: { clases: ["person"], maximo: 6, segundos: 60, avisar: true } },
    { id: "fila-caja", nombre: "Fila de una caja", tipo: "fila", que: "Cuenta las personas en la fila, las que entran y las que salen, y avisa a la guardia al llegar a 10 (al supervisor si sigue llena 5 min).", ejemplo: "La fila de la caja o del mostrador de la garita.", aplicar: { clases: ["person"], maximo: 10, rebote: 2, escalarMin: 5, enfrioMin: 5, avisar: true } },
    { id: "perro-suelto", nombre: "Perro suelto", tipo: "animal", que: "Avisa si un perro, gato o caballo anda 3 s en la zona sin ninguna persona.", ejemplo: "La plaza, la piscina, la calle de entrada.", aplicar: { clases: ["dog", "cat", "horse"], segundos: 3, sinPersona: true, avisar: true } },
    { id: "bulto", nombre: "Bulto abandonado", tipo: "dejado", que: "Avisa si aparece un bolso, una mochila o una valija y queda 2 min sin nadie al lado.", ejemplo: "La garita, la parada del ómnibus, el hall.", aplicar: { clases: ["backpack", "handbag", "suitcase"], segundos: 120, avisar: true } },
    { id: "caida", nombre: "Persona caída", tipo: "suelo", que: "Avisa si una persona queda acostada 20 s en la zona.", ejemplo: "La calle de entrada, la plaza, el hall.", aplicar: { clases: ["person"], segundos: 20, avisar: true } },
    { id: "trepa-cerco", nombre: "Trepando el cerco", tipo: "trepar", que: "Avisa si alguien junto al cerco tiene las manos arriba 2 s seguidos, de noche.", ejemplo: "La zona dibujada sobre el muro o el alambrado de una perimetral.", aplicar: { clases: ["person"], segundos: 2, horario: HORARIO_NOCHE, avisar: true } },
    { id: "obra", nombre: "Obra: casco y chaleco", tipo: "epp", que: "Avisa si alguien anda 10 s en la obra sin casco o sin chaleco, en horario de trabajo.", ejemplo: "Una obra en un lote, el personal de mantenimiento.", aplicar: { clases: ["person"], segundos: 10, requiere: ["casco", "chaleco"], horario: { desde: "07:00", hasta: "18:00" }, avisar: true } },
    { id: "bicicletero", nombre: "Se llevan algo", tipo: "retirado", que: "Aprende lo que está quieto en la zona y avisa si desaparece más de 20 s.", ejemplo: "Una bici en el bicicletero, una moto estacionada.", aplicar: { clases: ["bicycle", "motorcycle"], segundos: 20, avisar: true } },
];

/** Qué forma se dibuja en cada tipo, en pocas palabras (para el desplegable). */
const FORMA: Record<TipoRegla, string> = {
    conteo: "Con una línea", sentido: "Con una línea", cruce: "Con una línea · avisa", permanencia: "Con una zona",
    aglomeracion: "Con una zona o todo el cuadro", fila: "Con una zona · aforo y límite", intrusion: "Con una zona · avisa", merodeo: "Zona o todo el cuadro · avisa", retirado: "Con una zona · avisa", animal: "Con una zona · avisa", dejado: "Con una zona · avisa", suelo: "Con una zona · avisa", trepar: "Zona sobre el cerco · avisa", epp: "Con una zona · avisa",
};

/**
 * Un desplegable con cara (16/10, Nico: «usar más dropdowns estilizados»): la opción elegida se ve
 * con su ícono o su foto y una línea que dice qué es; la lista, igual. Reemplaza a las grillas de
 * tarjetas que ocupaban medio cajón.
 */
type OpcionDesp = { valor: string; titulo: string; detalle?: string; extra?: string; icono?: React.ReactNode; aviso?: string };
function Desplegable({ valor, opciones, alElegir, vacio, ancho = 420 }: { valor: string | null; opciones: OpcionDesp[]; alElegir: (v: string) => void; vacio: string; ancho?: number }) {
    const [abierto, setAbierto] = useState(false);
    const sel = opciones.find((o) => o.valor === valor) || null;
    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" className="w-full min-h-11 rounded-[8px] border border-border bg-background px-2.5 py-1.5 flex items-center gap-2.5 text-left hover:bg-accent/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40">
                    {sel?.icono && <span className="shrink-0">{sel.icono}</span>}
                    <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] font-semibold truncate", !sel && "text-muted-foreground font-normal")}>{sel ? sel.titulo : vacio}</span>
                        {sel?.detalle && <span className="block text-[11px] text-muted-foreground truncate">{sel.aviso || sel.detalle}</span>}
                    </span>
                    <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="p-1 max-h-[min(420px,60vh)] overflow-y-auto" style={{ width: ancho }}>
                {opciones.map((o) => (
                    <button key={o.valor} type="button" onClick={() => { alElegir(o.valor); setAbierto(false); }}
                        className={cn("w-full flex items-start gap-2.5 rounded-[6px] px-2 py-2 text-left hover:bg-accent", o.valor === valor && "bg-accent/60")}>
                        {o.icono && <span className="shrink-0 mt-0.5">{o.icono}</span>}
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[13px] font-semibold">{o.titulo}{o.valor === valor && <Check size={13} className="text-[var(--accion)]" />}</span>
                            {o.detalle && <span className="block text-[11.5px] text-muted-foreground leading-snug">{o.detalle}</span>}
                            {o.extra && <span className="block text-[11px] text-muted-foreground/80 leading-snug mt-0.5 italic">{o.extra}</span>}
                            {o.aviso && <span className="block text-[11px] tono-aviso mt-0.5">{o.aviso}</span>}
                        </span>
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
}

/** Un número con su unidad, en una línea: los parámetros de la regla sin un bloque por campo. */
function CampoNumero({ rotulo, valor, alCambiar, min, max, unidad, ayuda }: { rotulo: string; valor: number; alCambiar: (n: number) => void; min: number; max: number; unidad: string; ayuda?: string }) {
    return (
        <label className="flex items-center gap-2 text-[12.5px]" title={ayuda}>
            <span className="text-muted-foreground">{rotulo}</span>
            <span className="inline-flex items-center h-9 rounded-[8px] border border-border bg-background pr-2.5 focus-within:ring-2 focus-within:ring-[var(--accion)]/40">
                <input type="number" min={min} max={max} value={valor} onChange={(e) => alCambiar(Number(e.target.value))}
                    className="w-16 h-full bg-transparent px-2.5 text-[13px] font-semibold tabular-nums outline-none" />
                <span className="text-[12px] text-muted-foreground">{unidad}</span>
            </span>
        </label>
    );
}

function Segmentos<T extends string>({ valor, opciones, alElegir }: { valor: T; opciones: [T, string][]; alElegir: (v: T) => void }) {
    return (
        <div className="flex items-center h-9 rounded-lg bg-muted/60 p-0.5 w-fit">
            {opciones.map(([v, rot]) => (
                <button key={v} type="button" onClick={() => alElegir(v)}
                    className={cn("h-8 px-3 rounded-md text-[12.5px] font-semibold whitespace-nowrap", valor === v ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>{rot}</button>
            ))}
        </div>
    );
}

/**
 * Elegir una o varias cámaras (16/10, Nico: «la regla me permite una sola cámara a la vez, y quiero
 * vigilar todos los contenedores»). Las que vieron lo que cuenta la regla en la última semana van
 * primero, con cuántas veces: es la pista de dónde está lo que se quiere vigilar.
 */
function ElegirCamaras({ elegidas, camaras, vistos, alAlternar }: { elegidas: string[]; camaras: { id: string; name: string; analiza: boolean }[]; vistos: Map<string, number>; alAlternar: (id: string) => void }) {
    const [abierto, setAbierto] = useState(false);
    const [buscar, setBuscar] = useState("");
    const q = buscar.trim().toLowerCase();
    const lista = camaras.filter((c) => !q || c.name.toLowerCase().includes(q))
        .sort((a, b) => (vistos.get(b.id) || 0) - (vistos.get(a.id) || 0) || Number(b.analiza) - Number(a.analiza) || a.name.localeCompare(b.name));
    const sel = camaras.filter((c) => elegidas.includes(c.id));
    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button type="button" className="w-full min-h-11 rounded-[8px] border border-border bg-background px-2.5 py-1.5 flex items-center gap-2.5 text-left hover:bg-accent/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40">
                    <span className="flex -space-x-3 shrink-0">
                        {sel.slice(0, 3).map((c) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={c.id} src={fotoCamara(c.id, 160)} alt="" loading="lazy" className="w-14 h-8 rounded-[4px] object-cover bg-black ring-2 ring-background" />
                        ))}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] font-semibold truncate", !sel.length && "text-muted-foreground font-normal")}>{sel.length === 0 ? "Elegí la cámara" : sel.length === 1 ? sel[0].name : `${sel.length} cámaras`}</span>
                        {sel.length > 0 && <span className="block text-[11px] text-muted-foreground truncate">{sel.length === 1 ? (sel[0].analiza ? "OmniVision la mira" : "Fuera de OmniVision: la regla se guarda pero no corre") : sel.map((c) => c.name).join(", ")}</span>}
                    </span>
                    <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="p-1 w-[400px]">
                <div className="p-1"><Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cámara" className="h-9" /></div>
                <div className="max-h-[min(380px,55vh)] overflow-y-auto">
                    {lista.map((c) => {
                        const on = elegidas.includes(c.id);
                        const n = vistos.get(c.id) || 0;
                        return (
                            <button key={c.id} type="button" onClick={() => alAlternar(c.id)} aria-pressed={on} disabled={on && elegidas.length === 1}
                                title={on && elegidas.length === 1 ? "Tiene que quedar al menos una cámara" : undefined}
                                className={cn("w-full flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left hover:bg-accent", on && "bg-accent/60")}>
                                <span className={cn("grid h-4 w-4 place-items-center rounded-[4px] border shrink-0", on ? "bg-[var(--accion)] border-[var(--accion)] text-white" : "border-border")}>{on && <Check size={11} />}</span>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={fotoCamara(c.id, 160)} alt="" loading="lazy" className="w-14 h-8 rounded-[4px] object-cover bg-black shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[12.5px] font-semibold truncate">{c.name}</span>
                                    <span className={cn("block text-[11px] truncate", c.analiza ? "text-muted-foreground" : "tono-aviso")}>{c.analiza ? "OmniVision la mira" : "Fuera de OmniVision: no correría"}</span>
                                </span>
                                {n > 0 && <span className="shrink-0 text-[11px] font-semibold tabular-nums chip-info px-1.5 h-5 inline-flex items-center rounded-full" title="Veces que OmniVision vio lo que cuenta esta regla en la última semana">{n} vistos</span>}
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}

/**
 * Quién hace qué (16/10, Nico: «debe quedar claro qué cosas procesa la cámara y qué cosas
 * OmniVision»). Todas las reglas de esta pantalla las corre OmniVision sobre el video, en el
 * servidor; la cámara sólo lo manda. Las analíticas que trae la cámara (su cruce de línea, su
 * intrusión, su ANPR) son otra cosa: se configuran en el equipo y llegan por Dispositivos al
 * Monitor de intrusión. Sin esto, «Cruza una línea» se confundía con el cruce de línea de la
 * Hikvision.
 */
function QuienLoHace({ compacto }: { compacto?: boolean }) {
    if (compacto) return (
        <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground leading-snug">
            <ScanEye size={13} className="shrink-0 mt-px text-[var(--accion)]" />
            <span><b className="text-foreground font-semibold">La procesa OmniVision</b> en el servidor, sobre el video. La cámara sólo manda la imagen: no hay que configurar nada en el equipo, y anda en cualquier marca.</span>
        </p>
    );
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 rounded-[10px] border border-border divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[color-mix(in_oklab,var(--accion)_12%,transparent)] text-[var(--accion)] shrink-0"><ScanEye size={16} /></span>
                <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">OmniVision — estas reglas</span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">Reconoce qué es (personas, vehículos, lo entrenado acá), lo sigue y aplica la regla. Corre en el servidor, en cualquier cámara.</span>
                </span>
            </div>
            <div className="flex items-start gap-2.5 px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-muted text-muted-foreground shrink-0"><Camera size={16} /></span>
                <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">La cámara — sólo el video</span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">Sus analíticas propias (cruce de línea, intrusión, ANPR) no se arman acá: se configuran en el equipo y llegan por Dispositivos al Monitor de intrusión.</span>
                </span>
            </div>
        </div>
    );
}

/**
 * El cajón de una regla (16/10, Nico: «con menos scroll, dropdowns estilizados, plantillas con
 * ejemplos; la cámara arriba, sin marcos, acoplada; nombre y cámara los primeros campos»).
 *
 * Arriba, a todo el ancho, el cuadro de la cámara donde se dibuja: es lo que se está configurando.
 * Debajo: cámara y nombre; la analítica y la plantilla en dos desplegables; qué cuenta como
 * píldoras; y los tiempos, el horario y el aviso en renglones cortos. Antes eran ocho tarjetas de
 * tipo, una grilla de tarjetas por clase y una sección por parámetro: tres pantallas de scroll.
 */
function CajonRegla({ edicion, camaras, vistos, guardando, alCerrar, alGuardar, alBorrar }: {
    edicion: Edicion; camaras: { id: string; name: string; analiza: boolean }[]; vistos?: Respuesta["vistos"]; guardando: boolean;
    alCerrar: () => void; alGuardar: (reglas: ReglaVision[]) => void; alBorrar: () => void;
}) {
    const nueva = edicion.nueva;
    // En un grupo, el nombre que se edita es el del grupo; cada regla sale «<grupo> · <cámara>».
    const [r, setR] = useState<ReglaVision>(() => ({ ...edicion.base, nombre: edicion.base.grupo?.nombre ?? edicion.base.nombre }));
    const [ids, setIds] = useState<string[]>(edicion.deviceIds);
    const [geo, setGeo] = useState<Record<string, Geo>>(() => Object.fromEntries(edicion.deviceIds.map((id) => {
        const o = edicion.originales.find((x) => x.deviceId === id) || (id === edicion.base.deviceId ? edicion.base : null);
        return [id, { linea: o?.linea || null, zona: o?.zona || [] }];
    })));
    const [actual, setActual] = useState<string>(edicion.foco || edicion.deviceIds[0] || "");
    const [plantilla, setPlantilla] = useState<string | null>(null);
    const t = TIPOS_REGLA[r.tipo];
    const cambiar = (x: Partial<ReglaVision>) => setR((v) => ({ ...v, ...x }));
    const varias = ids.length > 1;
    const nombreDe = (id: string) => camaras.find((c) => c.id === id)?.name || "Cámara borrada";
    const nombreAuto = (n: string) => (varias ? n : `${n} · ${ids[0] ? nombreDe(ids[0]) : ""}`);
    /** El nombre se propone solo mientras no se escribió uno a mano. */
    const esNombreAuto = !r.nombre.trim() || r.nombre === nombreAuto(t.nombre) || PLANTILLAS.some((p) => r.nombre === nombreAuto(p.nombre));
    const sinDibujo = (): Record<string, Geo> => Object.fromEntries(ids.map((id) => [id, { linea: null, zona: [] }]));
    const conTipo = (tipo: TipoRegla, extra: Partial<ReglaVision> = {}, nombre?: string) => {
        const base = { ...r, ...reglaNueva(tipo, r.deviceId), id: r.id, nombre: r.nombre, activa: r.activa, grupo: r.grupo, ...extra };
        // Lo dibujado se conserva si el tipo nuevo usa la misma forma.
        if (TIPOS_REGLA[tipo].geometria !== t.geometria) setGeo(sinDibujo());
        if (esNombreAuto) base.nombre = nombre ? nombreAuto(nombre) : "";
        setR(base);
    };
    const usarPlantilla = (id: string) => { const p = PLANTILLAS.find((x) => x.id === id); if (!p) return; setPlantilla(id); conTipo(p.tipo, p.aplicar, p.nombre); };
    const dibujoListo = (g?: Geo) => (t.geometria === "linea" ? !!g?.linea : r.tipo === "aglomeracion" || r.tipo === "merodeo" || (g?.zona?.length || 0) >= 3);
    const faltan = ids.filter((id) => !dibujoListo(geo[id]));
    const listo = ids.length > 0 && !faltan.length && r.clases.length > 0;
    const g = geo[actual] || { linea: null, zona: [] };
    const ponerGeo = (id: string, x: Partial<Geo>) => setGeo((v) => ({ ...v, [id]: { ...(v[id] || { linea: null, zona: [] }), ...x } }));
    /** Sumar o sacar una cámara. Al pasar de una a varias, el nombre deja de llevar la cámara. */
    const alternarCamara = (id: string) => {
        if (ids.includes(id)) {
            if (ids.length === 1) return;
            const n = ids.filter((x) => x !== id);
            setIds(n); if (actual === id) setActual(n[0]);
            return;
        }
        if (ids.length === 1) { const suf = ` · ${nombreDe(ids[0])}`; if (r.nombre.endsWith(suf)) cambiar({ nombre: r.nombre.slice(0, -suf.length) }); }
        if (!ids.length && esNombreAuto) cambiar({ nombre: "" });
        setIds([...ids, id]);
        if (!geo[id]) ponerGeo(id, { linea: null, zona: [] });
        setActual(id);
    };
    /** Copiar el dibujo de la cámara a la vista a las que todavía no tienen. Sirve con cámaras gemelas. */
    const copiarALasQueFaltan = () => setGeo((v) => { const o = { ...v }; for (const id of faltan) o[id] = { linea: g.linea, zona: [...g.zona] }; return o; });
    const final = (): ReglaVision[] => {
        const base = r.nombre.trim() || nombreAuto(t.nombre);
        const grupoId = varias ? edicion.base.grupo?.id || nuevaId() : null;
        return ids.map((id, k) => {
            const o = edicion.originales.find((x) => x.deviceId === id);
            // Cada cámara conserva el id de su regla, así sus números de hoy y sus eventos siguen con ella.
            const rid = o?.id || (ids.length === 1 && edicion.originales.length === 1 ? edicion.originales[0].id : k === 0 && !edicion.originales.length ? r.id : nuevaId());
            const d = geo[id] || { linea: null, zona: [] };
            return {
                ...r, id: rid, deviceId: id, nombre: varias ? `${base} · ${nombreDe(id)}` : base,
                activa: o ? o.activa : r.activa,
                linea: t.geometria === "linea" ? d.linea : null, zona: t.geometria === "zona" && d.zona.length >= 3 ? d.zona : null,
                grupo: grupoId ? { id: grupoId, nombre: base } : null,
            };
        });
    };
    const falta = !ids.length ? "Elegí la cámara." : faltan.length ? (varias ? `Falta dibujar en ${faltan.length === 1 ? nombreDe(faltan[0]) : `${faltan.length} cámaras`}.` : t.geometria === "linea" ? "Dibujá la línea sobre el cuadro." : "Dibujá la zona sobre el cuadro (al menos 3 puntos).") : !r.clases.length ? "Prendé al menos una clase en «Qué cuenta»." : null;
    const zonaObligatoria = t.geometria === "zona" && r.tipo !== "aglomeracion" && r.tipo !== "merodeo";
    const nOriginales = edicion.originales.length;

    return (
        <Cajon open onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={nueva ? (varias ? `Nueva regla en ${ids.length} cámaras` : "Nueva regla") : (r.nombre || t.nombre)} descripcion={t.queHace}
                encabezado={actual ? (
                    <div>
                        <EditorGeometria key={actual} aSangre deviceId={actual} modo={t.geometria} linea={g.linea} zona={g.zona}
                            permitido={r.tipo === "sentido" ? r.permitido : undefined}
                            alCambiarLinea={(l) => ponerGeo(actual, { linea: l })} alCambiarZona={(z: Punto[]) => ponerGeo(actual, { zona: z })} />
                        {/* Varias cámaras: una tira para pasar de una a otra, con lo que falta dibujar a la vista. */}
                        {(varias || zonaObligatoria) && (
                            <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
                                {varias && (
                                    <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
                                        {ids.map((id) => {
                                            const ok = dibujoListo(geo[id]);
                                            return (
                                                <button key={id} type="button" onClick={() => setActual(id)} title={`${nombreDe(id)} · ${ok ? "dibujada" : "falta dibujar"}`}
                                                    className={cn("relative shrink-0 rounded-[6px] overflow-hidden border-2 transition-colors", id === actual ? "border-[var(--accion)]" : "border-transparent hover:border-border")}>
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={fotoCamara(id, 160)} alt="" loading="lazy" className="block w-[72px] h-[40px] object-cover bg-black" />
                                                    <span className={cn("absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full text-white", ok ? "bg-[var(--bien)]" : "bg-black/60")}>{ok ? <Check size={10} /> : <span className="h-1.5 w-1.5 rounded-full bg-white/80" />}</span>
                                                    <span className="absolute inset-x-0 bottom-0 px-1 bg-black/65 text-white text-[9.5px] truncate">{nombreDe(id)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <span className={cn("flex items-center gap-1.5 shrink-0", !varias && "ml-auto")}>
                                    {zonaObligatoria && (
                                        <Pista titulo="Todo el cuadro" texto="Usa el cuadro entero como zona en esta cámara. Para un objeto que se vigila (un contenedor, una moto) conviene la zona justa alrededor: lo que se mueve fuera no cuenta.">
                                            <button type="button" onClick={() => ponerGeo(actual, { zona: TODO_EL_CUADRO })} className="h-8 px-2.5 rounded-md border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent"><Maximize2 size={13} /> Todo el cuadro</button>
                                        </Pista>
                                    )}
                                    {varias && dibujoListo(g) && faltan.length > 0 && (
                                        <Pista titulo="Copiar el dibujo" texto={`Pone este mismo dibujo en las ${faltan.length} cámaras que no tienen. Sirve si miran parecido; después se ajusta cada una.`}>
                                            <button type="button" onClick={copiarALasQueFaltan} className="h-8 px-2.5 rounded-md border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent"><Copy size={13} /> A las {faltan.length} que faltan</button>
                                        </Pista>
                                    )}
                                </span>
                            </div>
                        )}
                    </div>
                ) : <div className="aspect-video bg-muted/40 grid place-items-center text-[12.5px] text-muted-foreground">Elegí la cámara para ver su cuadro y dibujar.</div>}
                pie={
                    <>
                        {!nueva && <Button variant="outline" className="mr-auto tono-mal" onClick={alBorrar} disabled={guardando}><Trash2 size={15} /> {nOriginales > 1 ? `Borrar en las ${nOriginales}` : "Borrar"}</Button>}
                        {falta && <span className="mr-auto text-[12px] text-muted-foreground">{falta}</span>}
                        <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                        <Button onClick={() => alGuardar(final())} disabled={!listo || guardando}>{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {nueva ? (varias ? `Crear en ${ids.length} cámaras` : "Crear regla") : "Guardar"}</Button>
                    </>
                }>
                <div className="px-6 py-5 space-y-5">
                    {/* Cámaras y nombre: lo primero. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <CajonCampo etiqueta={varias ? `Cámaras · ${ids.length}` : "Cámara"} ayuda={varias ? "La misma regla en cada una, con su propio dibujo. Se prenden, editan y borran juntas." : "Sumá más para vigilar lo mismo en varias cámaras."}>
                            <ElegirCamaras elegidas={ids} camaras={camaras} vistos={vistosPorCamara(vistos, r.clases)} alAlternar={alternarCamara} />
                        </CajonCampo>
                        <CajonCampo etiqueta={varias ? "Nombre del grupo" : "Nombre"} ayuda={varias ? `Cada cámara sale «${r.nombre.trim() || nombreAuto(t.nombre)} · ${nombreDe(ids[0])}».` : r.tipo === "conteo" ? EJEMPLO_AVISO.conteo(r.nombre || "…") : `Así sale en el aviso: ${EJEMPLO_AVISO[r.tipo](r.nombre || "…")}.`}>
                            <Input value={r.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder={nombreAuto(t.nombre)} className="h-11" />
                        </CajonCampo>
                    </div>
                    <QuienLoHace compacto />

                    {/* Qué analítica, y una plantilla para no empezar de cero. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <CajonCampo etiqueta="Analítica">
                            <Desplegable valor={r.tipo} vacio="Elegí la analítica" ancho={440}
                                alElegir={(v) => { setPlantilla(null); conTipo(v as TipoRegla); }}
                                opciones={(Object.keys(TIPOS_REGLA) as TipoRegla[]).filter((k) => !TIPOS_RETIRADOS.includes(k) || k === r.tipo).map((k) => {
                                    const Ic = ICONO[k];
                                    return { valor: k, titulo: TIPOS_REGLA[k].nombre, detalle: FORMA[k], extra: TIPOS_REGLA[k].queHace,
                                        icono: <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-muted"><Ic size={15} /></span> };
                                })} />
                        </CajonCampo>
                        <CajonCampo etiqueta="Plantilla" ayuda="Una configuración de uso común: pone las clases, los tiempos, el horario y el aviso. Después se ajusta lo que haga falta.">
                            <Desplegable valor={plantilla} vacio="Empezar desde una plantilla" ancho={440} alElegir={usarPlantilla}
                                opciones={PLANTILLAS.filter((p) => !TIPOS_RETIRADOS.includes(p.tipo)).map((p) => {
                                    const Ic = ICONO[p.tipo];
                                    return { valor: p.id, titulo: p.nombre, detalle: p.que, extra: `Ej.: ${p.ejemplo}`,
                                        icono: <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-[color-mix(in_oklab,var(--accion)_12%,transparent)] text-[var(--accion)]"><Ic size={15} /></span> };
                                })} />
                        </CajonCampo>
                    </div>

                    {/* Lo que cuenta: todo el catálogo de OmniVision en un campo, no siete píldoras. */}
                    {r.tipo === "suelo" || r.tipo === "trepar" || r.tipo === "epp" ? (
                        <CajonCampo etiqueta="Qué cuenta" ayuda={r.tipo === "epp" ? "Personas con los pies en la zona. Casco y chaleco salen de los atributos de cada persona: se decide con varias miradas, no con una foto." : "Personas en la zona. La posición del cuerpo sale de la pose, que se pide sólo cuando hay alguien en la zona."}>
                            <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full chip-info text-[12px] font-semibold"><PersonStanding size={13} /> Personas</span>
                        </CajonCampo>
                    ) : r.tipo === "fila" ? (
                        <CajonCampo etiqueta="Qué cuenta" ayuda="Personas con los pies adentro de la zona (el aforo), y las que cruzan su borde hacia adentro (entran) o hacia afuera (salen). Que la zona no toque el borde del cuadro: el que sale del cuadro no cruza el borde de la zona.">
                            <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full chip-info text-[12px] font-semibold"><PersonStanding size={13} /> Personas</span>
                        </CajonCampo>
                    ) : <CajonCampo etiqueta="Qué cuenta" ayuda={r.tipo === "retirado" ? "Lo que se aprende quieto en la zona y avisa si falta. Personas y animales no: se mueven solos." : r.tipo === "dejado" ? "Lo que aparece en la zona y queda solo. Lo entrenado acá también vale (un bulto propio)." : r.tipo === "animal" ? "Los animales que avisan." : "Sólo lo elegido dispara la regla. Lo entrenado acá va primero."}>
                        <ElegirClases valor={r.clases} alCambiar={(clases) => cambiar({ clases })} propias={r.tipo === "animal" ? [] : listaPropias()}
                            excluir={r.tipo === "retirado" ? ["persona", "animal"] : r.tipo === "dejado" ? ["persona", "animal", "vehiculo"] : r.tipo === "animal" ? ["persona", "vehiculo", "objeto", "calle", "casa", "comida", "deporte"] : []} />
                    </CajonCampo>}

                    {/* Cuándo dispara: los parámetros del tipo, en un renglón. */}
                    {r.tipo === "fila" && (
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                            <CampoNumero rotulo="Límite" valor={r.maximo ?? 10} min={FILA.maximo.min} max={FILA.maximo.max} unidad="personas" alCambiar={(n) => cambiar({ maximo: n })} ayuda="El aforo máximo de la fila: al llegar avisa, y la fila se pinta en aviso desde el 70 %." />
                            <CampoNumero rotulo="Rebote" valor={r.rebote ?? FILA.rebote.defecto} min={FILA.rebote.min} max={FILA.rebote.max} unidad="s" alCambiar={(n) => cambiar({ rebote: n })} ayuda="Cuánto tiene que sostenerse un número nuevo para valer, como el «Tiempo de rebote» de la cámara: uno tapado un instante no mueve la fila." />
                            <CampoNumero rotulo="Cuenta desde" valor={r.permanencia ?? FILA.permanencia.defecto} min={FILA.permanencia.min} max={FILA.permanencia.max} unidad="s adentro" alCambiar={(n) => cambiar({ permanencia: n })} ayuda="Cuánto tiene que llevar una persona adentro de la zona para contar en la fila. El que la cruza caminando no hace fila. 0: cuenta en cuanto entra." />
                            <CampoNumero rotulo="Supervisor a los" valor={r.escalarMin ?? FILA.escalarMin.defecto} min={FILA.escalarMin.min} max={FILA.escalarMin.max} unidad="min llena" alCambiar={(n) => cambiar({ escalarMin: n })} ayuda="Si la fila sigue en el límite estos minutos, un segundo aviso: avisar al supervisor. Uno por episodio." />
                            <CampoNumero rotulo="Entre avisos" valor={r.enfrioMin ?? FILA.enfrioMin.defecto} min={FILA.enfrioMin.min} max={FILA.enfrioMin.max} unidad="min" alCambiar={(n) => cambiar({ enfrioMin: n })} ayuda="Con la fila llena, no repite el aviso antes de esto." />
                        </div>
                    )}
                    {r.tipo === "fila" && (g.zona || []).some(([x, y]) => x < 0.02 || y < 0.02 || x > 0.98 || y > 0.98) && (
                        <p className="text-[11.5px] tono-aviso leading-snug">La zona toca el borde del cuadro: el que sale por ahí se va de la cámara sin cruzar el borde de la zona, y no cuenta como salida. Dejá un margen.</p>
                    )}
                    {r.tipo !== "conteo" && r.tipo !== "fila" && (
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                            {r.tipo === "sentido" && <label className="flex items-center gap-2 text-[12.5px]"><span className="text-muted-foreground">Se pasa</span><Segmentos valor={r.permitido || "ab"} opciones={[["ab", "De A a B"], ["ba", "De B a A"]]} alElegir={(v) => cambiar({ permitido: v })} /></label>}
                            {r.tipo === "cruce" && <label className="flex items-center gap-2 text-[12.5px]"><span className="text-muted-foreground">Avisa al cruzar</span><Segmentos valor={r.sentidos || "ambos"} opciones={[["ambos", "Los dos sentidos"], ["ab", "A→B"], ["ba", "B→A"]]} alElegir={(v) => cambiar({ sentidos: v })} /></label>}
                            {r.tipo === "intrusion" && <CampoNumero rotulo="Avisa a los" valor={r.segundos ?? 2} min={0} max={120} unidad="s adentro" alCambiar={(n) => cambiar({ segundos: n })} ayuda="Seguidos adentro de la zona. 2 s alcanza para que una sombra o un paso por el borde no avise." />}
                            {r.tipo === "merodeo" && <CampoNumero rotulo="Avisa a los" valor={r.segundos ?? 90} min={20} max={3600} unidad="s dando vueltas" alCambiar={(n) => cambiar({ segundos: n })} ayuda="En la zona y caminando: alguien parado esperando no es merodeo." />}
                            {r.tipo === "animal" && <>
                                <CampoNumero rotulo="Avisa a los" valor={r.segundos ?? 3} min={0} max={120} unidad="s en la zona" alCambiar={(n) => cambiar({ segundos: n })} ayuda="Seguidos adentro. Unos segundos alcanzan para que uno que pasa corriendo por el borde no avise." />
                                <label className="flex items-center gap-2 text-[12.5px]" title="Con una persona en la zona no avisa: el perro que pasea con su dueño no está suelto. Si la persona se va, avisa.">
                                    <Switch checked={r.sinPersona !== false} onCheckedChange={(v) => cambiar({ sinPersona: v })} /> <span>Sólo si no hay nadie</span>
                                </label>
                            </>}
                            {r.tipo === "suelo" && <CampoNumero rotulo="Avisa a los" valor={r.segundos ?? 20} min={5} max={600} unidad="s acostada" alCambiar={(n) => cambiar({ segundos: n })} ayuda="Seguidos en el suelo. Menos de 10 s avisa por alguien que se agacha a atarse los cordones." />}
                            {r.tipo === "trepar" && <CampoNumero rotulo="Avisa a los" valor={r.segundos ?? 2} min={1} max={30} unidad="s con las manos arriba" alCambiar={(n) => cambiar({ segundos: n })} ayuda="Seguidos, junto al cerco. Alguien que saluda también levanta las manos: la zona tiene que ir sobre el cerco o el muro." />}
                            {r.tipo === "epp" && <>
                                <CampoNumero rotulo="Avisa a los" valor={r.segundos ?? 10} min={5} max={600} unidad="s en la obra" alCambiar={(n) => cambiar({ segundos: n })} ayuda="Tiempo en la zona antes de decidir: así junta varias miradas de la persona." />
                                <label className="flex items-center gap-2 text-[12.5px]"><span className="text-muted-foreground">Exige</span>
                                    <Segmentos valor={(r.requiere || ["casco", "chaleco"]).length === 2 ? "ambos" : (r.requiere || ["casco"])[0]} opciones={[["ambos", "Casco y chaleco"], ["casco", "Casco"], ["chaleco", "Chaleco"]]}
                                        alElegir={(v) => cambiar({ requiere: v === "ambos" ? ["casco", "chaleco"] : [v as "casco" | "chaleco"] })} />
                                </label>
                            </>}
                            {r.tipo === "dejado" && <CampoNumero rotulo="Avisa a los" valor={Math.max(1, Math.round((r.segundos ?? 120) / 60))} min={1} max={60} unidad="min solo" alCambiar={(n) => cambiar({ segundos: n * 60 })} ayuda="Quieto en la zona y sin una persona al lado. Si el dueño está al lado, no avisa." />}
                            {r.tipo === "retirado" && <CampoNumero rotulo="Avisa si falta" valor={r.segundos ?? 20} min={5} max={600} unidad="s" alCambiar={(n) => cambiar({ segundos: n })} ayuda="Sin verse ni estar tapado por una persona." />}
                            {r.tipo === "permanencia" && <CampoNumero rotulo="Avisa a los" valor={Math.round((r.segundos ?? 300) / 60)} min={1} max={1440} unidad="min en la zona" alCambiar={(n) => cambiar({ segundos: n * 60 })} />}
                            {r.tipo === "aglomeracion" && <>
                                <CampoNumero rotulo="Desde" valor={r.maximo ?? 5} min={2} max={200} unidad="personas" alCambiar={(n) => cambiar({ maximo: n })} />
                                <CampoNumero rotulo="durante" valor={r.segundos ?? 30} min={5} max={3600} unidad="s" alCambiar={(n) => cambiar({ segundos: n })} />
                            </>}
                        </div>
                    )}

                    {/* Horario y aviso, en dos renglones cortos. */}
                    <div className="rounded-[10px] border border-border divide-y divide-border">
                        {CON_HORARIO.includes(r.tipo) && (
                            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5" title={r.tipo === "fila" ? "El horario de atención: fuera de él la fila se sigue contando pero no avisa, y al abrir empiezan de cero las entradas y salidas del día." : "Fuera de horario no registra ni avisa: el jardinero que cruza a las 10 no es una intrusión; el que cruza a las 3, sí."}>
                                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold min-w-[110px]"><Clock size={13} /> {r.tipo === "fila" ? "Atiende" : "Armada"}</span>
                                <Segmentos valor={r.horario ? "horario" : "siempre"} opciones={[["siempre", "Siempre"], ["horario", "En un horario"]]} alElegir={(v) => cambiar({ horario: v === "siempre" ? null : r.horario || (r.tipo === "fila" ? HORARIO_ATENCION : HORARIO_NOCHE) })} />
                                {r.horario && (
                                    <span className="inline-flex items-center gap-2 text-[12.5px]">
                                        <Input type="time" value={r.horario.desde} onChange={(e) => cambiar({ horario: { ...r.horario!, desde: e.target.value } })} className="w-28 h-9 tabular-nums" />
                                        a
                                        <Input type="time" value={r.horario.hasta} onChange={(e) => cambiar({ horario: { ...r.horario!, hasta: e.target.value } })} className="w-28 h-9 tabular-nums" />
                                        {r.horario.desde > r.horario.hasta && <span className="text-[11px] text-muted-foreground">cruza la medianoche</span>}
                                    </span>
                                )}
                            </div>
                        )}
                        <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold min-w-[110px]"><BellRing size={13} /> Avisar</span>
                            <span className="flex-1 text-[11.5px] text-muted-foreground leading-snug">
                                {r.tipo === "conteo" ? "El conteo no avisa: suma los cruces por sentido, clase y hora (90 días)." : r.tipo === "fila" ? (r.avisar ? "Al llegar al límite, aviso con foto a la consola del guardia; si sigue llena, otro para el supervisor. La fila se ve en Visión → Filas." : "No avisa: la fila sólo se ve en Visión → Filas.") : r.avisar ? "Aviso con foto a la consola del guardia, Control LPR y Gestión de alarmas." : "Sólo queda registrado acá, con su foto."}
                            </span>
                            {r.tipo !== "conteo" && <Switch checked={r.avisar} onCheckedChange={(v) => cambiar({ avisar: v })} />}
                        </label>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Cada cámara se mira cada ~2 s: personas y autos a paso de barrio se siguen bien; un auto rápido puede perderse entre dos cuadros.</p>
                </div>
            </CajonContenido>
        </Cajon>
    );
}

/* ───────────────────────── Asistente para crear una regla ─────────────────────────
 * 16/10, Nico: «cuando creamos una regla debería ser un drawer, con las distintas reglas posibles
 * pero más inteligente, preguntando incluso clases de COCO, objetos, entrenamiento propio…; súper
 * intuitivo». Antes «Nueva regla» desplegaba ocho tarjetas de tipo en la página: había que saber de
 * antemano que «una persona en el jardín de noche» es una «Intrusión en zona propia».
 *
 * Ahora se contesta en el idioma del barrio: QUÉ (personas, vehículos, objetos, lo entrenado acá) y
 * QUÉ PASA (entra a una zona, cruza una línea, se queda, da vueltas…). El tipo de regla sale solo,
 * y lo que no tiene sentido para lo elegido se apaga con el porqué (no hay merodeo de un
 * contenedor). Después la cámara, y se abre el editor con todo cargado para dibujar. */

type Sujeto = { id: string; nombre: string; detalle: string; clases: string[]; icono: LucideIcon; propio?: boolean };
type Situacion = {
    id: string; tipo: TipoRegla; nombre: string; detalle: string; icono: LucideIcon; /** Para qué sujetos tiene sentido; vacío = todos. */ solo?: string[]; nunca?: string[];
    /** Cuando la cámara tiene una analítica parecida: en qué se diferencia de la de OmniVision. */
    enCamara?: string;
};

const SUJETOS_BASE: Sujeto[] = [
    { id: "personas", nombre: "Personas", detalle: "Gente caminando", clases: ["person"], icono: PersonStanding },
    { id: "vehiculos", nombre: "Vehículos", detalle: "Autos, camionetas, ómnibus, motos", clases: ["car", "truck", "bus", "motorcycle"], icono: Car },
    { id: "bicis", nombre: "Bicicletas", detalle: "Bicis, en movimiento o estacionadas", clases: ["bicycle"], icono: Bike },
    { id: "perros", nombre: "Animales", detalle: "Perros, gatos, caballos sueltos", clases: ["dog", "cat", "horse", "cow", "sheep"], icono: Dog },
    { id: "objetos", nombre: "Objetos", detalle: "Mochilas, bolsos, valijas, sillas, bancos, macetas", clases: CLASES_OBJETO.map((c) => c.clase), icono: Backpack },
];

const SITUACIONES: Situacion[] = [
    { id: "entra", tipo: "intrusion", nombre: "Entra a una zona", detalle: "Alguien o algo entra donde no debe y se queda unos segundos.", icono: ShieldAlert, enCamara: "No es la intrusión de la cámara: ésta sabe qué entró y anda en cualquier marca." },
    { id: "cruza", tipo: "cruce", nombre: "Cruza una línea", detalle: "Pasa por encima de una línea: un cerco, un portón, un límite.", icono: Fence, enCamara: "No es el cruce de línea de la cámara: éste sabe qué cruzó y no se configura en el equipo." },
    { id: "contramano", tipo: "sentido", nombre: "Va en contramano", detalle: "Cruza la línea en el sentido que no corresponde.", icono: ArrowLeftRight, nunca: ["objetos"] },
    { id: "queda", tipo: "permanencia", nombre: "Se queda mucho tiempo", detalle: "Sigue en la zona más de los minutos que digas.", icono: Timer },
    { id: "vueltas", tipo: "merodeo", nombre: "Da vueltas (merodeo)", detalle: "Una persona camina por la zona un buen rato, sin quedarse quieta.", icono: Footprints, solo: ["personas"] },
    { id: "fila", tipo: "fila", nombre: "Hacen fila", detalle: "Cuántas esperan en la zona, cuántas entran y salen, y aviso al llegar al límite.", icono: ListOrdered, solo: ["personas"], enCamara: "Como la analítica de aforo de las cámaras Bosch del modo Filas, pero la hace OmniVision: anda con cualquier cámara." },
    { id: "juntan", tipo: "aglomeracion", nombre: "Se juntan varios", detalle: "Más personas juntas de las que digas, durante un rato.", icono: Users, solo: ["personas"] },
    { id: "suelto", tipo: "animal", nombre: "Anda suelto", detalle: "Un animal en la zona sin ninguna persona con él.", icono: Dog, solo: ["perros"] },
    { id: "dejan", tipo: "dejado", nombre: "Lo dejan (abandonado)", detalle: "Aparece un bulto y queda solo, sin nadie al lado.", icono: Luggage, solo: ["objetos"] },
    { id: "cae", tipo: "suelo", nombre: "Queda en el suelo", detalle: "Una persona acostada en la zona: se cayó o se descompuso.", icono: Ambulance, solo: ["personas"] },
    { id: "trepa", tipo: "trepar", nombre: "Trepa un cerco o un muro", detalle: "Una persona junto al cerco con las manos arriba.", icono: ArrowUpToLine, solo: ["personas"] },
    { id: "epp", tipo: "epp", nombre: "Sin casco o chaleco", detalle: "Alguien en la obra sin el equipo de seguridad.", icono: HardHat, solo: ["personas"] },
    { id: "desaparece", tipo: "retirado", nombre: "Desaparece (se lo llevan)", detalle: "Algo que estaba quieto en la zona ya no está.", icono: PackageMinus, nunca: ["personas", "perros"] },
    { id: "contar", tipo: "conteo", nombre: "Contar los que pasan", detalle: "Suma por sentido, clase y hora. No avisa.", icono: Spline },
];

/** Por qué una situación no se puede con lo elegido; null si se puede. */
function porQueNo(s: Situacion, sujetos: string[]): string | null {
    if (!sujetos.length) return null;
    if (s.solo && sujetos.some((x) => !s.solo!.includes(x))) return `Sólo con ${s.solo.map((x) => SUJETOS_BASE.find((b) => b.id === x)?.nombre.toLowerCase()).join(", ")}`;
    if (s.nunca && sujetos.some((x) => s.nunca!.includes(x))) return `No con ${s.nunca.filter((x) => sujetos.includes(x)).map((x) => SUJETOS_BASE.find((b) => b.id === x)?.nombre.toLowerCase()).join(", ")}`;
    return null;
}

function AsistenteRegla({ abierto, camaras, analiticas, vistos, vistosDias, alCerrar, alListo }: {
    abierto: boolean; camaras: { id: string; name: string; analiza: boolean }[]; analiticas: Record<TipoRegla, boolean>;
    vistos?: Respuesta["vistos"]; vistosDias: number;
    alCerrar: () => void; alListo: (r: ReglaVision, deviceIds: string[]) => void;
}) {
    const [paso, setPaso] = useState<1 | 2>(1);
    const [sujetos, setSujetos] = useState<string[]>([]);
    const [situacion, setSituacion] = useState<string | null>(null);
    const [noche, setNoche] = useState(false);
    const [elegidas, setElegidas] = useState<string[]>([]);
    const [buscar, setBuscar] = useState("");
    /** Lo que no está en las tarjetas: cualquiera de las 80 clases que reconoce OmniVision. */
    const [extras, setExtras] = useState<string[]>([]);
    useEffect(() => { if (abierto) { setPaso(1); setSujetos([]); setSituacion(null); setNoche(false); setElegidas([]); setBuscar(""); setExtras([]); } }, [abierto]);

    // Lo entrenado acá (detector propio): cada clase es un «qué» más, con su nombre.
    const propias = listaPropias();
    const sujetosPropios: Sujeto[] = propias.map((p) => ({ id: p.clase, nombre: p.nombre, detalle: "Entrenado acá", clases: [p.clase], icono: Boxes, propio: true }));
    const sujetosTodos: Sujeto[] = [...SUJETOS_BASE, ...sujetosPropios];
    const sit = SITUACIONES.find((s) => s.id === situacion) || null;
    // Para la compatibilidad, lo entrenado cuenta como «objetos».
    const grupoDeExtra = (c: string) => { const g = CLASE_POR_NOMBRE[c]?.grupo; return g === "persona" ? "personas" : g === "vehiculo" ? "vehiculos" : g === "animal" ? "perros" : "objetos"; };
    const grupos = [...sujetos.map((x) => (sujetosTodos.find((s) => s.id === x)?.propio ? "objetos" : x)), ...extras.map(grupoDeExtra)];
    const alternar = (id: string) => setSujetos((xs) => {
        const n = xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id];
        const g = n.map((x) => (sujetosTodos.find((s) => s.id === x)?.propio ? "objetos" : x));
        if (sit && porQueNo(sit, [...g, ...extras.map(grupoDeExtra)])) setSituacion(null);
        return n;
    });
    const cambiarExtras = (v: string[]) => {
        setExtras(v);
        if (sit && porQueNo(sit, [...sujetos.map((x) => (sujetosTodos.find((s) => s.id === x)?.propio ? "objetos" : x)), ...v.map(grupoDeExtra)])) setSituacion(null);
    };
    const usarAtajo = (p: Plantilla) => {
        const ids = SUJETOS_BASE.filter((b) => b.clases.some((c) => p.aplicar.clases?.includes(c))).map((b) => b.id);
        setSujetos(ids); setExtras([]); setSituacion(SITUACIONES.find((s) => s.tipo === p.tipo)?.id || null); setNoche(!!p.aplicar.horario);
    };
    const clases = [...new Set([...sujetos.flatMap((x) => sujetosTodos.find((s) => s.id === x)?.clases || []), ...extras])];
    // «De noche» es para armar una vigilancia; el horario de una fila (atención) se elige en el editor.
    const conHorario = !!sit && CON_HORARIO.includes(sit.tipo) && sit.tipo !== "fila";
    const listoPaso1 = !!sit && clases.length > 0;
    const nombresSujetos = [...sujetos.map((x) => sujetosTodos.find((s) => s.id === x)?.nombre), ...extras.map(nombreClase)].filter(Boolean).join(", ");
    const resumen = sit ? `${sit.nombre}${clases.length ? ` · ${nombresSujetos}` : ""}${conHorario && noche ? " · de 22 a 6" : ""}` : null;

    // Dónde se vio lo elegido: las cámaras que tienen lo que se quiere vigilar.
    const vistas = useMemo(() => vistosPorCamara(vistos, clases), [vistos, clases.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
    const conVistos = camaras.filter((c) => (vistas.get(c.id) || 0) > 0);
    const alternarCam = (id: string) => setElegidas((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

    const crear = (ids: string[] = elegidas) => {
        if (!sit || !ids.length) return;
        const base = reglaNueva(sit.tipo, ids[0]);
        const propiosElegidos = sujetosPropios.filter((p) => sujetos.includes(p.id)).map((p) => p.nombre);
        // Una cámara: «Tipo · Cámara», como siempre. Varias: el grupo se llama por lo que vigila
        // («Objeto retirado · Contenedor») y cada regla le suma su cámara.
        const nombre = ids.length > 1 ? [TIPOS_REGLA[sit.tipo].nombre, ...propiosElegidos].join(" · ") : `${TIPOS_REGLA[sit.tipo].nombre} · ${camaras.find((c) => c.id === ids[0])?.name || ""}`;
        alListo({ ...base, clases, nombre, ...(conHorario ? { horario: noche ? HORARIO_NOCHE : null } : {}) }, ids);
    };
    const q = buscar.trim().toLowerCase();
    const camarasVistas = camaras.filter((c) => !q || c.name.toLowerCase().includes(q))
        .sort((a, b) => (vistas.get(b.id) || 0) - (vistas.get(a.id) || 0) || Number(b.analiza) - Number(a.analiza));
    const enVision = camaras.filter((c) => c.analiza);

    // Una función y no un componente: definido adentro, React lo desmontaría en cada render.
    const tarjetaSujeto = (s: Sujeto) => {
        const on = sujetos.includes(s.id);
        return (
            <button key={s.id} type="button" aria-pressed={on} onClick={() => alternar(s.id)}
                className={cn("flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors",
                    on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent/50")}>
                <span className={cn("grid h-9 w-9 place-items-center rounded-[9px] shrink-0", on ? "bg-[var(--accion)] text-white" : "bg-muted text-muted-foreground")}><s.icono size={17} /></span>
                <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold truncate" title={s.nombre}>{s.nombre}</span>
                    <span className="block text-[10.5px] text-muted-foreground truncate">{s.detalle}</span>
                </span>
            </button>
        );
    };

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={paso === 1 ? "¿Qué querés vigilar?" : "¿En qué cámaras?"}
                descripcion={paso === 1 ? "Elegí qué mirar y qué tiene que pasar: la regla sale sola. Después, las cámaras y el dibujo." : resumen || ""}
                encabezado={
                    <div className="flex items-center gap-2 px-6 py-2.5 text-[12px]">
                        {[1, 2, 3].map((n) => (
                            <span key={n} className={cn("inline-flex items-center gap-1.5", n === paso ? "text-foreground font-semibold" : "text-muted-foreground")}>
                                <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold", n < paso ? "bg-[var(--accion)] text-white" : n === paso ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>{n < paso ? <Check size={11} /> : n}</span>
                                {n === 1 ? "Qué y cuándo" : n === 2 ? "Cámaras" : "Dibujo"}
                                {n < 3 && <span className="w-6 h-px bg-border mx-1" />}
                            </span>
                        ))}
                    </div>
                }
                pie={
                    <>
                        {paso === 2 && <Button variant="ghost" className="mr-auto" onClick={() => setPaso(1)}>Atrás</Button>}
                        {paso === 1 && <span className="mr-auto text-[12px] text-muted-foreground truncate">{resumen ? <>Vas a crear: <b className="text-foreground">{resumen}</b></> : "Elegí qué y qué pasa."}</span>}
                        <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                        {paso === 1 ? <Button onClick={() => setPaso(2)} disabled={!listoPaso1}>Siguiente</Button>
                            : <Button onClick={() => crear()} disabled={!elegidas.length}><Spline size={15} /> {elegidas.length > 1 ? `Dibujar en ${elegidas.length} cámaras` : "Dibujar la regla"}</Button>}
                    </>
                }>
                {paso === 1 ? (
                    <div className="px-6 py-5 space-y-6">
                        <QuienLoHace />

                        {/* Atajos: los casos de siempre, de un toque. */}
                        <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Atajos</div>
                            <div className="flex flex-wrap gap-1.5">
                                {PLANTILLAS.filter((p) => !TIPOS_RETIRADOS.includes(p.tipo)).map((p) => {
                                    const Ic = ICONO[p.tipo];
                                    return (
                                        <Pista key={p.id} titulo={p.nombre} texto={`${p.que} Ej.: ${p.ejemplo}`} ancho={280}>
                                            <button type="button" onClick={() => usarAtajo(p)}
                                                className="h-8 pl-2 pr-3 rounded-full border border-border text-[12px] font-semibold inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:border-[var(--accion)] transition-colors">
                                                <Ic size={13} /> {p.nombre}
                                            </button>
                                        </Pista>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 1. Qué: lo que OmniVision reconoce de fábrica, y lo que se le enseñó acá. */}
                        <div className="space-y-3">
                            <div className="flex items-baseline gap-2">
                                <span className="text-[13px] font-bold">Qué</span>
                                <span className="text-[11.5px] text-muted-foreground">uno o varios · lo reconoce OmniVision, no la cámara</span>
                            </div>
                            <div>
                                <div className="text-[11px] text-muted-foreground mb-1.5">Lo que OmniVision reconoce de fábrica</div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{SUJETOS_BASE.map(tarjetaSujeto)}</div>
                            </div>
                            <div>
                                <div className="text-[11px] text-muted-foreground mb-1.5">Lo que se le enseñó acá (Entrenar)</div>
                                {sujetosPropios.length
                                    ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{sujetosPropios.map(tarjetaSujeto)}</div>
                                    : <p className="text-[11px] text-muted-foreground">Lo que entrenes en OmniVision › Entrenar (un contenedor, un cono) aparece acá como un «qué» más.</p>}
                            </div>
                            <div>
                                <div className="text-[11px] text-muted-foreground mb-1.5">Otra cosa de las {CLASES_CATALOGO.length} que reconoce</div>
                                <ElegirClases valor={extras} alCambiar={cambiarExtras} propias={[]} vacio="Un gato, una valija, una pelota, un banco…" />
                            </div>
                        </div>

                        {/* 2. Qué pasa */}
                        <div>
                            <div className="flex items-baseline gap-2 mb-2">
                                <span className="text-[13px] font-bold">Qué pasa</span>
                                <span className="text-[11.5px] text-muted-foreground">lo que dispara la regla</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {SITUACIONES.filter((s) => !TIPOS_RETIRADOS.includes(s.tipo)).map((s) => {
                                    const no = porQueNo(s, grupos);
                                    const on = situacion === s.id;
                                    const apagada = !analiticas[s.tipo];
                                    return (
                                        <button key={s.id} type="button" disabled={!!no} aria-pressed={on} onClick={() => setSituacion(s.id)}
                                            className={cn("flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                                                on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent/50",
                                                no && "opacity-45 cursor-not-allowed hover:bg-transparent")}>
                                            <s.icono size={16} className={cn("mt-0.5 shrink-0", on ? "text-[var(--accion)]" : "text-muted-foreground")} />
                                            <span className="min-w-0">
                                                <span className="block text-[12.5px] font-semibold">{s.nombre}</span>
                                                <span className="block text-[11px] text-muted-foreground leading-snug">{no || s.detalle}</span>
                                                {!no && s.enCamara && <span className="block text-[10.5px] text-muted-foreground/80 mt-0.5 italic">{s.enCamara}</span>}
                                                {!no && apagada && <span className="block text-[10.5px] tono-aviso mt-0.5">Apagada en Analíticas: se crea, pero no corre hasta prenderla.</span>}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {/* La elegida, animada y explicada: se ve qué tiene que pasar antes de dibujar nada (21/10).
                                Debajo de la grilla y no arriba: arriba corría las tarjetas justo al tocar una. */}
                            {sit && <ComoFunciona key={sit.id} clave={sit.tipo as ClaveComportamiento} className="mt-3 rounded-[10px] border border-border p-3" />}
                        </div>

                        {/* 3. Cuándo */}
                        {conHorario && (
                            <label className="flex items-center gap-3 rounded-[10px] border border-border px-3 py-2.5 cursor-pointer">
                                <Clock size={15} className="text-muted-foreground" />
                                <span className="flex-1">
                                    <span className="block text-[12.5px] font-semibold">Sólo de noche</span>
                                    <span className="block text-[11px] text-muted-foreground">De 22 a 6. El jardinero que cruza a las 10 no es una intrusión; el que cruza a las 3, sí.</span>
                                </span>
                                <Switch checked={noche} onCheckedChange={setNoche} />
                            </label>
                        )}
                    </div>
                ) : (
                    <div className="px-6 py-5 space-y-3">
                        <p className="text-[12px] text-muted-foreground leading-snug">Una o varias: en cada una la regla corre por su cuenta, con su propio dibujo, y quedan juntas como un grupo para prenderlas, editarlas o borrarlas de una vez.</p>
                        {/* Atajos de selección: dónde se vio lo elegido, todas, ninguna. */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {conVistos.length > 0 && (
                                <Pista titulo={`Donde se vio ${nombresSujetos.toLowerCase()}`} texto={`Las cámaras donde OmniVision vio ${nombresSujetos.toLowerCase()} en los últimos ${vistosDias} días. Es la forma rápida de elegir «todas las que tienen un contenedor».`} ancho={300}>
                                    <button type="button" onClick={() => setElegidas(conVistos.map((c) => c.id))}
                                        className="h-8 pl-2 pr-3 rounded-full border border-[var(--accion)] text-[var(--accion)] text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]">
                                        <ScanEye size={13} /> Donde se vio · {conVistos.length}
                                    </button>
                                </Pista>
                            )}
                            <button type="button" onClick={() => setElegidas(enVision.map((c) => c.id))} className="h-8 px-3 rounded-full border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground">Todas las de OmniVision · {enVision.length}</button>
                            {elegidas.length > 0 && <button type="button" onClick={() => setElegidas([])} className="h-8 px-3 rounded-full text-[12px] font-semibold text-muted-foreground hover:text-foreground">Ninguna</button>}
                            <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">{elegidas.length ? `${elegidas.length} elegida${elegidas.length === 1 ? "" : "s"}` : ""}</span>
                        </div>
                        {clases.length > 0 && !conVistos.length && <p className="text-[11px] text-muted-foreground">OmniVision no vio {nombresSujetos.toLowerCase()} en ninguna cámara en los últimos {vistosDias} días: elegilas a mano.</p>}
                        <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cámara" className="h-10" />
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {camarasVistas.map((c) => {
                                const on = elegidas.includes(c.id);
                                const n = vistas.get(c.id) || 0;
                                return (
                                    <button key={c.id} type="button" onClick={() => alternarCam(c.id)} onDoubleClick={() => crear([c.id])} aria-pressed={on}
                                        className={cn("rounded-[10px] overflow-hidden border text-left transition-colors", on ? "border-[var(--accion)] ring-2 ring-[var(--accion)]/30" : "border-border hover:border-foreground/30")}>
                                        <span className="relative block aspect-video bg-black">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={fotoCamara(c.id, 320)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                                            <span className={cn("absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2", on ? "bg-[var(--accion)] border-[var(--accion)] text-white" : "border-white/80 bg-black/30")}>{on && <Check size={13} />}</span>
                                            {n > 0 && <span className="absolute left-1.5 bottom-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-black/70 text-white text-[10.5px] font-semibold tabular-nums" title={`OmniVision vio ${nombresSujetos.toLowerCase()} ${n} veces en ${vistosDias} días`}><ScanEye size={10} /> {n}</span>}
                                        </span>
                                        <span className="block px-2 py-1.5">
                                            <span className="block text-[12px] font-semibold truncate">{c.name}</span>
                                            <span className={cn("block text-[10.5px] truncate", c.analiza ? "text-muted-foreground" : "tono-aviso")}>{c.analiza ? "OmniVision la mira" : "Fuera de OmniVision: no correría"}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </CajonContenido>
        </Cajon>
    );
}
