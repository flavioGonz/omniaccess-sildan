"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCheck, EyeOff, Loader2, MessageSquareOff, RefreshCw, ShieldOff, Users } from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Seek } from "@/components/ui/search";
import { Pista } from "@/components/ui/pista";
import { Estado, Identidad } from "@/components/ui/celdas";
import { conversacionesBot, mensajesBot, type Conversacion, type MensajeBot } from "@/app/actions/bot-historial";
import { getImagePath } from "@/lib/image-path";
import { hora, paraInput, ZONA } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/**
 * El historial del bot de WhatsApp, con la forma de un chat (bloque chat-ui de shadcnuikit,
 * variante de dos paneles): las conversaciones a la izquierda con búsqueda, y a la derecha el
 * hilo de cada número — lo que escribió la persona y lo que contestó el bot, agrupado por día.
 *
 * Antes era una tabla de 50 renglones sueltos con el número cortado: no se podía seguir una
 * conversación, ni saber de quién era el número, ni separar lo que el bot ignoró a propósito
 * (números sin ficha, estados de WhatsApp) de lo que contestó.
 *
 * Es sólo para leer: desde acá no se escribe. Lo que sale por WhatsApp sale del bot o de las
 * reglas de notificación, que dejan su propio rastro.
 */

const ROL: Record<string, { t: string; tono: "info" | "bien" | "neutro" }> = {
    ADMIN: { t: "Personal", tono: "info" }, STAFF: { t: "Personal", tono: "info" }, SECURITY: { t: "Personal", tono: "info" }, OPERATOR: { t: "Personal", tono: "info" },
    RESIDENT: { t: "Residente", tono: "bien" }, WHITELISTED: { t: "Residente", tono: "bien" },
};

/** "+598 99 185 402" para leerlo; si no parece un celular uruguayo, tal cual. */
function numeroLindo(n: string) {
    const d = n.replace(/@.*/, "").replace(/\D/g, "");
    if (d.startsWith("598") && d.length === 11) return `+598 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
    return d ? `+${d}` : n;
}

/** "Hoy", "Ayer" o "jue 08 oct", en la zona del barrio. */
function rotuloDia(ts: string) {
    const k = paraInput(ts);
    if (k === paraInput(new Date())) return "Hoy";
    if (k === paraInput(new Date(Date.now() - 86_400_000))) return "Ayer";
    return new Date(ts).toLocaleDateString("es-UY", { timeZone: ZONA, weekday: "short", day: "2-digit", month: "short" });
}
/** En la lista: la hora si es de hoy, el día si no. */
const cuando = (ts: string) => (paraInput(ts) === paraInput(new Date()) ? hora(ts) : rotuloDia(ts));

/** El formato de WhatsApp que usa el bot: *negrita* y _cursiva_, y los saltos de línea. */
function TextoWhatsApp({ texto }: { texto: string }) {
    const partes = texto.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
    return (
        <span className="whitespace-pre-wrap break-words">
            {partes.map((p, i) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b>
                : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : <Fragment key={i}>{p}</Fragment>)}
        </span>
    );
}

export function HistorialBot({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [convs, setConvs] = useState<Conversacion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [buscar, setBuscar] = useState("");
    const [conEstados, setConEstados] = useState(false);
    const [actual, setActual] = useState<string | null>(null);
    const [msgs, setMsgs] = useState<MensajeBot[] | null>(null);
    const [errorHilo, setErrorHilo] = useState<string | null>(null);
    const fondo = useRef<HTMLDivElement | null>(null);

    const cargar = useCallback(() => {
        setError(null);
        conversacionesBot().then((r) => {
            if (!r.ok) { setError(r.error); return; }
            setConvs(r.conversaciones);
            setActual((a) => a || r.conversaciones.find((c) => !c.esEstados)?.numero || null);
        }).catch((e) => setError(e?.message || "No se pudo leer el historial."));
    }, []);
    useEffect(() => { if (open) cargar(); }, [open, cargar]);

    const abrirHilo = useCallback((numero: string) => {
        setMsgs(null); setErrorHilo(null);
        mensajesBot(numero).then((r) => (r.ok ? setMsgs(r.mensajes) : setErrorHilo(r.error))).catch((e) => setErrorHilo(e?.message || "No se pudo leer la conversación."));
    }, []);
    useEffect(() => { if (open && actual) abrirHilo(actual); }, [open, actual, abrirHilo]);
    // El hilo arranca abajo, en lo último, como cualquier chat.
    useEffect(() => { if (msgs && fondo.current) fondo.current.scrollTop = fondo.current.scrollHeight; }, [msgs]);

    const visibles = useMemo(() => {
        const q = buscar.trim().toLowerCase();
        return (convs || []).filter((c) => (conEstados || !c.esEstados) && (!q || (c.nombre || "").toLowerCase().includes(q) || c.numero.includes(q.replace(/\D/g, "") || "§") || (c.lote || "").toLowerCase().includes(q)));
    }, [convs, buscar, conEstados]);
    const estados = (convs || []).find((c) => c.esEstados);
    const conv = (convs || []).find((c) => c.numero === actual) || null;

    // Los mensajes agrupados por día, para los separadores.
    const porDia = useMemo(() => {
        const out: { dia: string; lista: MensajeBot[] }[] = [];
        for (const m of msgs || []) { const d = rotuloDia(m.ts); const u = out[out.length - 1]; if (u && u.dia === d) u.lista.push(m); else out.push({ dia: d, lista: [m] }); }
        return out;
    }, [msgs]);

    const nombreDe = (c: Conversacion) => c.esEstados ? "Estados de WhatsApp" : c.nombre || numeroLindo(c.numero);
    const fotoDe = (c: Conversacion) => (c.foto ? getImagePath(c.foto) : null);

    return (
        <Cajon open={open} onOpenChange={onOpenChange}>
            <CajonContenido ancho="ancho" titulo="Historial del bot" descripcion="Lo que la gente le escribió al WhatsApp del barrio y lo que el bot contestó, por conversación. Sólo lectura.">
                <div className="h-full min-h-[520px] flex">
                    {/* Conversaciones */}
                    <div className="w-[300px] shrink-0 border-r border-border flex flex-col min-h-0">
                        <div className="p-3 flex items-center gap-2 border-b border-border">
                            <div className="flex-1 min-w-0"><Seek value={buscar} onChange={setBuscar} placeholder="Nombre, número o lote" startOpen width={210} alto={34} /></div>
                            <Pista texto="Volver a leer el historial.">
                                <button type="button" onClick={cargar} aria-label="Actualizar" className="h-[34px] w-[34px] grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-[var(--accion)]"><RefreshCw size={14} /></button>
                            </Pista>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto">
                            {error ? (
                                <p className="p-4 text-[12.5px] text-muted-foreground">{error} <button type="button" onClick={cargar} className="tono-accion font-semibold">Reintentar</button></p>
                            ) : convs === null ? (
                                <p className="p-4 text-[12.5px] text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando…</p>
                            ) : visibles.length === 0 ? (
                                <p className="p-4 text-[12.5px] text-muted-foreground">{buscar ? "Ninguna conversación coincide." : "Todavía nadie le escribió al bot."}</p>
                            ) : visibles.map((c) => {
                                const activa = c.numero === actual;
                                const soloIgnorado = c.ignorados === c.total;
                                return (
                                    <button key={c.numero} type="button" onClick={() => setActual(c.numero)} aria-current={activa}
                                        className={cn("w-full flex items-start gap-2.5 px-3 py-2.5 text-left border-b border-border transition-colors", activa ? "bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "hover:bg-accent", soloIgnorado && !activa && "opacity-70")}>
                                        {c.esEstados
                                            ? <span className="w-9 h-9 rounded-full bg-muted grid place-items-center text-muted-foreground shrink-0"><EyeOff size={15} /></span>
                                            : fotoDe(c)
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                ? <img src={fotoDe(c)!} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 bg-muted" />
                                                : <span className="w-9 h-9 rounded-full bg-muted grid place-items-center text-[13px] font-bold text-muted-foreground shrink-0">{(c.nombre || "#").charAt(0).toUpperCase()}</span>}
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-baseline gap-2">
                                                <span className="text-[13px] font-semibold text-foreground truncate flex-1">{nombreDe(c)}</span>
                                                <span className="text-[10.5px] text-muted-foreground tabular-nums shrink-0">{cuando(c.ultimo.ts)}</span>
                                            </span>
                                            <span className="flex items-center gap-1.5 mt-0.5">
                                                {c.ultimo.estado === "OK" ? <CheckCheck size={12} className="tono-accion shrink-0" /> : <ShieldOff size={12} className="text-muted-foreground shrink-0" />}
                                                <span className="text-[12px] text-muted-foreground truncate flex-1">{c.ultimo.texto || "(sin texto)"}</span>
                                                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-muted text-[10px] font-bold text-muted-foreground grid place-items-center tabular-nums shrink-0">{c.total}</span>
                                            </span>
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
                            <div className="flex-1 grid place-items-center text-[13px] text-muted-foreground"><span className="flex items-center gap-2"><Users size={16} /> Elegí una conversación</span></div>
                        ) : (<>
                            <div className="h-16 shrink-0 px-4 flex items-center gap-3 border-b border-border">
                                <Identidad tam={38} foto={conv.esEstados ? null : fotoDe(conv)} nombre={nombreDe(conv)}
                                    sub={conv.esEstados ? "Historias que llegan al webhook; el bot las ignora siempre" : [numeroLindo(conv.numero), conv.lote].filter(Boolean).join(" · ")}
                                    insignia={conv.rol && ROL[conv.rol] ? <Estado tono={ROL[conv.rol].tono}>{ROL[conv.rol].t}</Estado> : !conv.esEstados ? <Estado tono="quieto">Sin ficha</Estado> : null} />
                                <div className="ml-auto text-right text-[11.5px] text-muted-foreground tabular-nums leading-tight">
                                    <div>{conv.total} {conv.total === 1 ? "mensaje" : "mensajes"}</div>
                                    {conv.ignorados > 0 && <div>{conv.ignorados} sin respuesta</div>}
                                </div>
                            </div>
                            <div ref={fondo} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 bg-muted/30">
                                {errorHilo ? <p className="text-[12.5px] text-muted-foreground">{errorHilo}</p>
                                    : msgs === null ? <p className="text-[12.5px] text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando la conversación…</p>
                                        : porDia.map(({ dia, lista }) => (
                                            <div key={dia} className="space-y-2.5 mb-4">
                                                <div className="flex justify-center"><span className="px-2.5 py-0.5 rounded-full bg-card border border-border text-[10.5px] font-semibold text-muted-foreground">{dia}</span></div>
                                                {lista.map((m) => (
                                                    <Fragment key={m.id}>
                                                        {/* Lo que escribió la persona: a la izquierda. */}
                                                        <div className="flex">
                                                            <div className="max-w-[72%] rounded-2xl rounded-bl-md bg-card border border-border px-3 py-2 text-[13px] text-foreground">
                                                                {m.texto ? <TextoWhatsApp texto={m.texto} /> : <i className="text-muted-foreground">Sin texto (imagen, audio o reacción)</i>}
                                                                <div className="mt-0.5 text-[10px] text-muted-foreground text-right tabular-nums">{hora(m.ts)}</div>
                                                            </div>
                                                        </div>
                                                        {/* Lo que hizo el bot: a la derecha si contestó, al centro si no. */}
                                                        {m.estado === "OK" && m.respuesta ? (
                                                            <div className="flex justify-end">
                                                                <div className="max-w-[72%] rounded-2xl rounded-br-md bg-[color-mix(in_oklab,var(--accion)_14%,var(--card))] border border-[color-mix(in_oklab,var(--accion)_25%,transparent)] px-3 py-2 text-[13px] text-foreground">
                                                                    <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] tono-accion mb-0.5"><Bot size={11} /> Bot</div>
                                                                    <TextoWhatsApp texto={m.respuesta} />
                                                                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground tabular-nums">{hora(m.ts)} <CheckCheck size={12} className="tono-accion" /></div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex justify-center">
                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border border-dashed border-border text-[11px] text-muted-foreground">
                                                                    <MessageSquareOff size={12} /> {m.estado === "IGNORADO" ? `No contestó: ${m.respuesta || "ignorado"}` : `${m.estado}${m.respuesta ? `: ${m.respuesta}` : ""}`}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </Fragment>
                                                ))}
                                            </div>
                                        ))}
                            </div>
                            <div className="shrink-0 px-4 py-2.5 border-t border-border text-[11.5px] text-muted-foreground flex items-center gap-2">
                                <Bot size={13} /> Desde acá no se escribe: lo que sale por WhatsApp lo manda el bot o las reglas de notificación.
                            </div>
                        </>)}
                    </div>
                </div>
            </CajonContenido>
        </Cajon>
    );
}
