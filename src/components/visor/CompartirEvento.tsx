"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, MessageCircle, Search, Send, Share2, X } from "lucide-react";
import { fechaCorta, horaSeg } from "@/lib/fechas";
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
 *
 * Es un CAJÓN dentro de la ventana del visor, el mismo de «Exportar clip» (18/10, Nico: «llama a
 * un modal que no deseo, deseo el drawer»). Antes era un diálogo centrado, oscuro siempre, que
 * tapaba la ficha y la foto; el cajón deja ver el evento al costado y sigue el tema. Quien lo usa
 * lo monta ADENTRO de la ventana (va con `absolute`, como DescargaClip).
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

    const terminado = trabajos?.every((t) => t.estado === "SENT" || t.estado === "FAILED");
    const momento = new Date(instante);
    const rotulo = "text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3";
    const cuantos = (c: "whatsapp" | "telegram") => !op ? "Buscando…" : !op[c].disponible ? (op[c].motivo || "No configurado")
        : c === "telegram" ? `${op.telegram.destinos.length} ${op.telegram.destinos.length === 1 ? "destino" : "destinos"}`
            : `${op.whatsapp.avisos.length} de avisos · o buscá un usuario`;

    return (
        <div className="absolute inset-0 z-[60]" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <motion.div className="absolute inset-0 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => { if (!enviando) onCerrar(); }} />
            <motion.aside role="dialog" aria-label="Compartir el evento"
                initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
                className="absolute inset-y-0 right-0 w-full sm:w-[460px] flex flex-col bg-background/[0.97] backdrop-blur-xl border-l border-border text-foreground shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.45)]">

                {/* ── Encabezado ── */}
                <div className="shrink-0 flex items-start gap-3 px-6 pt-5 pb-4 border-b border-border">
                    <span className="w-10 h-10 rounded-[10px] grid place-items-center bg-muted border border-border shrink-0"><Share2 size={18} className="text-[var(--accion)]" /></span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold leading-tight">Compartir el evento</div>
                        <div className="text-[12.5px] text-muted-foreground mt-0.5 truncate">{deviceName ? <>{deviceName} · </> : null}{fechaCorta(momento)} {horaSeg(momento)}</div>
                    </div>
                    <button type="button" onClick={onCerrar} aria-label="Cerrar" title="Cerrar  ( Esc )"
                        className="w-8 h-8 grid place-items-center rounded-[6px] text-muted-foreground hover:text-foreground hover:bg-muted"><X size={17} /></button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {/* ── Lo que va a salir, tal cual ── */}
                    <section className="px-6 pt-5">
                        <div className={rotulo}>Lo que se manda</div>
                        <div className="rounded-[10px] border border-border overflow-hidden">
                            {foto && (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={`${foto}${foto.includes("?") ? "&" : "?"}w=640`} alt="" className="w-full aspect-video object-cover bg-black" />
                            )}
                            <div className="px-3 py-2.5 text-[12px] leading-snug bg-muted/40">
                                <div className="font-semibold">{titulo}</div>
                                {lineas.filter(Boolean).map((l, i) => <div key={i} className="text-muted-foreground">{l}</div>)}
                            </div>
                        </div>
                    </section>

                    {trabajos ? (
                        <section className="px-6 pt-6 pb-6">
                            <div className={rotulo}>Envíos</div>
                            <div className="rounded-[10px] border border-border divide-y divide-border">
                                {trabajos.map((t) => (
                                    <div key={t.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[12.5px]">
                                        <span className="font-semibold">{t.nombre}</span>
                                        <span className={cn("flex items-center gap-1.5 text-right", t.estado === "SENT" ? "tono-bien" : t.estado === "FAILED" ? "tono-mal" : "text-muted-foreground")}>
                                            {t.estado === "SENT" ? <><Check size={14} /> Enviado</>
                                                : t.estado === "FAILED" ? <><AlertTriangle size={14} className="shrink-0" /> <span className="max-w-[220px]">{t.error || "No salió"}</span></>
                                                    : <><Loader2 size={14} className="animate-spin" /> Enviando…</>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            {!terminado && <p className="text-[11.5px] text-muted-foreground mt-2">{op?.conClip ? "Con el clip tarda lo que dura el video. " : ""}Si se cierra este panel el envío sigue: queda en Despachos.</p>}
                        </section>
                    ) : (
                        <>
                            {/* ── Por dónde: elegir uno ── */}
                            <section className="px-6 pt-6">
                                <div className={rotulo}>Por dónde</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {(["whatsapp", "telegram"] as const).map((c) => {
                                        const ok = op ? op[c].disponible : true;
                                        const activo = canal === c;
                                        return (
                                            <button key={c} type="button" onClick={() => ok && setCanal(c)} disabled={!ok} aria-pressed={activo} title={!ok ? op?.[c].motivo : undefined}
                                                className={cn("rounded-[10px] border px-3 py-3 text-left transition-colors",
                                                    activo ? "border-[var(--accion)] bg-[var(--accion)]/10" : "border-border hover:bg-muted",
                                                    !ok && "opacity-45 cursor-not-allowed hover:bg-transparent")}>
                                                <span className={activo ? "text-[var(--accion)]" : "text-foreground/80"}>{c === "whatsapp" ? <MessageCircle size={18} /> : <IconoTelegram size={18} />}</span>
                                                <span className="block mt-2 text-[13px] font-bold">{c === "whatsapp" ? "WhatsApp" : "Telegram"}</span>
                                                <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5">{cuantos(c)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            {/* ── Para quién ── */}
                            <section className="px-6 pt-6">
                                <div className={rotulo}>Para</div>
                                {!op ? (
                                    <p className="text-[12px] text-muted-foreground flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Buscando destinatarios…</p>
                                ) : !disponible ? (
                                    <p className="text-[12.5px] text-foreground/80 flex items-start gap-2"><AlertTriangle size={14} className="tono-aviso mt-0.5 shrink-0" /> {motivo}</p>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="rounded-[10px] border border-border bg-muted/50 divide-y divide-border max-h-[240px] overflow-y-auto">
                                            {destinos.map((d) => {
                                                const si = elegidos.has(d.destino);
                                                return (
                                                    <button key={d.destino || "grupo"} type="button" onClick={() => alternar(d.destino)} aria-pressed={si}
                                                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted">
                                                        <span className={cn("w-[18px] h-[18px] rounded-[5px] grid place-items-center border shrink-0", si ? "bg-[var(--accion)] border-[var(--accion)]" : "border-border")}>{si && <Check size={12} className="text-white" />}</span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block text-[13px] font-semibold truncate">{d.nombre}</span>
                                                            <span className="block text-[11px] text-muted-foreground truncate">{d.detalle}</span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                            {!destinos.length && <div className="px-3 py-3 text-[12px] text-muted-foreground">No hay destinatarios cargados.{canal === "whatsapp" ? " Buscá un usuario abajo." : ""}</div>}
                                        </div>
                                        {canal === "whatsapp" && (
                                            <div className="relative">
                                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar un usuario con teléfono (nombre, lote…)"
                                                    className="w-full h-9 rounded-[6px] bg-muted border border-border focus:border-[var(--accion)] pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none" />
                                            </div>
                                        )}
                                        {[...elegidos].filter((d) => !destinos.some((x) => x.destino === d)).map((d) => (
                                            <div key={d} className="flex items-center gap-2 text-[12px] text-foreground/80"><Check size={13} className="text-[var(--accion)]" /> {nombres.current.get(d) || d}
                                                <button type="button" onClick={() => alternar(d)} className="text-muted-foreground hover:text-foreground">quitar</button></div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            {/* ── Nota ── */}
                            <section className="px-6 pt-6 pb-6">
                                <div className={rotulo}>Nota</div>
                                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={300} placeholder="Para quien lo recibe (opcional)"
                                    className="w-full px-3 py-2 rounded-[6px] bg-muted border border-border text-[13px] text-foreground placeholder:text-muted-foreground resize-none outline-none focus:border-[var(--accion)]" />
                            </section>
                        </>
                    )}
                    {error && <p className="mx-6 mb-6 text-[12px] tono-mal flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>}
                </div>

                {/* ── Pie ── */}
                <div className="shrink-0 flex items-center gap-2 px-6 py-4 border-t border-border bg-muted/40">
                    <span className="text-[12px] text-muted-foreground mr-auto leading-snug">
                        {trabajos ? "" : op?.conClip ? "Sale con la foto y el clip del instante." : "Sale con la foto del evento."}
                    </span>
                    {trabajos ? (
                        <button type="button" onClick={onCerrar} className="h-9 px-4 rounded-[6px] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] text-white text-[13px] font-bold">Listo</button>
                    ) : (
                        <>
                            <button type="button" onClick={onCerrar} className="h-9 px-4 rounded-[6px] text-[13px] font-semibold text-foreground/80 hover:text-foreground hover:bg-muted">Cancelar</button>
                            <button type="button" onClick={enviar} disabled={!disponible || !elegidos.size || enviando}
                                className="h-9 px-4 inline-flex items-center gap-2 whitespace-nowrap rounded-[6px] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] disabled:opacity-40 disabled:pointer-events-none text-white text-[13px] font-bold">
                                {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                Enviar{elegidos.size ? ` a ${elegidos.size}` : ""}
                            </button>
                        </>
                    )}
                </div>
            </motion.aside>
        </div>
    );
}
