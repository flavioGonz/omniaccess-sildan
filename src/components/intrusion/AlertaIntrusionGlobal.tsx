"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import io from "socket.io-client";
import { ShieldAlert, Check, X, Volume2, VolumeX, Radar, Clock, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveAlarms, ackAlarms, setAttending, getIntrusionCameras, type ActiveAlarm } from "@/app/actions/detections";
import { getImagePath } from "@/lib/image-path";

/**
 * La alerta de intrusión que se ve en TODA la aplicación.
 *
 * Hasta el 7/10 una intrusión confirmada por la cámara (cruce de línea, zona) sólo se veía
 * en /admin/monitor-intrusion: quien estaba en Historial, en Usuarios o en Ajustes no se
 * enteraba hasta volver al monitor. Esto se monta en el layout del panel: mientras haya
 * detecciones sin aceptar, toda la pantalla respira en rojo y una ficha pide una decisión
 * — intrusión real o falsa alarma — por cámara. No se cierra sin decidir: la alerta es el
 * dato de que hay un problema, y un problema no se descarta, se atiende. Lo único que se
 * puede apagar es el sonido.
 *
 * Fuente de verdad: Detection.acknowledged (misma que el monitor). Llega en vivo por el
 * socket `general_detection` y se reconstruye al cargar con getActiveAlarms(), así que una
 * pestaña recién abierta también la ve. En el monitor de intrusión no se muestra: ahí
 * cada mosaico ya tiene su overlay y su confirmación.
 */

const TIPOS: Record<string, string> = { LINECROSS: "Cruce de línea", INTRUSION: "Intrusión en zona", REGION_ENTER: "Entró a la zona", REGION_EXIT: "Salió de la zona", OTHER: "Detección" };
const CLASES: Record<string, string> = { human: "persona", vehicle: "vehículo" };
/** Cada cuánto suena mientras la alerta siga sin aceptar. */
const INTERVALO_SONIDO_MS = 6000;
/** Cada cuánto se reconfirma contra la base, por si se aceptó desde otra pantalla. */
const INTERVALO_RELECTURA_MS = 30000;

type Alarma = ActiveAlarm & { deviceName?: string | null; label?: string | null; snapshotPath?: string | null };

function pitido(urgente = true) {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
        const ctx = new Ctx(); const tonos = urgente ? [988, 1319, 988, 1319] : [880];
        tonos.forEach((f, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = "square"; o.frequency.value = f; const t = ctx.currentTime + i * 0.16; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14); o.start(t); o.stop(t + 0.15); });
    } catch { /* sin audio */ }
}

export default function AlertaIntrusionGlobal() {
    const pathname = usePathname();
    const router = useRouter();
    const [alarmas, setAlarmas] = useState<Alarma[]>([]);
    const [nombres, setNombres] = useState<Record<string, string>>({});
    const [silencio, setSilencio] = useState<boolean>(() => { try { return localStorage.getItem("oa.intrusion.silencio") === "1"; } catch { return false; } });
    const [resolviendo, setResolviendo] = useState<string | null>(null);
    const [snapshots, setSnapshots] = useState<Record<string, string>>({});
    const enMonitor = pathname?.startsWith("/admin/monitor-intrusion");

    const releer = useCallback(() => {
        getActiveAlarms().then((rows) => setAlarmas((prev) => {
            // Conservar lo que ya se sabía de cada alarma (nombre, foto) y quedarse con las vigentes.
            const previas = new Map(prev.map((a) => [a.id, a]));
            return rows.map((r) => ({ ...r, ...(previas.get(r.id) || {}) }));
        })).catch(() => { });
    }, []);

    useEffect(() => {
        getIntrusionCameras().then((cams) => setNombres(Object.fromEntries(cams.map((c: any) => [c.id, c.name])))).catch(() => { });
        releer();
        const iv = setInterval(releer, INTERVALO_RELECTURA_MS);
        return () => clearInterval(iv);
    }, [releer]);

    useEffect(() => {
        let s: any = null;
        try {
            s = io(window.location.origin, { path: "/io/socket.io", transports: ["polling"], upgrade: false });
            s.on("general_detection", (d: any) => {
                if (!d?.id || !d.deviceId || d.type === "MOTION") return;
                setAlarmas((prev) => prev.some((a) => a.id === d.id) ? prev : [{ id: d.id, deviceId: d.deviceId, type: d.type, ts: d.timestamp || new Date().toISOString(), deviceName: d.deviceName, label: d.label }, ...prev]);
            });
            s.on("detection_snapshot", (d: any) => { if (d?.id && d.snapshotPath) setSnapshots((p) => ({ ...p, [d.id]: d.snapshotPath })); });
        } catch { /* sin socket: queda la relectura periódica */ }
        return () => { try { s && s.disconnect(); } catch { } };
    }, []);

    // Agrupadas por cámara, la más nueva primero.
    const porCamara = useMemo(() => {
        const m = new Map<string, Alarma[]>();
        for (const a of alarmas) m.set(a.deviceId, [...(m.get(a.deviceId) || []), a]);
        return [...m.entries()].map(([deviceId, lista]) => ({ deviceId, lista: lista.sort((x, y) => y.ts.localeCompare(x.ts)) })).sort((x, y) => y.lista[0].ts.localeCompare(x.lista[0].ts));
    }, [alarmas]);
    const visible = porCamara.length > 0 && !enMonitor;

    // Suena al aparecer y cada tanto mientras siga sin aceptar.
    const ultimaCantidad = useRef(0);
    useEffect(() => {
        if (!visible) { ultimaCantidad.current = 0; return; }
        if (!silencio && alarmas.length > ultimaCantidad.current) pitido(true);
        ultimaCantidad.current = alarmas.length;
        if (silencio) return;
        const iv = setInterval(() => pitido(false), INTERVALO_SONIDO_MS);
        return () => clearInterval(iv);
    }, [visible, alarmas.length, silencio]);

    const resolver = async (deviceId: string, kind: "real" | "false") => {
        setResolviendo(deviceId);
        try {
            await ackAlarms(deviceId, kind);
            if (kind === "real") await setAttending(deviceId, true).catch(() => null);
            setAlarmas((prev) => prev.filter((a) => a.deviceId !== deviceId));
        } finally { setResolviendo(null); }
    };

    if (!visible) return null;
    const actual = porCamara[0];
    const primera = actual.lista[0];
    const nombre = primera.deviceName || nombres[actual.deviceId] || "Cámara";
    const foto = getImagePath(snapshots[primera.id] || primera.snapshotPath) || `/api/snapshot/${actual.deviceId}?t=${Math.floor(Date.now() / 15000)}`;
    const hace = (ts: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000)); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };

    return (
        <>
            {/* La respiración roja en los bordes de toda la pantalla. No bloquea clics: el bloqueo es la ficha. */}
            <div aria-hidden className="fixed inset-0 z-[2390] pointer-events-none respirar-intrusion" />
            <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4 sm:p-8 bg-black/70 backdrop-blur-[2px]" role="alertdialog" aria-modal="true" aria-label="Intrusión detectada">
                <div className="relative w-full max-w-4xl rounded-[14px] overflow-hidden bg-black ring-2 ring-[var(--mal)]">
                    <div className="relative aspect-video max-h-[62vh] w-full bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={foto} alt="" className="absolute inset-0 w-full h-full object-contain" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/60 pointer-events-none" />
                        <div className="absolute top-0 inset-x-0 p-4 flex items-start gap-3">
                            <span className="w-11 h-11 rounded-xl bg-[var(--mal)] grid place-items-center shrink-0 respirar-icono"><ShieldAlert size={22} className="text-white" /></span>
                            <div className="min-w-0">
                                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-red-200">Intrusión · requiere confirmación</div>
                                <div className="text-xl font-extrabold text-white leading-tight truncate">{TIPOS[primera.type] || TIPOS.OTHER}{primera.label && CLASES[primera.label] ? ` · ${CLASES[primera.label]}` : ""}</div>
                                <div className="text-[13px] text-white/80 truncate">{nombre} · {hace(primera.ts)}{actual.lista.length > 1 ? ` · ${actual.lista.length} detecciones en esta cámara` : ""}</div>
                            </div>
                            <div className="ml-auto flex items-center gap-1 shrink-0">
                                <button onClick={() => { const v = !silencio; setSilencio(v); try { localStorage.setItem("oa.intrusion.silencio", v ? "1" : "0"); } catch { } }} title={silencio ? "Activar sonido" : "Silenciar (la alerta sigue)"} className="h-9 w-9 grid place-items-center rounded-full bg-black/40 hover:bg-black/70 text-white/80">{silencio ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                            </div>
                        </div>
                        {porCamara.length > 1 && (
                            <div className="absolute top-20 left-4 flex flex-col gap-1">
                                {porCamara.slice(1, 4).map((c) => <span key={c.deviceId} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 text-[11px] font-bold text-red-200 w-fit"><Radar size={11} /> También: {nombres[c.deviceId] || c.lista[0].deviceName || c.deviceId} · {c.lista.length}</span>)}
                                {porCamara.length > 4 && <span className="text-[11px] text-white/60 px-1">y {porCamara.length - 4} más</span>}
                            </div>
                        )}
                        <div className="absolute bottom-0 inset-x-0 p-4 sm:p-5 flex flex-wrap items-end gap-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-[13px] text-white/85 leading-snug">La cámara confirmó <b className="text-white">{(TIPOS[primera.type] || "una detección").toLowerCase()}</b> en <b className="text-white">{nombre}</b>. Decidí qué es: la alerta no se cierra sola.</p>
                                <button onClick={() => router.push("/admin/monitor-intrusion")} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-red-200 hover:text-white underline decoration-dotted"><ExternalLink size={12} /> Ver en el monitor de intrusión (vivo, grabación, otras cámaras)</button>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button onClick={() => resolver(actual.deviceId, "false")} disabled={!!resolviendo} className="inline-flex items-center gap-1.5 px-5 h-11 rounded-[10px] bg-white/10 hover:bg-white/20 text-amber-200 text-[13px] font-extrabold ring-1 ring-white/15 disabled:opacity-50">{resolviendo === actual.deviceId ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} Falsa alarma</button>
                                <button onClick={() => resolver(actual.deviceId, "real")} disabled={!!resolviendo} className="inline-flex items-center gap-2 px-6 h-11 rounded-[10px] bg-[var(--mal)] hover:opacity-90 text-white text-[14px] font-extrabold disabled:opacity-50"><Check size={17} /> Intrusión real: la atiendo</button>
                            </div>
                        </div>
                    </div>
                    <div className="px-4 py-2 bg-neutral-950 text-[11px] text-white/55 flex items-center gap-2"><Clock size={11} /> Al confirmarla como real, la cámara queda "en atención" en el monitor hasta que se resuelva. Falsa alarma la archiva como tal en el historial.</div>
                </div>
            </div>
            <style jsx global>{`
                @keyframes respirar-intrusion {
                    0%, 100% { box-shadow: inset 0 0 0 0 rgba(239, 68, 68, 0), inset 0 0 90px 10px rgba(239, 68, 68, 0.0); }
                    50% { box-shadow: inset 0 0 0 6px rgba(239, 68, 68, 0.9), inset 0 0 140px 40px rgba(239, 68, 68, 0.45); }
                }
                .respirar-intrusion { animation: respirar-intrusion 2.2s ease-in-out infinite; }
                @keyframes respirar-icono { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.08); opacity: 0.85; } }
                .respirar-icono { animation: respirar-icono 2.2s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) { .respirar-intrusion, .respirar-icono { animation: none; box-shadow: inset 0 0 0 6px rgba(239, 68, 68, 0.9); } }
            `}</style>
        </>
    );
}
