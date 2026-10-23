"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sileo } from "sileo";
import {
    Wand2, X, Check, Loader2, RefreshCw, AlertTriangle, Minus, Hexagon, ArrowLeftRight, ArrowRight, ArrowLeft,
    Gauge, PersonStanding, Car, BellRing, Send, Save, RotateCcw, Trash2, Radar, MousePointer2, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PtzControls } from "@/components/PtzControls";

/**
 * Calibrador de INTRUSIÓN, calcado del calibrador LPR (CameraCalibrator): el video en vivo arriba,
 * la línea y la zona dibujadas encima, y abajo un riel de controles donde cada uno explica qué
 * hace al pasar el mouse, pide confirmación y se ve el efecto en el video.
 *
 * Lo que se calibra es la analítica de la cámara (AcuSense / Smart Event Hikvision, IVS Dahua):
 * la LÍNEA de cruce con su sentido, la ZONA de intrusión, la SENSIBILIDAD y el OBJETIVO (persona,
 * vehículo o ambos), y que la cámara le AVISE a OmniAccess (servidor de alarmas).
 *
 * Varias líneas y zonas (23/10, Nico: «no puedo eliminar analíticas creadas… los dispositivos
 * siempre tienen varias… que se guarde perfecto»). La cámara tiene hasta 4 de cada una y esto veía
 * la primera. Ahora el editor elige cuál (1–4), «Eliminar» la quita (también «Limpiar» + «Guardar»),
 * y cada guardado vuelve a leer la cámara y compara: si algo no quedó como se pidió, se dice qué.
 * El aspecto es el mismo de siempre: sólo se agregó lo necesario para elegir y borrar.
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
/** Un lugar de la cámara (1–4) para una línea o una zona; `vacia` = no hay nada dibujado. */
type Regla = { id: number; vacia: boolean; enabled: boolean; points: P[]; direction: Dir; sensibilidad: number | null; objetivo: string | null };
type Cfg = {
    support: { line: boolean; field: boolean };
    lineas: Regla[];
    zonas: Regla[];
    edita: { varias: boolean; borrar: boolean; ajustes: boolean; motivo?: string };
};
const dibujadas = (l: Regla[] | undefined) => (l || []).filter((r) => !r.vacia);
const todas = (c: Cfg | null) => (c ? [...dibujadas(c.lineas), ...dibujadas(c.zonas)] : []);
const cuantas = (n: number, uno: string, varios: string) => (n === 0 ? "sin dibujar" : n === 1 ? `1 ${uno}` : `${n} ${varios}`);

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

type Ctl = { key: string; label: string; icon: any; svg: string; detail: string; valueText: (c: Cfg | null, extra: Extra) => string; disabled?: (c: Cfg | null) => boolean };
type Extra = { alarma: boolean | null };

const SENS = [40, 60, 80];
const OBJETIVOS: { v: string; t: string }[] = [{ v: "human", t: "Persona" }, { v: "vehicle", t: "Vehículo" }, { v: "human,vehicle", t: "Ambos" }];
const DIR_TXT: Record<Dir, string> = { both: "Ambos", ab: "A→B", ba: "B→A" };
/** Los ajustes que muestra el riel: los de la primera regla dibujada (se aplican a todas). */
const ajustesActivos = (c: Cfg | null) => { const r = todas(c).find((x) => x.sensibilidad != null || x.objetivo != null); return r ? { sensibilidad: r.sensibilidad, objetivo: r.objetivo } : null; };

const CONTROLS: Ctl[] = [
    { key: "line", label: "Línea", icon: Minus, svg: "line", detail: "La línea virtual de cruce. Cuando alguien la atraviesa (en el sentido elegido) la cámara dispara la alarma. Ideal para el borde del cerco o el muro: se dibuja sobre un cuadro real de esta cámara.",
        valueText: (c) => cuantas(dibujadas(c?.lineas).length, "línea", "líneas"), disabled: (c) => !c?.support.line },
    { key: "zone", label: "Zona", icon: Hexagon, svg: "zone", detail: "La zona de intrusión: un polígono. Si alguien entra y permanece dentro, la cámara avisa. Sirve para patios o sectores donde no se puede reducir el perímetro a una raya.",
        valueText: (c) => cuantas(dibujadas(c?.zonas).length, "zona", "zonas"), disabled: (c) => !c?.support.field },
    { key: "dir", label: "Sentido", icon: ArrowLeftRight, svg: "dir", detail: "En qué sentido se considera cruce: A→B (sólo de afuera hacia adentro, por ejemplo), B→A o ambos. Con un solo sentido se descartan las salidas legítimas y baja el ruido.",
        valueText: (c) => { const d = [...new Set(dibujadas(c?.lineas).map((r) => r.direction))]; return d.length === 1 ? DIR_TXT[d[0]] : d.length ? "varios" : "—"; }, disabled: (c) => !dibujadas(c?.lineas).length },
    { key: "sens", label: "Sensibilidad", icon: Gauge, svg: "sens", detail: "Qué tan fácil dispara. Alta detecta todo (y también hojas, sombras y bichos de noche); baja sólo lo evidente. En perímetro con vegetación, 40–60 suele ser el equilibrio.",
        valueText: (c) => { const a = ajustesActivos(c); return a?.sensibilidad != null ? String(a.sensibilidad) : "—"; }, disabled: (c) => !c?.edita.ajustes || ajustesActivos(c)?.sensibilidad == null },
    { key: "target", label: "Objetivo", icon: PersonStanding, svg: "target", detail: "Qué dispara la alarma (cámaras AcuSense): sólo personas, sólo vehículos o ambos. Filtrar a personas elimina casi todas las falsas alarmas por animales, luces o lluvia.",
        valueText: (c) => { const a = ajustesActivos(c); return OBJETIVOS.find((o) => o.v === a?.objetivo)?.t || (a?.objetivo || "—"); }, disabled: (c) => !c?.edita.ajustes || ajustesActivos(c)?.objetivo == null },
    { key: "alarm", label: "Servidor", icon: BellRing, svg: "alarm", detail: "Que la cámara le avise a OmniAccess cada detección (servidor de alarmas / HTTP host). Sin esto la cámara detecta pero el monitor de intrusión nunca se entera.",
        valueText: (_c, e) => (e.alarma == null ? "—" : e.alarma ? "OK" : "FALTA") },
    { key: "test", label: "Probar", icon: Send, svg: "test", detail: "Manda un aviso de prueba desde la cámara hacia OmniAccess para confirmar que el camino completo anda (cámara → red → servidor).",
        valueText: () => "envío" },
];

export function IntrusionCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const isPtz = /ptz/i.test(device?.name || "");
    const [cfg, setCfg] = useState<Cfg | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [alarma, setAlarma] = useState<boolean | null>(null);
    const [hover, setHover] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<null | { titulo: string; detalle: string; svg: string; hacer: () => Promise<void> }>(null);
    const [autoSteps, setAutoSteps] = useState<{ key: string; label: string; status: "pending" | "ok" | "fail"; error?: string }[]>([]);
    const [videoNonce, setVideoNonce] = useState(0);
    // editor
    const [edit, setEdit] = useState<null | "line" | "zone">(null);
    /** Qué lugar de la cámara (1–4) se está editando. */
    const [editId, setEditId] = useState(1);
    const [pts, setPts] = useState<P[]>([]);
    const [dir, setDir] = useState<Dir>("both");
    const [guardando, setGuardando] = useState(false);
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<number | null>(null);

    const cargar = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const d = await fetch(`/api/devices/analytics?deviceId=${device.id}`, { cache: "no-store" }).then((r) => r.json());
            if (!d.ok) { setError(d.error || "No se pudo leer la cámara"); setCfg(null); }
            else {
                const regla = (r: any): Regla => ({ id: r.id, vacia: !!r.vacia, enabled: !!r.enabled, points: (r.points || []).map(camToScreen), direction: (r.direction || "both") as Dir, sensibilidad: r.sensibilidad ?? null, objetivo: r.objetivo ?? null });
                setCfg({
                    support: d.support || { line: false, field: false },
                    lineas: (d.lineas?.reglas || []).map(regla),
                    zonas: (d.zonas?.reglas || []).map(regla),
                    edita: d.edita || { varias: false, borrar: false, ajustes: false },
                });
            }
        } catch { setError("Error de conexión con la cámara"); }
        finally { setLoading(false); }
        fetch(`/api/devices/alarm-host?deviceId=${device.id}`, { cache: "no-store" }).then((r) => r.json()).then((a) => setAlarma(!!(a?.hasOmni || (a?.dahua && a?.ok)))).catch(() => setAlarma(null));
    }, [device.id]);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (edit) setEdit(null); else onClose(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose, edit]);

    const post = async (body: any) => {
        const r = await fetch(`/api/devices/analytics?deviceId=${device.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!j.ok) throw new Error(j.error || "La cámara no aceptó el cambio");
        // Se releyó la cámara: si algo no quedó como se pidió, es un error y se dice qué.
        if (Array.isArray(j.diferencias) && j.diferencias.length) throw new Error(`La cámara no quedó igual: ${j.diferencias.join(" · ")}`);
    };
    /** Un ajuste para todas las reglas dibujadas, en una sola escritura por tipo. */
    const ajusteATodas = (campo: "sensibilidad" | "objetivo", v: any) => post({
        lineas: dibujadas(cfg?.lineas).map((r) => ({ id: r.id, [campo]: v })),
        zonas: dibujadas(cfg?.zonas).map((r) => ({ id: r.id, [campo]: v })),
    });
    const abrirEditor = (kind: "line" | "zone", id?: number) => {
        const lista = kind === "line" ? cfg!.lineas : cfg!.zonas;
        const r = (id != null ? lista.find((x) => x.id === id) : null) || lista.find((x) => !x.vacia) || lista[0];
        setEdit(kind); setEditId(r?.id || 1); setPts(r && !r.vacia ? r.points : []); setDir(r?.direction || "both");
    };
    const aplicar = async (key: string, titulo: string, fn: () => Promise<void>) => {
        setBusy(key); setConfirm(null);
        try { await fn(); toast.success(titulo, { description: "Aplicado en la cámara" }); setTimeout(() => setVideoNonce((n) => n + 1), 600); await cargar(); }
        catch (e: any) { toast.error("No se pudo aplicar", { description: e?.message }); }
        finally { setBusy(null); }
    };

    const clic = (ctl: Ctl) => {
        if (!cfg && ctl.key !== "alarm" && ctl.key !== "test") return;
        if (ctl.key === "line" || ctl.key === "zone") { abrirEditor(ctl.key); return; }
        // El sentido es de cada línea: se elige en el editor, arriba, con la línea elegida.
        if (ctl.key === "dir") { abrirEditor("line"); return; }
        if (ctl.key === "sens") {
            const a = ajustesActivos(cfg); const i = SENS.findIndex((x) => x >= (a?.sensibilidad ?? 0)); const v = SENS[(i + 1) % SENS.length] ?? 60;
            setConfirm({ titulo: `Sensibilidad → ${v}`, detalle: `${ctl.detail} Se aplica a las ${todas(cfg).length} líneas y zonas dibujadas.`, svg: "sens", hacer: () => aplicar("sens", `Sensibilidad → ${v}`, () => ajusteATodas("sensibilidad", v)) });
            return;
        }
        if (ctl.key === "target") {
            const a = ajustesActivos(cfg); const i = OBJETIVOS.findIndex((o) => o.v === a?.objetivo); const v = OBJETIVOS[(i + 1) % OBJETIVOS.length];
            setConfirm({ titulo: `Objetivo → ${v.t}`, detalle: `${ctl.detail} Se aplica a las ${todas(cfg).length} líneas y zonas dibujadas.`, svg: "target", hacer: () => aplicar("target", `Objetivo → ${v.t}`, () => ajusteATodas("objetivo", v.v)) });
            return;
        }
        if (ctl.key === "alarm") {
            setConfirm({ titulo: "Configurar el servidor de alarmas", detalle: ctl.detail + " Se agrega OmniAccess sin borrar los otros servidores que ya tenga la cámara.", svg: "alarm", hacer: () => aplicar("alarm", "Servidor de alarmas configurado", async () => {
                const a = await fetch(`/api/devices/alarm-host?deviceId=${device.id}`, { method: "POST" }).then((r) => r.json());
                if (!a?.ok) throw new Error(a?.error || "La cámara no aceptó el servidor");
            }) });
            return;
        }
        if (ctl.key === "test") {
            setConfirm({ titulo: "Mandar un aviso de prueba", detalle: ctl.detail, svg: "test", hacer: () => aplicar("test", "La cámara llegó a OmniAccess", async () => {
                const a = await fetch(`/api/devices/alarm-host?deviceId=${device.id}&action=test`, { method: "POST" }).then((r) => r.json());
                if (!a?.ok) throw new Error(a?.error || "No llegó el aviso de prueba");
            }) });
        }
    };

    /* Auto-perfil perímetro: sensibilidad 60, objetivo personas+vehículos, reglas activas y el aviso a OmniAccess. */
    const auto = async () => {
        setConfirm(null);
        const pasos = [
            { key: "sens", label: "Sensibilidad 60 (equilibrio perímetro con vegetación)" },
            { key: "target", label: "Objetivo: personas y vehículos" },
            { key: "alarm", label: "Servidor de alarmas → OmniAccess" },
        ];
        setAutoSteps(pasos.map((p) => ({ ...p, status: "pending" })));
        const marcar = (k: string, ok: boolean, error?: string) => setAutoSteps((xs) => xs.map((x) => (x.key === k ? { ...x, status: ok ? "ok" : "fail", error } : x)));
        // Sensibilidad y objetivo van en la misma escritura: la cámara tarda en aplicar cada una.
        const hay = todas(cfg);
        if (!hay.length) { marcar("sens", false, "no hay líneas ni zonas dibujadas"); marcar("target", false, "no hay líneas ni zonas dibujadas"); }
        else if (!cfg?.edita.ajustes) { marcar("sens", false, "este equipo no deja cambiarla desde acá"); marcar("target", false, "este equipo no deja cambiarlo desde acá"); }
        else {
            const objetivo = hay.some((r) => r.objetivo != null);
            const cambio = (r: Regla) => ({ id: r.id, sensibilidad: 60, ...(r.objetivo != null ? { objetivo: "human,vehicle" } : {}) });
            try { await post({ lineas: dibujadas(cfg.lineas).map(cambio), zonas: dibujadas(cfg.zonas).map(cambio) }); marcar("sens", true); if (objetivo) marcar("target", true); else marcar("target", false, "esta cámara no filtra por objetivo"); }
            catch (e: any) { marcar("sens", false, e?.message); marcar("target", false, e?.message); }
        }
        try { const a = await fetch(`/api/devices/alarm-host?deviceId=${device.id}`, { method: "POST" }).then((r) => r.json()); marcar("alarm", !!a?.ok, a?.ok ? undefined : a?.error); } catch (e: any) { marcar("alarm", false, e?.message); }
        cargar();
    };

    // ── editor ──
    const evtPct = (e: React.PointerEvent): P => { const r = svgRef.current!.getBoundingClientRect(); return { x: snap(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))), y: snap(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))) }; };
    const onDown = (e: React.PointerEvent) => { if (drag.current != null) return; const p = evtPct(e); setPts((l) => (edit === "line" ? (l.length >= 2 ? [l[1], p] : [...l, p]) : [...l, p])); };
    const onMove = (e: React.PointerEvent) => { if (drag.current == null) return; const p = evtPct(e); setPts((l) => l.map((q, k) => (k === drag.current ? p : q))); };
    const listaEdit = edit === "line" ? cfg?.lineas || [] : cfg?.zonas || [];
    const reglaEdit = listaEdit.find((r) => r.id === editId) || null;
    const nombreEdit = `${edit === "line" ? "Línea" : "Zona"} ${editId}`;
    const sinGuardar = !!edit && (JSON.stringify(pts) !== JSON.stringify(reglaEdit && !reglaEdit.vacia ? reglaEdit.points : []) || (edit === "line" && !!reglaEdit && !reglaEdit.vacia && dir !== reglaEdit.direction));
    const eliminar = () => setConfirm({
        titulo: `Eliminar ${nombreEdit}`, detalle: `Se quita de la cámara (queda vacía, como de fábrica). Las demás ${edit === "line" ? "líneas" : "zonas"} no se tocan.`, svg: edit === "line" ? "line" : "zone",
        hacer: async () => {
            setConfirm(null); setGuardando(true);
            try { await post(edit === "line" ? { lineas: [{ id: editId, borrar: true }] } : { zonas: [{ id: editId, borrar: true }] }); toast.success(`${nombreEdit} eliminada`, { description: "Se volvió a leer la cámara: ya no está" }); setEdit(null); await cargar(); }
            catch (e: any) { toast.error("No se pudo eliminar", { description: e?.message }); }
            finally { setGuardando(false); }
        },
    });
    const guardarEdicion = async () => {
        // «Limpiar» + «Guardar» sobre una que existe es borrarla: era lo que Nico intentó y chocaba.
        if (!pts.length && reglaEdit && !reglaEdit.vacia) { if (cfg?.edita.borrar) eliminar(); else toast.error("No se puede eliminar desde acá", { description: cfg?.edita.motivo }); return; }
        if (edit === "line" && pts.length !== 2) { toast.error("La línea necesita 2 puntos"); return; }
        if (edit === "zone" && pts.length < 3) { toast.error("La zona necesita al menos 3 puntos"); return; }
        if (edit === "zone" && pts.length > 10) { toast.error("La zona admite hasta 10 vértices"); return; }
        setGuardando(true);
        try {
            const p = pts.map(screenToCam);
            await post(edit === "line" ? { lineas: [{ id: editId, points: p, direction: dir }] } : { zonas: [{ id: editId, points: p }] });
            toast.success(edit === "line" ? `${nombreEdit} guardada en la cámara` : `${nombreEdit} guardada en la cámara`, { description: "Se volvió a leer la cámara y quedó igual" });
            setEdit(null); await cargar();
        } catch (e: any) { toast.error("No se pudo guardar", { description: e?.message }); }
        finally { setGuardando(false); }
    };
    /** Cambiar de lugar en el editor: si hay cambios sin guardar, se pregunta. */
    const elegirLugar = (id: number) => {
        if (id === editId) return;
        const ir = () => { setConfirm(null); abrirEditor(edit!, id); };
        if (sinGuardar) setConfirm({ titulo: `${nombreEdit} tiene cambios sin guardar`, detalle: "Si cambiás de lugar se pierden.", svg: edit === "line" ? "line" : "zone", hacer: async () => ir() });
        else ir();
    };

    const active = hover ? CONTROLS.find((c) => c.key === hover) : null;
    const extra: Extra = { alarma };
    const lineasDib = dibujadas(cfg?.lineas);
    const zonasDib = dibujadas(cfg?.zonas);
    const color = edit === "zone" ? "#f43f5e" : "#38bdf8";
    const mid = (l: P[]) => (l.length === 2 ? { x: (l[0].x + l[1].x) / 2, y: (l[0].y + l[1].y) / 2 } : null);
    const flechas = (l: P[], d: Dir) => {
        const m = mid(l); if (!m) return null;
        const dx = l[1].x - l[0].x, dy = l[1].y - l[0].y, len = Math.hypot(dx, dy) || 1; const nx = -dy / len, ny = dx / len;
        const una = (sg: 1 | -1) => { const t = { x: m.x + nx * sg * 7, y: m.y + ny * sg * 7 }; return <line key={sg} x1={m.x} y1={m.y} x2={t.x} y2={t.y} stroke="#fbbf24" strokeWidth={2.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" markerEnd="url(#punta)" />; };
        return <>{(d === "both" || d === "ab") && una(1)}{(d === "both" || d === "ba") && una(-1)}</>;
    };
    /** El nombre corto (L1, Z2) junto a su dibujo: con varias, hay que saber cuál es cuál. */
    const rotulo = (l: P[], t: string) => {
        if (!l.length) return null;
        const c = { x: l.reduce((s, p) => s + p.x, 0) / l.length, y: l.reduce((s, p) => s + p.y, 0) / l.length };
        return <text x={c.x} y={c.y - 2.4} textAnchor="middle" fontSize="2" fontWeight="800" fill="#fff" stroke="#000" strokeWidth={0.35} paintOrder="stroke" style={{ pointerEvents: "none" }}>{t}</text>;
    };

    return (
        <div className="fixed inset-0 z-[3300] flex items-center justify-center bg-black/95 backdrop-blur-sm p-3 md:p-6 animate-in fade-in duration-200">
            <div className="relative w-full max-w-6xl h-[88vh] rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/10 flex flex-col">
                <div className="relative flex-1 bg-black">
                    <LiveVideo key={`lpr_${device.id}-${videoNonce}`} streamName={`lpr_${device.id}`} deviceId={device.id} />
                    {/* Analítica actual sobre el vivo */}
                    {!edit && cfg && (
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                            <defs><marker id="punta" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#fbbf24" /></marker></defs>
                            {zonasDib.map((z) => <g key={`z${z.id}`}>
                                <polygon points={z.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(244,63,94,0.16)" stroke="#f43f5e" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                                {rotulo(z.points, `Z${z.id}`)}
                            </g>)}
                            {lineasDib.map((l) => <g key={`l${l.id}`}>
                                <line x1={l.points[0].x} y1={l.points[0].y} x2={l.points[1].x} y2={l.points[1].y} stroke="#38bdf8" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                                <line x1={l.points[0].x} y1={l.points[0].y} x2={l.points[1].x} y2={l.points[1].y} stroke="#fff" strokeWidth={1} strokeDasharray="3 6" vectorEffect="non-scaling-stroke" opacity={0.6}><animate attributeName="stroke-dashoffset" from="9" to="0" dur="0.6s" repeatCount="indefinite" /></line>
                                {flechas(l.points, l.direction)}
                                {lineasDib.length + zonasDib.length > 1 && rotulo(l.points, `L${l.id}`)}
                            </g>)}
                        </svg>
                    )}

                    {/* Editor de línea / zona */}
                    {edit && (
                        <div className="absolute inset-0 z-30 bg-black/92 backdrop-blur-[2px] flex flex-col">
                            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/10">
                                <div className={cn("flex items-center gap-2", edit === "line" ? "text-sky-300" : "text-rose-300")}>
                                    {edit === "line" ? <Minus size={16} /> : <Hexagon size={16} />}
                                    <span className="text-xs font-bold uppercase tracking-wide">{edit === "line" ? "Línea de cruce" : "Zona de intrusión"}</span>
                                    {/* Cuál de los lugares de la cámara: lleno = dibujado, punteado = libre. */}
                                    {listaEdit.length > 1 && (
                                        <div className="inline-flex rounded-lg bg-white/[0.06] p-0.5 ml-1">
                                            {listaEdit.map((r) => (
                                                <button key={r.id} onClick={() => elegirLugar(r.id)} title={r.vacia ? `${edit === "line" ? "Línea" : "Zona"} ${r.id}: libre` : `${edit === "line" ? "Línea" : "Zona"} ${r.id}: dibujada`}
                                                    className={cn("h-6 min-w-[24px] px-1.5 rounded-md text-[11px] font-bold", r.id === editId ? (edit === "line" ? "bg-sky-400 text-black" : "bg-rose-500 text-white") : r.vacia ? "text-white/40 border border-dashed border-white/20" : "text-white/85 hover:text-white")}>
                                                    {r.vacia && r.id !== editId ? "+" : r.id}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <span className="text-[10px] text-white/50">· {edit === "line" ? "tocá los 2 extremos, arrastrá para ajustar" : "tocá para agregar vértices, doble clic borra"}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {edit === "line" && (
                                        <div className="inline-flex rounded-lg bg-white/[0.06] p-0.5">
                                            {(["ab", "both", "ba"] as Dir[]).map((v) => {
                                                const I = v === "ab" ? ArrowRight : v === "ba" ? ArrowLeft : ArrowLeftRight;
                                                return <button key={v} onClick={() => setDir(v)} className={cn("h-7 px-2.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1", dir === v ? "bg-amber-400 text-black" : "text-white/70 hover:text-white")}><I size={13} /> {DIR_TXT[v]}</button>;
                                            })}
                                        </div>
                                    )}
                                    <button onClick={() => setPts([])} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[11px] font-semibold flex items-center gap-1.5"><Trash2 size={13} /> Limpiar</button>
                                    <button onClick={() => { setPts(reglaEdit && !reglaEdit.vacia ? reglaEdit.points : []); if (reglaEdit) setDir(reglaEdit.direction); }} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[11px] font-semibold flex items-center gap-1.5"><RotateCcw size={13} /> Revertir</button>
                                    {reglaEdit && !reglaEdit.vacia && cfg?.edita.borrar && <button onClick={eliminar} disabled={guardando} className="h-8 px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50"><Trash2 size={13} /> Eliminar</button>}
                                    <button onClick={() => setEdit(null)} className="h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[11px] font-semibold flex items-center gap-1.5"><X size={13} /> Cerrar</button>
                                    <button onClick={guardarEdicion} disabled={guardando} className={cn("h-8 px-4 rounded-lg text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50", edit === "line" ? "bg-sky-500 hover:bg-sky-400 text-black" : "bg-rose-500 hover:bg-rose-400 text-white")}>
                                        {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
                                <div className="relative w-full max-h-full aspect-video">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={`/api/snapshot/${device.id}?t=${videoNonce}`} alt="" className="absolute inset-0 w-full h-full object-fill select-none pointer-events-none rounded-lg" draggable={false} />
                                    {isPtz && <div className="absolute bottom-3 right-3 z-20"><PtzControls deviceId={device.id} config /></div>}
                                    <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                                        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
                                        <defs><marker id="punta" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#fbbf24" /></marker></defs>
                                        {/* Las demás, tenues: para dibujar ésta sabiendo dónde están. */}
                                        <g opacity={0.35} style={{ pointerEvents: "none" }}>
                                            {zonasDib.filter((z) => !(edit === "zone" && z.id === editId)).map((z) => <polygon key={`oz${z.id}`} points={z.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#f43f5e" strokeWidth={1.4} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
                                            {lineasDib.filter((l) => !(edit === "line" && l.id === editId)).map((l) => <line key={`ol${l.id}`} x1={l.points[0].x} y1={l.points[0].y} x2={l.points[1].x} y2={l.points[1].y} stroke="#38bdf8" strokeWidth={1.6} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
                                        </g>
                                        {edit === "zone" && pts.length >= 2 && <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(244,63,94,0.18)" stroke={color} strokeWidth={2.4} vectorEffect="non-scaling-stroke" />}
                                        {edit === "line" && pts.length === 2 && <><line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" />{flechas(pts, dir)}</>}
                                        {pts.map((p, i) => (
                                            <g key={i}>
                                                <circle cx={p.x} cy={p.y} r={1.5} fill={color} stroke="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" style={{ cursor: "grab" }}
                                                    onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = i; }}
                                                    onDoubleClick={(e) => { e.stopPropagation(); setPts((l) => (edit === "zone" && l.length <= 3 ? l : l.filter((_, k) => k !== i))); }} />
                                                <text x={p.x} y={p.y - 2.6} textAnchor="middle" fontSize="2" fontWeight="800" fill="#fff" style={{ pointerEvents: "none" }}>{edit === "line" ? (i === 0 ? "A" : "B") : i + 1}</text>
                                            </g>
                                        ))}
                                    </svg>
                                    <span className="absolute top-2 right-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 text-[11px] text-white/80"><MousePointer2 size={12} /> {pts.length} punto{pts.length !== 1 ? "s" : ""}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Barra superior */}
                    <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md">
                        <span className="flex h-2 w-2 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
                        <span className="text-[10px] font-bold text-white uppercase tracking-wide">Calibración de intrusión</span>
                        <span className="text-[10px] text-white/70">· {device.name}</span>
                        {/* El disparo de la lectura de matrículas usa la línea 1 / zona 1 de la cámara (camera-rule):
                            si se dispara con ellas, tocarlas acá cambia también el disparo. */}
                        {device.deviceType === "LPR_INTERIOR" && ["linea", "zona", "camara"].includes(String(device.trackTrigger || "")) && (
                            <span className="text-[10px] font-semibold text-amber-300">· Ojo: la lectura de matrículas se dispara con la {device.trackTrigger === "linea" ? "línea" : "zona"} 1 de esta cámara</span>
                        )}
                    </div>
                    <button onClick={onClose} className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/50 backdrop-blur-md text-white/90 hover:bg-black/70 flex items-center justify-center z-10"><X size={18} /></button>

                    {/* Panel explicativo */}
                    <AnimatePresence>
                        {active && !edit && (
                            <motion.div initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}
                                className="absolute left-3 bottom-24 md:bottom-28 w-[300px] rounded-xl bg-white/[0.07] backdrop-blur-2xl border border-white/10 p-4 shadow-2xl">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="shrink-0"><CalSvg kind={active.svg} /></div>
                                    <div><p className="text-white font-bold text-sm">{active.label}</p><p className="text-[11px] text-white/60 font-mono">actual: {active.valueText(cfg, extra)}</p></div>
                                </div>
                                <p className="text-[12px] text-white/80 leading-relaxed">{active.detail}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Auto-perfil: pasos */}
                    <AnimatePresence>
                        {autoSteps.length > 0 && (
                            <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
                                className="absolute right-3 top-16 w-[300px] rounded-xl bg-white/[0.07] backdrop-blur-2xl border border-white/10 p-3 shadow-2xl">
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

                    {/* Confirmación */}
                    <AnimatePresence>
                        {confirm && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                                <motion.div initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }} className="w-[380px] rounded-2xl bg-neutral-900/90 border border-white/10 p-5 shadow-2xl text-center">
                                    <div className="mx-auto mb-3 flex justify-center"><CalSvg kind={confirm.svg} /></div>
                                    <p className="text-white font-bold text-base mb-1">{confirm.titulo}</p>
                                    <p className="text-[12px] text-white/70 mb-4">{confirm.detalle} ¿Aplico en <b>{device.name}</b>?</p>
                                    <div className="flex gap-2">
                                        <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white text-sm font-semibold">Cancelar</button>
                                        <button onClick={() => confirm.hacer()} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white text-sm font-bold flex items-center justify-center gap-1.5"><Check size={15} /> Sí, aplicar</button>
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {loading && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/60 text-white/80 text-xs"><Loader2 size={14} className="animate-spin" /> Leyendo la analítica de la cámara…</div></div>}
                    {!loading && error && <div className="absolute inset-x-0 top-14 flex justify-center"><div className="px-4 py-2 rounded-full bg-red-500/25 text-red-100 text-xs ring-1 ring-red-400/40 inline-flex items-center gap-2"><AlertTriangle size={14} /> {error}</div></div>}
                    {!loading && cfg && !cfg.support.line && !cfg.support.field && (
                        <div className="absolute inset-x-0 top-14 flex justify-center"><div className="px-4 py-2 rounded-full bg-amber-500/25 text-amber-100 text-xs ring-1 ring-amber-400/40 inline-flex items-center gap-2"><Radar size={14} /> Esta cámara no tiene cruce de línea ni zona de intrusión: sólo se puede configurar el aviso a OmniAccess.</div></div>
                    )}
                </div>

                {/* Riel de controles */}
                <div className="shrink-0 bg-neutral-950/95 border-t border-white/10 px-3 py-3">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        <button onClick={() => setConfirm({ titulo: "Perfil perímetro", detalle: "Sensibilidad 60, objetivo personas y vehículos y el aviso a OmniAccess. Es reversible.", svg: "auto", hacer: auto })}
                            disabled={loading || !!busy}
                            className="shrink-0 flex items-center gap-2 px-4 h-14 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 text-white font-bold shadow-lg shadow-red-500/20 hover:brightness-110 active:scale-95 transition disabled:opacity-50">
                            <Wand2 size={20} />
                            <div className="text-left leading-tight"><div className="text-sm">Auto-perfil</div><div className="text-[10px] font-semibold opacity-80">Perímetro recomendado</div></div>
                        </button>
                        <div className="w-px h-10 bg-white/10 mx-1 shrink-0" />
                        {CONTROLS.map((ctl) => {
                            const Icon = ctl.key === "target" && ajustesActivos(cfg)?.objetivo === "vehicle" ? Car : ctl.key === "target" && ajustesActivos(cfg)?.objetivo === "human,vehicle" ? Users : ctl.icon;
                            const dis = loading || !!busy || (ctl.disabled ? ctl.disabled(cfg) : false);
                            const ok = ctl.key === "alarm" ? alarma : ctl.key === "line" ? lineasDib.length > 0 : ctl.key === "zone" ? zonasDib.length > 0 : undefined;
                            return (
                                <button key={ctl.key} onMouseEnter={() => setHover(ctl.key)} onMouseLeave={() => setHover((h) => (h === ctl.key ? null : h))}
                                    onClick={() => clic(ctl)} disabled={dis}
                                    className={cn("shrink-0 relative flex flex-col items-center justify-center gap-0.5 w-[80px] h-14 rounded-xl border transition active:scale-95",
                                        ok === true ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : ok === false ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-white/[0.05] border-white/10 text-white/80 hover:bg-white/[0.1]",
                                        dis && "opacity-40")}>
                                    {busy === ctl.key ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
                                    <span className="text-[9px] font-bold uppercase tracking-wide">{ctl.label}</span>
                                    <span className="text-[8px] font-mono text-white/50 leading-none">{ctl.valueText(cfg, extra)}</span>
                                </button>
                            );
                        })}
                        <div className="flex-1" />
                        <button onClick={cargar} className="shrink-0 h-14 w-12 rounded-xl bg-white/[0.05] border border-white/10 text-white/70 hover:bg-white/[0.1] flex items-center justify-center" title="Releer cámara"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
                    </div>
                    <p className="text-[10px] text-white/40 mt-2 px-1">Pasá el mouse por cada control para ver qué hace. Todo cambio pide confirmación y se escribe en la cámara; la línea y la zona se ven sobre el video en vivo.</p>
                </div>
            </div>
        </div>
    );
}

export default IntrusionCalibrator;
