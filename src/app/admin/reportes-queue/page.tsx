"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
    FileBarChart, RefreshCw, Download, Calendar, TrendingUp,
    ChevronLeft, ChevronRight, FileText, Table2, Clock,
    BarChart3, CalendarDays, CalendarRange, CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAppBranding, getReportBranding } from "@/app/actions/settings";
import {
    getQueueHourlyBreakdown,
    getQueueDailyBreakdown,
    getQueueWeeklyBreakdown,
    getQueueMonthlyBreakdown,
    getQueueIntervalBreakdown,
    getQueueDevices,
    getCameraOutages,
} from "@/app/actions/queue";
import { toast } from "sonner";

/* ── Types ─────────────────────────────────── */
interface HourlyData { hour: number; avg: number; max: number; count: number; }
interface DailyData { date: string; avg: number; max: number; last: number; count: number; total: number; }
interface WeeklyData { week: string; avg: number; max: number; last: number; count: number; total: number; }
interface MonthlyData { month: string; avg: number; max: number; last: number; count: number; total: number; }
type TabKey = "hora" | "dia" | "semana" | "mes";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "hora", label: "Por Hora", icon: <Clock size={14} /> },
    { key: "dia", label: "Por Día", icon: <CalendarDays size={14} /> },
    { key: "semana", label: "Por Semana", icon: <CalendarRange size={14} /> },
    { key: "mes", label: "Por Mes", icon: <CalendarCheck size={14} /> },
];

const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DAYS_ES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

function fmtDate(d: string) {
    const dt = new Date(d + "T12:00:00");
    return `${DAYS_ES[dt.getDay()]} ${dt.getDate()} ${MONTHS_ES[dt.getMonth()]}`;
}

/* ── Bar Chart Component ───────────────────── */
function BarChart({ data, labelKey, valueKeys, colors, labels: seriesLabels, height = 220 }: {
    data: any[]; labelKey: string; valueKeys: string[]; colors: string[]; labels: string[]; height?: number;
}) {
    const [hovered, setHovered] = useState<number | null>(null);
    const [animated, setAnimated] = useState(false);
    useEffect(() => { const t = setTimeout(() => setAnimated(true), 60); return () => clearTimeout(t); }, [data, valueKeys.length]);

    const n = Math.max(data.length, 1);
    const maxVal = Math.max(...data.flatMap(d => valueKeys.map(k => d[k] || 0)), 1);
    const W = 1400, H = 300, PAD_L = 46, PAD_R = 26, PAD_T = 22, PAD_B = 40;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    const SERIES = [
        { c: "#a855f7", glow: true },   // Máximo (violeta)
        { c: "#22d3ee", glow: false },  // Promedio (cyan)
        { c: "#f59e0b", glow: false },
    ];
    const xOf = (i: number) => PAD_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yOf = (v: number) => PAD_T + (1 - v / maxVal) * plotH;

    const smooth = (vals: number[]) => {
        const pts = vals.map((v, i) => [xOf(i), yOf(v)] as [number, number]);
        if (pts.length === 0) return "";
        if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
        let d = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
            const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
            const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
            d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
        }
        return d;
    };
    const baseY = yOf(0);
    const labelEvery = Math.ceil(n / 12);
    const tip = hovered != null ? data[hovered] : null;

    return (
        <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} preserveAspectRatio="xMidYMid meet"
                onMouseLeave={() => setHovered(null)}>
                <defs>
                    {SERIES.map((sx, i) => (
                        <linearGradient key={i} id={`lgFill${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={sx.c} stopOpacity="0.35" />
                            <stop offset="100%" stopColor={sx.c} stopOpacity="0" />
                        </linearGradient>
                    ))}
                    <filter id="lgGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                </defs>

                {/* gridlines + y labels */}
                {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
                    const y = PAD_T + g * plotH;
                    return (
                        <g key={i}>
                            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray={g === 1 ? "0" : "4 6"} opacity={g === 1 ? 0.9 : 0.4} />
                            <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fontSize="11" fontFamily="var(--font-sans)" style={{ fill: "var(--muted-foreground)" }}>{Math.round(maxVal * (1 - g))}</text>
                        </g>
                    );
                })}

                {/* hover vertical guide */}
                {hovered != null && (
                    <line x1={xOf(hovered)} y1={PAD_T} x2={xOf(hovered)} y2={baseY} stroke="var(--foreground)" strokeWidth="1" strokeDasharray="3 3" opacity="0.25" />
                )}

                {/* series: area + animated line */}
                {valueKeys.map((vk, vi) => {
                    const line = smooth(data.map(d => d[vk] || 0));
                    const area = line ? `${line} L ${xOf(n - 1)} ${baseY} L ${xOf(0)} ${baseY} Z` : "";
                    const col = SERIES[vi]?.c || "#a855f7";
                    return (
                        <g key={vk}>
                            {area && <path d={area} fill={`url(#lgFill${vi})`} style={{ opacity: animated ? 1 : 0, transition: "opacity .9s ease" }} />}
                            {line && <path d={line} fill="none" stroke={col} strokeWidth={vi === 0 ? 2.75 : 2} strokeLinecap="round"
                                pathLength={1} filter={SERIES[vi]?.glow ? "url(#lgGlow)" : undefined}
                                style={{ strokeDasharray: 1, strokeDashoffset: animated ? 0 : 1, transition: "stroke-dashoffset 1.15s cubic-bezier(.4,0,.2,1)" }} />}
                        </g>
                    );
                })}

                {/* points + hover hit areas */}
                {data.map((item, i) => (
                    <g key={i} onMouseEnter={() => setHovered(i)}>
                        <rect x={xOf(i) - (plotW / n) / 2} y={PAD_T} width={plotW / n} height={plotH} fill="transparent" />
                        {valueKeys.map((vk, vi) => {
                            const col = SERIES[vi]?.c || "#a855f7";
                            return (item[vk] || 0) > 0 || hovered === i ? (
                                <circle key={vk} cx={xOf(i)} cy={yOf(item[vk] || 0)} r={hovered === i ? 4 : 2.4} fill={col} stroke="var(--background)" strokeWidth="1.5"
                                    style={{ opacity: animated ? 1 : 0, transition: "opacity .6s ease" }} />
                            ) : null;
                        })}
                        {valueKeys[0] && (item[valueKeys[0]] || 0) >= Math.max(maxVal * 0.12, 2) && (
                            <text x={xOf(i)} y={yOf(item[valueKeys[0]] || 0) - 9} textAnchor="middle" fontSize="12" fontWeight={700}
                                style={{ fill: SERIES[0]?.c || "#a855f7" }}>
                                {item[valueKeys[0]]}
                            </text>
                        )}
                        {(i % labelEvery === 0 || n <= 12) && (
                            <text x={xOf(i)} y={H - PAD_B + 18} textAnchor="middle" fontSize="11" fontFamily="var(--font-sans)"
                                style={{ fill: hovered === i ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: hovered === i ? 700 : 400 }}>
                                {String(item[labelKey]).slice(0, 7)}
                            </text>
                        )}
                    </g>
                ))}
            </svg>

            {tip && (
                <div className="absolute -translate-x-1/2 pointer-events-none z-30"
                    style={{ left: `${(xOf(hovered!) / W) * 100}%`, top: 2 }}>
                    <div className="bg-popover/95 backdrop-blur border border-border rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                        <div className="text-[11px] font-bold text-foreground mb-1">{tip[labelKey]}</div>
                        {valueKeys.map((vk, vi) => (
                            <div key={vk} className="flex items-center gap-2 text-[10px]">
                                <span className="w-2 h-2 rounded-full" style={{ background: SERIES[vi]?.c }} />
                                <span className="text-muted-foreground">{seriesLabels[vi]}:</span>
                                <span className="text-foreground font-bold tabular-nums">{tip[vk]}</span>
                            </div>
                        ))}
                        {tip.count !== undefined && (
                            <div className="text-[9px] text-muted-foreground mt-1 pt-1 border-t border-border">{tip.count} eventos</div>
                        )}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-5 justify-center mt-1">
                {valueKeys.map((_, vi) => (
                    <div key={vi} className="flex items-center gap-1.5">
                        <span className="w-3.5 h-[3px] rounded-full" style={{ background: SERIES[vi]?.c }} />
                        <span className="text-[10px] text-muted-foreground font-medium">{seriesLabels[vi]}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ── Data Table Component ──────────────────── */
function DataTable({ columns, data }: { columns: { key: string; label: string; align?: string }[]; data: any[] }) {
    return (
        <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-border bg-foreground/[0.04]">
                        {columns.map(col => (
                            <th key={col.key} className={cn("px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider",
                                col.align === "right" ? "text-right" : "text-left")}>{col.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {data.map((row, i) => (
                        <tr key={i} className="hover:bg-foreground/[0.04] transition-colors">
                            {columns.map(col => (
                                <td key={col.key} className={cn("px-4 py-2 text-foreground/70 font-mono tabular-nums",
                                    col.align === "right" ? "text-right" : "text-left")}>{row[col.key]}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* ── Export Helpers ─────────────────────────── */
async function exportXLSX(title: string, columns: { key: string; label: string }[], data: any[], filename: string) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "OmniAccess";
    const ws = wb.addWorksheet(title);

    // Header row
    const headerRow = ws.addRow(columns.map(c => c.label));
    headerRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        cell.alignment = { horizontal: "center" };
        cell.border = { bottom: { style: "thin", color: { argb: "FF7C3AED" } } };
    });

    // Data rows
    for (const row of data) {
        const r = ws.addRow(columns.map(c => row[c.key] ?? ""));
        r.eachCell(cell => { cell.font = { size: 10 }; cell.alignment = { horizontal: "center" }; });
    }

    // Auto-width
    ws.columns.forEach((col, i) => {
        const maxLen = Math.max(columns[i].label.length, ...data.map(r => String(r[columns[i].key] ?? "").length));
        col.width = Math.min(Math.max(maxLen + 4, 10), 30);
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast.success("Excel exportado");
}

function hexToRgb(hex?: string): [number, number, number] | null {
    if (!hex) return null;
    const m = String(hex).replace("#", "").match(/^([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const num = parseInt(m[1], 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
async function loadDataUrl(url: string): Promise<{ data: string; w: number; h: number; fmt: string } | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        if (blob.type.includes("svg")) return null;
        const data: string = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
        const dim = await new Promise<{ w: number; h: number }>((resolve) => { const img = new window.Image(); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => resolve({ w: 1, h: 1 }); img.src = data; });
        const fmt = data.includes("image/png") ? "PNG" : data.includes("webp") ? "WEBP" : "JPEG";
        return { data, w: dim.w, h: dim.h, fmt };
    } catch { return null; }
}

async function exportPDF(title: string, subtitle: string, columns: { key: string; label: string }[], data: any[], filename: string) {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    let rb: any = {};
    try { rb = await getReportBranding(); } catch {}
    const brandName = rb?.company || "OmniAccess";
    const footerTxt = rb?.footer || brandName;
    const logo = rb?.logoUrl ? await loadDataUrl(rb.logoUrl) : null;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.width;
    const H = doc.internal.pageSize.height;
    const M = 14;
    const primary: [number, number, number] = hexToRgb(rb?.primary) || [124, 58, 237];
    const accent: [number, number, number] = hexToRgb(rb?.accent) || primary;
    const tableHead: [number, number, number] = hexToRgb(rb?.tableHeader) || primary;
    const stripe: [number, number, number] = hexToRgb(rb?.tableStripe) || [247, 244, 255];
    const violet = primary;

    // ── Professional data palette (fallback when brand color is near-black) ──
    const lum = (c: [number, number, number]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const chartDark = lum(accent) < 70 && lum(primary) < 70;
    const cAvg: [number, number, number] = chartDark ? [37, 99, 235] : primary;
    const cMax: [number, number, number] = chartDark
        ? [191, 219, 254]
        : [Math.round(accent[0] + (255 - accent[0]) * 0.6), Math.round(accent[1] + (255 - accent[1]) * 0.6), Math.round(accent[2] + (255 - accent[2]) * 0.6)];

    // ── Metric detection (avg / max / count) ──
    const keyByLabel = (...names: string[]): string | null => {
        for (const c of columns) { const l = c.label.toLowerCase(); if (names.some(n => l.includes(n))) return c.key; }
        return null;
    };
    const labelKey = columns[0]?.key;
    const avgKey = keyByLabel("promedio", "average");
    const maxKey = keyByLabel("máximo", "maximo", "pico");
    const totalKey = keyByLabel("total");
    const num = (r: any, k: string | null) => k ? (Number(String(r[k] ?? "").replace(/[^\d.-]/g, "")) || 0) : 0;
    const maxVals = maxKey ? data.map(r => num(r, maxKey)) : [];
    const avgVals = avgKey ? data.map(r => num(r, avgKey)) : [];
    const peakMax = maxVals.length ? Math.max(...maxVals) : 0;
    const peakIdx = maxVals.length ? maxVals.indexOf(peakMax) : -1;
    const peakLabel = peakIdx >= 0 ? String(data[peakIdx]?.[labelKey] ?? "") : "—";
    const avgActive = avgVals.filter(v => v > 0);
    const avgOfAvg = avgActive.length ? Math.round((avgActive.reduce((a, b) => a + b, 0) / avgActive.length) * 10) / 10 : 0;
    const sumTotal = totalKey ? data.reduce((a, r) => a + num(r, totalKey), 0) : 0;

    const subParts = String(subtitle).split(" - ");
    const periodPart = subParts[0] || String(subtitle);
    const devicePart = subParts[1] || "Todos los puntos";

    // ══ COVER PAGE (estilo propuesta corporativa) ══
    const coverImg = rb?.coverUrl ? await loadDataUrl(rb.coverUrl) : null;
    {
        const navy: [number, number, number] = [23, 42, 92];
        const blue: [number, number, number] = chartDark ? [37, 99, 235] : cAvg;
        const lite: [number, number, number] = [96, 165, 250];

        if (coverImg) {
            try { doc.addImage(coverImg.data, coverImg.fmt, 0, 0, W, H); } catch { }
        } else {
            // capas de onda en la esquina superior derecha
            doc.setFillColor(navy[0], navy[1], navy[2]);
            doc.lines([[-92, 0], [30, 26, 62, 58, 92, 96], [0, -96]], W, 0, [1, 1], "F", true);
            doc.setFillColor(blue[0], blue[1], blue[2]);
            doc.lines([[-66, 0], [22, 24, 46, 52, 66, 82], [0, -82]], W, 0, [1, 1], "F", true);
            doc.setFillColor(lite[0], lite[1], lite[2]);
            doc.lines([[-42, 0], [15, 18, 30, 40, 42, 62], [0, -62]], W, 0, [1, 1], "F", true);
            // marco fino
            doc.setDrawColor(225, 228, 235); doc.setLineWidth(0.4);
            doc.rect(8, 8, W - 16, H - 16);
        }

        const LX = M + 4;

        // logo + empresa (arriba izquierda)
        if (logo) {
            const maxS = 16; let lw = maxS, lh = maxS;
            if (logo.w && logo.h) { const ar = logo.w / logo.h; if (ar >= 1) { lw = maxS; lh = maxS / ar; } else { lh = maxS; lw = maxS * ar; } }
            try { doc.addImage(logo.data, logo.fmt, LX, 24, lw, lh); } catch { }
        }
        doc.setTextColor(70, 78, 95); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
        doc.text(String(brandName).toUpperCase(), LX, logo ? 72 : 32);

        // título grande en dos líneas
        doc.setTextColor(55, 60, 70); doc.setFont("helvetica", "normal"); doc.setFontSize(34);
        doc.text("INFORME DE", LX, 116);
        doc.setTextColor(25, 30, 40); doc.setFont("helvetica", "bold"); doc.setFontSize(34);
        doc.text("AFORO", LX, 132);
        doc.setTextColor(blue[0], blue[1], blue[2]); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
        doc.text(title, LX, 144);

        // realizado / autorizado por
        let yy = 166;
        const block = (label: string, value: string) => {
            doc.setTextColor(120, 126, 138); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
            doc.text(label.toUpperCase(), LX, yy);
            doc.setTextColor(40, 45, 55); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
            doc.text(value, LX, yy + 5.5);
            yy += 15;
        };
        block("Realizado por", rb?.preparedBy || brandName);
        if (rb?.authorizedBy) block("Autorizado por", rb.authorizedBy);

        // descripción
        doc.setTextColor(120, 126, 138); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
        const desc = `Datos recabados durante ${periodPart}${devicePart && devicePart !== "Todos los puntos" ? ` · ${devicePart}` : ""}. Pico máximo ${peakMax}, aforo promedio ${avgOfAvg.toFixed(1)} en ${data.length} períodos.`;
        const dl = doc.splitTextToSize(desc, 96);
        doc.text(dl, LX, yy + 1);
        yy += 4 + dl.length * 4;

        // rango de fechas en negrita
        doc.setTextColor(25, 30, 40); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
        doc.text(String(periodPart).toUpperCase(), LX, yy + 8);

        // emblema inferior
        doc.setFillColor(navy[0], navy[1], navy[2]);
        doc.circle(W / 2, H - 20, 5, "F");
        doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
        doc.text((brandName || "O").charAt(0), W / 2, H - 18, { align: "center" });

        doc.addPage();
    }

    // ── Header band (content pages) ──
    doc.setFillColor(violet[0], violet[1], violet[2]);
    doc.rect(0, 0, W, 34, "F");
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, 8, 20, 20, 3, 3, "F");
    if (logo) {
        const maxS = 17; let lw = maxS, lh = maxS;
        if (logo.w && logo.h) { const ar = logo.w / logo.h; if (ar >= 1) { lw = maxS; lh = maxS / ar; } else { lh = maxS; lw = maxS * ar; } }
        try { doc.addImage(logo.data, logo.fmt, M + (20 - lw) / 2, 8 + (20 - lh) / 2, lw, lh); } catch { }
    } else {
        doc.setDrawColor(violet[0], violet[1], violet[2]); doc.setLineWidth(1.6);
        doc.circle(M + 8, 17, 4.2, "S");
        doc.setFillColor(violet[0], violet[1], violet[2]); doc.circle(M + 8, 17, 1.3, "F");
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(brandName, M + 25, 16);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.setTextColor(215, 215, 222);
    doc.text(rb?.tagline || "Reporte de aforo · Control de Filas", M + 25, 22);
    doc.setFontSize(7.5);
    doc.text(new Date().toLocaleString("es-UY"), W - M, 14, { align: "right" });
    if (rb?.contact) { doc.setFontSize(7); doc.setTextColor(215, 215, 222); doc.text(String(rb.contact), W - M, 19, { align: "right" }); }

    // ── Title block ──
    doc.setTextColor(28, 28, 30);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(title, M, 48);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.setTextColor(120, 120, 120);
    doc.text(subtitle, M, 55);

    // ── KPI cards (managerial) ──
    let cursorY = 62;
    const kpis: { label: string; value: string; col: [number, number, number] }[] = [
        { label: "Pico máximo", value: String(peakMax), col: [239, 68, 68] },
        { label: "Aforo promedio", value: avgOfAvg.toFixed(1), col: [16, 185, 129] },
        { label: "Período pico", value: peakLabel || "—", col: [245, 158, 11] },
        totalKey
            ? { label: "Aforo acumulado", value: String(sumTotal), col: [99, 102, 241] }
            : { label: "Períodos", value: String(data.length), col: [99, 102, 241] },
    ];
    {
        const gap = 4;
        const cardW = (W - M * 2 - gap * 3) / 4;
        kpis.forEach((k, idx) => {
            const x = M + idx * (cardW + gap);
            doc.setFillColor(248, 248, 250);
            doc.roundedRect(x, cursorY, cardW, 20, 2.5, 2.5, "F");
            doc.setFillColor(k.col[0], k.col[1], k.col[2]);
            doc.roundedRect(x, cursorY, 2.6, 20, 1, 1, "F");
            doc.setTextColor(k.col[0], k.col[1], k.col[2]);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(String(k.value).length > 6 ? 10 : 15);
            doc.text(String(k.value), x + 6, cursorY + 11);
            doc.setTextColor(135, 135, 140);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            doc.text(k.label.toUpperCase(), x + 6, cursorY + 16);
        });
        cursorY += 26;
    }

    // ── Chart: Máximo vs Promedio por período ──
    if (maxVals.length || avgVals.length) {
        const labels = data.map(r => String(r[labelKey] ?? ""));
        const N = Math.min(data.length, 24);
        const idxs = Array.from({ length: N }, (_, k) => Math.floor(k * data.length / N));
        const mx = idxs.map(k => maxVals[k] ?? 0);
        const av = idxs.map(k => avgVals[k] ?? 0);
        const lbl = idxs.map(k => labels[k]);
        const maxV = Math.max(...mx, ...av, 1);

        doc.setTextColor(60, 60, 65);
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
        doc.text("AFORO POR PERÍODO", M, cursorY);
        const lgX = W - M - 58;
        doc.setFillColor(cMax[0], cMax[1], cMax[2]); doc.roundedRect(lgX, cursorY - 2.6, 3, 3, 0.5, 0.5, "F");
        doc.setTextColor(110, 110, 115); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
        doc.text("Máximo", lgX + 4.5, cursorY);
        const lg2 = lgX + 28;
        doc.setFillColor(cAvg[0], cAvg[1], cAvg[2]); doc.roundedRect(lg2, cursorY - 2.6, 3, 3, 0.5, 0.5, "F");
        doc.text("Promedio", lg2 + 4.5, cursorY);

        const plotY = cursorY + 4;
        const plotH = 36;
        const cw = W - M * 2;

        doc.setDrawColor(232, 232, 236); doc.setLineWidth(0.15);
        [0, 0.5, 1].forEach(fr => {
            const y = plotY + plotH - fr * plotH;
            doc.line(M, y, M + cw, y);
            doc.setTextColor(175, 175, 180); doc.setFont("helvetica", "normal"); doc.setFontSize(5.5);
            doc.text(String(Math.round(maxV * fr)), M - 1.5, y + 1, { align: "right" });
        });

        const n = mx.length;
        const slot = cw / n;
        const bw = Math.min(slot * 0.6, 7);
        for (let k = 0; k < n; k++) {
            const cx = M + k * slot + slot / 2;
            const hMax = Math.max((mx[k] / maxV) * plotH, 0.4);
            const hAvg = Math.max((av[k] / maxV) * plotH, 0.4);
            doc.setFillColor(cMax[0], cMax[1], cMax[2]);
            doc.roundedRect(cx - bw / 2, plotY + plotH - hMax, bw, hMax, 0.5, 0.5, "F");
            doc.setFillColor(cAvg[0], cAvg[1], cAvg[2]);
            doc.roundedRect(cx - bw / 4, plotY + plotH - hAvg, bw / 2, hAvg, 0.4, 0.4, "F");
            // value label on the peak bar
            if (mx[k] === peakMax && peakMax > 0) {
                doc.setTextColor(cAvg[0], cAvg[1], cAvg[2]); doc.setFont("helvetica", "bold"); doc.setFontSize(6);
                doc.text(String(mx[k]), cx, plotY + plotH - hMax - 1.5, { align: "center" });
            }
        }
        doc.setDrawColor(200, 200, 205); doc.setLineWidth(0.3);
        doc.line(M, plotY + plotH, M + cw, plotY + plotH);

        doc.setTextColor(140, 140, 145); doc.setFont("helvetica", "normal"); doc.setFontSize(5.5);
        const step = Math.max(1, Math.ceil(n / 12));
        for (let k = 0; k < n; k += step) {
            const cx = M + k * slot + slot / 2;
            doc.text(String(lbl[k] ?? "").slice(0, 6), cx, plotY + plotH + 4, { align: "center" });
        }
        cursorY = plotY + plotH + 12;
    }

    // ── Table ──
    autoTable(doc, {
        startY: cursorY,
        head: [columns.map(c => c.label)],
        body: data.map(row => columns.map(c => row[c.key] ?? "")),
        theme: "striped",
        headStyles: { fillColor: tableHead, textColor: [255, 255, 255], fontSize: 9, fontStyle: "bold", halign: "center", cellPadding: 2.6 },
        bodyStyles: { fontSize: 8.5, halign: "center", textColor: [55, 55, 55], cellPadding: 2.4 },
        alternateRowStyles: { fillColor: stripe },
        styles: { lineColor: [235, 235, 240], lineWidth: 0.1 },
        margin: { left: M, right: M },
    });

    // ── Footer band on each page ──
    const pageCount = doc.getNumberOfPages();
    for (let i = 2; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(230, 230, 235);
        doc.setLineWidth(0.3);
        doc.line(M, H - 14, W - M, H - 14);
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text(footerTxt, M, H - 9);
        doc.text(`P\u00e1gina ${i} de ${pageCount}`, W - M, H - 9, { align: "right" });
    }

    doc.save(filename);
    toast.success("PDF exportado");
}

/* ── Main Page ─────────────────────────────── */

function fmtDur(sec: number): string {
    if (sec == null) return "—";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m ${sec % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

function OutagesPanel({ outages, devices }: { outages: any[]; devices: { id: string; name: string }[] }) {
    const dn = (id: string) => devices.find(d => d.id === id)?.name || "Cámara";
    const totalSec = outages.reduce((a, o) => a + (o.durationSec || 0), 0);
    return (
        <div className="rounded-xl border border-border bg-gradient-to-b from-foreground/[0.04] to-transparent p-5">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                    <span className="text-xs font-semibold text-foreground/70">Cortes de conexión de cámara</span>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">
                    {outages.length} corte{outages.length === 1 ? "" : "s"} · sin servicio {fmtDur(totalSec)}
                </span>
            </div>
            {outages.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-xs">Sin cortes en el período seleccionado.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                                <th className="text-left font-medium py-1.5 px-2">Cámara</th>
                                <th className="text-left font-medium py-1.5 px-2">Desde</th>
                                <th className="text-left font-medium py-1.5 px-2">Hasta</th>
                                <th className="text-right font-medium py-1.5 px-2">Duración</th>
                                <th className="text-right font-medium py-1.5 px-2">Aforo previo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {outages.map((o) => (
                                <tr key={o.id} className="border-t border-border text-foreground/70">
                                    <td className="py-1.5 px-2">{dn(o.deviceId)}</td>
                                    <td className="py-1.5 px-2 font-mono text-foreground/70">{new Date(o.startedAt).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                                    <td className="py-1.5 px-2 font-mono text-foreground/70">
                                        {o.endedAt ? new Date(o.endedAt).toLocaleString("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : <span className="text-rose-400">en curso</span>}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">{fmtDur(o.durationSec)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{o.lastValue ?? "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default function ReportesQueuePage() {
    const [activeTab, setActiveTab] = useState<TabKey>("hora");
    const [slideDir, setSlideDir] = useState<"l" | "r">("r");
    const tabOrder: TabKey[] = ["hora", "dia", "semana", "mes"];
    const switchTab = (k: TabKey) => { setSlideDir(tabOrder.indexOf(k) >= tabOrder.indexOf(activeTab) ? "r" : "l"); setActiveTab(k); };
    const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string>("");
    const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [dateFrom, setDateFrom] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0];
    });
    const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
    const [loading, setLoading] = useState(true);

    const [hourly, setHourly] = useState<HourlyData[]>([]);
    const [gran, setGran] = useState<number>(60);
    const [intervalRows, setIntervalRows] = useState<any[]>([]);
    const [daily, setDaily] = useState<DailyData[]>([]);
    const [weekly, setWeekly] = useState<WeeklyData[]>([]);
    const [monthly, setMonthly] = useState<MonthlyData[]>([]);
    const [outages, setOutages] = useState<any[]>([]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const devicesData = await getQueueDevices();
            setDevices(devicesData);

            const devId = selectedDevice || undefined;
            const from = new Date(dateFrom + "T00:00:00");
            const to = new Date(dateTo + "T23:59:59");

            if (activeTab === "hora") {
                const date = new Date(selectedDate + "T12:00:00");
                const data = await getQueueIntervalBreakdown(devId, date, gran);
                setIntervalRows(data as any[]);
            } else if (activeTab === "dia") {
                const data = await getQueueDailyBreakdown(devId, from, to);
                setDaily(data);
            } else if (activeTab === "semana") {
                const data = await getQueueWeeklyBreakdown(devId, from, to);
                setWeekly(data);
            } else {
                const data = await getQueueMonthlyBreakdown(devId, from, to);
                setMonthly(data);
            }
            // Camera outages for the active period
            let oFrom = from, oTo = to;
            if (activeTab === "hora") {
                oFrom = new Date(selectedDate + "T00:00:00");
                oTo = new Date(selectedDate + "T23:59:59");
            }
            const outagesData = await getCameraOutages({ from: oFrom, to: oTo, deviceId: devId, includeOpen: true });
            setOutages(outagesData || []);
            setLoading(false);
        } catch (err) {
            console.error(err);
            toast.error("Error cargando reportes");
            setLoading(false);
        }
    }, [activeTab, selectedDate, dateFrom, dateTo, selectedDevice, gran]);

    useEffect(() => { loadData(); }, [loadData]);

    const changeDate = (delta: number) => {
        const d = new Date(selectedDate + "T12:00:00");
        d.setDate(d.getDate() + delta);
        setSelectedDate(d.toISOString().split("T")[0]);
    };

    const deviceLabel = devices.find(d => d.id === selectedDevice)?.name || "Todos";

    /* ── Export handlers ── */
    const handleExport = async (format: "pdf" | "xlsx") => {
        if (activeTab === "hora") {
            const ivLabel = gran === 60 ? "1 h" : `${gran} min`;
            const cols = [
                { key: "rangeLabel", label: "Intervalo" },
                { key: "last", label: "Aforo exacto" },
                { key: "max", label: "Máximo" },
                { key: "avg", label: "Promedio" },
                { key: "count", label: "Lecturas" },
            ];
            const rows = intervalRows.filter((r: any) => r.count > 0);
            const dateLabel = new Date(selectedDate + "T12:00:00").toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
            if (format === "xlsx") await exportXLSX(`Afluencia (${ivLabel})`, cols, rows, `afluencia-${gran}min-${selectedDate}.xlsx`);
            else await exportPDF(`Afluencia por intervalo (${ivLabel})`, `${dateLabel} - ${deviceLabel}`, cols, rows, `afluencia-${gran}min-${selectedDate}.pdf`);
        } else if (activeTab === "dia") {
            const cols = [
                { key: "dateLabel", label: "Fecha" },
                { key: "avg", label: "Promedio" },
                { key: "max", label: "Máximo" },
                { key: "last", label: "Aforo exacto" },
                { key: "count", label: "Eventos" },
                { key: "total", label: "Total" },
            ];
            const rows = daily.map(d => ({ dateLabel: fmtDate(d.date), avg: d.avg, max: d.max, last: d.last, count: d.count, total: d.total }));
            if (format === "xlsx") await exportXLSX("Afluencia por Día", cols, rows, `afluencia-diaria-${dateFrom}-${dateTo}.xlsx`);
            else await exportPDF("Afluencia por Día", `${dateFrom} a ${dateTo} - ${deviceLabel}`, cols, rows, `afluencia-diaria-${dateFrom}-${dateTo}.pdf`);
        } else if (activeTab === "semana") {
            const cols = [
                { key: "week", label: "Semana" },
                { key: "avg", label: "Promedio" },
                { key: "max", label: "Máximo" },
                { key: "last", label: "Aforo exacto" },
                { key: "count", label: "Eventos" },
                { key: "total", label: "Total" },
            ];
            if (format === "xlsx") await exportXLSX("Afluencia por Semana", cols, weekly, `afluencia-semanal-${dateFrom}-${dateTo}.xlsx`);
            else await exportPDF("Afluencia por Semana", `${dateFrom} a ${dateTo} - ${deviceLabel}`, cols, weekly, `afluencia-semanal-${dateFrom}-${dateTo}.pdf`);
        } else {
            const cols = [
                { key: "monthLabel", label: "Mes" },
                { key: "avg", label: "Promedio" },
                { key: "max", label: "Máximo" },
                { key: "last", label: "Aforo exacto" },
                { key: "count", label: "Eventos" },
                { key: "total", label: "Total" },
            ];
            const rows = monthly.map(m => {
                const [y, mo] = m.month.split("-");
                return { monthLabel: `${MONTHS_ES[parseInt(mo) - 1]} ${y}`, avg: m.avg, max: m.max, last: m.last, count: m.count, total: m.total };
            });
            if (format === "xlsx") await exportXLSX("Afluencia por Mes", cols, rows, `afluencia-mensual.xlsx`);
            else await exportPDF("Afluencia por Mes", `${deviceLabel}`, cols, rows, `afluencia-mensual.pdf`);
        }
    };

    /* ── Render sections per tab ── */
    const renderContent = () => {
        if (loading) return (
            <div className="flex items-center justify-center py-20">
                <FileBarChart className="w-8 h-8 text-violet-500 animate-pulse" />
            </div>
        );

        if (activeTab === "hora") {
            const rows = intervalRows;
            const withData = rows.filter((r: any) => r.count > 0);
            const totalReadings = rows.reduce((s: number, r: any) => s + r.count, 0);
            const avgAforo = withData.length ? Math.round(withData.reduce((s: number, r: any) => s + r.avg, 0) / withData.length * 10) / 10 : 0;
            const peak = rows.reduce((p: any, r: any) => (r.max > (p?.max ?? -1) ? r : p), rows[0] || { max: 0, label: "—" });
            const granOptions = [5, 15, 30, 45, 60];

            return (
                <div className="space-y-5">
                    {/* Granularity + explicación */}
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Intervalo</span>
                            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60 border border-border">
                                {granOptions.map(g => (
                                    <button key={g} onClick={() => setGran(g)} className={cn("px-2.5 py-1 rounded-md text-xs font-semibold transition", gran === g ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground")}>{g === 60 ? "1 h" : `${g} min`}</button>
                                ))}
                            </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                            <b className="text-cyan-400">Aforo exacto</b> = última lectura del intervalo · <b className="text-violet-400">Máximo</b> = aforo más alto · <b className="text-amber-400">Promedio</b> = aforo medio
                        </p>
                    </div>

                    {/* Mini KPIs */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Lecturas del día</div>
                            <div className="text-xl font-bold text-violet-400 tabular-nums">{totalReadings}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Aforo promedio</div>
                            <div className="text-xl font-bold text-sky-400 tabular-nums">{avgAforo}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Pico máximo</div>
                            <div className="text-xl font-bold text-red-400 tabular-nums">{peak?.max || 0} <span className="text-xs font-normal text-muted-foreground">a las {peak?.label || "—"}</span></div>
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="rounded-lg border border-border bg-foreground/[0.04] p-5">
                        <BarChart
                            data={rows}
                            labelKey="label" valueKeys={["max", "last", "avg"]}
                            colors={["bg-violet-500/40", "bg-cyan-500/40", "bg-amber-500/40"]}
                            labels={["Máximo", "Aforo exacto", "Promedio"]}
                        />
                    </div>

                    {/* Table */}
                    <DataTable
                        columns={[
                            { key: "rangeLabel", label: "Intervalo" },
                            { key: "last", label: "Aforo exacto", align: "right" },
                            { key: "max", label: "Máximo", align: "right" },
                            { key: "avg", label: "Promedio", align: "right" },
                            { key: "count", label: "Lecturas", align: "right" },
                        ]}
                        data={withData}
                    />
                </div>
            );
        }

        if (activeTab === "dia") {
            const totalEvents = daily.reduce((s, d) => s + d.count, 0);
            const peak = daily.reduce((p, d) => d.max > p.max ? d : p, daily[0] || { max: 0, date: "" });
            const avgAll = daily.length > 0 ? Math.round(daily.filter(d => d.count > 0).reduce((s, d) => s + d.avg, 0) / Math.max(daily.filter(d => d.count > 0).length, 1) * 10) / 10 : 0;

            return (
                <div className="space-y-5">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Total eventos"}</div>
                            <div className="text-xl font-bold text-violet-400 tabular-nums">{totalEvents}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Promedio diario"}</div>
                            <div className="text-xl font-bold text-sky-400 tabular-nums">{avgAll}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Día pico"}</div>
                            <div className="text-xl font-bold text-red-400 tabular-nums">{peak?.max || 0} <span className="text-xs font-normal text-muted-foreground">{peak?.date ? fmtDate(peak.date) : ""}</span></div>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border bg-foreground/[0.04] p-5">
                        <BarChart
                            data={daily.map(d => ({ ...d, label: fmtDate(d.date) }))}
                            labelKey="label" valueKeys={["max", "last", "avg"]}
                            colors={["bg-violet-500/40", "bg-cyan-500/40", "bg-amber-500/40"]}
                            labels={["Máximo", "Aforo exacto", "Promedio"]} height={220}
                        />
                    </div>

                    <DataTable
                        columns={[
                            { key: "dateLabel", label: "Fecha" },
                            { key: "avg", label: "Promedio", align: "right" },
                            { key: "max", label: "Máximo", align: "right" },
                            { key: "last", label: "Aforo exacto", align: "right" },
                            { key: "count", label: "Eventos", align: "right" },
                            { key: "total", label: "Total", align: "right" },
                        ]}
                        data={daily.filter(d => d.count > 0).map(d => ({
                            dateLabel: fmtDate(d.date), avg: d.avg, max: d.max, last: d.last, count: d.count, total: d.total,
                        }))}
                    />
                </div>
            );
        }

        if (activeTab === "semana") {
            const totalEvents = weekly.reduce((s, w) => s + w.count, 0);
            const peak = weekly.reduce((p, w) => w.max > p.max ? w : p, weekly[0] || { max: 0, week: "" });

            return (
                <div className="space-y-5">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Total eventos"}</div>
                            <div className="text-xl font-bold text-violet-400 tabular-nums">{totalEvents}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Semanas"}</div>
                            <div className="text-xl font-bold text-sky-400 tabular-nums">{weekly.length}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Semana pico"}</div>
                            <div className="text-xl font-bold text-red-400 tabular-nums">{peak?.max || 0} <span className="text-xs font-normal text-muted-foreground">{peak?.week || ""}</span></div>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border bg-foreground/[0.04] p-5">
                        <BarChart
                            data={weekly}
                            labelKey="week" valueKeys={["max", "last", "avg"]}
                            colors={["bg-violet-500/40", "bg-cyan-500/40", "bg-amber-500/40"]}
                            labels={["Máximo", "Aforo exacto", "Promedio"]} height={220}
                        />
                    </div>

                    <DataTable
                        columns={[
                            { key: "week", label: "Semana" },
                            { key: "avg", label: "Promedio", align: "right" },
                            { key: "max", label: "Máximo", align: "right" },
                            { key: "last", label: "Aforo exacto", align: "right" },
                            { key: "count", label: "Eventos", align: "right" },
                            { key: "total", label: "Total", align: "right" },
                        ]}
                        data={weekly}
                    />
                </div>
            );
        }

        // Mes
        const totalEvents = monthly.reduce((s, m) => s + m.count, 0);
        const peak = monthly.reduce((p, m) => m.max > p.max ? m : p, monthly[0] || { max: 0, month: "" });

        return (
            <div className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Total eventos"}</div>
                        <div className="text-xl font-bold text-violet-400 tabular-nums">{totalEvents}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Meses"}</div>
                        <div className="text-xl font-bold text-sky-400 tabular-nums">{monthly.length}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-foreground/[0.04] px-4 py-3">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">{"Mes pico"}</div>
                        <div className="text-xl font-bold text-red-400 tabular-nums">{peak?.max || 0} <span className="text-xs font-normal text-muted-foreground">{peak?.month ? (() => { const [y, m] = peak.month.split("-"); return `${MONTHS_ES[parseInt(m) - 1]} ${y}`; })() : ""}</span></div>
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-foreground/[0.04] p-5">
                    <BarChart
                        data={monthly.map(m => { const [y, mo] = m.month.split("-"); return { ...m, label: `${MONTHS_ES[parseInt(mo) - 1]} ${y}` }; })}
                        labelKey="label" valueKeys={["max", "avg"]}
                        colors={["bg-violet-500/20", "bg-violet-500/60"]}
                        labels={["Máximo", "Promedio"]} height={220}
                    />
                </div>

                <DataTable
                    columns={[
                        { key: "monthLabel", label: "Mes" },
                        { key: "avg", label: "Promedio", align: "right" },
                        { key: "max", label: "Máximo", align: "right" },
                        { key: "count", label: "Eventos", align: "right" },
                        { key: "total", label: "Total", align: "right" },
                    ]}
                    data={monthly.map(m => { const [y, mo] = m.month.split("-"); return { monthLabel: `${MONTHS_ES[parseInt(mo) - 1]} ${y}`, avg: m.avg, max: m.max, last: m.last, count: m.count, total: m.total }; })}
                />
            </div>
        );
    };

    return (
        <div className="space-y-5 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                        <FileBarChart size={18} className="text-violet-400" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-foreground tracking-tight">Reportes de Afluencia</h1>
                        <p className="text-[11px] text-muted-foreground">{"Análisis y exportación de datos de aforo"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")}
                        className="border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10 gap-1.5 h-8 text-[11px]">
                        <Table2 size={12} /> Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleExport("pdf")}
                        className="border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 gap-1.5 h-8 text-[11px]">
                        <FileText size={12} /> PDF
                    </Button>
                    <Button variant="ghost" size="sm" onClick={loadData} className="text-muted-foreground hover:text-foreground h-8">
                        <RefreshCw size={12} />
                    </Button>
                </div>
            </div>

            {/* Toolbar: segmented tabs (left) + filters (right) */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                {/* Segmented control */}
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-muted/60 border border-border">
                    {TABS.map(tab => (
                        <button key={tab.key} onClick={() => switchTab(tab.key)}
                            className={cn(
                                "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                                activeTab === tab.key
                                    ? "bg-violet-600 text-white shadow-sm shadow-violet-900/30"
                                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
                            )}>
                            {tab.icon}
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                    {activeTab === "hora" ? (
                        <div className="flex items-center gap-1 bg-muted/60 border border-border rounded-lg p-1">
                            <button onClick={() => changeDate(-1)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                                <ChevronLeft size={14} />
                            </button>
                            <div className="flex items-center gap-1.5 px-2">
                                <Calendar size={12} className="text-violet-400" />
                                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                                    className="bg-transparent text-foreground text-xs font-mono border-none outline-none" />
                            </div>
                            <button onClick={() => changeDate(1)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 bg-muted/60 border border-border rounded-lg p-1.5 px-3">
                            <Calendar size={12} className="text-violet-400" />
                            <span className="text-[9px] text-muted-foreground font-mono uppercase">Desde</span>
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                className="bg-transparent text-foreground text-xs font-mono border-none outline-none" />
                            <span className="text-[9px] text-muted-foreground font-mono uppercase">Hasta</span>
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                className="bg-transparent text-foreground text-xs font-mono border-none outline-none" />
                        </div>
                    )}
                    <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)}
                        className="rounded-lg bg-muted/60 border border-border text-foreground text-xs px-3 py-2 outline-none">
                        <option value="">{"Todos los dispositivos"}</option>
                        {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                </div>
            </div>

            {/* Content */}
            <div key={activeTab} className={cn("animate-in fade-in duration-300 ease-out", slideDir === "r" ? "slide-in-from-right-6" : "slide-in-from-left-6")}>
                {renderContent()}
            </div>

            {/* Camera outages */}
            <OutagesPanel outages={outages} devices={devices} />

            {/* Footer */}
            <div className="flex items-center justify-center pt-2">
                <div className="flex items-center gap-2 bg-muted/60 backdrop-blur-sm rounded-full px-4 py-1.5 border border-border">
                    <BarChart3 size={8} className="text-violet-400" />
                    <span className="text-[9px] text-muted-foreground font-mono uppercase tracking-widest">{"OmniAccess Reportes · Exporta PDF y Excel"}</span>
                </div>
            </div>
        </div>
    );
}
