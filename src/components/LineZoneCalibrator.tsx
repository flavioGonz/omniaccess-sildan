"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Radar, ShieldAlert, Save, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type P = { x: number; y: number }; // en % de pantalla (0–100), origen arriba-izquierda
// Hik: 0–1000 origen abajo-izquierda. Conversión:
const camToScreen = (p: { x: number; y: number }): P => ({ x: p.x / 10, y: (1000 - p.y) / 10 });
const screenToCam = (p: P) => ({ x: Math.round(p.x * 10), y: Math.round(1000 - p.y * 10) });

export function LineZoneCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const [loading, setLoading] = useState(true);
    const [support, setSupport] = useState<{ line: boolean; field: boolean }>({ line: false, field: false });
    const [tab, setTab] = useState<"line" | "zone">("line");
    const [line, setLine] = useState<P[]>([]);
    const [zone, setZone] = useState<P[]>([]);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<{ kind: "line" | "zone"; i: number } | null>(null);

    useEffect(() => {
        let alive = true; setLoading(true); setMsg("");
        fetch(`/api/devices/analytics?deviceId=${device.id}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
                if (!alive) return;
                if (!d.ok) { setMsg(d.error || "No se pudo leer la cámara"); setLoading(false); return; }
                setSupport(d.support || { line: false, field: false });
                setLine((d.line?.points || []).map(camToScreen));
                setZone((d.field?.points || []).map(camToScreen));
                setTab(d.support?.line ? "line" : d.support?.field ? "zone" : "line");
                setLoading(false);
            })
            .catch(() => { if (alive) { setMsg("Error de conexión con la cámara"); setLoading(false); } });
        return () => { alive = false; };
    }, [device.id]);

    const evtPct = (e: React.PointerEvent): P => {
        const r = svgRef.current!.getBoundingClientRect();
        return { x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)) };
    };

    const onCanvasClick = (e: React.PointerEvent) => {
        if (drag.current) return;
        const p = evtPct(e);
        if (tab === "line") { setLine((l) => (l.length >= 2 ? [l[1], p] : [...l, p])); }
        else { setZone((z) => [...z, p]); }
    };
    const startDrag = (kind: "line" | "zone", i: number) => (e: React.PointerEvent) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { kind, i }; };
    const onMove = (e: React.PointerEvent) => {
        if (!drag.current) return;
        const p = evtPct(e);
        if (drag.current.kind === "line") setLine((l) => l.map((q, k) => (k === drag.current!.i ? p : q)));
        else setZone((z) => z.map((q, k) => (k === drag.current!.i ? p : q)));
    };
    const endDrag = () => { drag.current = null; };

    const save = async (kind: "line" | "zone") => {
        const pts = kind === "line" ? line : zone;
        if (kind === "line" && pts.length !== 2) { setMsg("La línea necesita exactamente 2 puntos."); return; }
        if (kind === "zone" && pts.length < 3) { setMsg("La zona necesita al menos 3 puntos."); return; }
        setSaving(true); setMsg("");
        try {
            const r = await fetch(`/api/devices/analytics?deviceId=${device.id}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: kind === "line" ? "line" : "field", enabled: true, points: pts.map(screenToCam) }),
            });
            const d = await r.json();
            setMsg(d.ok ? "Guardado en la cámara ✓" : (d.error || "No se pudo guardar"));
        } catch (e: any) { setMsg(e?.message || "Error al guardar"); }
        finally { setSaving(false); }
    };

    const noneSupported = !loading && !support.line && !support.field;
    const pts = tab === "line" ? line : zone;

    return (
        <div className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
            <div className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
                    <Radar size={18} className="text-red-500" />
                    <span className="font-bold">Calibrar líneas y zonas · {device.name}</span>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground"><X size={18} /></button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground p-8 justify-center"><Loader2 size={18} className="animate-spin" /> Leyendo configuración de la cámara…</div>
                ) : noneSupported ? (
                    <div className="p-6 space-y-3">
                        <div className="relative rounded-lg overflow-hidden border border-border aspect-video bg-black">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${device.id}?t=${Date.now()}`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
                        </div>
                        <div className="flex items-start gap-2 text-sm text-amber-500"><ShieldAlert size={16} className="mt-0.5 shrink-0" /> Esta cámara no soporta cruce de línea ni intrusión (es ANPR/tráfico). El calibrador aplica a cámaras AcuSense/DeepinView.</div>
                    </div>
                ) : (
                    <div className="p-5 space-y-3">
                        {/* Tabs */}
                        <div className="inline-flex rounded-xl border border-border p-0.5 bg-background">
                            <button disabled={!support.line} onClick={() => setTab("line")} className={cn("px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-30", tab === "line" ? "bg-red-500/20 text-red-300" : "text-muted-foreground")}>Línea</button>
                            <button disabled={!support.field} onClick={() => setTab("zone")} className={cn("px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-30", tab === "zone" ? "bg-red-500/20 text-red-300" : "text-muted-foreground")}>Zona</button>
                        </div>

                        {/* Editor */}
                        <div className="relative rounded-lg overflow-hidden border border-border aspect-video bg-black select-none">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${device.id}?t=${Date.now()}`} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
                            <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                                onPointerDown={onCanvasClick} onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
                                {tab === "line" && line.length >= 2 && (
                                    <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y} stroke="#ef4444" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 3 }} />
                                )}
                                {tab === "zone" && zone.length >= 2 && (
                                    <polygon points={zone.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(239,68,68,0.22)" stroke="#ef4444" style={{ strokeWidth: 2 }} vectorEffect="non-scaling-stroke" />
                                )}
                                {pts.map((p, i) => (
                                    <circle key={i} cx={p.x} cy={p.y} r={1.6} fill="#fff" stroke="#ef4444" style={{ strokeWidth: 2, cursor: "grab" }} vectorEffect="non-scaling-stroke"
                                        onPointerDown={startDrag(tab, i)} />
                                ))}
                            </svg>
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {tab === "line" ? "Tocá para fijar los 2 extremos de la línea; arrastrá los puntos para ajustar." : "Tocá para agregar vértices de la zona; arrastrá para ajustar."}
                        </div>

                        {msg && <p className={cn("text-sm", msg.includes("✓") ? "text-emerald-500" : "text-red-500")}>{msg}</p>}

                        <div className="flex items-center justify-between pt-1">
                            <button onClick={() => (tab === "line" ? setLine([]) : setZone([]))} className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-red-400 uppercase tracking-wide">
                                <Trash2 size={14} /> Limpiar
                            </button>
                            <button onClick={() => save(tab)} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold active:scale-95">
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar en la cámara
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
