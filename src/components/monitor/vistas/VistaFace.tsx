"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Clock, Fingerprint, History, Home, LogIn, LogOut, RefreshCw, ScanFace, ShieldCheck, ShieldX, Sparkles, UserCheck, UserRound, UserX } from "lucide-react";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos, hace, horaCorta, usarReloj } from "@/lib/monitor/cliente";
import { useTiempoReal } from "@/lib/tiempo-real";
import { sonar } from "@/lib/sonido-monitor";
import { getImagePath } from "@/lib/image-path";
import { fondoDe, type TonoFondo } from "@/lib/monitor/fondos";
import { leerDetalleRostro, motivoDeRostro, calidadRostro, TEXTO_MOTIVO, type MotivoRostro, type IdentidadRostro } from "@/lib/monitor/rostro";
import { SUAVE, tocable } from "@/components/monitor/tactil";
import { cn } from "@/lib/utils";

/**
 * Monitor Face (openspec pared-vms; 23/10, Nico: «falta el Monitor Face, nos falta desarrollo en
 * este modo»). Es el Control LPR con caras: las terminales faciales y, desde el 9/11 (Nico revierte
 * la decisión del 23/10), también lo que OmniVision reconoce sobre el stream, marcado como tal.
 *
 * Lo grande es la comparación: la foto que tomó la terminal y la del padrón, lado a lado, porque
 * lo que el guardia tiene que decidir de un vistazo es «¿es esa persona?». Al lado, quién es, de
 * qué unidad, por dónde y si se le abrió. Abajo la tira de los anteriores; a la derecha los números
 * del día y los denegados de la última hora.
 *
 * Desde el 13/11 (Nico, con la pantalla abierta: «foto de la escena, con el recorte del rostro, con
 * los datos de comparación, id del rostro… compará rostros, indicá cuántas veces visto») lo grande
 * es la ESCENA, con la cara marcada y su recorte al lado: el recorte solo, estirado a media pantalla,
 * era una mancha cuando la cara medía 15 px. Y cada cara tiene identidad (lib-rostros.js): su número,
 * contra quién se comparó y cuántas veces vino. Un paso que vio OmniVision ya no dice «Permitido»
 * (no abrió ninguna barrera): dice si es alguien del padrón, alguien ya visto o una cara nueva.
 *
 * El color de la pared sigue el criterio común (lib/monitor/fondos): verde si se abrió, rojo si fue
 * un desconocido o alguien en lista negra, ámbar si se negó por otro motivo. A los 8 s sin accesos
 * nuevos vuelve a calma: la pared no se queda roja por algo que ya pasó.
 */

type Acceso = {
    id: string; ts: string; decision: "GRANT" | "DENY"; sentido: "ENTRY" | "EXIT" | string;
    origen: "omnivision" | "terminal";
    persona: string | null; unidad: string | null; rol: string | null;
    padron: string | null; foto: string | null; recorte: string | null;
    nombreTerminal: string | null; similitud: number | null; terminal: string | null; motivo: MotivoRostro;
    // Calidad de la captura del rostro: puntaje 0–100 y sus dos componentes (detección y tamaño).
    calidad: number | null; deteccion: number | null; caraFrac: number | null;
    // Identidad por rostro: qué se decidió con esta cara, su Rostro (si tiene) y la visita que era.
    identidad: IdentidadRostro | null; rostroId: string | null; visita: number | null;
    rostro: { id: string; codigo: string; nombre: string | null; veces: number; primeraVez: string; foto: string | null; calidad: number } | null;
    caraPx: number | null; sinIdentidad: string | null; caja: [number, number, number, number] | null; escena: string | null;
};
type Anterior = { id: string; ts: string; camara: string | null; cara: string | null; similitud: number | null };
type Datos = { ultimas: Acceso[]; atencion: Acceso[]; anteriores?: { de: string | null; pasadas: Anterior[] }; hoy: { permitidos: number; denegados: number; desconocidos: number }; fuentes: number; ahora: string };

const INTERVALO_MS = 20_000;
/** Cuánto dura el color de un acceso en la pared. */
const TINTE_MS = 8_000;
const EN_TIRA = 10;

/**
 * Cómo se presenta un acceso. Los de una terminal, por lo que decidió (los cuatro motivos de
 * siempre). Los que vio OmniVision con identidad por rostro no abrieron nada, así que se presentan
 * por QUIÉN es: del padrón, alguien ya visto, una cara nueva, o una cara que no alcanzó.
 */
type Clase = MotivoRostro | "reconocido" | "visto" | "nuevo" | "sin-identidad";
const TONO: Record<Clase, TonoFondo | null> = { permitido: "bien", desconocido: "mal", "lista-negra": "mal", denegado: "aviso", reconocido: "bien", visto: null, nuevo: null, "sin-identidad": null };
const PLENO: Record<Clase, string> = { permitido: "pleno-bien", desconocido: "pleno-mal", "lista-negra": "pleno-mal", denegado: "pleno-aviso", reconocido: "pleno-bien", visto: "pleno-info", nuevo: "pleno-aviso", "sin-identidad": "pleno-neutro" };
const ICONO: Record<Clase, typeof ShieldCheck> = { permitido: ShieldCheck, desconocido: UserX, "lista-negra": ShieldX, denegado: ShieldX, reconocido: UserCheck, visto: History, nuevo: Sparkles, "sin-identidad": ScanFace };
const TEXTO_CLASE: Record<Clase, string> = { ...TEXTO_MOTIVO, reconocido: "Reconocido", visto: "Visto antes", nuevo: "Cara nueva", "sin-identidad": "Sin identidad" };

function claseDe(a: Acceso): Clase {
    if (a.motivo === "lista-negra" || a.rol === "BLACKLISTED") return "lista-negra";
    if (!a.identidad) return a.motivo;
    if (a.identidad === "padron" || a.persona) return "reconocido";
    return a.identidad === "misma" ? "visto" : a.identidad === "nueva" ? "nuevo" : "sin-identidad";
}
/** Cómo se llama en pantalla: la persona, el nombre puesto a mano, o el número del rostro. */
const nombreDe = (a: Acceso) => a.persona || a.rostro?.nombre || a.rostro?.codigo
    || (a.nombreTerminal && a.nombreTerminal.toLowerCase() !== "desconocido" ? a.nombreTerminal : null)
    || (a.identidad === "sin-cara" ? "Sin identidad" : "Desconocido");
/** «7.ª visita». */
const ordinal = (n: number) => `${n}.ª visita`;
const diaCorto = (ts: string) => new Date(ts).toLocaleDateString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit" });

/** El acceso tal como llega por el socket (server.js emite access_event con el evento, la persona y la terminal). */
function desdeEvento(e: any): Acceso | null {
    if (!e || e.accessType !== "FACE") return null;
    const d = leerDetalleRostro(e.details);
    const origen = /Source:\s*OmniVision/i.test(e.details || "") || (e.device && e.device.deviceType && e.device.deviceType !== "FACE_TERMINAL") ? "omnivision" as const : "terminal" as const;
    // La foto de OmniVision se pide por el endpoint que abre a la pantalla (ver /api/monitor/face).
    const aPared = (r: string | null) => r && r.startsWith("/api/vision/imagen/") ? r.replace("/api/vision/imagen/", "/api/monitor/camaras/imagen/") : r;
    return {
        id: e.id, ts: new Date(e.timestamp || Date.now()).toISOString(), decision: e.decision, sentido: e.direction, origen,
        persona: e.user?.name || null, unidad: null, rol: e.user?.role || null, padron: e.user?.cara || null,
        foto: aPared(e.snapshotPath || e.imagePath || null), recorte: aPared(d.recorte), nombreTerminal: d.nombre, similitud: d.similitud,
        calidad: calidadRostro(d.deteccion, d.caraFrac), deteccion: d.deteccion, caraFrac: d.caraFrac,
        terminal: e.device?.name || null, motivo: motivoDeRostro({ decision: e.decision, userId: e.userId, rol: e.user?.role, detalles: e.details }),
        // El Rostro (número, foto conocida, visitas totales) lo trae la consulta un segundo después.
        identidad: d.identidad, rostroId: d.rostroId, visita: d.veces, rostro: null,
        caraPx: d.caraPx, sinIdentidad: d.sinIdentidad, caja: d.caja, escena: aPared(d.escena),
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
    const claseGrande = grande ? claseDe(grande) : null;
    const tono = reciente && claseGrande && datos?.fuentes !== 0 ? TONO[claseGrande] : null;
    useEffect(() => { setFondo(fondoDe(tono, claseGrande === "lista-negra")); }, [tono, claseGrande, setFondo]);
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
    if (datos && datos.fuentes === 0) return <SinFuentes />;

    return (
        <div className="absolute inset-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] gap-3 lg:gap-4 p-3 lg:p-4">
            <div className="min-w-0 min-h-0 flex-1 flex flex-col gap-3 lg:gap-4">
                <div className="relative flex-1 min-h-[260px] rounded-2xl overflow-hidden bg-neutral-950 ring-1 ring-white/10">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {grande ? (
                            <motion.div key={grande.id} className="absolute inset-0"
                                initial={{ opacity: 0, scale: 1.02, filter: "blur(8px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.99 }}
                                transition={{ type: "spring", stiffness: 300, damping: 32 }}>
                                <Protagonista a={grande} anteriores={datos?.anteriores?.de === grande.id ? datos.anteriores.pasadas : null} />
                            </motion.div>
                        ) : (
                            <motion.div key="vacio" className="absolute inset-0 grid place-items-center text-center px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                <div className="text-muted-foreground">
                                    {datos ? <><ScanFace size={46} className="mx-auto opacity-60" /><div className="mt-3 text-[22px] font-semibold text-foreground/80">Todavía no hay accesos por rostro</div><div className="mt-1 text-[15px]">Aparecen acá en el momento en que una terminal o una cámara con OmniVision reconoce a alguien.</div></>
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
                                    <Cara src={a.recorte || a.foto} ov={a.origen === "omnivision"} className="h-12 w-12 rounded-[10px]" />
                                    <div className="min-w-0 flex-1 leading-tight">
                                        <div className="text-[14.5px] font-semibold truncate">{nombreDe(a)}</div>
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

/** El puntaje de calidad a tono de estado: verde buena, ámbar media, rojo pobre. */
const tonoCalidad = (q: number | null) => q == null ? "quieto" : q >= 70 ? "bien" : q >= 45 ? "aviso" : "mal";
const textoCalidad = (q: number | null) => q == null ? "Sin datos" : q >= 70 ? "Rostro nítido" : q >= 45 ? "Rostro aceptable" : "Rostro pobre";

/**
 * La escena con la cara marcada. La foto entra entera (no se recorta para llenar): lo que sobra a
 * los costados lo ocupa la misma foto desenfocada, y el recuadro de la cara se ubica sobre el
 * rectángulo real de la imagen, que se mide (cambia con el tamaño de la pared).
 */
function Escena({ src, caja, rotulo }: { src: string; caja: Acceso["caja"]; rotulo: string }) {
    const marco = useRef<HTMLDivElement>(null);
    const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
    const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
    useEffect(() => { setNat(null); }, [src]);
    useEffect(() => {
        const el = marco.current; if (!el) return;
        const medir = () => setTam({ w: el.clientWidth, h: el.clientHeight });
        medir();
        const ro = new ResizeObserver(medir); ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const r = nat && tam && nat.w && nat.h ? (() => { const k = Math.min(tam.w / nat.w, tam.h / nat.h); const w = nat.w * k, h = nat.h * k; return { x: (tam.w - w) / 2, y: (tam.h - h) / 2, w, h }; })() : null;
    const url = getImagePath(src) || undefined;
    return (
        <div ref={marco} className="absolute inset-0 bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-45" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="absolute inset-0 w-full h-full object-contain" />
            {r && caja && (
                <motion.span aria-hidden className="absolute rounded-[6px] border-2 border-[var(--accion-en-oscuro)] shadow-[0_0_0_1px_rgba(0,0,0,.55)]"
                    initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.15 }}
                    style={{ left: r.x + caja[0] * r.w - 3, top: r.y + caja[1] * r.h - 3, width: (caja[2] - caja[0]) * r.w + 6, height: (caja[3] - caja[1]) * r.h + 6 }}>
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 h-6 px-2 rounded-md bg-[var(--accion-en-oscuro)] text-black text-[11.5px] font-bold whitespace-nowrap inline-flex items-center tabular-nums">{rotulo}</span>
                </motion.span>
            )}
        </div>
    );
}

/**
 * Lo grande: LA ESCENA, con la cara marcada y su recorte al lado. A la derecha, quién es (su nombre
 * o el número del rostro), contra qué se comparó, cuántas veces vino y la calidad de la captura.
 * Sin escena (una terminal que sólo manda el recorte), el recorte ocupa el lugar.
 */
function Protagonista({ a, anteriores }: { a: Acceso; anteriores: Anterior[] | null }) {
    const clase = claseDe(a);
    const Icono = ICONO[clase];
    const escena = a.escena || (a.recorte && a.foto ? a.foto : null);
    const nombre = nombreDe(a);
    const visitas = a.visita ?? a.rostro?.veces ?? null;
    return (
        <div className="absolute inset-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
            <div className="relative min-h-[240px] bg-neutral-950 overflow-hidden">
                {escena ? <Escena src={escena} caja={a.caja} rotulo={a.rostro?.codigo || (a.persona ? a.persona.split(" ")[0] : "Rostro")} />
                    : a.recorte || a.foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getImagePath(a.recorte || a.foto) || undefined} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    ) : <span className="absolute inset-0 grid place-items-center text-white/25"><ScanFace size={72} /></span>}
                <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/75 to-transparent pointer-events-none" />
                <motion.span aria-hidden className="absolute inset-x-0 h-[2px] bg-[var(--accion-en-oscuro)] shadow-[0_0_24px_4px_var(--accion-en-oscuro)]"
                    initial={{ top: "0%", opacity: 0.9 }} animate={{ top: "100%", opacity: 0 }} transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }} />
                {/* El recorte del rostro, sobre la escena: es lo que se compara. */}
                {escena && a.recorte && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SUAVE, delay: 0.2 }}
                        className="absolute right-4 bottom-4 w-[150px] lg:w-[176px] rounded-[14px] overflow-hidden bg-black ring-1 ring-white/25 shadow-[var(--sombra-flotante)]">
                        <Cara src={a.recorte} className="w-full aspect-[5/6]" />
                        <div className="px-2.5 py-1.5 flex items-center justify-between text-[11px] font-bold text-white/90">
                            <span className="uppercase tracking-[0.12em]">Rostro</span>
                            {a.caraPx != null && <span className="tabular-nums text-white/65">{a.caraPx} px</span>}
                        </div>
                    </motion.div>
                )}
                <div className="absolute left-5 bottom-4 right-[200px] flex flex-wrap items-center gap-2 text-white [text-shadow:0_2px_10px_rgba(0,0,0,.7)]">
                    <span className="h-8 px-3 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[13px] font-semibold inline-flex items-center gap-1.5">
                        {a.sentido === "EXIT" ? <LogOut size={14} /> : <LogIn size={14} />} {a.sentido === "EXIT" ? "Salida" : "Entrada"} · {a.terminal || "Terminal"}
                    </span>
                    <span className="h-8 px-3 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[13px] font-semibold inline-flex items-center gap-1.5 tabular-nums"><Clock size={14} /> {horaCorta(a.ts)}</span>
                    {a.origen === "omnivision" && <span className="h-8 px-3 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[13px] font-semibold inline-flex items-center gap-1.5"><ScanFace size={14} /> OmniVision</span>}
                </div>
            </div>

            {/* PANEL: quién es, comparación, visitas y calidad. */}
            <div className="relative p-5 lg:p-6 flex flex-col gap-3.5 bg-[linear-gradient(160deg,rgba(255,255,255,.05),transparent_60%)] min-h-0 overflow-y-auto">
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={SUAVE} className="min-w-0">
                    {/* El número, cuando el título es un nombre: si no tiene nombre, el número ya ES el título. */}
                    {a.rostro && nombre !== a.rostro.codigo && (
                        <div className="mb-1.5 inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-white/10 text-[11.5px] font-bold tabular-nums" title="El número de esta cara en OmniVision › Rostros">
                            <Fingerprint size={12} /> {a.rostro.codigo}
                        </div>
                    )}
                    <div className="text-[26px] lg:text-[34px] font-bold tracking-[-0.025em] leading-[1.05] break-words">{nombre}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14.5px] text-muted-foreground">
                        {a.unidad && <span className="inline-flex items-center gap-1.5"><Home size={16} /> {a.unidad}</span>}
                        {!a.identidad && !a.persona && a.nombreTerminal && a.nombreTerminal.toLowerCase() !== "desconocido" && a.motivo !== "desconocido" && <span className="inline-flex items-center gap-1.5"><UserRound size={16} /> la terminal lo nombró «{a.nombreTerminal}»</span>}
                        {a.identidad === "sin-cara" && a.sinIdentidad && <span>No se pudo comparar: {a.sinIdentidad}.</span>}
                    </div>
                    <div className={cn("mt-3 h-10 pl-2 pr-4 rounded-full inline-flex items-center gap-2 text-[16px] font-bold", PLENO[clase])}>
                        <span className="grid place-items-center h-7 w-7 rounded-full bg-black/15"><Icono size={16} /></span>
                        {a.identidad ? (clase === "visto" && visitas && visitas > 1 ? `Visto antes · ${ordinal(visitas)}` : TEXTO_CLASE[clase])
                            : a.decision === "GRANT" ? "Permitido" : a.motivo === "denegado" ? "Denegado" : `Denegado · ${TEXTO_MOTIVO[a.motivo]}`}
                    </div>
                </motion.div>

                <Comparacion a={a} />
                {a.rostro && <Visitas a={a} anteriores={anteriores} />}
                <CalidadCaptura a={a} />
            </div>
        </div>
    );
}

/**
 * Tomada ↔ contra quién se comparó, con el parecido en el medio. La referencia es la foto del
 * padrón, o la mejor cara guardada de ese rostro. Una cara nueva no tiene contra quién: lo dice.
 */
function Comparacion({ a }: { a: Acceso }) {
    const referencia = a.padron || (a.identidad === "misma" || a.identidad === "padron" ? a.rostro?.foto || null : null);
    const rotuloRef = a.padron ? "Padrón" : "Guardada";
    const medio = a.identidad === "nueva" ? (
        <div className="text-[12.5px] text-muted-foreground text-center leading-snug"><b className="block text-[14px] text-foreground font-semibold">Cara nueva</b>{a.rostro ? <>quedó guardada como {a.rostro.codigo}</> : "quedó guardada"}{a.similitud != null && <span className="block mt-0.5 text-[11.5px]">lo más parecido: {Math.round(a.similitud)} %</span>}</div>
    ) : a.identidad === "sin-cara" ? (
        <div className="text-[12.5px] text-muted-foreground text-center leading-snug"><b className="block text-[14px] text-foreground font-semibold">Sin comparar</b>{a.sinIdentidad || "la cara no alcanza"}</div>
    ) : a.similitud != null && referencia ? (
        <>
            <div className="text-[30px] font-bold leading-none tabular-nums">{Math.round(a.similitud)}<span className="text-[16px] text-muted-foreground">%</span></div>
            <div className="text-[11px] text-muted-foreground">parecido</div>
        </>
    ) : <div className="text-[12.5px] text-muted-foreground text-center leading-snug">Sin coincidencia<br />en el padrón</div>;
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SUAVE, delay: 0.1 }}
            className="rounded-2xl bg-black/15 border border-white/10 p-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-3">Comparación de rostros</div>
            <div className="flex items-center justify-center gap-3">
                <FotoRotulo rotulo="Tomada" src={a.recorte || a.foto} />
                <div className="flex flex-col items-center gap-0.5 min-w-[92px] flex-1">{medio}</div>
                {referencia ? <FotoRotulo rotulo={rotuloRef} src={referencia} /> : (
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{a.identidad === "nueva" ? "Primera vez" : a.identidad === "sin-cara" ? "Sin referencia" : rotuloRef}</div>
                        <div className="h-[100px] w-[82px] rounded-[14px] border border-dashed border-white/20 grid place-items-center text-white/30">{a.identidad === "nueva" ? <Sparkles size={22} /> : <UserX size={24} />}</div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

/** Cuántas veces vino esta cara, desde cuándo, y sus últimas pasadas antes de ésta. */
function Visitas({ a, anteriores }: { a: Acceso; anteriores: Anterior[] | null }) {
    const r = a.rostro!;
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SUAVE, delay: 0.14 }}
            className="rounded-2xl bg-black/15 border border-white/10 p-4">
            <div className="flex items-end gap-4">
                <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">Visto</div>
                    <div className="text-[36px] font-bold leading-none tabular-nums">{r.veces}<span className="text-[15px] text-muted-foreground font-semibold ml-1.5">{r.veces === 1 ? "vez" : "veces"}</span></div>
                </div>
                <div className="ml-auto text-right text-[12.5px] text-muted-foreground leading-snug">
                    <div>Primera vez <b className="text-foreground font-semibold tabular-nums">{diaCorto(r.primeraVez)}</b></div>
                    {a.visita != null && a.visita > 0 && <div>Ésta es su <b className="text-foreground font-semibold">{ordinal(a.visita)}</b></div>}
                </div>
            </div>
            {anteriores && anteriores.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                    {anteriores.map((p) => (
                        <div key={p.id} className="flex items-center gap-2.5">
                            <Cara src={p.cara} className="h-9 w-8 rounded-[6px]" />
                            <span className="text-[13px] font-semibold tabular-nums shrink-0">{diaCorto(p.ts)} {horaCorta(p.ts).slice(0, 5)}</span>
                            <span className="text-[12.5px] text-muted-foreground truncate">{p.camara || ""}</span>
                            <span className="ml-auto text-[12px] text-muted-foreground tabular-nums shrink-0">{hace(p.ts)}</span>
                        </div>
                    ))}
                </div>
            )}
        </motion.div>
    );
}
function FotoRotulo({ rotulo, src }: { rotulo: string; src: string | null }) {
    return (
        <div className="flex flex-col items-center gap-1.5 shrink-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</div>
            <Cara src={src} className="h-[100px] w-[82px] rounded-[14px] ring-1 ring-white/15" />
        </div>
    );
}

/** La calidad de la captura: puntaje + detección + tamaño del rostro. Si no hay métricas, no se muestra. */
function CalidadCaptura({ a }: { a: Acceso }) {
    if (a.calidad == null && a.deteccion == null && a.caraFrac == null) return null;
    const tono = tonoCalidad(a.calidad);
    const tam = a.caraFrac != null ? Math.max(0, Math.min(100, Math.round((a.caraFrac / 22) * 100))) : null;
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SUAVE, delay: 0.18 }}
            className="rounded-2xl bg-black/15 border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Calidad de la captura</span>
                {a.calidad != null && <span className={cn("h-6 px-2.5 rounded-full text-[11px] font-bold inline-flex items-center", `pleno-${tono}`)}>{textoCalidad(a.calidad)}</span>}
            </div>
            {a.calidad != null && (
                <div className={cn("text-[36px] font-bold leading-none tabular-nums mb-3", `tono-${tono}`)}>{a.calidad}<span className="text-[16px] text-muted-foreground font-semibold">/100</span></div>
            )}
            <div className="space-y-2.5">
                {a.caraPx != null && <div className="flex items-center justify-between text-[12px]"><span className="text-muted-foreground">Alto del rostro</span><span className="font-bold tabular-nums">{a.caraPx} px</span></div>}
                {a.deteccion != null && <BarraCalidad rotulo="Confianza de detección" valor={a.deteccion} />}
                {tam != null && <BarraCalidad rotulo="Tamaño del rostro" valor={tam} />}
            </div>
        </motion.div>
    );
}
function BarraCalidad({ rotulo, valor }: { rotulo: string; valor: number }) {
    const tono = tonoCalidad(valor);
    return (
        <div>
            <div className="flex items-center justify-between text-[12px] mb-1">
                <span className="text-muted-foreground">{rotulo}</span>
                <span className={cn("font-bold tabular-nums", `tono-${tono}`)}>{valor}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/12 overflow-hidden">
                <motion.div className={cn("h-full rounded-full", `pleno-${tono}`)} initial={{ width: 0 }} animate={{ width: `${valor}%` }} transition={{ ...SUAVE, delay: 0.2 }} />
            </div>
        </div>
    );
}

function TarjetaTira({ a }: { a: Acceso }) {
    return (
        <motion.div layout initial={{ opacity: 0, x: -24, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={SUAVE}
            className="snap-start shrink-0 w-[244px] rounded-xl bg-card border border-border overflow-hidden flex">
            <Cara src={a.recorte || a.foto} ov={a.origen === "omnivision"} className="w-[92px] h-full" />
            <div className="min-w-0 flex-1 p-3 flex flex-col justify-between">
                <div className="min-w-0">
                    <div className={cn("text-[14.5px] font-semibold truncate", !a.persona && a.rostro && !a.rostro.nombre && "tabular-nums")}>{nombreDe(a)}</div>
                    <div className="text-[12px] text-muted-foreground truncate">{[a.rostro ? (a.rostro.veces === 1 ? "1 vez" : `${a.rostro.veces} veces`) : null, a.unidad || a.terminal].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] tabular-nums text-muted-foreground">
                        {a.calidad != null && <span title={`Calidad ${a.calidad}/100`} className={cn("h-2 w-2 rounded-full shrink-0", `pleno-${tonoCalidad(a.calidad)}`)} />}
                        {horaCorta(a.ts).slice(0, 5)}
                    </span>
                    <span className={cn("h-5 px-1.5 rounded-full text-[10.5px] font-bold inline-flex items-center whitespace-nowrap", PLENO[claseDe(a)])}>{a.identidad ? TEXTO_CLASE[claseDe(a)] : a.decision === "GRANT" ? "Permitido" : TEXTO_MOTIVO[a.motivo]}</span>
                </div>
            </div>
        </motion.div>
    );
}

/** Una cara: la foto, o el ícono si no hay o no carga. `ov` marca, chiquito, que la tomó OmniVision. */
function Cara({ src, className, ov }: { src: string | null; className?: string; ov?: boolean }) {
    const [mal, setMal] = useState(false);
    useEffect(() => setMal(false), [src]);
    return (
        <span className={cn("relative block overflow-hidden bg-muted shrink-0", className)}>
            {src && !mal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getImagePath(src) || undefined} alt="" onError={() => setMal(true)} className="absolute inset-0 w-full h-full object-cover" />
            ) : <span className="absolute inset-0 grid place-items-center text-muted-foreground"><ScanFace size={26} /></span>}
            {ov && <span title="OmniVision" className="absolute bottom-1 left-1 grid place-items-center h-5 w-5 rounded-full bg-black/60 backdrop-blur-sm text-white/90 border border-white/15"><ScanFace size={11} /></span>}
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

function SinFuentes() {
    return (
        <div className="absolute inset-0 grid place-items-center text-center px-6">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
                <motion.span className="mx-auto grid place-items-center h-24 w-24 rounded-[28px] bg-card border border-border"
                    animate={{ boxShadow: ["0 0 0 0 rgba(59,130,246,0)", "0 0 0 14px rgba(59,130,246,0.08)", "0 0 0 0 rgba(59,130,246,0)"] }} transition={{ duration: 3, repeat: Infinity }}>
                    <ScanFace size={44} className="text-[var(--accion-en-oscuro)]" />
                </motion.span>
                <div className="mt-5 text-[26px] font-bold tracking-[-0.02em]">Todavía no hay fuentes de rostro</div>
                <p className="mt-2 text-[16px] text-muted-foreground max-w-[520px] mx-auto">Esta pantalla muestra los accesos por reconocimiento facial. Aparecen cuando se da de alta una terminal facial, o cuando una cámara con OmniVision reconoce rostros sobre su stream.</p>
            </motion.div>
        </div>
    );
}
