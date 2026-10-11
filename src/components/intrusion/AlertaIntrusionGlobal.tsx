"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import io from "socket.io-client";
import { ShieldAlert, Check, X, Volume2, VolumeX, Radar, Clock, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveAlarms, ackAlarms, setAttending, getIntrusionCameras, reclasificarComoFalsa, type ActiveAlarm } from "@/app/actions/detections";
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
/** En la pared se relee más seguido: es la única forma en que se entera de que la resolvieron. */
const INTERVALO_RELECTURA_PARED_MS = 10000;

type Alarma = ActiveAlarm & { deviceName?: string | null; label?: string | null; snapshotPath?: string | null };

function pitido(urgente = true) {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
        const ctx = new Ctx(); const tonos = urgente ? [988, 1319, 988, 1319] : [880];
        tonos.forEach((f, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = "square"; o.frequency.value = f; const t = ctx.currentTime + i * 0.16; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14); o.start(t); o.stop(t + 0.15); });
    } catch { /* sin audio */ }
}

/**
 * `soloLectura`: la misma alerta en una pantalla de pared (/monitor). Ahí no hay quien
 * decida: se ve la intrusión, pendiente o confirmada sin resolver, y se retira sola cuando
 * alguien la resuelve en el panel. Los datos llegan por /api/monitor/alarmas y no por
 * server actions, porque un enlace de pantalla no puede invocarlas.
 */
export default function AlertaIntrusionGlobal({ soloLectura = false, decide = false }: {
    soloLectura?: boolean;
    /**
     * Pared mirada por alguien que entró al panel con el permiso del monitor de intrusión:
     * los datos siguen llegando por /api/monitor/alarmas, pero se muestran los botones para
     * decidir (pendiente: real / falsa; confirmada: resuelta / era falsa).
     */
    decide?: boolean;
} = {}) {
    const pathname = usePathname();
    const router = useRouter();
    const [alarmas, setAlarmas] = useState<Alarma[]>([]);
    const [nombres, setNombres] = useState<Record<string, string>>({});
    const [silencio, setSilencio] = useState<boolean>(() => { try { return localStorage.getItem("oa.intrusion.silencio") === "1"; } catch { return false; } });
    const [resolviendo, setResolviendo] = useState<string | null>(null);
    const [snapshots, setSnapshots] = useState<Record<string, string>>({});
    const enMonitor = pathname?.startsWith("/admin/monitor-intrusion");
    /**
     * Pared: lo que alguien cerró a mano. Una pantalla de pared no decide, pero tampoco puede
     * quedar tapada: el 9/10 una intrusión confirmada hacía 22 minutos cubría el monitor
     * entero y no había cómo sacarla. Se cierra con la X y vuelve sólo si llega una detección
     * nueva (otra clave); mientras tanto queda una píldora abajo para volver a abrirla.
     */
    const [ocultas, setOcultas] = useState<Set<string>>(() => new Set());
    /** En la vista Intrusión cada canal ya muestra su alarma: ahí la ventana sólo salta por una detección nueva. */
    const enVistaIntrusion = soloLectura && !!pathname?.startsWith("/monitor/intrusion");

    /** Pared: las confirmadas sin resolver también se imponen (en el panel ya las muestra el monitor). */
    const [confirmadas, setConfirmadas] = useState<{ deviceId: string; deviceName: string; id: string | null; type: string; ts: string | null; snapshotPath: string | null }[]>([]);

    const releer = useCallback(() => {
        const juntar = (rows: ActiveAlarm[]) => setAlarmas((prev) => {
            // Conservar lo que ya se sabía de cada alarma (nombre, foto) y quedarse con las vigentes.
            const previas = new Map(prev.map((a) => [a.id, a]));
            return rows.map((r) => ({ ...r, ...(previas.get(r.id) || {}) }));
        });
        if (soloLectura) {
            fetch("/api/monitor/alarmas", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
                if (!j) return;
                juntar(j.pendientes || []);
                setNombres((n) => ({ ...n, ...Object.fromEntries((j.pendientes || []).map((a: any) => [a.deviceId, a.deviceName])) }));
                setConfirmadas(j.confirmadas || []);
            }).catch(() => { });
            return;
        }
        getActiveAlarms().then(juntar).catch(() => { });
    }, [soloLectura]);

    useEffect(() => {
        if (!soloLectura) getIntrusionCameras().then((cams) => setNombres(Object.fromEntries(cams.map((c: any) => [c.id, c.name])))).catch(() => { });
        releer();
        const iv = setInterval(releer, soloLectura ? INTERVALO_RELECTURA_PARED_MS : INTERVALO_RELECTURA_MS);
        return () => clearInterval(iv);
    }, [releer, soloLectura]);

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

    const claveConfirmada = (c: { deviceId: string; id: string | null }) => `c:${c.deviceId}:${c.id || ""}`;
    const confirmadasVisibles = useMemo(() => (enVistaIntrusion ? [] : confirmadas.filter((c) => !ocultas.has(claveConfirmada(c)))), [confirmadas, ocultas, enVistaIntrusion]);
    // Agrupadas por cámara, la más nueva primero (sin las que se cerraron a mano en la pared).
    const porCamara = useMemo(() => {
        const m = new Map<string, Alarma[]>();
        for (const a of alarmas) if (!ocultas.has(a.id)) m.set(a.deviceId, [...(m.get(a.deviceId) || []), a]);
        return [...m.entries()].map(([deviceId, lista]) => ({ deviceId, lista: lista.sort((x, y) => y.ts.localeCompare(x.ts)) })).sort((x, y) => y.lista[0].ts.localeCompare(x.lista[0].ts));
    }, [alarmas, ocultas]);
    const visible = soloLectura ? (porCamara.length > 0 || confirmadasVisibles.length > 0) : (porCamara.length > 0 && !enMonitor);
    /** Pared con la ventana cerrada a mano y la alarma todavía vigente: la píldora para volver a verla. */
    const quedanOcultas = soloLectura && !visible && !enVistaIntrusion && (alarmas.length > 0 || confirmadas.length > 0);
    const cerrar = () => setOcultas((o) => new Set([...o, ...alarmas.map((a) => a.id), ...confirmadas.map(claveConfirmada)]));

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
        } finally { setResolviendo(null); if (soloLectura) releer(); }
    };
    /** Cerrar una confirmada desde la pared: resuelta la deja como real; falsa corrige el registro. */
    const cerrarConfirmada = async (deviceId: string, como: "resuelta" | "falsa") => {
        setResolviendo(deviceId);
        try {
            await setAttending(deviceId, false);
            if (como === "falsa") await reclasificarComoFalsa(deviceId).catch(() => null);
            setConfirmadas((prev) => prev.filter((c) => c.deviceId !== deviceId));
        } finally { setResolviendo(null); releer(); }
    };

    if (quedanOcultas) {
        const total = new Set([...alarmas.map((a) => a.deviceId), ...confirmadas.map((c) => c.deviceId)]).size;
        return (
            <button type="button" onClick={() => setOcultas(new Set())}
                className="fixed left-4 bottom-4 z-[2400] inline-flex items-center gap-2.5 h-14 pl-3 pr-5 rounded-full bg-[var(--mal)] text-white text-[16px] font-bold animate-pulse active:scale-[0.97] transition-transform">
                <ShieldAlert size={22} /> {total === 1 ? "1 cámara" : `${total} cámaras`} con intrusión sin resolver · Ver
            </button>
        );
    }
    if (!visible) return null;
    // En la pared, sin pendientes, se muestra la confirmada más reciente.
    const confirmada = porCamara.length === 0 ? confirmadasVisibles[0] : null;
    const actual = porCamara[0] || { deviceId: confirmada!.deviceId, lista: [{ id: confirmada!.id || confirmada!.deviceId, deviceId: confirmada!.deviceId, type: confirmada!.type, ts: confirmada!.ts || new Date().toISOString(), deviceName: confirmada!.deviceName, snapshotPath: confirmada!.snapshotPath } as Alarma] };
    const primera = actual.lista[0];
    const nombre = primera.deviceName || nombres[actual.deviceId] || "Cámara";
    const foto = getImagePath(snapshots[primera.id] || primera.snapshotPath) || `/api/snapshot/${actual.deviceId}?t=${Math.floor(Date.now() / 15000)}`;
    const hace = (ts: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000)); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };

    return (
        <>
            {/* La respiración roja en los bordes de toda la pantalla. No bloquea clics: el bloqueo es la ficha. */}
            <div aria-hidden className="fixed inset-0 z-[2390] pointer-events-none respirar-intrusion" />
            <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4 sm:p-8 bg-black/70 backdrop-blur-[2px]" role="alertdialog" aria-modal="true" aria-label="Intrusión detectada"
                onClick={soloLectura ? (e) => { if (e.target === e.currentTarget) cerrar(); } : undefined}>
                <div className="relative w-full max-w-4xl rounded-[14px] overflow-hidden bg-black ring-2 ring-[var(--mal)]">
                    <div className="relative aspect-video max-h-[62vh] w-full bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={foto} alt="" className="absolute inset-0 w-full h-full object-contain" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/60 pointer-events-none" />
                        <div className="absolute top-0 inset-x-0 p-4 flex items-start gap-3">
                            <span className="w-11 h-11 rounded-xl bg-[var(--mal)] grid place-items-center shrink-0 respirar-icono"><ShieldAlert size={22} className="text-white" /></span>
                            <div className="min-w-0">
                                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-red-200">{confirmada ? "Intrusión confirmada · sin resolver" : soloLectura ? "Intrusión detectada · esperando confirmación en el panel" : "Intrusión · requiere confirmación"}</div>
                                <div className="text-xl font-extrabold text-white leading-tight truncate">{TIPOS[primera.type] || TIPOS.OTHER}{primera.label && CLASES[primera.label] ? ` · ${CLASES[primera.label]}` : ""}</div>
                                <div className="text-[13px] text-white/80 truncate">{nombre} · {hace(primera.ts)}{actual.lista.length > 1 ? ` · ${actual.lista.length} detecciones en esta cámara` : ""}</div>
                            </div>
                            <div className="ml-auto flex items-center gap-2 shrink-0">
                                <button onClick={() => { const v = !silencio; setSilencio(v); try { localStorage.setItem("oa.intrusion.silencio", v ? "1" : "0"); } catch { } }} title={silencio ? "Activar sonido" : "Silenciar (la alerta sigue)"} aria-label={silencio ? "Activar sonido" : "Silenciar"} className={cn("grid place-items-center rounded-full bg-black/40 hover:bg-black/70 text-white/80 active:scale-95 transition-transform", soloLectura ? "h-12 w-12" : "h-9 w-9")}>{silencio ? <VolumeX size={soloLectura ? 22 : 16} /> : <Volume2 size={soloLectura ? 22 : 16} />}</button>
                                {/* La pared no decide, pero se puede despejar: la alarma sigue en el canal y en la píldora. */}
                                {soloLectura && <button onClick={cerrar} title="Cerrar esta ventana (la alarma sigue)" aria-label="Cerrar la ventana" className="h-12 w-12 grid place-items-center rounded-full bg-black/40 hover:bg-black/70 text-white active:scale-95 transition-transform"><X size={24} /></button>}
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
                                {soloLectura && !decide ? (
                                    <p className="text-[15px] text-white/85 leading-snug">{confirmada ? <>Un operador confirmó <b className="text-white">{(TIPOS[primera.type] || "una detección").toLowerCase()}</b> en <b className="text-white">{nombre}</b> y todavía no la resolvió.</> : <>La cámara detectó <b className="text-white">{(TIPOS[primera.type] || "una detección").toLowerCase()}</b> en <b className="text-white">{nombre}</b>. Se decide desde el panel; esta pantalla se libera sola.</>}</p>
                                ) : (<>
                                    <p className="text-[13px] text-white/85 leading-snug">La cámara confirmó <b className="text-white">{(TIPOS[primera.type] || "una detección").toLowerCase()}</b> en <b className="text-white">{nombre}</b>. Decidí qué es: la alerta no se cierra sola.</p>
                                    <button onClick={() => router.push("/admin/monitor-intrusion")} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-red-200 hover:text-white underline decoration-dotted"><ExternalLink size={12} /> Ver en el monitor de intrusión (vivo, grabación, otras cámaras)</button>
                                </>)}
                            </div>
                            {decide && confirmada && (
                                <div className="flex items-center gap-2 shrink-0">
                                    <button onClick={() => cerrarConfirmada(confirmada.deviceId, "falsa")} disabled={!!resolviendo} className="inline-flex items-center gap-1.5 px-5 h-12 rounded-[10px] bg-white/10 hover:bg-white/20 text-amber-200 text-[14px] font-extrabold ring-1 ring-white/15 disabled:opacity-50 active:scale-[0.97] transition-transform">{resolviendo === confirmada.deviceId ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} Era falsa alarma</button>
                                    <button onClick={() => cerrarConfirmada(confirmada.deviceId, "resuelta")} disabled={!!resolviendo} className="inline-flex items-center gap-2 px-6 h-12 rounded-[10px] bg-[var(--accion)] hover:opacity-90 text-white text-[15px] font-extrabold disabled:opacity-50 active:scale-[0.97] transition-transform"><Check size={17} /> Resuelta</button>
                                </div>
                            )}
                            {(!soloLectura || (decide && !confirmada)) && (
                                <div className="flex items-center gap-2 shrink-0">
                                    <button onClick={() => resolver(actual.deviceId, "false")} disabled={!!resolviendo} className="inline-flex items-center gap-1.5 px-5 h-11 rounded-[10px] bg-white/10 hover:bg-white/20 text-amber-200 text-[13px] font-extrabold ring-1 ring-white/15 disabled:opacity-50">{resolviendo === actual.deviceId ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} Falsa alarma</button>
                                    <button onClick={() => resolver(actual.deviceId, "real")} disabled={!!resolviendo} className="inline-flex items-center gap-2 px-6 h-11 rounded-[10px] bg-[var(--mal)] hover:opacity-90 text-white text-[14px] font-extrabold disabled:opacity-50"><Check size={17} /> Intrusión real: la atiendo</button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="px-4 py-2 bg-neutral-950 text-[11px] text-white/55 flex items-center gap-2"><Clock size={11} /> {soloLectura && !decide ? "Esta pantalla no decide: la alarma se resuelve desde el panel de OmniAccess. Con la X se cierra esta ventana; vuelve si llega una detección nueva." : soloLectura && confirmada ? "Resuelta: fue real y ya se atendió. Era falsa: se corrige en el historial. Con la X sólo se cierra esta ventana." : "Al confirmarla como real, la cámara queda \"en atención\" en el monitor hasta que se resuelva. Falsa alarma la archiva como tal en el historial."}</div>
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
