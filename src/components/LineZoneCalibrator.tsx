"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Radar, ShieldAlert, Save, Trash2, X, Minus, Hexagon, MousePointer2, MoveRight } from "lucide-react";
import { cn } from "@/lib/utils";

type P = { x: number; y: number }; // en % de pantalla (0–100), origen arriba-izquierda
// Hik: 0–1000 origen abajo-izquierda. Conversión:
const camToScreen = (p: { x: number; y: number }): P => ({ x: p.x / 10, y: (1000 - p.y) / 10 });
const screenToCam = (p: P) => ({ x: Math.round(p.x * 10), y: Math.round(1000 - p.y * 10) });
const SNAP = 1.5; // % de imán a los bordes
const snap = (v: number) => (v < SNAP ? 0 : v > 100 - SNAP ? 100 : v);

export function LineZoneCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const [loading, setLoading] = useState(true);
    const [support, setSupport] = useState<{ line: boolean; field: boolean }>({ line: false, field: false });
    const [tab, setTab] = useState<"line" | "zone">("line");
    const [line, setLine] = useState<P[]>([]);
    const [zone, setZone] = useState<P[]>([]);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");
    const [hint, setHint] = useState("");
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<{ kind: "line" | "zone"; i: number } | null>(null);
    const [dragIdx, setDragIdx] = useState<number>(-1);

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
        return {
            x: snap(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))),
            y: snap(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))),
        };
    };

    const onCanvasClick = (e: React.PointerEvent) => {
        if (drag.current) return;
        const p = evtPct(e);
        if (tab === "line") setLine((l) => (l.length >= 2 ? [l[1], p] : [...l, p]));
        else setZone((z) => [...z, p]);
    };
    const startDrag = (kind: "line" | "zone", i: number) => (e: React.PointerEvent) => {
        e.stopPropagation();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { kind, i }; setDragIdx(i);
    };
    const onMove = (e: React.PointerEvent) => {
        if (!drag.current) return;
        const p = evtPct(e);
        if (drag.current.kind === "line") setLine((l) => l.map((q, k) => (k === drag.current!.i ? p : q)));
        else setZone((z) => z.map((q, k) => (k === drag.current!.i ? p : q)));
    };
    const endDrag = () => { drag.current = null; setDragIdx(-1); };
    const delVertex = (i: number) => (e: React.MouseEvent) => {
        e.stopPropagation();
        if (tab === "zone") setZone((z) => (z.length > 3 ? z.filter((_, k) => k !== i) : z));
        else setLine((l) => l.filter((_, k) => k !== i));
    };

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
    const color = tab === "line" ? "#38bdf8" : "#f43f5e"; // línea celeste, zona rosa
    const colorSoft = tab === "line" ? "rgba(56,189,248,0.18)" : "rgba(244,63,94,0.16)";

    // punto medio + ángulo de la línea para la flecha de dirección
    const mid = line.length === 2 ? { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 } : null;

    return (
        <div className="fixed inset-0 z-[2000] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
            <div className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border bg-gradient-to-r from-red-500/[0.07] to-transparent">
                    <span className="w-8 h-8 rounded-xl bg-red-500/15 grid place-items-center"><Radar size={17} className="text-red-500" /></span>
                    <div className="min-w-0">
                        <div className="font-bold leading-tight truncate">Calibrar intrusión</div>
                        <div className="text-[11px] text-muted-foreground truncate">{device.name}</div>
                    </div>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-accent text-muted-foreground transition-colors"><X size={18} /></button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground p-10 justify-center"><Loader2 size={18} className="animate-spin" /> Leyendo configuración de la cámara…</div>
                ) : noneSupported ? (
                    <div className="p-6 space-y-3">
                        <div className="relative rounded-xl overflow-hidden border border-border aspect-video bg-black">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${device.id}?t=${Date.now()}`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
                        </div>
                        <div className="flex items-start gap-2 text-sm text-amber-500"><ShieldAlert size={16} className="mt-0.5 shrink-0" /> Esta cámara no soporta cruce de línea ni intrusión (es ANPR/tráfico). El calibrador aplica a cámaras AcuSense/DeepinView o canales de NVR con analítica.</div>
                    </div>
                ) : (
                    <div className="p-5 space-y-3.5">
                        {/* Tabs con icono */}
                        <div className="flex items-center gap-2">
                            <div className="inline-flex rounded-xl border border-border p-0.5 bg-background">
                                <button disabled={!support.line} onClick={() => setTab("line")}
                                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all disabled:opacity-30",
                                        tab === "line" ? "bg-sky-500/20 text-sky-300 shadow-inner" : "text-muted-foreground hover:text-foreground")}>
                                    <Minus size={14} /> Línea
                                </button>
                                <button disabled={!support.field} onClick={() => setTab("zone")}
                                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all disabled:opacity-30",
                                        tab === "zone" ? "bg-rose-500/20 text-rose-300 shadow-inner" : "text-muted-foreground hover:text-foreground")}>
                                    <Hexagon size={14} /> Zona
                                </button>
                            </div>
                            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <MousePointer2 size={13} /> {pts.length} {pts.length === 1 ? "punto" : "puntos"}
                            </span>
                        </div>

                        {/* Editor */}
                        <div className="relative rounded-xl overflow-hidden border border-border aspect-video bg-black select-none shadow-inner">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${device.id}?t=${Date.now()}`} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" draggable={false} />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
                            <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none"
                                className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                                onPointerDown={onCanvasClick} onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
                                <defs>
                                    <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#818cf8" />
                                    </linearGradient>
                                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                                        <feGaussianBlur stdDeviation="1.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                                    </filter>
                                </defs>

                                {/* LÍNEA */}
                                {tab === "line" && line.length >= 2 && (
                                    <>
                                        <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y}
                                            stroke="url(#lineGrad)" strokeWidth={3} strokeLinecap="round"
                                            vectorEffect="non-scaling-stroke" filter="url(#glow)" />
                                        <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y}
                                            stroke="#fff" strokeWidth={1} strokeLinecap="round" strokeDasharray="4 6"
                                            vectorEffect="non-scaling-stroke" opacity={0.55}>
                                            <animate attributeName="stroke-dashoffset" from="10" to="0" dur="0.6s" repeatCount="indefinite" />
                                        </line>
                                        {/* flecha de sentido de cruce (perpendicular) */}
                                        {mid && (() => {
                                            const dx = line[1].x - line[0].x, dy = line[1].y - line[0].y;
                                            const len = Math.hypot(dx, dy) || 1; const nx = -dy / len, ny = dx / len;
                                            const a = { x: mid.x, y: mid.y }, b = { x: mid.x + nx * 9, y: mid.y + ny * 9 };
                                            return (
                                                <g vectorEffect="non-scaling-stroke">
                                                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fbbf24" strokeWidth={2} vectorEffect="non-scaling-stroke" markerEnd="" />
                                                    <circle cx={b.x} cy={b.y} r={1.4} fill="#fbbf24" vectorEffect="non-scaling-stroke" />
                                                </g>
                                            );
                                        })()}
                                    </>
                                )}

                                {/* ZONA */}
                                {tab === "zone" && zone.length >= 2 && (
                                    <>
                                        <polygon points={zone.map((p) => `${p.x},${p.y}`).join(" ")} fill={colorSoft} stroke="none" />
                                        <polygon points={zone.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color}
                                            strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" filter="url(#glow)" />
                                        <polygon points={zone.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#fff"
                                            strokeWidth={0.8} strokeDasharray="3 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.5}>
                                            <animate attributeName="stroke-dashoffset" from="8" to="0" dur="0.7s" repeatCount="indefinite" />
                                        </polygon>
                                    </>
                                )}

                                {/* Handles (vértices) */}
                                {pts.map((p, i) => (
                                    <g key={i}>
                                        <circle cx={p.x} cy={p.y} r={dragIdx === i ? 3 : 2.2}
                                            fill="#fff" stroke={color} vectorEffect="non-scaling-stroke"
                                            style={{ strokeWidth: 2.5, cursor: "grab", transition: drag.current ? "none" : "r 0.12s" }}
                                            filter="url(#glow)"
                                            onPointerDown={startDrag(tab, i)}
                                            onDoubleClick={delVertex(i)} />
                                        <text x={p.x} y={p.y + 0.5} textAnchor="middle" fontSize="2.2" fontWeight="700"
                                            fill={color} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none", userSelect: "none" }}>{i + 1}</text>
                                    </g>
                                ))}
                            </svg>
                        </div>

                        {/* Ayuda */}
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {tab === "line" ? (
                                <><MoveRight size={13} className="text-amber-400 shrink-0" /> Tocá para fijar los 2 extremos · arrastrá los puntos para ajustar · doble-clic para borrar. La flecha marca el sentido de cruce.</>
                            ) : (
                                <><Hexagon size={13} className="text-rose-400 shrink-0" /> Tocá para agregar vértices · arrastrá para ajustar · doble-clic borra (mín. 3).</>
                            )}
                        </div>

                        {msg && <p className={cn("text-sm font-medium flex items-center gap-1.5", msg.includes("✓") ? "text-emerald-500" : "text-red-500")}>{msg}</p>}

                        {/* Acciones */}
                        <div className="flex items-center justify-between pt-1">
                            <button onClick={() => (tab === "line" ? setLine([]) : setZone([]))}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:text-red-400 hover:bg-red-500/10 uppercase tracking-wide transition-colors">
                                <Trash2 size={14} /> Limpiar
                            </button>
                            <button onClick={() => save(tab)} disabled={saving}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold active:scale-95 transition-all shadow-lg shadow-red-900/30 disabled:opacity-60">
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Guardar en la cámara
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
