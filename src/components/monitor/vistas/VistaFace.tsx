"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Clock, Home, LogIn, LogOut, RefreshCw, ScanFace, ShieldCheck, ShieldX, UserRound, UserX } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { sonar } from "@/lib/sonido-monitor";
import { getImagePath } from "@/lib/image-path";
import { fondoDe, type TonoFondo } from "@/lib/monitor/fondos";
import { leerDetalleRostro, motivoDeRostro, TEXTO_MOTIVO, type MotivoRostro } from "@/lib/monitor/rostro";
import { SUAVE, tocable } from "@/components/monitor/tactil";
import { cn } from "@/lib/utils";

/**
 * Monitor Face (openspec pared-vms; 23/10, Nico: «falta el Monitor Face, nos falta desarrollo en
 * este modo»). Es el Control LPR con caras, y sólo de las terminales faciales (decisión de Nico).
 *
 * Lo grande es la comparación: la foto que tomó la terminal y la del padrón, lado a lado, porque
 * lo que el guardia tiene que decidir de un vistazo es «¿es esa persona?». Al lado, quién es, de
 * qué unidad, por dónde y si se le abrió. Abajo la tira de los anteriores; a la derecha los números
 * del día y los denegados de la última hora.
 *
 * El color de la pared sigue el criterio común (lib/monitor/fondos): verde si se abrió, rojo si fue
 * un desconocido o alguien en lista negra, ámbar si se negó por otro motivo. A los 8 s sin accesos
 * nuevos vuelve a calma: la pared no se queda roja por algo que ya pasó.
 */

type Acceso = {
    id: string; ts: string; decision: "GRANT" | "DENY"; sentido: "ENTRY" | "EXIT" | string;
    persona: string | null; unidad: string | null; rol: string | null;
    padron: string | null; foto: string | null; recorte: string | null;
    nombreTerminal: string | null; similitud: number | null; terminal: string | null; motivo: MotivoRostro;
};
type Datos = { ultimas: Acceso[]; atencion: Acceso[]; hoy: { permitidos: number; denegados: number; desconocidos: number }; terminales: number; ahora: string };

const INTERVALO_MS = 20_000;
/** Cuánto dura el color de un acceso en la pared. */
const TINTE_MS = 8_000;
const EN_TIRA = 10;

const TONO: Record<MotivoRostro, TonoFondo> = { permitido: "bien", desconocido: "mal", "lista-negra": "mal", denegado: "aviso" };
const PLENO: Record<MotivoRostro, string> = { permitido: "pleno-bien", desconocido: "pleno-mal", "lista-negra": "pleno-mal", denegado: "pleno-aviso" };
const ICONO: Record<MotivoRostro, typeof ShieldCheck> = { permitido: ShieldCheck, desconocido: UserX, "lista-negra": ShieldX, denegado: ShieldX };

/** El acceso tal como llega por el socket (server.js emite access_event con el evento, la persona y la terminal). */
function desdeEvento(e: any): Acceso | null {
    if (!e || e.accessType !== "FACE" || (e.device && e.device.deviceType && e.device.deviceType !== "FACE_TERMINAL")) return null;
    const d = leerDetalleRostro(e.details);
    return {
        id: e.id, ts: new Date(e.timestamp || Date.now()).toISOString(), decision: e.decision, sentido: e.direction,
        persona: e.user?.name || null, unidad: null, rol: e.user?.role || null, padron: e.user?.cara || null,
        foto: e.snapshotPath || e.imagePath || null, recorte: d.recorte, nombreTerminal: d.nombre, similitud: d.similitud,
        terminal: e.device?.name || null, motivo: motivoDeRostro({ decision: e.decision, userId: e.userId, rol: e.user?.role, detalles: e.details }),
    };
}

export function VistaFace() {
    const { latir, setTitulo, setFondo, ajustes, silencio } = useMarco();
    useEffect(() => { setTitulo("Monitor Face"); }, [setTitulo]);
    usarReloj();
    const { datos, error, recargar } = usarDatos<Datos>("/api/monitor/face", INTERVALO_MS, latir);
    const [vivo, setVivo] = useState<Acceso | null>(null);
    const modoSonido = ajustes?.sonido?.face || "off";

    useTiempoReal("access_event", (e: any) => {
        const a = desdeEvento(e); if (!a) return;
        latir(); setVivo(a);
        if (!silencio && modoSonido !== "off" && a.decision === "DENY") {
            if (a.motivo === "lista-negra") sonar("lista");
            else if (modoSonido === "denegado" || a.motivo === "desconocido") sonar("denegado");
        }
        // La consulta trae la unidad y la foto del padrón ya resueltas.
        setTimeout(recargar, 1200);
    });

    // El grande: lo último entre lo que llegó por el socket y lo que trae la consulta.
    const ultimas = datos?.ultimas || [];
    const grande = vivo && (!ultimas[0] || vivo.ts > ultimas[0].ts) ? vivo : ultimas[0] || null;
    const tira = useMemo(() => ultimas.filter((x) => x.id !== grande?.id).slice(0, EN_TIRA), [ultimas, grande?.id]);

    // El color: el del acceso grande, mientras sea reciente.
    const [ahora, setAhora] = useState(Date.now());
    useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);
    const reciente = !!grande && ahora - +new Date(grande.ts) < TINTE_MS;
    const tono = reciente && grande && datos?.terminales !== 0 ? TONO[grande.motivo] : null;
    useEffect(() => { setFondo(fondoDe(tono, grande?.motivo === "lista-negra")); }, [tono, grande?.motivo, setFondo]);
    useEffect(() => () => setFondo(null), [setFondo]);

    // Los contadores vuelven a cero a la medianoche sin recargar.
    const dia = useRef("");
    useEffect(() => { const iv = setInterval(() => { const d = new Date().toDateString(); if (dia.current && dia.current !== d) recargar(); dia.current = d; }, 30_000); return () => clearInterval(iv); }, [recargar]);

    if (error && !datos) {
        return (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
                <div>
                    <AlertTriangle size={34} className="mx-auto text-[var(--mal-texto)]" />
                    <div className="mt-3 text-[20px] font-semibold">No se pudo leer el Monitor Face</div>
                    <div className="mt-1 text-[14px] text-muted-foreground">{error}</div>
                    <button type="button" onClick={recargar} className={cn("mt-5 h-12 px-5 rounded-xl bg-[var(--accion)] text-white font-semibold inline-flex items-center gap-2", tocable)}><RefreshCw size={18} /> Reintentar</button>
                </div>
            </div>
        );
    }
    if (datos && datos.terminales === 0) return <SinTerminales />;

    return (
        <div className="absolute inset-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] gap-3 lg:gap-4 p-3 lg:p-4">
            <div className="min-w-0 min-h-0 flex-1 flex flex-col gap-3 lg:gap-4">
                <div className="relative flex-1 min-h-[260px] rounded-2xl overflow-hidden bg-neutral-950 ring-1 ring-white/10">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {grande ? (
                            <motion.div key={grande.id} className="absolute inset-0"
                                initial={{ opacity: 0, scale: 1.02, filter: "blur(8px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.99 }}
                                transition={{ type: "spring", stiffness: 300, damping: 32 }}>
                                <Protagonista a={grande} />
                            </motion.div>
                        ) : (
                            <motion.div key="vacio" className="absolute inset-0 grid place-items-center text-center px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <div className="text-muted-foreground">
                                    {datos ? <><ScanFace size={46} className="mx-auto opacity-60" /><div className="mt-3 text-[22px] font-semibold text-foreground/80">Todavía no hay accesos por rostro</div><div className="mt-1 text-[15px]">Aparecen acá en el momento en que una terminal reconoce a alguien.</div></>
                                        : <div className="text-[20px]">Cargando…</div>}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* La tira de los anteriores. */}
                <div className="shrink-0 h-[132px] flex gap-3 overflow-x-auto overscroll-x-contain snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {tira.length === 0 && <div className="grid place-items-center w-full rounded-xl border border-dashed border-border text-[15px] text-muted-foreground">Sin accesos anteriores</div>}
                    <AnimatePresence initial={false}>
                        {tira.map((a) => <TarjetaTira key={a.id} a={a} />)}
                    </AnimatePresence>
                </div>
            </div>

            <aside className="min-h-0 flex flex-col gap-3 lg:gap-4">
                <div className="grid grid-cols-3 lg:grid-cols-1 gap-3">
                    <Contador rotulo="Permitidos hoy" valor={datos?.hoy.permitidos ?? null} Icono={ShieldCheck} tono="bien" />
                    <Contador rotulo="Denegados hoy" valor={datos?.hoy.denegados ?? null} Icono={ShieldX} tono="aviso" />
                    <Contador rotulo="Desconocidos hoy" valor={datos?.hoy.desconocidos ?? null} Icono={UserX} tono="mal" />
                </div>
                <div className="flex-1 min-h-0 rounded-2xl bg-card border border-border flex flex-col overflow-hidden">
                    <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
                        <AlertTriangle size={17} className="text-[var(--aviso-texto)]" />
                        <span className="text-[15px] font-bold">Atención</span>
                        <span className="text-[13px] text-muted-foreground">· denegados de la última hora</span>
                        <span className="ml-auto text-[13px] font-semibold tabular-nums">{datos?.atencion.length ?? "—"}</span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        {datos && datos.atencion.length === 0 && <div className="h-full grid place-items-center text-[14px] text-muted-foreground px-6 text-center">Nadie negado en la última hora.</div>}
                        <AnimatePresence initial={false}>
                            {datos?.atencion.map((a) => (
                                <motion.div key={a.id} layout initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={SUAVE}
                                    className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 last:border-0">
                                    <Cara src={a.recorte || a.foto} className="h-12 w-12 rounded-[10px]" />
                                    <div className="min-w-0 flex-1 leading-tight">
                                        <div className="text-[14.5px] font-semibold truncate">{a.persona || "Desconocido"}</div>
                                        <div className="text-[12.5px] text-muted-foreground truncate">{a.terminal || "Terminal"} · {hace(a.ts)}</div>
                                    </div>
                                    <span className={cn("h-6 px-2 rounded-full text-[11px] font-bold inline-flex items-center", PLENO[a.motivo])}>{TEXTO_MOTIVO[a.motivo]}</span>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            </aside>
        </div>
    );
}

/** Lo grande: la foto tomada y la del padrón, lado a lado, y quién es. */
function Protagonista({ a }: { a: Acceso }) {
    const Icono = ICONO[a.motivo];
    const tomada = a.foto || a.recorte;
    const nombre = a.persona || (a.motivo === "desconocido" ? "Desconocido" : a.nombreTerminal || "Sin nombre");
    return (
        <div className="absolute inset-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            {/* La escena: la foto entera de la terminal, a sangre, con el recorte de la cara encima. */}
            <div className="relative min-h-[200px] bg-black overflow-hidden">
                {tomada ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={getImagePath(tomada) || undefined} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : <span className="absolute inset-0 grid place-items-center text-white/30"><ScanFace size={64} /></span>}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent_55%,rgba(0,0,0,.65)),linear-gradient(to_top,rgba(0,0,0,.7),transparent_40%)]" />
                {/* La línea de lectura: baja una vez, como la terminal mirando la cara. */}
                <motion.span aria-hidden className="absolute inset-x-0 h-[2px] bg-[var(--accion-en-oscuro)] shadow-[0_0_24px_4px_var(--accion-en-oscuro)]"
                    initial={{ top: "0%", opacity: 0.9 }} animate={{ top: "100%", opacity: 0 }} transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }} />
                <div className="absolute left-5 bottom-4 flex items-center gap-2 text-white [text-shadow:0_2px_10px_rgba(0,0,0,.7)]">
                    <span className="h-8 px-3 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[13px] font-semibold inline-flex items-center gap-1.5">
                        {a.sentido === "EXIT" ? <LogOut size={14} /> : <LogIn size={14} />} {a.sentido === "EXIT" ? "Salida" : "Entrada"} · {a.terminal || "Terminal"}
                    </span>
                    <span className="h-8 px-3 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[13px] font-semibold inline-flex items-center gap-1.5 tabular-nums"><Clock size={14} /> {horaCorta(a.ts)}</span>
                </div>
            </div>

            {/* Quién es. */}
            <div className="relative p-6 lg:p-8 flex flex-col justify-center gap-5 bg-[linear-gradient(160deg,rgba(255,255,255,.05),transparent_60%)]">
                <div className="flex items-end gap-4">
                    <motion.div initial={{ opacity: 0, x: -14, scale: 0.94 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 28, delay: 0.12 }} className="relative">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Tomada</div>
                        <Cara src={a.recorte || a.foto} className="h-[132px] w-[110px] lg:h-[168px] lg:w-[140px] rounded-[16px] ring-1 ring-white/15" />
                    </motion.div>
                    {a.padron && (
                        <motion.div initial={{ opacity: 0, x: 14, scale: 0.94 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 28, delay: 0.2 }}>
                            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Padrón</div>
                            <Cara src={a.padron} className="h-[132px] w-[110px] lg:h-[168px] lg:w-[140px] rounded-[16px] ring-1 ring-white/15" />
                        </motion.div>
                    )}
                    {a.similitud != null && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="pb-2">
                            <div className="text-[34px] font-bold leading-none tabular-nums">{Math.round(a.similitud)}<span className="text-[18px] text-muted-foreground">%</span></div>
                            <div className="text-[12px] text-muted-foreground mt-1">parecido</div>
                        </motion.div>
                    )}
                </div>
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SUAVE, delay: 0.18 }} className="min-w-0">
                    <div className="text-[34px] lg:text-[44px] font-bold tracking-[-0.025em] leading-[1.05] break-words">{nombre}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[16px] text-muted-foreground">
                        {a.unidad && <span className="inline-flex items-center gap-1.5"><Home size={16} /> {a.unidad}</span>}
                        {!a.persona && a.nombreTerminal && a.motivo !== "desconocido" && <span className="inline-flex items-center gap-1.5"><UserRound size={16} /> la terminal lo nombró «{a.nombreTerminal}»</span>}
                    </div>
                </motion.div>
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 26, delay: 0.26 }}
                    className={cn("self-start h-14 pl-3 pr-6 rounded-full inline-flex items-center gap-3 text-[22px] font-bold", PLENO[a.motivo])}>
                    <span className="grid place-items-center h-9 w-9 rounded-full bg-black/15"><Icono size={20} /></span>
                    {a.decision === "GRANT" ? "Permitido" : a.motivo === "denegado" ? "Denegado" : `Denegado · ${TEXTO_MOTIVO[a.motivo]}`}
                </motion.div>
            </div>
        </div>
    );
}

function TarjetaTira({ a }: { a: Acceso }) {
    return (
        <motion.div layout initial={{ opacity: 0, x: -24, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={SUAVE}
            className="snap-start shrink-0 w-[244px] rounded-xl bg-card border border-border overflow-hidden flex">
            <Cara src={a.recorte || a.foto} className="w-[92px] h-full" />
            <div className="min-w-0 flex-1 p-3 flex flex-col justify-between">
                <div className="min-w-0">
                    <div className="text-[14.5px] font-semibold truncate">{a.persona || "Desconocido"}</div>
                    <div className="text-[12px] text-muted-foreground truncate">{a.unidad || a.terminal || ""}</div>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] tabular-nums text-muted-foreground">{horaCorta(a.ts).slice(0, 5)}</span>
                    <span className={cn("h-5 px-1.5 rounded-full text-[10.5px] font-bold inline-flex items-center whitespace-nowrap", PLENO[a.motivo])}>{a.decision === "GRANT" ? "Permitido" : TEXTO_MOTIVO[a.motivo]}</span>
                </div>
            </div>
        </motion.div>
    );
}

/** Una cara: la foto, o el ícono si no hay o no carga. */
function Cara({ src, className }: { src: string | null; className?: string }) {
    const [mal, setMal] = useState(false);
    useEffect(() => setMal(false), [src]);
    return (
        <span className={cn("relative block overflow-hidden bg-muted shrink-0", className)}>
            {src && !mal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getImagePath(src) || undefined} alt="" onError={() => setMal(true)} className="absolute inset-0 w-full h-full object-cover" />
            ) : <span className="absolute inset-0 grid place-items-center text-muted-foreground"><ScanFace size={26} /></span>}
        </span>
    );
}

function Contador({ rotulo, valor, Icono, tono }: { rotulo: string; valor: number | null; Icono: any; tono: "bien" | "mal" | "aviso" }) {
    return (
        <div className="flex items-center gap-3 lg:gap-4 rounded-2xl bg-card border border-border px-4 lg:px-5 py-3 lg:py-4 min-h-[72px]">
            <span className={cn("grid h-11 w-11 lg:h-12 lg:w-12 place-items-center rounded-full shrink-0", `pleno-${tono}`)}><Icono size={22} /></span>
            <div className="min-w-0">
                <motion.div key={valor ?? "x"} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={SUAVE} className="text-[32px] lg:text-[40px] font-bold leading-none tabular-nums">{valor ?? "—"}</motion.div>
                <div className="text-[13px] lg:text-[14px] text-muted-foreground mt-1 leading-tight">{rotulo}</div>
            </div>
        </div>
    );
}

function SinTerminales() {
    return (
        <div className="absolute inset-0 grid place-items-center text-center px-6">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
                <motion.span className="mx-auto grid place-items-center h-24 w-24 rounded-[28px] bg-card border border-border"
                    animate={{ boxShadow: ["0 0 0 0 rgba(59,130,246,0)", "0 0 0 14px rgba(59,130,246,0.08)", "0 0 0 0 rgba(59,130,246,0)"] }} transition={{ duration: 3, repeat: Infinity }}>
                    <ScanFace size={44} className="text-[var(--accion-en-oscuro)]" />
                </motion.span>
                <div className="mt-5 text-[26px] font-bold tracking-[-0.02em]">No hay terminales faciales dadas de alta</div>
                <p className="mt-2 text-[16px] text-muted-foreground max-w-[520px] mx-auto">Esta pantalla muestra los accesos por reconocimiento facial. Cuando se dé de alta una terminal en Dispositivos, sus accesos aparecen acá en vivo.</p>
            </motion.div>
        </div>
    );
}
