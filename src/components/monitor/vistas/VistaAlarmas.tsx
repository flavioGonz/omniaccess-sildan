"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Siren, ShieldCheck, ShieldOff, Shield, Wrench, CheckCircle2, FlaskConical, Info, UserRound, UserX, TrendingUp, Radio, Camera, Minimize2, Loader2, Hash, Layers, MapPin, KeyRound } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { sonar } from "@/lib/sonido-monitor";
import { Vivo, Foto, vivoDe, reproduceH265, usaHls } from "@/components/monitor/camaras/piezas";
import { SUAVE, tocable } from "@/components/monitor/tactil";
import { IlustracionEvento } from "@/components/centrales/IlustracionEvento";
import { claseDeAlarma, nivel, PRIORIDADES_DEFECTO, type Prioridades } from "@/lib/centrales/prioridades";
import { getImagePath } from "@/lib/image-path";
import { conAncho } from "@/lib/ancho-foto";
import { cn } from "@/lib/utils";

/**
 * La pared «Alarmas»: las alarmas de las centrales (Alarm Hub, SIA DC-09), para verificarlas con
 * video en vivo (23/10, Nico: «manejable, impresionante, animado. Sobre todo la recepción de eventos
 * debe ser muy rápida, ya que tenemos que verificar cada evento con video verificación en vivo»).
 *
 * Lo rápido: el receptor avisa por el socket (`general_detection` de tipo CENTRAL) con las cámaras
 * de la zona, y con eso alcanza para poner la alarma al frente y abrir el video — no se espera la
 * consulta. La consulta llega enseguida y completa nombres, quién la tiene y los cuadros del momento;
 * se repite cada `INTERVALO_MS`, que es lo que apaga acá una alarma tratada en el panel aunque se
 * pierda un aviso del socket.
 *
 * Qué se ve:
 *  · Al frente, la alarma más urgente sin tratar (el orden de Gestión de alarmas: prioridad, y entre
 *    iguales la más nueva). La franja de arriba toma el color de su prioridad, el reloj cuenta desde
 *    el evento y dice si alguien la tomó. El video de las cámaras de la zona ocupa casi todo; al
 *    costado, la escena de lo que pasó (la misma de Centrales y de la ficha) y los cuadros que se
 *    guardaron en el momento.
 *  · A la derecha, las otras en espera (tocar una la trae al frente por un minuto) y lo que va
 *    llegando de las centrales, evento por evento.
 *  · Abajo, cada central: si reporta, si está armada y desde cuándo.
 *  · Sin nada pendiente, la calma: el escudo, cuántas centrales reportan y los números del día.
 *
 * Como toda pantalla de pared, sólo mira: tomar o tratar una alarma se hace en el panel.
 */

/** La consulta completa; el socket adelanta lo urgente. */
const INTERVALO_MS = 10_000;
/** Cada cuánto vuelve a sonar una crítica que nadie tomó, en modo «repetir». */
const REPETIR_MS = 8000;
/** Tocar una de la fila la deja al frente este tiempo; después vuelve el orden de prioridad. */
const ELEGIDA_MS = 60_000;
/** Cuánto dura el destello de una alarma que acaba de llegar. */
const LLEGADA_MS = 3500;
/** Si una cámara no da video, su foto se renueva así. */
const FOTO_MS = 2000;
/** Prioridad hasta la que una alarma suena con el tono fuerte, repite y destella. */
const CRITICA_HASTA = 2;

type Cam = { id: string; nombre: string; stream: string };
type Pendiente = {
    id: string; ts: string; tipo: string; titulo: string; prioridad: number; area: string | null; particion: number | null;
    central: { id: string; nombre: string; cuenta: string; prueba: boolean };
    zona: { zona: number; nombre: string | null } | null;
    codigo: string | null; texto: string | null; usuario: number | string | null;
    camaras: Cam[]; fotos: { camara: string | null; foto: string }[];
    operador: { nombre: string; desde: string | null } | null; escalado: string | null;
    /** Llegó por el socket y la consulta todavía no la trajo. */
    provisoria?: number;
};
type Reciente = {
    id: string; ts: string; central: string; categoria: string; tipo: string | null; texto: string; codigo: string | null;
    zona: number | null; zonaNombre: string | null; particion: number | null; usuario: number | string | null;
    restaura: boolean; propio: boolean; prioridad: number; detectionId: string | null;
};
type Central = {
    id: string; nombre: string; cuenta: string; estado: string; prueba: boolean; ultimoMensajeAt: string | null; supervisionSeg: number;
    armado: { armada: boolean; presente: boolean; texto: string | null; particion: number | null; usuario: number | string | null; ts: string } | null;
    enAlarma: number;
};
type Datos = { ahora: string; prioridades?: Prioridades; pendientes: Pendiente[]; recientes: Reciente[]; centrales: Central[]; hoy: { alarmas: number; tratadas: number; falsas: number } };

/** El color de una prioridad, como variable CSS (para mezclar fondos y anillos). */
const colorDe = (p: number) => `var(--${nivel(p).tono})`;
const mm = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`; };
const zonaTexto = (z: { zona: number; nombre: string | null } | null) => z ? `Zona ${z.zona}${z.nombre ? ` · ${z.nombre}` : ""}` : null;

/** El reloj grande de la alarma: cuánto hace que llegó, al segundo. */
function Reloj({ desde, grande }: { desde: string; grande?: boolean }) {
    usarReloj(1000);
    return <span className={cn("tabular-nums font-bold leading-none", grande ? "text-[56px] tracking-[-0.02em]" : "text-[20px]")}>{mm(Date.now() - new Date(desde).getTime())}</span>;
}

/** Una pastilla de prioridad: «P1 · Crítica». */
function Prioridad({ p, grande }: { p: number; grande?: boolean }) {
    const n = nivel(p);
    return <span className={cn("inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-[0.08em]", `pleno-${n.tono}`, grande ? "h-9 px-4 text-[16px]" : "h-6 px-2.5 text-[11px]")}>P{p} · {n.nombre}</span>;
}

// ── Video de la zona ────────────────────────────────────────────────────────────────────────

/** Una cámara de la zona: el vivo de go2rtc y, si no arranca, su foto renovándose. */
function Camara({ c, h265, hls, sola, alTocar }: { c: Cam; h265: boolean; hls: boolean; sola: boolean; alTocar: () => void }) {
    const [vivo, setVivo] = useState<boolean | null>(null);
    useEffect(() => { setVivo(null); }, [c.stream]);
    return (
        <motion.button type="button" layout onClick={alTocar} transition={SUAVE} aria-label={`Cámara ${c.nombre}`}
            className={cn("relative rounded-2xl overflow-hidden bg-black ring-1 ring-white/10 text-left min-h-0", tocable)}>
            {vivo !== false
                ? <Vivo src={vivoDe(c.stream, !h265, hls)} alResultado={setVivo} className="absolute inset-0 w-full h-full object-contain" />
                : <Foto src={`/api/snapshot/${c.id}?w=1280`} ms={FOTO_MS} className="absolute inset-0 w-full h-full object-contain" />}
            {vivo === null && <span className="absolute inset-0 grid place-items-center text-white/40"><Loader2 size={34} className="animate-spin" /></span>}
            <div className="absolute top-0 inset-x-0 px-4 pt-3 pb-10 bg-gradient-to-b from-black/80 to-transparent flex items-center gap-3">
                <span className={cn("inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-bold uppercase tracking-[0.1em]", vivo === false ? "bg-white/15 text-white/80" : "pleno-mal")}>
                    {vivo === false ? <><Camera size={13} /> Foto</> : <><span className="h-2 w-2 rounded-full bg-white animate-pulse" /> En vivo</>}
                </span>
                <span className="text-[20px] font-bold text-white drop-shadow truncate">{c.nombre}</span>
                {sola && <span className="ml-auto grid h-9 w-9 place-items-center rounded-xl bg-black/50 text-white/80" aria-hidden><Minimize2 size={17} /></span>}
            </div>
        </motion.button>
    );
}

function VideoZona({ camaras, evento }: { camaras: Cam[]; evento: Pendiente }) {
    const [h265, setH265] = useState(true);
    const [hls, setHls] = useState(false);
    const [sola, setSola] = useState<string | null>(null);
    useEffect(() => { setH265(reproduceH265()); setHls(usaHls()); }, []);
    useEffect(() => { setSola(null); }, [evento.id]);
    const vistas = sola ? camaras.filter((c) => c.id === sola) : camaras;
    if (!camaras.length) {
        return (
            <div className="relative h-full rounded-2xl bg-card ring-1 ring-border overflow-hidden grid place-items-center">
                <div className="w-full max-w-[760px] px-6">
                    <IlustracionEvento key={evento.id} evento={{ categoria: "ALARMA", tipo: evento.tipo, texto: evento.texto || evento.titulo }} alto={300} />
                    <p className="mt-2 text-center text-[17px] text-muted-foreground">Esta zona no tiene cámaras asociadas: no hay video para verificar. Se asocian en Dispositivos › la central › Zonas.</p>
                </div>
            </div>
        );
    }
    // Dos cámaras, una arriba de la otra: el lugar es más ancho que alto y así cada video sale más grande.
    const cols = vistas.length <= 2 ? "grid-cols-1" : "grid-cols-2";
    const filas = vistas.length === 1 ? "grid-rows-1" : "grid-rows-2";
    return (
        <div className={cn("grid h-full gap-2", cols, filas)}>
            {vistas.map((c) => <Camara key={c.id} c={c} h265={h265} hls={hls} sola={!!sola} alTocar={() => setSola((s) => (s ? null : camaras.length > 1 ? c.id : null))} />)}
        </div>
    );
}

// ── La alarma al frente ─────────────────────────────────────────────────────────────────────

function Dato({ icono: Ic, rotulo, valor }: { icono: any; rotulo: string; valor: React.ReactNode }) {
    return (
        <div className="flex items-start gap-2.5 py-2 border-b border-border last:border-0">
            <Ic size={17} className="mt-0.5 text-muted-foreground shrink-0" />
            <div className="min-w-0"><div className="text-[12px] text-muted-foreground">{rotulo}</div><div className="text-[16px] font-semibold leading-snug break-words">{valor}</div></div>
        </div>
    );
}

function AlFrente({ e, recienLlegada }: { e: Pendiente; recienLlegada: boolean }) {
    const reducir = useReducedMotion();
    const color = colorDe(e.prioridad);
    const critica = e.prioridad <= CRITICA_HASTA;
    return (
        <motion.section key={e.id} layout initial={{ opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="relative h-full min-h-0 flex flex-col rounded-[18px] overflow-hidden ring-2"
            style={{ ["--tw-ring-color" as any]: `color-mix(in oklab, ${color} 70%, transparent)`, background: `color-mix(in oklab, ${color} 7%, var(--background))` }}>
            {/* La franja de arriba: qué, dónde, cuánto hace y quién. Late mientras nadie la toma. */}
            <motion.header className="shrink-0 flex items-center gap-5 px-6 py-4"
                style={{ background: `color-mix(in oklab, ${color} 26%, var(--card))` }}
                animate={critica && !e.operador && !reducir ? { backgroundColor: [`color-mix(in oklab, ${color} 22%, var(--card))`, `color-mix(in oklab, ${color} 42%, var(--card))`, `color-mix(in oklab, ${color} 22%, var(--card))`] } : undefined}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
                <motion.span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full text-white" style={{ background: color }}
                    animate={critica && !reducir ? { scale: [1, 1.08, 1] } : undefined} transition={{ duration: 1.2, repeat: Infinity }}>
                    <Siren size={38} />
                </motion.span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                        <Prioridad p={e.prioridad} grande />
                        {e.central.prueba && <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full chip-quieto border text-[12px] font-bold"><FlaskConical size={13} /> Central de prueba</span>}
                        {e.escalado && <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full pleno-mal text-[12px] font-bold"><TrendingUp size={13} /> Escalada · {e.escalado}</span>}
                    </div>
                    <h2 className="mt-1.5 text-[38px] font-bold leading-[1.05] tracking-[-0.02em] truncate">{e.titulo}</h2>
                    <div className="mt-1 text-[18px] text-muted-foreground truncate">{[e.central.nombre, e.area, e.particion != null ? `Partición ${e.particion}` : null].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="shrink-0 text-right">
                    <Reloj desde={e.ts} grande />
                    <div className="mt-1 text-[15px] text-muted-foreground tabular-nums">llegó a las {horaCorta(e.ts)}</div>
                    <div className="mt-2 flex justify-end">
                        {e.operador
                            ? <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full chip-info border text-[14px] font-bold"><UserRound size={15} /> La tiene {e.operador.nombre}{e.operador.desde ? ` · ${hace(e.operador.desde)}` : ""}</span>
                            : <motion.span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full pleno-aviso text-[14px] font-bold" animate={reducir ? undefined : { opacity: [1, 0.55, 1] }} transition={{ duration: 1.4, repeat: Infinity }}><UserX size={15} /> Nadie la tomó</motion.span>}
                    </div>
                </div>
            </motion.header>
            <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_340px] gap-3 p-3">
                <VideoZona camaras={e.camaras} evento={e} />
                <aside className="min-h-0 flex flex-col gap-3 overflow-y-auto">
                    {e.camaras.length > 0 && (
                        <div className="rounded-[14px] bg-card ring-1 ring-border overflow-hidden">
                            <IlustracionEvento key={e.id} evento={{ categoria: "ALARMA", tipo: e.tipo, texto: e.texto || e.titulo }} alto={170} className="pb-2" />
                        </div>
                    )}
                    <div className="rounded-[14px] bg-card ring-1 ring-border px-4 py-1">
                        {e.zona && <Dato icono={MapPin} rotulo="Zona" valor={zonaTexto(e.zona)} />}
                        {e.texto && <Dato icono={Info} rotulo="Lo que mandó la central" valor={e.texto} />}
                        {e.codigo && <Dato icono={Hash} rotulo="Código" valor={<span className="tabular-nums">{e.codigo}</span>} />}
                        {e.particion != null && <Dato icono={Layers} rotulo="Partición" valor={e.particion} />}
                        {e.usuario != null && <Dato icono={KeyRound} rotulo="Usuario" valor={e.usuario} />}
                        <Dato icono={Radio} rotulo="Central" valor={`${e.central.nombre} · cuenta ${e.central.cuenta}`} />
                    </div>
                    {e.fotos.length > 0 && (
                        <div className="rounded-[14px] bg-card ring-1 ring-border p-3">
                            <div className="text-[12px] text-muted-foreground mb-2">Cuadros del momento del evento</div>
                            <div className="grid grid-cols-2 gap-2">
                                {e.fotos.map((f, i) => {
                                    const src = conAncho(getImagePath(f.foto), 480) || getImagePath(f.foto);
                                    // eslint-disable-next-line @next/next/no-img-element
                                    return src ? <img key={i} src={src} alt="" draggable={false} className="w-full aspect-video object-cover rounded-[8px] bg-black" /> : null;
                                })}
                            </div>
                        </div>
                    )}
                </aside>
            </div>
            {/* El destello de llegada: un anillo que late dos veces alrededor de toda la alarma. */}
            <AnimatePresence>
                {recienLlegada && !reducir && (
                    <motion.div key="destello" className="pointer-events-none absolute inset-0 rounded-[18px]" style={{ boxShadow: `inset 0 0 0 6px ${color}, inset 0 0 80px ${color}` }}
                        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.25, 1, 0] }} exit={{ opacity: 0 }} transition={{ duration: LLEGADA_MS / 1000, ease: "easeInOut" }} />
                )}
            </AnimatePresence>
        </motion.section>
    );
}

// ── Sin nada pendiente ──────────────────────────────────────────────────────────────────────

/** El escudo de la calma: anillos que se abren despacio, como un radar que no encuentra nada. */
function Escudo() {
    const reducir = useReducedMotion();
    return (
        <svg viewBox="0 0 240 240" className="w-[240px] h-[240px]" aria-hidden>
            {[0, 1, 2].map((i) => (
                <motion.circle key={i} cx={120} cy={120} r={60} fill="none" stroke="var(--bien)" strokeWidth={2}
                    initial={{ opacity: 0.5, scale: 1 }} animate={reducir ? undefined : { opacity: [0.5, 0], scale: [1, 1.9] }}
                    transition={{ duration: 3.6, repeat: Infinity, delay: i * 1.2, ease: "easeOut" }} style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }} />
            ))}
            <circle cx={120} cy={120} r={62} fill="color-mix(in oklab, var(--bien) 14%, transparent)" stroke="color-mix(in oklab, var(--bien) 50%, transparent)" strokeWidth={2} />
            <path d="M120 78 L150 90 V116 C150 136 137 151 120 158 C103 151 90 136 90 116 V90 Z" fill="color-mix(in oklab, var(--bien) 30%, transparent)" stroke="var(--bien)" strokeWidth={3} strokeLinejoin="round" />
            <motion.path d="M106 118 L116 128 L135 106" fill="none" stroke="var(--bien)" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.3, ease: "easeOut" }} />
        </svg>
    );
}

function Calma({ datos }: { datos: Datos | null }) {
    usarReloj(5000);
    const cs = datos?.centrales || [];
    const reportan = cs.filter((c) => c.estado === "EN_LINEA").length;
    const ultima = cs.map((c) => c.ultimoMensajeAt).filter(Boolean).sort().pop() || null;
    const hoy = datos?.hoy;
    return (
        <motion.section key="calma" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}
            className="h-full rounded-[18px] bg-card/50 ring-1 ring-border grid place-items-center p-8">
            <div className="text-center">
                <div className="flex justify-center"><Escudo /></div>
                <h2 className="mt-2 text-[44px] font-bold tracking-[-0.02em]">Sin alarmas pendientes</h2>
                <p className="mt-1 text-[20px] text-muted-foreground">
                    {datos === null ? "Leyendo las centrales…" : cs.length === 0 ? "No hay centrales dadas de alta." : <>{reportan} de {cs.length} {cs.length === 1 ? "central reporta" : "centrales reportan"}{ultima ? ` · última señal ${hace(ultima)}` : ""}</>}
                </p>
                {hoy && (
                    <div className="mt-8 flex justify-center gap-4">
                        {[{ r: "Alarmas hoy", v: hoy.alarmas, t: "" }, { r: "Tratadas", v: hoy.tratadas, t: "tono-bien" }, { r: "Falsas", v: hoy.falsas, t: "text-muted-foreground" }].map((x) => (
                            <div key={x.r} className="min-w-[150px] rounded-[14px] bg-background/60 ring-1 ring-border px-5 py-3">
                                <div className={cn("text-[40px] font-bold tabular-nums leading-none", x.t)}>{x.v}</div>
                                <div className="mt-1.5 text-[14px] text-muted-foreground">{x.r}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </motion.section>
    );
}

// ── La columna de la derecha ────────────────────────────────────────────────────────────────

function EnEspera({ lista, alElegir, nuevas }: { lista: Pendiente[]; alElegir: (id: string) => void; nuevas: Set<string> }) {
    return (
        <section className="shrink-0 max-h-[46%] min-h-0 flex flex-col rounded-[14px] bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 text-[15px] font-bold">
                En espera <span className="tabular-nums text-muted-foreground">{lista.length}</span>
            </div>
            <div className="min-h-0 overflow-y-auto p-2 space-y-2">
                {lista.length === 0 && <p className="px-2 py-3 text-[14px] text-muted-foreground">Ninguna otra sin tratar.</p>}
                <AnimatePresence initial={false}>
                    {lista.map((e) => (
                        <motion.button key={e.id} type="button" layout onClick={() => alElegir(e.id)} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={SUAVE}
                            className={cn("relative w-full text-left rounded-[10px] pl-4 pr-3 py-2.5 bg-background/60 ring-1 ring-border overflow-hidden", tocable, nuevas.has(e.id) && "ring-2")}
                            style={nuevas.has(e.id) ? { ["--tw-ring-color" as any]: colorDe(e.prioridad) } : undefined}>
                            <span className="absolute left-0 inset-y-0 w-1.5" style={{ background: colorDe(e.prioridad) }} />
                            <div className="flex items-center gap-2"><Prioridad p={e.prioridad} /><span className="ml-auto"><Reloj desde={e.ts} /></span></div>
                            <div className="mt-1 text-[16px] font-bold truncate">{e.titulo}</div>
                            <div className="text-[13px] text-muted-foreground truncate">{e.central.nombre}{e.operador ? ` · la tiene ${e.operador.nombre}` : " · nadie la tomó"}</div>
                        </motion.button>
                    ))}
                </AnimatePresence>
            </div>
        </section>
    );
}

const ICONO_CATEGORIA: Record<string, any> = { ALARMA: Siren, RESTAURACION: CheckCircle2, FALLA: Wrench, FALLA_FIN: CheckCircle2, ARMADO: ShieldCheck, DESARMADO: ShieldOff, PRUEBA: FlaskConical };

function Llegando({ recientes, conectado }: { recientes: Reciente[]; conectado: boolean }) {
    usarReloj(15_000);
    return (
        <section className="flex-1 min-h-0 flex flex-col rounded-[14px] bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 text-[15px] font-bold">
                Llegando de las centrales
                <span className={cn("ml-auto h-2.5 w-2.5 rounded-full", conectado ? "bg-[var(--bien)] animate-pulse" : "bg-[var(--aviso)]")} aria-label={conectado ? "En vivo" : "Por consulta"} />
            </div>
            <div className="min-h-0 overflow-y-auto">
                {recientes.length === 0 && <p className="px-4 py-3 text-[14px] text-muted-foreground">Nada en las últimas 24 horas.</p>}
                <AnimatePresence initial={false}>
                    {recientes.map((r) => {
                        const Ic = ICONO_CATEGORIA[r.categoria] || Info;
                        const tono = r.categoria === "RESTAURACION" || r.categoria === "FALLA_FIN" || r.restaura ? "bien" : r.categoria === "ARMADO" ? "info" : r.categoria === "DESARMADO" ? "quieto" : nivel(r.prioridad).tono;
                        return (
                            <motion.div key={r.id} layout initial={{ opacity: 0, x: 40, backgroundColor: `color-mix(in oklab, var(--${tono}) 30%, transparent)` }}
                                animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }} transition={{ duration: 0.5, backgroundColor: { duration: 2.5 } }}
                                className="flex items-start gap-3 px-4 py-2.5 border-b border-border last:border-0">
                                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border", `chip-${tono}`)}><Ic size={17} /></span>
                                <div className="min-w-0 flex-1">
                                    <div className="text-[15px] font-semibold leading-snug truncate">{r.texto}</div>
                                    <div className="text-[12.5px] text-muted-foreground truncate">{[r.central, r.zona != null ? `Zona ${r.zona}${r.zonaNombre ? ` · ${r.zonaNombre}` : ""}` : null, r.particion != null && r.zona == null ? `Partición ${r.particion}` : null].filter(Boolean).join(" · ")}</div>
                                </div>
                                <span className="text-[13px] text-muted-foreground tabular-nums whitespace-nowrap">{horaCorta(r.ts)}</span>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </section>
    );
}

// ── Las centrales, abajo ────────────────────────────────────────────────────────────────────

const ESTADO: Record<string, { r: string; t: "bien" | "mal" | "quieto" }> = { EN_LINEA: { r: "Reporta", t: "bien" }, SIN_SUPERVISION: { r: "Sin supervisión", t: "mal" }, ESPERANDO: { r: "Nunca habló", t: "quieto" } };

function Centrales({ centrales }: { centrales: Central[] }) {
    usarReloj(15_000);
    if (!centrales.length) return null;
    return (
        <div className="shrink-0 flex gap-2 overflow-x-auto pt-2 -mt-2 pr-2">
            {centrales.map((c) => {
                const e = ESTADO[c.estado] || ESTADO.ESPERANDO;
                const a = c.armado;
                const IcA = !a ? Shield : a.armada ? ShieldCheck : ShieldOff;
                return (
                    <motion.div key={c.id} layout className={cn("relative min-w-[260px] flex items-center gap-3 rounded-[14px] bg-card ring-1 px-3.5 py-2.5", c.enAlarma ? "" : "ring-border")}
                        style={c.enAlarma ? { ["--tw-ring-color" as any]: "var(--mal)" } : undefined}>
                        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full border", !a ? "chip-neutro" : a.armada ? "chip-info" : "chip-quieto")}><IcA size={21} /></span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-[16px] font-bold truncate">{c.nombre}</span>
                                {c.prueba && <FlaskConical size={13} className="text-muted-foreground shrink-0" aria-label="Central de prueba" />}
                            </div>
                            <div className="text-[13px] text-muted-foreground truncate">
                                {!a ? "Armado: sin dato" : `${a.armada ? (a.presente ? "Armada presente" : "Armada") : "Desarmada"}${a.particion != null ? ` · partición ${a.particion}` : ""} · ${hace(a.ts)}`}
                            </div>
                            <div className={cn("text-[12px] font-semibold flex items-center gap-1.5", `tono-${e.t}`)}>
                                <span className={cn("h-2 w-2 rounded-full", `pleno-${e.t}`, e.t === "bien" && "animate-pulse")} /> {e.r}{c.ultimoMensajeAt ? <span className="font-normal text-muted-foreground">· {hace(c.ultimoMensajeAt)}</span> : null}
                            </div>
                        </div>
                        {c.enAlarma > 0 && (
                            <motion.span className="absolute -top-2 -right-2 grid h-7 min-w-7 px-1.5 place-items-center rounded-full pleno-mal text-[13px] font-bold tabular-nums"
                                animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.1, repeat: Infinity }}>{c.enAlarma}</motion.span>
                        )}
                    </motion.div>
                );
            })}
        </div>
    );
}

// ── La vista ────────────────────────────────────────────────────────────────────────────────

export function VistaAlarmas() {
    const { setTitulo, latir, ajustes, silencio, conectado } = useMarco();
    useEffect(() => { setTitulo("Alarmas"); }, [setTitulo]);
    const { datos, error, actualizado, recargar } = usarDatos<Datos>("/api/monitor/centrales", INTERVALO_MS, latir);

    // Releer apenas avisa el socket, juntando los avisos que llegan seguidos (un mensaje SIA trae varios eventos).
    const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pronto = useCallback((ms = 250) => { if (espera.current) clearTimeout(espera.current); espera.current = setTimeout(() => { recargar(); }, ms); }, [recargar]);
    useEffect(() => () => { if (espera.current) clearTimeout(espera.current); }, []);

    // Lo que llegó por el socket y la consulta todavía no trajo: se muestra ya, con su video.
    const [provisorias, setProvisorias] = useState<Pendiente[]>([]);
    const [llegadas, setLlegadas] = useState<Record<string, number>>({});
    const prioridades = datos?.prioridades || PRIORIDADES_DEFECTO;
    const nombres = useRef(new Map<string, string>());
    useEffect(() => { for (const e of datos?.pendientes || []) for (const c of e.camaras) nombres.current.set(c.id, c.nombre); }, [datos]);

    useTiempoReal("general_detection", useCallback((d: any) => {
        if (d?.type !== "CENTRAL" || !d.id) return;
        latir();
        const ahora = Date.now();
        const camaras: Cam[] = (Array.isArray(d.camaras) ? d.camaras : []).map((id: any) => ({ id: String(id), nombre: nombres.current.get(String(id)) || "Cámara de la zona", stream: `lpr_${id}` }));
        const [central, ...resto] = String(d.deviceName || "Central").split(" · ");
        setProvisorias((p) => p.some((x) => x.id === d.id) ? p : [{
            id: d.id, ts: d.timestamp ? new Date(d.timestamp).toISOString() : new Date().toISOString(), tipo: d.eventType || "GENERAL", titulo: d.label || "Alarma",
            prioridad: prioridades[claseDeAlarma(d.eventType)] || 3, area: null, particion: null,
            central: { id: "", nombre: central, cuenta: "", prueba: false }, zona: null, codigo: null, texto: resto.join(" · ") || null, usuario: null,
            camaras, fotos: [], operador: null, escalado: null, provisoria: ahora,
        }, ...p]);
        setLlegadas((l) => ({ ...l, [d.id]: ahora }));
        pronto(150);
    }, [latir, pronto, prioridades]));
    useTiempoReal("central_mensaje", useCallback(() => { latir(); pronto(400); }, [latir, pronto]));
    useTiempoReal("central_tratado", useCallback(() => pronto(100), [pronto]));
    useTiempoReal("central_escalado", useCallback(() => pronto(100), [pronto]));
    useTiempoReal("alarma_gestion", useCallback(() => pronto(200), [pronto]));
    useTiempoReal("detection_snapshot", useCallback(() => pronto(300), [pronto]));

    // Una provisoria se va cuando la consulta la trae, o cuando una consulta posterior no la trae (ya se trató).
    useEffect(() => {
        if (!datos || !actualizado) return;
        const ids = new Set(datos.pendientes.map((e) => e.id));
        const t = actualizado.getTime();
        setProvisorias((p) => p.filter((x) => !ids.has(x.id) && t - (x.provisoria || 0) < 3000));
    }, [datos, actualizado]);

    // Los destellos se apagan solos.
    usarReloj(1000);
    const ahora = Date.now();
    const nuevas = useMemo(() => new Set(Object.entries(llegadas).filter(([, t]) => ahora - t < LLEGADA_MS).map(([id]) => id)), [llegadas, ahora]);

    const pendientes = useMemo(() => {
        const base = datos?.pendientes || [];
        const ids = new Set(base.map((e) => e.id));
        return [...provisorias.filter((p) => !ids.has(p.id)), ...base].sort((a, b) => a.prioridad - b.prioridad || (a.ts < b.ts ? 1 : -1));
    }, [datos, provisorias]);

    // Tocar una de la fila la trae al frente por un minuto.
    const [elegida, setElegida] = useState<{ id: string; hasta: number } | null>(null);
    const vigente = elegida && elegida.hasta > ahora ? pendientes.find((e) => e.id === elegida.id) : null;
    const frente = vigente || pendientes[0] || null;
    const resto = pendientes.filter((e) => e.id !== frente?.id);

    // Sonido: un tono por alarma nueva (fuerte si es crítica), y en «repetir» insiste mientras haya una crítica que nadie tomó.
    const modo = ajustes?.sonido?.alarmas || "una";
    const sonadas = useRef(new Set<string>());
    useEffect(() => {
        if (modo === "off" || silencio) { pendientes.forEach((e) => sonadas.current.add(e.id)); return; }
        const sin = pendientes.filter((e) => !sonadas.current.has(e.id));
        if (sin.length) { sonar(sin.some((e) => e.prioridad <= CRITICA_HASTA) ? "alarma" : "aviso"); sin.forEach((e) => sonadas.current.add(e.id)); }
    }, [pendientes, modo, silencio]);
    const insistir = modo === "repetir" && !silencio && pendientes.some((e) => e.prioridad <= CRITICA_HASTA && !e.operador);
    useEffect(() => { if (!insistir) return; const iv = setInterval(() => sonar("alarma"), REPETIR_MS); return () => clearInterval(iv); }, [insistir]);

    return (
        <div className="absolute inset-0 flex flex-col gap-3 p-3 lg:p-4">
            {error && !datos && (
                <div className="shrink-0 rounded-[10px] chip-aviso border px-4 py-2 text-[15px] font-semibold flex items-center gap-3">
                    No se pudieron leer las centrales ({error}). Se reintenta sola cada {INTERVALO_MS / 1000} s.
                    <button type="button" onClick={recargar} className={cn("ml-auto h-9 px-3 rounded-lg bg-background/50 font-bold", tocable)}>Reintentar ahora</button>
                </div>
            )}
            <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_400px] gap-3">
                <div className="min-h-0">
                    <AnimatePresence mode="wait">
                        {frente ? <AlFrente key={frente.id} e={frente} recienLlegada={nuevas.has(frente.id)} /> : <Calma key="calma" datos={datos} />}
                    </AnimatePresence>
                </div>
                <aside className="min-h-0 flex flex-col gap-3">
                    <EnEspera lista={resto} nuevas={nuevas} alElegir={(id) => setElegida({ id, hasta: Date.now() + ELEGIDA_MS })} />
                    <Llegando recientes={datos?.recientes || []} conectado={conectado} />
                </aside>
            </div>
            <Centrales centrales={datos?.centrales || []} />
        </div>
    );
}
