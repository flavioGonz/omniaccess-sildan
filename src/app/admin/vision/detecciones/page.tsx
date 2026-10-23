"use client";

import { ElegirCamara } from "@/components/devices/ElegirCamara";
import { useAreas } from "@/lib/use-areas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ListVideo, Loader2, User, Car, PawPrint, Backpack, Shapes, Sparkles, Video, Gauge, type LucideIcon, Boxes, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorEstado, Cargando, Vacio } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { pct, nombreClase } from "@/components/vision/ObjetoRegistro";
import { CajonPista } from "@/components/vision/CajonPista";
import { MosaicoBuscar, type ResultadoBusqueda as Fila } from "@/components/vision/buscar/MosaicoBuscar";
import { useRegistrarDesdeCaptura } from "@/components/vision/buscar/RegistrarDesdeCaptura";
import { useNombresPropios } from "@/lib/nombres-propios";
import { useSiluetas } from "@/lib/use-siluetas";

/**
 * Detecciones: lo que guardó el registro de OmniVision (vision-worker), en vivo.
 *
 * Desde el 15/10 (pedido de Nico: «tipo grilla bento, con todas las detecciones, similar a Buscar;
 * la tabla de cámaras parece redundante») es el mismo mosaico que Buscar y el historial: el cuadro
 * de la cámara acercado al objeto, su silueta, y lo que el historial sabe (chapa leída, dueño,
 * vigilancia, alertas). Las tarjetas de cámaras con interruptor se fueron: qué cámaras procesa
 * OmniVision y cuánto consume cada una está en Analíticas (tabla del motor), y se agregan o
 * quitan desde la pared. Acá queda un filtro por cámara.
 *
 * Una tarjeta es una PISTA, no un cuadro: una persona que cruza la cámara en 12 s es una tarjeta,
 * con su mejor foto. Se refresca cada REFRESCO_MS; lo que llega se marca un momento.
 */
type Respuesta = {
    filas: Fila[]; h: number; porPagina: number;
    porClase: { clase: string; grupo: string; n: number }[];
    porCamara: Record<string, number>;
    camaras: { id: string; name: string; deviceType: string; registra: boolean }[];
    estado: null | { t: string; activo: boolean; intervaloMs: number; cicloMs?: number | null; umbral: number; pistasAbiertas: number; retencionDias: number };
    vision: { ok: boolean; error: string | null };
};

/** Cada cuánto se vuelve a pedir la lista: la vuelta del motor anda en 4 s, más seguido no trae nada. */
const REFRESCO_MS = 6000;
/** Sin noticias del proceso durante esto, se dice que no hay señal (escribe su estado cada 15 s). */
const SIN_SENAL_MS = 60_000;
/** Cuánto dura la marca de «recién llegada». */
const NUEVA_MS = 4000;
const RANGOS = [{ v: "1", r: "1 h" }, { v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const GRUPOS: { v: string; r: string; icono: LucideIcon }[] = [
    { v: "", r: "Todo", icono: Shapes }, { v: "persona", r: "Personas", icono: User }, { v: "vehiculo", r: "Vehículos", icono: Car },
    { v: "animal", r: "Animales", icono: PawPrint }, { v: "objeto", r: "Bultos", icono: Backpack },
    // Lo que encuentra el detector propio (OmniVision › Entrenar › Objetos nuevos). Sólo se ofrece si hay.
    { v: "propio", r: "Propios", icono: Boxes },
];

export default function DeteccionesVision() {
    useNombresPropios();  // las clases del detector propio con su nombre, no «propio:…»
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [mas, setMas] = useState<Fila[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [h, setH] = useState("24");
    const [grupo, setGrupo] = useState("");
    const [camara, setCamara] = useState("");
    const areasDisp = useAreas();
    const [clase, setClase] = useState("");
    const [conRotulo, setConRotulo] = useState(false);
    const [cargandoMas, setCargandoMas] = useState(false);
    const [noHayMas, setNoHayMas] = useState(false);
    const [abierta, setAbierta] = useState<Fila | null>(null);
    const [siluetas, setSiluetas] = useSiluetas();
    const [nuevas, setNuevas] = useState<Set<string>>(new Set());
    const vistas = useRef<Set<string> | null>(null);
    const { abrirRegistro, marcarNegra, cajones } = useRegistrarDesdeCaptura();

    const consulta = useCallback((antes?: string) => {
        const q = new URLSearchParams({ h });
        if (grupo) q.set("grupo", grupo);
        if (camara) q.set("camara", camara);
        if (clase) q.set("clase", clase);
        if (conRotulo) q.set("rotulo", "1");
        if (antes) q.set("antes", antes);
        return `/api/vision/detecciones?${q}`;
    }, [h, grupo, camara, clase, conRotulo]);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch(consulta(), { cache: "no-store" });
            const j: Respuesta = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error((j as any)?.error || `El servidor respondió ${r.status}`);
            // Lo que no estaba en la vuelta anterior se marca un momento (la primera carga no).
            if (vistas.current) {
                const llegaron = j.filas.filter((f) => !vistas.current!.has(f.id)).map((f) => f.id);
                if (llegaron.length) { setNuevas(new Set(llegaron)); setTimeout(() => setNuevas(new Set()), NUEVA_MS); }
            }
            vistas.current = new Set(j.filas.map((f) => f.id));
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "sin respuesta"); }
    }, [consulta]);

    // Al cambiar un filtro se empieza de cero; la primera página se refresca sola, lo ya cargado de más no.
    useEffect(() => { setMas([]); setNoHayMas(false); vistas.current = null; cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);

    const filas = useMemo(() => {
        const ya = new Set<string>();
        return [...(datos?.filas || []), ...mas].filter((f) => (ya.has(f.id) ? false : (ya.add(f.id), true)));
    }, [datos, mas]);

    const cargarMas = useCallback(async () => {
        const ultima = filas[filas.length - 1];
        if (!ultima || cargandoMas || noHayMas) return;
        setCargandoMas(true);
        try {
            const r = await fetch(consulta(ultima.primeraVez), { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setMas((m) => [...m, ...j.filas]);
            if (j.filas.length < (datos?.porPagina || 60)) setNoHayMas(true);
        } catch { setNoHayMas(true); }
        finally { setCargandoMas(false); }
    }, [filas, cargandoMas, noHayMas, consulta, datos?.porPagina]);

    // Scroll infinito, como el historial: al asomar el final se pide más.
    const centinela = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = centinela.current;
        if (!el || !datos || filas.length < (datos.porPagina || 60)) return;
        const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) void cargarMas(); }, { rootMargin: "800px 0px" });
        io.observe(el);
        return () => io.disconnect();
    }, [cargarMas, datos, filas.length]);

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo lo que vio el detector…" /></div>;

    const est = datos.estado;
    const sinSenal = !est || Date.now() - new Date(est.t).getTime() > SIN_SENAL_MS;
    const totalRango = datos.porClase.reduce((s, x) => s + x.n, 0);
    const porGrupo = (g: string) => datos.porClase.filter((x) => !g || x.grupo === g).reduce((s, x) => s + x.n, 0);
    const camaras = datos.camaras.filter((c) => c.registra);

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><ListVideo size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Detecciones</h1>
                        {sinSenal ? <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full chip-mal text-[11.5px] font-semibold">El registro no da señal</span>
                            : est!.activo ? <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full chip-bien text-[11.5px] font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-[var(--bien)] animate-pulse" /> En vivo · {est!.pistasAbiertas} en curso</span>
                                : <span className="inline-flex items-center h-6 px-2 rounded-full chip-quieto text-[11.5px] font-semibold">Registro apagado</span>}
                        {!datos.vision.ok && <span className="inline-flex items-center h-6 px-2 rounded-full chip-mal text-[11.5px] font-semibold">omni-vision: {datos.vision.error}</span>}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug">
                        Todo lo que OmniVision vio pasar, con su mejor foto y lo que sabe el historial.
                        {est && <> Guarda desde {pct(est.umbral)} de confianza y borra a los {est.retencionDias} días.</>}
                    </p>
                </div>
                <Link href="/admin/vision/analiticas" className="h-8 px-3 rounded-md border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">
                    <Gauge size={14} /> Cámaras y consumo
                </Link>
            </div>

            {/* Filtros en una fila, como Buscar. */}
            <div className="flex items-center gap-2 flex-wrap">
                <Filtros solido grupos={[
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "grupo", titulo: "Qué", valor: grupo, alElegir: (v) => { setGrupo(v); setClase(""); }, opciones: GRUPOS.filter((g) => g.v !== "propio" || porGrupo("propio") > 0 || grupo === "propio").map((g) => ({ valor: g.v, rotulo: g.r, icono: g.icono, cuenta: porGrupo(g.v) })) },
                    { clave: "rotulo", titulo: "Rotulado", valor: conRotulo ? "si" : "", alElegir: (v) => setConRotulo(v === "si"), opciones: [{ valor: "", rotulo: "Todo" }, { valor: "si", rotulo: "Con texto leído" }] },
                ]} />
                {/* Con buscador y por área (21/10): era un <select> con todas las cámaras de corrido. */}
                <ElegirCamara variante="filtro" icono={Video} alinear="start" ancho={360} titulo="Cámara" valor={camara || null} alElegir={setCamara}
                    todas={`Todas las cámaras (${camaras.length})`} areas={areasDisp.areas}
                    camaras={camaras.map((c) => ({ id: c.id, nombre: c.name, areaId: areasDisp.equipoArea[c.id] || null, cuenta: datos.porCamara[c.id] || 0 }))} />
                <Pista titulo="Siluetas de OmniVision" texto="Dibuja sobre cada tarjeta la silueta del objeto. Se calcula al mirarla. Es la misma opción que en Buscar, el historial y el visor.">
                    <button type="button" onClick={() => setSiluetas(!siluetas)} aria-pressed={siluetas} aria-label="Siluetas de OmniVision"
                        className={cn("h-[34px] px-2.5 rounded-lg border inline-flex items-center gap-1.5 text-[12px] font-semibold transition-colors",
                            siluetas ? "accion border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent")}>
                        <Sparkles size={14} /> Siluetas
                    </button>
                </Pista>
            </div>
            {datos.porClase.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                    {datos.porClase.filter((x) => !grupo || x.grupo === grupo).map((x) => (
                        <button key={x.clase} type="button" onClick={() => setClase(clase === x.clase ? "" : x.clase)}
                            className={cn("h-7 px-2.5 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5",
                                clase === x.clase ? "bg-[var(--accion)] text-[var(--accion-texto)] border-transparent" : "border-border text-muted-foreground hover:text-foreground")}>
                            {nombreClase(x.clase)} <span className="tabular-nums opacity-75">{x.n}</span>
                        </button>
                    ))}
                </div>
            )}

            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-2.5 text-[12.5px] text-[var(--mal-texto)]">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
            {filas.length === 0 ? (
                <Vacio icono={Inbox} titulo={totalRango === 0 ? "Nada guardado en este rango" : "Nada con este filtro"}
                    ayuda={totalRango === 0 ? (sinSenal ? "El registro no está corriendo." : "Cuando pase alguien frente a una cámara de OmniVision, aparece acá.") : "Probá con otro rango o quitá algún filtro."} />
            ) : (
                <>
                    <MosaicoBuscar resultados={filas} alAbrir={setAbierta} relativa={false} nuevas={nuevas} />
                    <div ref={centinela} className="h-12 grid place-items-center text-[12px] text-muted-foreground">
                        {cargandoMas ? <Loader2 size={14} className="animate-spin" /> : noHayMas ? "No hay más en este rango." : null}
                    </div>
                </>
            )}

            <CajonPista r={abierta} alCerrar={() => setAbierta(null)}
                alRegistrar={(p) => { setAbierta(null); abrirRegistro(p); }}
                alListaNegra={() => { if (abierta) void marcarNegra(abierta); setAbierta(null); }} />
            {cajones}
        </div>
    );
}
