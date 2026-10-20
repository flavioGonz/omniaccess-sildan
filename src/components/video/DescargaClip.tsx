"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, Send, X, Check, Plus, Loader2, AlertTriangle, MessageCircle, Search, Film, Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { buscarDestinatariosClip, enviarClipPorWhatsApp, type DestinatarioClip, type ResultadoEnvioClip } from "@/app/actions/clips";
import { enviarClipPorTelegram, estadoTelegram, type EstadoTelegram, type ResultadoEnvioTelegram } from "@/app/actions/clips-telegram";
import { ENVIO_MAX_SEG } from "@/lib/clips";

/**
 * Exportar un clip de la grabación: bajarlo o mandarlo por WhatsApp.
 *
 * Era un cuadro centrado encima del video —una ventana más que se abría sobre el visor, que ya
 * es una ventana—, chico y con dos números sueltos. Ahora es un cajón que entra por la derecha
 * del mismo reproductor: el video sigue a la vista a la izquierda (se ve QUÉ se está
 * exportando), y el cajón tiene lugar para lo que importa: el tramo dibujado sobre una regla,
 * atajos de duración, y el destino elegido antes de apretar nada.
 *
 * Lo que no cambió, a propósito:
 *   - El instante queda FIJO al abrir: el video sigue corriendo detrás y lo que se baja o se
 *     manda tiene que ser lo que el cajón dice, no lo que el video muestre después.
 *   - Dice exactamente qué trae (de qué hora a qué hora) y que el cambio vale sólo para este clip.
 *   - Los destinatarios son sólo gente que el sistema ya conoce; el estado del envío es el real.
 *
 * Telegram manda el clip desde el 20/10 (Nico: «poder seleccionar telegram, al igual que
 * compartir»): al grupo de la guardia, a los destinatarios de Telegram del Centro de
 * Notificaciones y al personal vinculado al bot. Lo que sale por WhatsApp o Telegram lleva la
 * intro y el logo de OmniAccess (lib/clip-editado); lo que se descarga, no (es evidencia). Sin bot
 * configurado la opción queda apagada y dice por qué.
 *
 * Se dibuja adentro del contenedor que lo monta (todos lo montan a pantalla completa o sobre el
 * reproductor), así que sirve igual en el visor, en el vivo, en la ficha y en la máquina del tiempo.
 */

export type VentanaClip = { antes: number; despues: number; topes: { antesMax: number; despuesMax: number; despuesMin: number } };

const horaSeg = (ms: number) => new Date(ms).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fechaCorta = (ms: number) => new Date(ms).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" });
const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
/** Lo que tarda en salir un clip: el NVR lo entrega a tiempo real, más la espera del tramo y el envío. */
const estimadoSeg = (seg: number) => seg + EDICION_SEG + 6;
/** Lo que tarda en ponerle la intro y el logo (lib/clip-editado): ~10 s para un minuto de video. */
const EDICION_SEG = 8;
/** «20 s», «1 min 30 s». */
const duracion = (s: number) => { const m = Math.floor(s / 60), r = s % 60; return m ? `${m} min${r ? ` ${r} s` : ""}` : `${r} s`; };

/**
 * Los atajos de duración (segundos antes / después del instante). Se ofrecen sólo los que caben
 * en los topes del grabador; el de Ajustes se agrega aparte, marcado como tal.
 */
const ATAJOS: { antes: number; despues: number }[] = [
    { antes: 5, despues: 5 }, { antes: 10, despues: 10 }, { antes: 15, despues: 30 }, { antes: 30, despues: 60 },
];

type Destino = "bajar" | "whatsapp" | "telegram";
/** El resultado de un envío, igual para los dos canales: el cajón no necesita saber cuál fue para mostrarlo. */
type ResultadoVista =
    | { ok: true; canal: "WhatsApp" | "Telegram"; enviados: { clave: string; nombre: string; ok: boolean; error?: string }[]; segundos: number; fuente: string; editado?: boolean }
    | { ok: false; error: string };
type Fase = { tipo: "eligiendo" } | { tipo: "armando"; desde: number } | { tipo: "listo"; r: ResultadoVista };

export function DescargaClip({ instante: instanteAlAbrir, ventana, href, onClose, deviceId, camara, matricula, poster }: {
    instante: number;
    ventana: VentanaClip;
    /** URL de descarga para ESTE instante (el fijado al abrir) y la ventana elegida. */
    href: (antes: number, despues: number, instante: number) => string;
    onClose: () => void;
    /** Con cámara se ofrece "Enviar por WhatsApp"; sin ella, sólo descargar. */
    deviceId?: string | null;
    camara?: string | null;
    matricula?: string | null;
    /** La foto del evento, para ver en el cajón de qué es el clip. */
    poster?: string | null;
}) {
    const [instante] = useState(instanteAlAbrir);
    const [antes, setAntes] = useState(ventana.antes);
    const [despues, setDespues] = useState(ventana.despues);
    const { antesMax, despuesMax, despuesMin } = ventana.topes;
    const a = acotar(antes, 0, antesMax), d = acotar(despues, despuesMin, despuesMax);
    const cambiado = a !== ventana.antes || d !== ventana.despues;

    const [destino, setDestino] = useState<Destino>("bajar");
    const [fase, setFase] = useState<Fase>({ tipo: "eligiendo" });
    const ocupado = fase.tipo === "armando";
    const [telefonos, setTelefonos] = useState<string[]>([]);
    /*
     * ¿Hay bot de Telegram, y a quién se le puede mandar? Se pregunta al abrir, como WhatsApp: sin
     * bot la opción queda apagada y dice por qué, en vez de dejar elegir y fallar al final.
     */
    const [tg, setTg] = useState<EstadoTelegram | null>(null);
    const [chats, setChats] = useState<string[]>([]);
    const [nota, setNota] = useState("");
    useEffect(() => {
        if (!deviceId) return;
        let vivo = true;
        estadoTelegram().then((e) => { if (vivo) { setTg(e); setChats(e.destinos.filter((x) => x.marcado).map((x) => x.destino)); } })
            .catch(() => { if (vivo) setTg({ ok: false, motivo: "No se pudo consultar Telegram.", destinos: [] }); });
        return () => { vivo = false; };
    }, [deviceId]);
    const tgListo = !!tg?.ok;

    useEffect(() => {
        const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) { e.stopPropagation(); onClose(); } };
        window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
    }, [onClose, ocupado]);

    const largoEnvio = Math.min(a + d, ENVIO_MAX_SEG);
    const recortado = destino !== "bajar" && a + d > ENVIO_MAX_SEG;
    const cuantos = destino === "telegram" ? chats.length : telefonos.length;
    const atajos = useMemo(() => ATAJOS.filter((x) => x.antes <= antesMax && x.despues <= despuesMax && x.despues >= despuesMin), [antesMax, despuesMax, despuesMin]);

    const enviar = async () => {
        if (!deviceId || cuantos === 0) return;
        setFase({ tipo: "armando", desde: Date.now() });
        // Se manda un máximo de ENVIO_MAX_SEG: se recorta parejo de los dos lados para que el instante quede donde estaba.
        const proporcion = a + d > ENVIO_MAX_SEG ? ENVIO_MAX_SEG / (a + d) : 1;
        const antesEnvio = Math.floor(a * proporcion);
        const tramo = { deviceId, instante, antes: antesEnvio, despues: largoEnvio - antesEnvio, matricula };
        const fallo = (e: any) => ({ ok: false as const, error: String(e?.message || e) });
        let r: ResultadoVista;
        if (destino === "telegram") {
            const x: ResultadoEnvioTelegram = await enviarClipPorTelegram({ ...tramo, destinos: chats, nota }).catch(fallo);
            r = x.ok ? { ...x, canal: "Telegram", enviados: x.enviados.map((e) => ({ ...e, clave: e.destino })) } : x;
        } else {
            const x: ResultadoEnvioClip = await enviarClipPorWhatsApp({ ...tramo, telefonos }).catch(fallo);
            r = x.ok ? { ...x, canal: "WhatsApp", enviados: x.enviados.map((e) => ({ ...e, clave: e.telefono })) } : x;
        }
        setFase({ tipo: "listo", r });
    };

    return (
        <div className="absolute inset-0 z-[60]" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <motion.div className="absolute inset-0 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => { if (!ocupado) onClose(); }} />
            <motion.aside role="dialog" aria-label="Exportar clip"
                initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
                className="absolute inset-y-0 right-0 w-full sm:w-[480px] flex flex-col bg-[#0c0e12]/[0.97] backdrop-blur-xl border-l border-white/10 text-white shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.7)]">

                {/* ── Encabezado ── */}
                <div className="shrink-0 flex items-start gap-3 px-6 pt-5 pb-4 border-b border-white/[0.08]">
                    <span className="w-10 h-10 rounded-[10px] grid place-items-center bg-white/[0.07] border border-white/10 shrink-0"><Film size={18} className="text-[var(--accion-en-oscuro)]" /></span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[17px] font-bold leading-tight">Exportar clip</div>
                        <div className="text-[12.5px] text-white/55 mt-0.5 truncate">{camara ? <>{camara} · </> : null}{fechaCorta(instante)}</div>
                    </div>
                    <button type="button" onClick={onClose} disabled={ocupado} aria-label="Cerrar" title="Cerrar  ( Esc )"
                        className="w-8 h-8 grid place-items-center rounded-[6px] text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30"><X size={17} /></button>
                </div>

                {fase.tipo === "eligiendo" && (
                    <>
                        <div className="flex-1 min-h-0 overflow-y-auto">
                            {/* La foto del instante: de qué es el clip. */}
                            {poster && (
                                <div className="relative mx-6 mt-5 aspect-video rounded-[10px] overflow-hidden bg-black border border-white/10">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                    <span className="absolute left-2.5 bottom-2.5 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] bg-black/65 backdrop-blur text-[12px] font-bold tabular-nums"><Clock size={12} /> {horaSeg(instante)}</span>
                                    {matricula && <span className="absolute right-2.5 bottom-2.5 h-7 px-2.5 rounded-[6px] bg-white text-black text-[12.5px] font-bold tabular-nums grid place-items-center tracking-wide">{matricula}</span>}
                                </div>
                            )}

                            {/* ── El tramo ── */}
                            <section className="px-6 pt-5">
                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/45 mb-3">El tramo</div>
                                <ReglaTramo a={a} d={d} antesMax={antesMax} despuesMax={despuesMax} instante={instante} />
                                <div className="mt-4 flex flex-wrap gap-1.5">
                                    {atajos.map((x) => {
                                        const activo = x.antes === a && x.despues === d;
                                        return (
                                            <button key={`${x.antes}-${x.despues}`} type="button" aria-pressed={activo} onClick={() => { setAntes(x.antes); setDespues(x.despues); }}
                                                className={cn("h-8 px-3 rounded-full text-[12px] font-semibold tabular-nums border transition-colors",
                                                    activo ? "bg-white text-black border-white" : "border-white/15 text-white/75 hover:text-white hover:bg-white/[0.06]")}>
                                                {duracion(x.antes + x.despues)}
                                            </button>
                                        );
                                    })}
                                    {!atajos.some((x) => x.antes === ventana.antes && x.despues === ventana.despues) && (
                                        <button type="button" aria-pressed={!cambiado} onClick={() => { setAntes(ventana.antes); setDespues(ventana.despues); }}
                                            className={cn("h-8 px-3 rounded-full text-[12px] font-semibold tabular-nums border transition-colors",
                                                !cambiado ? "bg-white text-black border-white" : "border-white/15 text-white/75 hover:text-white hover:bg-white/[0.06]")}>
                                            Ajustes · {duracion(ventana.antes + ventana.despues)}
                                        </button>
                                    )}
                                </div>
                                <div className="mt-5 space-y-4">
                                    <Deslizador rotulo="Antes del instante" valor={a} min={0} max={antesMax} onChange={setAntes} />
                                    <Deslizador rotulo="Después del instante" valor={d} min={despuesMin} max={despuesMax} onChange={setDespues} />
                                </div>
                                <p className="mt-4 text-[11.5px] text-white/50 leading-snug">
                                    Lo configurado en <span className="text-white/75 font-semibold">Ajustes → Video del evento</span> es {ventana.antes} s antes y {ventana.despues} s después
                                    {cambiado ? "; este cambio vale sólo para este clip." : "."}
                                </p>
                            </section>

                            {/* ── Qué hacer con él ── */}
                            <section className="px-6 pt-6 pb-6">
                                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/45 mb-3">Qué hacer con él</div>
                                <div className="grid grid-cols-3 gap-2">
                                    <OpcionDestino activo={destino === "bajar"} onClick={() => setDestino("bajar")} Icon={Download} titulo="Descargar" detalle="MP4 a esta computadora" />
                                    <OpcionDestino activo={destino === "whatsapp"} onClick={() => setDestino("whatsapp")} Icon={MessageCircle} titulo="WhatsApp"
                                        detalle={deviceId ? `Hasta ${ENVIO_MAX_SEG} s` : "Sin cámara asociada"} apagado={!deviceId} />
                                    <OpcionDestino activo={destino === "telegram"} onClick={() => setDestino("telegram")} Icon={IconoTelegram} titulo="Telegram"
                                        detalle={!deviceId ? "Sin cámara asociada" : !tg ? "Verificando…" : tg.ok ? `Hasta ${ENVIO_MAX_SEG} s` : "No está configurado"}
                                        apagado={!deviceId || !tgListo} motivo={tg && !tg.ok ? tg.motivo : undefined} />
                                </div>

                                {destino === "whatsapp" && deviceId && (
                                    <div className="mt-4">
                                        {recortado && (
                                            <div className="mb-3 rounded-[10px] px-3 py-2.5 text-[11.5px] leading-snug chip-aviso flex items-start gap-2">
                                                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                                <span>Por WhatsApp va un máximo de {ENVIO_MAX_SEG} s (el grabador entrega el video a tiempo real): se mandan {largoEnvio} s alrededor del instante.</span>
                                            </div>
                                        )}
                                        <PanelDestinatarios instante={instante} camara={camara} matricula={matricula} segundos={largoEnvio} onCambio={setTelefonos} />
                                    </div>
                                )}
                                {destino === "telegram" && deviceId && tgListo && tg && (
                                    <div className="mt-4">
                                        {recortado && (
                                            <div className="mb-3 rounded-[10px] px-3 py-2.5 text-[11.5px] leading-snug chip-aviso flex items-start gap-2">
                                                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                                <span>Se manda un máximo de {ENVIO_MAX_SEG} s (el grabador entrega el video a tiempo real): van {largoEnvio} s alrededor del instante.</span>
                                            </div>
                                        )}
                                        <PanelTelegram estado={tg} elegidos={chats} onElegidos={setChats} nota={nota} onNota={setNota} segundos={largoEnvio} matricula={matricula} />
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* ── Pie: la acción ── */}
                        <div className="shrink-0 flex items-center gap-2 px-6 py-4 border-t border-white/[0.08] bg-black/30">
                            <span className="text-[12px] text-white/50 tabular-nums mr-auto">{horaSeg(instante - a * 1000)} → {horaSeg(instante + d * 1000)}</span>
                            <button type="button" onClick={onClose} className="h-9 px-4 rounded-[6px] text-[13px] font-semibold text-white/70 hover:text-white hover:bg-white/10">Cancelar</button>
                            {destino === "bajar" ? (
                                <a href={href(a, d, instante)} download onClick={onClose}
                                    className="h-9 px-4 inline-flex items-center gap-2 whitespace-nowrap rounded-[6px] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] text-white text-[13px] font-bold">
                                    <Download size={15} /> Descargar {duracion(a + d)}
                                </a>
                            ) : (
                                <button type="button" disabled={cuantos === 0 || (destino === "telegram" && !tgListo)} onClick={enviar}
                                    className="h-9 px-4 inline-flex items-center gap-2 whitespace-nowrap rounded-[6px] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] disabled:opacity-40 disabled:pointer-events-none text-white text-[13px] font-bold">
                                    {destino === "telegram" ? <IconoTelegram size={14} /> : <Send size={14} />} {cuantos ? `Enviar a ${cuantos}` : "Elegí a quién"}
                                </button>
                            )}
                        </div>
                    </>
                )}

                {fase.tipo === "armando" && <EnCurso desde={fase.desde} segundos={largoEnvio} canal={destino === "telegram" ? "Telegram" : "WhatsApp"} />}
                {fase.tipo === "listo" && <Resultado r={fase.r} onOtro={() => setFase({ tipo: "eligiendo" })} onCerrar={onClose} />}
            </motion.aside>
        </div>
    );
}

/**
 * El tramo dibujado: la regla va de lo máximo que se puede pedir antes a lo máximo después, con
 * el instante marcado y lo elegido pintado. Se lee de un vistazo cuánto hay a cada lado.
 */
function ReglaTramo({ a, d, antesMax, despuesMax, instante }: { a: number; d: number; antesMax: number; despuesMax: number; instante: number }) {
    // Los dos lados ocupan lo mismo aunque los topes sean distintos: el instante queda al medio,
    // que es donde el operador lo busca. Cada lado se escala contra su propio tope.
    const izq = antesMax ? (a / antesMax) * 50 : 0;
    const der = despuesMax ? (d / despuesMax) * 50 : 0;
    return (
        <div>
            <div className="flex items-end justify-between text-[11px] text-white/45 tabular-nums mb-1.5">
                <span>−{antesMax} s</span>
                <span className="text-white text-[22px] font-bold leading-none tracking-[-0.02em]">{duracion(a + d)}</span>
                <span>+{despuesMax} s</span>
            </div>
            <div className="relative h-10 rounded-[6px] bg-white/[0.05] border border-white/10 overflow-hidden">
                <div className="absolute inset-y-0 bg-[var(--accion-en-oscuro)]/30 border-x-2 border-[var(--accion-en-oscuro)] transition-all"
                    style={{ left: `${50 - izq}%`, right: `${50 - der}%` }} />
                <span className="absolute inset-y-0 left-1/2 w-0.5 -ml-px bg-white" />
            </div>
            <div className="mt-1.5 text-center text-[12px] font-semibold tabular-nums text-white/70">{horaSeg(instante - a * 1000)} → {horaSeg(instante + d * 1000)}</div>
        </div>
    );
}

function Deslizador({ rotulo, valor, min, max, onChange }: { rotulo: string; valor: number; min: number; max: number; onChange: (n: number) => void }) {
    return (
        <label className="block">
            <span className="flex items-baseline justify-between mb-1.5">
                <span className="text-[12.5px] text-white/70">{rotulo}</span>
                <span className="flex items-center gap-1">
                    <input type="number" min={min} max={max} value={valor} onChange={(e) => onChange(acotar(Number(e.target.value), min, max))}
                        className="w-14 h-7 rounded-[6px] bg-white/[0.07] border border-white/10 focus:border-[var(--accion-en-oscuro)] px-2 text-right text-[13px] font-bold tabular-nums text-white outline-none" />
                    <span className="text-[12px] text-white/50">s</span>
                </span>
            </span>
            <input type="range" min={min} max={max} value={valor} onChange={(e) => onChange(Number(e.target.value))}
                className="w-full h-1.5 cursor-pointer accent-[var(--accion-en-oscuro)]" />
        </label>
    );
}

function OpcionDestino({ activo, onClick, Icon, titulo, detalle, apagado, motivo }: {
    activo: boolean; onClick?: () => void; Icon: React.ComponentType<{ size?: number; className?: string }>; titulo: string; detalle: string; apagado?: boolean; motivo?: string;
}) {
    return (
        <button type="button" onClick={apagado ? undefined : onClick} disabled={apagado} aria-pressed={activo} title={motivo || detalle}
            className={cn("rounded-[10px] border px-3 py-3 text-left transition-colors",
                activo ? "border-[var(--accion-en-oscuro)] bg-[var(--accion-en-oscuro)]/10" : "border-white/10 hover:bg-white/[0.05]",
                apagado && "opacity-45 cursor-not-allowed hover:bg-transparent")}>
            <Icon size={18} className={activo ? "text-[var(--accion-en-oscuro)]" : "text-white/70"} />
            <span className="block mt-2 text-[13px] font-bold">{titulo}</span>
            <span className="block text-[11px] text-white/50 leading-tight mt-0.5">{detalle}</span>
        </button>
    );
}

function PanelDestinatarios({ instante, camara, matricula, segundos, onCambio }: { instante: number; camara?: string | null; matricula?: string | null; segundos: number; onCambio: (telefonos: string[]) => void }) {
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
    const validos = useMemo(() => [...elegidos].filter((tel) => todos.some((x) => x.telefono === tel)), [elegidos, todos]);
    const cambio = useRef(onCambio); cambio.current = onCambio;
    useEffect(() => { cambio.current(validos); }, [validos]);
    const alternar = (tel: string) => setElegidos((s) => { const n = new Set(s); n.has(tel) ? n.delete(tel) : n.add(tel); return n; });
    const sumar = (u: DestinatarioClip) => { setExtra((x) => [...x, u]); setElegidos((s) => new Set(s).add(u.telefono)); setQ(""); setHallados([]); };
    const leyenda = [`🎥 ${camara || "Cámara"}`, `${fechaCorta(instante)} ${horaSeg(instante)}`, matricula ? `Matrícula ${matricula}` : null].filter(Boolean).join(" · ");

    return (
        <div className="space-y-3">
            <div className="rounded-[10px] border border-white/10 bg-white/[0.03] divide-y divide-white/[0.06] max-h-[240px] overflow-y-auto">
                {cargando && <div className="px-3 py-3 text-[12px] text-white/50 inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando destinatarios…</div>}
                {!cargando && error && <div className="px-3 py-3 text-[12px] text-red-300 flex items-start gap-2"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}</div>}
                {!cargando && !error && todos.length === 0 && <div className="px-3 py-3 text-[12px] text-white/50">No hay destinatarios de WhatsApp en el Centro de Notificaciones. Buscá un usuario abajo.</div>}
                {todos.map((x) => (
                    <button key={x.telefono} type="button" onClick={() => alternar(x.telefono)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04]">
                        <span className={cn("w-[18px] h-[18px] rounded-[5px] grid place-items-center border shrink-0", elegidos.has(x.telefono) ? "bg-[var(--accion)] border-[var(--accion)]" : "border-white/25")}>{elegidos.has(x.telefono) && <Check size={12} className="text-white" />}</span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold truncate">{x.nombre}</span>
                            <span className="block text-[11px] text-white/50 truncate tabular-nums">{x.detalle} · +{x.telefono}</span>
                        </span>
                    </button>
                ))}
            </div>
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sumar un usuario: nombre, lote o teléfono"
                    className="w-full h-9 rounded-[6px] bg-white/[0.07] border border-white/10 focus:border-[var(--accion-en-oscuro)] pl-9 pr-3 text-[13px] text-white placeholder:text-white/35 outline-none" />
                {hallados.length === 0 && q.trim().length >= 2 && buscado === q && (
                    <div className="absolute z-10 left-0 right-0 mt-1 rounded-[10px] bg-neutral-800 border border-white/10 px-3 py-2.5 text-[12px] text-white/55">Ningún usuario con teléfono coincide con «{q}». El teléfono se carga en la ficha del usuario.</div>
                )}
                {hallados.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 rounded-[14px] bg-neutral-800 border border-white/10 shadow-2xl overflow-hidden">
                        {hallados.map((u) => (
                            <button key={u.telefono} type="button" onClick={() => sumar(u)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.06]">
                                <Plus size={14} className="text-[var(--accion-en-oscuro)] shrink-0" />
                                <span className="min-w-0"><span className="block text-[13px] font-semibold truncate">{u.nombre}</span><span className="block text-[11px] text-white/50 truncate tabular-nums">{u.detalle} · +{u.telefono}</span></span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="rounded-[10px] bg-white/[0.03] border border-white/10 px-3 py-2.5 text-[11.5px] text-white/55 flex items-start gap-2">
                <Info size={13} className="shrink-0 mt-0.5 text-white/40" /> <span>Va con el texto <span className="text-white/80">{leyenda}</span> · {segundos} s. Queda registrado en Despachos.</span>
            </div>
        </div>
    );
}

/** Mientras se arma y se manda. La barra se basa en el tiempo esperado (el NVR va a tiempo real); el texto no inventa avances. */
function EnCurso({ desde, segundos, canal }: { desde: number; segundos: number; canal: "WhatsApp" | "Telegram" }) {
    const [ahora, setAhora] = useState(Date.now());
    useEffect(() => { const i = setInterval(() => setAhora(Date.now()), 250); return () => clearInterval(i); }, []);
    const pasaron = (ahora - desde) / 1000;
    const total = estimadoSeg(segundos);
    const p = Math.min(0.95, pasaron / total);
    return (
        <div className="flex-1 grid place-items-center px-8">
            <div className="w-full">
                <Loader2 size={28} className="animate-spin text-[var(--accion-en-oscuro)] mx-auto" />
                <div className="mt-4 text-center text-[16px] font-bold">{pasaron < segundos ? "Armando el clip desde la grabación…" : pasaron < segundos + EDICION_SEG ? "Sumando la intro de OmniAccess…" : `Enviando por ${canal}…`}</div>
                <div className="mt-1 text-center text-[12px] text-white/50 tabular-nums">{Math.floor(pasaron)} s de ~{total} s</div>
                <div className="mt-5 h-1.5 rounded-full bg-white/10 overflow-hidden"><motion.div className="h-full bg-[var(--accion-en-oscuro)]" animate={{ width: `${p * 100}%` }} transition={{ ease: "linear", duration: 0.25 }} /></div>
                <p className="mt-4 text-center text-[11.5px] text-white/45">El grabador entrega el video a tiempo real: {segundos} s de clip tardan algo más que eso. No cierres este panel.</p>
            </div>
        </div>
    );
}

function Resultado({ r, onOtro, onCerrar }: { r: ResultadoVista; onOtro: () => void; onCerrar: () => void }) {
    const hora = horaSeg(Date.now());
    const todosOk = r.ok && r.enviados.every((e) => e.ok);
    return (
        <>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-3">
                <div className={cn("rounded-[10px] px-4 py-3.5 flex items-start gap-3", todosOk ? "chip-bien" : "chip-aviso")}>
                    {todosOk ? <Check size={18} className="shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                        <div className="text-[14px] font-bold">{!r.ok ? "No se envió" : todosOk ? `Enviado a ${r.enviados.map((e) => e.nombre).join(", ")}` : "Se envió en parte"}</div>
                        <div className="text-[12px] opacity-80">{!r.ok ? r.error : `Por ${r.canal} · ${r.segundos} s desde ${r.fuente === "nvr" ? "la grabación del NVR" : "la grabación local"}${r.editado ? " · con la intro de OmniAccess" : ""} · ${hora}`}</div>
                    </div>
                </div>
                {r.ok && !todosOk && (
                    <div className="rounded-[10px] border border-white/10 divide-y divide-white/[0.06]">
                        {r.enviados.map((e) => (
                            <div key={e.clave} className="px-3 py-2 flex items-center gap-2 text-[12.5px]">
                                {e.ok ? <Check size={13} className="text-emerald-300" /> : <X size={13} className="text-red-300" />}
                                <span className="font-semibold">{e.nombre}</span>
                                {!e.ok && <span className="text-white/50 truncate">· {e.error}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-white/[0.08] bg-black/30">
                <button type="button" onClick={onOtro} className="h-9 px-4 rounded-[6px] text-[13px] font-semibold text-white/70 hover:text-white hover:bg-white/10">{r.ok ? "Enviar a otro" : "Volver"}</button>
                <button type="button" onClick={onCerrar} className="h-9 px-4 rounded-[6px] bg-[var(--accion)] hover:bg-[var(--accion-sobre)] text-white text-[13px] font-bold">Listo</button>
            </div>
        </>
    );
}

/** El avión de papel de Telegram, dibujado: lucide no tiene la marca y un ícono genérico confunde con «enviar». Igual que en Compartir evento. */
function IconoTelegram({ size = 15, className }: { size?: number; className?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
            <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2 1.8 11.7c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z" />
        </svg>
    );
}

/**
 * A qué chats de Telegram va el clip. Sólo los que el sistema conoce (ver actions/clips-telegram):
 * el grupo de la guardia viene marcado, el resto se suma tocando. No hay campo para tipear un chat.
 */
function PanelTelegram({ estado, elegidos, onElegidos, nota, onNota, segundos, matricula }: {
    estado: EstadoTelegram; elegidos: string[]; onElegidos: (x: string[]) => void; nota: string; onNota: (t: string) => void; segundos: number; matricula?: string | null;
}) {
    const alternar = (id: string) => onElegidos(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);
    return (
        <div className="space-y-3">
            <div className="rounded-[10px] border border-white/10 bg-white/[0.03] divide-y divide-white/[0.06] max-h-[240px] overflow-y-auto">
                {estado.destinos.map((x) => {
                    const si = elegidos.includes(x.destino);
                    return (
                        <button key={x.destino} type="button" onClick={() => alternar(x.destino)} aria-pressed={si} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04]">
                            <span className={cn("w-[18px] h-[18px] rounded-[5px] grid place-items-center border shrink-0", si ? "bg-[var(--accion)] border-[var(--accion)]" : "border-white/10")}>{si && <Check size={12} className="text-white" />}</span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-semibold truncate">{x.nombre}</span>
                                <span className="block text-[11px] text-white/50 truncate">{x.detalle}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
            <input value={nota} onChange={(e) => onNota(e.target.value.slice(0, 300))} placeholder="Una nota para la guardia (opcional)"
                className="w-full h-9 rounded-[6px] bg-white/[0.07] border border-white/10 focus:border-[var(--accion-en-oscuro)] px-3 text-[13px] text-white placeholder:text-white/35 outline-none" />
            <div className="rounded-[10px] bg-white/[0.03] border border-white/10 px-3 py-2.5 text-[11.5px] text-white/50 flex items-start gap-2">
                <Info size={13} className="shrink-0 mt-0.5 text-white/50" />
                <span>
                    {segundos} s{estado.conMarca ? <>, con la intro y el logo de <span className="text-white/75">OmniAccess</span></> : null}. Va con botones para ver la cámara ahora{matricula ? <> y el historial de <span className="text-white/75">{matricula}</span></> : null}. Queda registrado en Despachos.
                </span>
            </div>
        </div>
    );
}
