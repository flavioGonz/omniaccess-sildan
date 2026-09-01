"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Flashlight, Moon, Sun, Footprints, BatteryFull, BatteryLow, Wifi, WifiOff,
    Compass, ShieldAlert, Radio, X, Route, Wrench, Check, HeartPulse, QrCode, Plus, Trash2, Clock
} from "lucide-react";
import { sileo as toast } from "sileo";
import { native, isNativeApp, onNativeEvent, type NativeSensorData } from "@/lib/guard-native";
import { getBarrioMap } from "@/app/actions/barriomap";
import { createBitacoraEntry } from "@/app/actions/bitacora";
import { getSetting, updateSetting } from "@/app/actions/settings";

type LatLng = { lat: number; lng: number } | null;
type Checkpoint = { id: string; label: string; key: string; intervalMin: number };

interface Props {
    socket: any;
    guardName: string;
    myLocation: LatLng;
    isAlertMode: boolean;
    onPanic: (state: boolean, reason?: string) => void;
}

function pointInPolygon(lat: number, lng: number, poly: number[][]): boolean {
    if (!poly || poly.length < 3) return true;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
const normKey = (s: string) => (s || "").toString().trim().toUpperCase();

export default function GuardNativeLayer({ socket, guardName, myLocation, isAlertMode, onPanic }: Props) {
    const nativeApp = isNativeApp();
    const [sensors, setSensors] = useState<NativeSensorData>({ type: "sensors" });
    const [nightMode, setNightMode] = useState(false);
    const [torchOn, setTorchOn] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);

    const [manDown, setManDown] = useState(false);
    const [manDownLeft, setManDownLeft] = useState(20);
    const manDownTimer = useRef<any>(null);

    const [deadmanOn, setDeadmanOn] = useState(false);
    const [deadmanMin] = useState(15);
    const [checkin, setCheckin] = useState(false);
    const [checkinLeft, setCheckinLeft] = useState(30);
    const deadmanTimer = useRef<any>(null);
    const checkinTimer = useRef<any>(null);

    // Rondas
    const [rondaOpen, setRondaOpen] = useState(false);
    const [scans, setScans] = useState<{ value: string; ts: number }[]>([]);
    const [manualPoint, setManualPoint] = useState("");
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [editing, setEditing] = useState(false);
    const [newCp, setNewCp] = useState<{ label: string; key: string; intervalMin: string }>({ label: "", key: "", intervalMin: "60" });
    const alertedMissed = useRef<Set<string>>(new Set());

    // QR
    const [qrOn, setQrOn] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const qrStream = useRef<MediaStream | null>(null);
    const qrRaf = useRef<any>(null);
    const hasBarcode = typeof window !== "undefined" && "BarcodeDetector" in window;

    const perimeterRef = useRef<number[][]>([]);
    const outsideRef = useRef(false);
    const lastFenceAlert = useRef(0);
    const locRef = useRef<LatLng>(myLocation);
    useEffect(() => { locRef.current = myLocation; }, [myLocation]);
    const guardRef = useRef(guardName);
    useEffect(() => { guardRef.current = guardName; }, [guardName]);

    useEffect(() => {
        try { setDeadmanOn(localStorage.getItem("guard_deadman") === "1"); } catch { }
    }, []);

    useEffect(() => {
        if (nativeApp) { native.startService(); native.keepAwake(true); }
        getBarrioMap().then((m: any) => { perimeterRef.current = (m && m.perimeter) || []; }).catch(() => { });
        getSetting("GUARD_CHECKPOINTS").then((s: any) => {
            try { if (s?.value) setCheckpoints(JSON.parse(s.value)); } catch { }
        }).catch(() => { });
    }, [nativeApp]);

    // ─────────── Eventos nativos ───────────
    useEffect(() => {
        const off = onNativeEvent((d) => {
            if (d.type === "sensors") {
                setSensors(d);
                if (typeof d.lux === "number" && d.lux >= 0) {
                    if (d.lux < 8) setNightMode(true);
                    else if (d.lux > 40) setNightMode(false);
                }
                try {
                    socket?.emit("guard_telemetry", { guardName: guardRef.current, battery: d.battery, charging: d.charging, signal: d.signal, heading: d.heading, steps: d.steps });
                } catch { }
            } else if (d.type === "volumepanic") {
                triggerPanic("Pánico por botón de volumen");
            } else if (d.type === "mandown") {
                startManDown();
            } else if (d.type === "nfc" && d.id) {
                handleScan(d.id);
            }
        });
        return off;
    }, [socket]);

    useEffect(() => {
        try { document.documentElement.style.filter = nightMode ? "brightness(0.72) sepia(0.15) hue-rotate(-8deg)" : ""; } catch { }
        return () => { try { document.documentElement.style.filter = ""; } catch { } };
    }, [nightMode]);

    // ─────────── Pánico ───────────
    const triggerPanic = useCallback((reason: string) => {
        onPanic(true, reason);
        native.alarm(true); native.vibrate(600); native.speak("Alerta de pánico activada");
        const loc = locRef.current;
        try {
            socket?.emit("request_backup", { id: "req-" + Date.now(), type: reason.toUpperCase(), lat: loc?.lat, lng: loc?.lng, requesterName: guardRef.current || "Guardia", requesterId: socket?.id, status: "PENDING", details: reason });
        } catch { }
        toast.error({ title: reason });
    }, [onPanic, socket]);

    useEffect(() => { if (!isAlertMode) native.alarm(false); }, [isAlertMode]);

    // ─────────── Man-down ───────────
    const startManDown = useCallback(() => {
        if (manDown) return;
        setManDown(true); setManDownLeft(20); native.vibrate(800); native.speak("Posible caída detectada. ¿Estás bien?");
        clearInterval(manDownTimer.current);
        manDownTimer.current = setInterval(() => {
            setManDownLeft((v) => { if (v <= 1) { clearInterval(manDownTimer.current); setManDown(false); triggerPanic("Caída / Man-down"); return 0; } return v - 1; });
        }, 1000);
    }, [manDown, triggerPanic]);
    const cancelManDown = () => { clearInterval(manDownTimer.current); setManDown(false); native.vibrate(80); };

    // ─────────── Dead-man ───────────
    useEffect(() => {
        clearInterval(deadmanTimer.current);
        if (deadmanOn && deadmanMin > 0) deadmanTimer.current = setInterval(() => startCheckin(), deadmanMin * 60000);
        return () => clearInterval(deadmanTimer.current);
    }, [deadmanOn, deadmanMin]);
    const startCheckin = useCallback(() => {
        setCheckin(true); setCheckinLeft(30); native.vibrate(400); native.speak("Confirmá que estás bien");
        clearInterval(checkinTimer.current);
        checkinTimer.current = setInterval(() => {
            setCheckinLeft((v) => { if (v <= 1) { clearInterval(checkinTimer.current); setCheckin(false); triggerPanic("Sin respuesta (dead-man)"); return 0; } return v - 1; });
        }, 1000);
    }, [triggerPanic]);
    const confirmCheckin = () => { clearInterval(checkinTimer.current); setCheckin(false); native.vibrate(60); toast.success({ title: "Check-in confirmado" }); };
    const toggleDeadman = () => { const nv = !deadmanOn; setDeadmanOn(nv); try { localStorage.setItem("guard_deadman", nv ? "1" : "0"); } catch { } toast.info({ title: nv ? `Dead-man activado (cada ${deadmanMin} min)` : "Dead-man desactivado" }); };

    // ─────────── Geocerca ───────────
    useEffect(() => {
        if (!myLocation) return;
        const inside = pointInPolygon(myLocation.lat, myLocation.lng, perimeterRef.current);
        if (!inside && !outsideRef.current) {
            outsideRef.current = true;
            const now = Date.now();
            if (now - lastFenceAlert.current > 60000) {
                lastFenceAlert.current = now;
                native.vibrate(500); native.speak("Saliste de la zona asignada");
                toast.error({ title: "Fuera de zona", description: "Saliste del perímetro asignado" });
                try { socket?.emit("guard_fence", { guardName: guardRef.current, lat: myLocation.lat, lng: myLocation.lng, inside: false }); } catch { }
            }
        } else if (inside && outsideRef.current) { outsideRef.current = false; toast.success({ title: "De vuelta en zona" }); }
    }, [myLocation, socket]);

    // ─────────── Rondas / checkpoints ───────────
    const handleScan = useCallback(async (value: string) => {
        const v = normKey(value);
        if (!v) return;
        setScans((prev) => [{ value: v, ts: Date.now() }, ...prev].slice(0, 80));
        alertedMissed.current.delete(v);
        native.vibrate(120);
        // ¿coincide con un checkpoint definido?
        let label = v;
        setCheckpoints((cps) => { const m = cps.find(cp => normKey(cp.key) === v || normKey(cp.label) === v); if (m) label = m.label; return cps; });
        toast.success({ title: "Punto registrado", description: label });
        try {
            const fd = new FormData();
            fd.append("type", "CHECKPOINT");
            fd.append("notes", "Ronda — " + label + " (" + v + ")");
            fd.append("guardName", guardRef.current || "Guardia");
            const loc = locRef.current;
            if (loc) { fd.append("latitude", String(loc.lat)); fd.append("longitude", String(loc.lng)); }
            await createBitacoraEntry(fd);
            socket?.emit("guard_checkpoint", { guardName: guardRef.current, value: v, label, ts: Date.now() });
        } catch { }
    }, [socket]);

    // estado de cada checkpoint (última visita)
    const cpStatus = useMemo(() => {
        return checkpoints.map(cp => {
            const k = normKey(cp.key), l = normKey(cp.label);
            const last = scans.find(s => s.value === k || s.value === l);
            const lastTs = last ? last.ts : 0;
            const ageMin = lastTs ? (Date.now() - lastTs) / 60000 : Infinity;
            const overdue = ageMin > (cp.intervalMin || 60);
            return { ...cp, lastTs, overdue, done: !!lastTs && !overdue };
        });
    }, [checkpoints, scans]);

    // detección de punto vencido -> aviso (una vez)
    useEffect(() => {
        const t = setInterval(() => {
            const now = Date.now();
            checkpoints.forEach(cp => {
                const k = normKey(cp.key), l = normKey(cp.label);
                const last = scans.find(s => s.value === k || s.value === l);
                const ageMin = last ? (now - last.ts) / 60000 : Infinity;
                if (ageMin > (cp.intervalMin || 60) && !alertedMissed.current.has(k)) {
                    alertedMissed.current.add(k);
                    native.vibrate(300); native.speak("Punto de ronda pendiente: " + cp.label);
                    toast.error({ title: "Punto de ronda pendiente", description: cp.label });
                    try { socket?.emit("guard_checkpoint_missed", { guardName: guardRef.current, label: cp.label, key: cp.key, ts: now }); } catch { }
                }
            });
        }, 30000);
        return () => clearInterval(t);
    }, [checkpoints, scans, socket]);

    useEffect(() => { if (nativeApp) native.enableNfc(rondaOpen); return () => { if (nativeApp) native.enableNfc(false); }; }, [rondaOpen, nativeApp]);

    const saveCheckpoints = async (list: Checkpoint[]) => {
        setCheckpoints(list);
        try { await updateSetting("GUARD_CHECKPOINTS", JSON.stringify(list)); toast.success({ title: "Checkpoints guardados" }); } catch { toast.error({ title: "No se pudo guardar" }); }
    };
    const addCheckpoint = () => {
        if (!newCp.label.trim()) return;
        const cp: Checkpoint = { id: "cp-" + Date.now(), label: newCp.label.trim(), key: normKey(newCp.key || newCp.label), intervalMin: Math.max(1, parseInt(newCp.intervalMin) || 60) };
        saveCheckpoints([...checkpoints, cp]);
        setNewCp({ label: "", key: "", intervalMin: "60" });
    };
    const removeCheckpoint = (id: string) => saveCheckpoints(checkpoints.filter(c => c.id !== id));

    // ─────────── QR ───────────
    const stopQr = useCallback(() => {
        setQrOn(false);
        try { cancelAnimationFrame(qrRaf.current); } catch { }
        try { qrStream.current?.getTracks().forEach(t => t.stop()); } catch { }
        qrStream.current = null;
    }, []);
    const startQr = useCallback(async () => {
        if (!hasBarcode) { toast.error({ title: "QR no soportado en este equipo" }); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            qrStream.current = stream; setQrOn(true);
            setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => { }); } }, 60);
            const Det = (window as any).BarcodeDetector;
            const det = new Det({ formats: ["qr_code"] });
            const loop = async () => {
                if (!qrStream.current || !videoRef.current) return;
                try {
                    const codes = await det.detect(videoRef.current);
                    if (codes && codes.length) { const val = codes[0].rawValue || ""; stopQr(); handleScan(val); return; }
                } catch { }
                qrRaf.current = requestAnimationFrame(loop);
            };
            qrRaf.current = requestAnimationFrame(loop);
        } catch { toast.error({ title: "No se pudo abrir la cámara" }); setQrOn(false); }
    }, [hasBarcode, handleScan, stopQr]);
    useEffect(() => () => stopQr(), [stopQr]);
    useEffect(() => { if (!rondaOpen) stopQr(); }, [rondaOpen, stopQr]);

    const battery = sensors.battery ?? -1;
    const signal = sensors.signal ?? -1;
    const doneCount = cpStatus.filter(c => c.done).length;

    return (
        <>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => { setPanelOpen(v => !v); native.vibrate(30); }}
                className="fixed z-[130] bottom-28 right-4 w-12 h-12 rounded-2xl bg-white/70 backdrop-blur-2xl border border-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.15)] flex items-center justify-center text-black/60 active:scale-90" title="Herramientas de guardia">
                <Wrench size={20} />
            </motion.button>

            <AnimatePresence>
                {panelOpen && (
                    <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        className="fixed z-[131] bottom-44 right-4 w-72 rounded-3xl bg-white/75 backdrop-blur-2xl border border-white/80 shadow-[0_16px_48px_rgba(0,0,0,0.2)] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase tracking-tight text-black">Herramientas</h3>
                            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${nativeApp ? "bg-emerald-500/15 text-emerald-600" : "bg-slate-400/15 text-slate-500"}`}>{nativeApp ? "App nativa" : "Web"}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="rounded-xl bg-black/5 py-2">
                                {battery >= 0 && battery <= 20 ? <BatteryLow size={16} className="mx-auto text-red-500" /> : <BatteryFull size={16} className="mx-auto text-emerald-600" />}
                                <p className="text-[10px] font-black mt-1">{battery >= 0 ? battery + "%" : "—"}</p>
                            </div>
                            <div className="rounded-xl bg-black/5 py-2">
                                {signal >= 0 ? <Wifi size={16} className="mx-auto text-black/60" /> : <WifiOff size={16} className="mx-auto text-black/30" />}
                                <p className="text-[10px] font-black mt-1">{signal >= 0 ? signal + "/4" : "—"}</p>
                            </div>
                            <div className="rounded-xl bg-black/5 py-2">
                                <Compass size={16} className="mx-auto text-black/60" style={{ transform: `rotate(${sensors.heading || 0}deg)` }} />
                                <p className="text-[10px] font-black mt-1">{sensors.heading != null ? Math.round(sensors.heading) + "°" : "—"}</p>
                            </div>
                            <div className="rounded-xl bg-black/5 py-2">
                                <Footprints size={16} className="mx-auto text-black/60" />
                                <p className="text-[10px] font-black mt-1">{sensors.steps ?? "—"}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => { const nv = !torchOn; setTorchOn(nv); native.torch(nv); native.vibrate(30); }} className={`flex items-center gap-2 justify-center py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition ${torchOn ? "bg-amber-400 text-black" : "bg-black/5 text-black/60"}`}><Flashlight size={16} /> Linterna</button>
                            <button onClick={() => { setNightMode(v => !v); native.vibrate(30); }} className={`flex items-center gap-2 justify-center py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition ${nightMode ? "bg-indigo-600 text-white" : "bg-black/5 text-black/60"}`}>{nightMode ? <Moon size={16} /> : <Sun size={16} />} Noche</button>
                            <button onClick={() => { setRondaOpen(true); setPanelOpen(false); native.vibrate(30); }} className="flex items-center gap-2 justify-center py-3 rounded-xl font-bold text-xs uppercase tracking-wide bg-black/5 text-black/60"><Route size={16} /> Rondas{checkpoints.length ? ` ${doneCount}/${checkpoints.length}` : ""}</button>
                            <button onClick={toggleDeadman} className={`flex items-center gap-2 justify-center py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition ${deadmanOn ? "bg-emerald-600 text-white" : "bg-black/5 text-black/60"}`}><HeartPulse size={16} /> Check-in</button>
                        </div>
                        <button onClick={() => startManDown()} className="w-full flex items-center gap-2 justify-center py-2.5 rounded-xl font-bold text-[11px] uppercase tracking-wide bg-red-500/10 text-red-600"><ShieldAlert size={15} /> Probar caída / man-down</button>
                        {nativeApp && (
                            <button onClick={() => native.openAccessibility()} className="w-full flex items-center gap-2 justify-center py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wide bg-black/5 text-black/50"><ShieldAlert size={14} /> Activar pánico bloqueado (accesibilidad)</button>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal Rondas */}
            <AnimatePresence>
                {rondaOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setRondaOpen(false)}>
                        <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }} onClick={e => e.stopPropagation()}
                            className="bg-white/90 backdrop-blur-2xl rounded-3xl p-5 w-full max-w-md shadow-2xl border border-white/80 space-y-4 max-h-[92vh] overflow-y-auto">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2"><Route size={22} className="text-[#B20D30]" /><h3 className="text-lg font-black uppercase tracking-tight">Ronda</h3></div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setEditing(v => !v)} className={`text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg ${editing ? "bg-[#B20D30] text-white" : "bg-slate-100 text-black/50"}`}>Editar</button>
                                    <button onClick={() => setRondaOpen(false)} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X size={18} /></button>
                                </div>
                            </div>

                            {/* Escaneo */}
                            {qrOn ? (
                                <div className="relative rounded-2xl overflow-hidden bg-black aspect-square">
                                    <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                                    <div className="absolute inset-8 border-4 border-white/70 rounded-2xl pointer-events-none" />
                                    <button onClick={stopQr} className="absolute bottom-3 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full bg-white text-black font-bold text-sm">Cancelar</button>
                                </div>
                            ) : (
                                <div className="rounded-2xl bg-[#B20D30]/5 border border-[#B20D30]/15 p-3 flex items-center gap-3">
                                    <Radio size={22} className="text-[#B20D30] animate-pulse shrink-0" />
                                    <p className="text-[11px] font-bold text-black/60 flex-1">{nativeApp ? "Acercá el celular al NFC del poste o escaneá el QR." : "Escaneá el QR del poste o registrá manual."}</p>
                                    {hasBarcode && <button onClick={startQr} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#B20D30] text-white font-bold text-xs uppercase"><QrCode size={15} /> QR</button>}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <input value={manualPoint} onChange={e => setManualPoint(e.target.value)} placeholder="Punto (ej: PORTON-1)" className="flex-1 h-11 px-4 rounded-xl bg-slate-50 border border-black/10 font-bold text-sm outline-none focus:border-[#B20D30]/40" />
                                <button onClick={() => { if (manualPoint.trim()) { handleScan(manualPoint.trim()); setManualPoint(""); } }} className="px-4 h-11 rounded-xl bg-[#B20D30] text-white font-bold text-sm uppercase">Fichar</button>
                            </div>

                            {/* Progreso de checkpoints predefinidos */}
                            {checkpoints.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-bold uppercase text-black/40 tracking-widest">Puntos de ronda</p>
                                        <span className="text-[10px] font-black text-[#B20D30]">{doneCount}/{checkpoints.length}</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${checkpoints.length ? (doneCount / checkpoints.length) * 100 : 0}%` }} /></div>
                                    {cpStatus.map(cp => (
                                        <div key={cp.id} className={`flex items-center gap-3 p-2.5 rounded-xl border ${cp.done ? "bg-emerald-50 border-emerald-200" : cp.overdue ? "bg-red-50 border-red-200" : "bg-slate-50 border-black/5"}`}>
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cp.done ? "bg-emerald-500/15 text-emerald-600" : cp.overdue ? "bg-red-500/15 text-red-600" : "bg-black/5 text-black/30"}`}>{cp.done ? <Check size={15} /> : <Clock size={15} />}</div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-black text-black truncate">{cp.label}</p>
                                                <p className="text-[10px] font-bold text-black/40">{cp.lastTs ? "Últ: " + new Date(cp.lastTs).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' }) : "Sin fichar"} · cada {cp.intervalMin}m</p>
                                            </div>
                                            {editing && <button onClick={() => removeCheckpoint(cp.id)} className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center"><Trash2 size={14} /></button>}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Editor de checkpoints */}
                            {editing && (
                                <div className="rounded-2xl bg-slate-50 border border-black/10 p-3 space-y-2">
                                    <p className="text-[10px] font-bold uppercase text-black/40 tracking-widest">Nuevo punto</p>
                                    <input value={newCp.label} onChange={e => setNewCp({ ...newCp, label: e.target.value })} placeholder="Nombre (ej: Portón principal)" className="w-full h-10 px-3 rounded-lg bg-white border border-black/10 text-sm font-bold outline-none" />
                                    <div className="flex gap-2">
                                        <input value={newCp.key} onChange={e => setNewCp({ ...newCp, key: e.target.value })} placeholder="NFC/QR (opcional)" className="flex-1 h-10 px-3 rounded-lg bg-white border border-black/10 text-sm font-bold outline-none" />
                                        <input value={newCp.intervalMin} onChange={e => setNewCp({ ...newCp, intervalMin: e.target.value.replace(/[^0-9]/g, "") })} placeholder="min" className="w-20 h-10 px-3 rounded-lg bg-white border border-black/10 text-sm font-bold outline-none text-center" />
                                    </div>
                                    <button onClick={addCheckpoint} className="w-full h-10 rounded-lg bg-[#B20D30] text-white font-bold text-xs uppercase flex items-center justify-center gap-2"><Plus size={15} /> Agregar punto</button>
                                </div>
                            )}

                            {/* Fichajes del turno */}
                            <div className="space-y-1.5">
                                <p className="text-[10px] font-bold uppercase text-black/40 tracking-widest">Fichajes del turno ({scans.length})</p>
                                {scans.length === 0 ? <p className="text-xs text-black/30 font-semibold py-4 text-center">Sin fichajes todavía</p> :
                                    scans.slice(0, 12).map((s, i) => (
                                        <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 border border-black/5">
                                            <Check size={14} className="text-emerald-600" />
                                            <span className="flex-1 text-xs font-black truncate">{s.value}</span>
                                            <span className="text-[10px] font-bold text-black/40">{new Date(s.ts).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    ))}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Man-down */}
            <AnimatePresence>
                {manDown && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[220] bg-red-600/90 backdrop-blur-md flex items-center justify-center p-6">
                        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-center text-white space-y-6 max-w-sm">
                            <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1 }}><ShieldAlert size={90} className="mx-auto" /></motion.div>
                            <div><h2 className="text-3xl font-black uppercase tracking-tight">Posible caída</h2><p className="text-white/80 font-bold mt-2">Alerta de pánico en <span className="text-4xl font-black">{manDownLeft}</span> s</p></div>
                            <button onClick={cancelManDown} className="w-full py-6 rounded-3xl bg-white text-red-600 font-black text-xl uppercase tracking-wide active:scale-95">Estoy bien</button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Check-in */}
            <AnimatePresence>
                {checkin && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[215] bg-black/80 backdrop-blur-md flex items-center justify-center p-6">
                        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-center text-white space-y-6 max-w-sm">
                            <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1 }}><HeartPulse size={80} className="mx-auto text-emerald-400" /></motion.div>
                            <div><h2 className="text-2xl font-black uppercase tracking-tight">Confirmá que estás bien</h2><p className="text-white/70 font-bold mt-2">Alerta automática en <span className="text-3xl font-black">{checkinLeft}</span> s</p></div>
                            <button onClick={confirmCheckin} className="w-full py-6 rounded-3xl bg-emerald-500 text-white font-black text-xl uppercase tracking-wide active:scale-95">Estoy bien</button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
