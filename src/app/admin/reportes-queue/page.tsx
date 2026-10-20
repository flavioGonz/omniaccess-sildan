"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
    RefreshCw, Calendar, ChevronLeft, ChevronRight, FileText, Table2, Clock,
    BarChart3, CalendarDays, CalendarRange, CalendarCheck, Users, Send, BellRing, Radio, MessageCircle, Mail, Webhook,
    AlertTriangle, ChevronDown, LogIn, LogOut, Timer, TrendingUp, Gauge, Hourglass, Unplug, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getReportBranding } from "@/app/actions/settings";
import {
    getQueueDailyBreakdown,
    getQueueWeeklyBreakdown,
    getQueueMonthlyBreakdown,
    getQueueIntervalBreakdown,
    getQueueDevices,
    getCameraOutages,
    getQueueNotifications,
    getDispatchHistory,
    getResumenFilas,
} from "@/app/actions/queue";
import { getKpisPeriodo, getLineaReciente, type KpisPeriodo } from "@/app/actions/monitor-filas";
import { CajonFila, tonoFila, ROTULO_TONO, type ResumenFila } from "@/components/queue/CajonFila";
import { useTiempoReal } from "@/lib/tiempo-real";
import { toast } from "@/lib/avisos";
import { fecha, fechaHora, hace, hora } from "@/lib/fechas";

/* ── Types ─────────────────────────────────── */
interface DailyData { date: string; avg: number; max: number; last: number; count: number; total: number; }
interface WeeklyData { week: string; avg: number; max: number; last: number; count: number; total: number; }
interface MonthlyData { month: string; avg: number; max: number; last: number; count: number; total: number; }
type TabKey = "hora" | "dia" | "semana" | "mes";

const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DAYS_ES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

function fmtDate(d: string) {
    const dt = new Date(d + "T12:00:00");
    return `${DAYS_ES[dt.getDay()]} ${dt.getDate()} ${MONTHS_ES[dt.getMonth()]}`;
}

/**
 * Los colores de las series de la gráfica. Antes eran tres hex (violeta, cian, ámbar) escritos
 * acá; ahora son los tokens de datos del tema (`--chart-*`), que el tema oscuro redefine. No se
 * usan los tonos de estado: un promedio en verde se leería como «está bien».
 */
const SERIE_COLOR = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

/* ── La gráfica (la animación del trazo es la que le gustaba a Nico: se queda) ── */
function BarChart({ data, labelKey, valueKeys, labels: seriesLabels }: {
    data: any[]; labelKey: string; valueKeys: string[]; labels: string[];
}) {
    const [hovered, setHovered] = useState<number | null>(null);
    const [animated, setAnimated] = useState(false);
    /* Series apagadas desde la leyenda: con las tres juntas, el aforo exacto (que salta de 0 a 3)
       tapa el promedio, y a veces lo que se quiere mirar es sólo el pico. */
    const [ocultas, setOcultas] = useState<Set<string>>(new Set());
    useEffect(() => { setAnimated(false); const t = setTimeout(() => setAnimated(true), 60); return () => clearTimeout(t); }, [data, valueKeys.length]);

    const visibles = valueKeys.filter((k) => !ocultas.has(k));
    const n = Math.max(data.length, 1);
    const maxVal = Math.max(...data.flatMap(d => (visibles.length ? visibles : valueKeys).map(k => d[k] || 0)), 1);
    const W = 1400, H = 300, PAD_L = 46, PAD_R = 26, PAD_T = 22, PAD_B = 40;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
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
    const principal = visibles[0];

    return (
        <div className="relative">
            {/* Leyenda arriba a la derecha y apretable: dice qué es cada trazo y lo prende o apaga. */}
            <div className="flex items-center justify-end gap-1 mb-1 flex-wrap">
                {valueKeys.map((vk, vi) => {
                    const on = !ocultas.has(vk);
                    return (
                        <button key={vk} type="button" aria-pressed={on}
                            onClick={() => setOcultas((s) => { const x = new Set(s); if (x.has(vk)) x.delete(vk); else if (visibles.length > 1) x.add(vk); return x; })}
                            className={cn("inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11px] font-semibold transition-colors",
                                on ? "text-foreground hover:bg-muted" : "text-muted-foreground/60 line-through hover:bg-muted")}>
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: SERIE_COLOR[vi], opacity: on ? 1 : 0.35 }} />
                            {seriesLabels[vi]}
                        </button>
                    );
                })}
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} preserveAspectRatio="xMidYMid meet"
                onMouseLeave={() => setHovered(null)}>
                <defs>
                    {SERIE_COLOR.map((c, i) => (
                        <linearGradient key={i} id={`mvFill${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" style={{ stopColor: c, stopOpacity: 0.3 }} />
                            <stop offset="100%" style={{ stopColor: c, stopOpacity: 0 }} />
                        </linearGradient>
                    ))}
                </defs>

                {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
                    const y = PAD_T + g * plotH;
                    return (
                        <g key={i}>
                            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray={g === 1 ? "0" : "4 6"} opacity={g === 1 ? 0.9 : 0.5} />
                            <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fontSize="11" fontFamily="var(--font-sans)" style={{ fill: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>{Math.round(maxVal * (1 - g))}</text>
                        </g>
                    );
                })}

                {hovered != null && (
                    <line x1={xOf(hovered)} y1={PAD_T} x2={xOf(hovered)} y2={baseY} stroke="var(--foreground)" strokeWidth="1" strokeDasharray="3 3" opacity="0.25" />
                )}

                {valueKeys.map((vk, vi) => {
                    if (ocultas.has(vk)) return null;
                    const line = smooth(data.map(d => d[vk] || 0));
                    const area = line ? `${line} L ${xOf(n - 1)} ${baseY} L ${xOf(0)} ${baseY} Z` : "";
                    return (
                        <g key={vk}>
                            {area && vk === principal && <path d={area} fill={`url(#mvFill${vi})`} style={{ opacity: animated ? 1 : 0, transition: "opacity .9s ease" }} />}
                            {line && <path d={line} fill="none" stroke={SERIE_COLOR[vi]} strokeWidth={vk === principal ? 2.75 : 1.75} strokeLinecap="round"
                                pathLength={1}
                                style={{ strokeDasharray: 1, strokeDashoffset: animated ? 0 : 1, transition: "stroke-dashoffset 1.15s cubic-bezier(.4,0,.2,1)" }} />}
                        </g>
                    );
                })}

                {data.map((item, i) => (
                    <g key={i} onMouseEnter={() => setHovered(i)}>
                        <rect x={xOf(i) - (plotW / n) / 2} y={PAD_T} width={plotW / n} height={plotH} fill="transparent" />
                        {valueKeys.map((vk, vi) => (!ocultas.has(vk) && ((item[vk] || 0) > 0 || hovered === i)) ? (
                            <circle key={vk} cx={xOf(i)} cy={yOf(item[vk] || 0)} r={hovered === i ? 4 : 2.2} fill={SERIE_COLOR[vi]} stroke="var(--card)" strokeWidth="1.5"
                                style={{ opacity: animated ? 1 : 0, transition: "opacity .6s ease" }} />
                        ) : null)}
                        {principal && (item[principal] || 0) >= Math.max(maxVal * 0.12, 2) && (
                            <text x={xOf(i)} y={yOf(item[principal] || 0) - 9} textAnchor="middle" fontSize="12" fontWeight={700}
                                style={{ fill: "var(--foreground)", fontVariantNumeric: "tabular-nums" }}>
                                {item[principal]}
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
                    style={{ left: `${Math.min(92, Math.max(8, (xOf(hovered!) / W) * 100))}%`, top: 30 }}>
                    <div className="bg-popover border border-border rounded-[10px] px-3 py-2 sombra-flotante whitespace-nowrap">
                        <div className="text-[12px] font-semibold text-foreground mb-1">{tip.rangeLabel || tip[labelKey]}</div>
                        {valueKeys.map((vk, vi) => ocultas.has(vk) ? null : (
                            <div key={vk} className="flex items-center gap-2 text-[11px]">
                                <span className="w-2 h-2 rounded-full" style={{ background: SERIE_COLOR[vi] }} />
                                <span className="text-muted-foreground">{seriesLabels[vi]}</span>
                                <span className="ml-auto pl-3 text-foreground font-semibold tabular-nums">{tip[vk]}</span>
                            </div>
                        ))}
                        {tip.count !== undefined && (
                            <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border tabular-nums">{tip.count} lecturas</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── La tabla del período (en la pestaña «Tabla» de la tarjeta, no debajo de la gráfica) ── */
function DataTable({ columns, data }: { columns: { key: string; label: string; align?: string }[]; data: any[] }) {
    if (!data.length) return <div className="py-12 text-center text-[13px] text-muted-foreground">Sin lecturas en el período.</div>;
    return (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-[6px] border border-border">
            <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border">
                        {columns.map(col => (
                            <th key={col.key} className={cn("px-3 py-2 text-[12px] font-semibold text-muted-foreground",
                                col.align === "right" ? "text-right" : "text-left")}>{col.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {data.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/50 transition-colors">
                            {columns.map(col => (
                                <td key={col.key} className={cn("px-3 py-1.5 tabular-nums",
                                    col.align === "right" ? "text-right" : "text-left text-foreground/85")}>{row[col.key]}</td>
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
    doc.text(fecha(new Date()), W - M, 14, { align: "right" });
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

/* ── Monitor en vivo (modo Filas) ─────────────────────────────────────────────
 *
 * HB, 19/10. Primero Reportes pasó a ser el Monitor en vivo; a la noche Nico lo vio armado y
 * dijo «es espantoso»: una tarjetita sola arriba a la izquierda con un mar vacío al lado, la
 * gráfica con una tabla larguísima debajo, y la columna de la derecha con listas sueltas. Se
 * rearmó en bloques, de lo más urgente a lo más analítico:
 *
 *   1. AHORA — una tarjeta grande por fila: el aforo contra el límite (aro), el estado, la espera,
 *      lo de hoy y la línea de la última hora. Con una sola fila ocupa todo el ancho y suma la
 *      foto de la cámara; con varias se reparten. Tocarla abre la ficha de la fila.
 *   2. EL PERÍODO — seis números que dicen cómo fue: atendidos, entradas, pico, promedio, veces
 *      que se llenó y tiempo lleno. Todos del mismo alto y alineados.
 *   3. LA GRÁFICA — con su animación; la tabla pasa a una pestaña de la misma tarjeta.
 *   4. AL COSTADO — las veces que una fila se llenó y los últimos despachos, como líneas de
 *      tiempo, alineadas arriba con la gráfica.
 *   5. CORTES — plegados en un renglón: casi nunca hay, y cuando hay se abren.
 */

/** Cada cuánto se refresca el aforo de ahora. Es JSON chico: no pesa en el LTE. */
const REFRESCO_VIVO_MS = 5_000;
/** Cada cuánto se refrescan la línea de la última hora, filas llenas y despachos. */
const REFRESCO_LISTAS_MS = 30_000;
/** Cuántos renglones muestran las listas del costado. */
const RENGLONES_LISTA = 6;
const ES_AFORO = /aforo|occupancy|ocupaci/i;
const INTERVALOS = [5, 15, 30, 45, 60];

type Tono = ReturnType<typeof tonoFila>;
const ROTULO = "text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground";

const ICONO_CANAL: Record<string, any> = { telegram: Send, whatsapp: MessageCircle, email: Mail, webhook: Webhook };
const ESTADO_DESPACHO: Record<string, { rotulo: string; tono: string }> = {
    SENT: { rotulo: "Enviado", tono: "chip-bien" },
    PENDING: { rotulo: "En cola", tono: "chip-info" },
    PROCESSING: { rotulo: "Enviando", tono: "chip-info" },
    FAILED: { rotulo: "Falló", tono: "chip-mal" },
    CANCELLED: { rotulo: "Cancelado", tono: "chip-neutro" },
};

function durMin(min: number): string {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${min % 60 ? `${min % 60} min` : ""}`.trim();
}

/** Un día o un rango, según el período. Pastilla porque es una elección. */
function Pastillas<T extends string | number>({ valor, opciones, onCambiar, chica }: { valor: T; opciones: { v: T; r: React.ReactNode }[]; onCambiar: (v: T) => void; chica?: boolean }) {
    return (
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-muted">
            {opciones.map((o) => (
                <button key={String(o.v)} type="button" onClick={() => onCambiar(o.v)} aria-pressed={valor === o.v}
                    className={cn("inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors whitespace-nowrap",
                        chica ? "h-6 px-2.5 text-[11px]" : "h-7 px-3 text-[12px]",
                        valor === o.v ? "bg-background text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                    {o.r}
                </button>
            ))}
        </div>
    );
}

function Tarjeta({ titulo, icono: I, accion, children, className, cuerpo }: { titulo: string; icono: any; accion?: React.ReactNode; children: React.ReactNode; className?: string; cuerpo?: string }) {
    return (
        <section className={cn("rounded-[14px] border border-border bg-card overflow-hidden flex flex-col", className)}>
            <header className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0">
                <I size={15} className="text-muted-foreground" />
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] truncate">{titulo}</h2>
                {accion && <div className="ml-auto flex items-center gap-2">{accion}</div>}
            </header>
            <div className={cn("flex-1 min-h-0", cuerpo)}>{children}</div>
        </section>
    );
}

/** El aro del aforo: cuánto de la fila está ocupado. Lleno = en el límite. */
function Aro({ aforo, limite, tono, tam = 112 }: { aforo: number | null; limite: number; tono: Tono; tam?: number }) {
    const r = 44, c = 2 * Math.PI * r;
    const frac = aforo == null ? 0 : Math.min(1, aforo / Math.max(1, limite));
    return (
        <div className="relative shrink-0" style={{ width: tam, height: tam }}>
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r={r} fill="none" stroke="var(--muted)" strokeWidth="7" />
                <circle cx="50" cy="50" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
                    style={{ stroke: `var(--${tono})`, strokeDasharray: c, strokeDashoffset: c * (1 - frac), transition: "stroke-dashoffset .8s cubic-bezier(.4,0,.2,1), stroke .4s" }} />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
                <div className="text-center leading-none">
                    <div className={cn("font-bold tabular-nums tracking-[-0.03em]", `tono-${tono}`)} style={{ fontSize: tam * 0.34 }}>{aforo ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums mt-1">de {limite}</div>
                </div>
            </div>
        </div>
    );
}

/** La última hora: aforo por minuto contra la línea del límite. */
function LineaHora({ valores, limite, tono, alto = 64 }: { valores: number[]; limite: number; tono: Tono; alto?: number }) {
    const W = 300, H = 64, P = 3;
    if (!valores.length) return <div className="h-full grid place-items-center text-[11px] text-muted-foreground">Sin lecturas en la última hora</div>;
    const max = Math.max(limite * 1.15, ...valores, 1);
    const x = (i: number) => P + (i / Math.max(1, valores.length - 1)) * (W - P * 2);
    const y = (v: number) => H - P - (v / max) * (H - P * 2);
    // Escalón: la cámara manda cuando cambia el valor, entre medio la fila quedó igual.
    let d = `M ${x(0)} ${y(valores[0])}`;
    for (let i = 1; i < valores.length; i++) d += ` H ${x(i)} V ${y(valores[i])}`;
    const area = `${d} V ${H} H ${x(0)} Z`;
    const id = `lh-${tono}`;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: alto }}>
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: `var(--${tono})`, stopOpacity: 0.28 }} />
                    <stop offset="100%" style={{ stopColor: `var(--${tono})`, stopOpacity: 0 }} />
                </linearGradient>
            </defs>
            <line x1={0} x2={W} y1={y(limite)} y2={y(limite)} stroke="var(--mal)" strokeWidth="1" strokeDasharray="3 4" opacity="0.55" vectorEffect="non-scaling-stroke" />
            <path d={area} fill={`url(#${id})`} />
            <path d={d} fill="none" strokeWidth="1.75" style={{ stroke: `var(--${tono})` }} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
    );
}

/** Un dato chico de la tarjeta de la fila. */
function Mini({ icono: I, rotulo, valor, sub }: { icono: any; rotulo: string; valor: React.ReactNode; sub?: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><I size={12} /> {rotulo}</div>
            <div className="text-[18px] font-bold tabular-nums leading-tight mt-0.5 truncate">{valor}</div>
            {sub && <div className="text-[11px] text-muted-foreground tabular-nums truncate">{sub}</div>}
        </div>
    );
}

/** La tarjeta de una fila AHORA. `ancha`: es la única fila y ocupa todo el renglón. */
function FilaAhora({ f, linea, ancha, onAbrir }: { f: ResumenFila; linea?: number[]; ancha: boolean; onAbrir: () => void }) {
    const t = tonoFila(f.aforo, f.limite);
    const [marca, setMarca] = useState(() => Date.now());
    /* La foto se renueva cada 30 s, no más: el enlace de HB es un LTE y el que quiere el vivo
       tiene el de la ficha. */
    useEffect(() => { if (!ancha) return; const i = setInterval(() => setMarca(Date.now()), REFRESCO_LISTAS_MS); return () => clearInterval(i); }, [ancha]);
    const datos = (
        <div className={cn("grid gap-x-5 gap-y-3", ancha ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2")}>
            <Mini icono={Hourglass} rotulo="Espera" valor={f.esperaMin != null ? `~${f.esperaMin} min` : "—"} sub={f.esperaMin != null ? "estimada" : "sin salidas recientes"} />
            <Mini icono={LogOut} rotulo="Atendidos hoy" valor={f.salidasHoy} sub={`${f.entradasHoy} entradas`} />
            <Mini icono={TrendingUp} rotulo="Pico hoy" valor={f.picoHoy} sub={f.picoHoyA ? `a las ${hora(f.picoHoyA)}` : "—"} />
            <Mini icono={BellRing} rotulo="Se llenó" valor={<span className={cn(f.llenasHoy > 0 && "tono-mal")}>{f.llenasHoy}</span>} sub={f.llenasHoy === 1 ? "vez hoy" : "veces hoy"} />
        </div>
    );
    return (
        <button type="button" onClick={onAbrir}
            className={cn("group text-left rounded-[14px] border border-border bg-card p-4 transition-colors hover:border-foreground/20 w-full",
                ancha ? "grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.1fr)_240px] items-center" : "flex flex-col gap-4")}>
            {/* Identidad + aro */}
            <div className="flex items-center gap-4 min-w-0">
                <Aro aforo={f.aforo} limite={f.limite} tono={t} tam={ancha ? 120 : 96} />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={cn("relative flex h-2 w-2")}>
                            <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", `pleno-${t}`)} />
                            <span className={cn("relative inline-flex h-2 w-2 rounded-full", `pleno-${t}`)} />
                        </span>
                        <span className="text-[16px] font-semibold tracking-[-0.01em] truncate">{f.nombre}</span>
                    </div>
                    <span className={cn("inline-flex mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border", `chip-${t}`)}>{ROTULO_TONO[t]}</span>
                    <div className="text-[11px] text-muted-foreground mt-1.5">{f.ultimoDato ? `Último dato ${hace(f.ultimoDato)}` : "Sin datos todavía"}</div>
                </div>
            </div>
            {/* Lo de hoy */}
            {datos}
            {/* La última hora */}
            <div className="min-w-0">
                <div className="flex items-center justify-between mb-1">
                    <span className={ROTULO}>Última hora</span>
                    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed" style={{ borderColor: "var(--mal)" }} /> límite</span>
                </div>
                <LineaHora valores={linea || []} limite={f.limite} tono={t} alto={ancha ? 72 : 56} />
            </div>
            {/* La foto, sólo si es la única fila: hay lugar y es lo que se quiere ver */}
            {ancha && (
                <div className="hidden lg:block relative aspect-video rounded-[10px] overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/snapshot/${f.id}?t=${marca}`} alt="" className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                        onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "visible"; }} />
                    <span className="absolute left-2 bottom-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-[6px] bg-background/80 text-foreground">Foto · cada 30 s</span>
                </div>
            )}
        </button>
    );
}

/** Un número del período. */
function Kpi({ icono: I, rotulo, valor, sub, tono }: { icono: any; rotulo: string; valor: React.ReactNode; sub?: React.ReactNode; tono?: string }) {
    return (
        <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex flex-col justify-between min-h-[92px]">
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><I size={13} /> {rotulo}</div>
            <div className={cn("text-[26px] font-bold tabular-nums tracking-[-0.02em] leading-none mt-2", tono)}>{valor}</div>
            <div className="text-[11px] text-muted-foreground mt-1.5 truncate tabular-nums min-h-[14px]">{sub}</div>
        </div>
    );
}

function Vacio({ icono: I, titulo, ayuda }: { icono: any; titulo: string; ayuda: string }) {
    return (
        <div className="px-4 py-8 flex flex-col items-center text-center gap-2">
            <span className="h-10 w-10 rounded-full bg-muted grid place-items-center"><I size={17} className="text-muted-foreground" /></span>
            <div className="text-[13px] font-semibold">{titulo}</div>
            <div className="text-[12px] text-muted-foreground max-w-[240px]">{ayuda}</div>
        </div>
    );
}

/** Los cortes de cámara: un renglón plegado; se abre si hay algo que mirar. */
function Cortes({ outages, devices }: { outages: any[]; devices: { id: string; name: string }[] }) {
    const [abierto, setAbierto] = useState(false);
    const dn = (id: string) => devices.find(d => d.id === id)?.name || "Cámara";
    const totalSec = outages.reduce((a, o) => a + (o.durationSec || 0), 0);
    const hay = outages.length > 0;
    return (
        <section className="rounded-[14px] border border-border bg-card overflow-hidden">
            <button type="button" disabled={!hay} onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
                className="w-full flex items-center gap-3 px-4 h-12 text-left disabled:cursor-default">
                <Unplug size={15} className="text-muted-foreground" />
                <span className="text-[15px] font-semibold tracking-[-0.01em]">Cortes de cámara</span>
                <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full border", hay ? "chip-aviso" : "chip-bien")}>
                    {hay ? `${outages.length} corte${outages.length === 1 ? "" : "s"} · ${fmtDur(totalSec)} sin servicio` : "Sin cortes en el período"}
                </span>
                {hay && <ChevronDown size={15} className={cn("ml-auto text-muted-foreground transition-transform", abierto && "rotate-180")} />}
            </button>
            {abierto && hay && (
                <div className="border-t border-border overflow-x-auto max-h-[320px] overflow-y-auto">
                    <table className="w-full text-[13px]">
                        <thead className="sticky top-0 bg-card">
                            <tr className="text-muted-foreground text-[12px] border-b border-border">
                                <th className="text-left font-semibold py-2 px-4">Cámara</th>
                                <th className="text-left font-semibold py-2 px-3">Desde</th>
                                <th className="text-left font-semibold py-2 px-3">Hasta</th>
                                <th className="text-right font-semibold py-2 px-3">Duración</th>
                                <th className="text-right font-semibold py-2 px-4">Aforo previo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {outages.map((o) => (
                                <tr key={o.id}>
                                    <td className="py-1.5 px-4">{dn(o.deviceId)}</td>
                                    <td className="py-1.5 px-3 tabular-nums">{fechaHora(new Date(o.startedAt))}</td>
                                    <td className="py-1.5 px-3 tabular-nums">{o.endedAt ? fechaHora(new Date(o.endedAt)) : <span className="tono-mal">en curso</span>}</td>
                                    <td className="py-1.5 px-3 text-right tabular-nums">{fmtDur(o.durationSec)}</td>
                                    <td className="py-1.5 px-4 text-right tabular-nums text-muted-foreground">{o.lastValue ?? "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

export default function ReportesQueuePage() {
    const [activeTab, setActiveTab] = useState<TabKey>("hora");
    const [vista, setVista] = useState<"grafica" | "tabla">("grafica");
    const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string>("");
    const [selectedDate, setSelectedDate] = useState(() => paraFecha(new Date()));
    const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return paraFecha(d); });
    const [dateTo, setDateTo] = useState(() => paraFecha(new Date()));
    const [loading, setLoading] = useState(true);
    const [errorCarga, setErrorCarga] = useState<string | null>(null);

    const [gran, setGran] = useState<number>(60);
    const [intervalRows, setIntervalRows] = useState<any[]>([]);
    const [daily, setDaily] = useState<DailyData[]>([]);
    const [weekly, setWeekly] = useState<WeeklyData[]>([]);
    const [monthly, setMonthly] = useState<MonthlyData[]>([]);
    const [outages, setOutages] = useState<any[]>([]);
    const [kpis, setKpis] = useState<KpisPeriodo | null>(null);

    // En vivo
    const [ahora, setAhora] = useState<ResumenFila[] | null>(null);
    const [lineas, setLineas] = useState<Record<string, { max: number[] }>>({});
    const [llenas, setLlenas] = useState<any[] | null>(null);
    const [despachos, setDespachos] = useState<any[] | null>(null);
    const [abierta, setAbierta] = useState<ResumenFila | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true); setErrorCarga(null);
        try {
            const devicesData = await getQueueDevices();
            setDevices(devicesData);
            const devId = selectedDevice || undefined;
            const from = new Date(dateFrom + "T00:00:00");
            const to = new Date(dateTo + "T23:59:59");
            const [desde, hasta] = activeTab === "hora" ? [selectedDate, selectedDate] : [dateFrom, dateTo];
            getKpisPeriodo({ desde, hasta, deviceId: devId }).then(setKpis).catch(() => setKpis(null));
            if (activeTab === "hora") setIntervalRows(await getQueueIntervalBreakdown(devId, new Date(selectedDate + "T12:00:00"), gran) as any[]);
            else if (activeTab === "dia") setDaily(await getQueueDailyBreakdown(devId, from, to) as DailyData[]);
            else if (activeTab === "semana") setWeekly(await getQueueWeeklyBreakdown(devId, from, to));
            else setMonthly(await getQueueMonthlyBreakdown(devId, from, to));
            const [oFrom, oTo] = activeTab === "hora" ? [new Date(selectedDate + "T00:00:00"), new Date(selectedDate + "T23:59:59")] : [from, to];
            setOutages((await getCameraOutages({ from: oFrom, to: oTo, deviceId: devId, includeOpen: true })) || []);
        } catch (err: any) {
            console.error(err);
            setErrorCarga(err?.message || "No se pudieron leer los datos del período");
        } finally { setLoading(false); }
    }, [activeTab, selectedDate, dateFrom, dateTo, selectedDevice, gran]);
    useEffect(() => { loadData(); }, [loadData]);

    const cargarAhora = useCallback(async () => {
        try { setAhora(await getResumenFilas()); } catch { setAhora((a) => a ?? []); }
    }, []);
    const cargarListas = useCallback(async () => {
        const [n, h, l] = await Promise.allSettled([getQueueNotifications({ take: RENGLONES_LISTA }), getDispatchHistory({ take: RENGLONES_LISTA }), getLineaReciente()]);
        setLlenas(n.status === "fulfilled" ? n.value : []);
        setDespachos(h.status === "fulfilled" ? h.value : []);
        if (l.status === "fulfilled") setLineas(l.value);
    }, []);
    useEffect(() => {
        cargarAhora(); cargarListas();
        const a = setInterval(cargarAhora, REFRESCO_VIVO_MS);
        const b = setInterval(cargarListas, REFRESCO_LISTAS_MS);
        return () => { clearInterval(a); clearInterval(b); };
    }, [cargarAhora, cargarListas]);

    /* El aforo llega por el socket apenas la cámara lo cambia: no se espera al próximo refresco.
       Se mueve también el último punto de la línea de la hora, para que el aro y la línea no
       digan dos cosas distintas. */
    const { conectado } = useTiempoReal<any>("queue_update", (d) => {
        if (!d?.deviceId || !ES_AFORO.test(d.channelName || "")) return;
        setAhora((filas) => filas ? filas.map((f) => f.id === d.deviceId ? { ...f, aforo: d.peopleCount, ultimoDato: d.timestamp || new Date().toISOString() } as ResumenFila : f) : filas);
        setLineas((ls) => {
            const l = ls[d.deviceId]; if (!l?.max?.length) return ls;
            const max = [...l.max]; max[max.length - 1] = Math.max(max[max.length - 1], d.peopleCount);
            return { ...ls, [d.deviceId]: { ...l, max } };
        });
    });

    const changeDate = (delta: number) => {
        const d = new Date(selectedDate + "T12:00:00");
        d.setDate(d.getDate() + delta);
        setSelectedDate(paraFecha(d));
    };
    const esHoy = selectedDate === paraFecha(new Date());
    const deviceLabel = devices.find(d => d.id === selectedDevice)?.name || "Todas las filas";
    const mesDe = (m: string) => { const [y, mo] = m.split("-"); return `${MONTHS_ES[parseInt(mo) - 1]} ${y}`; };

    /* ── Exportar ── */
    const handleExport = async (format: "pdf" | "xlsx") => {
        if (activeTab === "hora") {
            const ivLabel = gran === 60 ? "1 h" : `${gran} min`;
            const cols = [{ key: "rangeLabel", label: "Intervalo" }, { key: "last", label: "Aforo exacto" }, { key: "max", label: "Máximo" }, { key: "avg", label: "Promedio" }, { key: "count", label: "Lecturas" }];
            const rows = intervalRows.filter((r: any) => r.count > 0);
            const dateLabel = fecha(new Date(selectedDate + "T12:00:00"));
            if (format === "xlsx") await exportXLSX(`Afluencia (${ivLabel})`, cols, rows, `afluencia-${gran}min-${selectedDate}.xlsx`);
            else await exportPDF(`Afluencia por intervalo (${ivLabel})`, `${dateLabel} - ${deviceLabel}`, cols, rows, `afluencia-${gran}min-${selectedDate}.pdf`);
            return;
        }
        const base = [{ key: "avg", label: "Promedio" }, { key: "max", label: "Máximo" }, { key: "last", label: "Aforo exacto" }, { key: "count", label: "Eventos" }, { key: "total", label: "Total" }];
        if (activeTab === "dia") {
            const rows = daily.map(d => ({ dateLabel: fmtDate(d.date), avg: d.avg, max: d.max, last: d.last, count: d.count, total: d.total }));
            const cols = [{ key: "dateLabel", label: "Fecha" }, ...base];
            if (format === "xlsx") await exportXLSX("Afluencia por Día", cols, rows, `afluencia-diaria-${dateFrom}-${dateTo}.xlsx`);
            else await exportPDF("Afluencia por Día", `${dateFrom} a ${dateTo} - ${deviceLabel}`, cols, rows, `afluencia-diaria-${dateFrom}-${dateTo}.pdf`);
        } else if (activeTab === "semana") {
            const cols = [{ key: "week", label: "Semana" }, ...base];
            if (format === "xlsx") await exportXLSX("Afluencia por Semana", cols, weekly, `afluencia-semanal-${dateFrom}-${dateTo}.xlsx`);
            else await exportPDF("Afluencia por Semana", `${dateFrom} a ${dateTo} - ${deviceLabel}`, cols, weekly, `afluencia-semanal-${dateFrom}-${dateTo}.pdf`);
        } else {
            const rows = monthly.map(m => ({ monthLabel: mesDe(m.month), avg: m.avg, max: m.max, last: m.last, count: m.count, total: m.total }));
            const cols = [{ key: "monthLabel", label: "Mes" }, ...base];
            if (format === "xlsx") await exportXLSX("Afluencia por Mes", cols, rows, `afluencia-mensual.xlsx`);
            else await exportPDF("Afluencia por Mes", `${deviceLabel}`, cols, rows, `afluencia-mensual.pdf`);
        }
    };

    /* ── La gráfica y la tabla del período ── */
    const SERIES = { valueKeys: ["max", "last", "avg"], labels: ["Máximo", "Aforo exacto", "Promedio"] };
    const periodo = useMemo(() => {
        if (activeTab === "hora") return {
            titulo: `Aforo por intervalo · ${fecha(new Date(selectedDate + "T12:00:00"))}`,
            grafica: <BarChart data={intervalRows} labelKey="label" {...SERIES} />,
            tabla: <DataTable columns={[{ key: "rangeLabel", label: "Intervalo" }, { key: "last", label: "Aforo exacto", align: "right" }, { key: "max", label: "Máximo", align: "right" }, { key: "avg", label: "Promedio", align: "right" }, { key: "count", label: "Lecturas", align: "right" }]}
                data={intervalRows.filter((r: any) => r.count > 0)} />,
        };
        const cols = [{ key: "avg", label: "Promedio", align: "right" }, { key: "max", label: "Máximo", align: "right" }, { key: "last", label: "Aforo exacto", align: "right" }, { key: "count", label: "Lecturas", align: "right" }, { key: "total", label: "Total", align: "right" }];
        if (activeTab === "dia") return {
            titulo: "Aforo por día",
            grafica: <BarChart data={daily.map(d => ({ ...d, label: fmtDate(d.date) }))} labelKey="label" {...SERIES} />,
            tabla: <DataTable columns={[{ key: "dateLabel", label: "Fecha" }, ...cols]} data={daily.filter(d => d.count > 0).map(d => ({ dateLabel: fmtDate(d.date), avg: d.avg, max: d.max, last: d.last, count: d.count, total: d.total }))} />,
        };
        if (activeTab === "semana") return {
            titulo: "Aforo por semana",
            grafica: <BarChart data={weekly} labelKey="week" {...SERIES} />,
            tabla: <DataTable columns={[{ key: "week", label: "Semana" }, ...cols]} data={weekly} />,
        };
        return {
            titulo: "Aforo por mes",
            grafica: <BarChart data={monthly.map(m => ({ ...m, label: mesDe(m.month) }))} labelKey="label" valueKeys={["max", "avg"]} labels={["Máximo", "Promedio"]} />,
            tabla: <DataTable columns={[{ key: "monthLabel", label: "Mes" }, ...cols.filter((c) => c.key !== "last")]} data={monthly.map(m => ({ monthLabel: mesDe(m.month), avg: m.avg, max: m.max, count: m.count, total: m.total }))} />,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, selectedDate, intervalRows, daily, weekly, monthly]);

    const filasVisibles = (ahora || []).filter((f) => !selectedDevice || f.id === selectedDevice);
    const unaSola = filasVisibles.length === 1;
    const rotuloPeriodo = activeTab === "hora" ? (esHoy ? "Hoy" : fecha(new Date(selectedDate + "T12:00:00"))) : `${fecha(new Date(dateFrom + "T12:00:00"))} – ${fecha(new Date(dateTo + "T12:00:00"))}`;

    return (
        <div className="p-6 space-y-6 max-w-[1680px] mx-auto">
            {/* ── Encabezado ── */}
            <div className="flex items-start gap-4 flex-wrap">
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-[28px] font-bold tracking-[-0.02em] leading-tight">Monitor en vivo</h1>
                        <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border", conectado ? "chip-bien" : "chip-neutro")}
                            title={conectado ? "Recibe el aforo apenas cambia" : "Sin conexión en tiempo real: se actualiza cada 5 s"}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", conectado ? "pleno-bien animate-pulse" : "pleno-neutro")} />
                            {conectado ? "En vivo" : "Cada 5 s"}
                        </span>
                    </div>
                    <p className="text-[13px] text-muted-foreground mt-0.5">Cómo están las filas ahora y cómo vienen en el período elegido.</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")} className="gap-1.5"><Table2 size={14} /> Excel</Button>
                    <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} className="gap-1.5"><FileText size={14} /> PDF</Button>
                    <Button variant="ghost" size="sm" onClick={() => { loadData(); cargarAhora(); cargarListas(); }} title="Actualizar" aria-label="Actualizar"><RefreshCw size={14} /></Button>
                </div>
            </div>

            {/* ── 1. Ahora ── */}
            <section className="space-y-2.5">
                <div className="flex items-center gap-2">
                    <span className={ROTULO}>Ahora</span>
                    <span className="text-[11px] text-muted-foreground">· tocá una fila para ver su ficha</span>
                </div>
                {ahora === null ? (
                    <div className="rounded-[14px] border border-border bg-card h-[152px] animate-pulse" />
                ) : filasVisibles.length === 0 ? (
                    <div className="rounded-[14px] border border-dashed border-border">
                        <Vacio icono={Users} titulo="No hay filas" ayuda="Los contadores de fila se dan de alta en Dispositivos." />
                    </div>
                ) : (
                    <div className={cn("grid gap-4", unaSola ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 2xl:grid-cols-3")}>
                        {filasVisibles.map((f) => (
                            <FilaAhora key={f.id} f={f} linea={lineas[f.id]?.max} ancha={unaSola} onAbrir={() => setAbierta(f)} />
                        ))}
                    </div>
                )}
            </section>

            {/* ── 2. El período: filtros y números ── */}
            <section className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(ROTULO, "mr-1")}>Período</span>
                    <Pastillas valor={activeTab} onCambiar={setActiveTab}
                        opciones={[{ v: "hora", r: <><Clock size={13} /> Día</> }, { v: "dia", r: <><CalendarDays size={13} /> Días</> }, { v: "semana", r: <><CalendarRange size={13} /> Semanas</> }, { v: "mes", r: <><CalendarCheck size={13} /> Meses</> }]} />
                    {activeTab === "hora" ? (
                        <div className="inline-flex items-center gap-0.5 h-8 rounded-full bg-muted px-1">
                            <button type="button" onClick={() => changeDate(-1)} className="h-6 w-6 grid place-items-center rounded-full hover:bg-background text-muted-foreground" title="Día anterior" aria-label="Día anterior"><ChevronLeft size={14} /></button>
                            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="bg-transparent text-[12px] font-semibold tabular-nums outline-none px-1" />
                            <button type="button" onClick={() => changeDate(1)} disabled={esHoy} className="h-6 w-6 grid place-items-center rounded-full hover:bg-background text-muted-foreground disabled:opacity-30" title="Día siguiente" aria-label="Día siguiente"><ChevronRight size={14} /></button>
                            {!esHoy && <button type="button" onClick={() => setSelectedDate(paraFecha(new Date()))} className="h-6 px-2 rounded-full text-[11px] font-semibold text-[var(--accion)] hover:bg-background">Hoy</button>}
                        </div>
                    ) : (
                        <div className="inline-flex items-center gap-2 h-8 rounded-full bg-muted px-3 text-[12px]">
                            <Calendar size={13} className="text-muted-foreground" />
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-transparent font-semibold tabular-nums outline-none" />
                            <span className="text-muted-foreground">a</span>
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-transparent font-semibold tabular-nums outline-none" />
                        </div>
                    )}
                    {devices.length > 1 && (
                        <Pastillas valor={selectedDevice} onCambiar={setSelectedDevice}
                            opciones={[{ v: "", r: "Todas" }, ...devices.map((d) => ({ v: d.id, r: d.name }))]} />
                    )}
                    {activeTab === "hora" && (
                        <div className="ml-auto flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">Intervalo</span>
                            <Pastillas chica valor={gran} onCambiar={setGran} opciones={INTERVALOS.map((g) => ({ v: g, r: g === 60 ? "1 h" : `${g} min` }))} />
                        </div>
                    )}
                </div>

                <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                    <Kpi icono={LogOut} rotulo="Atendidos" valor={kpis ? kpis.salidas : "—"} sub={rotuloPeriodo} />
                    <Kpi icono={LogIn} rotulo="Entradas" valor={kpis ? kpis.entradas : "—"} sub={kpis && kpis.entradas ? `${Math.round((kpis.salidas / kpis.entradas) * 100)}% atendidos` : " "} />
                    <Kpi icono={TrendingUp} rotulo="Pico" valor={kpis ? kpis.pico : "—"} sub={kpis?.picoA ? `${activeTab === "hora" ? "" : fecha(kpis.picoA) + " "}${hora(kpis.picoA)}${!selectedDevice && devices.length > 1 && kpis.picoFila ? ` · ${kpis.picoFila}` : ""}` : " "} />
                    <Kpi icono={Gauge} rotulo="Promedio" valor={kpis ? kpis.promedio.toLocaleString("es-UY") : "—"} sub="personas, con gente en la fila" />
                    <Kpi icono={BellRing} rotulo="Se llenó" valor={kpis ? kpis.vecesLlena : "—"} tono={kpis && kpis.vecesLlena > 0 ? "tono-mal" : undefined} sub={kpis ? (kpis.vecesLlena === 1 ? "vez llegó al límite" : "veces llegó al límite") : " "} />
                    <Kpi icono={Timer} rotulo="Tiempo lleno" valor={kpis ? durMin(kpis.minutosSobre) : "—"} tono={kpis && kpis.minutosSobre > 0 ? "tono-aviso" : undefined} sub="en el límite o arriba" />
                </div>
            </section>

            {/* ── 3 y 4. Gráfica + costado ── */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-stretch">
                <Tarjeta titulo={periodo.titulo} icono={BarChart3}
                    accion={<>
                        <span className="hidden md:inline text-[11px] text-muted-foreground">{deviceLabel}</span>
                        <Pastillas chica valor={vista} onCambiar={setVista} opciones={[{ v: "grafica", r: <><Activity size={12} /> Gráfica</> }, { v: "tabla", r: <><Table2 size={12} /> Tabla</> }]} />
                    </>}>
                    {errorCarga ? (
                        <div className="p-10 text-center space-y-3">
                            <div className="text-[13px] tono-mal inline-flex items-center gap-2"><AlertTriangle size={15} /> {errorCarga}</div>
                            <div><Button size="sm" variant="outline" onClick={loadData}>Reintentar</Button></div>
                        </div>
                    ) : loading ? (
                        <div className="h-[340px] m-4 rounded-[10px] bg-muted/50 animate-pulse" />
                    ) : (
                        <div key={`${activeTab}-${vista}`} className="p-4 animate-in fade-in duration-300 ease-out">
                            {vista === "grafica" ? periodo.grafica : periodo.tabla}
                        </div>
                    )}
                </Tarjeta>

                <div className="flex flex-col gap-4 min-w-0">
                    <Tarjeta titulo="Filas que se llenaron" icono={BellRing} className="flex-1">
                        {llenas === null ? <div className="h-24 m-4 rounded-[10px] bg-muted/50 animate-pulse" /> : llenas.length === 0 ? (
                            <Vacio icono={BellRing} titulo="Ninguna fila llegó a su límite" ayuda="Cuando una fila se llena aparece acá, con la foto de ese momento." />
                        ) : (
                            <ol className="px-4 py-3">
                                {llenas.map((n, i) => (
                                    <li key={n.id} className="relative flex gap-3 pb-3 last:pb-0">
                                        {/* La línea de tiempo: el punto y el hilo hasta el siguiente. */}
                                        {i < llenas.length - 1 && <span className="absolute left-[31px] top-10 bottom-0 w-px bg-border" />}
                                        {n.snapshotPath
                                            // eslint-disable-next-line @next/next/no-img-element
                                            ? <img src={n.snapshotPath} alt="" className="h-10 w-16 rounded-[6px] object-cover shrink-0 bg-muted sombra-captura" />
                                            : <span className="h-10 w-16 rounded-[6px] bg-muted shrink-0 grid place-items-center"><Users size={14} className="text-muted-foreground" /></span>}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[13px] font-semibold truncate">{n.device?.name || n.alertName}</span>
                                                <span className="ml-auto text-[12px] font-bold tabular-nums tono-mal shrink-0">{n.peopleCount}<span className="text-muted-foreground font-normal">/{n.threshold}</span></span>
                                            </div>
                                            <div className="text-[11px] text-muted-foreground tabular-nums">{fechaHora(n.timestamp)} · {hace(n.timestamp)}</div>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </Tarjeta>

                    <Tarjeta titulo="Despachos" icono={Send} className="flex-1"
                        accion={<a href="/admin/despachos" className="text-[12px] font-semibold text-[var(--accion)] hover:underline">Ver todos</a>}>
                        {despachos === null ? <div className="h-24 m-4 rounded-[10px] bg-muted/50 animate-pulse" /> : despachos.length === 0 ? (
                            <Vacio icono={Send} titulo="Todavía no se envió nada" ayuda="Los avisos y reportes que salen por Telegram, WhatsApp o correo se listan acá." />
                        ) : (
                            <ol className="px-4 py-3">
                                {despachos.map((d, i) => {
                                    const I = ICONO_CANAL[String(d.recipientChannel || d.channel).toLowerCase()] || Radio;
                                    const e = ESTADO_DESPACHO[d.status] || { rotulo: d.status, tono: "chip-neutro" };
                                    return (
                                        <li key={d.id} className="relative flex items-start gap-3 pb-3 last:pb-0" title={d.lastError || undefined}>
                                            {i < despachos.length - 1 && <span className="absolute left-4 top-9 bottom-0 w-px bg-border" />}
                                            <span className="h-8 w-8 rounded-full bg-muted grid place-items-center shrink-0 relative"><I size={14} className="text-muted-foreground" /></span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[13px] font-semibold truncate">{d.recipient || d.ruleName}</span>
                                                    <span className={cn("ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0", e.tono)}>{e.rotulo}</span>
                                                </div>
                                                <div className="text-[12px] text-muted-foreground truncate">{d.message || d.ruleName}</div>
                                                <div className="text-[11px] text-muted-foreground tabular-nums">{fechaHora(d.sentAt || d.createdAt)}</div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </Tarjeta>
                </div>
            </div>

            {/* ── 5. Cortes de cámara del período ── */}
            <Cortes outages={outages} devices={devices} />

            <CajonFila fila={abierta} open={!!abierta} onOpenChange={(v) => !v && setAbierta(null)} />
        </div>
    );
}

/** AAAA-MM-DD en la hora local (toISOString da la fecha UTC: de noche en Uruguay ya es mañana). */
function paraFecha(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
