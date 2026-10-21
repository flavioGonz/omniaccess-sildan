"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { sileo as toast } from "sileo";
import { AlertTriangle, Car, Check, Clock, Loader2, Minus, Pencil, Plus, RefreshCw, ScanEye, SquareParking, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModalEscena, BloquePanel, CifraPanel, BotonPanel } from "@/components/vision/ModalEscena";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { cn } from "@/lib/utils";
import { horaSeg } from "@/lib/fechas";
import {
    listarEstacionamiento, guardarEstacionamiento, borrarEstacionamiento, probarAhora,
    type CamaraEstacionamiento,
} from "@/app/actions/estacionamiento";

/**
 * Visión → Estacionamiento (18/10, Nico: «que sea una analítica más de OmniVision, activable
 * como el resto; auditá, mejorá y corregí lo visual y lo lógico»).
 *
 * Una pantalla para las dos cosas que se hacen con el estacionamiento: DIBUJAR dónde se estaciona
 * (la franja sobre el cordón y cuántos lugares entran) y MIRAR cómo está cada lugar ahora, con la
 * chapa de quien lo ocupa y desde cuándo. Antes el dibujo vivía escondido en el calibrador del
 * monitor de intrusión, sólo para cámaras LPR interiores, con un «Tomar cuadro» que no mostraba
 * la foto y un «Está vacía ahora» que siempre contestaba «libre».
 *
 * El estado de cada lugar lo decide OmniVision viendo los vehículos (lib/estacionamiento): no hay
 * que enseñarle la calle vacía.
 */

type Punto = { x: number; y: number };
type Esq = [Punto, Punto, Punto, Punto];
type Datos = Awaited<ReturnType<typeof listarEstacionamiento>>;
type Prueba = Awaited<ReturnType<typeof probarAhora>>;

/** Franja de arranque: la mitad baja del cuadro, donde suele caer la calzada. Para mover, no para usar tal cual. */
const FRANJA_INICIAL: Esq = [{ x: 0.08, y: 0.62 }, { x: 0.92, y: 0.52 }, { x: 0.92, y: 0.78 }, { x: 0.08, y: 0.95 }];
const REFRESCO_MS = 10_000;

const mezclar = (p: Punto, q: Punto, t: number): Punto => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
/** La misma fórmula que lib/franja (celda i entre lerp(a,b) y lerp(d,c)): el dibujo no puede esperar un viaje. */
function celdaDe(e: Esq, i: number, n: number): Punto[] {
    const p = (u: number, v: number) => { const t = (i + u) / n; return mezclar(mezclar(e[0], e[1], t), mezclar(e[3], e[2], t), v); };
    return [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
}
const lapso = (desdeMs: number) => {
    const m = Math.max(0, Math.round((Date.now() - desdeMs) / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
};

export default function Pagina() {
    return <Suspense fallback={<Cargando />}><Estacionamiento /></Suspense>;
}

/*
 * 21/10, Nico: «debe ser más profesional, premium; la cámara se ve muy grande, ocupa casi toda la
 * pantalla; deben ser tablas, con las plazas definidas, al presionarlas se abrirá un modal
 * estilizado para dibujar las plazas». La pantalla es ahora un tablero: las cifras, la tabla de
 * franjas (una por cámara, con su miniatura y sus lugares), lo ocupado ahora y lo que se fue. La
 * cámara grande y el dibujo viven en la ventana (ModalEscena), que se abre tocando una franja.
 */
function Estacionamiento() {
    const sp = useSearchParams();
    const [datos, setDatos] = useState<Datos | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<string | null>(sp.get("camara"));
    const [, setTic] = useState(0);

    const cargar = useCallback(async () => {
        try { setDatos(await listarEstacionamiento()); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo traer el estacionamiento"); }
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(() => { cargar(); setTic((n) => n + 1); }, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

    const conFranja = useMemo(() => (datos?.camaras || []).filter((c) => c.franja), [datos]);
    const sinFranja = useMemo(() => (datos?.camaras || []).filter((c) => !c.franja), [datos]);
    const cam = datos?.camaras.find((c) => c.id === abierta) || null;

    const totales = useMemo(() => {
        let lugares = 0, ocupados = 0;
        for (const c of conFranja) { if (!c.franja?.activa) continue; lugares += c.franja.lugares; ocupados += c.abiertas.length; }
        return { lugares, ocupados };
    }, [conFranja]);
    const ocupadosAhora = useMemo(() => conFranja.flatMap((c) => c.abiertas.map((o) => ({ ...o, camara: c.franja?.nombre || c.nombre, camaraId: c.id }))).sort((a, b) => (a.desde < b.desde ? -1 : 1)), [conFranja]);

    const colsFranjas = useMemo<ColumnaTabla<CamaraEstacionamiento>[]>(() => [
        { clave: "vista", titulo: "", ancho: 132, auxiliar: true, celda: (c) => <MiniFranja c={c} /> },
        { clave: "franja", titulo: "Franja", valor: (c) => c.franja?.nombre || c.nombre, celda: (c) => (
            <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-semibold truncate">{c.franja?.nombre || c.nombre}</div>
                <div className="text-[11.5px] text-muted-foreground truncate">{c.franja?.nombre ? c.nombre : `${c.franja?.lugares} lugares`}</div>
            </div>) },
        { clave: "lugares", titulo: "Lugares", ancho: 220, ordenable: true, valor: (c) => c.abiertas.length, celda: (c) => <Ocupacion c={c} /> },
        { clave: "estado", titulo: "Estado", ancho: 190, valor: (c) => estadoDe(c, datos?.prendida ?? false).texto, celda: (c) => { const e = estadoDe(c, datos?.prendida ?? false); return <Chip tono={e.tono} icono={e.icono}>{e.texto}</Chip>; } },
        { clave: "abrir", titulo: "", ancho: 156, auxiliar: true, alinear: "der", celda: () => (
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[6px] whitespace-nowrap text-[12px] font-semibold text-[var(--accion)] group-hover:bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]"><Pencil size={13} /> Dibujar lugares</span>) },
    ], [datos?.prendida]);

    const colsOcupados = useMemo<ColumnaTabla<(typeof ocupadosAhora)[number]>[]>(() => [
        { clave: "lugar", titulo: "Lugar", ancho: 70, valor: (o) => o.lugar + 1, celda: (o) => <span className="w-7 h-7 rounded-[6px] grid place-items-center bg-muted text-[12px] font-bold tabular-nums">{o.lugar + 1}</span> },
        { clave: "camara", titulo: "Franja", valor: (o) => o.camara },
        { clave: "plate", titulo: "Matrícula", ancho: 130, valor: (o) => o.plate || "", celda: (o) => <PlacaChica texto={o.plate} /> },
        { clave: "estado", titulo: "Estado", ancho: 150, valor: (o) => (o.avisado ? "Estacionado" : "Recién llegado"), celda: (o) => <Chip tono={o.avisado ? "info" : "aviso"} icono={Car}>{o.avisado ? "Estacionado" : "Recién llegado"}</Chip> },
        { clave: "desde", titulo: "Desde", ancho: 100, ordenable: true, valor: (o) => o.desde, celda: (o) => <span className="tabular-nums text-[12.5px]">{horaSeg(o.desde)}</span> },
        { clave: "lleva", titulo: "Lleva", ancho: 110, alinear: "der", valor: (o) => Date.now() - new Date(o.desde).getTime(), celda: (o) => <span className="tabular-nums text-[12.5px] font-semibold">{lapso(new Date(o.desde).getTime())}</span> },
    ], []);

    const colsRetirados = useMemo<ColumnaTabla<Datos["recientes"][number]>[]>(() => [
        { clave: "hasta", titulo: "Se fue", ancho: 100, ordenable: true, valor: (o) => o.hasta, celda: (o) => <span className="tabular-nums text-[12.5px]">{horaSeg(o.hasta)}</span> },
        { clave: "plate", titulo: "Matrícula", ancho: 130, valor: (o) => o.plate || "", celda: (o) => <PlacaChica texto={o.plate} /> },
        { clave: "camara", titulo: "Franja", valor: (o) => `${o.camara} · lugar ${o.lugar + 1}` },
        { clave: "estuvo", titulo: "Estuvo", ancho: 110, alinear: "der", valor: (o) => new Date(o.hasta).getTime() - new Date(o.desde).getTime(), celda: (o) => <span className="tabular-nums text-[12.5px]">{lapsoEntre(o.desde, o.hasta)}</span> },
    ], []);

    if (error && !datos) return <div className="p-6"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6"><Cargando texto="Trayendo los lugares…" /></div>;
    const libres = Math.max(0, totales.lugares - totales.ocupados);

    return (
        <div className="px-6 lg:px-8 py-5 max-w-[1500px] mx-auto space-y-5">
            <header className="flex flex-wrap items-start gap-4">
                <span className="w-11 h-11 rounded-[10px] grid place-items-center bg-muted shrink-0"><SquareParking size={20} className="text-[var(--accion)]" /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[20px] font-bold tracking-[-0.015em] leading-tight">Estacionamiento</h1>
                    <p className="text-[13px] text-muted-foreground mt-0.5 max-w-[760px]">
                        Una franja sobre el cordón con los lugares que entran; OmniVision mira cuáles tienen un vehículo.
                        Se ocupa a los {datos.ocuparSeg} s, avisa «estacionó» a los 3 min y se libera a los {datos.liberarSeg} s sin verlo.
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {datos.prendida
                        ? <Chip tono="bien" icono={Check}>Analítica prendida</Chip>
                        : <Chip tono="aviso" icono={AlertTriangle}>Analítica apagada</Chip>}
                    <Link href="/admin/vision/analiticas" className="text-[12.5px] font-semibold text-[var(--accion)] hover:underline">{datos.prendida ? "Analíticas" : "Prenderla"}</Link>
                </div>
            </header>

            {!datos.prendida && (
                <div className="rounded-[10px] bg-[var(--aviso-suave)] px-4 py-3 text-[12.5px] tono-aviso">
                    Con la analítica apagada nadie mira los lugares: lo que se ve es lo último que se midió.
                </div>
            )}

            {/* Las cifras del barrio, de un vistazo. */}
            <section className="grid grid-cols-2 sm:grid-cols-5 rounded-[10px] bg-muted/50 divide-x divide-border overflow-hidden">
                <Cifra n={conFranja.length} r="franjas" />
                <Cifra n={totales.lugares} r="lugares" />
                <Cifra n={totales.ocupados} r="ocupados" tono={totales.ocupados ? "var(--accion)" : undefined} />
                <Cifra n={libres} r="libres" tono={libres ? "var(--bien-texto)" : undefined} />
                <Cifra n={datos.recientes.length} r="se fueron · 24 h" />
            </section>

            <section className="space-y-2.5">
                <div className="flex items-center gap-3">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Franjas</h2>
                    <span className="text-[12px] text-muted-foreground">Tocá una para ver la cámara y dibujar sus lugares.</span>
                    {sinFranja.length > 0 && (
                        <div className="ml-auto">
                            <Select value="" onValueChange={(v) => v && setAbierta(v)}>
                                <SelectTrigger className="h-9 w-[230px] text-[12.5px]"><Plus size={14} className="mr-1 text-[var(--accion)]" /><SelectValue placeholder="Nueva franja en…" /></SelectTrigger>
                                <SelectContent>
                                    {sinFranja.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}{c.mirada ? "" : " · no la mira OmniVision"}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <Tabla<CamaraEstacionamiento> id="estacionamiento-franjas" filas={conFranja} clave={(c) => c.id} columnas={colsFranjas}
                    alClickFila={(c) => setAbierta(c.id)} filaActiva={(c) => c.id === abierta} controles={false}
                    vacio={{ icono: SquareParking, titulo: "Todavía no hay franjas", ayuda: "Elegí «Nueva franja en…» y dibujá dónde se estaciona." }} />
            </section>

            <div className="grid gap-5 xl:grid-cols-2 items-start">
                <section className="space-y-2.5">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Ocupados ahora</h2>
                    <Tabla id="estacionamiento-ocupados" filas={ocupadosAhora} clave={(o) => o.id} columnas={colsOcupados} controles={false}
                        alClickFila={(o) => setAbierta(o.camaraId)}
                        vacio={{ icono: Car, titulo: "Ningún lugar ocupado" }} />
                </section>
                <section className="space-y-2.5">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Se fueron · últimas 24 h</h2>
                    <Tabla id="estacionamiento-retirados" filas={datos.recientes} clave={(o) => o.id} columnas={colsRetirados} controles={false}
                        vacio={{ icono: Clock, titulo: "Nadie se fue en las últimas 24 h" }} />
                </section>
            </div>

            {cam && <ModalFranja key={cam.id} c={cam} prendida={datos.prendida} alCerrar={() => setAbierta(null)} alCambiar={cargar} />}
        </div>
    );
}

function Cifra({ n, r, tono }: { n: number; r: string; tono?: string }) {
    return (
        <div className="px-4 py-3">
            <div className="text-[22px] font-bold tabular-nums leading-none" style={tono ? { color: tono } : undefined}>{n}</div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">{r}</div>
        </div>
    );
}

function estadoDe(c: CamaraEstacionamiento, prendida: boolean): { tono: "bien" | "aviso" | "quieto"; texto: string; icono: typeof Check } {
    if (!c.franja?.activa) return { tono: "quieto", texto: "Apagada", icono: Clock };
    if (!c.mirada) return { tono: "aviso", texto: "OmniVision no la mira", icono: AlertTriangle };
    if (c.vivo && !c.vivo.vieja) return { tono: "bien", texto: `Mirando · ${horaSeg(c.vivo.ultimaMirada!)}`, icono: ScanEye };
    return { tono: "quieto", texto: prendida ? "Esperando la primera mirada" : "Sin mirar", icono: Clock };
}

const lapsoEntre = (a: string, b: string) => {
    const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function PlacaChica({ texto }: { texto: string | null }) {
    return texto
        ? <span className="inline-flex items-center h-[20px] px-1.5 rounded-[4px] bg-white text-black text-[11px] font-bold tabular-nums tracking-[0.06em] ring-1 ring-black/15">{texto}</span>
        : <span className="inline-flex items-center h-[20px] px-1.5 rounded-[4px] border border-dashed border-border text-muted-foreground text-[11px]">sin chapa</span>;
}

/** Los lugares de una franja en fila: lleno = ocupado. Se lee de un vistazo cuántos quedan. */
function Ocupacion({ c }: { c: CamaraEstacionamiento }) {
    const f = c.franja!;
    const ocupado = new Set(c.abiertas.map((o) => o.lugar));
    return (
        <div className="flex items-center gap-3 min-w-0">
            <div className="flex gap-[3px] flex-1 min-w-0">
                {Array.from({ length: f.lugares }, (_, i) => (
                    <span key={i} className={cn("h-2 flex-1 rounded-full", !f.activa ? "bg-muted" : ocupado.has(i) ? "bg-[var(--accion)]" : "bg-muted-foreground/20")} />
                ))}
            </div>
            <span className="text-[12.5px] tabular-nums shrink-0"><b>{ocupado.size}</b><span className="text-muted-foreground">/{f.lugares}</span></span>
        </div>
    );
}

/** La miniatura de la tabla: el cuadro de la cámara con sus lugares, ocupados en azul. */
function MiniFranja({ c }: { c: CamaraEstacionamiento }) {
    const f = c.franja!;
    const esq = f.esquinas as Esq;
    const ocupado = new Set(c.abiertas.map((o) => o.lugar));
    const [mal, setMal] = useState(false);
    return (
        <span className="relative block w-[116px] aspect-video rounded-[6px] overflow-hidden bg-black shadow-[0_3px_22px_rgba(0,0,0,0.22)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!mal && <img src={`/api/vision/cuadro?camara=${encodeURIComponent(c.id)}&w=240`} alt="" loading="lazy" onError={() => setMal(true)} className="absolute inset-0 w-full h-full object-cover" />}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                {Array.from({ length: f.lugares }, (_, i) => (
                    <polygon key={i} points={celdaDe(esq, i, f.lugares).map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} vectorEffect="non-scaling-stroke"
                        fill={ocupado.has(i) ? "color-mix(in oklab, var(--accion-en-oscuro) 45%, transparent)" : "rgba(255,255,255,0.08)"}
                        stroke={ocupado.has(i) ? "var(--accion-en-oscuro)" : "rgba(255,255,255,0.8)"} strokeWidth={1} />
                ))}
            </svg>
        </span>
    );
}

/**
 * La ventana de una franja: la cámara entera a la izquierda con los lugares (se arrastran las
 * esquinas, siempre), y a la derecha cuántos lugares, el nombre, si mide, la prueba y cómo está
 * cada lugar ahora. Sin franja todavía, arranca con una de ejemplo para mover.
 */
function ModalFranja({ c, prendida, alCerrar, alCambiar }: { c: CamaraEstacionamiento; prendida: boolean; alCerrar: () => void; alCambiar: () => void }) {
    const [esq, setEsq] = useState<Esq>((c.franja?.esquinas as Esq) || FRANJA_INICIAL);
    const [lugares, setLugares] = useState(c.franja?.lugares || 6);
    const [nombre, setNombre] = useState(c.franja?.nombre || "");
    const [activa, setActiva] = useState(c.franja?.activa ?? true);
    const [guardando, setGuardando] = useState(false);
    const [prueba, setPrueba] = useState<Prueba | null>(null);
    const [probando, setProbando] = useState(false);
    const [borrar, setBorrar] = useState(false);
    const [aspecto, setAspecto] = useState(16 / 9);
    const [fotoMal, setFotoMal] = useState(false);
    const [vuelta, setVuelta] = useState(0);
    const foto = prueba?.foto || `/api/vision/cuadro?camara=${encodeURIComponent(c.id)}&v=${vuelta}`;

    const cambio = !c.franja || lugares !== c.franja.lugares || nombre !== (c.franja.nombre || "") || activa !== c.franja.activa
        || JSON.stringify(esq) !== JSON.stringify(c.franja.esquinas);
    // Con la geometría como estaba, cada lugar muestra su ocupación; movida, todavía no se sabe.
    const mismaGeometria = !!c.franja && lugares === c.franja.lugares && JSON.stringify(esq) === JSON.stringify(c.franja.esquinas);
    const porLugar = new Map(mismaGeometria ? c.abiertas.map((o) => [o.lugar, o]) : []);

    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await guardarEstacionamiento(c.id, { esquinas: esq, lugares, activa, nombre });
            if (!r.ok) { toast.error({ title: r.error || "No se pudo guardar" }); return; }
            toast.success({ title: "Lugares guardados", description: r.cerradas ? `Se cerraron ${r.cerradas} ocupaciones de la franja anterior.` : "OmniVision empieza a mirarlos en la próxima vuelta." });
            setPrueba(null); alCambiar(); alCerrar();
        } catch (e: any) { toast.error({ title: e?.message || "No se pudo guardar" }); }
        finally { setGuardando(false); }
    };
    const probar = async () => {
        setProbando(true);
        try {
            const r = await probarAhora(c.id, esq, lugares);
            setPrueba(r);
            if (!r.ok) toast.error({ title: r.error || "No se pudo probar" });
        } catch (e: any) { toast.error({ title: e?.message || "No se pudo probar" }); }
        finally { setProbando(false); }
    };
    const e = estadoDe(c, prendida);

    return (
        <>
            <ModalEscena abierto alCerrar={alCerrar} titulo={nombre || c.nombre} subtitulo={nombre ? c.nombre : c.franja ? `${c.franja.lugares} lugares` : "Franja nueva"} aspecto={aspecto}
                chips={c.franja ? <Chip tono={e.tono} icono={e.icono}>{e.texto}</Chip> : <Chip tono="info" icono={Pencil}>Nueva</Chip>}
                escena={<>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={foto} alt={`Cuadro de ${c.nombre}`} draggable={false} className="absolute inset-0 w-full h-full object-fill"
                        onLoad={(ev) => { setFotoMal(false); const i = ev.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspecto(i.naturalWidth / i.naturalHeight); }} onError={() => setFotoMal(true)} />
                    {fotoMal && <div className="absolute inset-0 grid place-items-center text-white/70 text-[13px]">La cámara no entregó un cuadro.</div>}
                    <Lienzo esq={esq} n={lugares} editable setEsq={setEsq} abiertas={porLugar} vivo={mismaGeometria ? c.vivo : null} prueba={prueba} />
                </>}
                sobreEscena={<div className="flex items-center gap-3 text-[12px] text-white/75">
                    <span>Arrastrá las cuatro esquinas sobre el cordón: los lugares se achican solos con la distancia.</span>
                    <button type="button" onClick={() => { setPrueba(null); setVuelta((v) => v + 1); }} className="ml-auto shrink-0 inline-flex items-center gap-1 text-white/80 hover:text-white"><RefreshCw size={12} /> Otro cuadro</button>
                </div>}
                panel={<>
                    <BloquePanel rotulo="Ahora">
                        <div className="grid grid-cols-3 gap-2">
                            <CifraPanel n={c.franja ? c.abiertas.length : "—"} rotulo="ocupados" tono={c.abiertas.length ? "var(--accion-en-oscuro)" : undefined} />
                            <CifraPanel n={c.franja ? Math.max(0, c.franja.lugares - c.abiertas.length) : "—"} rotulo="libres" />
                            <CifraPanel n={lugares} rotulo="lugares" />
                        </div>
                    </BloquePanel>
                    <BloquePanel rotulo="La franja">
                        <div className="space-y-3">
                            <label className="block">
                                <span className="text-[12px] text-white/60">Nombre</span>
                                <input value={nombre} onChange={(ev) => setNombre(ev.target.value)} placeholder="Ej.: Calle 21, vereda norte"
                                    className="mt-1 w-full h-9 rounded-[6px] bg-white/[0.06] border border-white/10 px-3 text-[13px] text-white placeholder:text-white/35 outline-none focus:border-[var(--accion-en-oscuro)]" />
                            </label>
                            <div className="flex items-center gap-3">
                                <span className="flex-1 text-[12.5px] text-white/80">Lugares que entran</span>
                                <div className="flex items-center rounded-[6px] bg-white/[0.06]">
                                    <button type="button" onClick={() => setLugares((x) => Math.max(1, x - 1))} className="w-8 h-8 grid place-items-center hover:bg-white/10 rounded-l-[6px]" aria-label="Uno menos"><Minus size={14} /></button>
                                    <span className="w-9 text-center text-[15px] font-bold tabular-nums">{lugares}</span>
                                    <button type="button" onClick={() => setLugares((x) => Math.min(40, x + 1))} className="w-8 h-8 grid place-items-center hover:bg-white/10 rounded-r-[6px]" aria-label="Uno más"><Plus size={14} /></button>
                                </div>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <span className="flex-1 text-[12.5px] text-white/80">{activa ? "Mide" : "Apagada: se guarda, no se mira"}</span>
                                <Switch checked={activa} onCheckedChange={setActiva} />
                            </label>
                        </div>
                    </BloquePanel>
                    <BloquePanel rotulo="Probar" extra={prueba?.ok ? <span className="text-[11px] text-white/50 tabular-nums">{horaSeg(new Date().toISOString())}</span> : undefined}>
                        <BotonPanel onClick={probar} disabled={probando} className="w-full justify-center">
                            {probando ? <Loader2 size={14} className="animate-spin" /> : <ScanEye size={14} />} Ver qué ve OmniVision ahora
                        </BotonPanel>
                        {prueba?.ok && (
                            <p className="mt-2 text-[12px] text-white/70 leading-snug">
                                Ve {prueba.vehiculos?.length || 0} {prueba.vehiculos?.length === 1 ? "vehículo" : "vehículos"}; {prueba.ocupados?.filter((x) => x != null).length || 0} {prueba.ocupados?.filter((x) => x != null).length === 1 ? "cae" : "caen"} en algún lugar.
                                {(prueba.vehiculos || []).some((v) => v.lugar == null) && " Los de afuera de la franja, punteados."}
                            </p>
                        )}
                    </BloquePanel>
                    {c.franja && mismaGeometria && (
                        <BloquePanel rotulo="Cada lugar">
                            <div className="rounded-[10px] bg-white/[0.04] divide-y divide-white/[0.06]">
                                {Array.from({ length: c.franja.lugares }, (_, i) => {
                                    const o = porLugar.get(i);
                                    const confirmando = !o && c.vivo?.lugares?.[i]?.vistoDesde != null && !c.vivo?.vieja;
                                    return (
                                        <div key={i} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
                                            <span className="w-6 h-6 rounded-[6px] grid place-items-center bg-white/10 text-[11px] font-bold tabular-nums">{i + 1}</span>
                                            {o ? (<>
                                                {o.plate ? <span className="inline-flex items-center h-[19px] px-1.5 rounded-[4px] bg-white text-black text-[10.5px] font-bold tabular-nums tracking-[0.06em]">{o.plate}</span> : <span className="text-white/50 text-[11.5px]">sin chapa</span>}
                                                <span className={cn("text-[11.5px] font-semibold", o.avisado ? "text-[var(--accion-en-oscuro)]" : "text-[var(--aviso)]")}>{o.avisado ? "estacionado" : "recién llegado"}</span>
                                                <span className="ml-auto tabular-nums text-white/60">{lapso(new Date(o.desde).getTime())}</span>
                                            </>) : confirmando ? <span className="text-[11.5px] text-[var(--aviso)]">hay un vehículo · confirmando</span>
                                                : <span className="text-[11.5px] text-white/45">libre</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </BloquePanel>
                    )}
                    {c.franja && !mismaGeometria && <p className="text-[12px] text-white/55">Cambiaste la franja: al guardar, las ocupaciones de la anterior se cierran con su «se retiró».</p>}
                </>}
                pie={<>
                    {c.franja && <BotonPanel peligro onClick={() => setBorrar(true)} disabled={guardando}><Trash2 size={14} /> Quitar</BotonPanel>}
                    <span className="ml-auto" />
                    <BotonPanel onClick={alCerrar} disabled={guardando}>Cancelar</BotonPanel>
                    <BotonPanel primario onClick={guardar} disabled={guardando || !cambio}>{guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar lugares</BotonPanel>
                </>} />
            {borrar && (
                <ConfirmarAccion id={c.id} title={`los lugares de ${c.franja?.nombre || c.nombre}`}
                    description={`Se borra la franja. ${c.abiertas.length ? `Las ${c.abiertas.length} ocupaciones abiertas se cierran con su «se retiró».` : ""}`}
                    etiquetaAccion="Quitar" open={borrar} onOpenChange={setBorrar}
                    onDelete={async (id) => { await borrarEstacionamiento(id); }}
                    onSuccess={() => { setBorrar(false); alCambiar(); alCerrar(); }} />
            )}
        </>
    );
}

/**
 * Los lugares sobre el cuadro. Dibuja en fracciones de la imagen (la imagen va a lo ancho, sin
 * bandas), así que no hay encuadre que calcular. Editando, las esquinas se arrastran.
 */
function Lienzo({ esq, n, editable, setEsq, abiertas, vivo, prueba }: {
    esq: Esq; n: number; editable: boolean; setEsq: (e: Esq) => void;
    abiertas: Map<number, { plate: string | null; desde: string; avisado: boolean }>;
    vivo: CamaraEstacionamiento["vivo"]; prueba: Prueba | null;
}) {
    const caja = useRef<HTMLDivElement>(null);
    const arrastra = useRef<number | null>(null);
    const esqRef = useRef(esq); esqRef.current = esq;
    useEffect(() => {
        if (!editable) return;
        const mover = (ev: PointerEvent) => {
            const i = arrastra.current; const r = caja.current?.getBoundingClientRect();
            if (i == null || !r) return;
            const p = { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
            const q = [...esqRef.current] as Esq; q[i] = p; setEsq(q);
        };
        const soltar = () => { arrastra.current = null; };
        window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar);
        return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
    }, [editable, setEsq]);
    const pts = (q: Punto[]) => q.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
    const ocupadosPrueba = prueba?.ok ? prueba.ocupados || [] : [];

    return (
        <div ref={caja} className="absolute inset-0">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                {Array.from({ length: n }, (_, i) => {
                    const q = celdaDe(esq, i, n);
                    const o = abiertas.get(i);
                    const viendo = vivo?.lugares?.[i]?.vistoDesde != null && !vivo?.vieja;
                    const enPrueba = ocupadosPrueba[i] != null;
                    const lleno = !!o || enPrueba;
                    return (
                        <polygon key={i} points={pts(q)} vectorEffect="non-scaling-stroke"
                            fill={lleno ? "color-mix(in oklab, var(--accion-en-oscuro) 34%, transparent)" : viendo ? "color-mix(in oklab, var(--aviso) 22%, transparent)" : "rgba(255,255,255,0.04)"}
                            stroke={lleno ? "var(--accion-en-oscuro)" : viendo ? "var(--aviso)" : "rgba(255,255,255,0.75)"}
                            strokeWidth={lleno ? 2 : 1.25} strokeDasharray={!lleno && viendo ? "5 3" : undefined} />
                    );
                })}
                {/* Lo que vio OmniVision al probar: cada vehículo con su caja; gris si cae afuera de la franja. */}
                {prueba?.ok && (prueba.vehiculos || []).map((v, k) => (
                    <rect key={k} x={v.caja[0] * 100} y={v.caja[1] * 100} width={(v.caja[2] - v.caja[0]) * 100} height={(v.caja[3] - v.caja[1]) * 100} vectorEffect="non-scaling-stroke"
                        fill="none" stroke={v.lugar != null ? "var(--accion-en-oscuro)" : "rgba(255,255,255,0.45)"} strokeWidth={1.5} strokeDasharray={v.lugar != null ? undefined : "4 3"} />
                ))}
            </svg>
            {/* Los rótulos de cada lugar: número, y chapa y tiempo si está ocupado. En HTML para que no se deformen. */}
            {Array.from({ length: n }, (_, i) => {
                const q = celdaDe(esq, i, n);
                const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
                const o = abiertas.get(i);
                return (
                    <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center gap-0.5" style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}>
                        <span className="min-w-5 h-5 px-1 rounded-full bg-black/60 text-white text-[10.5px] font-bold tabular-nums grid place-items-center">{i + 1}</span>
                        {o && (
                            <span className="flex flex-col items-center">
                                {o.plate && <span className="px-1 rounded-[3px] bg-white text-black text-[10px] font-bold tracking-[0.05em] tabular-nums">{o.plate}</span>}
                                <span className="mt-0.5 px-1 rounded-[3px] bg-black/65 text-white text-[9.5px] tabular-nums">{lapso(new Date(o.desde).getTime())}</span>
                            </span>
                        )}
                    </div>
                );
            })}
            {editable && esq.map((p, i) => (
                <button key={i} type="button" aria-label={`Esquina ${i + 1}`} onPointerDown={(e) => { e.preventDefault(); arrastra.current = i; }}
                    className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-[var(--accion-en-oscuro)] cursor-grab active:cursor-grabbing touch-none"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
            ))}
        </div>
    );
}
