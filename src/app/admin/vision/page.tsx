"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ScanEye, ScanSearch, Shapes, PersonStanding, Waypoints, Tag, Sparkles, Move, User, Users, Car, PawPrint, Backpack,
    TrafficCone, Sofa, Utensils, Volleyball, Truck, Bike, Bus, TrainFront, Sailboat, Plane, Dog, Cat, Bird, Briefcase,
    Luggage, Umbrella, Smartphone, Shirt, Laptop, Book, Scissors, Baby, Fan, Brush, Octagon, FireExtinguisher,
    ParkingMeter, Armchair, Flower2, Bed, Table, Toilet, Tv, TvMinimal, Mouse, Keyboard, Microwave, CookingPot, Bath,
    Refrigerator, Clock, Flower, Milk, Wine, Coffee, UtensilsCrossed, Soup, Banana, Apple, Sandwich, Citrus, Salad,
    Carrot, Pizza, Donut, Cake, Footprints, MountainSnow, Wind, Trophy, Hand, Waves, ShieldCheck, ScanLine, Layers, Radio,
    Type, MessageSquareText, ListVideo, Spline, PackageMinus, ArrowLeftRight, Timer, Flame, HardHat, TriangleAlert, Gauge,
    Cpu, Loader2, Camera, RefreshCw, EyeOff, FlaskConical, Info, Square, Play, type LucideIcon,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import {
    CAPACIDADES, CLASES, GRUPOS, ANALITICAS, CLASE_POR_NOMBRE, TAREA_DE_CAPACIDAD, ESQUELETO, PUNTOS_POSE,
    type Capacidad, type Clase, type Analitica, type EstadoCapacidad, type EstadoAnalitica, type Grupo,
} from "@/lib/vision-catalogo";
import type { SaludVision, ObjetoVisto, TareaVision, TextoLeido } from "@/lib/vision";
import { TAREAS_VISION } from "@/lib/vision-tareas";
import { Pista } from "@/components/ui/pista";

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
    Type, MessageSquareText, ListVideo, Spline, PackageMinus, ArrowLeftRight, Timer, Flame, HardHat, TriangleAlert, Gauge,
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
/**
 * Cuántos cuadros toma "Seguir": a ~2 por segundo son unos 8 s. Cada cuadro viaja entero al
 * navegador (para dibujar sobre el mismo que vio el detector), así que no se hace eterno.
 */
const SEGUIR_CUADROS = 16;
/** Cada vuelta del seguimiento dura al menos esto, para no pedirle a go2rtc más de 2 cuadros por segundo. */
const SEGUIR_PASO_MS = 500;
/**
 * «En vivo»: el laboratorio analiza la cámara elegida sin parar, con lo que esté elegido en la
 * barra (cajas, siluetas o pose; atributos; texto) y con seguimiento. Pedido de Nico (9/10):
 * probar live sin apretar «Seguir» cada 8 s.
 *  · Ritmo: como mucho 2 cuadros por segundo (go2rtc y la GPU son compartidos); con texto o
 *    siluetas va más lento solo, porque espera cada respuesta antes de pedir la siguiente.
 *  · Se pausa con la pestaña oculta: nadie mira y la GPU es de omni-lpr también.
 *  · Se corta solo a los 30 min: un laboratorio olvidado abierto no puede quedar pidiendo toda la noche.
 *  · Del recorrido se guardan los últimos puntos de cada pista y las pistas que no se ven hace
 *    un rato se borran, para que el dibujo no se vuelva una maraña.
 */
const VIVO_PASO_MS = 500;
const VIVO_MAX_MS = 30 * 60_000;
const VIVO_PUNTOS = 40;
const VIVO_OLVIDO_MS = 10_000;
/** Un punto de la pose con menos visibilidad que esto no se dibuja. */
const PUNTO_VISIBLE = 0.3;
const TAREAS: { id: TareaVision; rotulo: string; ayuda: string }[] = [
    { id: "detectar", rotulo: "Cajas", ayuda: "Detección: qué hay y dónde (RF-DETR Small)." },
    { id: "segmentar", rotulo: "Siluetas", ayuda: "Segmentación: la silueta exacta de cada objeto (RF-DETR Seg)." },
    { id: "pose", rotulo: "Pose", ayuda: "Los 17 puntos del cuerpo de cada persona y su postura (RF-DETR Keypoint)." },
];

const TONO_CAPACIDAD: Record<EstadoCapacidad, { tono: "bien" | "info" | "aviso" | "quieto"; texto: string }> = {
    corre: { tono: "bien", texto: "Corre hoy" },
    libre: { tono: "info", texto: "Libre · sin instalar" },
    pesado: { tono: "aviso", texto: "Libre · pesado" },
    "no-aplica": { tono: "quieto", texto: "No aplica" },
};
const TONO_ANALITICA: Record<EstadoAnalitica, { tono: "bien" | "info" | "quieto" | "aviso"; texto: string }> = {
    corre: { tono: "bien", texto: "Corre" },
    desarrollo: { tono: "info", texto: "En desarrollo" },
    posible: { tono: "quieto", texto: "Posible" },
    entrenar: { tono: "aviso", texto: "Hay que entrenar" },
};
const RELEVANCIA: Record<Clase["relevancia"], string> = { clave: "Clave", util: "Útil", poco: "Poco útil" };

type Camara = { id: string; name: string; deviceType: string };
type Estado = {
    salud: SaludVision | null; latencia: number; error?: string;
    analiticas: Record<string, boolean>; clases: Record<string, boolean>; camaras: Camara[];
    /** Lo guardado (Setting VISION_TAREAS): es la verdad, aunque omni-vision tarde en enterarse. */
    tareasApagadas?: string[];
};
type Prueba = {
    camara: { id: string; name: string }; fuente: string; ms_cuadro: number; ancho: number; alto: number;
    ms_inferencia: number; ms: number; modelo: string; umbral: number; objetos: ObjetoVisto[]; imagen: string; instante: string;
    tarea?: TareaVision; pasos?: Record<string, number>; seguimiento?: { cuadro: number; pistas_vistas: number } | null;
    textos?: TextoLeido[];
};
/** El recorrido de cada pista durante "Seguir": puntos de apoyo (pie de la caja), normalizados. */
type Recorridos = Record<number, { clase: string; nombre: string; puntos: [number, number][] }>;
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
    const [tarea, setTarea] = useState<TareaVision>("detectar");
    const [conAtributos, setConAtributos] = useState(true);
    const [conTexto, setConTexto] = useState(false);
    const [siguiendo, setSiguiendo] = useState<{ cuadro: number } | null>(null);
    const [recorridos, setRecorridos] = useState<Recorridos | null>(null);
    const pararSeguir = useRef(false);
    const [vivo, setVivo] = useState<{ cuadros: number; desde: number; ms: number | null } | null>(null);
    const pararVivo = useRef(false);
    // El bucle lee lo elegido en cada vuelta: cambiar de cámara, de tarea o de umbral se nota sin cortar.
    const elegido = useRef({ camara, tarea, conAtributos, conTexto, umbral });
    useEffect(() => { elegido.current = { camara, tarea, conAtributos, conTexto, umbral }; }, [camara, tarea, conAtributos, conTexto, umbral]);
    const seccionPrueba = useRef<HTMLElement>(null);

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

    /** Prende o apaga una tarea de omni-vision. Guardado y aplicado son dos cosas: se dice si falta lo segundo. */
    async function guardarTarea(t: string, activa: boolean) {
        if (!estado) return;
        const antes = estado.tareasApagadas || [];
        const nuevas = activa ? antes.filter((x) => x !== t) : [...new Set([...antes, t])];
        setEstado({ ...estado, tareasApagadas: nuevas });
        try {
            const r = await fetch("/api/vision/tareas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tarea: t, activa }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setEstado((e) => (e ? { ...e, tareasApagadas: j.tareasApagadas } : e));
            if (!j.aplicada) toast.warning({ title: "Guardado, sin aplicar todavía", description: "omni-vision no contestó: se lo vuelve a mandar vision-worker en su próxima vuelta." });
            cargar();
        } catch (e: any) {
            setEstado((x) => (x ? { ...x, tareasApagadas: antes } : x));
            toast.error({ title: "No se guardó", description: e?.message });
        }
    }

    /** `op` pisa lo elegido en la barra: lo usa el botón "Probar" de cada tarjeta, que cambia la barra y corre en el mismo clic. */
    async function probarCamara(id: string, sesion?: string, op?: { tarea?: TareaVision; atributos?: boolean; texto?: boolean; umbral?: number; todo?: boolean }): Promise<Prueba> {
        const t = op?.tarea ?? tarea, a = op?.atributos ?? conAtributos, x = op?.texto ?? conTexto;
        // «Seguir» usa la detección sola (necesita ritmo); «En vivo» (`todo`) usa lo elegido, con seguimiento.
        const completo = !sesion || !!op?.todo;
        const q = new URLSearchParams({ camara: id, umbral: String(op?.umbral ?? umbral), tarea: completo ? t : "detectar" });
        if (a && completo) q.set("atributos", "1");
        if (x && completo) q.set("texto", "1");
        if (sesion) q.set("sesion", sesion);
        const r = await fetch(`/api/vision/probar?${q}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
        return j as Prueba;
    }

    async function analizar(op?: { tarea?: TareaVision; atributos?: boolean; texto?: boolean }) {
        if (!camara) return;
        setProbando(true); setErrorPrueba(null); setRecorridos(null);
        try { const p = await probarCamara(camara, undefined, op); setPrueba(p); setEscaneo((s) => ({ ...s, [camara]: p })); }
        catch (e: any) { setErrorPrueba(e?.message || "falló"); }
        finally { setProbando(false); }
    }

    /**
     * Seguir: cuadros seguidos de la misma cámara, con una sesión de seguimiento propia (una por
     * pasada, así los números arrancan de cero). Se dibuja el recorrido del pie de cada caja.
     * Usa la detección sola: las siluetas o la pose en cada cuadro bajarían el ritmo y el
     * seguimiento necesita cuadros seguidos.
     */
    async function seguir() {
        if (siguiendo) { pararSeguir.current = true; return; }
        if (!camara) return;
        pararSeguir.current = false;
        const sesion = `lab-${Date.now().toString(36)}`;
        const rec: Recorridos = {};
        setRecorridos({}); setErrorPrueba(null);
        try {
            for (let i = 0; i < SEGUIR_CUADROS && !pararSeguir.current && !cancelado.current; i++) {
                setSiguiendo({ cuadro: i + 1 });
                const t0 = Date.now();
                const p = await probarCamara(camara, sesion);
                for (const o of p.objetos) {
                    if (o.pista == null) continue;
                    const [x1, , x2, y2] = o.caja_norm;
                    (rec[o.pista] ||= { clase: o.clase, nombre: o.nombre, puntos: [] }).puntos.push([(x1 + x2) / 2, y2]);
                }
                setPrueba(p); setRecorridos({ ...rec });
                const resto = SEGUIR_PASO_MS - (Date.now() - t0);
                if (resto > 0) await new Promise((r) => setTimeout(r, resto));
            }
        } catch (e: any) { setErrorPrueba(e?.message || "falló"); }
        finally { setSiguiendo(null); }
    }

    /** En vivo: ver el comentario de VIVO_PASO_MS. Un segundo toque lo para. */
    async function alternarVivo() {
        if (vivo) { pararVivo.current = true; return; }
        if (!camara) return;
        pararVivo.current = false;
        const inicio = Date.now();
        let camaraSesion = "", sesion = "", rec: Recorridos = {}, vistoPorPista: Record<number, number> = {}, cuadros = 0;
        setErrorPrueba(null); setVivo({ cuadros: 0, desde: inicio, ms: null });
        try {
            while (!pararVivo.current && !cancelado.current && Date.now() - inicio < VIVO_MAX_MS) {
                if (document.hidden) { await new Promise((r) => setTimeout(r, 1000)); continue; }
                const el = elegido.current;
                if (!el.camara) break;
                // Otra cámara: sesión de seguimiento nueva, recorridos de cero.
                if (el.camara !== camaraSesion) { camaraSesion = el.camara; sesion = `vivo-${Date.now().toString(36)}`; rec = {}; vistoPorPista = {}; setRecorridos({}); }
                const t0 = Date.now();
                try {
                    const p = await probarCamara(el.camara, sesion, { tarea: el.tarea, atributos: el.conAtributos, texto: el.conTexto, umbral: el.umbral, todo: true });
                    for (const o of p.objetos) {
                        if (o.pista == null) continue;
                        const [x1, , x2, y2] = o.caja_norm;
                        const r = (rec[o.pista] ||= { clase: o.clase, nombre: o.nombre, puntos: [] });
                        r.puntos = [...r.puntos, [(x1 + x2) / 2, y2] as [number, number]].slice(-VIVO_PUNTOS);
                        vistoPorPista[o.pista] = Date.now();
                    }
                    for (const k of Object.keys(rec).map(Number)) if (Date.now() - (vistoPorPista[k] || 0) > VIVO_OLVIDO_MS) { delete rec[k]; delete vistoPorPista[k]; }
                    cuadros++;
                    setPrueba(p); setRecorridos({ ...rec }); setErrorPrueba(null);
                    setVivo({ cuadros, desde: inicio, ms: Date.now() - t0 });
                } catch (e: any) {
                    // Un cuadro que falla no corta el vivo (la cámara pudo tardar): se dice y se sigue.
                    setErrorPrueba(e?.message || "falló");
                    await new Promise((r) => setTimeout(r, 2000));
                }
                const resto = VIVO_PASO_MS - (Date.now() - t0);
                if (resto > 0) await new Promise((r) => setTimeout(r, resto));
            }
            if (Date.now() - inicio >= VIVO_MAX_MS) toast.info({ title: "En vivo se detuvo", description: "Pasaron 30 minutos. Volvé a prenderlo si lo seguís mirando." });
        } finally { setVivo(null); }
    }

    /** Desde una tarjeta de "Qué puede hacer": deja la prueba lista para esa tarea y la corre. */
    function probarCapacidad(id: string) {
        const t = TAREA_DE_CAPACIDAD[id];
        if (!t) return;
        seccionPrueba.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (t === "seguir") { seguir(); return; }
        const op: { tarea: TareaVision; atributos?: boolean; texto?: boolean } =
            t === "atributos" ? { tarea: "detectar", atributos: true }
                : t === "texto" ? { tarea: "detectar", texto: true }
                    : { tarea: t };
        setTarea(op.tarea);
        if (op.atributos) setConAtributos(true);
        if (op.texto) setConTexto(true);
        analizar(op);
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
    const apagadas = estado.tareasApagadas || [];
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
                        El detector de objetos que se está sumando a OmniAccess: qué puede hacer, probarlo sobre las cámaras del barrio y decidir qué analíticas se prenden. Lo que ya llega a la operación: la relectura de NO_LEIDA (monitor LPR y Control LPR) y los avisos de las reglas (sentido contrario, permanencia, aglomeración) a la guardia. Nunca decide la barrera.
                    </p>
                </div>
                <a href="/admin/vision/reglas" className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-semibold hover:bg-accent">
                    <Spline size={15} /> Reglas
                </a>
                <a href="/admin/vision/detecciones" className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-[var(--accion)] text-[var(--accion-texto)] text-[13px] font-semibold hover:opacity-90">
                    <ListVideo size={15} /> Detecciones
                </a>
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
                {s?.tareas && (
                    <div className="mt-3 overflow-x-auto">
                        {apagadas.length > 0 && (
                            <p className="mb-2 text-[11.5px] text-muted-foreground flex items-center gap-1.5"><Info size={12} />
                                {apagadas.includes("detectar") || apagadas.includes("seguimiento")
                                    ? "Con la detección o el seguimiento apagados, vision-worker no mira las cámaras: no hay registro, ni reglas, ni relectura."
                                    : `Apagadas: ${apagadas.map((t) => TAREAS_VISION[t]?.nombre || t).join(", ")}. Su memoria de la GPU quedó libre.`}
                            </p>
                        )}
                        <table className="w-full text-[12.5px]">
                            <thead>
                                <tr className="text-left text-[11px] text-muted-foreground">
                                    <th className="font-semibold py-1.5 pr-3 w-12">Activa</th><th className="font-semibold pr-3">Tarea</th><th className="font-semibold pr-3">Modelo</th><th className="font-semibold pr-3">Licencia</th>
                                    <th className="font-semibold pr-3">En la GPU</th><th className="font-semibold pr-3 text-right">Pedidos</th>
                                    <th className="font-semibold pr-3 text-right">Mediana</th><th className="font-semibold text-right">Peor 5 %</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {Object.entries(s.tareas).map(([t, v]) => {
                                    const activa = !apagadas.includes(t);
                                    // El servicio todavía no se enteró (se reinició, o no contestó al guardar).
                                    const pendiente = v.activa != null && v.activa !== activa;
                                    return (
                                        <tr key={t} className={cn(!activa && "text-muted-foreground")}>
                                            <td className="py-1.5 pr-3"><InterruptorTarea t={t} activa={activa} alCambiar={(x) => guardarTarea(t, x)} /></td>
                                            <td className="pr-3 font-semibold">{NOMBRE_TAREA[t] || t}</td>
                                            <td className="pr-3 text-muted-foreground">{v.modelo}</td>
                                            <td className="pr-3 text-muted-foreground">{v.licencia}</td>
                                            <td className="pr-3">{pendiente ? <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> aplicando…</span>
                                                : !activa ? <Chip tono="quieto">apagada</Chip>
                                                : v.abierto ? (String(v.proveedor).startsWith("CUDA") ? "cargado" : "cargado (CPU)") : <span className="text-muted-foreground">se carga al pedirla</span>}</td>
                                            <td className="pr-3 text-right tabular-nums">{v.total}</td>
                                            <td className="pr-3 text-right tabular-nums">{v.latencia_ms?.p50 != null ? `${v.latencia_ms.p50} ms` : "—"}</td>
                                            <td className="text-right tabular-nums">{v.latencia_ms?.p95 != null ? `${v.latencia_ms.p95} ms` : "—"}</td>
                                        </tr>
                                    );
                                })}
                                {s.seguimiento && (() => {
                                    const activa = !apagadas.includes("seguimiento");
                                    const pendiente = s.seguimiento.activa != null && s.seguimiento.activa !== activa;
                                    return (
                                        <tr className={cn(!activa && "text-muted-foreground")}>
                                            <td className="py-1.5 pr-3"><InterruptorTarea t="seguimiento" activa={activa} alCambiar={(x) => guardarTarea("seguimiento", x)} /></td>
                                            <td className="pr-3 font-semibold">Seguimiento</td><td className="pr-3 text-muted-foreground">ByteTrack</td><td className="pr-3 text-muted-foreground">Apache-2.0</td>
                                            <td className="pr-3 text-muted-foreground" colSpan={4}>{pendiente ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> aplicando…</span>
                                                : !activa ? <Chip tono="quieto">apagado</Chip>
                                                : <>sin modelo propio · {s.seguimiento.sesiones} {s.seguimiento.sesiones === 1 ? "sesión abierta" : "sesiones abiertas"}</>}</td>
                                        </tr>
                                    );
                                })()}
                            </tbody>
                        </table>
                        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5"><Gauge size={12} /> Tiempos de GPU medidos dentro de omni-vision, sin contar el viaje del cuadro. Todas las tareas se turnan: nunca corren dos a la vez, para no pisar a omni-lpr.</p>
                    </div>
                )}
            </section>

            {/* 1. Qué puede hacer */}
            <section>
                <Titulo n={1} titulo="Qué puede hacer un detector como YOLO"
                    ayuda="Las tareas que existen en la familia YOLO26 y, para cada una, con qué pieza libre se hace acá. YOLO26 es AGPL y servirlo pide licencia paga: no se usa." />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {CAPACIDADES.map((c) => <TarjetaCapacidad key={c.id} c={c} alProbar={s && TAREA_DE_CAPACIDAD[c.id] && c.estado === "corre" ? () => probarCapacidad(c.id) : undefined} />)}
                </div>
            </section>

            {/* 2. Probar */}
            <section ref={seccionPrueba} className="scroll-mt-4">
                <Titulo n={2} titulo="Probar en las cámaras"
                    ayuda="Saca el cuadro de este momento de una cámara y le pide al detector que diga qué ve: cajas, siluetas o la pose, con los atributos de cada objeto. «Seguir» toma cuadros seguidos y dibuja por dónde fue cada uno; «En vivo» lo hace sin parar, con lo elegido en la barra (se cambia de cámara o de tarea sin cortar). Las clases apagadas en la lista de abajo no se dibujan." />
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
                        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                            <div className="flex items-center h-8 rounded-lg bg-muted/60 p-0.5" title="Qué le pide al modelo">
                                {TAREAS.map((t) => (
                                    <button key={t.id} type="button" onClick={() => setTarea(t.id)} title={t.ayuda}
                                        className={cn("h-7 px-2.5 rounded-md text-[12px] font-semibold", tarea === t.id ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                        {t.rotulo}
                                    </button>
                                ))}
                            </div>
                            <button type="button" onClick={() => setConAtributos((v) => !v)} aria-pressed={conAtributos}
                                title="Color, carrocería, ropa, chaleco, casco, mochila (SigLIP 2)"
                                className={cn("h-8 px-3 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1.5",
                                    conAtributos ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-[var(--accion)] border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                                <Tag size={12} /> Atributos
                            </button>
                            <button type="button" onClick={() => setConTexto((v) => !v)} aria-pressed={conTexto}
                                title="Leer el texto de la imagen (RapidOCR / PP-OCR) y cruzarlo con el catálogo de empresas"
                                className={cn("h-8 px-3 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1.5",
                                    conTexto ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-[var(--accion)] border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                                <Type size={12} /> Texto
                            </button>
                            <div className="flex items-center h-8 rounded-lg bg-muted/60 p-0.5" title="Confianza mínima para mostrar un objeto">
                                {UMBRALES.map((u) => (
                                    <button key={u} type="button" onClick={() => setUmbral(u)}
                                        className={cn("h-7 px-2.5 rounded-md text-[12px] font-semibold tabular-nums", umbral === u ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                        ≥ {pct(u)}
                                    </button>
                                ))}
                            </div>
                            <Button variant={vivo ? "default" : "outline"} onClick={alternarVivo} disabled={!s || !camara || probando || !!escaneando || !!siguiendo}
                                title="Analiza la cámara elegida sin parar, con lo elegido en la barra y con seguimiento. Se pausa con la pestaña oculta y se corta a los 30 min.">
                                {vivo
                                    ? <><Square size={13} /> Parar en vivo · {vivo.cuadros}{vivo.ms != null ? ` · ${vivo.ms} ms` : ""}</>
                                    : <><Radio size={13} /> En vivo</>}
                            </Button>
                            <Button variant="outline" onClick={seguir} disabled={!s || !camara || probando || !!escaneando || !!vivo}>
                                {siguiendo ? <><Square size={13} /> Parar · {siguiendo.cuadro}/{SEGUIR_CUADROS}</> : <><Play size={13} /> Seguir 8 s</>}
                            </Button>
                            <Button variant="outline" onClick={escanearTodas} disabled={!s || !!escaneando || probando || !!siguiendo || !!vivo}>
                                {escaneando ? <><Loader2 size={14} className="animate-spin" /> {escaneando.hechas} de {escaneando.total}</> : <><RefreshCw size={14} /> Todas las cámaras</>}
                            </Button>
                            <Button onClick={() => analizar()} disabled={!s || !camara || probando || !!escaneando || !!siguiendo || !!vivo}>
                                {probando ? <Loader2 size={14} className="animate-spin" /> : <ScanEye size={14} />} Analizar ahora
                            </Button>
                        </div>
                    </div>
                    <ResultadoPrueba prueba={prueba} probando={probando || !!siguiendo || !!vivo} error={errorPrueba} prendidas={prendidas} recorridos={recorridos}
                        alAbrirClase={(c) => setClaseAbierta(CLASE_POR_NOMBRE[c] || null)} sinServicio={!s} />
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

function TarjetaCapacidad({ c, alProbar }: { c: Capacidad; alProbar?: () => void }) {
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
            <div className="mt-auto pt-1 border-t border-border flex items-end gap-3">
                <p className="text-[12px] text-muted-foreground leading-snug flex-1"><b className="text-foreground/80 font-semibold">Acá:</b> {c.libre}</p>
                {alProbar && <Button variant="outline" size="sm" onClick={alProbar} className="shrink-0"><Play size={12} /> Probar</Button>}
            </div>
        </div>
    );
}

/** Un recorrido de seguimiento: de qué pista es y por dónde pasó. */
function Recorrido({ n, r }: { n: number; r: Recorridos[number] }) {
    if (r.puntos.length === 0) return null;
    const [ux, uy] = r.puntos[r.puntos.length - 1];
    return (
        <>
            {r.puntos.length > 1 && (
                <polyline points={r.puntos.map(([x, y]) => `${x},${y}`).join(" ")} fill="none"
                    stroke="var(--aviso)" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            )}
            <circle cx={ux} cy={uy} r={0.006} fill="var(--aviso)" />
            <title>{`#${n} ${r.nombre}`}</title>
        </>
    );
}

/** La foto analizada con lo que vio el modelo encima, y la lista de lo visto. */
function ResultadoPrueba({ prueba, probando, error, prendidas, recorridos, alAbrirClase, sinServicio }: {
    prueba: Prueba | null; probando: boolean; error: string | null; prendidas: Record<string, boolean>;
    recorridos: Recorridos | null; alAbrirClase: (c: string) => void; sinServicio: boolean;
}) {
    if (sinServicio) return <div className="p-8 text-center text-[13px] text-muted-foreground">omni-vision no está contestando: no se puede probar.</div>;
    if (error) return <div className="p-6"><ErrorEstado titulo="No se pudo analizar" mensaje={error} /></div>;
    if (!prueba) return (
        <div className="p-10 text-center text-[13px] text-muted-foreground">
            {probando ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Sacando un cuadro y analizándolo… (la primera vez que se pide la pose o las siluetas, el modelo se carga en la GPU y tarda unos segundos más)</span> : "Elegí una cámara, qué pedirle, y apretá «Analizar ahora»."}
        </div>
    );
    const visibles = prueba.objetos.filter((o) => prendidas[o.clase]);
    const ocultos = prueba.objetos.length - visibles.length;
    // Los recorridos de clases apagadas tampoco se dibujan, igual que sus cajas.
    const pistas = recorridos ? Object.entries(recorridos).filter(([, r]) => prendidas[r.clase]) : [];
    return (
        <div className="grid lg:grid-cols-[1fr_340px]">
            <div className="p-3 min-w-0">
                {/* Topada de alto: a lo ancho de la pantalla, una foto 4:3 empujaba todo lo demás una pantalla entera hacia abajo. */}
                <div className="relative rounded-md overflow-hidden bg-black mx-auto w-full" style={{ aspectRatio: `${prueba.ancho} / ${prueba.alto}`, maxWidth: Math.round(ALTO_MAX_FOTO * prueba.ancho / prueba.alto) }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={prueba.imagen} alt={`Cuadro de ${prueba.camara.name}`} className={cn("absolute inset-0 w-full h-full object-contain", probando && !recorridos && "opacity-60")} />
                    {/* Siluetas, esqueletos y recorridos van en un SVG con coordenadas 0-1, estirado a la foto. */}
                    <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                        {visibles.map((o, i) => (
                            <g key={i}>
                                {o.silueta?.map((pol, k) => (
                                    <polygon key={k} points={pol.map(([x, y]) => `${x},${y}`).join(" ")}
                                        fill="color-mix(in oklab, var(--accion-en-oscuro) 30%, transparent)" stroke="var(--accion-en-oscuro)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                                ))}
                                {o.puntos && ESQUELETO.map(([a, b], k) => {
                                    const pa = o.puntos![a], pb = o.puntos![b];
                                    if (!pa || !pb || pa[2] < PUNTO_VISIBLE || pb[2] < PUNTO_VISIBLE) return null;
                                    return <line key={k} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke="var(--bien)" strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" />;
                                })}
                            </g>
                        ))}
                        {pistas.map(([n, r]) => <Recorrido key={n} n={Number(n)} r={r} />)}
                        {(prueba.textos || []).map((t, i) => (
                            <polygon key={`t${i}`} points={t.poligono.map(([x, y]) => `${x},${y}`).join(" ")} fill="none"
                                stroke={t.sobreimpreso ? "rgba(255,255,255,0.35)" : "var(--aviso)"} strokeWidth={2} strokeDasharray={t.sobreimpreso ? "4 3" : undefined} vectorEffect="non-scaling-stroke" />
                        ))}
                    </svg>
                    {/* Los puntos de la pose van en HTML: en el SVG estirado un círculo se vuelve óvalo. */}
                    {visibles.flatMap((o, i) => (o.puntos || []).map((p, k) => p[2] < PUNTO_VISIBLE ? null : (
                        <span key={`${i}-${k}`} title={PUNTOS_POSE[k]} className="absolute h-[7px] w-[7px] -ml-[3.5px] -mt-[3.5px] rounded-full bg-white ring-2 ring-[var(--bien)] pointer-events-none"
                            style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} />
                    )))}
                    {visibles.map((o, i) => {
                        const [x1, y1, x2, y2] = o.caja_norm;
                        const rotulo = `${o.pista != null ? `#${o.pista} ` : ""}${o.nombre} ${pct(o.confianza)}${o.postura ? ` · ${o.postura}` : ""}`;
                        return (
                            <button key={i} type="button" onClick={() => alAbrirClase(o.clase)}
                                className={cn("absolute rounded-[3px] hover:bg-white/10 text-left", o.silueta?.length || o.puntos ? "border border-dashed border-white/50" : "border-2 border-[var(--accion-en-oscuro)]")}
                                style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}>
                                <span className="absolute -top-[19px] left-[-2px] px-1.5 py-[1px] rounded-[3px] bg-[var(--accion-en-oscuro)] text-black text-[11px] font-bold whitespace-nowrap tabular-nums">
                                    {rotulo}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-2 text-[11.5px] text-muted-foreground tabular-nums flex flex-wrap gap-x-3">
                    <span>{prueba.camara.name} · {horaCorta(prueba.instante)}</span>
                    <span>{prueba.ancho}×{prueba.alto} ({prueba.fuente === "sub" ? "substream" : "stream principal"})</span>
                    <span>cuadro {prueba.ms_cuadro} ms</span>
                    {Object.entries(prueba.pasos || { detectar: prueba.ms_inferencia }).map(([k, v]) => <span key={k}>{NOMBRE_PASO[k] || k} {v} ms</span>)}
                    <span>{prueba.modelo} · umbral {pct(prueba.umbral)}</span>
                    {prueba.seguimiento && <span>seguimiento: cuadro {prueba.seguimiento.cuadro}, {prueba.seguimiento.pistas_vistas} pistas</span>}
                </div>
            </div>
            <div className="border-t lg:border-t-0 lg:border-l border-border p-3 min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Qué vio</div>
                {visibles.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">Nada sobre el umbral entre las clases prendidas.</p>
                ) : (
                    <ul className="space-y-1">
                        {visibles.map((o, i) => <ItemVisto key={i} o={o} alAbrir={() => alAbrirClase(o.clase)} />)}
                    </ul>
                )}
                {ocultos > 0 && (
                    <p className="mt-3 text-[11.5px] text-muted-foreground flex items-start gap-1.5">
                        <EyeOff size={12} className="mt-0.5 shrink-0" />
                        {ocultos === 1 ? "1 objeto oculto" : `${ocultos} objetos ocultos`} por ser de clases apagadas: {[...new Set(prueba.objetos.filter((o) => !prendidas[o.clase]).map((o) => CLASE_POR_NOMBRE[o.clase]?.nombre || o.nombre))].join(", ")}.
                    </p>
                )}
                {prueba.textos && <TextosLeidos textos={prueba.textos} />}
                {pistas.length > 0 && (
                    <div className="mt-4">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Recorridos</div>
                        <ul className="space-y-1 text-[12.5px]">
                            {pistas.map(([n, r]) => (
                                <li key={n} className="flex items-center gap-2">
                                    <span className="font-bold tabular-nums w-8">#{n}</span>
                                    <span className="flex-1">{r.nombre}</span>
                                    <span className="text-muted-foreground tabular-nums">{r.puntos.length} {r.puntos.length === 1 ? "cuadro" : "cuadros"}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

/** Lo leído: primero lo de la escena (con su empresa si la hay), después lo que sobreimprime la cámara. */
function TextosLeidos({ textos }: { textos: NonNullable<Prueba["textos"]> }) {
    const escena = textos.filter((t) => !t.sobreimpreso);
    const camara = textos.filter((t) => t.sobreimpreso);
    return (
        <div className="mt-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Texto leído</div>
            {escena.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Nada legible en la escena.</p> : (
                <ul className="space-y-1.5">
                    {escena.map((t, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12.5px]">
                            <Type size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                                <b className="font-semibold tracking-wide break-words">{t.texto}</b>
                                <span className="flex flex-wrap gap-1 mt-0.5">
                                    {t.tipo === "matricula" && <Chip tono="info">matrícula</Chip>}
                                    {t.dentro && <span className="text-[11px] text-muted-foreground">sobre {t.dentro.nombre}</span>}
                                    {t.empresa && <Chip tono="bien">{t.empresa.nombre}</Chip>}
                                </span>
                            </span>
                            <span className="text-[11.5px] tabular-nums text-muted-foreground">{pct(t.confianza)}</span>
                        </li>
                    ))}
                </ul>
            )}
            {camara.length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground" title={camara.map((t) => t.texto).join("\n")}>
                    + {camara.length} {camara.length === 1 ? "línea sobreimpresa" : "líneas sobreimpresas"} por la cámara (fecha, hora, datos), que no son de la escena.
                </p>
            )}
        </div>
    );
}

const NOMBRE_TAREA: Record<string, string> = Object.fromEntries(Object.entries(TAREAS_VISION).map(([k, v]) => [k, v.nombre]));

/** El interruptor de una tarea de omni-vision, con lo que se pierde al apagarla al pasar el mouse. */
function InterruptorTarea({ t, activa, alCambiar }: { t: string; activa: boolean; alCambiar: (activa: boolean) => void }) {
    const info = TAREAS_VISION[t];
    return (
        <Pista titulo={activa ? `Apagar ${info?.nombre || t}` : `Prender ${info?.nombre || t}`} texto={info?.queApaga || ""} ancho={300}>
            <span className="inline-flex"><Switch checked={activa} onCheckedChange={alCambiar} aria-label={`${activa ? "Apagar" : "Prender"} ${info?.nombre || t}`} /></span>
        </Pista>
    );
}
const NOMBRE_PASO: Record<string, string> = { detectar: "detección", segmentar: "siluetas", pose: "pose", atributos: "atributos", texto: "texto" };

/** Un objeto en la lista de la derecha: qué es, su pista, su postura y sus atributos. */
function ItemVisto({ o, alAbrir }: { o: ObjetoVisto; alAbrir: () => void }) {
    const c = CLASE_POR_NOMBRE[o.clase];
    return (
        <li className="rounded-md hover:bg-muted">
            <button type="button" onClick={alAbrir} className="w-full flex items-center gap-2.5 px-2 pt-1.5 pb-1 text-left">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-muted shrink-0"><Ic n={c?.icono || "ScanSearch"} size={14} /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-tight">{o.pista != null && <span className="tabular-nums text-muted-foreground mr-1">#{o.pista}</span>}{c?.nombre || o.nombre}</span>
                    {o.alternativa && <span className="block text-[11px] text-muted-foreground leading-tight">o {o.alternativa.nombre} ({pct(o.alternativa.confianza)})</span>}
                </span>
                <span className="text-[12px] font-bold tabular-nums">{pct(o.confianza)}</span>
            </button>
            {(o.postura !== undefined || o.area != null || o.atributos) && (
                <div className="pl-[46px] pr-2 pb-1.5 flex flex-wrap gap-1">
                    {o.postura !== undefined && (o.postura
                        ? <Chip tono={o.postura === "acostada" ? "aviso" : "neutro"} icono={PersonStanding}>{o.postura}{o.inclinacion != null ? ` · ${o.inclinacion}°` : ""}</Chip>
                        : <span className="text-[11px] text-muted-foreground">postura: {o.motivo || "no se puede decir"}</span>)}
                    {o.area != null && <span className="text-[11px] text-muted-foreground tabular-nums">ocupa {(o.area * 100).toFixed(o.area < 0.01 ? 2 : 1)} % de la imagen</span>}
                    {o.atributos?.map((a) => (
                        <span key={a.id} title={a.opciones.map((x) => `${x.valor} ${pct(x.prob)}`).join(" · ")}
                            className={cn("inline-flex items-center gap-1 h-[22px] px-2 rounded-full border text-[11px]", a.dudoso ? "border-dashed border-border text-muted-foreground" : "border-border")}>
                            <span className="text-muted-foreground">{a.nombre}:</span>
                            <b className="font-semibold">{a.dudoso ? `¿${a.valor}?` : a.valor}</b>
                            <span className="tabular-nums text-muted-foreground">{pct(a.prob)}</span>
                        </span>
                    ))}
                    {o.atributos_motivo && <span className="text-[11px] text-muted-foreground">atributos: {o.atributos_motivo}</span>}
                </div>
            )}
        </li>
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
