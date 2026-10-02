"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { Timeline, TimelineState } from "@xzdarcy/react-timeline-editor";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";

type Ev = { id: string; ts: string; type?: string; label?: string };

const START_LEFT = 20;

/**
 * Línea de tiempo de playback basada en react-timeline-editor (xzdarcy).
 * No edita: cursor arrastrable + click para buscar, zoom milimétrico, marcadores de eventos
 * y preview de hover. El ancho de escala se calcula para que el contenido llene exactamente
 * el contenedor (así la librería NO agrega celdas de relleno = NO se muestra tiempo futuro).
 */
export function PlaybackTimeline({ startMs, endMs, valueMs, events, onSeek, scaleSec, onEventClick }:
    { startMs: number; endMs: number; valueMs: number; events: Ev[]; onSeek: (ms: number) => void; scaleSec: number; onEventClick?: (e: Ev) => void }) {
    const ref = useRef<TimelineState>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
    const [cw, setCw] = useState(0); // ancho del contenedor
    const totalSec = Math.max(60, (endMs - startMs) / 1000);

    // medir ancho del contenedor (para ajustar scaleWidth y no dejar celdas futuras)
    useEffect(() => {
        const el = wrapRef.current; if (!el) return;
        const ro = new ResizeObserver((ents) => { const w = ents[0]?.contentRect?.width || el.clientWidth; if (w) setCw(w); });
        ro.observe(el); setCw(el.clientWidth || 0);
        return () => ro.disconnect();
    }, []);

    const units = Math.max(1, Math.round(totalSec / scaleSec));   // nº de divisiones
    const ticks = units + 1;
    const labelMin = scaleSec <= 60 ? 66 : 48;                     // ancho mínimo legible por etiqueta
    // llena exactamente el ancho; si las etiquetas necesitan más, usa el mínimo (y habrá scroll, pero sin futuro)
    const scaleWidth = Math.max(labelMin, Math.ceil(((cw || 1000) - START_LEFT) / units));

    // px visible → tiempo (teniendo en cuenta el scroll horizontal del timeline)
    const xToTime = (clientX: number): { x: number; t: number } | null => {
        const wrap = wrapRef.current; if (!wrap) return null;
        const area = (wrap.querySelector(".timeline-editor-edit-area") as HTMLElement) || wrap;
        const scroller = wrap.querySelector(".timeline-editor-edit-area .ReactVirtualized__Grid") as HTMLElement | null;
        const rect = area.getBoundingClientRect();
        const xVis = clientX - rect.left;
        const scrollLeft = scroller ? scroller.scrollLeft : 0;
        const t = Math.max(0, Math.min(totalSec, (xVis + scrollLeft - START_LEFT) / scaleWidth * scaleSec));
        return { x: xVis, t };
    };

    const data = useMemo(() => {
        const acts = (events || [])
            .map((e) => ({ e, t: (new Date(e.ts).getTime() - startMs) / 1000 }))
            .filter((x) => x.t >= 0 && x.t <= totalSec)
            .map(({ e, t }) => ({ id: e.id, start: t, end: t + 0.001, effectId: "ev", movable: false, flexible: false, disableDrag: true, data: e }));
        return [{ id: "rec", actions: acts }] as any;
    }, [events, startMs, totalSec, scaleSec]);

    // cursor controlado desde el reloj externo
    useEffect(() => { const s = ref.current; if (!s) return; try { s.setTime(Math.max(0, Math.min(totalSec, (valueMs - startMs) / 1000))); } catch { } }, [valueMs, startMs, totalSec]);

    const fmt = (sec: number) => {
        const d = new Date(startMs + sec * 1000);
        const p = (n: number) => String(n).padStart(2, "0");
        return scaleSec <= 60 ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` : `${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    return (
        <div className="ptl-wrap" ref={wrapRef} style={{ ["--ptl-sw" as any]: `${scaleWidth}px` }}
            onMouseMove={(e) => setHover(xToTime(e.clientX))}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => { const h = xToTime(e.clientX); if (h) onSeek(startMs + h.t * 1000); }}>
            {/* preview al pasar el mouse (sin clic): línea azul + hora */}
            {hover && (
                <>
                    <div className="ptl-hover-line" style={{ left: hover.x }} />
                    <div className="ptl-hover-lbl" style={{ left: hover.x }}>{fmt(hover.t)}</div>
                </>
            )}
            <Timeline
                ref={ref}
                style={{ width: "100%", height: 60 }}
                editorData={data}
                effects={{ ev: { id: "ev", name: "Evento" } }}
                scale={scaleSec}
                scaleWidth={scaleWidth}
                startLeft={START_LEFT}
                rowHeight={28}
                autoScroll
                dragLine={false}
                gridSnap={false}
                disableDrag
                minScaleCount={ticks}
                maxScaleCount={ticks}
                getScaleRender={(s: number) => <span className="ptl-scale">{fmt(s)}</span>}
                onClickTimeArea={(t: number) => { onSeek(startMs + t * 1000); return true; }}
                onCursorDrag={(t: number) => { onSeek(startMs + t * 1000); }}
                onCursorDragEnd={(t: number) => { onSeek(startMs + t * 1000); }}
                getActionRender={(action: any) => (
                    <div className="ptl-ev" title={`${action.data?.label || "Evento"} · ${new Date(action.data ? new Date(action.data.ts) : startMs).toLocaleTimeString("es-UY")} · (clic para abrir)`}
                        onClick={(e) => { e.stopPropagation(); if (action.data) onEventClick?.(action.data); }}>
                        {/* mini badge de acción, flotando ARRIBA de la hora */}
                        <span className="ptl-ico">
                            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
                                <path d="M12 3 L22 20.5 H2 Z" fill="#1c1917" />
                                <rect x="11" y="9" width="2" height="6" rx="1" fill="#fff" />
                                <circle cx="12" cy="17.4" r="1.2" fill="#fff" />
                            </svg>
                        </span>
                        <span className="ptl-ico-stem" />
                    </div>
                )}
            />
            <style jsx global>{`
                .ptl-wrap { position: relative; height: 60px; border-radius: 8px; overflow: visible; background: transparent; font-family: inherit; }
                .ptl-wrap .timeline-editor { height: 60px !important; background: transparent; font-family: inherit; }
                .ptl-wrap .timeline-editor-time-area { height: 28px !important; background: rgba(255,255,255,0.04) !important; border-bottom: 1px solid rgba(255,255,255,0.1); }
                .ptl-wrap .timeline-editor-time-area .ReactVirtualized__Grid { height: 28px !important; overflow: visible !important; background: transparent; }
                .ptl-wrap .timeline-editor-time-unit-scale { top: 7px !important; white-space: nowrap; overflow: visible; }
                .ptl-wrap .timeline-editor-time-unit { border-right: 1px solid rgba(255,255,255,0.09) !important; }
                .ptl-wrap .timeline-editor-time-unit.timeline-editor-time-unit-big { border-right-color: rgba(255,255,255,0.16) !important; }
                .ptl-wrap .timeline-editor-edit-area { background:
                    repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0, rgba(255,255,255,0.06) 1px, transparent 1px, transparent var(--ptl-sw, 100px)) !important; }
                .ptl-wrap .timeline-editor-edit-area .ReactVirtualized__Grid { background: transparent; }
                .ptl-wrap .timeline-editor-edit-row { background: transparent !important; }
                .ptl-scale { font-size: 10px; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; white-space: nowrap; }
                .ptl-wrap .timeline-editor-cursor { cursor: ew-resize; }
                .ptl-wrap .timeline-editor-cursor-top { border-top-color: #ef4444 !important; filter: drop-shadow(0 0 3px rgba(239,68,68,0.9)); }
                .ptl-wrap .timeline-editor-cursor-area { width: 2px !important; background: #ef4444 !important; box-shadow: 0 0 8px rgba(239,68,68,0.95); }
                .ptl-wrap .timeline-editor-action { background: transparent !important; overflow: visible !important; }
                .ptl-ev { position: absolute; inset: 0; overflow: visible; cursor: pointer; }
                /* línea finita que baja del badge hacia la hora */
                .ptl-ico-stem { position: absolute; left: 0; top: -2px; width: 1.5px; height: 10px; transform: translateX(-50%); background: #f59e0b; box-shadow: 0 0 4px rgba(245,158,11,0.9); pointer-events: none; }
                /* badge de acción flotando por ENCIMA del eje de horas */
                .ptl-ico { position: absolute; left: 0; top: -18px; transform: translateX(-50%); display: grid; place-items: center; width: 18px; height: 18px; border-radius: 9999px; background: linear-gradient(180deg,#fbbf24,#f59e0b); border: 1.5px solid #1c1917; box-shadow: 0 2px 6px rgba(0,0,0,0.5); pointer-events: auto; cursor: pointer; transition: transform .1s; z-index: 10; }
                .ptl-ico:hover { transform: translateX(-50%) scale(1.3); }
                .ptl-hover-line { position: absolute; top: 0; bottom: 0; width: 1.5px; background: #38bdf8; box-shadow: 0 0 8px rgba(56,189,248,0.9); z-index: 8; pointer-events: none; }
                .ptl-hover-lbl { position: absolute; top: 2px; transform: translateX(-50%); z-index: 9; pointer-events: none; padding: 1px 6px; border-radius: 6px; background: #0284c7; color: #fff; font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }
                .ptl-wrap ::-webkit-scrollbar { height: 8px; }
                .ptl-wrap ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 8px; }
                .ptl-wrap ::-webkit-scrollbar-track { background: transparent; }
            `}</style>
        </div>
    );
}
