"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Server, Clock, Camera, ShieldAlert, ShieldCheck, ShieldQuestion, PanelRightOpen, Maximize2, Loader2, ChevronRight, Ban, PlayCircle, ScanEye } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CanalEnAlarma } from "@/components/intrusion/CanalEnAlarma";
import { GeomOverlay, metaDe, type Geom } from "@/components/intrusion/comun";
import { ResumenArmado } from "@/components/intrusion/HorarioArmado";
import { SUAVE, tocable, Ampliada, CajonPared } from "@/components/monitor/tactil";
import { sonar } from "@/lib/sonido-monitor";
import { ackAlarms, setAttending, reclasificarComoFalsa, marcarDeteccion } from "@/app/actions/detections";
import { getImagePath } from "@/lib/image-path";
import { fecha } from "@/lib/fechas";
import { conAncho } from "@/lib/ancho-foto";
import { AnalisisDeteccion } from "@/components/intrusion/AnalisisDeteccion";
import { VerGrabacion } from "@/components/video/VerGrabacion";
import { cn } from "@/lib/utils";
import { CapaAnalisis } from "@/components/vision/CapaAnalisis";
import { geomDeIntrusion, VEREDICTOS } from "@/lib/vision-capa";
import type { Verificacion } from "@/lib/verificacion";

/**
 * La vista Intrusión de la pared y de la pantalla táctil del puesto.
 *
 * Calma cuando no pasa nada: el mosaico de las cámaras de intrusión con su línea, su zona y
 * el armado de cada regla. Cuando pasa algo, el canal en alarma toma el overlay rojo (la misma
 * pieza que el panel) y crece; las demás se corren.
 *
 * Hasta el 9/10 era sólo para mirar: nada se tocaba, la franja de la derecha no se movía y
 * la ventana de alerta tapaba todo sin forma de cerrarla. Ahora responde al dedo igual que
 * Control LPR (lo compartido vive en monitor/tactil):
 *
 *  · Sin fila de números arriba (9/10: ocupaba un sexto de la pantalla y no decía nada que
 *    no dijeran el canal en rojo y los filtros de la franja, que llevan su cuenta).
 *  · Tocar un canal abre la ficha de la cámara: el vivo grande con su línea, si está armada,
 *    cuántas lleva hoy y sus últimas detecciones.
 *  · La franja se desliza y cada detección abre su ficha: la captura, la hora exacta, su
 *    estado, la grabación de ese momento y el análisis (indicios y el mapa con el cruce).
 *  · Las fichas se cierran solas al minuto sin tocar.
 *
 * Lo que sigue siendo del panel: aceptar o resolver una alarma. Una pantalla de pared entra
 * con un enlace de sólo lectura y no decide nada.
 */

/** Cada cuánto se repite la consulta completa; el socket adelanta lo urgente, y esto es lo que hace que una alarma aceptada en el panel se apague acá. */
const INTERVALO_MS = 15_000;
/** Cadencia del snapshot de cada canal: más lenta sin alarma, para no castigar las cámaras. */
const SNAPSHOT_CALMA_MS = 8000;
const SNAPSHOT_ALARMA_MS = 4000;
/** El vivo de la ficha: una sola cámara, se puede mirar más seguido. */
const SNAPSHOT_FICHA_MS = 2000;
/** Cada cuánto vuelve a sonar una alarma en modo "repetir". */
const REPETIR_MS = 8000;
/** Sin tocar nada este tiempo, la ficha se cierra. */
const FICHA_SE_CIERRA_MS = 60_000;

type Det = { id: string; deviceId: string | null; deviceName: string | null; nvrName?: string | null; ch?: number | null; type: string; snapshotPath: string | null; timestamp: string; acknowledged?: boolean; ackKind?: string | null; label?: string | null;
    /** Lo que vio omni-vision en la captura y su veredicto (vision-analisis.js → lib/verificacion). */
    verif?: Verificacion | null };
/** Una verificación tarda unos segundos (cola de vision-worker): antes de esto se dice «verificando», después «sin verificar». */
const VERIFICANDO_MS = 2 * 60_000;

/** El veredicto de omni-vision, como pastilla. Nunca decide: la alarma la acepta una persona. */
function Veredicto({ d, grande }: { d: Det; grande?: boolean }) {
    const v = d.verif?.veredicto ? VEREDICTOS[d.verif.veredicto] : null;
    const cls = grande ? "px-3 py-1 text-[13px]" : "px-2 py-0.5 text-[11px]";
    if (!v) {
        if (d.verif?.estado === "SIN_FOTO" || d.verif?.estado === "ERROR" || Date.now() - +new Date(d.timestamp) > VERIFICANDO_MS) return null;
        return <span className={cn("inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/50 text-white/80 font-semibold", cls)}><Loader2 size={grande ? 13 : 10} className="animate-spin" /> verificando</span>;
    }
    return <span className={cn("inline-flex items-center gap-1 rounded-full border font-bold uppercase", cls, `chip-${v.tono}`)}><ScanEye size={grande ? 14 : 11} /> {v.rotulo}</span>;
}
type Cam = { id: string; name: string; nvrName: string | null; ch: number | null; geom: Geom | null; horarios: any; ultima: Det | null };
type Alarma = { deviceId: string; id: string; type: string; ts: string };
type Hoy = { total: number; reales: number; falsas: number };
type Datos = { camaras: Cam[]; pendientes: Alarma[]; atendiendo: string[]; franja: Det[]; ahora: string; hoy?: Hoy };
type Filtro = "todas" | "pendientes" | "reales" | "falsas";

const FILTROS: { v: Filtro; l: string }[] = [{ v: "todas", l: "Todas" }, { v: "pendientes", l: "Sin confirmar" }, { v: "reales", l: "Reales" }, { v: "falsas", l: "Falsas" }];
const CLASE: Record<string, string> = { human: "Persona", vehicle: "Vehículo" };

/** El estado de una detección, en el mismo idioma que el panel. */
const estadoDe = (d: Det) => !d.acknowledged
    ? { t: "Sin confirmar", c: "chip-aviso", Ic: ShieldQuestion }
    : d.ackKind === "false" ? { t: "Falsa", c: "chip-quieto", Ic: Ban } : { t: "Real", c: "chip-mal", Ic: ShieldAlert };
const pasa = (d: Det, f: Filtro) => f === "todas" ? true : f === "pendientes" ? !d.acknowledged : f === "reales" ? d.acknowledged && d.ackKind !== "false" : d.acknowledged && d.ackKind === "false";
/** La captura de la detección al ancho en que se ve; si no tiene, la foto de la cámara. */
const fotoDe = (d: Det, ancho = 480) => conAncho(getImagePath(d.snapshotPath), ancho) || (d.deviceId ? `/api/snapshot/${d.deviceId}?w=${ancho}&t=${d.id}` : null);
const fotoGrande = (d: Det) => getImagePath(d.snapshotPath) || (d.deviceId ? `/api/snapshot/${d.deviceId}?t=${d.id}` : null);

function Canal({ cam, pendientes, confirmada, grande, alTocar }: { cam: Cam; pendientes: Alarma[]; confirmada: boolean; grande: boolean; alTocar: () => void }) {
    const enAlarma = pendientes.length > 0 || confirmada;
    const [k, setK] = useState(0);
    useEffect(() => { const iv = setInterval(() => setK((x) => x + 1), enAlarma ? SNAPSHOT_ALARMA_MS : SNAPSHOT_CALMA_MS); return () => clearInterval(iv); }, [enAlarma]);
    const m = cam.ultima ? metaDe(cam.ultima.type) : null;
    return (
        <motion.button type="button" layout onClick={alTocar} aria-label={`Ver la cámara ${cam.name}`} transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={cn("relative rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 text-left", tocable, grande ? "col-span-2 row-span-2" : "")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/snapshot/${cam.id}?w=640&t=${k}`} alt={cam.name} draggable={false} className="absolute inset-0 w-full h-full object-cover" />
            <GeomOverlay geom={cam.geom} alert={enAlarma} />
            {enAlarma && (
                <CanalEnAlarma escala={grande ? "pared" : "panel"} estado={pendientes.length ? "pendiente" : "confirmada"}
                    tipo={pendientes.length ? metaDe(pendientes[0].type).label : m ? m.label : "Intrusión"}
                    desde={pendientes.length ? pendientes[0].ts : cam.ultima?.timestamp || null} eventos={pendientes.length}
                    camara={`${cam.name}${cam.nvrName ? ` · ${cam.nvrName}` : ""}${cam.ch != null ? ` · CH ${cam.ch}` : ""}`} />
            )}
            <div className="absolute top-0 inset-x-0 px-4 pt-3 pb-8 bg-gradient-to-b from-black/80 via-black/30 to-transparent z-[42]">
                <div className={cn("font-bold text-white drop-shadow leading-tight", grande ? "text-[28px]" : "text-[20px]")}>{cam.name}</div>
                <div className="flex items-center gap-3 mt-0.5 text-[13px] text-white/70">
                    {cam.nvrName && <span className="inline-flex items-center gap-1"><Server size={12} /> {cam.nvrName}{cam.ch != null ? ` · CH ${cam.ch}` : ""}</span>}
                </div>
                {cam.horarios && <div className="mt-1 [&_span]:!text-[12px]"><ResumenArmado h={cam.horarios} /></div>}
            </div>
            <div className="absolute bottom-0 inset-x-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-2 text-[14px] text-white/80 z-[42]">
                {!enAlarma && (cam.ultima && m
                    ? <><m.Icon size={15} className={m.cls.split(" ")[0]} /> <span className="font-semibold">{m.label}</span> <span className="text-white/55 tabular-nums">· {horaCorta(cam.ultima.timestamp)} · {hace(cam.ultima.timestamp)}</span></>
                    : <><Camera size={15} className="text-white/40" /> <span className="text-white/55">Sin detecciones</span></>)}
                <span className="ml-auto grid h-10 w-10 place-items-center rounded-xl bg-black/45 text-white/85 shrink-0" aria-hidden><PanelRightOpen size={18} /></span>
            </div>
        </motion.button>
    );
}

/** Un renglón de la franja: la captura, qué fue, de qué cámara, la hora exacta y su estado. */
function Renglon({ d, geom, alTocar }: { d: Det; geom?: Geom | null; alTocar: () => void }) {
    const m = metaDe(d.type);
    const e = estadoDe(d);
    const foto = fotoDe(d, 400);
    return (
        <motion.button type="button" layout="position" onClick={alTocar} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={SUAVE}
            className={cn("relative w-full rounded-xl overflow-hidden bg-neutral-900 ring-1 ring-white/10 aspect-[16/7] shrink-0 text-left", tocable)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {foto && <img src={foto} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />}
            {foto && d.verif?.analisis && <CapaAnalisis analisis={d.verif.analisis} geom={geomDeIntrusion(geom)} ajuste="cover" etiquetas={false} />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <span className="absolute top-2 left-2"><Veredicto d={d} /></span>
            <span className={cn("absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold uppercase", e.c)}><e.Ic size={11} /> {e.t}</span>
            <div className="absolute bottom-2 left-3 right-3">
                <div className="flex items-center gap-1.5 text-[14px] font-bold text-white"><m.Icon size={14} className={m.cls.split(" ")[0]} /> {m.label}{d.label && CLASE[d.label] ? <span className="font-semibold text-white/70">· {CLASE[d.label]}</span> : null}</div>
                <div className="text-[12.5px] text-white/75 truncate">{d.deviceName || "—"} · <span className="tabular-nums font-semibold text-white/90">{horaCorta(d.timestamp)}</span> · {hace(d.timestamp)}</div>
            </div>
        </motion.button>
    );
}

export function VistaIntrusion() {
    const { latir, setTitulo, ajustes, silencio, puedeDecidir } = useMarco();
    useEffect(() => { setTitulo("Intrusión"); }, [setTitulo]);
    usarReloj();
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/intrusion", INTERVALO_MS, latir);
    const [vivas, setVivas] = useState<Alarma[]>([]);
    const [nuevas, setNuevas] = useState<Det[]>([]);
    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [camId, setCamId] = useState<string | null>(null);
    const [det, setDet] = useState<Det | null>(null);
    const [ampliada, setAmpliada] = useState<string | null>(null);
    useEffect(() => { if (datos) { setVivas(datos.pendientes); setNuevas([]); } }, [datos]);
    // El socket adelanta la alarma: no se espera a la próxima consulta para ponerse rojo.
    useTiempoReal("general_detection", (d: any) => {
        if (!d?.id || !d.deviceId || d.type === "MOTION") return;
        setVivas((p) => (p.some((a) => a.id === d.id) ? p : [{ id: d.id, deviceId: d.deviceId, type: d.type, ts: d.timestamp || new Date().toISOString() }, ...p]));
        setNuevas((p) => (p.some((x) => x.id === d.id) ? p : [{ id: d.id, deviceId: d.deviceId, deviceName: d.deviceName || null, type: d.type, snapshotPath: d.snapshotPath || null, timestamp: d.timestamp || new Date().toISOString(), acknowledged: false, label: d.label || null }, ...p]));
        latir();
        setTimeout(recargar, 1500);
    });
    // omni-vision terminó de mirar una captura: se trae para dibujar las siluetas y el veredicto.
    useTiempoReal("detection_verified", () => { recargar(); });
    useTiempoReal("detection_snapshot", (d: any) => { if (d?.id && d.snapshotPath) setNuevas((p) => p.map((x) => (x.id === d.id ? { ...x, snapshotPath: d.snapshotPath } : x))); });

    const porCamara = useMemo(() => { const m = new Map<string, Alarma[]>(); for (const a of vivas) m.set(a.deviceId, [...(m.get(a.deviceId) || []), a]); return m; }, [vivas]);
    const atendiendo = useMemo(() => new Set(datos?.atendiendo || []), [datos]);
    const camaras = datos?.camaras || [];
    // La cámara en alarma más reciente va al lugar grande.
    const grandeId = useMemo(() => {
        const conAlarma = camaras.filter((c) => porCamara.has(c.id) || atendiendo.has(c.id));
        if (!conAlarma.length) return null;
        conAlarma.sort((a, b) => (porCamara.get(b.id)?.[0]?.ts || "").localeCompare(porCamara.get(a.id)?.[0]?.ts || ""));
        return conAlarma[0].id;
    }, [camaras, porCamara, atendiendo]);
    const ordenadas = useMemo(() => grandeId ? [camaras.find((c) => c.id === grandeId)!, ...camaras.filter((c) => c.id !== grandeId)] : camaras, [camaras, grandeId]);

    // La franja: lo que llegó por el socket arriba de lo que trajo la consulta, sin repetir.
    const franja = useMemo(() => {
        const base = datos?.franja || [];
        const ids = new Set(base.map((x) => x.id));
        return [...nuevas.filter((x) => !ids.has(x.id)), ...base];
    }, [datos, nuevas]);
    const visibles = useMemo(() => franja.filter((d) => pasa(d, filtro)), [franja, filtro]);
    const cuenta = (f: Filtro) => franja.filter((d) => pasa(d, f)).length;
    const alternar = (f: Filtro) => setFiltro((x) => (x === f ? "todas" : f));

    // Sonido según el ajuste: una vez por alarma nueva, o repetir mientras haya pendientes.
    const modo = ajustes?.sonido?.intrusion || "off";
    const sonadas = useRef(new Set<string>());
    useEffect(() => {
        if (modo === "off" || silencio) return;
        const nuevasAl = vivas.filter((a) => !sonadas.current.has(a.id));
        if (nuevasAl.length) { sonar("alarma"); nuevasAl.forEach((a) => sonadas.current.add(a.id)); }
        if (modo !== "repetir" || !vivas.length) return;
        const iv = setInterval(() => sonar("alarma"), REPETIR_MS);
        return () => clearInterval(iv);
    }, [vivas, modo, silencio]);

    const n = camaras.length;
    const cols = grandeId ? 4 : n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const camAbierta = camId ? camaras.find((c) => c.id === camId) || null : null;
    const abrirCamara = useCallback((id: string) => { setDet(null); setCamId(id); }, []);

    return (
        <div className="absolute inset-0 flex flex-col p-4">
            <div className="flex-1 min-h-0 flex gap-4">
                <div className="flex-1 min-w-0 grid gap-4 auto-rows-fr" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                    {!datos && !error && <div className="col-span-full grid place-items-center text-[20px] text-muted-foreground">Cargando cámaras…</div>}
                    {error && !datos && <div className="col-span-full grid place-items-center text-[20px] text-[var(--mal-texto)]">No se pudo leer el monitor: {error}</div>}
                    {datos && n === 0 && <div className="col-span-full grid place-items-center text-[20px] text-muted-foreground">No hay cámaras de intrusión dadas de alta.</div>}
                    {ordenadas.map((c) => <Canal key={c.id} cam={c} pendientes={porCamara.get(c.id) || []} confirmada={atendiendo.has(c.id)} grande={c.id === grandeId} alTocar={() => abrirCamara(c.id)} />)}
                </div>

                {/* La franja: se desliza con el dedo y se filtra. Cada detección abre su ficha. */}
                <aside className="w-[340px] shrink-0 flex flex-col gap-2 min-h-0">
                    <div className="flex items-center justify-between px-1">
                        <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Últimas detecciones</span>
                        <span className="text-[13px] text-muted-foreground tabular-nums">{visibles.length}</span>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] shrink-0 pb-1">
                        {FILTROS.map((f) => (
                            <button key={f.v} type="button" onClick={() => setFiltro(f.v)} aria-pressed={filtro === f.v}
                                className={cn("h-11 px-3.5 rounded-full border text-[14px] font-semibold whitespace-nowrap", tocable,
                                    filtro === f.v ? "border-[var(--accion-en-oscuro)] bg-[color-mix(in_oklab,var(--accion-en-oscuro)_18%,transparent)] text-foreground" : "border-border text-muted-foreground")}>
                                {f.l} <span className="tabular-nums opacity-70">{cuenta(f.v)}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-2 pr-1 snap-y">
                        <AnimatePresence initial={false}>
                            {visibles.map((d) => <Renglon key={d.id} d={d} geom={camaras.find((c) => c.id === d.deviceId)?.geom} alTocar={() => setDet(d)} />)}
                        </AnimatePresence>
                        {datos && visibles.length === 0 && <div className="text-[15px] text-muted-foreground px-1 py-4 inline-flex items-center gap-2"><Clock size={16} /> {filtro === "todas" ? "Sin detecciones recientes" : "Ninguna con este filtro"}</div>}
                    </div>
                </aside>
            </div>

            <FichaCamara cam={camAbierta} pendientes={camAbierta ? porCamara.get(camAbierta.id) || [] : []} confirmada={!!camAbierta && atendiendo.has(camAbierta.id)}
                alCerrar={() => setCamId(null)} alAmpliar={setAmpliada} alVerDeteccion={(d) => { setCamId(null); setDet(d); }}
                decidir={puedeDecidir ? async (accion) => {
                    if (!camAbierta) return;
                    const id = camAbierta.id;
                    if (accion === "real" || accion === "false") { await ackAlarms(id, accion); if (accion === "real") await setAttending(id, true); setVivas((p) => p.filter((a) => a.deviceId !== id)); }
                    else { await setAttending(id, false); if (accion === "era-falsa") await reclasificarComoFalsa(id); }
                    recargar();
                } : undefined} />
            <FichaDeteccion d={det} geom={det ? camaras.find((c) => c.id === det.deviceId)?.geom : null} alCerrar={() => setDet(null)} alAmpliar={setAmpliada} alVerCamara={(id) => abrirCamara(id)}
                marcar={puedeDecidir ? async (id, kind) => { const r = await marcarDeteccion(id, kind); if (r.ok) { setDet((d) => (d && d.id === id ? { ...d, acknowledged: true, ackKind: kind } : d)); recargar(); } } : undefined} />
            <Ampliada src={ampliada} alCerrar={() => setAmpliada(null)} />
        </div>
    );
}

/** Tres números chicos lado a lado. */
function Cifras({ items }: { items: { l: string; v: number | null; c?: string }[] }) {
    return (
        <div className="grid grid-cols-3 gap-2">
            {items.map((x) => (
                <div key={x.l} className="rounded-xl bg-card border border-border px-3 py-2.5">
                    <div className={cn("text-[26px] font-bold tabular-nums leading-none", x.c)}>{x.v ?? "—"}</div>
                    <div className="text-[12.5px] text-muted-foreground mt-1">{x.l}</div>
                </div>
            ))}
        </div>
    );
}

/**
 * La ficha de una cámara: el vivo grande con su línea y su zona, si está en alarma y si está
 * armada, los números de hoy y sus últimas detecciones. Se lee de /api/monitor/intrusion/camara.
 */
type Decision = "real" | "false" | "resuelta" | "era-falsa";

function FichaCamara({ cam, pendientes, confirmada, alCerrar, alAmpliar, alVerDeteccion, decidir }: {
    cam: Cam | null; pendientes: Alarma[]; confirmada: boolean; alCerrar: () => void; alAmpliar: (f: string) => void; alVerDeteccion: (d: Det) => void;
    /** Sólo con sesión del panel y permiso de intrusión (ver monitor/layout). Sin esto, la ficha no decide. */
    decidir?: (accion: Decision) => Promise<void>;
}) {
    const [haciendo, setHaciendo] = useState<Decision | null>(null);
    const hacer = async (a: Decision) => { if (!decidir) return; setHaciendo(a); try { await decidir(a); } finally { setHaciendo(null); } };
    const [info, setInfo] = useState<{ detecciones: Det[]; hoy: Hoy } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [k, setK] = useState(0);
    const id = cam?.id || null;
    useEffect(() => {
        if (!id) return;
        setInfo(null); setError(null);
        fetch(`/api/monitor/intrusion/camara?id=${encodeURIComponent(id)}`, { cache: "no-store" })
            .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `El servidor respondió ${r.status}`); setInfo(j); })
            .catch((e) => setError(e?.message || "sin respuesta"));
        const iv = setInterval(() => setK((x) => x + 1), SNAPSHOT_FICHA_MS);
        return () => clearInterval(iv);
    }, [id]);
    const enAlarma = pendientes.length > 0 || confirmada;
    const vivo = id ? `/api/snapshot/${id}?w=960&t=${k}` : "";
    return (
        <CajonPared abierto={!!cam} titulo="Ficha de la cámara" alCerrar={alCerrar} cierraSoloMs={FICHA_SE_CIERRA_MS} ancho={640}>
            {cam && (
                <div className="p-5 space-y-5">
                    <div>
                        <div className="text-[26px] font-bold leading-tight">{cam.name}</div>
                        {cam.nvrName && <div className="text-[15px] text-muted-foreground inline-flex items-center gap-1.5 mt-0.5"><Server size={14} /> {cam.nvrName}{cam.ch != null ? ` · CH ${cam.ch}` : ""}</div>}
                    </div>
                    <button type="button" onClick={() => alAmpliar(`/api/snapshot/${cam.id}?t=${Date.now()}`)}
                        className={cn("relative block w-full aspect-video rounded-2xl overflow-hidden bg-neutral-900", tocable)} aria-label="Ver el vivo grande">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={vivo} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
                        <GeomOverlay geom={cam.geom} alert={enAlarma} />
                        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 text-[12px] font-bold uppercase tracking-wider text-white"><span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> Vivo</span>
                        <span className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white"><Maximize2 size={18} /></span>
                    </button>

                    {/* El estado, en una frase y en su tono. */}
                    <div className={cn("rounded-2xl px-4 py-3.5 flex items-center gap-3", enAlarma ? (pendientes.length ? "pleno-mal" : "pleno-aviso") : "bg-card border border-border")}>
                        {enAlarma ? <ShieldAlert size={28} className="shrink-0" /> : <ShieldCheck size={28} className="shrink-0 tono-bien" />}
                        <div className="min-w-0">
                            <div className="text-[18px] font-bold leading-tight">{pendientes.length ? `Intrusión detectada · ${pendientes.length} sin confirmar` : confirmada ? "Intrusión confirmada · sin resolver" : "Sin alarma"}</div>
                            <div className={cn("text-[14px] mt-0.5", enAlarma ? "opacity-90" : "text-muted-foreground")}>{enAlarma ? (decidir ? "Decidí desde acá: queda registrado igual que en el panel." : "Se confirma y se resuelve desde el panel de OmniAccess.") : "La cámara avisa sola si algo cruza su línea o entra a su zona."}</div>
                        </div>
                    </div>
                    {decidir && enAlarma && (
                        <div className="grid grid-cols-2 gap-2">
                            {pendientes.length ? (<>
                                <BotonDecision onClick={() => hacer("false")} cargando={haciendo === "false"} Icono={Ban} texto="Falsa alarma" />
                                <BotonDecision onClick={() => hacer("real")} cargando={haciendo === "real"} Icono={ShieldAlert} texto="Es real: la atiendo" tono="mal" />
                            </>) : (<>
                                <BotonDecision onClick={() => hacer("era-falsa")} cargando={haciendo === "era-falsa"} Icono={Ban} texto="Era falsa alarma" />
                                <BotonDecision onClick={() => hacer("resuelta")} cargando={haciendo === "resuelta"} Icono={ShieldCheck} texto="Resuelta" tono="accion" />
                            </>)}
                        </div>
                    )}
                    {cam.horarios && <div className="rounded-xl bg-neutral-900 px-4 py-3 [&_span]:!text-[13px]"><div className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/55 mb-1">Armado</div><ResumenArmado h={cam.horarios} /></div>}

                    <Cifras items={[{ l: "Detecciones hoy", v: info?.hoy.total ?? null }, { l: "Reales hoy", v: info?.hoy.reales ?? null, c: info?.hoy.reales ? "tono-mal" : undefined }, { l: "Falsas hoy", v: info?.hoy.falsas ?? null }]} />

                    <div>
                        <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-2">Últimas detecciones de esta cámara</div>
                        {error ? <p className="text-[15px] tono-mal">No se pudieron leer: {error}</p>
                            : !info ? <div className="py-6 grid place-items-center text-muted-foreground"><Loader2 size={22} className="animate-spin" /></div>
                                : info.detecciones.length === 0 ? <p className="text-[15px] text-muted-foreground">Todavía no detectó nada.</p>
                                    : <div className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
                                        {info.detecciones.map((d) => {
                                            const m = metaDe(d.type); const e = estadoDe(d); const f = fotoDe(d, 240);
                                            return (
                                                <button key={d.id} type="button" onClick={() => alVerDeteccion(d)} className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left bg-card min-h-[64px]", tocable)}>
                                                    <span className="relative w-24 h-14 rounded-lg overflow-hidden bg-neutral-900 shrink-0">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        {f && <img src={f} alt="" loading="lazy" draggable={false} className="absolute inset-0 w-full h-full object-cover" />}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="flex items-center gap-1.5 text-[15px] font-semibold"><m.Icon size={14} className={m.cls.split(" ")[0]} /> {m.label}{d.label && CLASE[d.label] ? <span className="text-muted-foreground font-normal">· {CLASE[d.label]}</span> : null}</span>
                                                        <span className="block text-[13px] text-muted-foreground tabular-nums">{fecha(d.timestamp)} · {horaCorta(d.timestamp)} · {hace(d.timestamp)}</span>
                                                    </span>
                                                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold uppercase shrink-0", e.c)}>{e.t}</span>
                                                    <ChevronRight size={18} className="text-muted-foreground shrink-0" />
                                                </button>
                                            );
                                        })}
                                    </div>}
                    </div>
                </div>
            )}
        </CajonPared>
    );
}

/** La ficha de una detección: la captura, qué fue, cuándo exactamente, de qué cámara y su estado. */
function FichaDeteccion({ d: d0, geom, alCerrar, alAmpliar, alVerCamara, marcar }: { d: Det | null; geom?: Geom | null; alCerrar: () => void; alAmpliar: (f: string) => void; alVerCamara: (id: string) => void; marcar?: (id: string, kind: "real" | "false") => Promise<void> }) {
    /* La verificación de una detección abierta desde la ficha de la cámara no viene en la franja:
       se pide aparte, y se vuelve a pedir cuando vision-worker avisa que la terminó. */
    const [verif, setVerif] = useState<Verificacion | null>(null);
    const pedir = useCallback(() => {
        if (!d0?.id) return;
        fetch(`/api/monitor/intrusion/verificacion?ids=${encodeURIComponent(d0.id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then((j: Record<string, Verificacion>) => setVerif(j?.[d0.id] || null)).catch(() => { });
    }, [d0?.id]);
    useEffect(() => { setVerif(null); if (d0 && !d0.verif?.analisis) pedir(); }, [d0?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useTiempoReal("detection_verified", (x: any) => { if (x?.id && x.id === d0?.id) pedir(); });
    const d = d0 ? { ...d0, verif: d0.verif?.analisis ? d0.verif : verif || d0.verif } : null;
    const [grabacion, setGrabacion] = useState(false);
    useEffect(() => { setGrabacion(false); }, [d?.id]);
    const [haciendo, setHaciendo] = useState<"real" | "false" | null>(null);
    const hacer = async (k: "real" | "false") => { if (!marcar || !d) return; setHaciendo(k); try { await marcar(d.id, k); } finally { setHaciendo(null); } };
    const m = d ? metaDe(d.type) : null;
    const e = d ? estadoDe(d) : null;
    const foto = d ? fotoGrande(d) : null;
    return (
        // Mientras se mira la grabación la ficha no se cierra sola: nadie toca la pantalla mientras mira un video.
        <CajonPared abierto={!!d} titulo="Ficha de la detección" alCerrar={alCerrar} cierraSoloMs={grabacion ? undefined : FICHA_SE_CIERRA_MS} ancho={760}>
            {d && m && e && (
                <div className="p-5 space-y-5">
                    <button type="button" disabled={!foto} onClick={() => foto && alAmpliar(foto)}
                        className={cn("relative block w-full aspect-video rounded-2xl overflow-hidden bg-neutral-900", foto && tocable)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {foto ? <img src={foto} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain bg-black" /> : <span className="absolute inset-0 grid place-items-center text-white/30"><Camera size={40} /></span>}
                        {foto && d.verif?.analisis && <CapaAnalisis analisis={d.verif.analisis} geom={geomDeIntrusion(geom)} />}
                        <span className="absolute top-3 left-3"><Veredicto d={d} grande /></span>
                        {foto && <span className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white"><Maximize2 size={18} /></span>}
                    </button>
                    <div className="flex items-start gap-3">
                        <span className={cn("grid h-14 w-14 place-items-center rounded-2xl shrink-0", m.cls)}><m.Icon size={26} /></span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[24px] font-bold leading-tight">{m.label}{d.label && CLASE[d.label] ? ` · ${CLASE[d.label]}` : ""}</div>
                            <div className="text-[16px] text-muted-foreground mt-0.5">{d.deviceName || "Cámara"}</div>
                        </div>
                        <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[13px] font-bold uppercase shrink-0", e.c)}><e.Ic size={14} /> {e.t}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-card border border-border px-4 py-3">
                            <div className="text-[12.5px] text-muted-foreground">Hora exacta</div>
                            <div className="text-[28px] font-bold tabular-nums leading-tight">{horaCorta(d.timestamp)}</div>
                            <div className="text-[13px] text-muted-foreground">{fecha(d.timestamp)} · {hace(d.timestamp)}</div>
                        </div>
                        <div className="rounded-xl bg-card border border-border px-4 py-3">
                            <div className="text-[12.5px] text-muted-foreground">Estado</div>
                            <div className="text-[18px] font-bold leading-tight mt-1">{!d.acknowledged ? "Esperando confirmación" : d.ackKind === "false" ? "Archivada como falsa alarma" : "Confirmada como real"}</div>
                            <div className="text-[13px] text-muted-foreground mt-0.5">{marcar ? "Se puede corregir abajo" : "Se decide desde el panel"}</div>
                        </div>
                    </div>
                    {marcar && (
                        <div className="grid grid-cols-2 gap-2">
                            {d.ackKind !== "false" && <BotonDecision onClick={() => hacer("false")} cargando={haciendo === "false"} Icono={Ban} texto={d.acknowledged ? "Era falsa alarma" : "Falsa alarma"} />}
                            {(d.ackKind === "false" || !d.acknowledged) && <BotonDecision onClick={() => hacer("real")} cargando={haciendo === "real"} Icono={ShieldAlert} texto={d.acknowledged ? "Era real" : "Fue real"} tono="mal" />}
                        </div>
                    )}
                    {d.deviceId && (
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setGrabacion(true)} className={cn("h-14 rounded-2xl bg-[var(--accion)] text-white text-[16px] font-bold inline-flex items-center justify-center gap-2", tocable)}>
                                <PlayCircle size={20} /> Ver la grabación
                            </button>
                            <button type="button" onClick={() => alVerCamara(d.deviceId!)} className={cn("h-14 rounded-2xl bg-muted text-foreground text-[16px] font-semibold inline-flex items-center justify-center gap-2", tocable)}>
                                <Camera size={20} /> La cámara en vivo
                            </button>
                        </div>
                    )}
                    {d.verif?.veredicto && (
                        <div className="rounded-xl bg-card border border-border px-4 py-3 flex items-start gap-3">
                            <ScanEye size={20} className="mt-0.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                                <div className="text-[16px] font-bold">omni-vision: {VEREDICTOS[d.verif.veredicto].rotulo}</div>
                                <div className="text-[14px] text-muted-foreground leading-snug">{VEREDICTOS[d.verif.veredicto].explica}{d.verif.tocan.some(Boolean) ? " En rojo, la parte que toca." : ""} Es una ayuda: la alarma la decide una persona.</div>
                            </div>
                        </div>
                    )}
                    <AnalisisDeteccion id={d.id} grande />
                    {grabacion && d.deviceId && <VerGrabacion deviceId={d.deviceId} nombre={d.deviceName} instanteMs={new Date(d.timestamp).getTime()} canal={d.ch ?? null} onClose={() => setGrabacion(false)} />}
                </div>
            )}
        </CajonPared>
    );
}

/** Un botón de decisión de 56 px: grande para el dedo, con su espera mientras el servidor contesta. */
function BotonDecision({ onClick, cargando, Icono, texto, tono }: { onClick: () => void; cargando: boolean; Icono: any; texto: string; tono?: "mal" | "accion" }) {
    return (
        <button type="button" onClick={onClick} disabled={cargando}
            className={cn("h-14 rounded-2xl text-[16px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60", tocable, tono === "mal" ? "pleno-mal" : tono === "accion" ? "bg-[var(--accion)] text-white" : "bg-muted text-foreground")}>
            {cargando ? <Loader2 size={20} className="animate-spin" /> : <Icono size={20} />} {texto}
        </button>
    );
}
