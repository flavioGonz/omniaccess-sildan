"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sileo } from "sileo";
import {
    Wand2, X, Check, Loader2, RefreshCw, AlertTriangle, Minus, Hexagon, ArrowLeftRight, ArrowRight, ArrowLeft,
    BellRing, Send, Save, RotateCcw, Trash2, Radar, Plus, PencilLine, Eye, EyeOff, ShieldCheck, Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PtzControls } from "@/components/PtzControls";

/**
 * Calibrador de INTRUSIÓN: el video en vivo con TODAS las líneas y zonas de la cámara encima, y al
 * costado la lista para agregarlas, editarlas, apagarlas y borrarlas.
 *
 * Lo que se calibra es la analítica de la cámara (AcuSense / Smart Event Hikvision, IVS Dahua):
 * cada LÍNEA de cruce con su sentido y cada ZONA de intrusión con su tiempo de permanencia, las
 * dos con su SENSIBILIDAD y su OBJETIVO (persona, vehículo o ambos); y que la cámara le AVISE a
 * OmniAccess (servidor de alarmas).
 *
 * ## Por qué se rehízo (23/10, Nico)
 *
 * «No puedo eliminar analíticas creadas… los dispositivos siempre tienen varias… que se guarde
 * perfecto». La versión anterior veía una línea y una zona (la cámara tiene hasta 4 de cada una),
 * «Limpiar» + «Guardar» chocaba con «la línea necesita 2 puntos», la sensibilidad y el objetivo
 * mandaban un pedido que la API no entendía, y prendía la analítica entera pero no la línea: en
 * dos cámaras del lab la línea se veía «dibujada» y la cámara no la usaba.
 *
 * Ahora se edita un BORRADOR y «Guardar en la cámara» manda todo junto, vuelve a leer la cámara y
 * compara: si algo no quedó como se pidió, se dice qué. Sin eso no hay forma de saber si se guardó.
 */

const toast = {
    success: (title: string, o?: { description?: string }) => sileo.success({ title, description: o?.description }),
    error: (title: string, o?: { description?: string }) => sileo.error({ title, description: o?.description }),
};

type P = { x: number; y: number }; // % de pantalla (0–100), origen arriba-izquierda
const camToScreen = (p: { x: number; y: number }): P => ({ x: p.x / 10, y: (1000 - p.y) / 10 });
const screenToCam = (p: P) => ({ x: Math.round(p.x * 10), y: Math.round(1000 - p.y * 10) });
const SNAP = 1.5;
const snap = (v: number) => (v < SNAP ? 0 : v > 100 - SNAP ? 100 : v);
type Dir = "both" | "ab" | "ba";
type Tipo = "linea" | "zona";

/** Una regla tal como la edita la pantalla. `clave` = l1, z3…: el tipo y su lugar en la cámara. */
type Regla = {
    clave: string; tipo: Tipo; id: number;
    enabled: boolean; points: P[];
    direction: Dir; sensibilidad: number | null; objetivo: string | null; tiempo: number | null;
    /** Recién agregada: en la cámara ese lugar está vacío. */
    nueva?: boolean;
    /** Marcada para borrar al guardar. */
    borrar?: boolean;
};
type Datos = {
    marca: "hikvision" | "dahua";
    lineas: { max: number; reglas: any[] } | null;
    zonas: { max: number; reglas: any[] } | null;
    limites: { zonaMin: number; zonaMax: number };
    edita: { varias: boolean; borrar: boolean; ajustes: boolean; motivo?: string };
};

const OBJETIVOS: { v: string; t: string }[] = [{ v: "human", t: "Persona" }, { v: "vehicle", t: "Vehículo" }, { v: "human,vehicle", t: "Ambos" }];
const DIR_TXT: Record<Dir, string> = { ab: "A→B", both: "Ambos", ba: "B→A" };
const nombre = (r: { tipo: Tipo; id: number }) => `${r.tipo === "linea" ? "Línea" : "Zona"} ${r.id}`;
const COLOR: Record<Tipo, string> = { linea: "#38bdf8", zona: "#f43f5e" };
const mismoObjetivo = (a: string | null, b: string | null) => (a || "").split(",").sort().join(",") === (b || "").split(",").sort().join(",");
const mismosPuntos = (a: P[], b: P[]) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 0.15 && Math.abs(p.y - b[i].y) < 0.15);

function desdeApi(tipo: Tipo, r: any): Regla {
    return {
        clave: `${tipo === "linea" ? "l" : "z"}${r.id}`, tipo, id: r.id, enabled: !!r.enabled,
        points: (r.points || []).map(camToScreen), direction: (r.direction || "both") as Dir,
        sensibilidad: r.sensibilidad ?? null, objetivo: r.objetivo ?? null, tiempo: r.tiempo ?? null,
    };
}

/** Lo que falta para que la regla se pueda guardar, o null. */
function falta(r: Regla, lim: Datos["limites"]): string | null {
    if (r.borrar) return null;
    if (r.tipo === "linea" && (r.points.length !== 2 || mismosPuntos([r.points[0]], [r.points[1]]))) return "marcá los 2 extremos";
    if (r.tipo === "zona" && r.points.length < lim.zonaMin) return `marcá al menos ${lim.zonaMin} vértices`;
    if (r.tipo === "zona" && r.points.length > lim.zonaMax) return `hasta ${lim.zonaMax} vértices`;
    return null;
}

/** El cambio de una regla respecto de lo que hay en la cámara (sólo lo que cambió), o null. */
function cambioDe(r: Regla, o: Regla | undefined): any | null {
    if (r.borrar) return o ? { id: r.id, borrar: true } : null;
    const c: any = { id: r.id };
    if (!o || r.nueva) {
        Object.assign(c, { points: r.points.map(screenToCam), enabled: r.enabled });
        if (r.tipo === "linea") c.direction = r.direction;
        if (r.sensibilidad != null) c.sensibilidad = r.sensibilidad;
        if (r.objetivo) c.objetivo = r.objetivo;
        if (r.tipo === "zona" && r.tiempo != null) c.tiempo = r.tiempo;
        return c;
    }
    if (!mismosPuntos(r.points, o.points)) c.points = r.points.map(screenToCam);
    if (r.enabled !== o.enabled) c.enabled = r.enabled;
    if (r.tipo === "linea" && r.direction !== o.direction) c.direction = r.direction;
    if (r.sensibilidad != null && r.sensibilidad !== o.sensibilidad) c.sensibilidad = r.sensibilidad;
    if (r.objetivo && !mismoObjetivo(r.objetivo, o.objetivo)) c.objetivo = r.objetivo;
    if (r.tipo === "zona" && r.tiempo != null && r.tiempo !== o.tiempo) c.tiempo = r.tiempo;
    return Object.keys(c).length > 1 ? c : null;
}

/* ─────────────────────────── Video en vivo (go2rtc) ─────────────────────────── */
function LiveVideo({ streamName, deviceId }: { streamName: string; deviceId: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const video = videoRef.current; if (!video || !streamName) { setFailed(true); return; }
        let tries = 0, stopped = false, wd: any = null;
        const src = () => `/go2rtc/api/stream.mp4?src=${encodeURIComponent(streamName)}&video=h264&t=${Date.now()}`;
        const arm = () => { clearTimeout(wd); wd = setTimeout(() => { if (stopped) return; if ((video.readyState < 3 || video.paused) && tries++ < 6) start(); else if (tries >= 6) setFailed(true); }, 3500); };
        const start = () => { if (stopped) return; setFailed(false); try { video.src = src(); video.play().catch(() => { }); } catch { } arm(); };
        const onErr = () => { if (stopped) return; if (tries++ < 6) setTimeout(start, 1300); else setFailed(true); };
        const onPlaying = () => { clearTimeout(wd); tries = 0; };
        video.addEventListener("error", onErr); video.addEventListener("playing", onPlaying);
        start();
        return () => { stopped = true; clearTimeout(wd); video.removeEventListener("error", onErr); video.removeEventListener("playing", onPlaying); try { video.pause(); video.removeAttribute("src"); video.load(); } catch { } };
    }, [streamName]);
    if (failed) return <SnapFallback deviceId={deviceId} />;
    return <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-fill" />;
}
function SnapFallback({ deviceId }: { deviceId: string }) {
    const [src, setSrc] = useState(`/api/snapshot/${deviceId}?t=${Date.now()}`);
    useEffect(() => { const iv = setInterval(() => setSrc(`/api/snapshot/${deviceId}?t=${Date.now()}`), 2000); return () => clearInterval(iv); }, [deviceId]);
    return <img src={src} alt="" className="absolute inset-0 w-full h-full object-fill" />;
}

/* ─────────────────────────── SVG animados por concepto ─────────────────────────── */
function CalSvg({ kind }: { kind: string }) {
    const s = "currentColor";
    if (kind === "line") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-sky-300">
            <line x1="10" y1="54" x2="54" y2="10" stroke={s} strokeWidth="3" strokeDasharray="5 4" />
            <motion.g animate={{ x: [-14, 14] }} transition={{ duration: 1.8, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}>
                <circle cx="32" cy="22" r="4" fill={s} /><rect x="29" y="27" width="6" height="14" rx="3" fill={s} />
            </motion.g>
        </svg>
    );
    if (kind === "zone") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-rose-300">
            <motion.polygon points="10,18 50,10 56,46 16,54" fill={s} animate={{ opacity: [0.12, 0.35, 0.12] }} transition={{ duration: 1.6, repeat: Infinity }} />
            <polygon points="10,18 50,10 56,46 16,54" fill="none" stroke={s} strokeWidth="2.5" />
        </svg>
    );
    if (kind === "dir") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-amber-300">
            <line x1="32" y1="8" x2="32" y2="56" stroke={s} strokeWidth="2" strokeDasharray="4 4" />
            <motion.path d="M14 32 h28 l-7 -7 M42 32 l-7 7" stroke={s} strokeWidth="3" fill="none" strokeLinecap="round" animate={{ x: [-4, 6, -4] }} transition={{ duration: 1.4, repeat: Infinity }} />
        </svg>
    );
    if (kind === "sens") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-cyan-300">
            {[10, 18, 26].map((r, i) => (
                <motion.circle key={r} cx="32" cy="32" r={r} fill="none" stroke={s} strokeWidth="2" animate={{ opacity: [0, 1, 0], scale: [0.8, 1.1, 0.8] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3 }} style={{ transformOrigin: "32px 32px" }} />
            ))}
            <circle cx="32" cy="32" r="3" fill={s} />
        </svg>
    );
    if (kind === "target") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-emerald-300">
            <motion.g animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                <circle cx="20" cy="18" r="5" fill={s} /><rect x="16" y="24" width="8" height="18" rx="4" fill={s} />
            </motion.g>
            <motion.g animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 2, repeat: Infinity }}>
                <rect x="32" y="30" width="26" height="12" rx="4" fill={s} /><circle cx="38" cy="46" r="4" fill={s} /><circle cx="52" cy="46" r="4" fill={s} />
            </motion.g>
        </svg>
    );
    if (kind === "alarm") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-red-300">
            <motion.path d="M32 10 c-10 0 -16 8 -16 18 v10 l-6 8 h44 l-6 -8 v-10 c0 -10 -6 -18 -16 -18z" fill={s} style={{ transformOrigin: "32px 12px" }} animate={{ rotate: [-12, 12, -12] }} transition={{ duration: 0.9, repeat: Infinity }} />
            <circle cx="32" cy="52" r="4" fill={s} />
        </svg>
    );
    if (kind === "test") return (
        <svg viewBox="0 0 64 64" className="w-16 h-16 text-violet-300">
            <motion.path d="M8 32 L56 12 L44 56 L32 36 Z" fill={s} animate={{ x: [-6, 6, -6], opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.4, repeat: Infinity }} />
        </svg>
    );
    return <Wand2 className="w-16 h-16 text-orange-300" />;
}

export function IntrusionCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const isPtz = /ptz/i.test(device?.name || "");
    const [datos, setDatos] = useState<Datos | null>(null);
    /** Lo que hay en la cámara (para saber qué cambió) y el borrador que se edita. */
    const [original, setOriginal] = useState<Regla[]>([]);
    const [reglas, setReglas] = useState<Regla[]>([]);
    const [sel, setSel] = useState<string | null>(null);
    const [dibujando, setDibujando] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [alarma, setAlarma] = useState<boolean | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    /** Resultado de la última escritura: la cámara releída comparada con lo pedido. */
    const [verificado, setVerificado] = useState<null | { ok: boolean; diferencias: string[] }>(null);
    const [confirm, setConfirm] = useState<null | { titulo: string; detalle: string; lista?: string[]; svg: string; boton?: string; hacer: () => Promise<void> | void }>(null);
    const [autoSteps, setAutoSteps] = useState<{ key: string; label: string; status: "pending" | "ok" | "fail"; error?: string }[]>([]);
    const [videoNonce, setVideoNonce] = useState(0);
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<number | null>(null);

    const cargar = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const d = await fetch(`/api/devices/analytics?deviceId=${device.id}`, { cache: "no-store" }).then((r) => r.json());
            if (!d.ok) { setError(d.error || "No se pudo leer la cámara"); setDatos(null); setOriginal([]); setReglas([]); }
            else {
                const lista = [
                    ...(d.lineas?.reglas || []).filter((r: any) => !r.vacia).map((r: any) => desdeApi("linea", r)),
                    ...(d.zonas?.reglas || []).filter((r: any) => !r.vacia).map((r: any) => desdeApi("zona", r)),
                ];
                setDatos({ marca: d.marca || "hikvision", lineas: d.lineas || null, zonas: d.zonas || null, limites: d.limites || { zonaMin: 3, zonaMax: 10 }, edita: d.edita || { varias: false, borrar: false, ajustes: false } });
                setOriginal(lista); setReglas(lista); setDibujando(false);
                setSel((s) => (s && lista.some((r) => r.clave === s) ? s : null));
            }
        } catch { setError("Error de conexión con la cámara"); }
        finally { setLoading(false); }
        fetch(`/api/devices/alarm-host?deviceId=${device.id}`, { cache: "no-store" }).then((r) => r.json()).then((a) => setAlarma(!!(a?.hasOmni || (a?.dahua && a?.ok)))).catch(() => setAlarma(null));
    }, [device.id]);
    useEffect(() => { cargar(); }, [cargar]);

    const porClave = useMemo(() => new Map(original.map((r) => [r.clave, r])), [original]);
    const cambios = useMemo(() => {
        const lineas: any[] = [], zonas: any[] = [];
        for (const r of reglas) { const c = cambioDe(r, porClave.get(r.clave)); if (c) (r.tipo === "linea" ? lineas : zonas).push(c); }
        return { lineas, zonas, n: lineas.length + zonas.length };
    }, [reglas, porClave]);
    const actual = reglas.find((r) => r.clave === sel) || null;
    const lim = datos?.limites || { zonaMin: 3, zonaMax: 10 };

    const cerrar = useCallback(() => {
        if (cambios.n) setConfirm({ titulo: "Hay cambios sin guardar", detalle: `${cambios.n} cambio${cambios.n === 1 ? "" : "s"} no se escribieron en la cámara.`, svg: "alarm", boton: "Salir sin guardar", hacer: () => onClose() });
        else onClose();
    }, [cambios.n, onClose]);
    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (confirm) setConfirm(null); else if (dibujando) setDibujando(false); else cerrar(); };
        window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
    }, [cerrar, dibujando, confirm]);

    const cambiar = (clave: string, f: (r: Regla) => Regla) => { setVerificado(null); setReglas((l) => l.map((r) => (r.clave === clave ? f(r) : r))); };

    /** El primer lugar libre de la cámara para ese tipo (vacío allá y no usado en el borrador). */
    const libre = (tipo: Tipo): number | null => {
        const max = (tipo === "linea" ? datos?.lineas?.max : datos?.zonas?.max) || 0;
        for (let id = 1; id <= max; id++) if (!reglas.some((r) => r.tipo === tipo && r.id === id)) return id;
        return null;
    };
    const agregar = (tipo: Tipo) => {
        const id = libre(tipo); if (!id) return;
        // De base, los ajustes de otra regla del mismo tipo: lo habitual es que todas vigilen lo mismo.
        const modelo = reglas.find((r) => r.tipo === tipo && !r.borrar);
        const r: Regla = { clave: `${tipo === "linea" ? "l" : "z"}${id}`, tipo, id, enabled: true, points: [], direction: "both", sensibilidad: modelo?.sensibilidad ?? 50, objetivo: modelo?.objetivo ?? "human", tiempo: tipo === "zona" ? (modelo?.tiempo ?? 0) : null, nueva: true };
        setVerificado(null); setReglas((l) => [...l, r]); setSel(r.clave); setDibujando(true);
    };
    const quitar = (r: Regla) => {
        // Una nueva todavía no está en la cámara: se saca del borrador. Una existente se marca y se borra al guardar.
        if (r.nueva || !porClave.has(r.clave)) { setReglas((l) => l.filter((x) => x.clave !== r.clave)); setSel(null); setDibujando(false); }
        else cambiar(r.clave, (x) => ({ ...x, borrar: !x.borrar }));
    };
    const deshacer = (r: Regla) => { const o = porClave.get(r.clave); if (o) cambiar(r.clave, () => o); else quitar(r); };

    const guardar = async () => {
        const mal = reglas.map((r) => ({ r, f: falta(r, lim) })).find((x) => x.f);
        if (mal) { setSel(mal.r.clave); setDibujando(true); toast.error(`${nombre(mal.r)}: ${mal.f}`); return; }
        setGuardando(true); setConfirm(null);
        try {
            const r = await fetch(`/api/devices/analytics?deviceId=${device.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineas: cambios.lineas, zonas: cambios.zonas }) });
            const j = await r.json().catch(() => ({}));
            if (!j.ok) throw new Error(j.error || "La cámara no aceptó el cambio");
            const dif: string[] = j.diferencias || [];
            setVerificado({ ok: !dif.length, diferencias: dif });
            if (dif.length) toast.error("La cámara no quedó igual a lo pedido", { description: dif.join(" · ") });
            else toast.success("Guardado y verificado", { description: "Se volvió a leer la cámara: quedó exactamente así" });
            setTimeout(() => setVideoNonce((n) => n + 1), 600);
            await cargar();
        } catch (e: any) { toast.error("No se pudo guardar", { description: e?.message }); }
        finally { setGuardando(false); }
    };
    const pedirGuardar = () => {
        const lista = reglas.map((r) => {
            const c = cambioDe(r, porClave.get(r.clave)); if (!c) return null;
            if (c.borrar) return `${nombre(r)}: se borra`;
            if (r.nueva) return `${nombre(r)}: nueva${r.enabled ? "" : " (apagada)"}`;
            const que = [c.points && "geometría", c.enabled !== undefined && (c.enabled ? "se prende" : "se apaga"), c.direction && `sentido ${DIR_TXT[c.direction as Dir]}`, c.sensibilidad != null && `sensibilidad ${c.sensibilidad}`, c.objetivo && `objetivo ${OBJETIVOS.find((o) => o.v === c.objetivo)?.t || c.objetivo}`, c.tiempo != null && `tiempo ${c.tiempo} s`].filter(Boolean);
            return `${nombre(r)}: ${que.join(", ")}`;
        }).filter(Boolean) as string[];
        setConfirm({ titulo: `Guardar ${lista.length} cambio${lista.length === 1 ? "" : "s"} en la cámara`, detalle: "Se escribe todo junto y después se vuelve a leer la cámara para comprobar que quedó igual.", lista, svg: "test", boton: "Guardar", hacer: guardar });
    };

    const aplicarAccion = async (key: string, titulo: string, fn: () => Promise<void>) => {
        setBusy(key); setConfirm(null);
        try { await fn(); toast.success(titulo, { description: "Aplicado en la cámara" }); await cargar(); }
        catch (e: any) { toast.error("No se pudo aplicar", { description: e?.message }); }
        finally { setBusy(null); }
    };
    const servidor = () => setConfirm({ titulo: "Configurar el servidor de alarmas", detalle: "Que la cámara le avise a OmniAccess cada detección. Se agrega OmniAccess sin borrar los otros servidores que ya tenga la cámara.", svg: "alarm", hacer: () => aplicarAccion("alarm", "Servidor de alarmas configurado", async () => {
        const a = await fetch(`/api/devices/alarm-host?deviceId=${device.id}`, { method: "POST" }).then((r) => r.json());
        if (!a?.ok) throw new Error(a?.error || "La cámara no aceptó el servidor");
    }) });
    const probar = () => setConfirm({ titulo: "Mandar un aviso de prueba", detalle: "La cámara manda un aviso a OmniAccess para confirmar que el camino completo anda (cámara → red → servidor).", svg: "test", hacer: () => aplicarAccion("test", "La cámara llegó a OmniAccess", async () => {
        const a = await fetch(`/api/devices/alarm-host?deviceId=${device.id}&action=test`, { method: "POST" }).then((r) => r.json());
        if (!a?.ok) throw new Error(a?.error || "No llegó el aviso de prueba");
    }) });

    /* Auto-perfil perímetro: en el BORRADOR, sensibilidad 60 y personas+vehículos en todas; y el aviso a OmniAccess. */
    const auto = async () => {
        setConfirm(null);
        const pasos = [{ key: "reglas", label: "Sensibilidad 60 y objetivo personas y vehículos en todas las reglas (queda en el borrador)" }, { key: "alarm", label: "Servidor de alarmas → OmniAccess" }];
        setAutoSteps(pasos.map((p) => ({ ...p, status: "pending" })));
        const marcar = (k: string, ok: boolean, error?: string) => setAutoSteps((xs) => xs.map((x) => (x.key === k ? { ...x, status: ok ? "ok" : "fail", error } : x)));
        if (!reglas.length) marcar("reglas", false, "no hay líneas ni zonas: dibujá una primero");
        else { setVerificado(null); setReglas((l) => l.map((r) => (r.borrar ? r : { ...r, sensibilidad: r.sensibilidad != null ? 60 : r.sensibilidad, objetivo: r.objetivo != null ? "human,vehicle" : r.objetivo }))); marcar("reglas", true); }
        try { const a = await fetch(`/api/devices/alarm-host?deviceId=${device.id}`, { method: "POST" }).then((r) => r.json()); marcar("alarm", !!a?.ok, a?.ok ? undefined : a?.error); } catch (e: any) { marcar("alarm", false, e?.message); }
        fetch(`/api/devices/alarm-host?deviceId=${device.id}`, { cache: "no-store" }).then((r) => r.json()).then((a) => setAlarma(!!(a?.hasOmni || (a?.dahua && a?.ok)))).catch(() => { });
    };

    // ── dibujo sobre el vivo ──
    const evtPct = (e: React.PointerEvent): P => { const r = svgRef.current!.getBoundingClientRect(); return { x: snap(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))), y: snap(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))) }; };
    const onDown = (e: React.PointerEvent) => {
        if (!dibujando || !actual || drag.current != null) return;
        const p = evtPct(e);
        cambiar(actual.clave, (r) => ({ ...r, points: r.tipo === "linea" ? (r.points.length >= 2 ? [r.points[1], p] : [...r.points, p]) : r.points.length >= lim.zonaMax ? r.points : [...r.points, p] }));
    };
    const onMove = (e: React.PointerEvent) => { if (drag.current == null || !actual) return; const p = evtPct(e); const i = drag.current; cambiar(actual.clave, (r) => ({ ...r, points: r.points.map((q, k) => (k === i ? p : q)) })); };
    const flechas = (l: P[], d: Dir, color: string) => {
        if (l.length !== 2) return null;
        const m = { x: (l[0].x + l[1].x) / 2, y: (l[0].y + l[1].y) / 2 };
        const dx = l[1].x - l[0].x, dy = l[1].y - l[0].y, len = Math.hypot(dx, dy) || 1; const nx = -dy / len, ny = dx / len;
        const una = (sg: 1 | -1) => <line key={sg} x1={m.x} y1={m.y} x2={m.x + nx * sg * 6} y2={m.y + ny * sg * 6} stroke={color} strokeWidth={2.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" markerEnd="url(#punta-intr)" />;
        return <>{(d === "both" || d === "ab") && una(1)}{(d === "both" || d === "ba") && una(-1)}</>;
    };
    const rotulo = (r: Regla) => {
        const p = r.tipo === "linea" ? (r.points.length === 2 ? { x: (r.points[0].x + r.points[1].x) / 2, y: (r.points[0].y + r.points[1].y) / 2 } : r.points[0]) : r.points.length ? { x: r.points.reduce((s, q) => s + q.x, 0) / r.points.length, y: r.points.reduce((s, q) => s + q.y, 0) / r.points.length } : null;
        return p ? <text x={p.x} y={p.y - 1.8} textAnchor="middle" fontSize="2.1" fontWeight="800" fill="#fff" stroke="#000" strokeWidth={0.35} paintOrder="stroke" style={{ pointerEvents: "none" }}>{r.tipo === "linea" ? "L" : "Z"}{r.id}</text> : null;
    };

    const lineas = reglas.filter((r) => r.tipo === "linea");
    const zonas = reglas.filter((r) => r.tipo === "zona");
    const sinAnalitica = !!datos && !datos.lineas && !datos.zonas;

    // Funciones y no componentes: un componente definido acá adentro se vuelve a montar en cada
    // render, y el deslizador de sensibilidad se soltaba a mitad del arrastre.
    const tarjeta = (r: Regla) => {
        const o = porClave.get(r.clave);
        const cambiada = !!cambioDe(r, o);
        const abierta = sel === r.clave;
        const f = falta(r, lim);
        const color = COLOR[r.tipo];
        return (
            <div key={r.clave} className={cn("rounded-[10px] border transition", abierta ? "border-white/25 bg-white/[0.07]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]", r.borrar && "opacity-60")}>
                <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer" onClick={() => { setSel(abierta ? null : r.clave); setDibujando(false); }}>
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className={cn("text-[12.5px] font-semibold text-white flex-1 truncate", r.borrar && "line-through")}>{nombre(r)}</span>
                    {r.nueva && <span className="text-[9.5px] font-bold uppercase tracking-wide text-sky-300">nueva</span>}
                    {!r.nueva && r.borrar && <span className="text-[9.5px] font-bold uppercase tracking-wide text-red-300">se borra</span>}
                    {!r.nueva && !r.borrar && cambiada && <span className="text-[9.5px] font-bold uppercase tracking-wide text-amber-300">cambiada</span>}
                    {f && !r.borrar && <span title={f}><AlertTriangle size={13} className="text-amber-300" /></span>}
                    <button onClick={(e) => { e.stopPropagation(); if (!r.borrar) cambiar(r.clave, (x) => ({ ...x, enabled: !x.enabled })); }} disabled={r.borrar}
                        title={r.enabled ? "Prendida: la cámara la vigila. Tocá para apagarla sin borrarla." : "Apagada: queda dibujada pero la cámara no la usa. Tocá para prenderla."}
                        className={cn("h-6 px-2 rounded-full text-[10px] font-bold inline-flex items-center gap-1", r.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-white/[0.08] text-white/50")}>
                        {r.enabled ? <Eye size={11} /> : <EyeOff size={11} />}{r.enabled ? "Prendida" : "Apagada"}
                    </button>
                </div>
                {abierta && !r.borrar && (
                    <div className="px-2.5 pb-2.5 space-y-2.5 border-t border-white/10 pt-2.5">
                        <div className="flex gap-1.5">
                            <button onClick={() => setDibujando((v) => !v)} className={cn("flex-1 h-8 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5", dibujando ? "bg-amber-400 text-black" : "bg-white/[0.08] text-white hover:bg-white/[0.14]")}>
                                <PencilLine size={13} /> {dibujando ? "Listo" : r.points.length ? "Redibujar" : "Dibujar"}
                            </button>
                            {dibujando && <button onClick={() => cambiar(r.clave, (x) => ({ ...x, points: [] }))} className="h-8 px-2.5 rounded-lg bg-white/[0.08] text-white/80 hover:bg-white/[0.14] text-[11px] font-semibold inline-flex items-center gap-1"><Trash2 size={12} /> Limpiar</button>}
                        </div>
                        {dibujando && <p className="text-[10.5px] text-white/55 leading-snug">{r.tipo === "linea" ? "Tocá los 2 extremos sobre el video; arrastrá un punto para ajustarlo." : `Tocá para agregar vértices (${lim.zonaMin} a ${lim.zonaMax}); arrastrá para mover; doble clic borra un vértice.`}</p>}
                        {r.tipo === "linea" && (
                            <Campo t="Sentido del cruce">
                                <div className="inline-flex rounded-lg bg-white/[0.06] p-0.5 w-full">
                                    {(["ab", "both", "ba"] as Dir[]).map((v) => {
                                        const I = v === "ab" ? ArrowRight : v === "ba" ? ArrowLeft : ArrowLeftRight;
                                        return <button key={v} onClick={() => cambiar(r.clave, (x) => ({ ...x, direction: v }))} className={cn("flex-1 h-7 rounded-md text-[11px] font-bold inline-flex items-center justify-center gap-1", r.direction === v ? "bg-amber-400 text-black" : "text-white/70 hover:text-white")}><I size={12} /> {DIR_TXT[v]}</button>;
                                    })}
                                </div>
                            </Campo>
                        )}
                        {datos?.edita.ajustes && r.objetivo != null && (
                            <Campo t="Qué la dispara">
                                <div className="inline-flex rounded-lg bg-white/[0.06] p-0.5 w-full">
                                    {OBJETIVOS.map((ob) => <button key={ob.v} onClick={() => cambiar(r.clave, (x) => ({ ...x, objetivo: ob.v }))} className={cn("flex-1 h-7 rounded-md text-[11px] font-bold", mismoObjetivo(r.objetivo, ob.v) ? "bg-white text-black" : "text-white/70 hover:text-white")}>{ob.t}</button>)}
                                </div>
                            </Campo>
                        )}
                        {datos?.edita.ajustes && r.sensibilidad != null && (
                            <Campo t={`Sensibilidad · ${r.sensibilidad}`} ayuda="Alta detecta todo (también hojas y sombras); baja sólo lo evidente. En perímetro con vegetación, 40–60.">
                                <input type="range" min={1} max={100} value={r.sensibilidad} onChange={(e) => cambiar(r.clave, (x) => ({ ...x, sensibilidad: Number(e.target.value) }))} className="w-full accent-amber-400" />
                            </Campo>
                        )}
                        {datos?.edita.ajustes && r.tipo === "zona" && r.tiempo != null && (
                            <Campo t={`Permanencia · ${r.tiempo} s`} ayuda="Cuánto tiene que quedarse adentro para avisar. 0 = apenas entra.">
                                <input type="range" min={0} max={10} value={r.tiempo} onChange={(e) => cambiar(r.clave, (x) => ({ ...x, tiempo: Number(e.target.value) }))} className="w-full accent-rose-400" />
                            </Campo>
                        )}
                        <div className="flex gap-1.5 pt-0.5">
                            {cambiada && !r.nueva && <button onClick={() => deshacer(r)} className="h-7 px-2.5 rounded-lg bg-white/[0.06] text-white/75 hover:bg-white/[0.12] text-[11px] font-semibold inline-flex items-center gap-1"><Undo2 size={12} /> Deshacer</button>}
                            <div className="flex-1" />
                            {(r.nueva || datos?.edita.borrar) && <button onClick={() => quitar(r)} className="h-7 px-2.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25 text-[11px] font-bold inline-flex items-center gap-1"><Trash2 size={12} /> {r.nueva ? "Descartar" : "Borrar"}</button>}
                        </div>
                    </div>
                )}
                {abierta && r.borrar && (
                    <div className="px-2.5 pb-2.5 flex items-center gap-2 text-[11px] text-white/60 border-t border-white/10 pt-2">
                        Se borra de la cámara al guardar.
                        <button onClick={() => quitar(r)} className="ml-auto h-7 px-2.5 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.14] font-semibold inline-flex items-center gap-1"><Undo2 size={12} /> No borrar</button>
                    </div>
                )}
            </div>
        );
    };

    const seccion = (tipo: Tipo, lista: Regla[]) => {
        const lado = tipo === "linea" ? datos?.lineas : datos?.zonas;
        if (!lado) return null;
        const usadas = reglas.filter((r) => r.tipo === tipo).length;
        const puede = !!libre(tipo) && (datos!.edita.varias || usadas === 0);
        return (
            <div className="space-y-1.5">
                <div className="flex items-center gap-2 px-0.5">
                    {tipo === "linea" ? <Minus size={14} className="text-sky-300" /> : <Hexagon size={14} className="text-rose-300" />}
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/60 flex-1">{tipo === "linea" ? "Líneas de cruce" : "Zonas de intrusión"} · {usadas}/{lado.max}</span>
                    <button onClick={() => agregar(tipo)} disabled={!puede || loading} title={puede ? `Agregar una ${tipo === "linea" ? "línea" : "zona"}` : `La cámara no tiene más lugares`}
                        className="h-7 px-2.5 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.14] text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-35"><Plus size={13} /> {tipo === "linea" ? "Línea" : "Zona"}</button>
                </div>
                {lista.length ? lista.map((r) => tarjeta(r)) : <p className="text-[11px] text-white/40 px-1 py-1.5">Ninguna.</p>}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/95 backdrop-blur-sm p-3 md:p-6 animate-in fade-in duration-200">
            <div className="relative w-full max-w-7xl h-[90vh] rounded-[14px] overflow-hidden bg-black border border-white/10 flex flex-col">
                <div className="relative flex-1 min-h-0 flex">
                    {/* ── El video, con todo dibujado encima ── */}
                    <div className="relative flex-1 min-w-0 bg-black">
                        <div className="absolute inset-0 flex items-center justify-center p-2">
                            <div className="relative w-full max-h-full aspect-video">
                                <LiveVideo key={`lpr_${device.id}-${videoNonce}`} streamName={`lpr_${device.id}`} deviceId={device.id} />
                                {isPtz && <div className="absolute bottom-3 right-3 z-20"><PtzControls deviceId={device.id} config /></div>}
                                <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none" className={cn("absolute inset-0 w-full h-full touch-none", dibujando ? "cursor-crosshair" : "pointer-events-none")}
                                    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
                                    <defs><marker id="punta-intr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#fbbf24" /></marker></defs>
                                    {[...zonas, ...lineas].filter((r) => !r.borrar).map((r) => {
                                        const elegida = r.clave === sel;
                                        const c = COLOR[r.tipo];
                                        const op = r.enabled ? 1 : 0.45;
                                        return (
                                            <g key={r.clave} opacity={sel && !elegida ? op * 0.55 : op} style={{ pointerEvents: "none" }}>
                                                {r.tipo === "zona" && r.points.length >= 2 && <polygon points={r.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={elegida ? "rgba(244,63,94,0.22)" : "rgba(244,63,94,0.12)"} stroke={c} strokeWidth={elegida ? 2.6 : 1.6} strokeDasharray={r.enabled ? undefined : "4 3"} vectorEffect="non-scaling-stroke" />}
                                                {r.tipo === "linea" && r.points.length === 2 && <>
                                                    <line x1={r.points[0].x} y1={r.points[0].y} x2={r.points[1].x} y2={r.points[1].y} stroke={c} strokeWidth={elegida ? 3.4 : 2.4} strokeDasharray={r.enabled ? undefined : "4 3"} vectorEffect="non-scaling-stroke" />
                                                    {flechas(r.points, r.direction, "#fbbf24")}
                                                </>}
                                                {rotulo(r)}
                                            </g>
                                        );
                                    })}
                                    {dibujando && actual && actual.points.map((p, i) => (
                                        <g key={i}>
                                            <circle cx={p.x} cy={p.y} r={1.4} fill={COLOR[actual.tipo]} stroke="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" style={{ cursor: "grab" }}
                                                onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = i; }}
                                                onDoubleClick={(e) => { e.stopPropagation(); cambiar(actual.clave, (r) => ({ ...r, points: r.tipo === "zona" && r.points.length <= lim.zonaMin ? r.points : r.points.filter((_, k) => k !== i) })); }} />
                                            <text x={p.x} y={p.y - 2.4} textAnchor="middle" fontSize="1.9" fontWeight="800" fill="#fff" stroke="#000" strokeWidth={0.3} paintOrder="stroke" style={{ pointerEvents: "none" }}>{actual.tipo === "linea" ? (i === 0 ? "A" : "B") : i + 1}</text>
                                        </g>
                                    ))}
                                </svg>
                            </div>
                        </div>

                        {/* Barra superior */}
                        <div className="absolute top-3 left-3 right-14 flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md">
                                <span className="flex h-2 w-2 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
                                <span className="text-[10px] font-bold text-white uppercase tracking-wide">Calibración de intrusión</span>
                                <span className="text-[10px] text-white/70">· {device.name}</span>
                            </div>
                            {dibujando && actual && <span className="px-3 py-1.5 rounded-full bg-amber-400 text-black text-[10.5px] font-bold">Dibujando {nombre(actual)} · {actual.points.length} punto{actual.points.length === 1 ? "" : "s"} · Esc termina</span>}
                            {/* La cámara tiene UNA lista de líneas y zonas: si la lectura de matrículas se dispara con ellas, tocarlas acá cambia también el disparo. */}
                            {(device.deviceType === "LPR_INTERIOR" || device.tipo === "LPR_INTERIOR") && ["linea", "zona", "camara"].includes(String(device.trackTrigger || "")) && (
                                <span className="px-3 py-1.5 rounded-full bg-black/60 text-[10px] font-semibold text-amber-300">Ojo: la lectura de matrículas se dispara con la {device.trackTrigger === "linea" ? "línea" : "zona"} 1 de esta cámara</span>
                            )}
                        </div>
                        <button onClick={cerrar} className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/60 backdrop-blur-md text-white/90 hover:bg-black/80 flex items-center justify-center z-10"><X size={18} /></button>

                        {loading && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/60 text-white/80 text-xs"><Loader2 size={14} className="animate-spin" /> Leyendo la analítica de la cámara…</div></div>}
                        {!loading && error && <div className="absolute inset-x-0 top-14 flex justify-center"><div className="px-4 py-2 rounded-full bg-red-500/25 text-red-100 text-xs ring-1 ring-red-400/40 inline-flex items-center gap-2"><AlertTriangle size={14} /> {error}<button onClick={cargar} className="underline font-semibold">Reintentar</button></div></div>}

                        {/* Auto-perfil: pasos */}
                        <AnimatePresence>
                            {autoSteps.length > 0 && (
                                <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
                                    className="absolute right-3 top-16 w-[300px] rounded-[14px] bg-neutral-900/90 backdrop-blur-2xl border border-white/10 p-3 z-20">
                                    <div className="flex items-center gap-2 mb-2 text-orange-300"><Wand2 size={15} /><span className="text-xs font-bold uppercase tracking-wide">Perfil perímetro</span></div>
                                    <div className="space-y-1.5">
                                        {autoSteps.map((s) => (
                                            <div key={s.key} className="flex items-start gap-2 rounded-lg px-2 py-1.5 bg-white/[0.03]">
                                                <div className="mt-0.5">{s.status === "ok" ? <Check size={14} className="text-emerald-400" /> : s.status === "fail" ? <AlertTriangle size={14} className="text-red-400" /> : <Loader2 size={14} className="text-white/40 animate-spin" />}</div>
                                                <div><p className="text-[11px] font-semibold text-white/90">{s.label}</p>{s.error && <p className="text-[10px] text-red-400">{s.error}</p>}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {autoSteps.every((s) => s.status !== "pending") && <button onClick={() => setAutoSteps([])} className="mt-2 w-full text-[11px] text-white/60 hover:text-white py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08]">Cerrar resumen</button>}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* ── La lista de analíticas ── */}
                    <aside className="w-[310px] shrink-0 border-l border-white/10 bg-neutral-950 flex flex-col min-h-0">
                        <div className="flex-1 overflow-y-auto p-3 space-y-4">
                            {sinAnalitica && <div className="rounded-[10px] bg-amber-500/15 text-amber-100 text-[11.5px] p-3 inline-flex gap-2"><Radar size={14} className="shrink-0 mt-0.5" /> Esta cámara no tiene cruce de línea ni zona de intrusión: sólo se puede configurar el aviso a OmniAccess.</div>}
                            {datos?.edita.motivo && <p className="text-[11px] text-white/50 px-0.5">{datos.edita.motivo}</p>}
                            {seccion("linea", lineas)}
                            {seccion("zona", zonas)}
                            {verificado && (
                                <div className={cn("rounded-[10px] p-3 text-[11.5px]", verificado.ok ? "bg-emerald-500/15 text-emerald-100" : "bg-red-500/15 text-red-100")}>
                                    <p className="font-bold inline-flex items-center gap-1.5">{verificado.ok ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />} {verificado.ok ? "Guardado y verificado" : "La cámara no quedó igual"}</p>
                                    {verificado.ok ? <p className="opacity-80 mt-0.5">Se volvió a leer la cámara y quedó exactamente como se pidió.</p> : <ul className="mt-1 space-y-0.5 list-disc pl-4">{verificado.diferencias.map((d, i) => <li key={i}>{d}</li>)}</ul>}
                                </div>
                            )}
                        </div>
                        <div className="shrink-0 border-t border-white/10 p-3 space-y-2">
                            <button onClick={pedirGuardar} disabled={!cambios.n || guardando || loading}
                                className="w-full h-10 rounded-[10px] bg-[var(--accion-en-oscuro,#38bdf8)] text-black font-bold text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-40">
                                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar en la cámara{cambios.n ? ` (${cambios.n})` : ""}
                            </button>
                            <div className="flex gap-2">
                                <button onClick={() => { setReglas(original); setSel(null); setDibujando(false); setVerificado(null); }} disabled={!cambios.n || guardando}
                                    className="flex-1 h-8 rounded-lg bg-white/[0.06] text-white/80 hover:bg-white/[0.12] text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40"><RotateCcw size={12} /> Descartar cambios</button>
                                <button onClick={cargar} disabled={loading || guardando} title="Volver a leer la cámara"
                                    className="h-8 w-10 rounded-lg bg-white/[0.06] text-white/80 hover:bg-white/[0.12] inline-flex items-center justify-center disabled:opacity-40"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
                            </div>
                        </div>
                    </aside>

                    {/* Confirmación */}
                    <AnimatePresence>
                        {confirm && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                <motion.div initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }} className="w-[420px] rounded-[14px] bg-neutral-900/95 border border-white/10 p-5 text-center">
                                    <div className="mx-auto mb-3 flex justify-center"><CalSvg kind={confirm.svg} /></div>
                                    <p className="text-white font-bold text-base mb-1">{confirm.titulo}</p>
                                    <p className="text-[12px] text-white/70 mb-3">{confirm.detalle}</p>
                                    {confirm.lista && <ul className="text-left text-[12px] text-white/85 space-y-1 mb-4 max-h-48 overflow-y-auto rounded-lg bg-white/[0.04] p-3">{confirm.lista.map((x, i) => <li key={i} className="flex gap-2"><span className="text-white/40">•</span>{x}</li>)}</ul>}
                                    <div className="flex gap-2">
                                        <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-[10px] bg-white/[0.06] hover:bg-white/[0.12] text-white text-sm font-semibold">Cancelar</button>
                                        <button onClick={() => confirm.hacer()} className="flex-1 py-2.5 rounded-[10px] bg-red-500 hover:bg-red-400 text-white text-sm font-bold flex items-center justify-center gap-1.5"><Check size={15} /> {confirm.boton || "Sí, aplicar"}</button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Riel: lo que no es una regla */}
                <div className="shrink-0 bg-neutral-950/95 border-t border-white/10 px-3 py-2.5">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        <button onClick={() => setConfirm({ titulo: "Perfil perímetro", detalle: "Pone sensibilidad 60 y objetivo personas y vehículos en todas las reglas (queda en el borrador, se escribe al guardar) y configura el aviso a OmniAccess.", svg: "auto", hacer: auto })}
                            disabled={loading || !!busy}
                            className="shrink-0 flex items-center gap-2 px-4 h-12 rounded-[10px] bg-gradient-to-br from-red-500 to-orange-600 text-white font-bold hover:brightness-110 active:scale-95 transition disabled:opacity-50">
                            <Wand2 size={18} />
                            <div className="text-left leading-tight"><div className="text-[13px]">Auto-perfil</div><div className="text-[10px] font-semibold opacity-80">Perímetro recomendado</div></div>
                        </button>
                        <div className="w-px h-9 bg-white/10 mx-1 shrink-0" />
                        <BotonRiel icono={BellRing} t="Servidor" v={alarma == null ? "—" : alarma ? "OK" : "FALTA"} ok={alarma} busy={busy === "alarm"} onClick={servidor} disabled={loading || !!busy}
                            ayuda="Que la cámara le avise a OmniAccess cada detección (servidor de alarmas / HTTP host). Sin esto la cámara detecta pero el monitor de intrusión nunca se entera." />
                        <BotonRiel icono={Send} t="Probar" v="envío" busy={busy === "test"} onClick={probar} disabled={loading || !!busy}
                            ayuda="Manda un aviso de prueba desde la cámara hacia OmniAccess para confirmar que el camino completo anda." />
                        <p className="text-[10.5px] text-white/40 ml-2 leading-snug max-w-[520px]">Las líneas y zonas se editan en la lista de la derecha y se escriben juntas con «Guardar en la cámara»; después se vuelve a leer la cámara para comprobar que quedaron igual.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Campo({ t, ayuda, children }: { t: string; ayuda?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <p className="text-[10.5px] font-semibold text-white/60" title={ayuda}>{t}</p>
            {children}
        </div>
    );
}

function BotonRiel({ icono: I, t, v, ok, busy, onClick, disabled, ayuda }: { icono: any; t: string; v: string; ok?: boolean | null; busy?: boolean; onClick: () => void; disabled?: boolean; ayuda: string }) {
    return (
        <button onClick={onClick} disabled={disabled} title={ayuda}
            className={cn("shrink-0 flex flex-col items-center justify-center gap-0.5 w-[78px] h-12 rounded-[10px] border transition active:scale-95 disabled:opacity-40",
                ok === true ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : ok === false ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-white/[0.05] border-white/10 text-white/80 hover:bg-white/[0.1]")}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <I size={16} />}
            <span className="text-[9px] font-bold uppercase tracking-wide">{t}</span>
            <span className="text-[8px] text-white/50 leading-none tabular-nums">{v}</span>
        </button>
    );
}

export default IntrusionCalibrator;
