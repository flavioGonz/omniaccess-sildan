"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Send, Settings2, X, Check, Plus, Loader2, AlertTriangle, MessageCircle, Search, Film } from "lucide-react";
import { cn } from "@/lib/utils";
import { buscarDestinatariosClip, enviarClipPorWhatsApp, type DestinatarioClip, type ResultadoEnvioClip } from "@/app/actions/clips";
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

type Fase = { tipo: "eligiendo" } | { tipo: "armando"; desde: number } | { tipo: "listo"; r: ResultadoEnvioClip };

export function DescargaClip({ instante, ventana, href, onClose, deviceId, camara, matricula }: {
    instante: number;
    ventana: VentanaClip;
    href: (antes: number, despues: number) => string;
    onClose: () => void;
    /** Con cámara se ofrece "Enviar por WhatsApp"; sin ella, sólo descargar. */
    deviceId?: string | null;
    camara?: string | null;
    matricula?: string | null;
}) {
    const [antes, setAntes] = useState(ventana.antes);
    const [despues, setDespues] = useState(ventana.despues);
    const a = acotar(antes, 0, ventana.topes.antesMax), d = acotar(despues, ventana.topes.despuesMin, ventana.topes.despuesMax);
    const cambiado = a !== ventana.antes || d !== ventana.despues;

    const [enviando, setEnviando] = useState(false); // panel de envío abierto
    const [fase, setFase] = useState<Fase>({ tipo: "eligiendo" });
    const ocupado = fase.tipo === "armando";

    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) { e.stopPropagation(); onClose(); } };
        window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
    }, [onClose, ocupado]);

    const largoEnvio = Math.min(a + d, ENVIO_MAX_SEG);
    const recortado = enviando && a + d > ENVIO_MAX_SEG;

    return (
        <div className="absolute inset-0 z-[60] bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={(e) => { e.stopPropagation(); if (!ocupado) onClose(); }}>
            <motion.div layout className="w-full max-w-md rounded-2xl bg-neutral-900/95 ring-1 ring-white/10 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3 p-5 pb-4">
                    <span className={cn("w-10 h-10 rounded-xl grid place-items-center ring-1 shrink-0", enviando ? "bg-emerald-500/20 ring-emerald-400/30" : "bg-sky-500/20 ring-sky-400/30")}>
                        {enviando ? <MessageCircle size={18} className="text-emerald-300" /> : <Download size={18} className="text-sky-300" />}
                    </span>
                    <div className="min-w-0">
                        <div className="text-[15px] font-extrabold text-white leading-tight">{enviando ? "Enviar clip por WhatsApp" : "Descargar clip"}</div>
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
                                {recortado && <span className="block mt-1 text-amber-300">Por WhatsApp va un máximo de {ENVIO_MAX_SEG} s: el grabador entrega el video a tiempo real y esperarías más de un minuto.</span>}
                            </p>
                        </div>
                        <AnimatePresence initial={false}>
                            {enviando && deviceId && (
                                <motion.div key="envio" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                    <PanelDestinatarios instante={instante} camara={camara} matricula={matricula} segundos={largoEnvio} onVolver={() => setEnviando(false)}
                                        onEnviar={async (telefonos) => {
                                            setFase({ tipo: "armando", desde: Date.now() });
                                            const proporcion = a + d > ENVIO_MAX_SEG ? ENVIO_MAX_SEG / (a + d) : 1;
                                            const r = await enviarClipPorWhatsApp({ deviceId, instante, antes: Math.floor(a * proporcion), despues: largoEnvio - Math.floor(a * proporcion), telefonos, matricula }).catch((e) => ({ ok: false as const, error: String(e?.message || e) }));
                                            setFase({ tipo: "listo", r });
                                        }} />
                                </motion.div>
                            )}
                        </AnimatePresence>
                        {!enviando && (
                            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10 bg-black/30">
                                {deviceId && (
                                    <button onClick={() => setEnviando(true)} className="h-9 px-3.5 mr-auto inline-flex items-center gap-2 rounded-xl text-[12.5px] font-bold text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 transition">
                                        <MessageCircle size={15} /> Enviar por WhatsApp
                                    </button>
                                )}
                                <button onClick={onClose} className="h-9 px-4 rounded-xl text-[12.5px] font-bold text-white/70 hover:text-white hover:bg-white/10 transition">Cancelar</button>
                                <a href={href(a, d)} download onClick={onClose}
                                    className="h-9 px-4 inline-flex items-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-[12.5px] font-extrabold shadow-lg active:scale-95 transition"><Download size={15} /> Descargar {a + d} s</a>
                            </div>
                        )}
                    </>
                )}

                {fase.tipo === "armando" && <EnCurso desde={fase.desde} segundos={largoEnvio} />}
                {fase.tipo === "listo" && <Resultado r={fase.r} onOtro={() => setFase({ tipo: "eligiendo" })} onCerrar={onClose} />}
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
        t.current = setTimeout(() => { buscarDestinatariosClip(q).then((r) => setHallados(r.usuarios.filter((u) => !extra.some((x) => x.telefono === u.telefono)))).catch(() => setHallados([])); }, 250);
    }, [q, extra]);

    const todos = useMemo(() => [...avisos, ...extra], [avisos, extra]);
    const alternar = (tel: string) => setElegidos((s) => { const n = new Set(s); n.has(tel) ? n.delete(tel) : n.add(tel); return n; });
    const sumar = (u: DestinatarioClip) => { setExtra((x) => [...x, u]); setElegidos((s) => new Set(s).add(u.telefono)); setQ(""); setHallados([]); };
    const n = [...elegidos].filter((tel) => todos.some((x) => x.telefono === tel)).length;
    const leyenda = [`🎥 ${camara || "Cámara"}`, `${fechaCorta(instante)} ${horaSeg(instante)}`, matricula ? `Matrícula ${matricula}` : null].filter(Boolean).join(" · ");

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
function EnCurso({ desde, segundos }: { desde: number; segundos: number }) {
    const [ahora, setAhora] = useState(Date.now());
    useEffect(() => { const i = setInterval(() => setAhora(Date.now()), 250); return () => clearInterval(i); }, []);
    const pasaron = (ahora - desde) / 1000;
    const total = estimadoSeg(segundos);
    const p = Math.min(0.95, pasaron / total);
    return (
        <div className="px-5 pb-6 pt-2">
            <div className="flex items-center gap-3">
                <Loader2 size={18} className="animate-spin text-emerald-300 shrink-0" />
                <div className="text-[14px] font-bold text-white">{pasaron < segundos ? "Armando el clip desde la grabación…" : "Enviando por WhatsApp…"}</div>
                <div className="ml-auto text-[12px] text-white/50 tabular-nums">{Math.floor(pasaron)} s</div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden"><motion.div className="h-full bg-emerald-400" animate={{ width: `${p * 100}%` }} transition={{ ease: "linear", duration: 0.25 }} /></div>
            <p className="mt-2 text-[11px] text-white/45">El grabador entrega el video a tiempo real: {segundos} s de clip tardan algo más que eso. No cierres este cuadro.</p>
        </div>
    );
}

function Resultado({ r, onOtro, onCerrar }: { r: ResultadoEnvioClip; onOtro: () => void; onCerrar: () => void }) {
    const hora = horaSeg(Date.now());
    const todosOk = r.ok && r.enviados.every((e) => e.ok);
    return (
        <div className="px-5 pb-5 pt-1 space-y-3">
            <div className={cn("rounded-xl px-4 py-3 flex items-start gap-3 ring-1", todosOk ? "bg-emerald-500/15 ring-emerald-400/30" : "bg-amber-500/10 ring-amber-400/30")}>
                {todosOk ? <Check size={18} className="text-emerald-300 shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="text-amber-300 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                    <div className="text-[14px] font-bold text-white">{!r.ok ? "No se envió" : todosOk ? `Enviado a ${r.enviados.map((e) => e.nombre).join(", ")}` : "Se envió en parte"}</div>
                    <div className="text-[12px] text-white/60">{!r.ok ? r.error : `${r.segundos} s desde ${r.fuente === "nvr" ? "la grabación del NVR" : "la grabación local"} · ${hora}`}</div>
                </div>
            </div>
            {r.ok && !todosOk && (
                <div className="rounded-xl ring-1 ring-white/10 divide-y divide-white/5">
                    {r.enviados.map((e) => (
                        <div key={e.telefono} className="px-3 py-2 flex items-center gap-2 text-[12.5px]">
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
