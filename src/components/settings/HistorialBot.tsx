"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "react-tooltip";
import {
    Bot, CheckCheck, EyeOff, Loader2, MessageSquareOff, MessagesSquare, RefreshCw, Search, ShieldOff,
    Users, Image as ImageIcon, QrCode, Home, Phone, Inbox, CircleSlash,
} from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { conversacionesBot, mensajesBot, type Conversacion, type MensajeBot } from "@/app/actions/bot-historial";
import { getImagePath } from "@/lib/image-path";
import { hora, paraInput, ZONA } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * Historial del bot de WhatsApp en forma de chat de dos paneles: conversaciones a la
 * izquierda (búsqueda + filtro), hilo a la derecha agrupado por día. Sólo lectura.
 * Los datos salen de WahaRequestLog (cada mensaje recibido + lo que contestó el bot).
 */

const ROL: Record<string, { t: string; c: string }> = {
    ADMIN: { t: "Personal", c: "bg-sky-500/12 text-sky-500 border-sky-500/30" },
    STAFF: { t: "Personal", c: "bg-sky-500/12 text-sky-500 border-sky-500/30" },
    SECURITY: { t: "Personal", c: "bg-sky-500/12 text-sky-500 border-sky-500/30" },
    OPERATOR: { t: "Personal", c: "bg-sky-500/12 text-sky-500 border-sky-500/30" },
    RESIDENT: { t: "Residente", c: "bg-emerald-500/12 text-emerald-500 border-emerald-500/30" },
    WHITELISTED: { t: "Residente", c: "bg-emerald-500/12 text-emerald-500 border-emerald-500/30" },
};
const PALETA = ["#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#6366f1"];
const colorDe = (s: string) => PALETA[[...s].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PALETA.length];

function numeroLindo(n: string) {
    const d = n.replace(/@.*/, "").replace(/\D/g, "");
    if (d.startsWith("598") && d.length === 11) return `+598 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
    return d ? `+${d}` : n;
}
function rotuloDia(ts: string) {
    const k = paraInput(ts);
    if (k === paraInput(new Date())) return "Hoy";
    if (k === paraInput(new Date(Date.now() - 86_400_000))) return "Ayer";
    return new Date(ts).toLocaleDateString("es-UY", { timeZone: ZONA, weekday: "long", day: "2-digit", month: "short" });
}
const cuando = (ts: string) => (paraInput(ts) === paraInput(new Date()) ? hora(ts) : rotuloDia(ts));

/** Formato WhatsApp: *negrita*, _cursiva_ y saltos de línea. Quita emojis del texto mostrado. */
function TextoWhatsApp({ texto }: { texto: string }) {
    const limpio = texto.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, "").replace(/^[ \t]+/gm, "");
    const partes = limpio.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
    return (
        <span className="whitespace-pre-wrap break-words leading-relaxed">
            {partes.map((p, i) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={i} className="font-semibold">{p.slice(1, -1)}</b>
                : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : <Fragment key={i}>{p}</Fragment>)}
        </span>
    );
}

function Avatar({ c, tam = 40 }: { c: Conversacion; tam?: number }) {
    if (c.esEstados) return <span style={{ width: tam, height: tam }} className="rounded-full bg-muted grid place-items-center text-muted-foreground shrink-0"><EyeOff size={tam * 0.4} /></span>;
    if (c.foto) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={getImagePath(c.foto) || undefined} alt="" style={{ width: tam, height: tam }} className="rounded-full object-cover shrink-0 bg-muted ring-2 ring-background" />;
    }
    const base = c.nombre || c.numero;
    const ini = c.nombre ? c.nombre.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() : "#";
    return (
        <span style={{ width: tam, height: tam, background: `color-mix(in oklab, ${colorDe(base)} 18%, transparent)`, color: colorDe(base) }}
            className="rounded-full grid place-items-center font-bold shrink-0 ring-1 ring-inset ring-current/20 text-[13px]">
            {c.nombre ? ini : <Phone size={tam * 0.38} />}
        </span>
    );
}

/** Ícono según lo que mandó el bot (foto, pase QR o texto). */
function TipoRespuesta({ r }: { r: string }) {
    if (r.startsWith("[pase QR]")) return <QrCode size={12} />;
    if (r.startsWith("[foto]")) return <ImageIcon size={12} />;
    return <Bot size={12} />;
}

type Filtro = "todas" | "sinRespuesta";

export function HistorialBot({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [convs, setConvs] = useState<Conversacion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [buscar, setBuscar] = useState("");
    const [filtro, setFiltro] = useState<Filtro>("todas");
    const [conEstados, setConEstados] = useState(false);
    const [actual, setActual] = useState<string | null>(null);
    const [msgs, setMsgs] = useState<MensajeBot[] | null>(null);
    const [errorHilo, setErrorHilo] = useState<string | null>(null);
    const [recargando, setRecargando] = useState(false);
    const fondo = useRef<HTMLDivElement | null>(null);

    const cargar = useCallback(() => {
        setError(null); setRecargando(true);
        conversacionesBot().then((r) => {
            if (!r.ok) { setError(r.error); return; }
            setConvs(r.conversaciones);
            setActual((a) => a || r.conversaciones.find((c) => !c.esEstados)?.numero || null);
        }).catch((e) => setError(e?.message || "No se pudo leer el historial.")).finally(() => setRecargando(false));
    }, []);
    useEffect(() => { if (open) cargar(); }, [open, cargar]);

    const abrirHilo = useCallback((numero: string) => {
        setMsgs(null); setErrorHilo(null);
        mensajesBot(numero).then((r) => (r.ok ? setMsgs(r.mensajes) : setErrorHilo(r.error))).catch((e) => setErrorHilo(e?.message || "No se pudo leer la conversación."));
    }, []);
    useEffect(() => { if (open && actual) abrirHilo(actual); }, [open, actual, abrirHilo]);
    useEffect(() => { if (msgs && fondo.current) fondo.current.scrollTop = fondo.current.scrollHeight; }, [msgs]);

    const visibles = useMemo(() => {
        const q = buscar.trim().toLowerCase();
        const qd = q.replace(/\D/g, "");
        return (convs || []).filter((c) => (conEstados || !c.esEstados)
            && (filtro === "todas" || c.ignorados > 0)
            && (!q || (c.nombre || "").toLowerCase().includes(q) || (qd && c.numero.includes(qd)) || (c.lote || "").toLowerCase().includes(q)));
    }, [convs, buscar, conEstados, filtro]);
    const estados = (convs || []).find((c) => c.esEstados);
    const conv = (convs || []).find((c) => c.numero === actual) || null;
    const kpi = useMemo(() => {
        const l = (convs || []).filter((c) => !c.esEstados);
        const total = l.reduce((a, c) => a + c.total, 0), ign = l.reduce((a, c) => a + c.ignorados, 0);
        return { convs: l.length, total, contestados: total - ign, ign, pct: total ? Math.round(((total - ign) / total) * 100) : 0 };
    }, [convs]);

    const porDia = useMemo(() => {
        const out: { dia: string; lista: MensajeBot[] }[] = [];
        for (const m of msgs || []) { const d = rotuloDia(m.ts); const u = out[out.length - 1]; if (u && u.dia === d) u.lista.push(m); else out.push({ dia: d, lista: [m] }); }
        return out;
    }, [msgs]);

    const nombreDe = (c: Conversacion) => c.esEstados ? "Estados de WhatsApp" : c.nombre || numeroLindo(c.numero);

    return (
        <Cajon open={open} onOpenChange={onOpenChange}>
            <CajonContenido ancho="ancho" titulo="Historial del bot" descripcion="Lo que escribieron al WhatsApp del barrio y lo que el bot contestó, por conversación. Sólo lectura.">
                <div className="h-full min-h-[560px] flex flex-col gap-3">
                    {/* KPIs */}
                    <div className="grid grid-cols-4 gap-2">
                        {([
                            [MessagesSquare, "Conversaciones", kpi.convs, "text-sky-500", "Números distintos que le escribieron al bot."],
                            [Inbox, "Mensajes recibidos", kpi.total, "text-foreground", "Total de mensajes entrantes registrados."],
                            [CheckCheck, "Contestados", `${kpi.contestados} · ${kpi.pct}%`, "text-emerald-500", "Mensajes a los que el bot respondió (texto, foto o pase QR)."],
                            [CircleSlash, "Sin respuesta", kpi.ign, "text-amber-500", "El bot no contestó: número sin ficha, mensaje fuera de flujo o ignorado a propósito."],
                        ] as const).map(([I, t, v, c, tip]) => (
                            <div key={t} data-tooltip-id="tt-hb" data-tooltip-content={tip} className="rounded-xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-3">
                                <span className={cn("w-9 h-9 rounded-lg bg-muted/60 grid place-items-center", c)}><I size={16} /></span>
                                <span className="min-w-0">
                                    <span className="block text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{t}</span>
                                    <span className="block text-[17px] font-bold tabular-nums text-foreground leading-tight">{convs === null ? "—" : v}</span>
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="flex-1 min-h-0 flex rounded-xl border border-border overflow-hidden bg-card/40">
                        {/* Conversaciones */}
                        <div className="w-[320px] shrink-0 border-r border-border flex flex-col min-h-0">
                            <div className="p-3 space-y-2 border-b border-border">
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, número o lote"
                                            className="h-9 w-full rounded-lg bg-background border border-border pl-8 pr-3 text-[12.5px] outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accion)_30%,transparent)]" />
                                    </div>
                                    <button type="button" onClick={cargar} aria-label="Actualizar" data-tooltip-id="tt-hb" data-tooltip-content="Volver a leer el historial"
                                        className="h-9 w-9 grid place-items-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground">
                                        <RefreshCw size={14} className={cn(recargando && "animate-spin")} />
                                    </button>
                                </div>
                                <div className="inline-flex w-full rounded-lg bg-muted/50 p-0.5">
                                    {([["todas", "Todas"], ["sinRespuesta", "Con mensajes sin respuesta"]] as const).map(([v, t]) => (
                                        <button key={v} type="button" onClick={() => setFiltro(v)}
                                            className={cn("flex-1 h-7 rounded-md text-[11px] font-semibold transition-colors", filtro === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto">
                                {error ? (
                                    <div className="p-4 text-[12.5px] text-muted-foreground space-y-2"><p>{error}</p><button type="button" onClick={cargar} className="text-[12px] font-semibold text-[var(--accion)]">Reintentar</button></div>
                                ) : convs === null ? (
                                    Array.from({ length: 7 }).map((_, i) => (
                                        <div key={i} className="flex items-center gap-3 px-3 py-3 border-b border-border/60 animate-pulse">
                                            <span className="w-10 h-10 rounded-full bg-muted" /><span className="flex-1 space-y-1.5"><span className="block h-3 w-2/3 rounded bg-muted" /><span className="block h-2.5 w-1/2 rounded bg-muted/70" /></span>
                                        </div>
                                    ))
                                ) : visibles.length === 0 ? (
                                    <div className="p-6 text-center text-[12.5px] text-muted-foreground space-y-2">
                                        <MessagesSquare size={22} className="mx-auto opacity-50" />
                                        <p>{buscar || filtro !== "todas" ? "Ninguna conversación coincide." : "Todavía nadie le escribió al bot."}</p>
                                    </div>
                                ) : visibles.map((c) => {
                                    const activa = c.numero === actual;
                                    return (
                                        <button key={c.numero} type="button" onClick={() => setActual(c.numero)} aria-current={activa}
                                            className={cn("relative w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-border/60 transition-colors",
                                                activa ? "bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "hover:bg-accent/60")}>
                                            {activa && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--accion)]" />}
                                            <Avatar c={c} />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-baseline gap-2">
                                                    <span className="text-[13px] font-semibold text-foreground truncate flex-1">{nombreDe(c)}</span>
                                                    <span className="text-[10.5px] text-muted-foreground tabular-nums shrink-0 capitalize">{cuando(c.ultimo.ts)}</span>
                                                </span>
                                                <span className="flex items-center gap-1.5 mt-0.5">
                                                    {c.ultimo.estado === "OK" ? <CheckCheck size={12} className="text-emerald-500 shrink-0" /> : <ShieldOff size={12} className="text-muted-foreground shrink-0" />}
                                                    <span className="text-[12px] text-muted-foreground truncate flex-1">{c.ultimo.texto || "(sin texto)"}</span>
                                                    {c.ignorados > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" data-tooltip-id="tt-hb" data-tooltip-content={`${c.ignorados} sin respuesta`} />}
                                                    <span className="min-w-[20px] h-[18px] px-1.5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground grid place-items-center tabular-nums shrink-0">{c.total}</span>
                                                </span>
                                                {c.lote && <span className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><Home size={10} /> {c.lote}</span>}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {estados && (
                                <label className="flex items-center gap-2 px-3 py-2.5 border-t border-border text-[12px] text-muted-foreground cursor-pointer">
                                    <input type="checkbox" checked={conEstados} onChange={(e) => setConEstados(e.target.checked)} className="accent-[var(--accion)]" />
                                    Mostrar los estados de WhatsApp ({estados.total})
                                </label>
                            )}
                        </div>

                        {/* El hilo */}
                        <div className="flex-1 min-w-0 flex flex-col min-h-0">
                            {!conv ? (
                                <div className="flex-1 grid place-items-center text-[13px] text-muted-foreground"><span className="flex flex-col items-center gap-2"><Users size={24} className="opacity-50" /> Elegí una conversación</span></div>
                            ) : (<>
                                <div className="h-16 shrink-0 px-4 flex items-center gap-3 border-b border-border bg-card/70 backdrop-blur">
                                    <Avatar c={conv} tam={42} />
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[14px] font-bold text-foreground truncate">{nombreDe(conv)}</span>
                                            {conv.rol && ROL[conv.rol] ? <span className={cn("px-1.5 py-0.5 rounded-md border text-[9.5px] font-bold uppercase tracking-wide", ROL[conv.rol].c)}>{ROL[conv.rol].t}</span>
                                                : !conv.esEstados ? <span className="px-1.5 py-0.5 rounded-md border border-border text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground" data-tooltip-id="tt-hb" data-tooltip-content="El número no coincide con ninguna ficha (se comparan los últimos 8 dígitos).">Sin ficha</span> : null}
                                        </div>
                                        <div className="text-[11.5px] text-muted-foreground flex items-center gap-2">
                                            {conv.esEstados ? "Historias que llegan al webhook; el bot las ignora" : <><span className="inline-flex items-center gap-1 font-mono"><Phone size={10} /> {numeroLindo(conv.numero)}</span>{conv.lote && <span className="inline-flex items-center gap-1"><Home size={10} /> {conv.lote}</span>}</>}
                                        </div>
                                    </div>
                                    <div className="ml-auto flex items-center gap-2 text-[11px] tabular-nums">
                                        <span className="px-2 py-1 rounded-md bg-muted/60 text-muted-foreground">{conv.total} {conv.total === 1 ? "mensaje" : "mensajes"}</span>
                                        {conv.ignorados > 0 && <span className="px-2 py-1 rounded-md bg-amber-500/12 text-amber-500 font-semibold">{conv.ignorados} sin respuesta</span>}
                                    </div>
                                </div>
                                <div ref={fondo} className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
                                    style={{ backgroundColor: "color-mix(in oklab, var(--muted) 35%, transparent)", backgroundImage: "radial-gradient(color-mix(in oklab, var(--foreground) 7%, transparent) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
                                    {errorHilo ? <p className="text-[12.5px] text-muted-foreground">{errorHilo}</p>
                                        : msgs === null ? <p className="text-[12.5px] text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando la conversación…</p>
                                            : porDia.map(({ dia, lista }) => (
                                                <div key={dia} className="space-y-2 mb-5">
                                                    <div className="sticky top-0 z-10 flex justify-center py-1"><span className="px-3 py-0.5 rounded-full bg-card/95 backdrop-blur border border-border text-[10.5px] font-semibold text-muted-foreground capitalize shadow-sm">{dia}</span></div>
                                                    {lista.map((m) => (
                                                        <Fragment key={m.id}>
                                                            <div className="flex">
                                                                <div className="max-w-[70%] rounded-2xl rounded-tl-sm bg-card border border-border px-3.5 py-2 text-[13px] text-foreground shadow-sm">
                                                                    {m.texto ? <TextoWhatsApp texto={m.texto} /> : <i className="text-muted-foreground">Sin texto (imagen, audio o reacción)</i>}
                                                                    <div className="mt-1 text-[10px] text-muted-foreground text-right tabular-nums">{hora(m.ts)}</div>
                                                                </div>
                                                            </div>
                                                            {m.estado === "OK" && m.respuesta ? (
                                                                <div className="flex justify-end">
                                                                    <div className="max-w-[70%] rounded-2xl rounded-tr-sm px-3.5 py-2 text-[13px] text-foreground shadow-sm border border-emerald-500/25 bg-[color-mix(in_oklab,#10b981_13%,var(--card))]">
                                                                        <div className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-emerald-500 mb-1"><TipoRespuesta r={m.respuesta} /> Bot</div>
                                                                        <TextoWhatsApp texto={m.respuesta.replace(/^\[(foto|pase QR)\]\s*/, "")} />
                                                                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground tabular-nums">{hora(m.ts)} <CheckCheck size={12} className="text-emerald-500" /></div>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex justify-center">
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card/90 border border-dashed border-border text-[11px] text-muted-foreground">
                                                                        <MessageSquareOff size={12} /> {m.estado === "IGNORADO" ? `Sin respuesta${m.respuesta ? `: ${m.respuesta}` : ""}` : `${m.estado}${m.respuesta ? `: ${m.respuesta}` : ""}`}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </Fragment>
                                                    ))}
                                                </div>
                                            ))}
                                </div>
                                <div className="shrink-0 px-4 py-2.5 border-t border-border text-[11.5px] text-muted-foreground flex items-center gap-2 bg-card/70">
                                    <Bot size={13} /> Sólo lectura: lo que sale por WhatsApp lo manda el bot o las reglas de notificación.
                                </div>
                            </>)}
                        </div>
                    </div>
                </div>
                <Tooltip id="tt-hb" place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
