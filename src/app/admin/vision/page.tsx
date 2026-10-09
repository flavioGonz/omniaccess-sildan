"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ScanEye, ScanSearch, Shapes, PersonStanding, Waypoints, Tag, Sparkles, Move, User, Users, Car, PawPrint, Backpack,
    TrafficCone, Sofa, Utensils, Volleyball, Truck, Bike, Bus, TrainFront, Sailboat, Plane, Dog, Cat, Bird, Briefcase,
    Luggage, Umbrella, Smartphone, Shirt, Laptop, Book, Scissors, Baby, Fan, Brush, Octagon, FireExtinguisher,
    ParkingMeter, Armchair, Flower2, Bed, Table, Toilet, Tv, TvMinimal, Mouse, Keyboard, Microwave, CookingPot, Bath,
    Refrigerator, Clock, Flower, Milk, Wine, Coffee, UtensilsCrossed, Soup, Banana, Apple, Sandwich, Citrus, Salad,
    Carrot, Pizza, Donut, Cake, Footprints, MountainSnow, Wind, Trophy, Hand, Waves, ShieldCheck, ScanLine, Layers,
    Cpu, Loader2, Camera, RefreshCw, EyeOff, FlaskConical, Info, type LucideIcon,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import {
    CAPACIDADES, CLASES, GRUPOS, ANALITICAS, CLASE_POR_NOMBRE,
    type Capacidad, type Clase, type Analitica, type EstadoCapacidad, type EstadoAnalitica, type Grupo,
} from "@/lib/vision-catalogo";
import type { SaludVision, ObjetoVisto } from "@/lib/vision";

/**
 * Laboratorio de visión: lo que se está construyendo con el detector de objetos.
 *
 * Ruta sin entrada en el menú a propósito (pedido de Nico, 9/10): es para probar y decidir,
 * no para operar. La protege el permiso Ajustes (lib/permisos), porque los interruptores son
 * configuración.
 *
 * Cuatro bloques, en el orden en que se lee:
 *   1. Qué puede hacer la familia YOLO y con qué pieza libre se hace acá.
 *   2. Probar: el cuadro actual de una cámara con las cajas dibujadas, o todas de una vez.
 *   3. Las analíticas de OmniAccess, con su interruptor y su estado real.
 *   4. Las 80 clases que reconoce, cada una con su ficha.
 *
 * Los interruptores no mienten: una analítica que todavía no corre se puede prender, y la
 * fila dice "prendida · todavía no corre". Lo único que hoy obedece a los interruptores de
 * clase es la prueba de esta misma pantalla (lo apagado no se dibuja y se cuenta aparte).
 */

const ICONOS: Record<string, LucideIcon> = {
    ScanEye, ScanSearch, Shapes, PersonStanding, Waypoints, Tag, Sparkles, Move, User, Users, Car, PawPrint, Backpack,
    TrafficCone, Sofa, Utensils, Volleyball, Truck, Bike, Bus, TrainFront, Sailboat, Plane, Dog, Cat, Bird, Briefcase,
    Luggage, Umbrella, Smartphone, Shirt, Laptop, Book, Scissors, Baby, Fan, Brush, Octagon, FireExtinguisher,
    ParkingMeter, Armchair, Flower2, Bed, Table, Toilet, Tv, TvMinimal, Mouse, Keyboard, Microwave, CookingPot, Bath,
    Refrigerator, Clock, Flower, Milk, Wine, Coffee, UtensilsCrossed, Soup, Banana, Apple, Sandwich, Citrus, Salad,
    Carrot, Pizza, Donut, Cake, Footprints, MountainSnow, Wind, Trophy, Hand, Waves, ShieldCheck, ScanLine, Layers,
};
function Ic({ n, size = 16, className }: { n: string; size?: number; className?: string }) {
    const C = ICONOS[n] || ScanSearch;
    return <C size={size} className={className} />;
}

/** Cada cuánto se vuelve a preguntar la salud de omni-vision. */
const REFRESCO_SALUD_MS = 10_000;
/** Los umbrales que se ofrecen: debajo de 0,3 el detector inventa; arriba de 0,6 se pierden personas de noche. */
const UMBRALES = [0.3, 0.4, 0.5, 0.6];
/** Alto máximo de la foto analizada, en px. */
const ALTO_MAX_FOTO = 520;

const TONO_CAPACIDAD: Record<EstadoCapacidad, { tono: "bien" | "info" | "aviso" | "quieto"; texto: string }> = {
    corre: { tono: "bien", texto: "Corre hoy" },
    libre: { tono: "info", texto: "Libre · sin instalar" },
    pesado: { tono: "aviso", texto: "Libre · pesado" },
    "no-aplica": { tono: "quieto", texto: "No aplica" },
};
const TONO_ANALITICA: Record<EstadoAnalitica, { tono: "bien" | "info" | "quieto"; texto: string }> = {
    corre: { tono: "bien", texto: "Corre" },
    desarrollo: { tono: "info", texto: "En desarrollo" },
    posible: { tono: "quieto", texto: "Posible" },
};
const RELEVANCIA: Record<Clase["relevancia"], string> = { clave: "Clave", util: "Útil", poco: "Poco útil" };

type Camara = { id: string; name: string; deviceType: string };
type Estado = {
    salud: SaludVision | null; latencia: number; error?: string;
    analiticas: Record<string, boolean>; clases: Record<string, boolean>; camaras: Camara[];
};
type Prueba = {
    camara: { id: string; name: string }; fuente: string; ms_cuadro: number; ancho: number; alto: number;
    ms_inferencia: number; ms: number; modelo: string; umbral: number; objetos: ObjetoVisto[]; imagen: string; instante: string;
};
type Visto = { camara: { id: string; name: string }; objeto: ObjetoVisto; imagen: string };

const pct = (v: number) => `${Math.round(v * 100)} %`;
const horaCorta = (iso: string) => new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export default function VisionLab() {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [errorCarga, setErrorCarga] = useState<string | null>(null);
    const [camara, setCamara] = useState<string>("");
    const [umbral, setUmbral] = useState(0.4);
    const [prueba, setPrueba] = useState<Prueba | null>(null);
    const [probando, setProbando] = useState(false);
    const [errorPrueba, setErrorPrueba] = useState<string | null>(null);
    const [escaneo, setEscaneo] = useState<Record<string, Prueba | { error: string }>>({});
    const [escaneando, setEscaneando] = useState<{ hechas: number; total: number } | null>(null);
    const [claseAbierta, setClaseAbierta] = useState<Clase | null>(null);
    const [analiticaAbierta, setAnaliticaAbierta] = useState<Analitica | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const [grupo, setGrupo] = useState<"todos" | Grupo>("todos");
    const [mostrar, setMostrar] = useState<"todas" | "prendidas" | "vistas">("todas");
    const cancelado = useRef(false);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/estado", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setEstado(j); setErrorCarga(null);
            setCamara((c) => c || j.camaras?.[0]?.id || "");
        } catch (e: any) { setErrorCarga(e?.message || "sin respuesta"); }
    }, []);
    useEffect(() => {
        cargar();
        const t = setInterval(cargar, REFRESCO_SALUD_MS);
        return () => { clearInterval(t); cancelado.current = true; };
    }, [cargar]);

    async function guardar(tipo: "analitica" | "clase", id: string, prendida: boolean) {
        if (!estado) return;
        const clave = tipo === "clase" ? "clases" : "analiticas";
        const antes = estado[clave][id];
        setEstado({ ...estado, [clave]: { ...estado[clave], [id]: prendida } });
        try {
            const r = await fetch("/api/vision/ajustes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo, id, prendida }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setEstado((e) => (e ? { ...e, analiticas: j.analiticas, clases: j.clases } : e));
        } catch (e: any) {
            setEstado((x) => (x ? { ...x, [clave]: { ...x[clave], [id]: antes } } : x));
            toast.error({ title: "No se guardó", description: e?.message });
        }
    }

    async function probarCamara(id: string): Promise<Prueba> {
        const r = await fetch(`/api/vision/probar?camara=${encodeURIComponent(id)}&umbral=${umbral}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
        return j as Prueba;
    }

    async function analizar() {
        if (!camara) return;
        setProbando(true); setErrorPrueba(null);
        try { const p = await probarCamara(camara); setPrueba(p); setEscaneo((s) => ({ ...s, [camara]: p })); }
        catch (e: any) { setErrorPrueba(e?.message || "falló"); }
        finally { setProbando(false); }
    }

    // De a una cámara: omni-vision atiende una inferencia a la vez, y pedirlas todas juntas
    // sólo las encola del otro lado (y le quita turno a omni-lpr mientras tanto).
    async function escanearTodas() {
        const cams = estado?.camaras || [];
        if (!cams.length) return;
        setEscaneando({ hechas: 0, total: cams.length });
        const nuevo: Record<string, Prueba | { error: string }> = {};
        for (let i = 0; i < cams.length; i++) {
            if (cancelado.current) return;
            try { nuevo[cams[i].id] = await probarCamara(cams[i].id); }
            catch (e: any) { nuevo[cams[i].id] = { error: e?.message || "falló" }; }
            setEscaneo({ ...nuevo });
            setEscaneando({ hechas: i + 1, total: cams.length });
        }
        setEscaneando(null);
        const p = nuevo[camara];
        if (p && "objetos" in p) setPrueba(p);
    }

    /** Lo que se vio en la última pasada, por clase: alimenta las fichas y el filtro "vistas ahora". */
    const vistos = useMemo(() => {
        const m: Record<string, Visto[]> = {};
        for (const p of Object.values(escaneo)) {
            if (!("objetos" in p)) continue;
            for (const o of p.objetos) (m[o.clase] ||= []).push({ camara: p.camara, objeto: o, imagen: p.imagen });
        }
        return m;
    }, [escaneo]);

    const clasesFiltradas = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return CLASES.filter((c) =>
            (grupo === "todos" || c.grupo === grupo)
            && (mostrar === "todas" || (mostrar === "prendidas" ? estado?.clases[c.clase] : !!vistos[c.clase]))
            && (!q || c.nombre.toLowerCase().includes(q) || c.clase.includes(q)));
    }, [busqueda, grupo, mostrar, estado, vistos]);

    if (!estado && errorCarga) {
        return <div className="p-6 lg:p-8 max-w-[1400px] mx-auto"><ErrorEstado mensaje={errorCarga} alReintentar={cargar} /></div>;
    }
    if (!estado) return <div className="p-6 lg:p-8 max-w-[1400px] mx-auto"><Cargando texto="Preguntándole a omni-vision…" /></div>;

    const s = estado.salud;
    const prendidas = estado.clases;
    const enGpu = s?.proveedor?.startsWith("CUDA");

    return (
        <div className="p-6 lg:p-8 space-y-8 max-w-[1400px] mx-auto">
            {/* Encabezado */}
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><ScanEye size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Visión</h1>
                        <Chip tono="info" icono={FlaskConical}>Laboratorio · sin menú</Chip>
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        El detector de objetos que se está sumando a OmniAccess: qué puede hacer, probarlo sobre las cámaras del barrio y decidir qué analíticas se prenden. Nada de esto toca todavía los monitores, las alarmas ni los accesos.
                    </p>
                </div>
            </div>

            {/* Salud del servicio */}
            <section className="rounded-[10px] border border-border bg-card p-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", s ? "bg-[var(--bien)]" : "bg-[var(--mal)]")} />
                    <span className="text-[14px] font-bold">omni-vision</span>
                    {s ? (
                        <>
                            <Chip tono="bien">Corriendo</Chip>
                            <Chip tono={enGpu ? "bien" : "aviso"} icono={Cpu}>{enGpu ? "En GPU" : "En CPU (lento)"}</Chip>
                            <span className="text-[12px] text-muted-foreground">{s.modelo} · {s.licencia} · COCO {s.coco_ap} AP</span>
                        </>
                    ) : (
                        <Chip tono="mal">{estado.error || "No contesta"}</Chip>
                    )}
                </div>
                {s && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        <Cifra v={s.latencia_ms?.p50 != null ? `${s.latencia_ms.p50} ms` : "—"} l="por cuadro (mediana)" />
                        <Cifra v={s.latencia_ms?.p95 != null ? `${s.latencia_ms.p95} ms` : "—"} l="peor 5 %" />
                        <Cifra v={s.total} l="cuadros analizados" />
                        <Cifra v={s.errores} l="errores" />
                        <Cifra v={s.vram ? `${(s.vram.usada_mb / 1024).toFixed(1)} / ${(s.vram.total_mb / 1024).toFixed(0)} GB` : "—"} l="memoria de video (toda la GPU)" />
                        <Cifra v={`${s.resolucion} px`} l="resolución del modelo" />
                    </div>
                )}
            </section>

            {/* 1. Qué puede hacer */}
            <section>
                <Titulo n={1} titulo="Qué puede hacer un detector como YOLO"
                    ayuda="Las tareas que existen en la familia YOLO26 y, para cada una, con qué pieza libre se hace acá. YOLO26 es AGPL y servirlo pide licencia paga: no se usa." />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {CAPACIDADES.map((c) => <TarjetaCapacidad key={c.id} c={c} />)}
                </div>
            </section>

            {/* 2. Probar */}
            <section>
                <Titulo n={2} titulo="Probar en las cámaras"
                    ayuda="Saca el cuadro de este momento de una cámara y le pide al detector que diga qué ve. Las clases apagadas en la lista de abajo no se dibujan." />
                <div className="rounded-[10px] border border-border bg-card">
                    <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1 flex-wrap">
                            {estado.camaras.map((c) => (
                                <button key={c.id} type="button" onClick={() => setCamara(c.id)}
                                    className={cn("h-8 px-3 rounded-full text-[12px] font-semibold border transition-colors inline-flex items-center gap-1.5",
                                        camara === c.id ? "bg-[var(--accion)] text-[var(--accion-texto)] border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                                    <Camera size={12} /> {c.name}
                                    {escaneo[c.id] && "objetos" in escaneo[c.id] && (
                                        <span className="tabular-nums opacity-80">· {(escaneo[c.id] as Prueba).objetos.filter((o) => prendidas[o.clase]).length}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <div className="flex items-center h-8 rounded-lg bg-muted/60 p-0.5" title="Confianza mínima para mostrar un objeto">
                                {UMBRALES.map((u) => (
                                    <button key={u} type="button" onClick={() => setUmbral(u)}
                                        className={cn("h-7 px-2.5 rounded-md text-[12px] font-semibold tabular-nums", umbral === u ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                        ≥ {pct(u)}
                                    </button>
                                ))}
                            </div>
                            <Button variant="outline" onClick={escanearTodas} disabled={!s || !!escaneando || probando}>
                                {escaneando ? <><Loader2 size={14} className="animate-spin" /> {escaneando.hechas} de {escaneando.total}</> : <><RefreshCw size={14} /> Todas las cámaras</>}
                            </Button>
                            <Button onClick={analizar} disabled={!s || !camara || probando || !!escaneando}>
                                {probando ? <Loader2 size={14} className="animate-spin" /> : <ScanEye size={14} />} Analizar ahora
                            </Button>
                        </div>
                    </div>
                    <ResultadoPrueba prueba={prueba} probando={probando} error={errorPrueba} prendidas={prendidas} alAbrirClase={(c) => setClaseAbierta(CLASE_POR_NOMBRE[c] || null)} sinServicio={!s} />
                </div>
            </section>

            {/* 3. Analíticas */}
            <section>
                <Titulo n={3} titulo="Analíticas de OmniAccess"
                    ayuda="Lo que se construye encima del detector, por modo. Prenderla guarda la decisión; las que todavía no corren lo dicen al lado del interruptor." />
                <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
                    {ANALITICAS.map((a) => (
                        <FilaAnalitica key={a.id} a={a} prendida={!!estado.analiticas[a.id]}
                            alCambiar={(v) => guardar("analitica", a.id, v)} alAbrir={() => setAnaliticaAbierta(a)} />
                    ))}
                </div>
            </section>

            {/* 4. Clases */}
            <section>
                <Titulo n={4} titulo={`Qué reconoce: ${CLASES.length} clases`}
                    ayuda="Las clases COCO, las mismas para YOLO26 y para RF-DETR. Vienen prendidas las que le sirven a un barrio; las apagadas no se dibujan en la prueba." />
                <Filtros className="mb-3" busqueda={busqueda} alBuscar={setBusqueda} placeholder="Buscar una clase"
                    grupos={[
                        { clave: "grupo", titulo: "Grupo", valor: grupo, alElegir: (v) => setGrupo(v as any), opciones: [{ valor: "todos", rotulo: "Todas", cuenta: CLASES.length }, ...GRUPOS.map((g) => ({ valor: g.id, rotulo: g.corto, cuenta: CLASES.filter((c) => c.grupo === g.id).length }))] },
                        { clave: "mostrar", titulo: "Mostrar", valor: mostrar, alElegir: (v) => setMostrar(v as any), opciones: [
                            { valor: "todas", rotulo: "Todas" },
                            { valor: "prendidas", rotulo: "Prendidas", cuenta: CLASES.filter((c) => prendidas[c.clase]).length },
                            { valor: "vistas", rotulo: "Vistas ahora", cuenta: Object.keys(vistos).length },
                        ] },
                    ]} />
                {clasesFiltradas.length === 0 ? (
                    <div className="rounded-[10px] border border-border bg-card p-8 text-center text-[13px] text-muted-foreground">
                        {mostrar === "vistas" ? "Todavía no se vio nada: probá una cámara o «Todas las cámaras»." : "Ninguna clase coincide con el filtro."}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {clasesFiltradas.map((c) => (
                            <TarjetaClase key={c.clase} c={c} prendida={!!prendidas[c.clase]} vistos={vistos[c.clase]?.length || 0}
                                alCambiar={(v) => guardar("clase", c.clase, v)} alAbrir={() => setClaseAbierta(c)} />
                        ))}
                    </div>
                )}
            </section>

            {/* Fichas */}
            <Cajon open={!!claseAbierta} onOpenChange={(o) => { if (!o) setClaseAbierta(null); }}>
                {claseAbierta && (
                    <CajonContenido ancho="intermedio" titulo={claseAbierta.nombre} descripcion={`Clase COCO «${claseAbierta.clase}» · ${GRUPOS.find((g) => g.id === claseAbierta.grupo)?.nombre}`}>
                        <FichaClase c={claseAbierta} prendida={!!prendidas[claseAbierta.clase]} vistos={vistos[claseAbierta.clase] || []}
                            alCambiar={(v) => guardar("clase", claseAbierta.clase, v)}
                            alAbrirAnalitica={(a) => { setClaseAbierta(null); setAnaliticaAbierta(a); }} />
                    </CajonContenido>
                )}
            </Cajon>
            <Cajon open={!!analiticaAbierta} onOpenChange={(o) => { if (!o) setAnaliticaAbierta(null); }}>
                {analiticaAbierta && (
                    <CajonContenido ancho="intermedio" titulo={analiticaAbierta.nombre} descripcion={`Modo ${analiticaAbierta.modo}${analiticaAbierta.fase ? ` · fase ${analiticaAbierta.fase} del plan` : ""}`}>
                        <FichaAnalitica a={analiticaAbierta} prendida={!!estado.analiticas[analiticaAbierta.id]} prendidas={prendidas}
                            alCambiar={(v) => guardar("analitica", analiticaAbierta.id, v)}
                            alAbrirClase={(c) => { setAnaliticaAbierta(null); setClaseAbierta(c); }} />
                    </CajonContenido>
                )}
            </Cajon>
        </div>
    );
}

/* ───────────────────────── piezas ───────────────────────── */

function Titulo({ n, titulo, ayuda }: { n: number; titulo: string; ayuda: string }) {
    return (
        <div className="mb-3">
            <h2 className="text-[15px] font-bold tracking-tight flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] tabular-nums">{n}</span>{titulo}
            </h2>
            <p className="text-[12px] text-muted-foreground mt-1 max-w-3xl">{ayuda}</p>
        </div>
    );
}

function Cifra({ v, l }: { v: number | string; l: string }) {
    return (
        <div className="rounded-md bg-muted px-3 py-2">
            <div className="text-[17px] font-bold tabular-nums leading-none">{v}</div>
            <div className="text-[11px] text-muted-foreground mt-1 leading-tight">{l}</div>
        </div>
    );
}

function TarjetaCapacidad({ c }: { c: Capacidad }) {
    const t = TONO_CAPACIDAD[c.estado];
    return (
        <div className={cn("rounded-[10px] border border-border bg-card p-4 flex flex-col gap-2", c.estado === "no-aplica" && "opacity-70")}>
            <div className="flex items-start gap-3">
                <span className={cn("grid h-10 w-10 place-items-center rounded-full shrink-0", c.estado === "corre" ? "bg-[var(--bien-suave)] text-[var(--bien-texto)]" : "bg-muted")}><Ic n={c.icono} size={19} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap"><h3 className="text-[14px] font-bold">{c.nombre}</h3><Chip tono={t.tono}>{t.texto}</Chip></div>
                    <p className="text-[12.5px] mt-1 leading-snug">{c.queEs}</p>
                </div>
            </div>
            <p className="text-[12px] text-muted-foreground leading-snug"><b className="text-foreground/80 font-semibold">Para qué:</b> {c.paraQue}</p>
            <p className="text-[12px] text-muted-foreground leading-snug mt-auto pt-1 border-t border-border"><b className="text-foreground/80 font-semibold">Acá:</b> {c.libre}</p>
        </div>
    );
}

/** La foto analizada con las cajas encima, y la lista de lo visto. */
function ResultadoPrueba({ prueba, probando, error, prendidas, alAbrirClase, sinServicio }: {
    prueba: Prueba | null; probando: boolean; error: string | null; prendidas: Record<string, boolean>;
    alAbrirClase: (c: string) => void; sinServicio: boolean;
}) {
    if (sinServicio) return <div className="p-8 text-center text-[13px] text-muted-foreground">omni-vision no está contestando: no se puede probar.</div>;
    if (error) return <div className="p-6"><ErrorEstado titulo="No se pudo analizar" mensaje={error} /></div>;
    if (!prueba) return (
        <div className="p-10 text-center text-[13px] text-muted-foreground">
            {probando ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Sacando un cuadro y analizándolo…</span> : "Elegí una cámara y apretá «Analizar ahora»."}
        </div>
    );
    const visibles = prueba.objetos.filter((o) => prendidas[o.clase]);
    const ocultos = prueba.objetos.length - visibles.length;
    return (
        <div className="grid lg:grid-cols-[1fr_320px]">
            <div className="p-3 min-w-0">
                {/* Topada de alto: a lo ancho de la pantalla, una foto 4:3 empujaba todo lo demás una pantalla entera hacia abajo. */}
                <div className="relative rounded-md overflow-hidden bg-black mx-auto w-full" style={{ aspectRatio: `${prueba.ancho} / ${prueba.alto}`, maxWidth: Math.round(ALTO_MAX_FOTO * prueba.ancho / prueba.alto) }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={prueba.imagen} alt={`Cuadro de ${prueba.camara.name}`} className={cn("absolute inset-0 w-full h-full object-contain", probando && "opacity-60")} />
                    {visibles.map((o, i) => {
                        const [x1, y1, x2, y2] = o.caja_norm;
                        return (
                            <button key={i} type="button" onClick={() => alAbrirClase(o.clase)}
                                className="absolute border-2 border-[var(--accion-en-oscuro)] rounded-[3px] hover:bg-white/10 text-left"
                                style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}>
                                <span className="absolute -top-[19px] left-[-2px] px-1.5 py-[1px] rounded-[3px] bg-[var(--accion-en-oscuro)] text-black text-[11px] font-bold whitespace-nowrap tabular-nums">
                                    {o.nombre} {pct(o.confianza)}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-2 text-[11.5px] text-muted-foreground tabular-nums flex flex-wrap gap-x-3">
                    <span>{prueba.camara.name} · {horaCorta(prueba.instante)}</span>
                    <span>{prueba.ancho}×{prueba.alto} ({prueba.fuente === "sub" ? "substream" : "stream principal"})</span>
                    <span>cuadro {prueba.ms_cuadro} ms · detector {prueba.ms_inferencia} ms</span>
                    <span>{prueba.modelo} · umbral {pct(prueba.umbral)}</span>
                </div>
            </div>
            <div className="border-t lg:border-t-0 lg:border-l border-border p-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Qué vio</div>
                {visibles.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">Nada sobre el umbral entre las clases prendidas.</p>
                ) : (
                    <ul className="space-y-1">
                        {visibles.map((o, i) => {
                            const c = CLASE_POR_NOMBRE[o.clase];
                            return (
                                <li key={i}>
                                    <button type="button" onClick={() => alAbrirClase(o.clase)} className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted text-left">
                                        <span className="grid h-7 w-7 place-items-center rounded-full bg-muted shrink-0"><Ic n={c?.icono || "ScanSearch"} size={14} /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[13px] font-semibold leading-tight">{c?.nombre || o.nombre}</span>
                                            {o.alternativa && <span className="block text-[11px] text-muted-foreground leading-tight">o {o.alternativa.nombre} ({pct(o.alternativa.confianza)})</span>}
                                        </span>
                                        <span className="text-[12px] font-bold tabular-nums">{pct(o.confianza)}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {ocultos > 0 && (
                    <p className="mt-3 text-[11.5px] text-muted-foreground flex items-start gap-1.5">
                        <EyeOff size={12} className="mt-0.5 shrink-0" />
                        {ocultos === 1 ? "1 objeto oculto" : `${ocultos} objetos ocultos`} por ser de clases apagadas: {[...new Set(prueba.objetos.filter((o) => !prendidas[o.clase]).map((o) => CLASE_POR_NOMBRE[o.clase]?.nombre || o.nombre))].join(", ")}.
                    </p>
                )}
            </div>
        </div>
    );
}

function NotaNoCorre({ a, prendida }: { a: Analitica; prendida: boolean }) {
    if (a.estado === "corre") return null;
    return (
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {prendida ? "prendida · todavía no corre" : "apagada"}
        </span>
    );
}

function FilaAnalitica({ a, prendida, alCambiar, alAbrir }: { a: Analitica; prendida: boolean; alCambiar: (v: boolean) => void; alAbrir: () => void }) {
    const t = TONO_ANALITICA[a.estado];
    return (
        <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
            <button type="button" onClick={alAbrir} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                <span className={cn("grid h-9 w-9 place-items-center rounded-full shrink-0", prendida ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-[var(--accion)]" : "bg-muted text-muted-foreground")}><Ic n={a.icono} size={17} /></span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-bold">{a.nombre}</span>
                        <span className="text-[11px] text-muted-foreground">{a.modo}</span>
                        <Chip tono={t.tono}>{t.texto}{a.fase ? ` · fase ${a.fase}` : ""}</Chip>
                    </span>
                    <span className="block text-[12px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{a.queHace}</span>
                </span>
            </button>
            <NotaNoCorre a={a} prendida={prendida} />
            {a.id === "prueba"
                ? <span className="text-[11px] text-muted-foreground w-8 text-center">—</span>
                : <Switch checked={prendida} onCheckedChange={alCambiar} aria-label={`${prendida ? "Apagar" : "Prender"} ${a.nombre}`} />}
        </div>
    );
}

function TarjetaClase({ c, prendida, vistos, alCambiar, alAbrir }: { c: Clase; prendida: boolean; vistos: number; alCambiar: (v: boolean) => void; alAbrir: () => void }) {
    return (
        <div className={cn("rounded-[10px] border bg-card p-3 flex items-center gap-2.5 transition-colors", prendida ? "border-border" : "border-border/60 opacity-60")}>
            <button type="button" onClick={alAbrir} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                <span className={cn("relative grid h-9 w-9 place-items-center rounded-full shrink-0", c.relevancia === "clave" ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-[var(--accion)]" : "bg-muted")}>
                    <Ic n={c.icono} size={17} />
                    {vistos > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--bien)] text-white text-[10px] font-bold grid place-items-center tabular-nums" title={`Visto ahora ${vistos} ${vistos === 1 ? "vez" : "veces"}`}>{vistos}</span>}
                </span>
                <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-tight truncate">{c.nombre}</span>
                    <span className="block text-[11px] text-muted-foreground leading-tight truncate">{RELEVANCIA[c.relevancia]} · {c.clase}</span>
                </span>
            </button>
            <Switch checked={prendida} onCheckedChange={alCambiar} aria-label={`${prendida ? "Apagar" : "Prender"} ${c.nombre}`} />
        </div>
    );
}

/** Un recorte de la foto analizada, sin canvas: la misma imagen como fondo, escalada y corrida. */
function Recorte({ imagen, caja, alto = 96 }: { imagen: string; caja: [number, number, number, number]; alto?: number }) {
    const [x1, y1, x2, y2] = caja;
    const w = Math.max(0.02, x2 - x1), h = Math.max(0.02, y2 - y1);
    const ancho = Math.round(alto * Math.min(2.5, Math.max(0.4, w / h * 16 / 9)));
    return (
        <div className="rounded-md bg-black shrink-0" style={{
            width: ancho, height: alto, backgroundImage: `url(${imagen})`, backgroundRepeat: "no-repeat",
            backgroundSize: `${100 / w}% ${100 / h}%`,
            backgroundPosition: `${w >= 1 ? 0 : (x1 / (1 - w)) * 100}% ${h >= 1 ? 0 : (y1 / (1 - h)) * 100}%`,
        }} />
    );
}

function FichaClase({ c, prendida, vistos, alCambiar, alAbrirAnalitica }: {
    c: Clase; prendida: boolean; vistos: Visto[]; alCambiar: (v: boolean) => void; alAbrirAnalitica: (a: Analitica) => void;
}) {
    const usan = ANALITICAS.filter((a) => a.clases.includes(c.clase));
    return (
        <>
            <CajonSeccion titulo="" compacta>
                <div className="flex items-center gap-4">
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-muted shrink-0"><Ic n={c.icono} size={30} /></span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Chip tono={c.relevancia === "clave" ? "info" : "quieto"}>{RELEVANCIA[c.relevancia]}</Chip>
                            <span className="text-[12px] text-muted-foreground">{GRUPOS.find((g) => g.id === c.grupo)?.nombre}</span>
                        </div>
                        {c.nota && <p className="text-[13px] mt-2 leading-snug">{c.nota}</p>}
                    </div>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2.5 cursor-pointer">
                    <span>
                        <span className="block text-[13px] font-semibold">{prendida ? "Prendida" : "Apagada"}</span>
                        <span className="block text-[11.5px] text-muted-foreground">Apagada, no se dibuja en la prueba y las analíticas no la van a tener en cuenta.</span>
                    </span>
                    <Switch checked={prendida} onCheckedChange={alCambiar} />
                </label>
            </CajonSeccion>
            <CajonSeccion titulo="Visto ahora" icono={ScanEye} compacta
                ayuda={vistos.length ? "En la última pasada por las cámaras de esta pantalla." : undefined}>
                {vistos.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">No apareció en las cámaras analizadas. Probá «Todas las cámaras» para mirar el barrio entero.</p>
                ) : (
                    <div className="flex flex-wrap gap-3">
                        {vistos.slice(0, 12).map((v, i) => (
                            <div key={i} className="flex flex-col gap-1">
                                <Recorte imagen={v.imagen} caja={v.objeto.caja_norm} />
                                <span className="text-[11px] leading-tight"><b className="tabular-nums">{pct(v.objeto.confianza)}</b> · {v.camara.name}</span>
                            </div>
                        ))}
                    </div>
                )}
            </CajonSeccion>
            <CajonSeccion titulo="La usan" icono={Layers} compacta>
                {usan.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">Ninguna analítica de OmniAccess la usa: queda disponible para la búsqueda y para reglas futuras.</p>
                ) : (
                    <div className="space-y-1">
                        {usan.map((a) => (
                            <button key={a.id} type="button" onClick={() => alAbrirAnalitica(a)} className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted text-left">
                                <Ic n={a.icono} size={15} className="text-muted-foreground" />
                                <span className="text-[13px] font-semibold flex-1">{a.nombre}</span>
                                <Chip tono={TONO_ANALITICA[a.estado].tono}>{TONO_ANALITICA[a.estado].texto}</Chip>
                            </button>
                        ))}
                    </div>
                )}
            </CajonSeccion>
        </>
    );
}

function FichaAnalitica({ a, prendida, prendidas, alCambiar, alAbrirClase }: {
    a: Analitica; prendida: boolean; prendidas: Record<string, boolean>; alCambiar: (v: boolean) => void; alAbrirClase: (c: Clase) => void;
}) {
    const t = TONO_ANALITICA[a.estado];
    const caps = CAPACIDADES.filter((c) => a.necesita.includes(c.id));
    return (
        <>
            <CajonSeccion titulo="" compacta>
                <div className="flex items-start gap-4">
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-muted shrink-0"><Ic n={a.icono} size={30} /></span>
                    <div className="min-w-0 flex-1">
                        <Chip tono={t.tono}>{t.texto}{a.fase ? ` · fase ${a.fase}` : ""}</Chip>
                        <p className="text-[13px] mt-2 leading-snug">{a.queHace}</p>
                        {a.limite && <p className="text-[12px] text-muted-foreground mt-2 flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" /> {a.limite}</p>}
                    </div>
                </div>
                {a.id !== "prueba" && (
                    <label className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2.5 cursor-pointer">
                        <span>
                            <span className="block text-[13px] font-semibold">{prendida ? "Prendida" : "Apagada"}</span>
                            <span className="block text-[11.5px] text-muted-foreground">
                                {a.estado === "corre" ? "Corre ahora." : "Todavía no corre: se guarda la decisión y se aplica el día que esta analítica exista."}
                            </span>
                        </span>
                        <Switch checked={prendida} onCheckedChange={alCambiar} />
                    </label>
                )}
            </CajonSeccion>
            <CajonSeccion titulo="Necesita" icono={Cpu} compacta>
                <div className="space-y-1.5">
                    {caps.map((c) => (
                        <div key={c.id} className="flex items-center gap-2.5">
                            <Ic n={c.icono} size={15} className="text-muted-foreground" />
                            <span className="text-[13px] font-semibold flex-1">{c.nombre}</span>
                            <Chip tono={TONO_CAPACIDAD[c.estado].tono}>{TONO_CAPACIDAD[c.estado].texto}</Chip>
                        </div>
                    ))}
                </div>
            </CajonSeccion>
            {a.clases.length > 0 && (
                <CajonSeccion titulo="Mira estas clases" icono={ScanSearch} compacta>
                    <div className="flex flex-wrap gap-1.5">
                        {a.clases.map((n) => {
                            const c = CLASE_POR_NOMBRE[n];
                            if (!c) return null;
                            return (
                                <button key={n} type="button" onClick={() => alAbrirClase(c)}
                                    className={cn("inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-[12px] font-semibold hover:bg-muted", prendidas[n] ? "border-border" : "border-dashed border-border text-muted-foreground")}>
                                    <Ic n={c.icono} size={13} /> {c.nombre}{!prendidas[n] && " (apagada)"}
                                </button>
                            );
                        })}
                    </div>
                </CajonSeccion>
            )}
        </>
    );
}
