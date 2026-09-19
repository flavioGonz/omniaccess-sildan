"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Activity, TrendingUp, ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface HourlyBucket {
    hour: number;
    total: number;
    grants: number;
    denies: number;
    entries: number;
    exits: number;
}

export function HourlyChart({ data }: { data: HourlyBucket[] }) {
    const { maxVal, currentHour, peakHour, totalToday } = useMemo(() => {
        const max = Math.max(...data.map(d => d.total), 1);
        const now = new Date().getHours();
        const peak = data.reduce((a, b) => (b.total > a.total ? b : a), data[0]);
        const sum = data.reduce((acc, d) => acc + d.total, 0);
        return { maxVal: max, currentHour: now, peakHour: peak, totalToday: sum };
    }, [data]);

    if (data.length === 0) return null;

    // SVG chart dimensions
    const W = 800;
    const H = 120;
    const padL = 28;
    const padR = 8;
    const padT = 8;
    const padB = 22;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    // Build path points
    const points = data.map((d, i) => {
        const x = padL + (i / Math.max(data.length - 1, 1)) * chartW;
        const y = padT + chartH - (d.total / maxVal) * chartH;
        return { x, y, d };
    });

    // Smooth curve
    const linePath = points.map((p, i) => {
        if (i === 0) return `M ${p.x} ${p.y}`;
        const prev = points[i - 1];
        const cpx = (prev.x + p.x) / 2;
        return `C ${cpx} ${prev.y}, ${cpx} ${p.y}, ${p.x} ${p.y}`;
    }).join(" ");

    const areaPath = linePath + ` L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;

    // Entries path
    const entryPoints = data.map((d, i) => {
        const x = padL + (i / Math.max(data.length - 1, 1)) * chartW;
        const y = padT + chartH - (d.entries / maxVal) * chartH;
        return { x, y };
    });
    const entryPath = entryPoints.map((p, i) => {
        if (i === 0) return `M ${p.x} ${p.y}`;
        const prev = entryPoints[i - 1];
        const cpx = (prev.x + p.x) / 2;
        return `C ${cpx} ${prev.y}, ${cpx} ${p.y}, ${p.x} ${p.y}`;
    }).join(" ");

    // Exits path
    const exitPoints = data.map((d, i) => {
        const x = padL + (i / Math.max(data.length - 1, 1)) * chartW;
        const y = padT + chartH - (d.exits / maxVal) * chartH;
        return { x, y };
    });
    const exitPath = exitPoints.map((p, i) => {
        if (i === 0) return `M ${p.x} ${p.y}`;
        const prev = exitPoints[i - 1];
        const cpx = (prev.x + p.x) / 2;
        return `C ${cpx} ${prev.y}, ${cpx} ${p.y}, ${p.x} ${p.y}`;
    }).join(" ");

    // Y-axis grid lines
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
        y: padT + chartH - pct * chartH,
        label: Math.round(maxVal * pct),
    }));

    return (
        <div className="bg-card/60 border border-border/50 rounded-lg overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-border/40">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-violet-500/10">
                        <Activity size={14} className="text-violet-400" />
                    </div>
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold">
                        Afluencia por Hora
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    {/* Legend */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-0.5 bg-emerald-400 rounded-full" />
                            <span className="text-[9px] text-muted-foreground font-semibold">Total</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-0.5 bg-blue-400 rounded-full" />
                            <span className="text-[9px] text-muted-foreground font-semibold">Entradas</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-0.5 bg-orange-400 rounded-full" />
                            <span className="text-[9px] text-muted-foreground font-semibold">Salidas</span>
                        </div>
                    </div>
                    {/* Stats */}
                    <div className="flex items-center gap-3 pl-3 border-l border-border/40">
                        <div className="text-right">
                            <p className="text-[8px] text-muted-foreground uppercase font-bold">Hoy</p>
                            <p className="text-sm font-bold text-foreground leading-none">{totalToday}</p>
                        </div>
                        {peakHour && (
                            <div className="text-right">
                                <p className="text-[8px] text-muted-foreground uppercase font-bold">Pico</p>
                                <p className="text-sm font-bold text-emerald-400 leading-none">
                                    {peakHour.hour.toString().padStart(2, "0")}:00
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="px-4 py-3">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[120px]" preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgb(52, 211, 153)" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="rgb(52, 211, 153)" stopOpacity="0.02" />
                        </linearGradient>
                        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="rgb(52, 211, 153)" />
                            <stop offset="50%" stopColor="rgb(16, 185, 129)" />
                            <stop offset="100%" stopColor="rgb(5, 150, 105)" />
                        </linearGradient>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="2" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Grid lines */}
                    {gridLines.map((g, i) => (
                        <g key={i}>
                            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
                            {i > 0 && (
                                <text x={padL - 4} y={g.y + 3} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="var(--font-sans)">
                                    {g.label}
                                </text>
                            )}
                        </g>
                    ))}

                    {/* Hour labels */}
                    {data.filter((_, i) => i % 2 === 0 || i === data.length - 1).map((d, i) => {
                        const x = padL + (data.indexOf(d) / Math.max(data.length - 1, 1)) * chartW;
                        return (
                            <text key={d.hour} x={x} y={H - 4} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="var(--font-sans)">
                                {d.hour.toString().padStart(2, "0")}
                            </text>
                        );
                    })}

                    {/* Area fill */}
                    <path d={areaPath} fill="url(#areaGrad)" />

                    {/* Entry line */}
                    <path d={entryPath} fill="none" stroke="rgba(96,165,250,0.4)" strokeWidth="1" />

                    {/* Exit line */}
                    <path d={exitPath} fill="none" stroke="rgba(251,146,60,0.4)" strokeWidth="1" />

                    {/* Main line */}
                    <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth="1.5" filter="url(#glow)" />

                    {/* Data points */}
                    {points.map((p, i) => (
                        <g key={i}>
                            {p.d.hour === currentHour && (
                                <>
                                    <circle cx={p.x} cy={p.y} r="6" fill="rgba(52,211,153,0.15)" />
                                    <circle cx={p.x} cy={p.y} r="3" fill="rgba(52,211,153,0.3)" />
                                </>
                            )}
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={p.d.hour === currentHour ? 2.5 : 1.5}
                                fill={p.d.hour === currentHour ? "rgb(52,211,153)" : "rgba(52,211,153,0.6)"}
                            />
                            {/* Tooltip area (invisible hover target) */}
                            {p.d.total > 0 && (
                                <g>
                                    <rect x={p.x - 15} y={padT} width="30" height={chartH} fill="transparent" className="peer" />
                                    {/* Hover line */}
                                    <line x1={p.x} y1={padT} x2={p.x} y2={padT + chartH} stroke="rgba(255,255,255,0.05)" strokeWidth="20" className="opacity-0 peer-hover:opacity-100 transition-opacity" />
                                    <line x1={p.x} y1={padT} x2={p.x} y2={padT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="2,2" className="opacity-0 peer-hover:opacity-100 transition-opacity" />
                                </g>
                            )}
                        </g>
                    ))}

                    {/* Current hour indicator line */}
                    {points[currentHour] && (
                        <line
                            x1={points[currentHour].x}
                            y1={padT}
                            x2={points[currentHour].x}
                            y2={padT + chartH}
                            stroke="rgba(52,211,153,0.2)"
                            strokeWidth="0.5"
                            strokeDasharray="3,3"
                        />
                    )}
                </svg>

                {/* Hour bar chart underneath — small bars for quick visual */}
                <div className="flex gap-[2px] mt-1">
                    {data.map((d) => {
                        const pct = maxVal > 0 ? (d.total / maxVal) * 100 : 0;
                        const isCurrent = d.hour === currentHour;
                        return (
                            <div
                                key={d.hour}
                                className="flex-1 group relative"
                                title={`${d.hour.toString().padStart(2, "0")}:00 — ${d.total} eventos (${d.entries}↓ ${d.exits}↑)`}
                            >
                                <div
                                    className={cn(
                                        "w-full rounded-sm transition-all duration-300",
                                        isCurrent ? "bg-emerald-500/60" : d.denies > 0 ? "bg-gradient-to-t from-red-500/30 to-emerald-500/30" : "bg-emerald-500/20",
                                        "group-hover:bg-emerald-400/40"
                                    )}
                                    style={{ height: `${Math.max(pct * 0.16, 1)}px` }}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
