"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Send, Settings2, X, Check, Plus, Loader2, AlertTriangle, MessageCircle, Search, Film, Sparkles, PenLine, Share2, Link2, Copy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { buscarDestinatariosClip, enviarClipPorWhatsApp, destinosTelegramClip, enviarClipPorTelegram, type DestinatarioClip, type ResultadoEnvioClip, type DestinoTelegram } from "@/app/actions/clips";
import { ENVIO_MAX_SEG } from "@/lib/clips";

/**
 * El diálogo previo a bajar un clip, y ahora también a mandarlo por WhatsApp.
 *
 * Antes el botón bajaba sin decir nada un clip "de 60 s" (según su tooltip) que en realidad
 * medía lo que dijera Ajustes. Este diálogo dice exactamente qué va a traer —cuántos segundos
 * antes y después de qué instante— y deja cambiarlo para ESTE clip. Con la misma ventana se
 * puede mandar por WhatsApp a los destinatarios de avisos o a un usuario del barrio: el
 * operador ve el estado real (armando, enviando, a quién llegó) y queda en Despachos.
 *
 * Vivía adentro del visor de intrusión; salió acá para que la ficha del evento (historial,
 * monitor LPR) use el mismo diálogo en vez de un botón que bajaba sin preguntar.
 *
 * Es oscuro a propósito: se abre encima del video, como el resto del visor.
 */

export type VentanaClip = { antes: number; despues: number; topes: { antesMax: number; despuesMax: number; despuesMin: number } };

const horaSeg = (ms: number) => new Date(ms).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fechaCorta = (ms: number) => new Date(ms).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" });
const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
/** Lo que tarda en salir un clip: el NVR lo entrega a tiempo real, más la espera del tramo y el envío. */
const estimadoSeg = (seg: number) => seg + 6;

type Canal = "whatsapp" | "telegram";
type Listo = { ok: true; enviados: { nombre: string; ok: boolean; error?: string; telefono?: string; chatId?: string }[]; segundos: number; fuente: string } | { ok: false; error: string };
type Fase = { tipo: "eligiendo" } | { tipo: "armando"; desde: number; descarga?: boolean; canal?: Canal; compartir?: boolean } | { tipo: "listo"; r: Listo; canal?: Canal }
    | { tipo: "compartir"; url: string; nombre: string };

/** Azul de Telegram, para distinguirlo del verde de WhatsApp. */
const TG = "#2AABEE";
function IconoTelegram({ size = 16, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="currentColor" d="M21.4 4.2 2.9 11.4c-1.3.5-1.3 1.2-.2 1.6l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.2Zm-3.5 3.3-8.4 7.6-.3 3.4-1.6-5 9.9-6.3c.5-.3.9-.1.4.3Z" />
        </svg>
    );
}

export function DescargaClip({ instante: instanteAlAbrir, ventana, href, onClose, deviceId, camara, matricula }: {
    instante: number;
    ventana: VentanaClip;
    /** URL de descarga para ESTE instante (el fijado al abrir) y la ventana elegida. */
    href: (antes: number, despues: number, instante: number) => string;
    onClose: () => void;
    /** Con cámara se ofrece "Enviar por WhatsApp"; sin ella, sólo descargar. */
    deviceId?: string | null;
    camara?: string | null;
    matricula?: string | null;
}) {
    // El instante queda FIJO al abrir: el video sigue corriendo detrás y su posición cambia; lo que
    // se baja o se manda tiene que ser lo que el diálogo dice, no lo que el video muestre después.
    const [instante] = useState(instanteAlAbrir);
    const [antes, setAntes] = useState(ventana.antes);
    const [despues, setDespues] = useState(ventana.despues);
    const a = acotar(antes, 0, ventana.topes.antesMax), d = acotar(despues, ventana.topes.despuesMin, ventana.topes.despuesMax);
    const cambiado = a !== ventana.antes || d !== ventana.despues;

    const [canal, setCanal] = useState<Canal | null>(null); // panel de envío abierto
    const enviando = canal !== null;
    const [fase, setFase] = useState<Fase>({ tipo: "eligiendo" });
    const ocupado = fase.tipo === "armando";

    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) { e.stopPropagation(); onClose(); } };
        window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
    }, [onClose, ocupado]);

    /* La descripción va en la intro animada del clip (y en el mensaje de WhatsApp). */
    const [descripcion, setDescripcion] = useState("");
    const [conIntro, setConIntro] = useState(true);
    const largoEnvio = Math.min(a + d, ENVIO_MAX_SEG);
    /* Descargar con intro y logo: se arma en el servidor (como el de WhatsApp) y después se baja.
       Sin cámara, sin intro o más largo que el tope: la descarga directa de siempre. */
    const descargar = async (compartir = false) => {
        if (!compartir && (!deviceId || !conIntro || a + d > ENVIO_MAX_SEG)) { window.location.href = href(a, d, instante); onClose(); return; }
        setFase({ tipo: "armando", desde: Date.now(), descarga: true, compartir });
        const r: any = await fetch("/api/clip/instante", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId, instante, antes: a, despues: d, para: "envio", matricula, descripcion: descripcion.trim() || null, intro: true }) })
            .then((x) => x.json()).catch((e) => ({ ok: false, motivo: String(e?.message || e) }));
        if (r?.ok && r.url && compartir) { setFase({ tipo: "compartir", url: r.url, nombre: r.nombre || "clip.mp4" }); return; }
        if (r?.ok && r.url) {
            const el = document.createElement("a"); el.href = `${r.url}?dl=1`; el.download = r.nombre || "clip.mp4";
            document.body.appendChild(el); el.click(); el.remove();
            onClose();
        } else setFase({ tipo: "listo", r: { ok: false, error: "No se pudo armar el clip: " + (r?.motivo || "sin respuesta") } });
    };
    const recortado = enviando && a + d > ENVIO_MAX_SEG;

    return (
        <div className="absolute inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={(e) => { e.stopPropagation(); if (!ocupado) onClose(); }}>
            <motion.div layout className="w-full max-w-lg rounded-2xl bg-neutral-900/95 ring-1 ring-white/10 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3 p-5 pb-4">
                    <span className={cn("w-10 h-10 rounded-xl grid place-items-center ring-1 shrink-0", canal === "whatsapp" ? "bg-emerald-500/20 ring-emerald-400/30" : canal === "telegram" ? "bg-[#2AABEE]/20 ring-[#2AABEE]/40" : fase.tipo === "compartir" ? "bg-violet-500/20 ring-violet-400/30" : "bg-sky-500/20 ring-sky-400/30")}>
                        {canal === "whatsapp" ? <MessageCircle size={18} className="text-emerald-300" /> : canal === "telegram" ? <IconoTelegram size={18} className="text-[#2AABEE]" /> : fase.tipo === "compartir" ? <Share2 size={18} className="text-violet-300" /> : <Download size={18} className="text-sky-300" />}
                    </span>
                    <div className="min-w-0">
                        <div className="text-[15px] font-extrabold text-white leading-tight">{canal === "whatsapp" ? "Enviar clip por WhatsApp" : canal === "telegram" ? "Enviar clip por Telegram" : fase.tipo === "compartir" ? "Compartir clip" : "Exportar clip"}</div>
                        <div className="text-[12px] text-white/60 mt-0.5">{camara ? <>{camara} · </> : null}alrededor de las <span className="text-white font-bold tabular-nums">{horaSeg(instante)}</span> del {fechaCorta(instante)}</div>
                    </div>
                    <button onClick={onClose} disabled={ocupado} className="ml-auto w-8 h-8 grid place-items-center rounded-full hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30"><X size={16} /></button>
                </div>

                {fase.tipo === "eligiendo" && (
                    <>
                        <div className="px-5 pb-4 grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5">Segundos antes</span>
                                <input type="number" min={0} max={ventana.topes.antesMax} value={antes} onChange={(e) => setAntes(Number(e.target.value))}
                                    className="w-full h-10 rounded-xl bg-white/10 ring-1 ring-white/10 focus:ring-sky-400/60 px-3 text-[16px] font-extrabold tabular-nums text-white outline-none" />
                            </label>
                            <label className="block">
                                <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5">Segundos después</span>
                                <input type="number" min={ventana.topes.despuesMin} max={ventana.topes.despuesMax} value={despues} onChange={(e) => setDespues(Number(e.target.value))}
                                    className="w-full h-10 rounded-xl bg-white/10 ring-1 ring-white/10 focus:ring-sky-400/60 px-3 text-[16px] font-extrabold tabular-nums text-white outline-none" />
                            </label>
                        </div>
                        <div className="mx-5 mb-4 rounded-xl bg-white/[0.06] ring-1 ring-white/10 px-3.5 py-3 flex items-start gap-2.5">
                            <Settings2 size={14} className="text-white/45 shrink-0 mt-0.5" />
                            <p className="text-[11.5px] text-white/65 leading-snug">
                                El clip irá de <span className="text-white font-bold tabular-nums">{horaSeg(instante - a * 1000)}</span> a <span className="text-white font-bold tabular-nums">{horaSeg(instante + d * 1000)}</span> ({a + d} s).
                                {" "}Lo configurado en <span className="text-white/85 font-semibold">Ajustes → Video del evento</span> es {ventana.antes} s antes y {ventana.despues} s después
                                {cambiado ? "; el cambio vale sólo para este clip." : "."}
                                {recortado && <span className="block mt-1 text-amber-300">Por {canal === "telegram" ? "Telegram" : "WhatsApp"} va un máximo de {ENVIO_MAX_SEG} s: el grabador entrega el video a tiempo real y esperarías más de un minuto.</span>}
                            </p>
                        </div>
                        {deviceId && (
                            <div className="mx-5 mb-4 rounded-xl bg-white/[0.06] ring-1 ring-white/10 p-3.5 space-y-2.5">
                                <div className="flex items-center gap-2">
                                    <Sparkles size={14} className="text-amber-300 shrink-0" />
                                    <span className="text-[12.5px] font-bold text-white">Intro animada</span>
                                    <span className="text-[11px] text-white/50 truncate">logo, descripción y datos antes del video</span>
                                    <button type="button" role="switch" aria-checked={conIntro} onClick={() => setConIntro((v) => !v)}
                                        className={cn("ml-auto relative h-5 w-9 rounded-full transition-colors shrink-0", conIntro ? "bg-amber-400" : "bg-white/20")}>
                                        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", conIntro ? "left-[18px]" : "left-0.5")} />
                                    </button>
                                </div>
                                {conIntro && (
                                    <label className="block">
                                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5"><PenLine size={11} /> Descripción del clip <span className="ml-auto normal-case tracking-normal font-medium tabular-nums">{descripcion.length}/140</span></span>
                                        <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value.slice(0, 140))} rows={2}
                                            placeholder="Qué se ve. Ej.: Ingreso no autorizado por el portón norte, 2 personas a pie"
                                            className="w-full rounded-xl bg-black/30 ring-1 ring-white/10 focus:ring-amber-300/60 px-3 py-2 text-[13px] text-white placeholder:text-white/30 outline-none resize-none" />
                                    </label>
                                )}
                                {conIntro && a + d > ENVIO_MAX_SEG && !enviando && <p className="text-[11px] text-amber-300">La intro se arma en clips de hasta {ENVIO_MAX_SEG} s; con {a + d} s se baja directo, sin intro.</p>}
                            </div>
                        )}
                        <AnimatePresence initial={false}>
                            {canal === "telegram" && deviceId && (
                                <motion.div key="envio-tg" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                    <PanelTelegram instante={instante} camara={camara} matricula={matricula} segundos={largoEnvio} onVolver={() => setCanal(null)}
                                        onEnviar={async (chats) => {
                                            setFase({ tipo: "armando", desde: Date.now(), canal: "telegram" });
                                            const proporcion = a + d > ENVIO_MAX_SEG ? ENVIO_MAX_SEG / (a + d) : 1;
                                            const r = await enviarClipPorTelegram({ deviceId, instante, antes: Math.floor(a * proporcion), despues: largoEnvio - Math.floor(a * proporcion), chats, matricula, descripcion: descripcion.trim() || null, intro: conIntro }).catch((e) => ({ ok: false as const, error: String(e?.message || e) }));
                                            setFase({ tipo: "listo", r, canal: "telegram" });
                                        }} />
                                </motion.div>
                            )}
                            {canal === "whatsapp" && deviceId && (
                                <motion.div key="envio" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                    <PanelDestinatarios instante={instante} camara={camara} matricula={matricula} segundos={largoEnvio} onVolver={() => setCanal(null)}
                                        onEnviar={async (telefonos) => {
                                            setFase({ tipo: "armando", desde: Date.now(), canal: "whatsapp" });
                                            const proporcion = a + d > ENVIO_MAX_SEG ? ENVIO_MAX_SEG / (a + d) : 1;
                                            const r = await enviarClipPorWhatsApp({ deviceId, instante, antes: Math.floor(a * proporcion), despues: largoEnvio - Math.floor(a * proporcion), telefonos, matricula, descripcion: descripcion.trim() || null, intro: conIntro }).catch((e) => ({ ok: false as const, error: String(e?.message || e) }));
                                            setFase({ tipo: "listo", r, canal: "whatsapp" });
                                        }} />
                                </motion.div>
                            )}
                        </AnimatePresence>
                        {!enviando && (
                            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10 bg-black/30">
                                {deviceId && (
                                    <div className="mr-auto flex items-center gap-1">
                                        <button onClick={() => setCanal("whatsapp")} title="Mandar el clip por WhatsApp a destinatarios de avisos o usuarios del barrio"
                                            className="h-9 w-9 grid place-items-center rounded-xl text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 transition"><MessageCircle size={17} /></button>
                                        <button onClick={() => setCanal("telegram")} title="Mandar el clip al grupo de alertas de Telegram o a los chats del bot"
                                            className="h-9 w-9 grid place-items-center rounded-xl text-[#2AABEE] hover:bg-[#2AABEE]/10 transition"><IconoTelegram size={17} /></button>
                                        <button onClick={() => descargar(true)} disabled={a + d > ENVIO_MAX_SEG} title={a + d > ENVIO_MAX_SEG ? `Para compartir, hasta ${ENVIO_MAX_SEG} s` : "Armar el clip y compartirlo desde el equipo (apps del celular, enlace o correo)"}
                                            className="h-9 w-9 grid place-items-center rounded-xl text-violet-300 hover:text-violet-200 hover:bg-violet-500/10 disabled:opacity-30 transition"><Share2 size={16} /></button>
                                    </div>
                                )}
                                <button onClick={onClose} className="h-9 px-4 rounded-xl text-[12.5px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition">Cancelar</button>
                                <button onClick={() => descargar()}
                                    className="h-9 px-4 inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-[12.5px] font-extrabold shadow-lg active:scale-95 transition"><Download size={15} /> Descargar {a + d} s</button>
                            </div>
                        )}
                    </>
                )}

                {fase.tipo === "armando" && <EnCurso desde={fase.desde} segundos={fase.descarga ? a + d : largoEnvio} descarga={fase.descarga} intro={conIntro} canal={fase.canal} compartir={fase.compartir} />}
                {fase.tipo === "listo" && <Resultado r={fase.r} canal={fase.canal} onOtro={() => setFase({ tipo: "eligiendo" })} onCerrar={onClose} />}
                {fase.tipo === "compartir" && <PanelCompartir url={fase.url} nombre={fase.nombre} camara={camara} instante={instante} descripcion={descripcion} onVolver={() => setFase({ tipo: "eligiendo" })} onCerrar={onClose} />}
            </motion.div>
        </div>
    );
}

function PanelDestinatarios({ instante, camara, matricula, segundos, onEnviar, onVolver }: { instante: number; camara?: string | null; matricula?: string | null; segundos: number; onEnviar: (telefonos: string[]) => void; onVolver: () => void }) {
    const [avisos, setAvisos] = useState<DestinatarioClip[]>([]);
    const [extra, setExtra] = useState<DestinatarioClip[]>([]);
    const [elegidos, setElegidos] = useState<Set<string>>(new Set());
    const [q, setQ] = useState("");
    const [hallados, setHallados] = useState<DestinatarioClip[]>([]);
    const [buscado, setBuscado] = useState("");
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState("");
    const t = useRef<any>(null);

    useEffect(() => {
        buscarDestinatariosClip("").then((r) => { setAvisos(r.avisos); setElegidos(new Set(r.avisos.filter((x) => x.habilitado).map((x) => x.telefono))); })
            .catch((e) => setError(String(e?.message || e))).finally(() => setCargando(false));
    }, []);
    useEffect(() => {
        clearTimeout(t.current);
        if (q.trim().length < 2) { setHallados([]); return; }
        t.current = setTimeout(() => { buscarDestinatariosClip(q).then((r) => { setHallados(r.usuarios.filter((u) => !extra.some((x) => x.telefono === u.telefono))); setBuscado(q); }).catch(() => setHallados([])); }, 250);
    }, [q, extra]);

    const todos = useMemo(() => [...avisos, ...extra], [avisos, extra]);
    const alternar = (tel: string) => setElegidos((s) => { const n = new Set(s); n.has(tel) ? n.delete(tel) : n.add(tel); return n; });
    const sumar = (u: DestinatarioClip) => { setExtra((x) => [...x, u]); setElegidos((s) => new Set(s).add(u.telefono)); setQ(""); setHallados([]); };
    const n = [...elegidos].filter((tel) => todos.some((x) => x.telefono === tel)).length;
    const leyenda = [`${camara || "Cámara"}`, `${fechaCorta(instante)} ${horaSeg(instante)}`, matricula ? `Matrícula ${matricula}` : null].filter(Boolean).join(" · ");

    return (
        <div className="px-5 pb-4 space-y-3">
            <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5">Para</div>
                <div className="rounded-xl ring-1 ring-white/10 bg-white/[0.04] divide-y divide-white/5 max-h-[168px] overflow-y-auto">
                    {cargando && <div className="px-3 py-3 text-[12px] text-white/50 inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando destinatarios…</div>}
                    {!cargando && error && <div className="px-3 py-3 text-[12px] text-red-300">{error}</div>}
                    {!cargando && !error && todos.length === 0 && <div className="px-3 py-3 text-[12px] text-white/50">No hay destinatarios de WhatsApp en el Centro de Notificaciones. Buscá un usuario abajo.</div>}
                    {todos.map((x) => (
                        <button key={x.telefono} onClick={() => alternar(x.telefono)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.05]">
                            <span className={cn("w-[18px] h-[18px] rounded-[5px] grid place-items-center ring-1 shrink-0", elegidos.has(x.telefono) ? "bg-emerald-500 ring-emerald-400" : "ring-white/25")}>{elegidos.has(x.telefono) && <Check size={12} className="text-white" />}</span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-semibold text-white truncate">{x.nombre}</span>
                                <span className="block text-[11px] text-white/50 truncate tabular-nums">{x.detalle} · +{x.telefono}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sumar un usuario: nombre, lote o teléfono"
                    className="w-full h-9 rounded-xl bg-white/10 ring-1 ring-white/10 focus:ring-emerald-400/50 pl-9 pr-3 text-[13px] text-white placeholder:text-white/35 outline-none" />
                {hallados.length === 0 && q.trim().length >= 2 && buscado === q && (
                    <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl bg-neutral-800 ring-1 ring-white/10 px-3 py-2.5 text-[12px] text-white/55">Ningún usuario con teléfono coincide con «{q}». El teléfono se carga en la ficha del usuario.</div>
                )}
                {hallados.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl bg-neutral-800 ring-1 ring-white/10 shadow-2xl overflow-hidden">
                        {hallados.map((u) => (
                            <button key={u.telefono} onClick={() => sumar(u)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.06]">
                                <Plus size={14} className="text-emerald-300 shrink-0" />
                                <span className="min-w-0"><span className="block text-[13px] font-semibold text-white truncate">{u.nombre}</span><span className="block text-[11px] text-white/50 truncate tabular-nums">{u.detalle} · +{u.telefono}</span></span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-[11.5px] text-white/60 flex items-start gap-2">
                <Film size={13} className="shrink-0 mt-0.5 text-white/40" /> <span><span className="text-white/80">{leyenda}</span> · {segundos} s</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={onVolver} className="h-9 px-4 mr-auto rounded-xl text-[12.5px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition">Volver</button>
                <button disabled={n === 0} onClick={() => onEnviar([...elegidos].filter((tel) => todos.some((x) => x.telefono === tel)))}
                    className="h-9 px-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:pointer-events-none text-white text-[12.5px] font-extrabold active:scale-95 transition">
                    <Send size={14} /> Enviar a {n || "…"}
                </button>
            </div>
        </div>
    );
}

/** Mientras se arma y se manda. La barra se basa en el tiempo esperado (el NVR va a tiempo real); el texto no inventa avances. */
function EnCurso({ desde, segundos, descarga, intro, canal, compartir }: { desde: number; segundos: number; descarga?: boolean; intro?: boolean; canal?: Canal; compartir?: boolean }) {
    const [ahora, setAhora] = useState(Date.now());
    useEffect(() => { const i = setInterval(() => setAhora(Date.now()), 250); return () => clearInterval(i); }, []);
    const pasaron = (ahora - desde) / 1000;
    const total = estimadoSeg(segundos) + (intro ? 8 : 0);
    const p = Math.min(0.95, pasaron / total);
    return (
        <div className="px-5 pb-6 pt-2">
            <div className="flex items-center gap-3">
                <Loader2 size={18} className="animate-spin text-emerald-300 shrink-0" />
                <div className="text-[14px] font-bold text-white">{pasaron < segundos ? "Armando el clip desde la grabación…" : intro && pasaron < segundos + 8 ? "Componiendo la intro animada…" : compartir ? "Preparando para compartir…" : descarga ? "Preparando la descarga…" : canal === "telegram" ? "Enviando por Telegram…" : "Enviando por WhatsApp…"}</div>
                <div className="ml-auto text-[12px] text-white/50 tabular-nums">{Math.floor(pasaron)} s</div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden"><motion.div className="h-full bg-emerald-400" animate={{ width: `${p * 100}%` }} transition={{ ease: "linear", duration: 0.25 }} /></div>
            <p className="mt-2 text-[11px] text-white/45">El grabador entrega el video a tiempo real: {segundos} s de clip tardan algo más que eso. No cierres este cuadro.</p>
        </div>
    );
}

function Resultado({ r, canal, onOtro, onCerrar }: { r: Listo; canal?: Canal; onOtro: () => void; onCerrar: () => void }) {
    const hora = horaSeg(Date.now());
    const todosOk = r.ok && r.enviados.every((e) => e.ok);
    return (
        <div className="px-5 pb-5 pt-1 space-y-3">
            <div className={cn("rounded-xl px-4 py-3 flex items-start gap-3 ring-1", todosOk ? "bg-emerald-500/15 ring-emerald-400/30" : "bg-amber-500/10 ring-amber-400/30")}>
                {todosOk ? <Check size={18} className="text-emerald-300 shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="text-amber-300 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                    <div className="text-[14px] font-bold text-white">{!r.ok ? "No se envió" : todosOk ? `Enviado por ${canal === "telegram" ? "Telegram" : "WhatsApp"} a ${r.enviados.map((e) => e.nombre).join(", ")}` : "Se envió en parte"}</div>
                    <div className="text-[12px] text-white/60">{!r.ok ? r.error : `${r.segundos} s desde ${r.fuente === "nvr" ? "la grabación del NVR" : "la grabación local"} · ${hora}`}</div>
                </div>
            </div>
            {r.ok && !todosOk && (
                <div className="rounded-xl ring-1 ring-white/10 divide-y divide-white/5">
                    {r.enviados.map((e) => (
                        <div key={e.telefono || e.chatId || e.nombre} className="px-3 py-2 flex items-center gap-2 text-[12.5px]">
                            {e.ok ? <Check size={13} className="text-emerald-300" /> : <X size={13} className="text-red-300" />}
                            <span className="text-white font-semibold">{e.nombre}</span>
                            {!e.ok && <span className="text-white/50 truncate">· {e.error}</span>}
                        </div>
                    ))}
                </div>
            )}
            <div className="flex items-center justify-end gap-2">
                <button onClick={onOtro} className="h-9 px-4 rounded-xl text-[12.5px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition">{r.ok ? "Enviar a otro" : "Volver"}</button>
                <button onClick={onCerrar} className="h-9 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-[12.5px] font-extrabold">Listo</button>
            </div>
        </div>
    );
}

function PanelTelegram({ instante, camara, matricula, segundos, onEnviar, onVolver }: { instante: number; camara?: string | null; matricula?: string | null; segundos: number; onEnviar: (chats: string[]) => void; onVolver: () => void }) {
    const [destinos, setDestinos] = useState<DestinoTelegram[]>([]);
    const [elegidos, setElegidos] = useState<Set<string>>(new Set());
    const [configurado, setConfigurado] = useState(true);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState("");
    useEffect(() => {
        destinosTelegramClip().then((r) => { setConfigurado(r.configurado); setDestinos(r.destinos); setElegidos(new Set(r.destinos.filter((x) => x.principal).map((x) => x.chatId))); })
            .catch((e) => setError(String(e?.message || e))).finally(() => setCargando(false));
    }, []);
    const alternar = (id: string) => setElegidos((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const leyenda = [`${camara || "Cámara"}`, `${fechaCorta(instante)} ${horaSeg(instante)}`, matricula ? `Matrícula ${matricula}` : null].filter(Boolean).join(" · ");
    return (
        <div className="px-5 pb-4 space-y-3">
            <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50 mb-1.5">Para</div>
                <div className="rounded-xl ring-1 ring-white/10 bg-white/[0.04] divide-y divide-white/5 max-h-[168px] overflow-y-auto">
                    {cargando && <div className="px-3 py-3 text-[12px] text-white/50 inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando chats del bot…</div>}
                    {!cargando && error && <div className="px-3 py-3 text-[12px] text-red-300">{error}</div>}
                    {!cargando && !error && !configurado && <div className="px-3 py-3 text-[12px] text-white/55">Telegram no está configurado. Cargá el token del bot y el grupo en Notificaciones › Canales.</div>}
                    {destinos.map((x) => (
                        <button key={x.chatId} onClick={() => alternar(x.chatId)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.05]">
                            <span className={cn("w-[18px] h-[18px] rounded-[5px] grid place-items-center ring-1 shrink-0", elegidos.has(x.chatId) ? "ring-[#2AABEE]" : "ring-white/25")} style={elegidos.has(x.chatId) ? { background: TG } : undefined}>{elegidos.has(x.chatId) && <Check size={12} className="text-white" />}</span>
                            <span className="w-7 h-7 rounded-full grid place-items-center shrink-0" style={{ background: `${TG}26`, color: TG }}>{x.principal ? <Users size={14} /> : <IconoTelegram size={14} />}</span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-semibold text-white truncate">{x.nombre}</span>
                                <span className="block text-[11px] text-white/50 truncate">{x.detalle}</span>
                            </span>
                        </button>
                    ))}
                </div>
                <p className="mt-1.5 text-[11px] text-white/40">Solo los chats autorizados del bot. Para sumar otro, agregá su ID en Notificaciones › Canales (chats extra del bot).</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-[11.5px] text-white/60 flex items-start gap-2">
                <Film size={13} className="shrink-0 mt-0.5 text-white/40" /> <span><span className="text-white/80">{leyenda}</span> · {segundos} s · con intro y marca de agua</span>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={onVolver} className="h-9 px-4 mr-auto rounded-xl text-[12.5px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition">Volver</button>
                <button disabled={elegidos.size === 0} onClick={() => onEnviar([...elegidos])}
                    className="h-9 px-4 inline-flex items-center gap-2 rounded-xl disabled:opacity-40 disabled:pointer-events-none text-white text-[12.5px] font-extrabold active:scale-95 transition hover:brightness-110" style={{ background: TG }}>
                    <IconoTelegram size={14} /> Enviar a {elegidos.size || "…"}
                </button>
            </div>
        </div>
    );
}

/**
 * Compartir: el clip ya armado (con intro y marca) se pasa a la hoja de compartir del equipo
 * (celular o tablet: WhatsApp personal, correo, Drive…), o se copia el enlace. El enlace es
 * temporal: el servidor borra los clips exportados pasado un rato.
 */
function PanelCompartir({ url, nombre, camara, instante, descripcion, onVolver, onCerrar }: { url: string; nombre: string; camara?: string | null; instante: number; descripcion: string; onVolver: () => void; onCerrar: () => void }) {
    const [estado, setEstado] = useState<"" | "copiado" | "compartido" | "error">("");
    const [ocupado, setOcupado] = useState(false);
    const absoluta = typeof window !== "undefined" ? new URL(url, window.location.origin).toString() : url;
    const titulo = descripcion.trim() || `Clip · ${camara || "cámara"} · ${fechaCorta(instante)} ${horaSeg(instante)}`;
    const puedeArchivo = typeof navigator !== "undefined" && typeof (navigator as any).canShare === "function";
    const puedeCompartir = typeof navigator !== "undefined" && typeof (navigator as any).share === "function";
    const compartir = async () => {
        setOcupado(true);
        try {
            if (puedeArchivo) {
                const blob = await fetch(url).then((r) => r.blob());
                const file = new File([blob], nombre, { type: "video/mp4" });
                if ((navigator as any).canShare({ files: [file] })) { await (navigator as any).share({ files: [file], title: titulo, text: titulo }); setEstado("compartido"); return; }
            }
            await (navigator as any).share({ title: titulo, text: titulo, url: absoluta }); setEstado("compartido");
        } catch (e: any) { if (e?.name !== "AbortError") setEstado("error"); }
        finally { setOcupado(false); }
    };
    const copiar = async () => {
        try { await navigator.clipboard.writeText(absoluta); setEstado("copiado"); }
        catch { const t = document.createElement("textarea"); t.value = absoluta; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); setEstado("copiado"); } catch { setEstado("error"); } t.remove(); }
    };
    return (
        <div className="px-5 pb-5 pt-1 space-y-3">
            <div className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-black">
                <video src={url} controls playsInline className="w-full max-h-[240px] bg-black" />
            </div>
            <div className="grid grid-cols-3 gap-2">
                <button onClick={compartir} disabled={!puedeCompartir || ocupado} title={puedeCompartir ? "Abre las apps del equipo para compartir el video" : "Este navegador no permite compartir: usá el enlace o descargalo"}
                    className="h-16 rounded-xl bg-violet-500/15 ring-1 ring-violet-400/30 hover:bg-violet-500/25 disabled:opacity-35 text-violet-200 flex flex-col items-center justify-center gap-1 text-[12px] font-bold transition">
                    {ocupado ? <Loader2 size={17} className="animate-spin" /> : <Share2 size={17} />} Compartir
                </button>
                <button onClick={copiar} className="h-16 rounded-xl bg-white/[0.06] ring-1 ring-white/10 hover:bg-white/10 text-white/85 flex flex-col items-center justify-center gap-1 text-[12px] font-bold transition">
                    {estado === "copiado" ? <Check size={17} className="text-emerald-300" /> : <Link2 size={17} />} {estado === "copiado" ? "Copiado" : "Copiar enlace"}
                </button>
                <a href={`${url}?dl=1`} download={nombre} className="h-16 rounded-xl bg-sky-500/15 ring-1 ring-sky-400/30 hover:bg-sky-500/25 text-sky-200 flex flex-col items-center justify-center gap-1 text-[12px] font-bold transition">
                    <Download size={17} /> Descargar
                </a>
            </div>
            <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-[11.5px] text-white/55 flex items-start gap-2">
                <Copy size={13} className="shrink-0 mt-0.5 text-white/40" />
                <span className="min-w-0"><span className="block truncate text-white/75 tabular-nums">{absoluta}</span>El enlace es temporal: el servidor borra los clips exportados pasado un rato.</span>
            </div>
            {estado === "compartido" && <p className="text-[12px] text-emerald-300 inline-flex items-center gap-1.5"><Check size={13} /> Compartido.</p>}
            {estado === "error" && <p className="text-[12px] text-amber-300 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> No se pudo compartir desde este navegador. Copiá el enlace o descargalo.</p>}
            <div className="flex items-center justify-end gap-2">
                <button onClick={onVolver} className="h-9 px-4 mr-auto rounded-xl text-[12.5px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition">Volver</button>
                <button onClick={onCerrar} className="h-9 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-[12.5px] font-extrabold">Listo</button>
            </div>
        </div>
    );
}
