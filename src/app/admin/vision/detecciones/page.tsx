"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ListVideo, Camera, Loader2, Activity, User, Car, PawPrint, Backpack, Shapes,
    type LucideIcon,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Filtros } from "@/components/ui/filtros";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { TarjetaObjeto as Tarjeta, FichaObjeto as Ficha, pct, hora, fecha, duracion, nombreClase, type FilaObjeto as Fila } from "@/components/vision/ObjetoRegistro";

/**
 * Detecciones: lo que guardó el registro de detecciones (vision-worker).
 *
 * Aparte del laboratorio a pedido de Nico (9/10): el laboratorio prueba un cuadro; esto es lo
 * que el detector vio solo, durante horas, para saber qué detecta bien, qué confunde y cuánto.
 * Sin entrada en el menú, bajo el permiso Ajustes (como /admin/vision).
 *
 * Una tarjeta es una PISTA, no un cuadro: una persona que cruza la cámara en 12 s es una
 * tarjeta, con el mejor recorte de su paso. La ficha muestra el cuadro de ese momento con la
 * caja y el recorrido entero, y abre la grabación del NVR en ese instante.
 */

type EstadoCamara = { nombre: string; analizados: number; saltados: number; errores: number; objetos: number; ultimo: string | null; ms: number | null; error: string | null; cambio: { mediana: number; max: number; n: number } | null };
type Respuesta = {
    filas: Fila[]; h: number; porPagina: number;
    porClase: { clase: string; grupo: string; n: number }[];
    porCamara: Record<string, number>;
    camaras: { id: string; name: string; deviceType: string; registra: boolean }[];
    estado: null | {
        t: string; activo: boolean; intervaloMs: number; umbral: number; cambioMin: number; pistasAbiertas: number; retencionDias: number;
        camaras: Record<string, EstadoCamara>; contadores: { ciclos: number; analizados: number; saltados: number; errores: number; abiertas: number; cerradas: number };
    };
    vision: { ok: boolean; error: string | null };
};

/** Cada cuánto se vuelve a pedir la lista. El registro mira cada cámara cada 2 s; más seguido no trae nada nuevo. */
const REFRESCO_MS = 8000;
/** Sin noticias del proceso durante esto, se dice que no hay señal (escribe su estado cada 15 s). */
const SIN_SENAL_MS = 60_000;
const RANGOS = [{ v: "1", r: "1 h" }, { v: "6", r: "6 h" }, { v: "24", r: "24 h" }, { v: "72", r: "3 días" }, { v: "168", r: "7 días" }];
const GRUPOS: { v: string; r: string; icono: LucideIcon }[] = [
    { v: "", r: "Todo", icono: Shapes }, { v: "persona", r: "Personas", icono: User }, { v: "vehiculo", r: "Vehículos", icono: Car },
    { v: "animal", r: "Animales", icono: PawPrint }, { v: "objeto", r: "Bultos", icono: Backpack },
];


function haceCuanto(iso: string | null) {
    if (!iso) return "nunca";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`;
}


export default function DeteccionesVision() {
    const [datos, setDatos] = useState<Respuesta | null>(null);
    const [mas, setMas] = useState<Fila[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [h, setH] = useState("24");
    const [grupo, setGrupo] = useState("");
    const [camara, setCamara] = useState("");
    const [clase, setClase] = useState("");
    const [conRotulo, setConRotulo] = useState(false);
    const [cargandoMas, setCargandoMas] = useState(false);
    const [abierta, setAbierta] = useState<Fila | null>(null);
    const [, setTic] = useState(0);

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
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "sin respuesta"); }
    }, [consulta]);

    // Al cambiar un filtro se empieza de cero; la página 1 se refresca sola, lo ya cargado de más no.
    useEffect(() => { setMas([]); cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);
    // Los "hace N s" envejecen aunque no lleguen datos nuevos.
    useEffect(() => { const t = setInterval(() => setTic((x) => x + 1), 5000); return () => clearInterval(t); }, []);

    async function cargarMas() {
        const todas = [...(datos?.filas || []), ...mas];
        const ultima = todas[todas.length - 1];
        if (!ultima) return;
        setCargandoMas(true);
        try {
            const r = await fetch(consulta(ultima.primeraVez), { cache: "no-store" });
            const j = await r.json();
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setMas((m) => [...m, ...j.filas]);
        } catch (e: any) { toast.error({ title: "No se pudieron traer más", description: e?.message }); }
        finally { setCargandoMas(false); }
    }

    async function alternarCamara(id: string, registra: boolean) {
        if (!datos) return;
        const nuevas = datos.camaras.filter((c) => (c.id === id ? registra : c.registra)).map((c) => c.id);
        try {
            const r = await fetch("/api/vision/registro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ camaras: nuevas }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: registra ? "Se registra" : "Deja de registrarse", description: "El proceso lo toma en menos de 30 s." });
            cargar();
        } catch (e: any) { toast.error({ title: "No se guardó", description: e?.message }); }
    }

    const filas = useMemo(() => {
        const vistas = new Set<string>();
        return [...(datos?.filas || []), ...mas].filter((f) => (vistas.has(f.id) ? false : (vistas.add(f.id), true)));
    }, [datos, mas]);

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo lo que vio el detector…" /></div>;

    const est = datos.estado;
    const sinSenal = !est || Date.now() - new Date(est.t).getTime() > SIN_SENAL_MS;
    const totalRango = datos.porClase.reduce((s, x) => s + x.n, 0);
    const porGrupo = (g: string) => datos.porClase.filter((x) => !g || x.grupo === g).reduce((s, x) => s + x.n, 0);
    const hayMas = (datos.filas.length + mas.length) >= datos.porPagina && (mas.length === 0 || mas.length % datos.porPagina === 0);

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto">
            {/* Encabezado */}
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><ListVideo size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Detecciones</h1>
                        {sinSenal ? <Chip tono="mal" icono={Activity}>El registro no da señal</Chip>
                            : est!.activo ? <Chip tono="bien" icono={Activity}>Registrando · {est!.pistasAbiertas} en curso</Chip>
                                : <Chip tono="quieto">Registro apagado</Chip>}
                        {!datos.vision.ok && <Chip tono="mal">omni-vision: {datos.vision.error}</Chip>}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        Lo que el detector vio solo, cámara por cámara: una tarjeta por cada persona, vehículo o animal que pasó, con su mejor foto, sus atributos y su recorrido.
                        {est && <> Mira cada cámara cada {Math.round(est.intervaloMs / 1000)} s cuando la imagen cambia, guarda desde {pct(est.umbral)} de confianza y borra a los {est.retencionDias} días.</>}
                    </p>
                </div>
            </div>

            {/* Cámaras: qué se registra y cómo viene cada una */}
            <section>
                <div className="flex items-baseline justify-between mb-2">
                    <h2 className="text-[13px] font-bold">Cámaras</h2>
                    {est && <span className="text-[11.5px] text-muted-foreground tabular-nums">
                        {est.contadores.analizados} cuadros analizados · {est.contadores.saltados} sin cambios (no se analizaron) · {est.contadores.errores} errores desde que arrancó
                    </span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
                    {datos.camaras.map((c) => {
                        const e = est?.camaras?.[c.id];
                        const elegida = camara === c.id;
                        return (
                            <div key={c.id} className={cn("rounded-[10px] border bg-card p-3 flex flex-col gap-1.5", elegida ? "border-[var(--accion)]" : "border-border", !c.registra && "opacity-60")}>
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => setCamara(elegida ? "" : c.id)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left" title="Ver sólo lo de esta cámara">
                                        <Camera size={13} className="text-muted-foreground shrink-0" />
                                        <span className="text-[13px] font-semibold truncate">{c.name}</span>
                                    </button>
                                    <Switch checked={c.registra} onCheckedChange={(v) => alternarCamara(c.id, v)} aria-label={`${c.registra ? "Dejar de registrar" : "Registrar"} ${c.name}`} />
                                </div>
                                <div className="text-[11.5px] text-muted-foreground tabular-nums leading-snug">
                                    <b className="text-foreground">{datos.porCamara[c.id] || 0}</b> en el rango
                                    {e && <> · {e.objetos} ahora · {haceCuanto(e.ultimo)}</>}
                                </div>
                                {e?.error ? <div className="text-[11px] text-[var(--mal-texto)] leading-snug">{e.error}</div>
                                    : e?.cambio && <div className="text-[11px] text-muted-foreground tabular-nums" title={`Cuánto cambia la imagen entre cuadros (0-255). Por debajo de ${est?.cambioMin} no se analiza.`}>cambio {e.cambio.mediana} (máx {e.cambio.max}) · {e.ms ?? "—"} ms</div>}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Filtros */}
            <section className="space-y-2">
                <Filtros grupos={[
                    { clave: "h", titulo: "Rango", valor: h, alElegir: setH, opciones: RANGOS.map((x) => ({ valor: x.v, rotulo: x.r })) },
                    { clave: "rotulo", titulo: "Rotulado", valor: conRotulo ? "si" : "", alElegir: (v) => setConRotulo(v === "si"), opciones: [{ valor: "", rotulo: "Todo" }, { valor: "si", rotulo: "Con texto leído" }] },
                    { clave: "grupo", titulo: "Qué", valor: grupo, alElegir: (v) => { setGrupo(v); setClase(""); }, opciones: GRUPOS.map((g) => ({ valor: g.v, rotulo: g.r, cuenta: porGrupo(g.v) })) },
                ]} />
                {datos.porClase.length > 0 && (
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
            </section>

            {/* La grilla */}
            {error && <div className="rounded-[10px] border border-[color-mix(in_oklab,var(--mal)_40%,transparent)] bg-[var(--mal-suave)] px-4 py-2.5 text-[12.5px] text-[var(--mal-texto)]">No se pudo actualizar: {error}. Se muestra lo último que llegó.</div>}
            {filas.length === 0 ? (
                <div className="rounded-[10px] border border-border bg-card p-10 text-center text-[13px] text-muted-foreground">
                    {totalRango === 0
                        ? (sinSenal ? "El registro no está corriendo, así que no hay nada guardado en este rango." : "Todavía no se guardó nada en este rango. Cuando pase alguien frente a una cámara registrada, aparece acá.")
                        : "Nada con este filtro."}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                    {filas.map((f) => <Tarjeta key={f.id} f={f} alAbrir={() => setAbierta(f)} />)}
                </div>
            )}
            {hayMas && filas.length > 0 && (
                <div className="flex justify-center">
                    <Button variant="outline" onClick={cargarMas} disabled={cargandoMas}>{cargandoMas ? <Loader2 size={14} className="animate-spin" /> : null} Cargar más</Button>
                </div>
            )}

            <Cajon open={!!abierta} onOpenChange={(o) => { if (!o) setAbierta(null); }}>
                {abierta && (
                    <CajonContenido ancho="ancho" titulo={`${nombreClase(abierta.clase)} · ${abierta.camara}`}
                        descripcion={`${fecha(abierta.primeraVez)}, ${hora(abierta.primeraVez)} a ${hora(abierta.ultimaVez)} · ${duracion(abierta.primeraVez, abierta.ultimaVez)}`}>
                        <Ficha f={abierta} />
                    </CajonContenido>
                )}
            </Cajon>
        </div>
    );
}

