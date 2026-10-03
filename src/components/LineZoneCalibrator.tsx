"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Radar, ShieldAlert, Save, Trash2, X, Minus, Hexagon, MousePointer2, ArrowLeftRight, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { PtzControls } from "@/components/PtzControls";

type P = { x: number; y: number }; // en % de pantalla (0–100), origen arriba-izquierda
// Hik/Dahua: 0–1000 origen abajo-izquierda. Conversión:
const camToScreen = (p: { x: number; y: number }): P => ({ x: p.x / 10, y: (1000 - p.y) / 10 });
const screenToCam = (p: P) => ({ x: Math.round(p.x * 10), y: Math.round(1000 - p.y * 10) });
const SNAP = 1.5; // % de imán a los bordes
const snap = (v: number) => (v < SNAP ? 0 : v > 100 - SNAP ? 100 : v);

type Dir = "both" | "ab" | "ba";

export function LineZoneCalibrator({ device, onClose }: { device: any; onClose: () => void }) {
    const isPtz = /ptz/i.test(device?.name || "");
    const [loading, setLoading] = useState(true);
    const [support, setSupport] = useState<{ line: boolean; field: boolean }>({ line: false, field: false });
    const [tab, setTab] = useState<"line" | "zone">("line");
    const [line, setLine] = useState<P[]>([]);
    const [zone, setZone] = useState<P[]>([]);
    const [dir, setDir] = useState<Dir>("both");
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");
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
                if (d.line?.direction) setDir(d.line.direction as Dir);
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
                body: JSON.stringify({ kind: kind === "line" ? "line" : "field", enabled: true, points: pts.map(screenToCam), ...(kind === "line" ? { direction: dir } : {}) }),
            });
            const d = await r.json();
            setMsg(d.ok ? "Guardado en la cámara ✓" : (d.error || "No se pudo guardar"));
        } catch (e: any) { setMsg(e?.message || "Error al guardar"); }
        finally { setSaving(false); }
    };

    const noneSupported = !loading && !support.line && !support.field;
    const pts = tab === "line" ? line : zone;
    const color = tab === "line" ? "#38bdf8" : "#f43f5e";
    const colorSoft = tab === "line" ? "rgba(56,189,248,0.16)" : "rgba(244,63,94,0.15)";

    const mid = line.length === 2 ? { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 } : null;
    // vector normal unitario a la línea (para las flechas de sentido)
    const normal = (() => {
        if (line.length !== 2) return null;
        const dx = line[1].x - line[0].x, dy = line[1].y - line[0].y;
        const len = Math.hypot(dx, dy) || 1;
        return { nx: -dy / len, ny: dx / len };
    })();

    // dibuja una flecha desde mid en el sentido (sign*normal)
    const arrow = (sign: 1 | -1, key: string) => {
        if (!mid || !normal) return null;
        const L = 8, head = 2.6;
        const ux = normal.nx * sign, uy = normal.ny * sign;
        const tip = { x: mid.x + ux * L, y: mid.y + uy * L };
        // perpendicular al eje de la flecha para las alas de la cabeza
        const px = -uy, py = ux;
        const w1 = { x: tip.x - ux * head + px * (head * 0.55), y: tip.y - uy * head + py * (head * 0.55) };
        const w2 = { x: tip.x - ux * head - px * (head * 0.55), y: tip.y - uy * head - py * (head * 0.55) };
        return (
            <g key={key} vectorEffect="non-scaling-stroke">
                <line x1={mid.x} y1={mid.y} x2={tip.x} y2={tip.y} stroke="#fbbf24" strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" filter="url(#glow)" />
                <polygon points={`${tip.x},${tip.y} ${w1.x},${w1.y} ${w2.x},${w2.y}`} fill="#fbbf24" vectorEffect="non-scaling-stroke" />
            </g>
        );
    };

    const dirBtns: { v: Dir; Icon: any; label: string }[] = [
        { v: "ab", Icon: ArrowRight, label: "A→B" },
        { v: "both", Icon: ArrowLeftRight, label: "Ambos" },
        { v: "ba", Icon: ArrowLeft, label: "B→A" },
    ];

    return (
        <div className="fixed inset-0 z-[2000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
            <div className="w-full max-w-4xl rounded-2xl bg-neutral-950 border border-white/10 shadow-2xl overflow-hidden ring-1 ring-black/40" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/[0.06] bg-gradient-to-r from-red-500/[0.08] via-transparent to-transparent">
                    <span className="w-8 h-8 rounded-xl bg-red-500/15 grid place-items-center ring-1 ring-red-500/20"><Radar size={16} className="text-red-500" /></span>
                    <div className="min-w-0">
                        <div className="font-bold text-[13.5px] leading-tight truncate text-white">Calibrar intrusión</div>
                        <div className="text-[11px] text-white/45 truncate">{device.name}</div>
                    </div>
                    <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"><X size={17} /></button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-white/50 p-12 justify-center"><Loader2 size={18} className="animate-spin" /> Leyendo configuración de la cámara…</div>
                ) : noneSupported ? (
                    <div className="p-5 space-y-3">
                        <div className="relative rounded-xl overflow-hidden aspect-video bg-black">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${device.id}?t=${Date.now()}`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
                            {isPtz && <div className="absolute bottom-3 right-3 z-20"><PtzControls deviceId={device.id} config /></div>}
                        </div>
                        {isPtz ? (
                            <div className="flex items-start gap-2 text-sm text-red-300/90"><Radar size={16} className="mt-0.5 shrink-0" /> Cámara PTZ: movela con el control, guardá presets en la posición actual e iniciá el crucero. (Esta cámara no usa cruce de línea / zona.)</div>
                        ) : (
                            <div className="flex items-start gap-2 text-sm text-amber-400/90"><ShieldAlert size={16} className="mt-0.5 shrink-0" /> Esta cámara no soporta cruce de línea ni intrusión (es ANPR/tráfico). El calibrador aplica a cámaras AcuSense/DeepinView o canales de NVR con analítica.</div>
                        )}
                    </div>
                ) : (
                    <div className="p-4">
                        {/* Editor con TODOS los controles como overlay (sin marcos) */}
                        <div className="relative rounded-xl overflow-hidden aspect-video bg-black select-none">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/snapshot/${device.id}?t=${Date.now()}`} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" draggable={false} />
                            {isPtz && <div className="absolute bottom-3 right-3 z-20"><PtzControls deviceId={device.id} config /></div>}

                            <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none"
                                className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                                onPointerDown={onCanvasClick} onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
                                <defs>
                                    <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#818cf8" />
                                    </linearGradient>
                                    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
                                        <feGaussianBlur stdDeviation="0.9" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                                    </filter>
                                </defs>

                                {/* LÍNEA */}
                                {tab === "line" && line.length >= 2 && (
                                    <>
                                        <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y}
                                            stroke="url(#lineGrad)" strokeWidth={2.4} strokeLinecap="round"
                                            vectorEffect="non-scaling-stroke" filter="url(#glow)" />
                                        <line x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y}
                                            stroke="#fff" strokeWidth={0.8} strokeLinecap="round" strokeDasharray="3 6"
                                            vectorEffect="non-scaling-stroke" opacity={0.5}>
                                            <animate attributeName="stroke-dashoffset" from="9" to="0" dur="0.6s" repeatCount="indefinite" />
                                        </line>
                                        {/* flechas de sentido */}
                                        {(dir === "both" || dir === "ab") && arrow(1, "a+")}
                                        {(dir === "both" || dir === "ba") && arrow(-1, "a-")}
                                    </>
                                )}

                                {/* ZONA */}
                                {tab === "zone" && zone.length >= 2 && (
                                    <>
                                        <polygon points={zone.map((p) => `${p.x},${p.y}`).join(" ")} fill={colorSoft} stroke="none" />
                                        <polygon points={zone.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color}
                                            strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" filter="url(#glow)" />
                                        <polygon points={zone.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#fff"
                                            strokeWidth={0.6} strokeDasharray="2 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.45}>
                                            <animate attributeName="stroke-dashoffset" from="7" to="0" dur="0.7s" repeatCount="indefinite" />
                                        </polygon>
                                    </>
                                )}

                                {/* Handles delicados */}
                                {pts.map((p, i) => (
                                    <g key={i}>
                                        <circle cx={p.x} cy={p.y} r={dragIdx === i ? 1.9 : 1.3}
                                            fill={color} stroke="#fff" vectorEffect="non-scaling-stroke"
                                            style={{ strokeWidth: 1.4, cursor: "grab", transition: drag.current ? "none" : "r 0.12s" }}
                                            filter="url(#glow)"
                                            onPointerDown={startDrag(tab, i)}
                                            onDoubleClick={delVertex(i)} />
                                        <text x={p.x} y={p.y - 2.4} textAnchor="middle" fontSize="1.9" fontWeight="800"
                                            fill="#fff" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none", userSelect: "none", paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 0.5 }}>{i + 1}</text>
                                    </g>
                                ))}
                            </svg>

                            {/* Overlay TOP: tabs (izq) · sentido (centro) · puntos (der) */}
                            <div className="absolute top-0 inset-x-0 p-2.5 flex items-start justify-between gap-2 pointer-events-none bg-gradient-to-b from-black/55 to-transparent">
                                <div className="inline-flex rounded-full bg-black/45 backdrop-blur-md p-0.5 pointer-events-auto ring-1 ring-white/10">
                                    <button disabled={!support.line} onClick={() => setTab("line")}
                                        className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all disabled:opacity-30",
                                            tab === "line" ? "bg-sky-500/90 text-white shadow" : "text-white/60 hover:text-white")}>
                                        <Minus size={13} /> Línea
                                    </button>
                                    <button disabled={!support.field} onClick={() => setTab("zone")}
                                        className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all disabled:opacity-30",
                                            tab === "zone" ? "bg-rose-500/90 text-white shadow" : "text-white/60 hover:text-white")}>
                                        <Hexagon size={13} /> Zona
                                    </button>
                                </div>

                                {tab === "line" && (
                                    <div className="inline-flex rounded-full bg-black/45 backdrop-blur-md p-0.5 pointer-events-auto ring-1 ring-white/10">
                                        {dirBtns.map(({ v, Icon, label }) => (
                                            <button key={v} onClick={() => setDir(v)} title={label === "Ambos" ? "Cruce en ambos sentidos" : `Solo ${label}`}
                                                className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-wide transition-all",
                                                    dir === v ? "bg-amber-400 text-black shadow" : "text-white/60 hover:text-white")}>
                                                <Icon size={13} /> {label}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/45 backdrop-blur-md text-[11px] font-semibold text-white/80 pointer-events-auto ring-1 ring-white/10">
                                    <MousePointer2 size={12} /> {pts.length} {pts.length === 1 ? "punto" : "puntos"}
                                </span>
                            </div>

                            {/* Overlay BOTTOM: ayuda (izq) · acciones (der) */}
                            <div className="absolute bottom-0 inset-x-0 p-2.5 flex items-end justify-between gap-2 pointer-events-none bg-gradient-to-t from-black/65 to-transparent">
                                <p className="text-[10.5px] text-white/65 max-w-[52%] leading-snug hidden sm:block">
                                    {tab === "line"
                                        ? "Tocá para fijar los 2 extremos · arrastrá para ajustar · doble-clic borra. Las flechas marcan el sentido de cruce."
                                        : "Tocá para agregar vértices · arrastrá para ajustar · doble-clic borra (mín. 3)."}
                                </p>
                                <div className="flex items-center gap-2 ml-auto pointer-events-auto">
                                    <button onClick={() => (tab === "line" ? setLine([]) : setZone([]))}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/45 backdrop-blur-md text-[11px] font-bold text-white/70 hover:text-red-300 hover:bg-red-500/20 uppercase tracking-wide transition-colors ring-1 ring-white/10">
                                        <Trash2 size={13} /> Limpiar
                                    </button>
                                    <button onClick={() => save(tab)} disabled={saving}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 text-white text-[12px] font-bold active:scale-95 transition-all shadow-lg shadow-red-900/40 disabled:opacity-60 ring-1 ring-red-400/30">
                                        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
                                    </button>
                                </div>
                            </div>

                            {/* Toast de resultado */}
                            {msg && (
                                <div className={cn("absolute left-1/2 -translate-x-1/2 bottom-14 px-3.5 py-1.5 rounded-full text-[12px] font-semibold backdrop-blur-md ring-1 shadow-lg pointer-events-none",
                                    msg.includes("✓") ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/30" : "bg-red-500/25 text-red-100 ring-red-400/40")}>
                                    {msg}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
