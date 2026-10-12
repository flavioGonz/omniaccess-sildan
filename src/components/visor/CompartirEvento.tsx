"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Loader2, MessageCircle, Search, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { compartirEvento, estadoCompartido, opcionesCompartir, type DestinoCompartir, type OpcionesCompartir } from "@/app/actions/compartir";

/** Cada cuánto se pregunta cómo van los envíos, y hasta cuándo (con clip el worker tarda lo que dura el tramo). */
const SONDEO_MS = 1500;
const SONDEO_TOPE_MS = 120_000;

/** El avión de papel de Telegram, dibujado: lucide no tiene la marca y un ícono genérico confunde con «enviar». */
function IconoTelegram({ size = 15 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2 1.8 11.7c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z" />
        </svg>
    );
}

/**
 * Compartir un evento por WhatsApp o Telegram: la foto con sus datos, a gente que el sistema ya
 * conoce (actions/compartir). Sale por la cola de alertas, así que llega igual que una alerta y
 * queda en Despachos.
 *
 * Lo que se va a mandar se ve antes de mandarlo (foto y texto), y después se sigue envío por envío
 * hasta que el worker dice cómo terminó: «enviado» en pantalla quiere decir que salió, no que se
 * encoló. Un canal sin configurar se muestra apagado y con el porqué.
 */
export function CompartirEvento({ foto, deviceId, deviceName, instante, titulo, lineas, onCerrar }: {
    foto: string | null;
    deviceId: string | null;
    deviceName: string | null;
    instante: string | Date;
    titulo: string;
    lineas: string[];
    onCerrar: () => void;
}) {
    const [op, setOp] = useState<OpcionesCompartir | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [canal, setCanal] = useState<"whatsapp" | "telegram">("whatsapp");
    const [elegidos, setElegidos] = useState<Set<string>>(new Set());
    const [q, setQ] = useState("");
    const [usuarios, setUsuarios] = useState<DestinoCompartir[]>([]);
    const [nota, setNota] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [trabajos, setTrabajos] = useState<{ id: string; nombre: string; estado: string; error: string | null }[] | null>(null);
    const nombres = useRef(new Map<string, string>());

    useEffect(() => {
        opcionesCompartir("").then((o) => {
            setOp(o);
            if (!o.whatsapp.disponible && o.telegram.disponible) setCanal("telegram");
        }).catch((e) => setError(e?.message || "No se pudieron traer los destinatarios."));
    }, []);
    // Buscar usuarios con teléfono (sólo WhatsApp), con una pausa para no consultar por cada tecla.
    useEffect(() => {
        if (canal !== "whatsapp" || q.trim().length < 2) { setUsuarios([]); return; }
        const t = setTimeout(() => { opcionesCompartir(q).then((o) => setUsuarios(o.whatsapp.usuarios)).catch(() => setUsuarios([])); }, 300);
        return () => clearTimeout(t);
    }, [q, canal]);
    useEffect(() => { setElegidos(new Set()); }, [canal]);

    // Esc cierra ESTE diálogo y nada más (el visor de abajo también escucha la tecla).
    useEffect(() => {
        const t = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.preventDefault(); e.stopImmediatePropagation(); onCerrar(); };
        window.addEventListener("keydown", t, true);
        return () => window.removeEventListener("keydown", t, true);
    }, [onCerrar]);

    // Seguir los envíos hasta que terminen.
    useEffect(() => {
        if (!trabajos || trabajos.every((t) => t.estado === "SENT" || t.estado === "FAILED")) return;
        const inicio = Date.now();
        const iv = setInterval(async () => {
            if (Date.now() - inicio > SONDEO_TOPE_MS) { clearInterval(iv); return; }
            const e = await estadoCompartido(trabajos.map((t) => t.id)).catch(() => null);
            if (e) setTrabajos((ts) => ts && ts.map((t) => (e[t.id] ? { ...t, estado: e[t.id].estado, error: e[t.id].error } : t)));
        }, SONDEO_MS);
        return () => clearInterval(iv);
    }, [trabajos?.map((t) => t.estado).join()]); // eslint-disable-line react-hooks/exhaustive-deps

    const destinos: DestinoCompartir[] = useMemo(() => {
        if (!op) return [];
        return canal === "telegram" ? op.telegram.destinos : [...op.whatsapp.avisos, ...usuarios];
    }, [op, canal, usuarios]);
    for (const d of destinos) nombres.current.set(d.destino, d.nombre);
    const disponible = op ? op[canal].disponible : false;
    const motivo = op ? op[canal].motivo : undefined;
    const alternar = (d: string) => setElegidos((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });

    const enviar = async () => {
        setEnviando(true); setError(null);
        const r = await compartirEvento({
            canal, destinos: [...elegidos], foto, deviceId, deviceName,
            instante: new Date(instante).toISOString(), titulo, lineas, nota,
        }).catch((e) => ({ ok: false as const, error: String(e?.message || e) }));
        setEnviando(false);
        if (!r.ok) { setError(r.error); return; }
        setTrabajos(r.trabajos.map((t) => ({ ...t, estado: "PENDING", error: null })));
    };

    if (typeof document === "undefined") return null;
    const terminado = trabajos?.every((t) => t.estado === "SENT" || t.estado === "FAILED");

    return createPortal(
        <div className="fixed inset-0 z-[calc(var(--capa-panel)+600)] bg-black/60 grid place-items-center p-4 pointer-events-auto" onClick={(e) => { e.stopPropagation(); onCerrar(); }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compartir el evento"
                className="w-[min(460px,100%)] max-h-[90vh] flex flex-col rounded-[14px] bg-[#0b0f16] border border-white/12 shadow-[0_24px_70px_rgba(0,0,0,0.7)] text-white overflow-hidden">
                <header className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-white/10">
                    <h2 className="text-[15px] font-bold">Compartir el evento</h2>
                    <button type="button" onClick={onCerrar} aria-label="Cerrar" className="w-8 h-8 rounded-[8px] grid place-items-center text-white/70 hover:text-white hover:bg-white/10"><X size={16} /></button>
                </header>

                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 space-y-3.5">
                    {/* Lo que va a salir, tal cual. */}
                    <div className="flex gap-3">
                        {foto && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={`${foto}${foto.includes("?") ? "&" : "?"}w=320`} alt="" className="w-[120px] aspect-video rounded-[6px] object-cover bg-black shrink-0" />
                        )}
                        <div className="min-w-0 text-[12px] leading-snug">
                            <div className="font-semibold text-white">{titulo}</div>
                            {lineas.filter(Boolean).map((l, i) => <div key={i} className="text-white/65">{l}</div>)}
                        </div>
                    </div>

                    {trabajos ? (
                        <div>
                            <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5">Envíos</div>
                            <ul className="divide-y divide-white/[0.07]">
                                {trabajos.map((t) => (
                                    <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-[12.5px]">
                                        <span className="font-semibold">{t.nombre}</span>
                                        <span className={cn("flex items-center gap-1.5 text-right", t.estado === "SENT" ? "visor-bien" : t.estado === "FAILED" ? "visor-mal" : "text-white/60")}>
                                            {t.estado === "SENT" ? <><Check size={14} /> Enviado</>
                                                : t.estado === "FAILED" ? <><AlertTriangle size={14} className="shrink-0" /> <span className="max-w-[220px]">{t.error || "No salió"}</span></>
                                                    : <><Loader2 size={14} className="animate-spin" /> Enviando…</>}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            {!terminado && <p className="text-[11px] text-white/45 mt-1">{op?.conClip ? "Con el clip tarda lo que dura el video. " : ""}Si se cierra esta ventana el envío sigue: queda en Despachos.</p>}
                        </div>
                    ) : (
                        <>
                            {/* El canal: elegir uno, por eso es píldora. */}
                            <div className="flex gap-1.5">
                                {(["whatsapp", "telegram"] as const).map((c) => {
                                    const ok = op ? op[c].disponible : true;
                                    return (
                                        <button key={c} type="button" onClick={() => setCanal(c)} aria-pressed={canal === c}
                                            className={cn("h-8 px-3.5 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 border transition-colors",
                                                canal === c ? "bg-white text-black border-transparent" : "border-white/20 text-white/80 hover:text-white",
                                                !ok && canal !== c && "opacity-50")}>
                                            {c === "whatsapp" ? <MessageCircle size={14} /> : <IconoTelegram size={14} />}
                                            {c === "whatsapp" ? "WhatsApp" : "Telegram"}
                                        </button>
                                    );
                                })}
                            </div>

                            {!op ? (
                                <p className="text-[12px] text-white/55 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Buscando destinatarios…</p>
                            ) : !disponible ? (
                                <p className="text-[12.5px] text-white/70 flex items-start gap-2"><AlertTriangle size={14} className="visor-aviso mt-0.5 shrink-0" /> {motivo}</p>
                            ) : (
                                <div>
                                    <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1">Para</div>
                                    <ul className="divide-y divide-white/[0.07]">
                                        {destinos.map((d) => (
                                            <li key={d.destino || "grupo"}>
                                                <label className="flex items-center gap-2.5 py-2 cursor-pointer text-[12.5px]">
                                                    <input type="checkbox" checked={elegidos.has(d.destino)} onChange={() => alternar(d.destino)} className="accent-[var(--accion)] w-4 h-4" />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="font-semibold block truncate">{d.nombre}</span>
                                                        <span className="text-[11px] text-white/45 block truncate">{d.detalle}</span>
                                                    </span>
                                                </label>
                                            </li>
                                        ))}
                                        {!destinos.length && <li className="py-2 text-[12px] text-white/50">No hay destinatarios cargados. Buscá un usuario abajo.</li>}
                                    </ul>
                                    {canal === "whatsapp" && (
                                        <div className="relative mt-1.5">
                                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
                                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar un usuario con teléfono (nombre, lote…)"
                                                className="w-full h-9 pl-8 pr-3 rounded-[6px] bg-white/[0.06] border border-white/12 text-[12.5px] placeholder:text-white/35 focus:outline-none focus:border-[var(--accion-en-oscuro)]" />
                                        </div>
                                    )}
                                    {[...elegidos].filter((d) => !destinos.some((x) => x.destino === d)).map((d) => (
                                        <div key={d} className="flex items-center gap-2 mt-1.5 text-[12px] text-white/75"><Check size={13} /> {nombres.current.get(d) || d}
                                            <button type="button" onClick={() => alternar(d)} className="text-white/45 hover:text-white">quitar</button></div>
                                    ))}
                                </div>
                            )}

                            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={300} placeholder="Una nota para quien lo recibe (opcional)"
                                className="w-full px-3 py-2 rounded-[6px] bg-white/[0.06] border border-white/12 text-[12.5px] placeholder:text-white/35 resize-none focus:outline-none focus:border-[var(--accion-en-oscuro)]" />
                        </>
                    )}
                    {error && <p className="text-[12px] visor-mal flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>}
                </div>

                <footer className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
                    <span className="text-[11px] text-white/45 leading-snug">
                        {trabajos ? "" : op?.conClip ? "Sale con la foto y el clip del instante." : "Sale con la foto del evento."}
                    </span>
                    {trabajos ? (
                        <button type="button" onClick={onCerrar} className="h-9 px-4 rounded-[8px] bg-white/10 hover:bg-white/15 text-[12.5px] font-semibold">Listo</button>
                    ) : (
                        <button type="button" onClick={enviar} disabled={!disponible || !elegidos.size || enviando}
                            className="h-9 px-4 rounded-[8px] bg-[var(--accion)] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">
                            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Enviar{elegidos.size ? ` a ${elegidos.size}` : ""}
                        </button>
                    )}
                </footer>
            </div>
        </div>,
        document.body,
    );
}
